import ora from 'ora';

export const HUNTERSTAR_LOGO = '\uE002\uE003';
export const HUNTERSTAR_LOGO_SINGLE = '\uE001';

export const SPIN_FRAME_COUNT = 24;
export const SPIN_FRAME_START = 0xE100;

export const HUNTERSTAR_SPIN_FRAMES = Array.from(
  { length: SPIN_FRAME_COUNT },
  (_, i) => {
    const left = SPIN_FRAME_START + i * 2;
    return String.fromCodePoint(left, left + 1);
  }
);

export const hunterstarSpinner = {
  interval: 50,
  frames: HUNTERSTAR_SPIN_FRAMES,
};

export function createSpinner(textOrOptions, options = {}) {
  let text;
  let spinnerOptions;

  if (typeof textOrOptions === 'string') {
    text = textOrOptions;
    spinnerOptions = options;
  } else {
    spinnerOptions = textOrOptions || {};
    text = spinnerOptions.text || '';
  }

  return ora({
    text,
    spinner: hunterstarSpinner,
    ...spinnerOptions,
  });
}

export async function playLogoSpin(text = 'HunterStar CLI', rounds = 1, delayMs = 45) {
  if (!process.stdout.isTTY) {
    process.stdout.write(`${HUNTERSTAR_LOGO} ${text}\n`);
    return;
  }
  for (let r = 0; r < rounds; r++) {
    for (let f = 0; f < SPIN_FRAME_COUNT; f++) {
      process.stdout.write(`\r\x1b[36m${HUNTERSTAR_SPIN_FRAMES[f]}\x1b[0m \x1b[1m${text}\x1b[0m`);
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
  process.stdout.write(`\r\x1b[36m${HUNTERSTAR_LOGO}\x1b[0m \x1b[1m${text}\x1b[0m\n`);
}

export const hunterstarTheme = {
  prefix: {
    idle: `\x1b[36m${HUNTERSTAR_LOGO}\x1b[0m`,
    done: `\x1b[36m${HUNTERSTAR_LOGO}\x1b[0m`,
  },
  spinner: hunterstarSpinner,
};

export default {
  HUNTERSTAR_LOGO,
  HUNTERSTAR_LOGO_SINGLE,
  HUNTERSTAR_SPIN_FRAMES,
  hunterstarSpinner,
  createSpinner,
  playLogoSpin,
  hunterstarTheme,
};
