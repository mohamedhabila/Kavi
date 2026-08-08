import {
  clearProviderContextWindowsForTests,
  getProviderContextWindow,
  readAdvertisedContextWindow,
  recordProviderContextWindow,
  hydrateProviderContextWindows,
} from '../../../src/services/context/providerContextWindows';
import { getContextWindow, getWorkingContextWindow } from '../../../src/services/context/tokenCounter';

// Traced on-device. deepseek/deepseek-v4-flash-latest has a real window of 1,050,000, is
// absent from the static table, and fell through to the 128,000 default — a 96,000
// working window, about nine percent of the model. OpenRouter publishes context_length in
// the catalogue model discovery already fetches, and nothing read it.
const DEEPSEEK = 'deepseek/deepseek-v4-flash-latest';

beforeEach(() => {
  clearProviderContextWindowsForTests();
});

describe('a provider figure beats the static table', () => {
  it('falls back to the default for an unlisted model when nothing is advertised', () => {
    expect(getContextWindow(DEEPSEEK)).toBe(128_000);
  });

  it('uses the advertised window once discovery has recorded it', () => {
    recordProviderContextWindow(DEEPSEEK, 1_050_000);

    expect(getContextWindow(DEEPSEEK)).toBe(1_050_000);
  });

  it('widens the working window accordingly', () => {
    const before = getWorkingContextWindow(DEEPSEEK);
    recordProviderContextWindow(DEEPSEEK, 1_050_000);
    const after = getWorkingContextWindow(DEEPSEEK);

    expect(before).toBe(96_000);
    expect(after).toBeGreaterThan(before);
  });

  it('matches the model id case-insensitively', () => {
    recordProviderContextWindow(DEEPSEEK.toUpperCase(), 1_050_000);

    expect(getProviderContextWindow(DEEPSEEK)).toBe(1_050_000);
  });
});

describe('reading the figure out of a catalogue entry', () => {
  it('reads OpenRouter context_length', () => {
    expect(readAdvertisedContextWindow({ id: DEEPSEEK, context_length: 1_050_000 })).toBe(1_050_000);
  });

  it('reads the alternative spellings providers use', () => {
    expect(readAdvertisedContextWindow({ context_window: 200_000 })).toBe(200_000);
    expect(readAdvertisedContextWindow({ max_context_tokens: 32_000 })).toBe(32_000);
    expect(readAdvertisedContextWindow({ top_provider: { context_length: 400_000 } })).toBe(400_000);
  });

  it('accepts a numeric string', () => {
    expect(readAdvertisedContextWindow({ context_length: '128000' })).toBe(128_000);
  });

  it('rejects values that cannot be a context window', () => {
    expect(readAdvertisedContextWindow({ context_length: 0 })).toBeUndefined();
    expect(readAdvertisedContextWindow({ context_length: -5 })).toBeUndefined();
    expect(readAdvertisedContextWindow({ context_length: 12 })).toBeUndefined();
    expect(readAdvertisedContextWindow({ context_length: 99_000_000 })).toBeUndefined();
    expect(readAdvertisedContextWindow({ context_length: 'unknown' })).toBeUndefined();
    expect(readAdvertisedContextWindow({})).toBeUndefined();
    expect(readAdvertisedContextWindow(null)).toBeUndefined();
  });

  it('never lets a junk figure displace the table', () => {
    recordProviderContextWindow(DEEPSEEK, 12);

    expect(getContextWindow(DEEPSEEK)).toBe(128_000);
  });
});

describe('windows persisted with a provider survive a relaunch', () => {
  // Discovery has exactly one caller — the model picker — so on an ordinary launch the
  // in-memory registry is empty and every model resolves through the static table. That
  // is why the on-device trace still read {"source":"table"} after the registry landed.
  it('replays persisted windows into the registry', () => {
    expect(getContextWindow(DEEPSEEK)).toBe(128_000);

    hydrateProviderContextWindows({ [DEEPSEEK]: 1_050_000 });

    expect(getContextWindow(DEEPSEEK)).toBe(1_050_000);
  });

  it('tolerates a provider that has none', () => {
    expect(() => hydrateProviderContextWindows(undefined)).not.toThrow();
    expect(() => hydrateProviderContextWindows({})).not.toThrow();
  });

  it('ignores persisted junk rather than trusting it', () => {
    hydrateProviderContextWindows({ [DEEPSEEK]: 3 });

    expect(getContextWindow(DEEPSEEK)).toBe(128_000);
  });
});
