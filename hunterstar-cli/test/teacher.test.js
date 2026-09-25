import test from 'node:test';
import assert from 'node:assert/strict';
import { queueTeacherEvaluation, getDatasetFilePath } from '../src/utils/teacherEngine.js';

test('queueTeacherEvaluation returns null when prompt or fastResponse is missing', async () => {
    assert.equal(await queueTeacherEvaluation({ prompt: '', fastResponse: 'hi' }), null);
    assert.equal(await queueTeacherEvaluation({ prompt: 'hi', fastResponse: '' }), null);
});

test('queueTeacherEvaluation parses teacher critique and creates dataset entry', async () => {
    let capturedBody = null;
    const mockTeacherResponse = {
        choices: [{
            message: {
                content: JSON.stringify({
                    critique: 'Fast model correctly identified user as Hunte.',
                    ideal_response: 'You are Hunte, the system owner.',
                    quality_score: 9,
                    lesson: null
                })
            }
        }]
    };

    const mockFetch = async (url, options) => {
        if (url.includes('/intelect/distill')) {
            return new Response(JSON.stringify({ ok: true, id: 99 }), { status: 200 });
        }
        capturedBody = JSON.parse(options.body);
        return new Response(JSON.stringify(mockTeacherResponse), { status: 200 });
    };

    const entry = await queueTeacherEvaluation({
        prompt: 'who am i',
        fastResponse: 'You are Hunte.',
        userContext: { username: 'Hunte', cwd: 'C:\\Users\\Hunte', platform: 'win32', shell: 'powershell' },
        heavyApiUrl: 'https://heavy.moonlightsoldiers.xyz/v1/chat/completions',
        apiKey: 'hunterella@152634879man',
        fetchImpl: mockFetch
    });

    assert.ok(entry);
    assert.equal(entry.prompt, 'who am i');
    assert.equal(entry.ideal_response, 'You are Hunte, the system owner.');
    assert.equal(entry.quality_score, 9);
    assert.equal(entry.user_context.username, 'Hunte');
    assert.ok(capturedBody.messages[0].content.includes('Hunte'));
});
