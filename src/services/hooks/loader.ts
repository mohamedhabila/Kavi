// ---------------------------------------------------------------------------
// Kavi — Hook Loader
// ---------------------------------------------------------------------------
// Loads HOOK.md files, parses YAML frontmatter, and binds to event system.

import type { HookDefinition } from '../../types/hooks';
import { parseFrontmatterBlock, getFrontmatterString } from '../markdown/frontmatter';
import {
  registerInternalHook,
  unregisterInternalHook,
  type InternalHookHandler,
} from '../events/bus';
import { generateId } from '../../utils/id';
import { Paths, File, Directory } from 'expo-file-system';

// ── Types ────────────────────────────────────────────────────────────────

export interface HookBinding {
  definition: HookDefinition;
  handler: InternalHookHandler;
}

// ── Storage ──────────────────────────────────────────────────────────────

const loadedHooks = new Map<string, HookBinding>();

function getHooksDir(): Directory {
  return new Directory(Paths.document, 'hooks');
}

function ensureDir(dir: Directory): void {
  if (!dir.exists) dir.create();
}

// ── Parse HOOK.md format ────────────────────────────────────────────────

export function parseHookFile(content: string): HookDefinition | null {
  const { metadata, content: body } = parseFrontmatterBlock(content);

  const name = getFrontmatterString(metadata, 'name');
  const event = getFrontmatterString(metadata, 'event');
  const action = getFrontmatterString(metadata, 'action');

  if (!name || !event) return null;

  return {
    id: generateId(),
    name,
    event,
    action: action || '*',
    prompt: body.trim(),
    enabled: metadata.enabled !== false,
    createdAt: Date.now(),
    source: 'user',
  };
}

// ── Hook management ─────────────────────────────────────────────────────

export function registerHook(
  definition: HookDefinition,
  executePrompt: (prompt: string, context: Record<string, unknown>) => Promise<void>,
): HookBinding {
  // Create event handler that runs the hook's prompt
  const handler: InternalHookHandler = async (event) => {
    if (!definition.enabled) return;
    try {
      const resolvedPrompt = resolveHookPrompt(definition.prompt, event.context);
      await executePrompt(resolvedPrompt, {
        ...event.context,
        hookName: definition.name,
        hookId: definition.id,
      });
    } catch (err) {
      console.warn(`[Hooks] Error executing hook "${definition.name}":`, err);
    }
  };

  // Register for the event type (and optionally specific action)
  const eventKey =
    definition.action === '*' ? definition.event : `${definition.event}:${definition.action}`;

  registerInternalHook(eventKey, handler);

  const binding: HookBinding = { definition, handler };
  loadedHooks.set(definition.id, binding);
  return binding;
}

export function unregisterHook(id: string): void {
  const binding = loadedHooks.get(id);
  if (!binding) return;

  const eventKey =
    binding.definition.action === '*'
      ? binding.definition.event
      : `${binding.definition.event}:${binding.definition.action}`;

  unregisterInternalHook(eventKey, binding.handler);
  loadedHooks.delete(id);
}

export function getLoadedHooks(): HookDefinition[] {
  return Array.from(loadedHooks.values()).map((b) => b.definition);
}

export function clearAllHooks(): void {
  for (const [id] of loadedHooks) {
    unregisterHook(id);
  }
}

// ── File-based hook loading ──────────────────────────────────────────────

export async function loadHooksFromDirectory(
  executePrompt: (prompt: string, context: Record<string, unknown>) => Promise<void>,
): Promise<HookDefinition[]> {
  const dir = getHooksDir();
  ensureDir(dir);

  const loaded: HookDefinition[] = [];
  const entries = dir.list();

  for (const entry of entries) {
    if (!('text' in entry)) continue; // Skip directories
    if (!entry.name.endsWith('.md')) continue;

    try {
      const content = await (entry as File).text();
      const definition = parseHookFile(content);
      if (definition) {
        definition.source = 'workspace';
        registerHook(definition, executePrompt);
        loaded.push(definition);
      }
    } catch (err) {
      console.warn(`[Hooks] Error loading hook file "${entry.name}":`, err);
    }
  }

  return loaded;
}

/**
 * Save a hook definition to file
 */
export function saveHookFile(definition: HookDefinition): void {
  if (!definition.name || !definition.event || !definition.prompt) {
    throw new Error('saveHookFile requires name, event, and prompt fields');
  }

  const dir = getHooksDir();
  ensureDir(dir);

  const content = `---
name: ${definition.name}
event: ${definition.event}
action: ${definition.action}
enabled: ${definition.enabled}
---

${definition.prompt}`;

  const fileName = `${definition.name.replace(/[^a-zA-Z0-9-_]/g, '-')}.md`;
  const file = new File(dir, fileName);
  file.write(content);
}

/**
 * Delete a hook file
 */
export function deleteHookFile(definition: HookDefinition): void {
  const dir = getHooksDir();
  const fileName = `${definition.name.replace(/[^a-zA-Z0-9-_]/g, '-')}.md`;
  const file = new File(dir, fileName);
  if (file.exists) {
    file.delete();
  }
}

// ── Template resolution ──────────────────────────────────────────────────

function resolveHookPrompt(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = context[key];
    if (value === undefined) return `{{${key}}}`;
    return String(value);
  });
}
