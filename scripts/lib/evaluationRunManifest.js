const path = require('path');

const {
  EVALUATION_SCHEMA_URL,
  loadEvaluationSchema,
  validateEvaluationContract,
  validateSchemaDefinition,
} = require('./evaluationContract');
const { validateEvaluationCasePack } = require('./evaluationCasePack');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_SCHEMA = loadEvaluationSchema(PROJECT_ROOT);
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const ABSOLUTE_PATH_PATTERN = /(?:^|=)(?:\/|[A-Za-z]:[\\/])/u;
const URL_PATTERN = /https?:\/\//iu;
const SECRET_PATTERN =
  /(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|authorization:\s*bearer)/iu;

function addFailure(failures, location, message) {
  failures.push(`${location}: ${message}`);
}

function duplicateValues(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  });
}

function validateUniqueField(entries, field, location, failures) {
  if (!Array.isArray(entries)) return;
  const values = entries.map((entry) => entry?.[field]).filter((value) => typeof value === 'string');
  if (duplicateValues(values).length > 0) {
    addFailure(failures, location, `must contain unique ${field} values`);
  }
}

function validateSourceAndLane(run, failures) {
  if (run?.evaluation?.lane !== 'official_candidate') return;
  if (run.evaluation.protocolConformance !== 'official') {
    addFailure(
      failures,
      'run.evaluation.protocolConformance',
      'must be official for an official candidate',
    );
  }
  if (run?.source?.app?.dirty !== false) {
    addFailure(failures, 'run.source.app.dirty', 'must be false for an official candidate');
  }
  if (run?.source?.upstream?.status !== 'recorded') {
    addFailure(
      failures,
      'run.source.upstream.status',
      'must be recorded for an official candidate',
    );
  } else if (run.source.upstream.dirty !== false) {
    addFailure(failures, 'run.source.upstream.dirty', 'must be false for an official candidate');
  }
}

function validateTrials(trials, failures) {
  if (!trials || typeof trials !== 'object') return;
  if (
    Number.isInteger(trials.index) &&
    Number.isInteger(trials.count) &&
    trials.index > trials.count
  ) {
    addFailure(failures, 'run.trials.index', 'must not exceed run.trials.count');
  }
  if (Array.isArray(trials.seeds) && trials.seeds.length !== trials.count) {
    addFailure(failures, 'run.trials.seeds', 'must contain exactly one seed per declared trial');
  }
}

function validateModelAndPricing(models, pricing, failures) {
  validateUniqueField(models, 'role', 'run.models', failures);
  if (!Array.isArray(models)) return;
  const remoteClasses = new Set(['hosted_tool_capable', 'openai_compatible']);
  const hasRemoteModel = models.some((model) => remoteClasses.has(model?.capabilityClass));
  if (hasRemoteModel && pricing?.status === 'not_applicable') {
    addFailure(
      failures,
      'run.pricing.status',
      'cannot be not_applicable for a hosted model',
    );
  }
  if (pricing?.status === 'missing' && pricing.estimatedCostUsd !== null) {
    addFailure(
      failures,
      'run.pricing.estimatedCostUsd',
      'must be null when pricing is missing',
    );
  }
  models.forEach((model, index) => {
    const isRemote = remoteClasses.has(model?.capabilityClass);
    if (isRemote && typeof model?.endpointSha256 !== 'string') {
      addFailure(
        failures,
        `run.models[${index}].endpointSha256`,
        'is required for a hosted model',
      );
    }
    if (!isRemote && model?.endpointSha256 !== null) {
      addFailure(
        failures,
        `run.models[${index}].endpointSha256`,
        'must be null for local execution',
      );
    }
    for (const field of ['provider', 'model', 'revision']) {
      const value = model?.[field];
      if (typeof value === 'string' && (URL_PATTERN.test(value) || path.isAbsolute(value))) {
        addFailure(
          failures,
          `run.models[${index}].${field}`,
          'must be an identifier, not a URL or absolute path',
        );
      }
    }
  });
}

function validateCommand(command, failures) {
  if (!Array.isArray(command?.argv)) return;
  command.argv.forEach((argument, index) => {
    if (typeof argument !== 'string') return;
    if (argument.includes('\n') || argument.includes('\r')) {
      addFailure(failures, `run.command.argv[${index}]`, 'must not contain newlines');
    }
    if (ABSOLUTE_PATH_PATTERN.test(argument)) {
      addFailure(failures, `run.command.argv[${index}]`, 'must not contain an absolute path');
    }
    if (SECRET_PATTERN.test(argument)) {
      addFailure(failures, `run.command.argv[${index}]`, 'must not contain a credential');
    }
    if (URL_PATTERN.test(argument)) {
      addFailure(failures, `run.command.argv[${index}]`, 'must not contain a raw URL');
    }
  });
}

