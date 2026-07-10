import { createHash } from 'node:crypto';

import {
  buildExperienceLearningArtifact,
  type ExperienceLearningArtifact,
  type ExperienceProcedureObservation,
} from '../../src/services/memory/experienceLearningArtifact';

export const STATE_BENCH_ADAPTER_RELEASE = 'v0.8.0';
export const STATE_BENCH_ADAPTER_COMMIT = 'e2c8d7af51ef48fbbea51bb2ce1fb859af36b423';
export const STATE_BENCH_TRAIN_TASKS_PER_DOMAIN = 100;
export const STATE_BENCH_DOMAINS = ['travel', 'customer_support', 'shopping_assistant'] as const;

export type StateBenchDomain = (typeof STATE_BENCH_DOMAINS)[number];

export interface StateBenchTrainingFile {
  name: string;
  content: string;
}

export interface StateBenchLearningArtifact {
  version: 1;
  source: {
    repository: 'https://github.com/microsoft/STATE-Bench';
    release: string;
    commit: string;
    trainOnly: true;
    domains: ReadonlyArray<{
      domain: StateBenchDomain;
      fileCount: number;
      sha256: string;
    }>;
  };
  learning: ExperienceLearningArtifact;
  diagnostics: {
    trajectoryCount: number;
    successfulTrajectoryCount: number;
    failedTrajectoryCount: number;
    toolCallCount: number;
    observationCount: number;
    learnedGroupCount: number;
    insufficientGroupCount: number;
  };
}

type JsonObject = Record<string, unknown>;

interface ObservedToolCall {
  name: string;
  evidenceTerms: string[];
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
}

function exactToolName(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,70}$/u.test(value)) return null;
  return value;
}

function safeEvidenceKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim().toLocaleLowerCase();
  return /^[a-z][a-z0-9_]{0,59}$/u.test(normalized) ? `field:${normalized}` : null;
}

function safeStateValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim().toLocaleLowerCase();
  return /^[a-z][a-z0-9_-]{0,39}$/u.test(normalized) ? `state:${normalized}` : null;
}

function toolEvidenceTerms(result: unknown): string[] {
  const record = asObject(result);
  if (!record) return [];
  const keys = Object.keys(record)
    .map(safeEvidenceKey)
    .filter((key): key is string => key !== null);
  const states = ['status', 'state', 'outcome']
    .map((key) => safeStateValue(record[key]))
    .filter((state): state is string => state !== null);
  return Array.from(new Set([...keys, ...states]))
    .sort()
    .slice(0, 16);
}

function parseConversation(content: string): unknown[] {
  if (content.length === 0 || content.length > 2_000_000) {
    throw new Error('state_bench_training_file_size_invalid');
  }
  const parsed = JSON.parse(content) as unknown;
  const root = asObject(parsed);
  if (!root || !Array.isArray(root.conversation)) {
    throw new Error('state_bench_training_conversation_invalid');
  }
  return root.conversation;
}

function observedToolCalls(conversation: ReadonlyArray<unknown>): ObservedToolCall[] {
  const calls: ObservedToolCall[] = [];
  for (const rawMessage of conversation) {
    const message = asObject(rawMessage);
    if (!message || message.role !== 'assistant') continue;
    if (message.tool_calls === null || message.tool_calls === undefined) continue;
    if (!Array.isArray(message.tool_calls)) {
      throw new Error('state_bench_training_tool_calls_invalid');
    }
    for (const rawCall of message.tool_calls) {
      const call = asObject(rawCall);
      const name = exactToolName(call?.name);
      if (!call || !name || !asObject(call.arguments) || !Object.hasOwn(call, 'result')) {
        throw new Error('state_bench_training_tool_call_invalid');
      }
      calls.push({ name, evidenceTerms: toolEvidenceTerms(call.result) });
    }
  }
  return calls;
}

function trajectorySucceeded(conversation: ReadonlyArray<unknown>): boolean {
  const last = asObject(conversation[conversation.length - 1]);
  return last?.role === 'user' && last.content === '[TASK_DONE]';
}

function observationIdentity(input: {
  procedureId: string;
  preconditionIds: ReadonlyArray<string>;
}): string {
  return JSON.stringify([input.procedureId, [...input.preconditionIds].sort()]);
}

function addObservation(
  byIdentity: Map<string, ExperienceProcedureObservation>,
  observation: ExperienceProcedureObservation,
): void {
  const identity = observationIdentity(observation);
  const prior = byIdentity.get(identity);
  if (!prior) {
    byIdentity.set(identity, observation);
    return;
  }
  byIdentity.set(identity, {
    ...prior,
    evidenceTerms: Array.from(
      new Set([...(prior.evidenceTerms ?? []), ...(observation.evidenceTerms ?? [])]),
    )
      .sort()
      .slice(0, 16),
  });
}

