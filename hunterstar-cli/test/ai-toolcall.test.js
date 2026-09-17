import assert from 'assert';
import { detectPlatform } from '../src/utils/platform.js';

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

console.log('Running AI tool call parsing tests...\n');

const platformInfo = detectPlatform();

// Test 1: User's exact glob scenario
const globInput = `I'll help you scan for potential secrets and tokens outside of .env files. Let me start by exploring the directory structure and then search for common patterns.
<dots_function_call>
<invoke name="glob">
<parameter name="pattern">
**/*
</parameter>
</invoke>
</dots_function_call>`;

const globResult = parseToolCall(globInput, platformInfo);
assert.strictEqual(globResult.toolName, 'glob');
assert.strictEqual(globResult.isSupported, true);
assert.ok(globResult.command.includes('Get-ChildItem') || globResult.command.includes('find') || globResult.command.includes('dir'), 'Should generate directory search command');

const globCleanText = cleanAiDisplayText(globInput);
assert.ok(!globCleanText.includes('<dots_function_call>'), 'Should strip <dots_function_call>');
assert.ok(!globCleanText.includes('<invoke'), 'Should strip <invoke>');
assert.strictEqual(
    globCleanText,
    "I'll help you scan for potential secrets and tokens outside of .env files. Let me start by exploring the directory structure and then search for common patterns."
);
console.log('✓ Glob tool call correctly parsed and XML cleanly stripped');

// Test 2: User's exact exec scenario
const execInput = `I apologize for the interruption. Let me continue by searching for common secret patterns in the codebase, excluding .env files as you requested.
<dots_function_call>
<invoke name="exec">
<parameter name="command">grep -rInE '(api_key|api_secret|token|password|secret|-----BEGIN (RSA|EC|DSA|OPENSSH) PRIVATE KEY-----)' . --exclude=.env* | head -n 50</parameter>
</invoke>
</dots_function_call>`;

const execResult = parseToolCall(execInput, platformInfo);
assert.strictEqual(execResult.toolName, 'exec');
assert.strictEqual(execResult.isSupported, true);
assert.strictEqual(
    execResult.command,
    "grep -rInE '(api_key|api_secret|token|password|secret|-----BEGIN (RSA|EC|DSA|OPENSSH) PRIVATE KEY-----)' . --exclude=.env* | head -n 50"
);

const execCleanText = cleanAiDisplayText(execInput);
assert.ok(!execCleanText.includes('<dots_function_call>'), 'Should strip <dots_function_call>');
assert.ok(!execCleanText.includes('<invoke'), 'Should strip <invoke>');
assert.strictEqual(
    execCleanText,
    "I apologize for the interruption. Let me continue by searching for common secret patterns in the codebase, excluding .env files as you requested."
);
console.log('✓ Exec tool call correctly parsed and command extracted');

// Test 3: XML entity decoding
const xmlEntityInput = `<invoke name="exec"><parameter name="command">echo foo &amp;&amp; echo bar &gt; file.txt</parameter></invoke>`;
const xmlEntityResult = parseToolCall(xmlEntityInput, platformInfo);
assert.strictEqual(xmlEntityResult.command, 'echo foo && echo bar > file.txt');
console.log('✓ XML entities correctly decoded in command string');

// Test 4: Pure XML response (no conversational text)
const pureXmlInput = `<dots_function_call><invoke name="exec"><parameter name="command">git status</parameter></invoke></dots_function_call>`;
const pureCleanText = cleanAiDisplayText(pureXmlInput);
assert.strictEqual(pureCleanText, '', 'Clean text should be empty string for pure XML');
console.log('✓ Pure XML produces clean empty display text');

console.log('\nAll AI tool call parsing tests passed successfully! ✨');
