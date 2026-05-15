// ---------------------------------------------------------------------------
// Kavi — Global Memory Store
// ---------------------------------------------------------------------------
// Manages MEMORY.md (global) + daily memory files (memory/YYYY-MM-DD.md)
// Uses expo-file-system for persistence.

import { Paths, File, Directory } from 'expo-file-system';

const MEMORY_DIR_NAME = 'global-memory';
const CONVERSATION_MEMORY_DIR_NAME = 'conversation-memory';
const MAIN_MEMORY_FILE = 'MEMORY.md';
const DAILY_DIR = 'daily';

export type MemoryScope = 'global' | 'conversation';
export type MemoryReadScope = MemoryScope | 'all';
export type MemorySearchScope = MemoryReadScope;
export type MemoryChangeScope = MemoryScope | 'daily' | 'structured' | 'all';

export interface MemoryChangeEvent {
  scope: MemoryChangeScope;
  updatedAt: number;
  conversationId?: string;
}

export interface MemorySearchEntry {
  scope: 'global' | 'conversation' | 'daily';
  source: string;
  snippet: string;
  score: number;
}

const memorySubscribers = new Set<(event: MemoryChangeEvent) => void>();
let lastMemoryUpdatedAt: number | null = null;

function getMemoryDir(): Directory {
  return new Directory(Paths.document, MEMORY_DIR_NAME);
}

function ensureDir(dir: Directory): void {
  if (!dir.exists) {
    dir.create();
  }
}

