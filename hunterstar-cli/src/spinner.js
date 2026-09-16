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

export default {
  HUNTERSTAR_LOGO,
  HUNTERSTAR_LOGO_SINGLE,
  HUNTERSTAR_SPIN_FRAMES,
  hunterstarSpinner,
  createSpinner,
};
