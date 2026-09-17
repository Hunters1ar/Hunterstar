import readline from 'readline';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import { loadConfig, setConfigValue, getConfigValue } from '../utils/configManager.js';
import { createSpinner, HUNTERSTAR_LOGO, hunterstarTheme } from '../spinner.js';
import { detectPlatform, getShellGuidance } from '../utils/platform.js';

const execPromise = util.promisify(exec);

function renderMarkdown(text) {
    let result = text;
    // Bold
    result = result.replace(/\*\*(.*?)\*\*/g, '\x1b[1m$1\x1b[0m');
    // Headings (### Heading)
    result = result.replace(/^### (.*)$/gm, '\n\x1b[1m\x1b[36m$1\x1b[0m\n\x1b[36m' + '\u2500'.repeat(20) + '\x1b[0m');
    // Inline code
    result = result.replace(/`([^`]+)`/g, '\x1b[33m$1\x1b[0m');
    // Bullets
    result = result.replace(/^[-*] (.*)$/gm, '  \x1b[35m\u2022\x1b[0m $1');
    return result;
}

function decodeXmlEntities(str) {
    if (!str) return '';
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

function parseToolCall(aiMsg, platformInfo) {
    if (!aiMsg) return null;

    // Matches <invoke name="...">...</invoke> or <function_call name="...">...</function_call>
    // inside or outside <dots_function_call>
    const invokeRegex = /<(?:invoke|function_call)\s+name=["']([^"']+)["']\s*>([\s\S]*?)(?:<\/(?:invoke|function_call)>|$)/i;
    const invokeMatch = aiMsg.match(invokeRegex);

    if (!invokeMatch) return null;

    const toolName = invokeMatch[1].trim().toLowerCase();
    const body = invokeMatch[2];

    const params = {};
    const paramRegex = /<parameter\s+name=["']([^"']+)["']\s*>([\s\S]*?)(?:<\/parameter>|$)/gi;
    let pMatch;
    while ((pMatch = paramRegex.exec(body)) !== null) {
        params[pMatch[1].trim().toLowerCase()] = decodeXmlEntities(pMatch[2].trim());
    }

    // Fallback: If no <parameter> tag was found inside invoke, treat body as command/param
    if (Object.keys(params).length === 0 && body.trim()) {
        params['command'] = decodeXmlEntities(body.trim());
    }

    let command = null;
    let isSupported = true;

    if (['exec', 'bash', 'sh', 'shell', 'powershell', 'cmd', 'run', 'terminal'].includes(toolName)) {
        command = params.command || params.cmd || Object.values(params)[0] || '';
    } else if (['glob', 'find_files', 'list_files', 'ls', 'dir'].includes(toolName)) {
        const pattern = params.pattern || params.path || '';
        if (platformInfo.shell === 'powershell') {
            if (!pattern || pattern === '**/*' || pattern === '*' || pattern === '**') {
                command = 'Get-ChildItem -Path . -Recurse -File -Name | Select-Object -First 100';
            } else {
                command = `Get-ChildItem -Path . -Recurse -Filter "${pattern}" -Name | Select-Object -First 100`;
            }
        } else if (platformInfo.shell === 'cmd') {
            command = 'dir /s /b';
        } else {
            if (!pattern || pattern === '**/*' || pattern === '*' || pattern === '**') {
                command = 'find . -maxdepth 4 -not -path "*/.*"';
            } else {
                command = `find . -name "${pattern}" -not -path "*/.*"`;
            }
        }
    } else if (['read_file', 'view_file', 'cat', 'read'].includes(toolName)) {
        const filePath = params.path || params.file || params.filename || '';
        if (platformInfo.shell === 'powershell') {
            command = `Get-Content -Path "${filePath}" -TotalCount 200`;
        } else if (platformInfo.shell === 'cmd') {
            command = `type "${filePath}"`;
        } else {
            command = `head -n 200 "${filePath}"`;
        }
    } else if (['grep', 'search', 'grep_search'].includes(toolName)) {
        const pattern = params.pattern || params.query || '';
        const targetPath = params.path || '.';
        if (platformInfo.shell === 'powershell') {
            command = `Get-ChildItem -Recurse -File | Select-String -Pattern "${pattern}" | Select-Object -First 50`;
        } else {
            command = `grep -rnI "${pattern}" "${targetPath}" | head -n 50`;
        }
    } else {
        isSupported = false;
    }

    return {
        toolName,
        params,
        command: command ? command.trim() : null,
        isSupported
    };
}

function cleanAiDisplayText(text) {
    if (!text) return '';
    return text
        .replace(/<dots_function_call>[\s\S]*?(?:<\/dots_function_call>|$)/gi, '')
        .replace(/<(?:invoke|function_call)[\s\S]*?(?:<\/(?:invoke|function_call)>|$)/gi, '')
        .replace(/\[EXEC\][\s\S]*?(?:\[\/EXEC\]|$)/gi, '')
        .trim();
}

function getExtendedPath(platformInfo) {
    let envPath = process.env.PATH || '';
    if (!platformInfo.isWindows) return envPath;

    const candidateDirs = [
        'C:\\Program Files\\Git\\usr\\bin',
        'C:\\Program Files (x86)\\Git\\usr\\bin',
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'usr', 'bin')
    ];

    for (const dir of candidateDirs) {
        if (dir && fs.existsSync(dir) && !envPath.toLowerCase().includes(dir.toLowerCase())) {
            envPath = `${dir};${envPath}`;
            break;
        }
    }
    return envPath;
}
export async function startAiChat({ noExec = false, verbose = false, turbo = false } = {}) {
    const platformInfo = detectPlatform();
    console.log('\x1b[35mHunterstar AI CLI Initialized (Agent Mode).\x1b[0m');
    console.log(`\x1b[90m[System: ${platformInfo.osDisplayName} | Shell: ${platformInfo.shell} | Chaining: "${platformInfo.commandSeparator}"]\x1b[0m`);
    console.log('Type \x1b[31m"/exit"\x1b[0m to quit, or \x1b[33m"/clear"\x1b[0m to reset conversation.');
    if (noExec) console.log('\x1b[33m[NO-EXEC MODE ACTIVE]\x1b[0m Command execution is disabled.');
    if (turbo) console.log('\x1b[33m[\u26A1 TURBO MODE ACTIVE]\x1b[0m Safe commands will be auto-executed.\n');
    else console.log();
    
    const askQuestion = async (query) => {
        const { ans } = await inquirer.prompt([{
            type: 'input',
            name: 'ans',
            message: query,
            theme: hunterstarTheme,
        }]);
        return ans;
    };

    const systemPrompt = `You are the Hunterstar CLI AI Assistant.
${getShellGuidance(platformInfo)}

You can execute commands on the user's system by wrapping them in [EXEC]command[/EXEC].
When executing multiple steps, execute one command at a time, wait for the result, and then proceed to the next step.
If the user asks to "build my git and deploy it" or similar git operations, follow these EXACT steps:
1. Run 'git status'. If it fails or says not a git repository, run 'git init'.
2. Run 'git add .'.
3. Run 'git commit -m "commit by hunterstar"'.
4. Run 'git branch -M main' (if it's a new repo or not on main).
5. Run 'git remote -v' to check for a linked repository.
6. If there is no remote linked, explicitly ASK the user to go to GitHub, create a repository, and provide the repo link. Wait for their response.
7. Once the user provides the link, run 'git remote add origin <link>' and then 'git push -u origin main'.
8. If 'git remote -v' shows it's already linked, simply run 'git push'.

If the user asks for "vercel deploy" or to deploy to vercel:
1. Run 'npm i -g vercel' to ensure vercel is installed.
2. Run 'vercel login'. (Wait for the user if it requires browser interaction)
3. Run 'vercel link --yes' to link without prompts.
4. Determine the root folder name (using 'basename $PWD' or equivalent) and run 'vercel --prod --yes'.

If the user asks to build docker:
1. Check if a Dockerfile exists. If not, generate one and ask the user if they want to save it.
2. Run 'docker build -t <project_name> .'.
3. Run 'docker run ...' based on the project type.

If the user asks to convert, turn, or optimize image formats, delete original files, or replace connections in HTML/CSS/JS:
1. NEVER execute the command 'convert' on Windows (it is C:\Windows\System32\convert.exe for FAT-to-NTFS drive conversion, NOT ImageMagick).
2. Do NOT write multi-line PowerShell/bash scripts, Write-Host banners, or create temporary output/backup folders.
3. Use the built-in Hunterstar converter command:
   hunterstar convert --from <source_extensions> --to <target_extension> [--delete] [--update-refs]
   Examples:
   - "turn png, jpg, jpeg into webp" -> hunterstar convert --from png,jpg,jpeg --to webp
   - "convert webp to png" -> hunterstar convert --from webp --to png
   - "delete all png files, put webp in their places, replace connections in html, css, js" -> hunterstar convert --from png --to webp --delete --update-refs
   - If a specific directory is mentioned: hunterstar convert --from <source> --to <target> --dir <path>
4. Execute it directly via [EXEC]hunterstar convert --from <source_extensions> --to <target_extension>[/EXEC].

CRITICAL EXECUTION RULES:
- When executing system commands or inspecting files, wrap the shell command inside [EXEC]command[/EXEC].
- Do not output multi-line scripts, Write-Host banners, PowerShell script blocks, or comments inside [EXEC].
- On Windows (${platformInfo.shell}):
  - For searching text: [EXEC]Get-ChildItem -Recurse -File | Select-String -Pattern "..."[/EXEC] or grep if available.
  - For finding files: [EXEC]Get-ChildItem -Recurse -Name[/EXEC] or [EXEC]Get-ChildItem -Filter "*.ext" -Recurse[/EXEC].
  - For reading files: [EXEC]Get-Content -Path "..." -TotalCount 100[/EXEC].
- Always output concise, single-line commands and execute commands step by step. Wait for command output before proceeding to the next step.`;

    let messages = [{ role: 'system', content: systemPrompt }];

    const isDangerousCommand = (cmd) => {
        const dangerousPatterns = [
            /\brm\s+(?:-[a-z]*r[a-z]*\s+-?[a-z]*f[a-z]*|-[a-z]*f[a-z]*\s+-?[a-z]*r[a-z]*|-[a-z]*rf[a-z]*|-[a-z]*fr[a-z]*)\b/i,
            /\bdel\s+(?:.*\/[fsq]\b){2,}/i,
            /\bformat\b\s+[a-z]:/i,
            /\bmkfs\b/i,
            /\bdd\b\s+if=/i,
            /\bsudo\b/i,
            /\bsu\b\s+-/i,
            /\bchmod\b\s+(?:-R\s+)?777\b/i,
            /\bchown\b\s+-R\b/i,
            /\bdiskpart\b/i,
            /\bvssadmin\b/i
        ];
        return dangerousPatterns.some(regex => regex.test(cmd));
    };

    while (true) {
        const input = await askQuestion('\x1b[36mYou:\x1b[0m ');
        const trimmed = input.trim();
        
        if (!trimmed) continue;

        // Slash commands
        if (trimmed.toLowerCase() === '/exit') {
            console.log('\x1b[35mGoodbye! \u2728\x1b[0m');
            break;
        }
        
        if (trimmed.toLowerCase() === '/clear') {
            messages = [{ role: 'system', content: systemPrompt }];
            console.clear();
            console.log('\x1b[32mConversation cleared.\x1b[0m\n');
            continue;
        }

        if (trimmed.toLowerCase() === '/history') {
            console.log('\n\x1b[36m--- Conversation History ---\x1b[0m');
            messages.forEach(m => {
                console.log(`\x1b[33m[${m.role}]\x1b[0m ${m.content.slice(0, 100)}${m.content.length > 100 ? '...' : ''}`);
            });
            console.log('\x1b[36m----------------------------\x1b[0m\n');
            continue;
        }

        if (trimmed.toLowerCase().startsWith('/config')) {
            const args = trimmed.split(' ').slice(1);
            if (args.length === 0) {
                const cfg = loadConfig();
                console.log('\x1b[36mCurrent Config:\x1b[0m', cfg);
            } else if (args.length === 2) {
                setConfigValue(args[0], args[1]);
                console.log(`\x1b[32m\u2713 Config updated:\x1b[0m ${args[0]} = ${args[1]}`);
            } else {
                console.log('Usage: /config [key] [value]');
            }
            continue;
        }

        if (trimmed.toLowerCase().startsWith('/model')) {
            const args = trimmed.split(' ').slice(1);
            if (args.length === 1) {
                setConfigValue('model', args[0]);
                console.log(`\x1b[32m\u2713 Model updated to:\x1b[0m ${args[0]}`);
            } else {
                console.log(`Current model: ${getConfigValue('model')}`);
            }
            continue;
        }

        messages.push({ role: 'user', content: `[CWD: ${process.cwd()}]\n${trimmed}` });
        
        let isProcessing = true;
        
        while (isProcessing) {
            const thinkingSpinner = createSpinner('AI is thinking...', { color: 'cyan' }).start();
            
            try {
                const configUrl = getConfigValue('api-url');
                const apiUrl = process.env.HUNTERSTAR_API_URL || configUrl || 'https://api.hunterstar.uz';
                const endpoint = apiUrl.endsWith('/api/cli-chat') ? apiUrl : `${apiUrl}/api/cli-chat`;
                
                if (verbose) {
                    thinkingSpinner.stop();
                    console.log(`\x1b[90m[DEBUG] API URL: ${endpoint}\x1b[0m`);
                    console.log(`\x1b[90m[DEBUG] Requesting...\x1b[0m`);
                    thinkingSpinner.start();
                }

                const fetchReq = await import('node-fetch').then(m => m.default).catch(() => fetch);
                const response = await fetchReq(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages,
                        platform: platformInfo.os,
                        shell: platformInfo.shell,
                        commandSeparator: platformInfo.commandSeparator
                    })
                });
                
                let data;
                const contentType = response.headers.get('content-type') || '';
                
                if (contentType.includes('application/json')) {
                    data = await response.json();
                } else {
                    const rawText = await response.text();
                    thinkingSpinner.fail('AI request failed');
                    console.log(`\n\x1b[31mAPI Error (${response.status}):\x1b[0m The server returned an unexpected response (not JSON).`);
                    if (verbose) {
                        console.log(`\x1b[90m[DEBUG] Response preview: ${rawText.slice(0, 150).replace(/\\n/g, ' ')}...\x1b[0m`);
                    }
                    console.log(`\x1b[33mHint:\x1b[0m Please verify that your API URL is correct and the server is running.\n`);
                    messages.pop(); // Remove user message on failure
                    isProcessing = false;
                    import('../analytics.js').then(m => m.reportErrorToTelegram(`Status: ${response.status}\nPreview: ${rawText.slice(0, 500)}`, 'AI Chat API Error (Non-JSON)'));
                    continue;
                }

                thinkingSpinner.stop();
                
                if (response.ok && data.ok) {
                    const rawContent = data.data.choices[0].message.content;
                    const aiMsg = rawContent ? String(rawContent) : '';
                    messages.push({ role: 'assistant', content: aiMsg });
                    
                    if (verbose) {
                        console.log(`\x1b[90m[DEBUG] Raw AI Response length: ${aiMsg.length}\x1b[0m`);
                    }

                    // 1. Check for XML tool call (e.g. <dots_function_call> or <invoke>)
                    const toolCall = parseToolCall(aiMsg, platformInfo);

                    // 2. Check for explicit [EXEC] request
                    const execMatch = !toolCall ? aiMsg.match(/\[EXEC\]([\s\S]*?)\[\/EXEC\]/) : null;
                    
                    // 3. Check for markdown code blocks (as suggestions)
                    const mdCommandMatch = (!toolCall && !execMatch) ? aiMsg.match(/```(?:bash|cmd|powershell|sh)\n([\s\S]*?)\n```/) : null;

                    let normalText = '';
                    let commandToRun = null;
                    let isSuggestion = false;

                    if (toolCall) {
                        normalText = cleanAiDisplayText(aiMsg);
                        if (toolCall.isSupported && toolCall.command) {
                            commandToRun = toolCall.command.trim();
                            if (verbose) console.log(`\x1b[90m[DEBUG] Execution detected: yes (Tool call: ${toolCall.toolName})\x1b[0m`);
                        } else {
                            if (verbose) console.log(`\x1b[90m[DEBUG] Unsupported tool call: ${toolCall.toolName}\x1b[0m`);
                            if (normalText) {
                                console.log(`\n\x1b[35m${HUNTERSTAR_LOGO} Hunterstar AI:\x1b[0m\n\n${renderMarkdown(normalText)}\n`);
                            }
                            messages.push({
                                role: 'user',
                                content: `[SYSTEM NOTICE] Tool '${toolCall.toolName}' is not supported. Please execute shell commands directly using [EXEC]command[/EXEC].`
                            });
                            continue;
                        }
                    } else if (execMatch) {
                        commandToRun = execMatch[1].trim();
                        normalText = cleanAiDisplayText(aiMsg);
                        if (verbose) console.log('\x1b[90m[DEBUG] Execution detected: yes ([EXEC] block)\x1b[0m');
                    } else if (mdCommandMatch) {
                        commandToRun = mdCommandMatch[1].trim();
                        normalText = aiMsg;
                        if (verbose) console.log('\x1b[90m[DEBUG] Markdown command suggestion detected.\x1b[0m');
                        isSuggestion = true;
                    } else {
                        normalText = cleanAiDisplayText(aiMsg);
                    }

                    if (normalText) {
                        console.log(`\n\x1b[35m${HUNTERSTAR_LOGO} Hunterstar AI:\x1b[0m\n\n${renderMarkdown(normalText)}\n`);
                    }

                    if (commandToRun) {
                        if (noExec) {
                            console.log(`\x1b[33m[NO-EXEC]\x1b[0m AI wants to execute: \x1b[36m${commandToRun}\x1b[0m`);
                            isProcessing = false;
                            continue;
                        }

                        if (isSuggestion) {
                            console.log(`\n\x1b[33m\u2753 The AI suggested this command:\x1b[0m`);
                        } else {
                            console.log(`\n\x1b[33m\u26A1 Hunterstar AI requested to execute:\x1b[0m`);
                        }
                        
                        const cmdLines = commandToRun.split('\n').map(l => l.trim()).filter(Boolean);
                        if (!verbose && (cmdLines.length > 2 || commandToRun.length > 150)) {
                            console.log(`  \x1b[36m${cmdLines[0]}\x1b[0m \x1b[90m(+ ${cmdLines.length > 1 ? cmdLines.length - 1 + ' more lines' : 'content'} hidden. Use --verbose to see full code)\x1b[0m`);
                        } else {
                            console.log(`  \x1b[36m${commandToRun}\x1b[0m`);
                        }
                        
                        let allow = false;
                        if (isDangerousCommand(commandToRun)) {
                            console.log(`\n\x1b[31m\u26A0 WARNING: This command is potentially dangerous!\x1b[0m`);
                            const confirm1 = await askQuestion('\x1b[31mAre you SURE you want to allow this? [y/N]: \x1b[0m');
                            if (confirm1.toLowerCase() === 'y') {
                                const confirm2 = await askQuestion('\x1b[31mPlease type "yes" to confirm execution: \x1b[0m');
                                if (confirm2.toLowerCase() === 'yes') allow = true;
                            }
                        } else {
                            if (turbo && !isSuggestion) {
                                console.log(`\x1b[32m[TURBO]\x1b[0m Auto-approving execution...`);
                                allow = true;
                            } else {
                                const promptText = isSuggestion ? '\x1b[33mRun this command? [y/N]: \x1b[0m' : '\x1b[33mAllow execution? [y/N]: \x1b[0m';
                                const confirm = await askQuestion(promptText);
                                if (confirm.toLowerCase() === 'y') allow = true;
                            }
                        }

                        if (allow) {
                            const spinnerLabel = cmdLines.length > 0 ? (cmdLines[0].length > 60 ? cmdLines[0].slice(0, 57) + '...' : cmdLines[0]) : commandToRun;
                            const spinner = createSpinner(`Executing: ${spinnerLabel}`).start();
                            try {
                                const execOpts = { 
                                    cwd: process.cwd(), 
                                    timeout: 30000, 
                                    windowsHide: true, 
                                    shell: platformInfo.shellPath,
                                    env: { ...process.env, PATH: getExtendedPath(platformInfo) }
                                };
                                const { stdout, stderr } = await execPromise(commandToRun, execOpts);
                                
                                spinner.succeed(`Command succeeded.`);
                                
                                const totalLength = stdout.length + stderr.length;
                                const safeStdout = stdout.length > 1000 ? '... ' + stdout.slice(-1000) : stdout;
                                const safeStderr = stderr.length > 1000 ? '... ' + stderr.slice(-1000) : stderr;
                                
                                if (verbose) {
                                    if (totalLength > 1000) {
                                        console.log(`\x1b[90mOutput was ${totalLength} characters. Showing the last 1,000:\x1b[0m`);
                                    }
                                    console.log(stdout ? safeStdout.trim() : '(No output)');
                                } else {
                                    console.log(`\x1b[90m(Output hidden. Use --verbose to see full logs)\x1b[0m`);
                                }
                                
                                const resultObj = {
                                    command: commandToRun,
                                    exitCode: 0,
                                    success: true,
                                    stdout: safeStdout,
                                    stderr: safeStderr,
                                    truncated: totalLength > 1000
                                };
                                
                                if (verbose) console.log(`\x1b[90m[DEBUG] Exit code: 0\x1b[0m`);

                                const responseText = safeStdout || safeStderr || 'Command succeeded with no output.';
                                const resultPayload = toolCall ? 
`<dots_function_response>
<response name="${toolCall.toolName}">
${responseText}
</response>
</dots_function_response>

[EXECUTION RESULT]
${JSON.stringify(resultObj, null, 2)}`
:
`[EXECUTION RESULT]\n${JSON.stringify(resultObj, null, 2)}`;

                                messages.push({ 
                                    role: 'user', 
                                    content: resultPayload
                                });
                                // Loop continues to send result
                            } catch (execError) {
                                spinner.fail(`Command failed.`);
                                
                                const stdout = execError.stdout || '';
                                const stderr = execError.stderr || '';
                                const totalLength = stdout.length + stderr.length;

                                const safeStdout = stdout.length > 1000 ? '... ' + stdout.slice(-1000) : stdout;
                                const safeStderr = stderr.length > 1000 ? '... ' + stderr.slice(-1000) : stderr;

                                const resultObj = {
                                    command: commandToRun,
                                    exitCode: execError.code || 1,
                                    success: false,
                                    stdout: safeStdout,
                                    stderr: safeStderr,
                                    errorMsg: execError.message,
                                    truncated: totalLength > 1000,
                                    timeout: execError.killed
                                };

                                if (execError.killed) {
                                    console.log('\x1b[31mCommand timed out after 30 seconds.\x1b[0m');
                                } else {
                                    console.log(stderr ? stderr.trim() : execError.message);
                                }

                                if (verbose) console.log(`\x1b[90m[DEBUG] Exit code: ${resultObj.exitCode}\x1b[0m`);

                                const errResponseText = safeStderr || safeStdout || execError.message || `Command failed with exit code ${resultObj.exitCode}.`;
                                const resultPayload = toolCall ? 
`<dots_function_response>
<response name="${toolCall.toolName}">
${errResponseText}
</response>
</dots_function_response>

[EXECUTION RESULT]
${JSON.stringify(resultObj, null, 2)}`
:
`[EXECUTION RESULT]\n${JSON.stringify(resultObj, null, 2)}`;

                                messages.push({ 
                                    role: 'user', 
                                    content: resultPayload
                                });
                            }
                        } else {
                            console.log('\n\x1b[31mCommand denied.\x1b[0m\n');
                            if (!isSuggestion) {
                                const rejectObj = {
                                    command: commandToRun,
                                    approved: false,
                                    reason: "user_denied"
                                };
                                const rejectPayload = toolCall ?
`<dots_function_response>
<response name="${toolCall.toolName}">
Error: User denied execution of this command.
</response>
</dots_function_response>

[EXECUTION RESULT]
${JSON.stringify(rejectObj, null, 2)}`
:
`[EXECUTION RESULT]\n${JSON.stringify(rejectObj, null, 2)}`;

                                messages.push({ 
                                    role: 'user', 
                                    content: rejectPayload
                                });
                            } else {
                                isProcessing = false;
                            }
                        }
                    } else {
                        isProcessing = false; // Break loop, wait for user input
                    }
                } else {
                    console.log(`\n\x1b[31mAPI Error:\x1b[0m ${data?.error || 'Unknown error'}\n`);
                    messages.pop(); // Remove user message on failure
                    isProcessing = false;
                    import('../analytics.js').then(m => m.reportErrorToTelegram(data?.error || 'Unknown API Error', 'AI Chat API Error (Not OK)')).catch(console.error);
                }
            } catch (err) {
                if (typeof thinkingSpinner !== 'undefined' && thinkingSpinner.isSpinning) {
                    thinkingSpinner.fail('AI request failed');
                } else {
                    process.stdout.write('\r\x1b[K');
                }
                console.log(`\n\x1b[31mConnection Error:\x1b[0m Could not reach the API. (${err.message})\n`);
                messages.pop();
                isProcessing = false;
                import('../analytics.js').then(m => m.reportErrorToTelegram(err, 'AI Chat Connection Error')).catch(console.error);
            }
        }
    }
}
