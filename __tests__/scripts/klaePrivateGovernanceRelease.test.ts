import fs from 'fs';
import path from 'path';

const childProcess = require('child_process');

const { validatePrivateKlaeRelease } = require('../../scripts/lib/klaePrivateGovernance');
const {
  createPrivateReleaseFixture,
  removePrivateReleaseFixture,
  savePrivateReleaseFixture,
} = require('../helpers/klaePrivateFixture');

const projectRoot = path.resolve(__dirname, '../..');

describe('private KLAE release governance', () => {
  let fixture: ReturnType<typeof createPrivateReleaseFixture>;
  let gitSpy: jest.SpyInstance;

  function mockCheckout(head = fixture.expected.appCommitSha, status = '') {
    gitSpy.mockImplementation((_command: string, args: string[]) => {
      if (args[0] === 'rev-parse') return `${head}\n`;
      if (args[0] === 'status') return status;
      throw new Error(`Unexpected Git command: ${args.join(' ')}`);
    });
  }

  beforeEach(() => {
    fixture = createPrivateReleaseFixture(projectRoot);
    gitSpy = jest.spyOn(childProcess, 'execFileSync');
    mockCheckout();
  });

  afterEach(() => {
    gitSpy.mockRestore();
    removePrivateReleaseFixture(fixture);
  });

  function validate() {
    return validatePrivateKlaeRelease({
      projectRoot: fixture.projectRoot,
      registryPath: fixture.registryPath,
      expected: fixture.expected,
    });
  }

  it('accepts frozen 40/40/100+ packs with complete longitudinal coverage', () => {
    expect(validate()).toEqual([]);
    expect(fixture.packs.development.cases).toHaveLength(40);
    expect(fixture.packs.locked_validation.cases).toHaveLength(40);
    expect(fixture.packs.sealed_held_out.cases).toHaveLength(100);
  });

  it('binds the release claim to the current clean Kavi checkout', () => {
    mockCheckout('f'.repeat(40));
    expect(validate()).toContain('release.appCommitSha: must equal the current Kavi Git HEAD');

    mockCheckout(fixture.expected.appCommitSha, ' M src/example.ts\n');
    expect(validate()).toContain('release.checkout: Kavi worktree must be clean');
  });

  it('rejects incorrect split counts and non-canonical case ids', () => {
    fixture.packs.development.cases.pop();
    fixture.packs.locked_validation.cases[0].id = 'friendly-case-name';
    savePrivateReleaseFixture(fixture);

    expect(validate()).toEqual(
      expect.arrayContaining([
        expect.stringContaining('development.pack.cases: must NOT have fewer than 40 items'),
        expect.stringContaining('development.pack.cases: count must match its registry descriptor'),
        expect.stringContaining('locked_validation.pack.cases[0].id: must be klae-val-001'),
      ]),
    );
  });

  it('requires every family, actual mode transition, and causally exercised lifecycle band', () => {
    for (const caseEntry of fixture.packs.development.cases) {
      caseEntry.families = caseEntry.families.filter((family: string) => family !== 'delegation');
    }
    const longCase = fixture.packs.development.cases[0];
    for (const step of longCase.steps) {
      if (step.kind === 'user_turn') step.mode = 'forced_agentic';
    }
    longCase.modeTransitions = ['agentic_to_agentic'];
    longCase.steps = longCase.steps.filter(
      (step: { event?: string }) => step.event !== 'provider_change',
    );
    longCase.steps.push({
      id: 'trailing-provider-change',
      kind: 'lifecycle_event',
      at: new Date(Date.parse(longCase.steps.at(-1).at) + 60_000).toISOString(),
      event: 'provider_change',
    });
    savePrivateReleaseFixture(fixture);

    expect(validate()).toEqual(
      expect.arrayContaining([
        'development.pack.cases: must cover KLAE family delegation',
        'development.pack.cases: must exercise mode transition chitchat_to_agentic',
        'development.pack.cases: must exercise mode transition agentic_to_chitchat',
        'development.pack.cases: must cover lifecycle band provider_change',
      ]),
    );
  });

  it('requires opaque personas with 30 interactions across four chronological periods', () => {
    const persona = fixture.packs.development.personas[0];
    persona.id = 'alice';
    persona.caseIds = persona.caseIds.slice(0, 1);
    persona.timePeriods[1].startsAt = persona.timePeriods[0].endsAt;
    savePrivateReleaseFixture(fixture);

    expect(validate()).toEqual(
      expect.arrayContaining([
        expect.stringContaining('development.pack.personas[0].id: must match pattern'),
        'development.pack.personas[0].caseIds: must resolve to at least 30 user interactions',
        expect.stringContaining('must be later than the prior period end'),
        expect.stringContaining('development.pack.personas: must assign case klae-dev-002'),
      ]),
    );
  });

  it('rejects candidate access, contamination, and non-independent held-out custody', () => {
    fixture.registry.contamination = {
      status: 'invalidated',
      reasons: ['candidate inspected restricted gold'],
    };
    const locked = fixture.registry.splits.find(
      (split: { splitKind: string }) => split.splitKind === 'locked_validation',
    );
    const held = fixture.registry.splits.find(
      (split: { splitKind: string }) => split.splitKind === 'sealed_held_out',
    );
    locked.accessReview.candidatePackAccessDetected = true;
    held.custodyOwnerId = fixture.registry.splits[0].custodyOwnerId;
    savePrivateReleaseFixture(fixture, { writePacks: false });

    expect(validate()).toEqual(
      expect.arrayContaining([
        'registry.contamination.status: invalidated registries cannot produce a release',
        'registry.splits.locked_validation.accessReview: candidate access invalidates release eligibility',
        expect.stringContaining(
          'must be separate from registry, candidate, and other split custody',
        ),
      ]),
    );
  });

  it('pins the external baseline identity and evaluator-only structural gold', () => {
    fixture.expected.promptSha256 = 'd'.repeat(64);
    fixture.packs.development.execution.goldExposure = 'candidate_visible';
    savePrivateReleaseFixture(fixture);

    expect(validate()).toEqual(
      expect.arrayContaining([
        'registry.frozenBaseline.promptSha256: does not match the explicit frozen release identity',
        expect.stringContaining(
          'development.pack.execution.goldExposure: must be equal to constant',
        ),
      ]),
    );
  });

  it('fails closed when the registry is missing', () => {
    fs.unlinkSync(fixture.registryPath);

    expect(validate()).toEqual(['release.registry: does not exist']);
  });
});
