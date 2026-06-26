import { createInterface } from 'node:readline';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

import type { AgentGoal } from '../../src/engine/goals/types';
import { buildUnifiedMemoryAccessContext } from '../../src/services/memory/memoryAccessGateway';
import { processIngestionTurn } from '../../src/services/memory/turnProcessor';
import { countEpisodes } from '../../src/services/memory/episodes/queries';
import { countFacts, listFacts } from '../../src/services/memory/facts/queries';
import { flattenPromptSections } from '../../src/services/memory/promptAssembly';
import {
  clearStructuredMemory,
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../src/services/memory/schema';
import { closeMemoryDb, getChunkCount } from '../../src/services/memory/sqlite-store';
import type { Message } from '../../src/types/message';

type JsonObject = Record<string, unknown>;

interface RuntimeConfig {
  chunkChars: number;
  chunkOverlapChars: number;
  maxItems: number;
  maxItemChars: number;
  minScore: number;
  conversationId: string;
}

interface RuntimeRequest {
  id?: string;
  op: 'reset' | 'insert' | 'query' | 'stats' | 'shutdown';
  config?: Partial<RuntimeConfig>;
  trajectory?: JsonObject;
  query?: string;
  queryImage?: string | null;
  questionId?: string | null;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  chunkChars: 3600,
  chunkOverlapChars: 320,
  maxItems: 12,
  maxItemChars: 5000,
  minScore: 0.01,
  conversationId: 'longmemeval-v2',
};

const insertedTrajectoryIds = new Set<string>();
let currentConfig: RuntimeConfig = { ...DEFAULT_CONFIG };
let insertCalls = 0;

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function trajectoryId(trajectory: JsonObject, fallback: number): string {
  for (const key of ['id', 'trajectory_id', 'task_id', 'session_id']) {
    const value = asString(trajectory[key]);
    if (value) return value;
  }
  return `trajectory_${fallback}`;
}

function scalarToText(value: unknown): string | null {
  if (typeof value === 'string') return asString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return null;
}

function compactJson(value: unknown, maxChars: number): string {
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxChars) return serialized;
  return `${serialized.slice(0, maxChars - 3)}...`;
}

