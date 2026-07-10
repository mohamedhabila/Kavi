import { spawnSync } from 'child_process';
import path from 'path';

const {
  EVALUATION_SCHEMA_URL,
  checkEvaluationContract,
  loadEvaluationContract,
  loadEvaluationSchema,
  validateEvaluationContract,
} = require('../../scripts/lib/evaluationContract');
const { validateEvaluationRunManifest } = require('../../scripts/lib/evaluationRunManifest');

const projectRoot = path.resolve(__dirname, '../..');
const digest = 'b'.repeat(64);
const commitSha = 'a'.repeat(40);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validRunManifest() {
  return {
    $schema: EVALUATION_SCHEMA_URL,
    kind: 'evaluation_run',
    schemaVersion: '1.0.0',
    runId: 'memory-smoke-2026-07-10',
    generatedAt: '2026-07-10T12:00:00.000Z',
    evaluation: {
      id: 'memory-smoke',
      lane: 'product_native',
      protocolConformance: 'product_native',
      verificationLabel: 'local_only',
      profileId: 'oss-reference',
      splitKind: 'development',
      status: 'passed',
      statusReason: null,
    },
    source: {
      app: {
        repositoryUrl: 'https://github.com/mohamedhabila/Kavi',
        commitSha,
        dirty: false,
      },
      upstream: {
        status: 'not_applicable',
      },
    },
    inputs: {
      datasets: [
        {
          id: 'memory-fixtures',
          split: 'development',
          sha256: digest,
          redistributable: true,
        },
      ],
      configurations: [{ id: 'evaluation-contract', sha256: digest }],
      prompts: [],
    },
    models: [
      {
        role: 'assistant',
        capabilityClass: 'deterministic_fixture',
        provider: 'local',
        model: 'deterministic-fixture',
        revision: null,
        endpointSha256: null,
      },
    ],
    environment: {
      host: {
        os: 'linux',
        arch: 'x64',
        nodeVersion: 'v22.0.0',
      },
      device: {
        status: 'not_applicable',
      },
    },
    trials: {
      index: 1,
      count: 1,
      seeds: ['fixture-seed'],
      temperature: null,
      maxRetries: 0,
    },
    pricing: {
      status: 'not_applicable',
      estimatedCostUsd: 0,
    },
    command: {
      argv: ['npm', 'run', 'eval:memory'],
    },
    scenarioCounts: {
      requested: 1,
      executed: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
    },
    metrics: {
      pass_at_1: 1,
      task_completion: 1,
    },
    failures: [],
    artifacts: [
      {
        role: 'report',
        path: 'reports/memory-smoke.json',
        sha256: digest,
        visibility: 'public',
        mediaType: 'application/json',
      },
    ],
  };
}

