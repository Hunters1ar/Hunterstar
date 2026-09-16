import assert from 'assert';
import stringWidth from 'string-width';
import {
  HUNTERSTAR_LOGO,
  HUNTERSTAR_LOGO_SINGLE,
  HUNTERSTAR_SPIN_FRAMES,
  hunterstarSpinner,
  createSpinner,
} from '../src/spinner.js';

console.log('Running Hunterstar spinner tests...\n');

// 1. Frame count & interval
assert.strictEqual(HUNTERSTAR_SPIN_FRAMES.length, 24, 'Should have exactly 24 frames');
assert.strictEqual(hunterstarSpinner.interval, 50, 'Spinner interval should be 50ms');

// 2. Codepoints check
for (let i = 0; i < 24; i++) {
  const expectedLeft = 0xE100 + i * 2;
  const expectedRight = expectedLeft + 1;

  assert.strictEqual(
    HUNTERSTAR_SPIN_FRAMES[i],
    String.fromCodePoint(expectedLeft, expectedRight),
    `Frame ${i} does not match expected codepoints 0x${expectedLeft.toString(16)} 0x${expectedRight.toString(16)}`
  );

  assert.strictEqual(
    HUNTERSTAR_SPIN_FRAMES[i].codePointAt(0),
    expectedLeft,
    `Frame ${i} left codepoint mismatch`
  );

  assert.strictEqual(
    HUNTERSTAR_SPIN_FRAMES[i].codePointAt(1),
    expectedRight,
    `Frame ${i} right codepoint mismatch`
  );

  // 3. Width check: Each frame must occupy exactly two terminal cells
  assert.strictEqual(
    stringWidth(HUNTERSTAR_SPIN_FRAMES[i]),
    2,
    `Frame ${i} should have width of 2 cells`
  );
}

// 4. Upright logos
assert.strictEqual(HUNTERSTAR_LOGO, '\uE002\uE003');
assert.strictEqual(stringWidth(HUNTERSTAR_LOGO), 2, 'Upright logo must have width of 2 cells');
assert.strictEqual(HUNTERSTAR_LOGO_SINGLE, '\uE001');

// 5. createSpinner API
const spinner = createSpinner('Testing spinner', { isSilent: true });
assert.ok(spinner, 'createSpinner should return an Ora instance');
assert.strictEqual(spinner.spinner, hunterstarSpinner, 'Ora spinner should be hunterstarSpinner');

console.log('✓ All 24 Hunterstar spinner frames are correct (0xE100 - 0xE12F)');
console.log('✓ Every frame occupies exactly 2 monospace terminal cells');
console.log('✓ Upright logo \\uE002\\uE003 verified');
console.log('✓ createSpinner() API verified successfully');