function compactScalar(value: unknown, maxChars: number): string | number | boolean | null {
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  const text = scalarToText(value);
  if (text === null) return null;
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 3)}...`;
}

function trajectoryMetadata(trajectory: JsonObject, id: string): JsonObject {
  return {
    trajectory_id: id,
    domain: compactScalar(trajectory.domain, 160),
    environment: compactScalar(trajectory.environment, 160),
    goal: compactScalar(trajectory.goal, 600),
    outcome: compactScalar(trajectory.outcome, 160),
    start_url: compactScalar(trajectory.start_url, 500),
  };
}

function stateEvidenceObject(trajectoryIdValue: string, state: JsonObject, fallbackIndex: number): JsonObject {
  return {
    trajectory_id: trajectoryIdValue,
    state_index: state.state_index ?? state.step ?? fallbackIndex,
    url: compactScalar(state.url, 500),
    action: compactScalar(state.action, 800),
    thought: compactScalar(state.thought, 800),
    screenshot: compactScalar(state.screenshot, 500),
    accessibility_tree: compactScalar(state.accessibility_tree, 3200),
  };
}

function buildGraphEvidence(trajectory: JsonObject, id: string): string[] {
  const evidence: string[] = [];
  const pushEvidence = (payload: JsonObject) => {
    evidence.push(`longmemeval:${compactJson(payload, 5000)}`);
  };

  pushEvidence({ kind: 'trajectory', ...trajectoryMetadata(trajectory, id) });
  const states = Array.isArray(trajectory.states) ? trajectory.states : [];
  states.forEach((rawState, index) => {
    if (evidence.length >= 64) return;
    const state = asObject(rawState);
    pushEvidence({ kind: 'state', ...stateEvidenceObject(id, state, index) });
  });
  return evidence;
}

function buildToolMessagesForTrajectory(trajectory: JsonObject, id: string, now: number): Message[] {
  const states = Array.isArray(trajectory.states) ? trajectory.states : [];
  const messages: Message[] = [];
  states.forEach((rawState, index) => {
    const state = asObject(rawState);
    const stateIndex = state.state_index ?? state.step ?? index;
    const toolCallId = `tc-${id}-${index}`;
    messages.push({
      id: `assistant-state-${id}-${index}`,
      role: 'assistant',
      content: '',
      timestamp: now + index * 2 + 1,
      toolCalls: [
        {
          id: toolCallId,
          name: 'longmemeval_state',
          arguments: compactJson({ trajectory_id: id, state_index: stateIndex }, 1000),
          status: 'completed',
        },
      ],
      assistantMetadata: {
        kind: 'intermediate',
        completionStatus: 'complete',
        finishReason: 'tool_calls',
      },
    });
    messages.push({
      id: `tool-state-${id}-${index}`,
      role: 'tool',
      content: compactJson(
        {
          status: 'completed',
          trajectory_id: id,
          state_index: stateIndex,
          url: compactScalar(state.url, 500),
          action: compactScalar(state.action, 800),
          thought: compactScalar(state.thought, 800),
          screenshot: compactScalar(state.screenshot, 500),
        },
        2200,
      ),
      toolCallId,
      timestamp: now + index * 2 + 2,
      toolCalls: [
        {
          id: toolCallId,
          name: 'longmemeval_state',
          arguments: compactJson({ trajectory_id: id, state_index: stateIndex }, 1000),
          status: 'completed',
        },
      ],
    });
  });
  return messages;
}

function buildTrajectoryMessages(trajectory: JsonObject, id: string, now: number): Message[] {
  const metadata = trajectoryMetadata(trajectory, id);
  const toolMessages = buildToolMessagesForTrajectory(trajectory, id, now + 10);
  const finalTimestamp = now + 10 + toolMessages.length + 1;
  return [
    {
      id: `user-${id}`,
      role: 'user',
      content: compactJson(metadata, 2000),
      timestamp: now,
    },
    ...toolMessages,
    {
      id: `assistant-final-${id}`,
      role: 'assistant',
      content: compactJson(
        {
          trajectory_id: id,
          outcome: compactScalar(trajectory.outcome, 500),
          state_count: Array.isArray(trajectory.states) ? trajectory.states.length : 0,
        },
        1600,
      ),
      timestamp: finalTimestamp,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    },
  ];
}

function applyConfig(config?: Partial<RuntimeConfig>): RuntimeConfig {
  if (!config) return currentConfig;
  currentConfig = {
    ...currentConfig,
    ...Object.fromEntries(
      Object.entries(config).filter(([, value]) => value !== undefined && value !== null),
    ),
  };
  currentConfig.chunkChars = Math.max(800, Math.min(20_000, Math.floor(currentConfig.chunkChars)));
  currentConfig.chunkOverlapChars = Math.max(
    0,
    Math.min(currentConfig.chunkChars - 1, Math.floor(currentConfig.chunkOverlapChars)),
  );
  currentConfig.maxItems = Math.max(1, Math.min(50, Math.floor(currentConfig.maxItems)));
  currentConfig.maxItemChars = Math.max(
    200,
    Math.min(20_000, Math.floor(currentConfig.maxItemChars)),
  );
  currentConfig.minScore = Math.max(0, Math.min(1, Number(currentConfig.minScore)));
  currentConfig.conversationId =
    currentConfig.conversationId.trim() || DEFAULT_CONFIG.conversationId;
  return currentConfig;
}

function ensureStore(): void {
  ensureFactSchema();
}

function resetStore(config?: Partial<RuntimeConfig>): JsonObject {
  applyConfig(config);
  closeMemoryDb();
  resetFactSchemaCacheForTests();
  const dbDir = resolve(process.env.KAVI_MEMORY_SQLITE_DIR || process.cwd());
  mkdirSync(dbDir, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(join(dbDir, `kavi-memory.db${suffix}`), { force: true });
  }
  insertedTrajectoryIds.clear();
  insertCalls = 0;
  ensureStore();
  clearStructuredMemory();
  return stats();
}

async function insertTrajectory(
  trajectory: JsonObject,
  config?: Partial<RuntimeConfig>,
): Promise<JsonObject> {
  const resolved = applyConfig(config);
  ensureStore();
  insertCalls += 1;
  const id = trajectoryId(trajectory, insertCalls);
  const now = Date.now();
  const messages = buildTrajectoryMessages(trajectory, id, now);
  const graphGoalEvidence = buildGraphEvidence(trajectory, id);

  insertedTrajectoryIds.add(id);
  const ingestionResult = await processIngestionTurn({
    threadId: resolved.conversationId,
    messages,
    threadTitle: String(trajectory.goal ?? id),
    graphGoalEvidence,
    sourceRunId: id,
    now,
    skipWorkingMemorySync: true,
  });

  return {
    trajectory_id: id,
    bridged_evidence_items: graphGoalEvidence.length,
    ingested_messages: messages.length,
    episode_id: ingestionResult.episodeId,
    deterministic_fact_ids: ingestionResult.deterministicFactIds,
    bridged_evidence_fact_ids: ingestionResult.bridgedEvidenceFactIds,
    total_chunks: getChunkCount(),
    inserted_trajectories: insertedTrajectoryIds.size,
  };
}

function buildQueryMessages(query: string, queryImage: string | null, now: number): Message[] {
  return [
    {
      id: `query-user-${now}`,
      role: 'user',
      content: query,
      timestamp: now,
      ...(queryImage
        ? {
            attachments: [
              {
                id: `query-image-${now}`,
                type: 'image' as const,
                uri: queryImage,
                name: queryImage.split('/').pop() || 'query-image',
                mimeType: 'image/png',
                size: 0,
              },
            ],
          }
        : {}),
    },
  ];
}

function buildQueryGoals(query: string, questionId: string | null, now: number): AgentGoal[] {
  return [
    {
      id: questionId ? `question-${questionId}` : `question-${now}`,
      title: query,
      status: 'active',
      dependencies: [],
      evidence: [],
      createdAt: now,
      updatedAt: now,
      completionPolicy: 'persistent',
    },
  ];
}

function selectedSections(sections: Array<{ text: string }>, maxItemChars: number): JsonObject[] {
  return sections.map((section, index) => {
    const content =
      section.text.length > maxItemChars
        ? `${section.text.slice(0, maxItemChars).trimEnd()}...`
        : section.text;
    return {
      rank: index + 1,
      source: `living_memory/section/${index}`,
      content,
      snippet: content.slice(0, 500),
    };
  });
}

async function queryMemory(request: RuntimeRequest): Promise<JsonObject> {
  const resolved = applyConfig(request.config);
  ensureStore();
  const query = asString(request.query) ?? '';
  if (!query) {
    return { memory_context: [], selected: [], stats: stats() };
  }
  const started = performance.now();

  const now = Date.now();
  const memoryAccess = await buildUnifiedMemoryAccessContext({
    messages: buildQueryMessages(query, request.queryImage ?? null, now),
    conversationId: resolved.conversationId,
    mode: 'agentic',
    recallLimit: resolved.maxItems,
    goals: buildQueryGoals(query, request.questionId ?? null, now),
    now,
  });
  const sections = memoryAccess.livingMemory?.sections ?? [];
  const selected = selectedSections(sections, resolved.maxItemChars);
  const memoryContext = selected.map((item) => ({
    type: 'text',
    value:
      `[Kavi living memory #${item.rank} | source=${item.source}]\n` +
      String(item.content),
  }));
  return {
    memory_context: memoryContext,
    selected,
    flattened_sections: flattenPromptSections(sections),
    recalled_fact_count: memoryAccess.livingMemory?.recalledFactCount ?? 0,
    recalled_episode_count: memoryAccess.livingMemory?.recalledEpisodeCount ?? 0,
    duration_seconds: (performance.now() - started) / 1000,
    question_id: request.questionId ?? null,
    query_image: request.queryImage ?? null,
    stats: stats(),
  };
}

