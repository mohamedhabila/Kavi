const { validateCase } = require('./evaluationCasePack');

const REQUIRED_CONCRETE_TRANSITIONS = Object.freeze([
  'chitchat_to_chitchat',
  'chitchat_to_agentic',
  'agentic_to_chitchat',
  'agentic_to_agentic',
]);
const REQUIRED_CONTROL_KINDS = Object.freeze(['positive', 'negative', 'mixed']);
const REQUIRED_HISTORY_BANDS = Object.freeze(['short', 'medium', 'long']);
const REQUIRED_LIFECYCLE_BANDS = Object.freeze([
  'immediate_next_turn',
  'new_conversation',
  'background',
  'kill_relaunch',
  'reboot',
  'offline_window',
  'provider_change',
  'long_elapsed_gap',
]);
const CASE_ID_PREFIX = Object.freeze({
  development: 'klae-dev',
  locked_validation: 'klae-val',
  sealed_held_out: 'klae-held',
});
const IMMEDIATE_TURN_WINDOW_MS = 10 * 60 * 1000;
const LONG_ELAPSED_GAP_MS = 30 * 24 * 60 * 60 * 1000;

function addFailure(failures, location, message) {
  failures.push(`${location}: ${message}`);
}

function forcedMode(mode) {
  if (mode === 'forced_chitchat') return 'chitchat';
  if (mode === 'forced_agentic') return 'agentic';
  return null;
}

function transitionBetween(left, right) {
  const leftMode = forcedMode(left?.mode);
  const rightMode = forcedMode(right?.mode);
  return leftMode && rightMode ? `${leftMode}_to_${rightMode}` : 'either_to_either';
}

function actualModeTransitions(caseEntry) {
  const turns = (caseEntry?.steps ?? []).filter((step) => step?.kind === 'user_turn');
  const transitions = new Set();
  for (let index = 1; index < turns.length; index += 1) {
    transitions.add(transitionBetween(turns[index - 1], turns[index]));
  }
  return transitions;
}

function historyBand(caseEntry) {
  const turnCount = (caseEntry?.steps ?? []).filter((step) => step?.kind === 'user_turn').length;
  if (turnCount >= 2 && turnCount <= 3) return 'short';
  if (turnCount >= 4 && turnCount <= 15) return 'medium';
  if (turnCount >= 16) return 'long';
  return null;
}

function hasUserBeforeAndAfter(steps, event) {
  const eventIndex = steps.findIndex(
    (step) => step?.kind === 'lifecycle_event' && step.event === event,
  );
  return (
    eventIndex > 0 &&
    steps.slice(0, eventIndex).some((step) => step?.kind === 'user_turn') &&
    steps.slice(eventIndex + 1).some((step) => step?.kind === 'user_turn')
  );
}

function hasKillRelaunchBoundary(steps) {
  const killIndex = steps.findIndex(
    (step) => step?.kind === 'lifecycle_event' && step.event === 'app_kill',
  );
  if (killIndex < 1 || !steps.slice(0, killIndex).some((step) => step?.kind === 'user_turn')) {
    return false;
  }
  const relaunchOffset = steps
    .slice(killIndex + 1)
    .findIndex((step) => step?.kind === 'lifecycle_event' && step.event === 'app_relaunch');
  if (relaunchOffset < 0) return false;
  const relaunchIndex = killIndex + relaunchOffset + 1;
  return steps.slice(relaunchIndex + 1).some((step) => step?.kind === 'user_turn');
}

function hasOfflineWindow(steps) {
  const offlineIndex = steps.findIndex(
    (step) => step?.kind === 'lifecycle_event' && step.event === 'network_offline',
  );
  if (offlineIndex < 0) return false;
  if (!steps.slice(0, offlineIndex).some((step) => step?.kind === 'user_turn')) return false;
  const onlineOffset = steps
    .slice(offlineIndex + 1)
    .findIndex((step) => step?.kind === 'lifecycle_event' && step.event === 'network_online');
  if (onlineOffset < 0) return false;
  const onlineIndex = offlineIndex + onlineOffset + 1;
  return (
    steps.slice(offlineIndex + 1, onlineIndex).some((step) => step?.kind === 'user_turn') &&
    steps.slice(onlineIndex + 1).some((step) => step?.kind === 'user_turn')
  );
}

