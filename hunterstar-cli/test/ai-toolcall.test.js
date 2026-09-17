import assert from 'assert';
import { detectPlatform } from '../src/utils/platform.js';

import { parseToolCall, cleanAiDisplayText } from '../src/commands/ai.js';

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