function stats(): JsonObject {
  return {
    db_dir: resolve(process.env.KAVI_MEMORY_SQLITE_DIR || process.cwd()),
    memory_type: 'kavi_memory_isolated',
    inserted_trajectories: insertedTrajectoryIds.size,
    insert_calls: insertCalls,
    chunk_count: getChunkCount(),
    fact_count: countFacts(),
    episode_count: countEpisodes(),
    sample_facts: listFacts({ limit: 5 }).map((fact) => ({
      id: fact.id,
      scope: fact.scope,
      predicate: fact.predicate,
      objectText: fact.objectText,
    })),
    config: currentConfig,
  };
}

async function handleRequest(request: RuntimeRequest): Promise<JsonObject | null> {
  switch (request.op) {
    case 'reset':
      return resetStore(request.config);
    case 'insert':
      if (!request.trajectory) throw new Error('insert requires trajectory');
      return await insertTrajectory(asObject(request.trajectory), request.config);
    case 'query':
      return queryMemory(request);
    case 'stats':
      return stats();
    case 'shutdown':
      closeMemoryDb();
      return null;
    default:
      throw new Error(`Unsupported op: ${(request as { op?: string }).op}`);
  }
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let request: RuntimeRequest;
    try {
      request = JSON.parse(line) as RuntimeRequest;
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
      );
      continue;
    }
    try {
      const result = await handleRequest(request);
      process.stdout.write(`${JSON.stringify({ id: request.id ?? null, ok: true, result })}\n`);
      if (request.op === 'shutdown') break;
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({
          id: request.id ?? null,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        })}\n`,
      );
    }
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