function trajectoryObservations(input: {
  domain: StateBenchDomain;
  fileName: string;
  fileOrdinal: number;
  conversation: ReadonlyArray<unknown>;
  calls: ReadonlyArray<ObservedToolCall>;
}): ExperienceProcedureObservation[] {
  if (!input.calls.length) return [];
  const succeeded = trajectorySucceeded(input.conversation);
  const runId = `statebench-${input.domain}-${input.fileName.replace(/\.json$/u, '')}`;
  const common = {
    runId,
    domainId: input.domain,
    environmentId: `state-bench-${STATE_BENCH_ADAPTER_RELEASE}`,
    outcome: succeeded ? ('success' as const) : ('failure' as const),
    authority: succeeded ? ('verified' as const) : ('tool_observed' as const),
    confidence: succeeded ? 0.9 : 0.82,
    observedAt: input.fileOrdinal,
  };
  const byIdentity = new Map<string, ExperienceProcedureObservation>();
  const first = input.calls[0];
  addObservation(byIdentity, {
    ...common,
    procedureId: `start:${first.name}`,
    preconditionIds: ['phase:task_start'],
    evidenceTerms: first.evidenceTerms,
  });
  for (let index = 1; index < input.calls.length; index += 1) {
    const previous = input.calls[index - 1];
    const current = input.calls[index];
    const procedureId = `transition:${previous.name}>${current.name}`;
    if (procedureId.length > 160) continue;
    addObservation(byIdentity, {
      ...common,
      procedureId,
      preconditionIds: [`tool:${previous.name}`],
      evidenceTerms: current.evidenceTerms,
    });
  }
  const last = input.calls[input.calls.length - 1];
  addObservation(byIdentity, {
    ...common,
    procedureId: `finish:${last.name}`,
    preconditionIds: ['phase:task_end'],
    evidenceTerms: last.evidenceTerms,
  });
  return Array.from(byIdentity.values());
}

function domainDigest(files: ReadonlyArray<StateBenchTrainingFile>): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.name);
    hash.update('\0');
    hash.update(createHash('sha256').update(file.content).digest('hex'));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function validateFiles(
  domain: StateBenchDomain,
  files: ReadonlyArray<StateBenchTrainingFile>,
  allowPartial: boolean,
): void {
  if (!allowPartial && files.length !== STATE_BENCH_TRAIN_TASKS_PER_DOMAIN) {
    throw new Error(`state_bench_${domain}_official_train_count_invalid`);
  }
  if (!files.length || new Set(files.map((file) => file.name)).size !== files.length) {
    throw new Error(`state_bench_${domain}_training_files_invalid`);
  }
  for (const file of files) {
    if (!/^[A-Za-z0-9_.-]+\.json$/u.test(file.name)) {
      throw new Error('state_bench_training_file_name_invalid');
    }
  }
}

export function buildStateBenchLearningArtifact(input: {
  filesByDomain: Readonly<Record<StateBenchDomain, ReadonlyArray<StateBenchTrainingFile>>>;
  release?: string;
  commit?: string;
  allowPartial?: boolean;
}): StateBenchLearningArtifact {
  const release = input.release ?? STATE_BENCH_ADAPTER_RELEASE;
  const commit = input.commit ?? STATE_BENCH_ADAPTER_COMMIT;
  if (!/^v\d+\.\d+\.\d+$/u.test(release) || !/^[a-f0-9]{40}$/u.test(commit)) {
    throw new Error('state_bench_source_identity_invalid');
  }
  const observations: ExperienceProcedureObservation[] = [];
  const domainSources: StateBenchLearningArtifact['source']['domains'][number][] = [];
  let successfulTrajectoryCount = 0;
  let failedTrajectoryCount = 0;
  let toolCallCount = 0;
  let fileOrdinal = 0;
  for (const domain of STATE_BENCH_DOMAINS) {
    const files = [...input.filesByDomain[domain]].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    validateFiles(domain, files, input.allowPartial === true);
    domainSources.push({ domain, fileCount: files.length, sha256: domainDigest(files) });
    for (const file of files) {
      const conversation = parseConversation(file.content);
      const calls = observedToolCalls(conversation);
      if (trajectorySucceeded(conversation)) successfulTrajectoryCount += 1;
      else failedTrajectoryCount += 1;
      toolCallCount += calls.length;
      observations.push(
        ...trajectoryObservations({
          domain,
          fileName: file.name,
          fileOrdinal,
          conversation,
          calls,
        }),
      );
      fileOrdinal += 1;
    }
  }
  const learned = buildExperienceLearningArtifact(observations);
  if (
    learned.diagnostics.invalidObservationCount > 0 ||
    learned.diagnostics.invalidGroupCount > 0 ||
    learned.artifact.records.length === 0
  ) {
    throw new Error('state_bench_learning_artifact_validation_failed');
  }
  return {
    version: 1,
    source: {
      repository: 'https://github.com/microsoft/STATE-Bench',
      release,
      commit,
      trainOnly: true,
      domains: domainSources,
    },
    learning: learned.artifact,
    diagnostics: {
      trajectoryCount: successfulTrajectoryCount + failedTrajectoryCount,
      successfulTrajectoryCount,
      failedTrajectoryCount,
      toolCallCount,
      observationCount: learned.diagnostics.observationCount,
      learnedGroupCount: learned.diagnostics.learnedGroupCount,
      insufficientGroupCount: learned.diagnostics.insufficientGroupCount,
    },
  };
}
