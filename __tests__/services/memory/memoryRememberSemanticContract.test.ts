jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { memoryRememberArgs, memoryRememberExecution } from '../../helpers/memoryRememberExecution';
import { closeMemoryDb } from '../../../src/services/memory/database';
import { listFacts } from '../../../src/services/memory/facts/queries';
import { decodeMemoryRememberSemanticContract } from '../../../src/services/memory/memoryRememberSemanticContract';
import { executeMemoryRemember } from '../../../src/services/memory/memoryTools';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const MESSAGE_ID = 'message-contract';
const SUBJECT = 'artifacts/e2e-follow-gate.txt';
const VALUE = 'E2E-GATE-FU-42';
const MESSAGE = `Verify \`${SUBJECT}\` holds \`${VALUE}\`.`;

/** A fully valid semanticEvidence object, as a mutable record a test can break. */
function validEvidence(): Record<string, unknown> {
  return {
    ...(memoryRememberArgs({
      userMessageText: MESSAGE,
      subjectRef: { kind: 'named', label: SUBJECT },
      subjectType: 'thing',
      predicate: 'verified_content_of',
      value: VALUE,
    }).semanticEvidence as unknown as Record<string, unknown>),
  };
}

function violationsOf(raw: unknown): string[] {
  const result = decodeMemoryRememberSemanticContract(raw, MESSAGE_ID);
  if (result.ok) throw new Error('expected the contract to be refused');
  return result.violations;
}

describe('decodeMemoryRememberSemanticContract', () => {
  it('decodes a valid named-subject proposal', () => {
    const result = decodeMemoryRememberSemanticContract(validEvidence(), MESSAGE_ID);

    expect(result).toEqual({
      ok: true,
      decoded: {
        proposal: expect.objectContaining({
          subjectRef: { kind: 'named', label: SUBJECT },
          predicate: 'verified_content_of',
          value: VALUE,
          sourceMessageId: MESSAGE_ID,
        }),
        subjectType: 'thing',
      },
    });
  });

  it('names an entity type sent as the subject kind, which the old refusal called an undeclared field', () => {
    // The traced call: every field declared, but kind carried the entity type.
    const raw = { ...validEvidence(), subject: { kind: 'thing', label: SUBJECT, type: 'thing' } };

    expect(violationsOf(raw)).toEqual([
      'subject.kind must be "self" or "named", not "thing"; a subject is {"kind":"self"} or {"kind":"named","label":…,"type":…}',
    ]);
  });

  it('reports missing fields as missing, not as undeclared', () => {
    const raw = validEvidence();
    delete raw.version;
    delete raw.importance;
    delete raw.sensitivity;

    expect(violationsOf(raw)).toEqual([
      'missing required fields: version, importance, sensitivity',
    ]);
  });

  it('reports a named subject without its type', () => {
    const raw = { ...validEvidence(), subject: { kind: 'named', label: SUBJECT } };

    expect(violationsOf(raw)).toEqual(['missing required field: subject.type']);
  });

  it('reports undeclared fields at the root and on a self subject', () => {
    const raw = { ...validEvidence(), evidenceQuote: 'x', subject: { kind: 'self', label: 'me' } };

    expect(violationsOf(raw)).toEqual([
      'undeclared field: evidenceQuote',
      'undeclared field: subject.label',
    ]);
  });

  it('lists every value violation together so one correction can fix them all', () => {
    const raw = {
      ...validEvidence(),
      version: 3,
      importance: 1.5,
      scope: 'forever',
      subject: { kind: 'named', label: ` ${SUBJECT}`, type: 'file' },
    };

    expect(violationsOf(raw)).toEqual([
      'version must be 4',
      'subject.label must be a non-empty string of at most 80 characters with no surrounding whitespace',
      'subject.type must be one of person, place, org, project, thing, concept, event, not "file"',
      'importance must be a number from 0 to 1, not 1.5',
      'scope must be one of global, project, conversation, session, persona, not "forever"',
    ]);
  });

  it('bounds an echoed value so a long rejected string cannot flood the result', () => {
    const raw = { ...validEvidence(), operation: 'x'.repeat(500) };
    const [violation] = violationsOf(raw);

    expect(violation).toMatch(/^operation must be one of record, replace_current, not "x+…$/u);
    expect(violation!.length).toBeLessThan(120);
  });

  it.each([null, [], 'evidence', 4])('refuses a non-object semanticEvidence (%p)', (raw) => {
    expect(violationsOf(raw)).toEqual(['semanticEvidence must be an object']);
  });

  it('refuses an object whose prototype supplies a field', () => {
    const inherited = Object.assign(Object.create({ version: 4 }), validEvidence());
    delete inherited.version;

    expect(violationsOf(inherited)).toEqual(['semanticEvidence must be an object']);
  });
});

describe('memory_remember contract refusal', () => {
  beforeEach(() => {
    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
    resetFactSchemaCacheForTests();
    ensureFactSchema();
    useSettingsStore.setState({ disableLongTermMemory: false });
  });

  afterEach(() => {
    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
  });

  it('tells the model exactly what to change, and writes nothing', () => {
    const result = executeMemoryRemember(
      {
        semanticEvidence: {
          ...validEvidence(),
          subject: { kind: 'thing', label: SUBJECT, type: 'thing' },
        } as never,
      },
      memoryRememberExecution({ userMessageId: MESSAGE_ID, userMessageText: MESSAGE }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'invalid_args',
      error:
        'memory_remember semanticEvidence does not match the declared schema: subject.kind must be "self" or "named", not "thing"; a subject is {"kind":"self"} or {"kind":"named","label":…,"type":…}.',
    });
    expect(listFacts({ includeInvalidated: true })).toEqual([]);
  });

  it('accepts the corrected call', () => {
    const result = executeMemoryRemember(
      { semanticEvidence: validEvidence() as never },
      memoryRememberExecution({ userMessageId: MESSAGE_ID, userMessageText: MESSAGE }),
    );

    expect(result).toMatchObject({ ok: true, status: 'created' });
  });
});
