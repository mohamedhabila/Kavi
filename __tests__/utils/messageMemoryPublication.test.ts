import type {
  MessageMemoryPublication,
  MessageMemoryPublicationDisposition,
} from '../../src/types/message';
import {
  areMessageMemoryPublicationsEqual,
  isMessageMemoryPublication,
  isOpenMessageMemoryPublication,
  isTerminalMessageMemoryPublication,
  normalizeMessageMemoryPublication,
  resolveMessageMemoryPublicationTransition,
} from '../../src/utils/messageMemoryPublication';

const dispositions: readonly MessageMemoryPublicationDisposition[] = [
  null,
  'enqueued',
  'opt_out',
  'ephemeral_thread',
  'withdrawn',
];
const terminalDispositions = dispositions.slice(1) as readonly Exclude<
  MessageMemoryPublicationDisposition,
  null
>[];

function publication(disposition: MessageMemoryPublicationDisposition): MessageMemoryPublication {
  return { version: 1, disposition };
}

describe('message memory publication', () => {
  it.each(dispositions)('normalizes %s and strips fields outside the contract', (disposition) => {
    const value = {
      version: 1,
      disposition,
      jobId: 'must-not-persist',
      sourceContent: 'must-not-persist',
    };

    const normalized = normalizeMessageMemoryPublication(value);

    expect(normalized).toEqual(publication(disposition));
    expect(normalized).not.toBe(value);
    expect(Object.keys(normalized ?? {})).toEqual(['version', 'disposition']);
    expect(isMessageMemoryPublication(value)).toBe(true);
  });

  it.each([
    undefined,
    null,
    [],
    'enqueued',
    {},
    { version: 2, disposition: 'enqueued' },
    { version: 1 },
    { version: 1, disposition: undefined },
    { version: 1, disposition: 'pending' },
    Object.create({ version: 1, disposition: 'enqueued' }),
  ])('rejects invalid publication state %#', (value) => {
    expect(normalizeMessageMemoryPublication(value)).toBeUndefined();
    expect(isMessageMemoryPublication(value)).toBe(false);
  });

  it('compares the complete publication value without conflating missing and open state', () => {
    expect(areMessageMemoryPublicationsEqual(undefined, undefined)).toBe(true);
    expect(areMessageMemoryPublicationsEqual(undefined, publication(null))).toBe(false);
    expect(areMessageMemoryPublicationsEqual(publication(null), publication(null))).toBe(true);
    expect(
      areMessageMemoryPublicationsEqual(publication('enqueued'), publication('withdrawn')),
    ).toBe(false);
  });

  it('classifies only an explicit null disposition as open and every named disposition as terminal', () => {
    expect(isOpenMessageMemoryPublication(undefined)).toBe(false);
    expect(isTerminalMessageMemoryPublication(undefined)).toBe(false);
    expect(isOpenMessageMemoryPublication(publication(null))).toBe(true);
    expect(isTerminalMessageMemoryPublication(publication(null))).toBe(false);

    for (const disposition of terminalDispositions) {
      expect(isOpenMessageMemoryPublication(publication(disposition))).toBe(false);
      expect(isTerminalMessageMemoryPublication(publication(disposition))).toBe(true);
    }
  });

  it.each(dispositions)('allows absent state to become %s', (disposition) => {
    expect(resolveMessageMemoryPublicationTransition(undefined, publication(disposition))).toEqual({
      applied: true,
      changed: true,
      publication: publication(disposition),
    });
  });

  it.each(terminalDispositions)('allows open state to become terminal %s', (disposition) => {
    expect(
      resolveMessageMemoryPublicationTransition(publication(null), publication(disposition)),
    ).toEqual({
      applied: true,
      changed: true,
      publication: publication(disposition),
    });
  });

  it.each(dispositions)('accepts identical %s replay without changing state', (disposition) => {
    const value = publication(disposition);

    expect(resolveMessageMemoryPublicationTransition(value, publication(disposition))).toEqual({
      applied: true,
      changed: false,
      publication: publication(disposition),
    });
  });

  it('allows an enqueued receipt to be withdrawn', () => {
    expect(
      resolveMessageMemoryPublicationTransition(publication('enqueued'), publication('withdrawn')),
    ).toEqual({
      applied: true,
      changed: true,
      publication: publication('withdrawn'),
    });
  });

  const conflictingTransitions = terminalDispositions.flatMap((current) =>
    dispositions
      .filter(
        (requested) =>
          requested !== current && !(current === 'enqueued' && requested === 'withdrawn'),
      )
      .map((requested) => [current, requested] as const),
  );

  it.each(conflictingTransitions)(
    'rejects conflicting %s -> %s transitions',
    (current, requested) => {
      expect(
        resolveMessageMemoryPublicationTransition(publication(current), publication(requested)),
      ).toEqual({
        applied: false,
        changed: false,
        current: publication(current),
        requested: publication(requested),
      });
    },
  );
});