function lifecycleBands(caseEntry) {
  const steps = caseEntry?.steps ?? [];
  const bands = new Set();
  for (let index = 1; index < steps.length; index += 1) {
    const left = steps[index - 1];
    const right = steps[index];
    if (left?.kind === 'user_turn' && right?.kind === 'user_turn') {
      const gap = Date.parse(right.at) - Date.parse(left.at);
      if (Number.isFinite(gap) && gap >= 0 && gap <= IMMEDIATE_TURN_WINDOW_MS) {
        bands.add('immediate_next_turn');
      }
    }
  }

  const turns = steps.filter((step) => step?.kind === 'user_turn');
  for (let index = 1; index < turns.length; index += 1) {
    const gap = Date.parse(turns[index].at) - Date.parse(turns[index - 1].at);
    if (Number.isFinite(gap) && gap >= LONG_ELAPSED_GAP_MS) {
      bands.add('long_elapsed_gap');
    }
  }

  if (hasUserBeforeAndAfter(steps, 'new_conversation')) bands.add('new_conversation');
  if (hasUserBeforeAndAfter(steps, 'app_background')) bands.add('background');
  if (hasUserBeforeAndAfter(steps, 'device_reboot')) bands.add('reboot');
  if (hasUserBeforeAndAfter(steps, 'provider_change')) bands.add('provider_change');
  if (hasKillRelaunchBoundary(steps)) bands.add('kill_relaunch');
  if (hasOfflineWindow(steps)) bands.add('offline_window');
  return bands;
}

function validatePersonaPeriods(persona, index, casesById, failures) {
  const location = `pack.personas[${index}]`;
  const periods = Array.isArray(persona?.timePeriods) ? persona.timePeriods : [];
  const periodIds = new Set();
  let priorEnd = Number.NEGATIVE_INFINITY;
  periods.forEach((period, periodIndex) => {
    if (periodIds.has(period?.id)) {
      addFailure(failures, `${location}.timePeriods`, `contains duplicate id ${period.id}`);
    }
    periodIds.add(period?.id);
    const expectedId = `period-${String(periodIndex + 1).padStart(2, '0')}`;
    if (period?.id !== expectedId) {
      addFailure(failures, `${location}.timePeriods[${periodIndex}].id`, `must be ${expectedId}`);
    }
    const start = Date.parse(period?.startsAt);
    const end = Date.parse(period?.endsAt);
    if (Number.isFinite(start) && Number.isFinite(end) && start >= end) {
      addFailure(failures, `${location}.timePeriods[${periodIndex}]`, 'must start before it ends');
    }
    if (Number.isFinite(start) && start <= priorEnd) {
      addFailure(
        failures,
        `${location}.timePeriods[${periodIndex}].startsAt`,
        'must be later than the prior period end',
      );
    }
    if (Number.isFinite(end)) priorEnd = end;
  });

  const interactions = [];
  for (const caseId of persona?.caseIds ?? []) {
    const caseEntry = casesById.get(caseId);
    if (!caseEntry) {
      addFailure(failures, `${location}.caseIds`, `references unknown case ${caseId}`);
      continue;
    }
    interactions.push(...(caseEntry.steps ?? []).filter((step) => step?.kind === 'user_turn'));
  }
  if (interactions.length < 30) {
    addFailure(failures, `${location}.caseIds`, 'must resolve to at least 30 user interactions');
  }
  interactions.forEach((interaction, interactionIndex) => {
    if (
      interactionIndex > 0 &&
      Date.parse(interaction.at) <= Date.parse(interactions[interactionIndex - 1].at)
    ) {
      addFailure(
        failures,
        `${location}.caseIds`,
        'must order assigned cases into one strictly chronological interaction history',
      );
    }
    const interactionTime = Date.parse(interaction.at);
    const matchingPeriods = periods.filter(
      (period) =>
        interactionTime >= Date.parse(period?.startsAt) &&
        interactionTime <= Date.parse(period?.endsAt),
    );
    if (matchingPeriods.length !== 1) {
      addFailure(
        failures,
        `${location}.timePeriods`,
        `must place interaction ${interaction.id} in exactly one period`,
      );
    }
  });
  periods.forEach((period, periodIndex) => {
    const hasInteraction = interactions.some((interaction) => {
      const at = Date.parse(interaction.at);
      return at >= Date.parse(period?.startsAt) && at <= Date.parse(period?.endsAt);
    });
    if (!hasInteraction) {
      addFailure(
        failures,
        `${location}.timePeriods[${periodIndex}]`,
        'must contain at least one user interaction',
      );
    }
  });
}

