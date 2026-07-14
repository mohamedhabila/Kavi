import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';

import type { AgentGoal } from '../../src/engine/goals/types';
import { buildUnifiedMemoryAccessContext } from '../../src/services/memory/memoryAccessGateway';
import { processIngestionTurn } from '../../src/services/memory/turnProcessor';
import { countEpisodes } from '../../src/services/memory/episodes/queries';
import { countFacts, countFactsByKind, listFacts } from '../../src/services/memory/facts/queries';
import { flattenPromptSections } from '../../src/services/memory/promptAssembly';
import {
  clearStructuredMemory,
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../src/services/memory/schema';
import { closeMemoryDb } from '../../src/services/memory/database';
import type { Message } from '../../src/types/message';
import {
  buildRetrievalLlmConfig,
  DEFAULT_CONFIG,
  DEFAULT_QUERY_IMAGE_BASE_URL,
  normalizeRuntimeConfig,
  type RuntimeConfig,
} from './kavi_memory_runtime_config';
import { compactJson } from './runtimeJsonCompaction';

type JsonObject = Record<string, unknown>;

interface RuntimeRequest {
  id?: string;
  op: 'reset' | 'insert' | 'query' | 'stats' | 'shutdown';
  config?: Partial<RuntimeConfig>;
  trajectory?: JsonObject;
  query?: string;
  queryImage?: string | null;
  questionId?: string | null;
  questionContext?: JsonObject | null;
}

const MAX_ACCESSIBILITY_TREE_CHARS = 50_000;
const MAX_STRUCTURED_STATE_CHARS = 60_000;

const insertedTrajectoryIds = new Set<string>();
let currentConfig: RuntimeConfig = { ...DEFAULT_CONFIG };
let insertCalls = 0;

const QUERY_IMAGE_DESCRIPTION_PROMPT =
  'Describe this image concisely. Focus on the key content, text visible in the image, and any relevant details. Keep the description under 200 words.';

interface QueryMessagesResult {
  messages: Message[];
  imageDescription?: string;
  imageDescriptionError?: string;
}

interface QueryImageProvider {
  baseUrl: string;
  apiKey: string;
  model: string;
}

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

function compactScalar(value: unknown, maxChars: number): string | number | boolean | null {
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  const text = scalarToText(value);
  if (text === null) return null;
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 3)}...`;
}

function queryImageMimeType(imagePath: string): string {
  const lower = imagePath.toLowerCase().split(/[?#]/, 1)[0];
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

function queryImageDataUri(imagePath: string): string | null {
  if (/^https?:\/\//i.test(imagePath) || /^data:/i.test(imagePath)) return imagePath;
  const path = imagePath.startsWith('file://') ? new URL(imagePath) : imagePath;
  if (typeof path === 'string' && !existsSync(path)) return null;
  const bytes = readFileSync(path);
  return `data:${queryImageMimeType(imagePath)};base64,${bytes.toString('base64')}`;
}

function buildQueryImageProvider(config: RuntimeConfig): QueryImageProvider | null {
  if (!config.queryImageUnderstanding) return null;
  const model = config.queryImageModel.trim();
  const apiKey = process.env[config.queryImageApiKeyEnv]?.trim();
  if (!model || !apiKey) return null;
  return {
    baseUrl: (config.queryImageBaseUrl || DEFAULT_QUERY_IMAGE_BASE_URL).replace(/\/+$/, ''),
    apiKey,
    model,
  };
}

async function describeQueryImage(
  queryImage: string | null,
  config: RuntimeConfig,
): Promise<{ text?: string; error?: string }> {
  if (!queryImage) return {};
  const provider = buildQueryImageProvider(config);
  if (!provider) return {};
  try {
    const dataUri = queryImageDataUri(queryImage);
    if (!dataUri) {
      return { error: 'query image payload not available' };
    }
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: QUERY_IMAGE_DESCRIPTION_PROMPT },
              {
                type: 'image_url',
                image_url: { url: dataUri },
              },
            ],
          },
        ],
        max_completion_tokens: 512,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      return { error: `HTTP ${response.status}: ${body.slice(0, 500)}` };
    }
    const payload = await response.json();
    const text = payload?.choices?.[0]?.message?.content || payload?.content?.[0]?.text || '';
    const trimmed = typeof text === 'string' ? text.trim() : '';
    return trimmed ? { text: trimmed } : { error: 'empty query image description' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
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

function stateEvidenceObject(
  trajectory: JsonObject,
  trajectoryIdValue: string,
  state: JsonObject,
  fallbackIndex: number,
): JsonObject {
  return {
    trajectory_id: trajectoryIdValue,
    domain: compactScalar(trajectory.domain, 160),
    environment: compactScalar(trajectory.environment, 160),
    goal: compactScalar(trajectory.goal, 600),
    trajectory_outcome: compactScalar(trajectory.outcome, 160),
    state_index: state.state_index ?? state.step ?? fallbackIndex,
    url: compactScalar(state.url, 500),
    action: compactScalar(state.action, 800),
    thought: compactScalar(state.thought, 800),
    screenshot: compactScalar(state.screenshot, 500),
    accessibility_tree: compactScalar(state.accessibility_tree, MAX_ACCESSIBILITY_TREE_CHARS),
  };
}

function buildGraphEvidence(trajectory: JsonObject, id: string): string[] {
  const evidence: string[] = [];
  const pushEvidence = (payload: JsonObject) => {
    evidence.push(`longmemeval:${compactJson(payload, MAX_STRUCTURED_STATE_CHARS)}`);
  };

  pushEvidence({ kind: 'trajectory', ...trajectoryMetadata(trajectory, id) });
  const states = Array.isArray(trajectory.states) ? trajectory.states : [];
  states.forEach((rawState, index) => {
    if (evidence.length >= 64) return;
    const state = asObject(rawState);
    pushEvidence({ kind: 'state', ...stateEvidenceObject(trajectory, id, state, index) });
  });
  return evidence;
}

function buildToolMessagesForTrajectory(
  trajectory: JsonObject,
  id: string,
  now: number,
): Message[] {
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
          domain: compactScalar(trajectory.domain, 160),
          environment: compactScalar(trajectory.environment, 160),
          goal: compactScalar(trajectory.goal, 600),
          trajectory_outcome: compactScalar(trajectory.outcome, 160),
          state_index: stateIndex,
          url: compactScalar(state.url, 500),
          action: compactScalar(state.action, 800),
          thought: compactScalar(state.thought, 800),
          screenshot: compactScalar(state.screenshot, 500),
          accessibility_tree: compactScalar(state.accessibility_tree, MAX_ACCESSIBILITY_TREE_CHARS),
        },
        MAX_STRUCTURED_STATE_CHARS,
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

function buildTrajectoryMessages(
  trajectory: JsonObject,
  id: string,
  terminalAt: number,
): Message[] {
  const metadata = trajectoryMetadata(trajectory, id);
  const stateCount = Array.isArray(trajectory.states) ? trajectory.states.length : 0;
  const toolBaseTimestamp = terminalAt - stateCount * 2 - 1;
  const toolMessages = buildToolMessagesForTrajectory(trajectory, id, toolBaseTimestamp);
  return [
    {
      id: `user-${id}`,
      role: 'user',
      content: compactJson(metadata, 2000),
      timestamp: toolBaseTimestamp - 1,
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
      timestamp: terminalAt,
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'stop',
      },
    },
  ];
}

function applyConfig(config?: Partial<RuntimeConfig>): RuntimeConfig {
  currentConfig = normalizeRuntimeConfig(currentConfig, config);
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

  const ingestionResult = await processIngestionTurn({
    threadId: resolved.conversationId,
    messages,
    sourceEndMessageId: `assistant-final-${id}`,
    threadTitle: String(trajectory.goal ?? id),
    graphGoalEvidence,
    sourceRunId: id,
    now,
    episodeAccess: {
      personaId: 'longmemeval-v2',
      shareability: 'thread_only',
    },
  });
  insertedTrajectoryIds.add(id);

  return {
    trajectory_id: id,
    bridged_evidence_items: graphGoalEvidence.length,
    ingested_messages: messages.length,
    episode_id: ingestionResult.episodeId,
    deterministic_fact_ids: ingestionResult.deterministicFactIds,
    bridged_evidence_fact_ids: ingestionResult.bridgedEvidenceFactIds,
    agent_run_memory_fact_ids: ingestionResult.agentRunMemoryFactIds,
    total_memory_items: countFacts() + countEpisodes(),
    inserted_trajectories: insertedTrajectoryIds.size,
  };
}

async function buildQueryMessages(
  query: string,
  queryImage: string | null,
  now: number,
  config: RuntimeConfig,
): Promise<QueryMessagesResult> {
  const imageDescription = await describeQueryImage(queryImage, config);
  const enrichedContent = imageDescription.text
    ? `${query}\n\n<media_context>\n[Image Attachment #1]\nDescription:\n${imageDescription.text}\n</media_context>`
    : undefined;
  return {
    messages: [
      {
        id: `query-user-${now}`,
        role: 'user',
        content: query,
        ...(enrichedContent ? { enrichedContent } : {}),
        timestamp: now,
        ...(queryImage
          ? {
              attachments: [
                {
                  id: `query-image-${now}`,
                  type: 'image' as const,
                  uri: queryImage,
                  name: basename(queryImage) || 'query-image',
                  mimeType: queryImageMimeType(queryImage),
                  size: 0,
                },
              ],
            }
          : {}),
      },
    ],
    ...(imageDescription.text ? { imageDescription: imageDescription.text } : {}),
    ...(imageDescription.error ? { imageDescriptionError: imageDescription.error } : {}),
  };
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
  let stepStarted = started;
  const timings: Record<string, number> = {};

  const now = Date.now();
  const queryMessages = await buildQueryMessages(query, request.queryImage ?? null, now, resolved);
  timings.query_image_understanding_seconds = (performance.now() - stepStarted) / 1000;
  stepStarted = performance.now();
  const retrievalLlm = buildRetrievalLlmConfig(resolved);
  const memoryAccess = await buildUnifiedMemoryAccessContext({
    messages: queryMessages.messages,
    memoryConversationId: resolved.conversationId,
    sourceThreadId: resolved.conversationId,
    personaId: 'longmemeval-v2',
    taskId: null,
    mode: 'agentic',
    recallLimit: resolved.maxItems,
    goals: buildQueryGoals(query, request.questionId ?? null, now),
    ...(retrievalLlm ? { retrievalLlm } : {}),
    now,
  });
  timings.memory_access_seconds = (performance.now() - stepStarted) / 1000;
  stepStarted = performance.now();
  const sections = memoryAccess.livingMemory?.sections ?? [];
  const selected = selectedSections(sections, resolved.maxItemChars);
  timings.select_sections_seconds = (performance.now() - stepStarted) / 1000;
  stepStarted = performance.now();
  const memoryContext = selected.map((item) => ({
    type: 'text',
    value: `[Kavi living memory #${item.rank} | source=${item.source}]\n` + String(item.content),
  }));
  const flattenedSections = flattenPromptSections(sections);
  timings.flatten_sections_seconds = (performance.now() - stepStarted) / 1000;
  stepStarted = performance.now();
  const runtimeStats = stats();
  timings.stats_seconds = (performance.now() - stepStarted) / 1000;
  return {
    memory_context: memoryContext,
    selected,
    flattened_sections: flattenedSections,
    recalled_fact_count: memoryAccess.livingMemory?.recalledFactCount ?? 0,
    recalled_episode_count: memoryAccess.livingMemory?.recalledEpisodeCount ?? 0,
    living_memory_timings: memoryAccess.livingMemory?.timings ?? null,
    duration_seconds: (performance.now() - started) / 1000,
    timings,
    question_id: request.questionId ?? null,
    query_image: request.queryImage ?? null,
    query_image_description: queryMessages.imageDescription ?? null,
    query_image_description_error: queryMessages.imageDescriptionError ?? null,
    stats: runtimeStats,
  };
}

function stats(options: { includeSamples?: boolean } = {}): JsonObject {
  const includeSamples = options.includeSamples === true;
  return {
    db_dir: resolve(process.env.KAVI_MEMORY_SQLITE_DIR || process.cwd()),
    memory_type: 'kavi_memory_isolated',
    inserted_trajectories: insertedTrajectoryIds.size,
    insert_calls: insertCalls,
    memory_item_count: countFacts() + countEpisodes(),
    ...(includeSamples
      ? {
          fact_count: countFacts(),
          fact_counts_by_kind: countFactsByKind(),
          episode_count: countEpisodes(),
          sample_facts: listFacts({ limit: 5 }).map((fact) => ({
            id: fact.id,
            scope: fact.scope,
            memoryKind: fact.memoryKind,
            sourceRunId: fact.sourceRunId,
            predicate: fact.predicate,
            objectText: fact.objectText,
          })),
        }
      : {}),
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
      return stats({ includeSamples: true });
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
