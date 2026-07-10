const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GOVERNANCE_SCHEMA_URL =
  'https://raw.githubusercontent.com/mohamedhabila/Kavi/main/evaluation/klae-private-governance.schema.json';
const ALL_FAMILIES = [
  'durable_profile',
  'preference_application',
  'correction_and_supersession',
  'temporal_reasoning',
  'episodic_continuity',
  'open_loops',
  'procedure_learning',
  'failure_learning',
  'cross_mode_transfer',
  'interference',
  'abstention',
  'appropriate_silence',
  'privacy_and_deletion',
  'multilingual_continuity',
  'multimodal_continuity',
  'lifecycle',
  'delegation',
  'memory_safety',
  'long_task_recovery',
];
const SPLITS = {
  development: {
    count: 40,
    packId: 'klae-development-private-v1',
    prefix: 'klae-dev',
    personaId: `persona-${'a'.repeat(16)}`,
    fileName: 'development.pack.json',
  },
  locked_validation: {
    count: 40,
    packId: 'klae-locked-validation-v1',
    prefix: 'klae-val',
    personaId: `persona-${'b'.repeat(16)}`,
    fileName: 'locked-validation.pack.json',
  },
  sealed_held_out: {
    count: 100,
    packId: 'klae-sealed-held-out-v1',
    prefix: 'klae-held',
    personaId: `persona-${'c'.repeat(16)}`,
    fileName: 'sealed-held-out.pack.json',
  },
};

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function writeJson(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.writeFileSync(filePath, bytes, { mode: 0o600 });
  return sha256(bytes);
}

function modeName(mode) {
  return mode === 'forced_chitchat' ? 'chitchat' : 'agentic';
}

function deriveTransitions(steps) {
  const turns = steps.filter((step) => step.kind === 'user_turn');
  const transitions = new Set();
  for (let index = 1; index < turns.length; index += 1) {
    transitions.add(`${modeName(turns[index - 1].mode)}_to_${modeName(turns[index].mode)}`);
  }
  return [...transitions];
}

function buildLongSteps(clock) {
  const steps = [];
  let userIndex = 0;
  let lifecycleIndex = 0;
  const advance = (minutes) => {
    clock.value = new Date(clock.value.getTime() + minutes * 60 * 1000);
    return clock.value.toISOString();
  };
  const user = (mode, minutes = 1) => {
    userIndex += 1;
    steps.push({
      id: `u-${String(userIndex).padStart(2, '0')}`,
      kind: 'user_turn',
      at: advance(minutes),
      mode,
      message: `Original synthetic longitudinal interaction ${userIndex}.`,
    });
  };
  const lifecycle = (event) => {
    lifecycleIndex += 1;
    steps.push({
      id: `life-${String(lifecycleIndex).padStart(2, '0')}`,
      kind: 'lifecycle_event',
      at: advance(1),
      event,
    });
  };

  user('forced_chitchat');
  user('forced_chitchat');
  lifecycle('new_conversation');
  user('forced_agentic');
  lifecycle('app_background');
  user('forced_chitchat');
  lifecycle('app_kill');
  lifecycle('app_relaunch');
  user('forced_agentic');
  lifecycle('device_reboot');
  user('forced_agentic');
  lifecycle('network_offline');
  user('forced_agentic');
  lifecycle('network_online');
  user('forced_agentic');
  lifecycle('provider_change');
  user('forced_agentic');
  while (userIndex < 13) user('forced_agentic');
  user('forced_agentic', 31 * 24 * 60);
  while (userIndex < 16) user('forced_agentic');
  return steps;
}

function buildSimpleSteps(clock, turnCount, caseIndex) {
  const steps = [];
  for (let index = 0; index < turnCount; index += 1) {
    clock.value = new Date(clock.value.getTime() + 60 * 60 * 1000);
    steps.push({
      id: `u-${String(index + 1).padStart(2, '0')}`,
      kind: 'user_turn',
      at: clock.value.toISOString(),
      mode: caseIndex % 2 === 0 ? 'forced_agentic' : 'forced_chitchat',
      message: `Original synthetic interaction ${caseIndex + 1}.${index + 1}.`,
    });
  }
  return steps;
}

function buildCases(split) {
  const clock = { value: new Date('2025-01-01T00:00:00.000Z') };
  const cases = [];
  for (let index = 0; index < split.count; index += 1) {
    if (index > 0) clock.value = new Date(clock.value.getTime() + 24 * 60 * 60 * 1000);
    const steps =
      index === 0 ? buildLongSteps(clock) : buildSimpleSteps(clock, index === 1 ? 4 : 2, index);
    const lastStep = steps.filter((step) => step.kind === 'user_turn').at(-1);
    cases.push({
      id: `${split.prefix}-${String(index + 1).padStart(3, '0')}`,
      title: `Private synthetic longitudinal case ${index + 1}`,
      controlKind: index === 0 ? 'positive' : index === 1 ? 'negative' : 'mixed',
      families: index === 0 ? ALL_FAMILIES : [ALL_FAMILIES[index % ALL_FAMILIES.length]],
      modeTransitions: deriveTransitions(steps),
      fixtures: [],
      steps,
      assertions: [
        {
          id: 'decision-recorded',
          afterStepId: lastStep.id,
          target: 'turn.probe.decision',
          operator: 'equals',
          expected: true,
        },
      ],
      metricIds: ['pass_at_1', 'memory_utilization'],
    });
  }
  return cases;
}