function validateLongitudinalPersonas(pack, cases, failures) {
  const personas = Array.isArray(pack?.personas) ? pack.personas : [];
  const casesById = new Map(cases.map((caseEntry) => [caseEntry?.id, caseEntry]));
  const assignedCaseIds = new Set();
  const personaIds = new Set();
  personas.forEach((persona, index) => {
    if (personaIds.has(persona?.id)) {
      addFailure(failures, 'pack.personas', `contains duplicate id ${persona.id}`);
    }
    personaIds.add(persona?.id);
    for (const caseId of persona?.caseIds ?? []) {
      if (assignedCaseIds.has(caseId)) {
        addFailure(failures, 'pack.personas', `assigns case ${caseId} more than once`);
      }
      assignedCaseIds.add(caseId);
    }
    validatePersonaPeriods(persona, index, casesById, failures);
  });
  for (const caseEntry of cases) {
    if (!assignedCaseIds.has(caseEntry?.id)) {
      addFailure(failures, 'pack.personas', `must assign case ${caseEntry.id} to one persona`);
    }
  }
}

function expectedCaseId(splitKind, index) {
  const prefix = CASE_ID_PREFIX[splitKind];
  return prefix ? `${prefix}-${String(index + 1).padStart(3, '0')}` : null;
}

function validateCaseMetadata(caseEntry, index, splitKind, failures) {
  const location = `pack.cases[${index}]`;
  const expectedId = expectedCaseId(splitKind, index);
  if (expectedId && caseEntry?.id !== expectedId) {
    addFailure(failures, `${location}.id`, `must be ${expectedId}`);
  }
  const actual = actualModeTransitions(caseEntry);
  const declared = new Set(caseEntry?.modeTransitions ?? []);
  for (const transition of actual) {
    if (!declared.has(transition)) {
      addFailure(failures, `${location}.modeTransitions`, `must declare actual ${transition}`);
    }
  }
  for (const transition of declared) {
    if (!actual.has(transition)) {
      addFailure(failures, `${location}.modeTransitions`, `must not claim absent ${transition}`);
    }
  }
  if (!historyBand(caseEntry)) {
    addFailure(failures, `${location}.steps`, 'must contain at least two user turns');
  }
}

function validatePrivatePackCoverage(pack, contract, evaluationSchema) {
  const failures = [];
  const cases = Array.isArray(pack?.cases) ? pack.cases : [];
  const ids = new Set();
  cases.forEach((caseEntry, index) => {
    validateCase(caseEntry, index, contract, failures);
    validateCaseMetadata(caseEntry, index, pack?.splitKind, failures);
    if (ids.has(caseEntry?.id)) {
      addFailure(failures, 'pack.cases', `contains duplicate id ${caseEntry.id}`);
    }
    ids.add(caseEntry?.id);
  });
  validateLongitudinalPersonas(pack, cases, failures);

  const coveredFamilies = new Set(cases.flatMap((caseEntry) => caseEntry?.families ?? []));
  for (const family of evaluationSchema?.$defs?.klaeFamily?.enum ?? []) {
    if (!coveredFamilies.has(family)) {
      addFailure(failures, 'pack.cases', `must cover KLAE family ${family}`);
    }
  }

  const coveredTransitions = new Set(cases.flatMap((entry) => [...actualModeTransitions(entry)]));
  for (const transition of REQUIRED_CONCRETE_TRANSITIONS) {
    if (!coveredTransitions.has(transition)) {
      addFailure(failures, 'pack.cases', `must exercise mode transition ${transition}`);
    }
  }

  const coveredControls = new Set(cases.map((caseEntry) => caseEntry?.controlKind));
  for (const controlKind of REQUIRED_CONTROL_KINDS) {
    if (!coveredControls.has(controlKind)) {
      addFailure(failures, 'pack.cases', `must include ${controlKind} controls`);
    }
  }

  const coveredHistory = new Set(cases.map(historyBand).filter(Boolean));
  for (const band of REQUIRED_HISTORY_BANDS) {
    if (!coveredHistory.has(band)) {
      addFailure(failures, 'pack.cases', `must cover ${band} history`);
    }
  }

  const coveredLifecycle = new Set(cases.flatMap((caseEntry) => [...lifecycleBands(caseEntry)]));
  for (const band of REQUIRED_LIFECYCLE_BANDS) {
    if (!coveredLifecycle.has(band)) {
      addFailure(failures, 'pack.cases', `must cover lifecycle band ${band}`);
    }
  }
  return Array.from(new Set(failures));
}

module.exports = {
  CASE_ID_PREFIX,
  REQUIRED_CONCRETE_TRANSITIONS,
  REQUIRED_HISTORY_BANDS,
  REQUIRED_LIFECYCLE_BANDS,
  actualModeTransitions,
  historyBand,
  lifecycleBands,
  validatePrivatePackCoverage,
};
