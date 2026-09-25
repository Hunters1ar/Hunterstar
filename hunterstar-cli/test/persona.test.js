import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    STATIC_PERSONA,
    STATIC_PERSONA_SPEC,
    validatePersonaSpec,
    buildPersonaPrompt,
    slugifyPersonaName,
    savePersonaToCache,
    loadPersonaFromCache,
    listCachedPersonas,
    detectPersonaRequest,
    getPersonasDir,
    isValidPersonaCandidate,
    teachPersona,
    generateArchetypeSpec,
    isSpecHighQuality
} from '../src/utils/personaManager.js';
import { getFastSystemPrompt } from '../src/commands/ai.js';

test('STATIC_PERSONA defines a direct, professional full-stack developer persona', () => {
    assert.ok(STATIC_PERSONA.includes('HunterStar AI'));
    assert.ok(STATIC_PERSONA.includes('full-stack developer'));
    assert.ok(STATIC_PERSONA.includes('system administrator'));
    assert.ok(STATIC_PERSONA.includes('direct, concise, and technical'));
    assert.ok(STATIC_PERSONA.split(' ').length < 30, 'Static persona prompt must be under 30 words');
});

test('STATIC_PERSONA_SPEC defines structured professional traits and rules', () => {
    assert.equal(STATIC_PERSONA_SPEC.name, 'Hunterstar AI');
    assert.ok(STATIC_PERSONA_SPEC.traits.some(t => t.includes('full-stack developer')));
    assert.ok(STATIC_PERSONA_SPEC.behavior_rules.some(r => r.includes('direct, concise, and technical')));
    assert.ok(STATIC_PERSONA_SPEC.avoid.some(a => a.includes('fluff') || a.includes('gimmicks')));
});

test('getFastSystemPrompt returns role separation system prompt', () => {
    const prompt = getFastSystemPrompt({ shell: 'bash' }, { userId: 'testUser' });
    assert.ok(prompt.includes('HunterStar AI'));
    assert.ok(prompt.includes('testUser'));
    assert.ok(prompt.includes('write code, debug'));
    assert.ok(!prompt.includes('roleplay'));
    assert.ok(!prompt.includes('tsundere'));
});

test('buildPersonaPrompt returns the static professional persona prompt', () => {
    const prompt = buildPersonaPrompt();
    assert.equal(prompt, STATIC_PERSONA);
});

test('loadPersonaFromCache returns static professional spec', () => {
    const loaded = loadPersonaFromCache('any-name');
    assert.ok(loaded);
    assert.equal(loaded.spec.name, 'Hunterstar AI');
    assert.equal(loaded.metadata.teacher_model, 'static');
});

test('savePersonaToCache writes static persona spec and returns valid path', () => {
    const filePath = savePersonaToCache({});
    assert.ok(fs.existsSync(filePath));
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    assert.equal(content.persona.name, 'Hunterstar AI');
});

test('listCachedPersonas lists the static Hunterstar AI persona', () => {
    const list = listCachedPersonas();
    assert.ok(Array.isArray(list));
    assert.ok(list.some(p => p.name === 'Hunterstar AI'));
});

test('detectPersonaRequest only detects reset commands and ignores roleplay requests', () => {
    assert.deepEqual(detectPersonaRequest('/persona reset'), { isPersona: true, isReset: true, persona: 'Hunterstar AI' });
    assert.deepEqual(detectPersonaRequest('/persona clear'), { isPersona: true, isReset: true, persona: 'Hunterstar AI' });
    assert.deepEqual(detectPersonaRequest('/persona'), { isPersona: true, isReset: true, persona: 'Hunterstar AI' });
    assert.equal(detectPersonaRequest('be a pirate'), null);
    assert.equal(detectPersonaRequest('switch to tsundere'), null);
});

test('teachPersona returns static persona immediately without Heavy teacher LLM', async () => {
    let reasoningLogged = false;
    const res = await teachPersona('pirate', {
        onReasoningToken: () => { reasoningLogged = true; }
    });
    assert.equal(res.name, 'Hunterstar AI');
    assert.equal(res.compiledPrompt, STATIC_PERSONA);
    assert.equal(res.source, 'static');
    assert.equal(reasoningLogged, true);
});

test('generateArchetypeSpec and validatePersonaSpec return static persona spec', () => {
    const archetype = generateArchetypeSpec('custom');
    assert.equal(archetype.name, 'Hunterstar AI');
    const validated = validatePersonaSpec({ name: 'custom' });
    assert.equal(validated.valid, true);
    assert.equal(validated.spec.name, 'Hunterstar AI');
});

test('classifyPromptTier routes greetings and casual prompts to fast tier', async () => {
    const { classifyPromptTier } = await import('../src/utils/aiRouter.js');
    const messages = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: '[CWD: C:\\Users\\Hunte]\nhi' }
    ];
    const res = classifyPromptTier('hi', { messages });
    assert.equal(res.tier, 'fast');
    assert.equal(res.reason, 'Casual chatter / instant banter');
});
