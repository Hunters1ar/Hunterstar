import test from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveSessionContext,
    detectTaskIntent,
    fetchMasterpieceStrategy,
    queueHeavyMasterDistillation
} from '../src/utils/teacherEngine.js';
import { getFastSystemPrompt } from '../src/commands/ai.js';

test('resolveSessionContext dynamically resolves different user identities', () => {
    const user1 = resolveSessionContext({ userId: 'Khurshid' });
    assert.equal(user1.userId, 'Khurshid');

    const user2 = resolveSessionContext({ username: 'Sarah' });
    assert.equal(user2.userId, 'Sarah');

    delete process.env.HUNTERSTAR_USER;
    const fallbackUser = resolveSessionContext();
    assert.ok(fallbackUser.userId);
});

test('getFastSystemPrompt returns a static prompt with no user/shell parroting', () => {
    const prompt = getFastSystemPrompt();
    assert.ok(prompt.includes('HunterStar AI'));
    assert.ok(prompt.includes('debug'));
    assert.ok(!prompt.includes('roleplay'));
    assert.ok(!prompt.includes('tsundere'));
    // No shell or username — prevents 1.5B from parroting identity details
    assert.ok(!prompt.includes('powershell'));
    assert.ok(!prompt.includes('(bash)'));
});

test('detectTaskIntent recognizes project analysis and security scanning', () => {
    assert.equal(detectTaskIntent('analyze my project'), 'analyze_project');
    assert.equal(detectTaskIntent('scan for security vulnerabilities'), 'security_scan');
    assert.equal(detectTaskIntent('just chat'), null);
});

test('fetchMasterpieceStrategy retrieves and caches SQL masterpiece command', async () => {
    const mockFetch = async () => new Response(JSON.stringify({
        strategies: [{ command: 'ls -la', description: 'list files', taught_by: 'cloud-master' }]
    }), { status: 200 });

    const result = await fetchMasterpieceStrategy({ intent: 'analyze_project', fetchImpl: mockFetch });
    assert.ok(result);
    assert.equal(result.command, 'ls -la');
});

test('queueHeavyMasterDistillation posts trial-and-error runs and records masterpiece to SQL', async () => {
    const mockFetch = async () => new Response(JSON.stringify({ ok: true, distill_id: 42 }), { status: 200 });
    const result = await queueHeavyMasterDistillation({
        taskIntent: 'analyze_project',
        masterpieceCommand: 'find . -name "*.js"',
        fetchImpl: mockFetch
    });
    assert.ok(result);
    assert.equal(result.distill_id, 42);
});