function normalizeConversationMemoryId(conversationId: string): string {
  const trimmed = conversationId.trim();
  if (!trimmed) {
    throw new Error('conversationId is required for conversation memory');
  }

  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function getConversationMemoryRootDir(): Directory {
  return new Directory(Paths.document, CONVERSATION_MEMORY_DIR_NAME);
}

function getConversationMemoryDir(conversationId: string): Directory {
  return new Directory(
    getConversationMemoryRootDir(),
    normalizeConversationMemoryId(conversationId),
  );
}

function ensureConversationMemoryDir(conversationId: string): Directory {
  const rootDir = getConversationMemoryRootDir();
  ensureDir(rootDir);
  const dir = getConversationMemoryDir(conversationId);
  ensureDir(dir);
  return dir;
}

function getDailyDir(): Directory {
  const dir = new Directory(getMemoryDir(), DAILY_DIR);
  ensureDir(getMemoryDir());
  ensureDir(dir);
  return dir;
}

function todayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function notifyMemorySubscribers(scope: MemoryChangeScope, conversationId?: string): void {
  const event: MemoryChangeEvent = {
    scope,
    updatedAt: Date.now(),
    ...(conversationId ? { conversationId } : {}),
  };
  lastMemoryUpdatedAt = event.updatedAt;
  memorySubscribers.forEach((listener) => listener(event));
}

export function notifyStructuredMemoryChanged(conversationId?: string | null): void {
  notifyMemorySubscribers('structured', conversationId ?? undefined);
}

export function subscribeToMemoryChanges(listener: (event: MemoryChangeEvent) => void): () => void {
  memorySubscribers.add(listener);
  return () => {
    memorySubscribers.delete(listener);
  };
}

export function getMemoryLastUpdatedAt(): number | null {
  return lastMemoryUpdatedAt;
}

// ── Global MEMORY.md ─────────────────────────────────────────────────────

export async function readGlobalMemory(): Promise<string | null> {
  const dir = getMemoryDir();
  ensureDir(dir);
  const file = new File(dir, MAIN_MEMORY_FILE);
  if (!file.exists) return null;
  return await file.text();
}

export function writeGlobalMemory(content: string): void {
  const dir = getMemoryDir();
  ensureDir(dir);
  const file = new File(dir, MAIN_MEMORY_FILE);
  file.write(content);
  notifyMemorySubscribers('global');
}

export async function appendGlobalMemory(content: string): Promise<void> {
  const existing = (await readGlobalMemory()) || '';
  writeGlobalMemory(existing ? `${existing}\n\n${content}` : content);
}

// ── Conversation MEMORY.md ──────────────────────────────────────────────

export async function readConversationMemory(conversationId: string): Promise<string | null> {
  const file = new File(getConversationMemoryDir(conversationId), MAIN_MEMORY_FILE);
  if (!file.exists) return null;
  return await file.text();
}

export function writeConversationMemory(conversationId: string, content: string): void {
  const file = new File(ensureConversationMemoryDir(conversationId), MAIN_MEMORY_FILE);
  file.write(content);
  notifyMemorySubscribers('conversation', conversationId);
}

export async function appendConversationMemory(
  conversationId: string,
  content: string,
): Promise<void> {
  const existing = (await readConversationMemory(conversationId)) || '';
  writeConversationMemory(conversationId, existing ? `${existing}\n\n${content}` : content);
}

export function clearConversationMemory(conversationId: string): void {
  const dir = getConversationMemoryDir(conversationId);
  if (dir.exists) {
    dir.delete();
  }
  notifyMemorySubscribers('conversation', conversationId);
}

// ── Daily memory files ───────────────────────────────────────────────────

export async function readDailyMemory(date?: string): Promise<string | null> {
  const dateStr = date || todayDateString();
  const file = new File(getDailyDir(), `${dateStr}.md`);
  if (!file.exists) return null;
  return await file.text();
}

export async function appendDailyMemory(content: string, date?: string): Promise<void> {
  const dateStr = date || todayDateString();
  const file = new File(getDailyDir(), `${dateStr}.md`);
  const existing = file.exists ? await file.text() : '';
  const separator = existing ? '\n\n---\n\n' : '';
  file.write(`${existing}${separator}${content}`);
  notifyMemorySubscribers('daily');
}

export function listDailyMemoryFiles(): string[] {
  const dir = getDailyDir();
  if (!dir.exists) return [];
  return dir
    .list()
    .filter((entry): entry is File => 'text' in entry && entry.name.endsWith('.md'))
    .map((f) => f.name.replace(/\.md$/, ''))
    .sort()
    .reverse();
}

// ── Memory injection for system prompt ───────────────────────────────────

function truncateMemoryForPrompt(memory: string | null, maxLines: number): string | null {
  if (!memory) return null;

  const lines = memory.split('\n');
  if (lines.length <= maxLines) return memory;
  return (
    lines.slice(0, maxLines).join('\n') +
    '\n\n[Memory truncated — use read_memory or memory_search with the relevant scope]'
  );
}

export async function getMemoryForSystemPrompt(maxLines = 200): Promise<string | null> {
  return truncateMemoryForPrompt(await readGlobalMemory(), maxLines);
}

export async function getConversationMemoryForSystemPrompt(
  conversationId: string,
  maxLines = 120,
): Promise<string | null> {
  return truncateMemoryForPrompt(await readConversationMemory(conversationId), maxLines);
}

// ── Search (simple text-based, supplements hybrid search) ────────────────

function collectMatches(
  source: string,
  scope: MemorySearchEntry['scope'],
  content: string,
  splitter: RegExp,
  queryTokens: string[],
  results: MemorySearchEntry[],
): void {
  const sections = content.split(splitter);
  for (const section of sections) {
    const sectionLower = section.toLowerCase();
    let matches = 0;
    for (const token of queryTokens) {
      if (sectionLower.includes(token)) matches++;
    }
    if (matches > 0) {
      results.push({
        scope,
        source,
        snippet: section.slice(0, 500),
        score: matches / queryTokens.length,
      });
    }
  }
}

function includesGlobalLikeMemory(scope: MemorySearchScope): boolean {
  return scope === 'global' || scope === 'all';
}

function includesConversationMemory(scope: MemorySearchScope): boolean {
  return scope === 'conversation' || scope === 'all';
}

export async function searchMemory(
  query: string,
  options?: {
    scope?: MemorySearchScope;
    conversationId?: string;
    maxDailyFiles?: number;
  },
): Promise<MemorySearchEntry[]> {
  const results: MemorySearchEntry[] = [];
  const queryLower = query.toLowerCase();
  const queryTokens = queryLower.split(/\s+/).filter(Boolean);
  const scope = options?.scope || 'global';
  const maxDailyFiles = options?.maxDailyFiles || 30;

  if (queryTokens.length === 0) {
    return [];
  }

  if (includesGlobalLikeMemory(scope)) {
    const global = await readGlobalMemory();
    if (global) {
      collectMatches('MEMORY.md', 'global', global, /\n(?=#{1,3}\s)/, queryTokens, results);
    }
  }

  if (includesConversationMemory(scope) && options?.conversationId) {
    const conversationMemory = await readConversationMemory(options.conversationId);
    if (conversationMemory) {
      collectMatches(
        'conversation/MEMORY.md',
        'conversation',
        conversationMemory,
        /\n(?=#{1,3}\s)/,
        queryTokens,
        results,
      );
    }
  }

  if (includesGlobalLikeMemory(scope)) {
    const dailyFiles = listDailyMemoryFiles();
    for (const dateStr of dailyFiles.slice(0, maxDailyFiles)) {
      const content = await readDailyMemory(dateStr);
      if (!content) continue;
      collectMatches(`daily/${dateStr}.md`, 'daily', content, /\n---\n/, queryTokens, results);
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

// ── Pre-compaction memory flush ──────────────────────────────────────────

export async function flushToMemory(facts: string[]): Promise<void> {
  if (facts.length === 0) return;
  const content = facts.map((f) => `- ${f}`).join('\n');
  await appendDailyMemory(`## Session Notes\n\n${content}`);
}

// ── Clear all memory (dangerous) ─────────────────────────────────────────

export function clearAllMemory(): void {
  const { clearStructuredMemory } = require('./schema') as typeof import('./schema');
  clearStructuredMemory();
  const dirs = [getMemoryDir(), getConversationMemoryRootDir()];
  for (const dir of dirs) {
    if (dir.exists) {
      dir.delete();
    }
  }
  notifyMemorySubscribers('all');
}