function buildPersona(split, cases) {
  const interactions = cases.flatMap((caseEntry) =>
    caseEntry.steps.filter((step) => step.kind === 'user_turn'),
  );
  const timePeriods = [];
  for (let index = 0; index < 4; index += 1) {
    const startIndex = Math.floor((interactions.length * index) / 4);
    const endIndex = Math.floor((interactions.length * (index + 1)) / 4) - 1;
    timePeriods.push({
      id: `period-${String(index + 1).padStart(2, '0')}`,
      startsAt: interactions[startIndex].at,
      endsAt: interactions[endIndex].at,
    });
  }
  return {
    id: split.personaId,
    caseIds: cases.map((caseEntry) => caseEntry.id),
    timePeriods,
  };
}

function buildPack(splitKind) {
  const split = SPLITS[splitKind];
  const cases = buildCases(split);
  return {
    $schema: GOVERNANCE_SCHEMA_URL,
    kind: 'klae_private_case_pack',
    schemaVersion: '1.0.0',
    id: split.packId,
    title: `${splitKind} private KLAE pack`,
    lane: 'product_native',
    protocolConformance: 'product_native',
    splitKind,
    visibility: 'private',
    baselineId: 'klae-baseline-2025-01',
    provenance: {
      origin: 'original_synthetic_private_cases',
      redistributable: false,
      containsUserData: false,
      derivedFromBenchmarkItems: false,
    },
    execution: {
      inputExposure: 'chronological_case_inputs_only',
      goldExposure: 'evaluator_only',
      scoring: 'structural_state_assertions',
    },
    personas: [buildPersona(split, cases)],
    cases,
  };
}

function createPrivateReleaseFixture(projectRoot) {
  const privateRoot = path.join(projectRoot, '.private', 'evals');
  fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  const directory = fs.mkdtempSync(path.join(privateRoot, 'klae-governance-test-'));
  const packs = Object.fromEntries(
    Object.keys(SPLITS).map((splitKind) => [splitKind, buildPack(splitKind)]),
  );
  const registry = {
    $schema: GOVERNANCE_SCHEMA_URL,
    kind: 'klae_private_registry',
    schemaVersion: '1.0.0',
    registryState: 'frozen',
    registryId: 'klae-private-registry-v1',
    registryOwnerId: 'registry-custodian',
    candidate: {
      id: 'kavi-candidate',
      maintainerIds: ['candidate-maintainer'],
    },
    frozenBaseline: {
      id: 'klae-baseline-2025-01',
      appCommitSha: 'a'.repeat(40),
      configurationSha256: 'b'.repeat(64),
      promptSha256: 'c'.repeat(64),
      frozenAt: '2024-12-15T00:00:00.000Z',
    },
    contamination: { status: 'clean', reasons: [] },
    splits: Object.entries(SPLITS).map(([splitKind, split], index) => ({
      splitKind,
      packId: split.packId,
      packPath: split.fileName,
      sha256: '0'.repeat(64),
      caseCount: split.count,
      baselineId: 'klae-baseline-2025-01',
      custodyOwnerId: ['development-custodian', 'validation-custodian', 'held-custodian'][index],
      candidateAccessPolicy: ['visible_development', 'results_only', 'prohibited'][index],
      accessReview: {
        reviewerId: ['development-reviewer', 'validation-reviewer', 'held-reviewer'][index],
        reviewedAt: '2025-07-01T00:00:00.000Z',
        candidatePackAccessDetected: splitKind === 'development',
      },
    })),
  };
  const fixture = {
    directory,
    expected: {
      candidateId: registry.candidate.id,
      baselineId: registry.frozenBaseline.id,
      appCommitSha: registry.frozenBaseline.appCommitSha,
      configurationSha256: registry.frozenBaseline.configurationSha256,
      promptSha256: registry.frozenBaseline.promptSha256,
      registrySha256: '',
    },
    packs,
    projectRoot,
    registry,
    registryPath: path.join(directory, 'registry.json'),
  };
  savePrivateReleaseFixture(fixture);
  return fixture;
}

function savePrivateReleaseFixture(fixture, options = {}) {
  if (options.writePacks !== false) {
    for (const descriptor of fixture.registry.splits) {
      const pack = fixture.packs[descriptor.splitKind];
      descriptor.sha256 = writeJson(path.join(fixture.directory, descriptor.packPath), pack);
    }
  }
  fixture.expected.registrySha256 = writeJson(fixture.registryPath, fixture.registry);
}

function removePrivateReleaseFixture(fixture) {
  fs.rmSync(fixture.directory, { recursive: true, force: true });
}

module.exports = {
  SPLITS,
  createPrivateReleaseFixture,
  removePrivateReleaseFixture,
  savePrivateReleaseFixture,
  sha256,
  writeJson,
};