describe('evaluation contract', () => {
  const contract = loadEvaluationContract(projectRoot);
  const schema = loadEvaluationSchema(projectRoot);

  it('keeps the checked-in schema and contract synchronized', () => {
    expect(checkEvaluationContract(projectRoot)).toEqual([]);
    expect(validateEvaluationContract(contract, schema)).toEqual([]);
  });

  it('rejects enum drift, duplicates, and weakened claim rules', () => {
    const drifted = clone(contract);
    drifted.verificationLabels = [
      'local_only',
      'local_only',
      'maintainer_reviewed',
      'independently_verified',
      'hidden_test',
    ];
    drifted.claimRules.skippedSatisfiesReleaseGate = true;

    const failures = validateEvaluationContract(drifted, schema);

    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('contract.verificationLabels: must not contain duplicates'),
        expect.stringContaining('contract.verificationLabels: must exactly match the ordered enum'),
        expect.stringContaining('contract.claimRules.skippedSatisfiesReleaseGate: must be false'),
      ]),
    );
  });

  it('accepts one fully specified, keyless, local-only run manifest', () => {
    expect(validateEvaluationRunManifest(validRunManifest(), contract)).toEqual([]);
  });

  it('requires one scalar verification label and truthful skipped evidence', () => {
    const skipped = validRunManifest();
    skipped.evaluation.verificationLabel = ['local_only'] as unknown as string;
    skipped.evaluation.status = 'skipped';
    skipped.evaluation.statusReason = 'provider_credentials_missing';
    skipped.scenarioCounts = {
      requested: 1,
      executed: 0,
      passed: 0,
      failed: 0,
      skipped: 1,
    };
    skipped.metrics = {};
    skipped.artifacts = [];

    const failures = validateEvaluationRunManifest(skipped, contract);

    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('run.evaluation.verificationLabel: must be string'),
      ]),
    );

    skipped.evaluation.verificationLabel = 'local_only';
    expect(validateEvaluationRunManifest(skipped, contract)).toEqual([]);

    skipped.scenarioCounts.executed = 1;
    skipped.scenarioCounts.passed = 1;
    skipped.scenarioCounts.skipped = 0;
    expect(validateEvaluationRunManifest(skipped, contract)).toEqual(
      expect.arrayContaining([expect.stringContaining('a skipped run must not claim execution')]),
    );
  });

  it('requires checksummed inputs and rejects unregistered raw fields', () => {
    const run = validRunManifest();
    delete (run.inputs.datasets[0] as Partial<(typeof run.inputs.datasets)[number]>).sha256;
    (run as typeof run & { rawError?: string }).rawError = 'private provider response';

    expect(validateEvaluationRunManifest(run, contract)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("run: must NOT have additional properties"),
        expect.stringContaining("run.inputs.datasets[0]: must have required property 'sha256'"),
      ]),
    );
  });

  it('does not convert missing hosted pricing into zero cost', () => {
    const run = validRunManifest();
    run.models[0] = {
      role: 'assistant',
      capabilityClass: 'hosted_tool_capable',
      provider: 'provider',
      model: 'model',
      revision: '2026-07-10',
      endpointSha256: digest,
    };
    run.pricing = {
      status: 'missing',
      estimatedCostUsd: 0,
    } as unknown as typeof run.pricing;

    expect(validateEvaluationRunManifest(run, contract)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('estimatedCostUsd: must be null when pricing is missing'),
      ]),
    );

    run.pricing = { status: 'not_applicable', estimatedCostUsd: 0 };
    expect(validateEvaluationRunManifest(run, contract)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('cannot be not_applicable for a hosted model'),
      ]),
    );
  });

  it('requires clean app and upstream revisions for official candidates', () => {
    const run = validRunManifest();
    run.evaluation.lane = 'official_candidate';
    run.evaluation.protocolConformance = 'adapted';
    run.evaluation.splitKind = 'public_benchmark';
    run.source.app.dirty = true;

    expect(validateEvaluationRunManifest(run, contract)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('must be official for an official candidate'),
        expect.stringContaining('run.source.app.dirty: must be false'),
        expect.stringContaining('run.source.upstream.status: must be recorded'),
      ]),
    );

    run.evaluation.protocolConformance = 'official';
    run.source.app.dirty = false;
    run.source.upstream = {
      status: 'recorded',
      repositoryUrl: 'https://github.com/example/upstream',
      commitSha,
      dirty: false,
    } as typeof run.source.upstream;

    expect(validateEvaluationRunManifest(run, contract)).toEqual([]);
  });

  it('rejects private paths, credentials, and raw endpoint URLs', () => {
    const run = validRunManifest();
    run.command.argv.push(['sk', 'proj', 'A'.repeat(32)].join('-'));
    run.command.argv.push('--base-url=https://private.example.test/v1');
    run.artifacts[0].path = '/tmp/private-report.json';
    run.models[0].model = '/private/models/local.gguf';

    expect(validateEvaluationRunManifest(run, contract)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('run.command.argv[3]: must not contain a credential'),
        expect.stringContaining('run.command.argv[4]: must not contain a raw URL'),
        expect.stringContaining('run.artifacts[0].path: must be a normalized relative path'),
        expect.stringContaining('run.models[0].model: must be an identifier'),
      ]),
    );
  });

  it('provides a keyless check command for contributors and CI', () => {
    const result = spawnSync(process.execPath, ['./scripts/check-evaluation-contract.js'], {
      cwd: projectRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Canonical evaluation schema and contract are valid');
    expect(result.stderr).toBe('');
  });
});
