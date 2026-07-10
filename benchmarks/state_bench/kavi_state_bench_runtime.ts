#!/usr/bin/env node

import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';

import {
  retrieveExperienceLearnings,
  sanitizeExperienceLearningArtifact,
} from '../../src/services/memory/experienceLearningArtifact';
import {
  buildStateBenchLearningArtifact,
  STATE_BENCH_ADAPTER_COMMIT,
  STATE_BENCH_ADAPTER_RELEASE,
  STATE_BENCH_DOMAINS,
  STATE_BENCH_TRAIN_SHA256,
  STATE_BENCH_TRAIN_TASKS_PER_DOMAIN,
  type StateBenchDomain,
  type StateBenchLearningArtifact,
  type StateBenchTrainingFile,
} from './stateBenchTrainingArtifact';

type Command = 'build' | 'query' | 'inspect';

interface CliArgs {
  command: Command;
  trainDir?: string;
  out?: string;
  artifact?: string;
  query?: string;
  queryStdin: boolean;
  domain?: string;
  topK?: number;
  allowPartial: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const command = argv[2];
  if (command !== 'build' && command !== 'query' && command !== 'inspect') {
    throw new Error('Usage: kavi_state_bench_runtime <build|query|inspect> [options]');
  }
  const args: CliArgs = { command, allowPartial: false, queryStdin: false };
  for (let index = 3; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--allow-partial') {
      args.allowPartial = true;
      continue;
    }
    if (flag === '--query-stdin') {
      args.queryStdin = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`Missing value for ${flag}`);
    index += 1;
    if (flag === '--train-dir') args.trainDir = value;
    else if (flag === '--out') args.out = value;
    else if (flag === '--artifact') args.artifact = value;
    else if (flag === '--query') args.query = value;
    else if (flag === '--domain') args.domain = value;
    else if (flag === '--top-k') {
      const topK = Number(value);
      if (!Number.isSafeInteger(topK)) throw new Error('state_bench_top_k_invalid');
      args.topK = topK;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return args;
}

function requirePath(value: string | undefined, code: string): string {
  if (!value?.trim()) throw new Error(code);
  return resolve(value);
}

function trainingFiles(trainDir: string): Record<StateBenchDomain, StateBenchTrainingFile[]> {
  if (basename(trainDir) !== 'train_task_trajectories') {
    throw new Error('state_bench_train_only_directory_required');
  }
  return Object.fromEntries(
    STATE_BENCH_DOMAINS.map((domain) => {
      const domainDir = join(trainDir, domain);
      const files = readdirSync(domainDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => {
          const path = join(domainDir, entry.name);
          const stat = lstatSync(path);
          if (!stat.isFile() || stat.isSymbolicLink()) {
            throw new Error('state_bench_training_file_type_invalid');
          }
          return { name: entry.name, content: readFileSync(path, 'utf8') };
        });
      return [domain, files];
    }),
  ) as Record<StateBenchDomain, StateBenchTrainingFile[]>;
}

function writeArtifactAtomic(path: string, artifact: StateBenchLearningArtifact): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function exactArtifact(value: unknown): StateBenchLearningArtifact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('state_bench_artifact_invalid');
  }
  const artifact = value as Partial<StateBenchLearningArtifact>;
  if (
    artifact.version !== 1 ||
    artifact.source?.repository !== 'https://github.com/microsoft/STATE-Bench' ||
    artifact.source.release !== STATE_BENCH_ADAPTER_RELEASE ||
    artifact.source.commit !== STATE_BENCH_ADAPTER_COMMIT ||
    artifact.source.trainOnly !== true ||
    !Array.isArray(artifact.source.domains) ||
    artifact.source.domains.length !== STATE_BENCH_DOMAINS.length ||
    !STATE_BENCH_DOMAINS.every((domain) =>
      artifact.source?.domains.some(
        (entry) =>
          entry.domain === domain &&
          Number.isSafeInteger(entry.fileCount) &&
          entry.fileCount === STATE_BENCH_TRAIN_TASKS_PER_DOMAIN &&
          entry.sha256 === STATE_BENCH_TRAIN_SHA256[domain],
      ),
    ) ||
    !sanitizeExperienceLearningArtifact(artifact.learning) ||
    !artifact.diagnostics ||
    !Number.isSafeInteger(artifact.diagnostics.trajectoryCount) ||
    artifact.diagnostics.trajectoryCount <= 0
  ) {
    throw new Error('state_bench_artifact_invalid');
  }
  return artifact as StateBenchLearningArtifact;
}

function readArtifact(path: string): StateBenchLearningArtifact {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 10_000_000) {
    throw new Error('state_bench_artifact_file_invalid');
  }
  return exactArtifact(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

function buildCommand(args: CliArgs): Record<string, unknown> {
  const trainDir = requirePath(args.trainDir, 'state_bench_train_dir_required');
  const out = requirePath(args.out, 'state_bench_artifact_output_required');
  const artifact = buildStateBenchLearningArtifact({
    filesByDomain: trainingFiles(trainDir),
    release: STATE_BENCH_ADAPTER_RELEASE,
    commit: STATE_BENCH_ADAPTER_COMMIT,
    allowPartial: args.allowPartial,
  });
  writeArtifactAtomic(out, artifact);
  return { artifact: out, source: artifact.source, diagnostics: artifact.diagnostics };
}

function queryCommand(args: CliArgs): Record<string, unknown> {
  const artifactPath = requirePath(args.artifact, 'state_bench_artifact_required');
  if (args.query !== undefined && args.queryStdin) {
    throw new Error('state_bench_query_source_ambiguous');
  }
  const rawQuery = args.queryStdin ? readFileSync(0, 'utf8') : args.query;
  const query = rawQuery?.normalize('NFKC').trim();
  if (!query) throw new Error('state_bench_query_required');
  if (!STATE_BENCH_DOMAINS.includes(args.domain as StateBenchDomain)) {
    throw new Error('state_bench_domain_invalid');
  }
  const artifact = readArtifact(artifactPath);
  const learnings = retrieveExperienceLearnings({
    artifact: artifact.learning,
    query,
    domainId: args.domain,
    environmentId: `state-bench-${STATE_BENCH_ADAPTER_RELEASE}`,
    topK: args.topK ?? 3,
  });
  return { learnings };
}

function inspectCommand(args: CliArgs): Record<string, unknown> {
  const artifact = readArtifact(requirePath(args.artifact, 'state_bench_artifact_required'));
  return { source: artifact.source, diagnostics: artifact.diagnostics };
}

function main(): void {
  const args = parseArgs(process.argv);
  const result =
    args.command === 'build'
      ? buildCommand(args)
      : args.command === 'query'
        ? queryCommand(args)
        : inspectCommand(args);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main();
