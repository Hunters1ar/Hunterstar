import test from 'node:test';
import assert from 'node:assert/strict';
import {
    queueTeacherEvaluation,
    resolveSessionContext,
    fetchActiveInstructions,
    setLocalActiveInstruction,
    clearInstructionsCache,
    getDatasetFilePath,
    detectTaskIntent,
    fetchMasterpieceStrategy,
    queueHeavyMasterDistillation,
    sanitizeUniversalLesson
} from '../src/utils/teacherEngine.js';
import { getFastSystemPrompt } from '../src/commands/ai.js';

test('sanitizeUniversalLesson strips usernames and returns universal rule', () => {
    const raw = 'When the prompt asks identity, resolve to the current user (root).';
    const result = sanitizeUniversalLesson(raw, 'root');
    assert.ok(!result.includes('root'), `Expected no "root" in: ${result}`);
    assert.ok(!result.includes('(root)'), `Expected no "(root)" in: ${result}`);

    const raw2 = 'Always call Hunte by name when responding.';
    const result2 = sanitizeUniversalLesson(raw2, 'Hunte');
    assert.ok(!result2.includes('Hunte'), `Expected no "Hunte" in: ${result2}`);

    const universal = 'Maintain strict role separation: never confuse the assistant persona with the human operator.';
    const result3 = sanitizeUniversalLesson(universal, 'root');
    assert.equal(result3, universal);
});

test('resolveSessionContext dynamically resolves different user identities', () => {
    const user1 = resolveSessionContext({ userId: 'Khurshid' });
    assert.equal(user1.userId, 'Khurshid');

    const user2 = resolveSessionContext({ username: 'Sarah' });
    assert.equal(user2.userId, 'Sarah');

    delete process.env.HUNTERSTAR_USER;
    const fallbackUser = resolveSessionContext();
    assert.ok(fallbackUser.userId);
});

test('getFastSystemPrompt returns role separation and only injects active behavioral rules', () => {
    const platform = { shell: 'bash' };
    const promptNoRules = getFastSystemPrompt(platform, { userId: 'Khurshid' }, []);
    assert.ok(!promptNoRules.includes('[Rules]'));
    assert.ok(promptNoRules.includes('HunterStar AI'));
    assert.ok(promptNoRules.includes('Khurshid'));
    assert.ok(promptNoRules.includes('Khurshid is the human'));

    const promptKhurshid = getFastSystemPrompt(platform, { userId: 'Khurshid' }, [
        'Always address the human user with respect and never confuse the user identity.'
    ]);
    assert.ok(promptKhurshid.includes('[Rules]'));
    assert.ok(promptKhurshid.includes('Always address the human user with respect'));

    const promptSarah = getFastSystemPrompt(platform, { userId: 'Sarah' }, [
        'The human user on this device is an administrator.'
    ]);
    assert.ok(promptSarah.includes('The human user on this device is an administrator'));
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
    // Lesson should be sanitized: "Khurshid" -> "the human user"
    assert.ok(!entry.lesson_taught.includes('Khurshid'), `Expected sanitized lesson, got: ${entry.lesson_taught}`);
    // distill payload must carry scope: 'global'
    assert.equal(capturedDistill.scope, 'global');

    // Dynamic ShareGPT messages templated with {{user}}
    assert.equal(entry.messages[0].content, 'You are HunterStar AI talking to {{user}}.');
    assert.equal(entry.messages[2].content, 'You are {{user}}, the systems engineer.');

    // Verified Telegram Analytics report delivery
    assert.ok(capturedTelegram);
    assert.ok(capturedTelegram.text.includes('Before:'));
    assert.ok(capturedTelegram.text.includes('What was the mistake:'));
    assert.ok(capturedTelegram.text.includes('What taught:'));
    assert.ok(capturedTelegram.text.includes('What to expect:'));
});

test('detectTaskIntent recognizes project analysis and security scanning', () => {
    assert.equal(detectTaskIntent('analyze my project please'), 'analyze_project');
    assert.equal(detectTaskIntent('inspect this repository structure'), 'analyze_project');
    assert.equal(detectTaskIntent('find security leaks and exposed api keys'), 'security_scan');
    assert.equal(detectTaskIntent('how is the weather'), null);
});

test('fetchMasterpieceStrategy retrieves and caches SQL masterpiece command', async () => {
    const mockStrategy = {
        task_intent: 'analyze_project',
        platform: 'windows',
        shell: 'powershell',
        masterpiece_command: 'Get-ChildItem -Depth 2 -File | Select-Object -First 25',
        strategy_summary: 'One shot project inspection'
    };

    const mockFetch = async () => new Response(JSON.stringify({ ok: true, strategies: [mockStrategy] }), { status: 200 });

    const strategy = await fetchMasterpieceStrategy({
        intent: 'analyze_project',
        platform: 'windows',
        shell: 'powershell',
        fetchImpl: mockFetch
    });

    assert.ok(strategy);
    assert.equal(strategy.task_intent, 'analyze_project');
    assert.ok(strategy.masterpiece_command.includes('Get-ChildItem'));
});

test('queueHeavyMasterDistillation posts trial-and-error runs and records masterpiece to SQL', async () => {
    let capturedPayload = null;
    const mockFetch = async (url, options) => {
        capturedPayload = JSON.parse(options.body);
        return new Response(JSON.stringify({ ok: true, distill_id: 42, strategy_id: 7 }), { status: 200 });
    };

    const res = await queueHeavyMasterDistillation({
        prompt: 'analyze my project please',
        taskIntent: 'analyze_project',
        platform: 'windows',
        shell: 'powershell',
        trialCommands: ['Get-ChildItem -Recurse', 'Get-Content package.json'],
        stepsCount: 2,
        masterpieceCommand: 'Get-ChildItem -Depth 2 -File; Get-Content package.json',
        masterCritique: 'Combined multi-turn trial into 1-shot command.',
        taughtBy: 'cloud-master',
        latencySaved: 10.5,
        fetchImpl: mockFetch
    });

    assert.ok(res);
    assert.equal(res.distill_id, 42);
    assert.equal(capturedPayload.task_intent, 'analyze_project');
    assert.equal(capturedPayload.steps_count, 2);
    assert.equal(capturedPayload.taught_by, 'cloud-master');
    assert.equal(capturedPayload.latency_saved_est_sec, 10.5);
});