function validateScenarioCounts(run, failures) {
  const counts = run?.scenarioCounts;
  if (!counts || typeof counts !== 'object') return;
  const values = ['requested', 'executed', 'passed', 'failed', 'skipped'].map(
    (key) => counts[key],
  );
  if (!values.every(Number.isInteger)) return;
  if (counts.executed !== counts.passed + counts.failed) {
    addFailure(failures, 'run.scenarioCounts.executed', 'must equal passed plus failed');
  }
  if (counts.requested !== counts.executed + counts.skipped) {
    addFailure(failures, 'run.scenarioCounts.requested', 'must equal executed plus skipped');
  }
  const status = run?.evaluation?.status;
  if (status === 'failed' && (counts.executed < 1 || counts.failed < 1)) {
    addFailure(failures, 'run.scenarioCounts', 'a failed run must contain an executed failure');
  }
  if (status === 'skipped' && (counts.executed !== 0 || counts.passed !== 0 || counts.failed !== 0)) {
    addFailure(failures, 'run.scenarioCounts', 'a skipped run must not claim execution');
  }
}

function validateMetricsAndFailures(run, failures) {
  const status = run?.evaluation?.status;
  const metrics = run?.metrics;
  if (metrics && typeof metrics === 'object' && !Array.isArray(metrics)) {
    if (['passed', 'failed'].includes(status) && !Number.isFinite(metrics.pass_at_1)) {
      addFailure(failures, 'run.metrics.pass_at_1', 'is required for an executed run');
    }
    if (
      Number.isFinite(metrics.pass_at_1) &&
      (metrics.pass_at_1 < 0 || metrics.pass_at_1 > 1)
    ) {
      addFailure(failures, 'run.metrics.pass_at_1', 'must be between zero and one');
    }
    if (
      (Object.hasOwn(metrics, 'pass_at_k') || Object.hasOwn(metrics, 'all_pass')) &&
      !Number.isFinite(metrics.pass_at_1)
    ) {
      addFailure(failures, 'run.metrics.pass_at_1', 'must accompany pass_at_k and all_pass');
    }
  }
  if (!Array.isArray(run?.failures)) return;
  if (status === 'passed' && run.failures.length > 0) {
    addFailure(failures, 'run.failures', 'must be empty for a passed run');
  }
  if (['failed', 'error'].includes(status) && run.failures.length === 0) {
    addFailure(failures, 'run.failures', 'must classify a failed or errored run');
  }
  run.failures.forEach((failure, index) => {
    if (Array.isArray(failure?.secondary) && failure.secondary.includes(failure.primary)) {
      addFailure(
        failures,
        `run.failures[${index}].secondary`,
        'must not repeat the primary category',
      );
    }
  });
}

function validateArtifactPaths(artifacts, failures) {
  validateUniqueField(artifacts, 'path', 'run.artifacts', failures);
  if (!Array.isArray(artifacts)) return;
  artifacts.forEach((artifact, index) => {
    if (typeof artifact?.path !== 'string') return;
    const normalized = artifact.path.replace(/\\/gu, '/');
    if (
      path.isAbsolute(artifact.path) ||
      /^[A-Za-z]:/u.test(normalized) ||
      normalized.split('/').includes('..')
    ) {
      addFailure(failures, `run.artifacts[${index}].path`, 'must be a normalized relative path');
    }
  });
}

function validateEvaluationRunManifest(run, contract, schema = DEFAULT_SCHEMA) {
  const failures = validateSchemaDefinition(run, schema, 'evaluationRun', 'run');
  if (run?.$schema !== EVALUATION_SCHEMA_URL) return failures;

  validateSourceAndLane(run, failures);
  validateTrials(run?.trials, failures);
  validateModelAndPricing(run?.models, run?.pricing, failures);
  validateCommand(run?.command, failures);
  validateScenarioCounts(run, failures);
  validateMetricsAndFailures(run, failures);
  validateUniqueField(run?.inputs?.datasets, 'id', 'run.inputs.datasets', failures);
  validateUniqueField(run?.inputs?.configurations, 'id', 'run.inputs.configurations', failures);
  validateUniqueField(run?.inputs?.prompts, 'id', 'run.inputs.prompts', failures);
  validateArtifactPaths(run?.artifacts, failures);

  const registeredMetrics = new Set(contract?.metricIds ?? []);
  for (const metric of Object.keys(run?.metrics ?? {})) {
    if (!registeredMetrics.has(metric) || !SAFE_ID_PATTERN.test(metric)) {
      addFailure(failures, `run.metrics.${metric}`, 'is not a registered metric');
    }
  }
  return Array.from(new Set(failures));
}

function validateEvaluationArtifact(value, contract, schema = DEFAULT_SCHEMA) {
  if (value?.kind === 'evaluation_contract') {
    return validateEvaluationContract(value, schema);
  }
  if (value?.kind === 'evaluation_run') {
    return validateEvaluationRunManifest(value, contract, schema);
  }
  if (value?.kind === 'evaluation_case_pack') {
    return validateEvaluationCasePack(value, contract, schema);
  }
  return [
    'artifact.kind: must be evaluation_contract, evaluation_case_pack, or evaluation_run',
  ];
}

module.exports = {
  validateEvaluationArtifact,
  validateEvaluationRunManifest,
};
