import readline from 'readline';
import { exec } from 'child_process';
import util from 'util';
import { loadConfig, setConfigValue, getConfigValue } from '../utils/configManager.js';

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

export async function startAiChat({ noExec = false, verbose = false, turbo = false } = {}) {
    console.log('\x1b[35mHunterstar AI CLI Initialized (Agent Mode).\x1b[0m');
    console.log('Type \x1b[31m"/exit"\x1b[0m to quit, or \x1b[33m"/clear"\x1b[0m to reset conversation.');
    if (noExec) console.log('\x1b[33m[NO-EXEC MODE ACTIVE]\x1b[0m Command execution is disabled.');
    if (turbo) console.log('\x1b[33m[\u26A1 TURBO MODE ACTIVE]\x1b[0m Safe commands will be auto-executed.\n');
    else console.log();
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

    let messages = [];

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
            rl.close();
            break;
        }
        
        if (trimmed.toLowerCase() === '/clear') {
            messages = [];
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
            process.stdout.write('\x1b[33mAI is thinking...\x1b[0m');
            
            try {
                const configUrl = getConfigValue('api-url');
                const apiUrl = process.env.HUNTERSTAR_API_URL || configUrl || 'https://api.hunterstar.uz';
                const endpoint = apiUrl.endsWith('/api/cli-chat') ? apiUrl : `${apiUrl}/api/cli-chat`;
                
                if (verbose) {
                    process.stdout.write('\r\x1b[K');
                    console.log(`\x1b[90m[DEBUG] API URL: ${endpoint}\x1b[0m`);
                    console.log(`\x1b[90m[DEBUG] Requesting...\x1b[0m`);
                    process.stdout.write('\x1b[33mAI is thinking...\x1b[0m');
                }

                const fetchReq = await import('node-fetch').then(m => m.default).catch(() => fetch);
                const response = await fetchReq(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messages })
                });
                
                let data;
                const contentType = response.headers.get('content-type') || '';
                
                if (contentType.includes('application/json')) {
                    data = await response.json();
                } else {
                    const rawText = await response.text();
                    process.stdout.write('\r\x1b[K'); // Clear thinking line
                    console.log(`\n\x1b[31mAPI Error (${response.status}):\x1b[0m The server returned an unexpected response (not JSON).`);
                    if (verbose) {
                        console.log(`\x1b[90m[DEBUG] Response preview: ${rawText.slice(0, 150).replace(/\\n/g, ' ')}...\x1b[0m`);
                    }
                    console.log(`\x1b[33mHint:\x1b[0m Please verify that your API URL is correct and the server is running.\n`);
                    messages.pop(); // Remove user message on failure
                    isProcessing = false;
                    continue;
                }

                process.stdout.write('\r\x1b[K'); // Clear thinking line
                
                if (response.ok && data.ok) {
                    const rawContent = data.data.choices[0].message.content;
                    const aiMsg = rawContent ? String(rawContent) : '';
                    messages.push({ role: 'assistant', content: aiMsg });
                    
                    if (verbose) {
                        console.log(`\x1b[90m[DEBUG] Raw AI Response length: ${aiMsg.length}\x1b[0m`);
                    }

                    // 1. Check for explicit [EXEC] request
                    const execMatch = aiMsg.match(/\[EXEC\]([\s\S]*?)\[\/EXEC\]/);
                    
                    // 2. Check for markdown code blocks (as suggestions)
                    const mdCommandMatch = !execMatch ? aiMsg.match(/```(?:bash|cmd|powershell|sh)\n([\s\S]*?)\n```/) : null;

                    // Display text before the command
                    let normalText = aiMsg;
                    let commandToRun = null;
                    let isSuggestion = false;

                    if (execMatch) {
                        commandToRun = execMatch[1].trim();
                        normalText = aiMsg.split(/\[EXEC\]/)[0].trim();
                        if (verbose) console.log('\x1b[90m[DEBUG] Execution detected: yes ([EXEC] block)\x1b[0m');
                    } else if (mdCommandMatch) {
                        commandToRun = mdCommandMatch[1].trim();
                        if (verbose) console.log('\x1b[90m[DEBUG] Markdown command suggestion detected.\x1b[0m');
                        isSuggestion = true;
                    }

                    if (normalText) {
                        console.log(`\n\x1b[35mHunterstar AI:\x1b[0m\n\n${renderMarkdown(normalText)}\n`);
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
                        
                        console.log(`  \x1b[36m${commandToRun}\x1b[0m`);
                        
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
                            console.log('\n\x1b[32mExecuting...\x1b[0m');
                            try {
                                const { stdout, stderr } = await execPromise(commandToRun, { cwd: process.cwd(), timeout: 30000, windowsHide: true });
                                
                                const totalLength = stdout.length + stderr.length;
                                const safeStdout = stdout.length > 1000 ? '... ' + stdout.slice(-1000) : stdout;
                                const safeStderr = stderr.length > 1000 ? '... ' + stderr.slice(-1000) : stderr;
                                
                                console.log(`\x1b[32m\u2713 Command succeeded.\x1b[0m`);
                                if (totalLength > 1000) {
                                    console.log(`\x1b[90mOutput was ${totalLength} characters. Showing the last 1,000:\x1b[0m`);
                                }
                                console.log(stdout ? stdout.trim() : '(No output)');
                                
                                const resultObj = {
                                    command: commandToRun,
                                    exitCode: 0,
                                    success: true,
                                    stdout: safeStdout,
                                    stderr: safeStderr,
                                    truncated: totalLength > 1000
                                };
                                
                                if (verbose) console.log(`\x1b[90m[DEBUG] Exit code: 0\x1b[0m`);

                                messages.push({ 
                                    role: 'user', 
                                    content: `[EXECUTION RESULT]\n${JSON.stringify(resultObj, null, 2)}`
                                });
                                // Loop continues to send result
                            } catch (execError) {
                                console.log(`\x1b[31m\u2717 Command failed.\x1b[0m`);
                                
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

                                messages.push({ 
                                    role: 'user', 
                                    content: `[EXECUTION RESULT]\n${JSON.stringify(resultObj, null, 2)}`
                                });
                            }
                        } else {
                            console.log('\n\x1b[31mCommand denied.\x1b[0m\n');
                            if (!isSuggestion) {
                                // If it was an explicit EXEC, tell the AI it was denied
                                const rejectObj = {
                                    command: commandToRun,
                                    approved: false,
                                    reason: "user_denied"
                                };
                                messages.push({ 
                                    role: 'user', 
                                    content: `[EXECUTION RESULT]\n${JSON.stringify(rejectObj, null, 2)}`
                                });
                            } else {
                                // If it was just a markdown suggestion and user didn't run it, just wait for user input
                                isProcessing = false;
                            }
                        }
                    } else {
                        isProcessing = false; // Break loop, wait for user input
                    }
                } else {
                    console.log(`\n\x1b[31mAPI Error:\x1b[0m ${data.error || 'Unknown error'}\n`);
                    messages.pop(); // Remove user message on failure
                    isProcessing = false;
                }
            } catch (err) {
                process.stdout.write('\r\x1b[K');
                console.log(`\n\x1b[31mConnection Error:\x1b[0m Could not reach the API. (${err.message})\n`);
                messages.pop();
                isProcessing = false;
            }
        }
    }
}
