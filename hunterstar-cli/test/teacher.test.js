import test from 'node:test';
import assert from 'node:assert/strict';
import {
    queueTeacherEvaluation,
    resolveSessionContext,
    fetchActiveInstructions,
    setLocalActiveInstruction,
    clearInstructionsCache,
    getDatasetFilePath
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

test('getFastSystemPrompt dynamically injects active user and learned rules', () => {
    const platform = { shell: 'bash' };
    const promptKhurshid = getFastSystemPrompt(platform, { userId: 'Khurshid' }, [
        'Always address Khurshid by name and never confuse the user identity.'
    ]);
    assert.ok(promptKhurshid.includes('speaking with Khurshid'));
    assert.ok(promptKhurshid.includes('Always address Khurshid by name'));

    const promptSarah = getFastSystemPrompt(platform, { userId: 'Sarah' }, [
        'The human user on this device is Sarah.'
    ]);
    assert.ok(promptSarah.includes('speaking with Sarah'));
    assert.ok(promptSarah.includes('The human user on this device is Sarah'));
});

test('fetchActiveInstructions and setLocalActiveInstruction cache user rules', async () => {
    clearInstructionsCache();
    setLocalActiveInstruction('Sarah', 'Never confuse Sarah with assistant');
    const rules = await fetchActiveInstructions({ userId: 'Sarah' });
    assert.ok(rules.includes('Never confuse Sarah with assistant'));
});

test('queueTeacherEvaluation returns null when prompt or fastResponse is missing', async () => {
    assert.equal(await queueTeacherEvaluation({ prompt: '', fastResponse: 'hi' }), null);
    assert.equal(await queueTeacherEvaluation({ prompt: 'hi', fastResponse: '' }), null);
});

test('queueTeacherEvaluation parses teacher critique and creates dynamic dataset entry', async () => {
    let capturedBody = null;
    let capturedDistill = null;
    let capturedTelegram = null;
    const mockTeacherResponse = {
        choices: [{
            message: {
                content: JSON.stringify({
                    critique: 'Fast model correctly identified user as Khurshid.',
                    ideal_response: 'You are Khurshid, the systems engineer.',
                    quality_score: 9,
                    lesson: 'Always address Khurshid by name.'
                })
            }
        }]
    };

    const mockFetch = async (url, options) => {
        if (url.includes('/intelect/distill')) {
            capturedDistill = JSON.parse(options.body);
            return new Response(JSON.stringify({ ok: true, id: 99, rule_id: 10 }), { status: 200 });
        }
        if (url.includes('api.telegram.org')) {
            capturedTelegram = JSON.parse(options.body);
            return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
        }
        capturedBody = JSON.parse(options.body);
        return new Response(JSON.stringify(mockTeacherResponse), { status: 200 });
    };

    const entry = await queueTeacherEvaluation({
        prompt: 'who am i',
        fastResponse: 'You are Khurshid.',
        userContext: { userId: 'Khurshid', cwd: '/home/khurshid', platform: 'linux', shell: 'bash' },
        heavyApiUrl: 'https://heavy.moonlightsoldiers.xyz/v1/chat/completions',
        apiKey: 'hunterella@152634879man',
        fetchImpl: mockFetch
    });

    assert.ok(entry);
    assert.equal(entry.prompt, 'who am i');
    assert.equal(entry.session_user, 'Khurshid');
    assert.equal(entry.ideal_response, 'You are Khurshid, the systems engineer.');
    assert.equal(entry.score, 9);
    assert.equal(entry.user_context.userId, 'Khurshid');
    assert.ok(capturedBody.messages[0].content.includes('Khurshid'));
    assert.equal(capturedDistill.session_user, 'Khurshid');
    assert.equal(capturedDistill.lesson_taught, 'Always address Khurshid by name.');

    // Dynamic ShareGPT messages templated with {{user}}
    assert.equal(entry.messages[0].content, 'You are HunterStar AI talking to {{user}}.');
    assert.equal(entry.messages[2].content, 'You are {{user}}, the systems engineer.');

    // Verified Telegram Analytics report delivery
    assert.ok(capturedTelegram);
    assert.ok(capturedTelegram.text.includes('Before:'));
    assert.ok(capturedTelegram.text.includes('What was the mistake:'));
    assert.ok(capturedTelegram.text.includes('What taught:'));
    assert.ok(capturedTelegram.text.includes('What to expect:'));
    assert.ok(capturedTelegram.text.includes('Khurshid'));
});
