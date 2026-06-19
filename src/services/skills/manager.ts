// ---------------------------------------------------------------------------
// Kavi — Skill Manager
// ---------------------------------------------------------------------------
// Registry + loader for skills. Scans bundled skills, manages installed.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Skill, SkillEntry, SkillMetadata, SkillToolExecutionContext } from './types';
import type { ToolDefinition } from '../../types/tool';
import { generateId } from '../../utils/id';
import { parseFrontmatterBlock } from '../markdown/frontmatter';
import { buildSkillMetadataFromFrontmatter, getSkillCompatibility } from './manifest';
import { getSettingsSkillEligibilityContext } from './eligibility';
import {
  ensureManagedSkillBundle,
  deleteManagedSkillBundle,
  syncSkillEntriesToConversationWorkspace,
} from './storage';

const DEFAULT_MAX_SKILLS_IN_PROMPT = 150;
const DEFAULT_MAX_SKILLS_PROMPT_CHARS = 12000;

// ── Store ────────────────────────────────────────────────────────────────

interface SkillsState {
  entries: SkillEntry[];
  addEntry: (entry: SkillEntry) => void;
  removeEntry: (id: string) => void;
  toggleEntry: (id: string) => void;
  updateEntry: (id: string, updates: Partial<SkillEntry>) => void;
  getEnabled: () => SkillEntry[];
}

function syncSkillEntryRuntime(entry: SkillEntry): void {
  if (!entry.enabled) {
    unregisterSkill(entry.id);
    return;
  }

  if (!entry.metadata) {
    return;
  }

  activateSkill(entry);
}

type SkillPromptCatalogEntry = {
  name: string;
  location: string;
};

function sameManagedSource(left: SkillEntry['source'], right: SkillEntry['source']): boolean {
  return (
    left.managedDir === right.managedDir &&
    JSON.stringify(left.managedFiles || []) === JSON.stringify(right.managedFiles || []) &&
    JSON.stringify(left.managedBinaryFiles || []) === JSON.stringify(right.managedBinaryFiles || [])
  );
}

function sanitizeSkillPromptText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildSkillsPrompt(skills: SkillPromptCatalogEntry[]): string {
  if (skills.length === 0) {
    return '';
  }

  const lines = ['Available skills:'];
  for (const skill of skills.slice(0, DEFAULT_MAX_SKILLS_IN_PROMPT)) {
    const line = `- ${sanitizeSkillPromptText(skill.name)}: ${sanitizeSkillPromptText(skill.location)}`;
    const next = [...lines, line].join('\n');
    if (next.length > DEFAULT_MAX_SKILLS_PROMPT_CHARS) {
      break;
    }
    lines.push(line);
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

function getPromptVisibleEntries(): SkillEntry[] {
  const eligibilityContext = getSettingsSkillEligibilityContext();
  return useSkillsStore
    .getState()
    .getEnabled()
    .filter((entry) => {
      if (!entry.metadata) {
        return false;
      }

      if (!getSkillCompatibility(entry.metadata, eligibilityContext).compatible) {
        return false;
      }

      return (entry.metadata.invocationPolicy || 'auto') !== 'manual';
    });
}

function queueEnsureManagedSkill(entry: SkillEntry): void {
  if (!entry.metadata) {
    return;
  }

  void ensureManagedSkillBundle(entry)
    .then((nextEntry) => {
      const current = useSkillsStore
        .getState()
        .entries.find((candidate) => candidate.id === entry.id);
      if (!current) {
        return;
      }
      if (sameManagedSource(current.source, nextEntry.source)) {
        return;
      }
      useSkillsStore.getState().updateEntry(entry.id, { source: nextEntry.source });
    })
    .catch((e) => console.warn('[skills] syncSkillEntryRuntime failed:', e));
}

export const useSkillsStore = create<SkillsState>()(
  persist(
    (set, get) => ({
      entries: [],

      addEntry: (entry) => {
        syncSkillEntryRuntime(entry);
        set((state) => ({ entries: [...state.entries, entry] }));
        if (!entry.source.managedDir) {
          queueEnsureManagedSkill(entry);
        }
      },

      removeEntry: (id) => {
        // Clean up runtime skill when removing from store
        const existingEntry = get().entries.find((entry) => entry.id === id);
        unregisterSkill(id);
        set((state) => ({ entries: state.entries.filter((e) => e.id !== id) }));
        if (existingEntry) {
          void deleteManagedSkillBundle(existingEntry);
        }
      },

      toggleEntry: (id) =>
        set((state) => {
          const entries = state.entries.map((entry) => {
            if (entry.id !== id) {
              return entry;
            }

            const nextEntry = { ...entry, enabled: !entry.enabled };
            syncSkillEntryRuntime(nextEntry);
            return nextEntry;
          });

          return { entries };
        }),

      updateEntry: (id, updates) =>
        set((state) => {
          const entries = state.entries.map((entry) => {
            if (entry.id !== id) {
              return entry;
            }

            const nextEntry = { ...entry, ...updates };
            syncSkillEntryRuntime(nextEntry);
            return nextEntry;
          });

          return { entries };
        }),

      getEnabled: () => get().entries.filter((e) => e.enabled),
    }),
    {
      name: 'kavi-skills',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    },
  ),
);

// ── Skill Parser (from SKILL.md) ─────────────────────────────────────────

export function parseSkillManifest(content: string): SkillMetadata | null {
  const { metadata } = parseFrontmatterBlock(content);
  return buildSkillMetadataFromFrontmatter(metadata, { version: '1.0.0' });
}

// ── Skill Registry (runtime) ─────────────────────────────────────────────

const loadedSkills = new Map<string, Skill>();

export function registerSkill(skill: Skill): void {
  loadedSkills.set(skill.id, skill);
}

export function unregisterSkill(id: string): void {
  loadedSkills.delete(id);
}

export function getLoadedSkill(id: string): Skill | undefined {
  return loadedSkills.get(id);
}

export function getAllLoadedSkills(): Skill[] {
  return Array.from(loadedSkills.values());
}

export function getSkillToolDefinitions(): ToolDefinition[] {
  const defs: ToolDefinition[] = [];
  for (const skill of loadedSkills.values()) {
    for (const tool of skill.tools) {
      defs.push({
        name: `skill__${skill.id}__${tool.name}`,
        description: `[${skill.name}] ${tool.description}`,
        input_schema: tool.input_schema,
        strict: tool.strict,
        contract: tool.contract,
      });
    }
  }
  return defs;
}

export function parseSkillToolName(toolName: string): { skillId: string; toolName: string } | null {
  const parts = toolName.split('__');
  if (parts.length !== 3 || parts[0] !== 'skill') return null;
  return { skillId: parts[1], toolName: parts[2] };
}

export async function executeSkillTool(
  fullToolName: string,
  argsString: string,
  context: SkillToolExecutionContext = {},
): Promise<string> {
  const parsed = parseSkillToolName(fullToolName);
  if (!parsed) return `Error: invalid skill tool name: ${fullToolName}`;

  const skill = loadedSkills.get(parsed.skillId);
  if (!skill) return `Error: skill not loaded: ${parsed.skillId}`;

  const tool = skill.tools.find((t) => t.name === parsed.toolName);
  if (!tool) return `Error: tool "${parsed.toolName}" not found in skill "${skill.name}"`;
  if (!tool.handler) return `Error: tool "${parsed.toolName}" has no handler`;

  let args: any;
  try {
    args = JSON.parse(argsString);
  } catch {
    return 'Error: invalid tool arguments JSON';
  }

  try {
    return await tool.handler(args, context);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error executing ${parsed.skillId}/${parsed.toolName}: ${message}`;
  }
}

// ── Skill Activation / Deactivation ──────────────────────────────────────
// When a skill is installed from ClawHub it's stored as a SkillEntry (metadata).
// Activation converts it to a runtime Skill with prompt-based tool handlers
// that the orchestrator can actually execute.

/**
 * Adapt the SKILL.md body for mobile. Kavi skills use shell commands
 * (curl, gh, etc.) that don't exist on mobile. We translate common
 * patterns to use equivalent mobile tools.
 */
function adaptSkillPromptForMobile(body: string): string {
  if (!body) return body;
  let adapted = body;

  // Add a mobile adaptation header if the skill mentions shell commands
  const usesShellCmds = /```(?:bash|sh|shell)\b/i.test(adapted) || /\bcurl\s/i.test(adapted);
  if (usesShellCmds) {
    adapted =
      `> **Mobile adaptation**: This skill was designed for desktop CLI. ` +
      `On mobile, translate \`curl\` commands to the \`web_fetch\` tool. ` +
      `Pass the URL, method, headers, and body as tool arguments instead of running shell commands.\n\n` +
      adapted;
  }

  return adapted;
}

/**
 * Activate a skill entry — on mobile, skills are prompt-based instructions
 * injected into the system prompt. They guide the LLM to use existing tools
 * (web_fetch, etc.) rather than creating separate tool handlers.
 *
 * Kavi skills are SKILL.md files whose body IS the system prompt.
 * The LLM reads the instructions and uses its available tools accordingly.
 */
export function activateSkill(
  entry: SkillEntry,
  _promptExecutor?: (prompt: string) => Promise<string>,
): Skill {
  const compatibility = getSkillCompatibility(entry.metadata, getSettingsSkillEligibilityContext());
  if (!compatibility.compatible) {
    unregisterSkill(entry.id);
    return {
      id: entry.id,
      name: entry.metadata.name,
      description: entry.metadata.description,
      version: entry.metadata.version,
      author: entry.metadata.author,
      tools: [],
      systemPrompt: entry.systemPrompt,
      invocationPolicy: entry.metadata.invocationPolicy,
    };
  }

  // Adapt the skill body for mobile usage patterns
  const adaptedPrompt = adaptSkillPromptForMobile(entry.systemPrompt || '');

  const skill: Skill = {
    id: entry.id,
    name: entry.metadata.name,
    description: entry.metadata.description,
    version: entry.metadata.version,
    author: entry.metadata.author,
    // Skills are prompt-based: they don't define separate tools.
    // Instead their instructions guide the LLM to use existing tools.
    tools: [],
    systemPrompt: adaptedPrompt || entry.systemPrompt,
    invocationPolicy: entry.metadata.invocationPolicy,
  };

  registerSkill(skill);
  return skill;
}

/**
 * Deactivate (unload) a skill, removing it from the runtime registry.
 */
export function deactivateSkill(id: string): void {
  unregisterSkill(id);
}

/**
 * Activate all enabled skill entries from the store.
 */
export function activateEnabledSkills(
  promptExecutor?: (prompt: string) => Promise<string>,
): Skill[] {
  const eligibilityContext = getSettingsSkillEligibilityContext();
  const enabled = useSkillsStore.getState().getEnabled();
  return enabled.reduce<Skill[]>((acc, entry) => {
    if (!getSkillCompatibility(entry.metadata, eligibilityContext).compatible) {
      unregisterSkill(entry.id);
      return acc;
    }
    acc.push(activateSkill(entry, promptExecutor));
    return acc;
  }, []);
}

// ── Skill System Prompt Aggregation ──────────────────────────────────────

/**
 * Gather system prompts from all active skills to inject into the
 * orchestrator's system prompt.
 */
export async function getSkillSystemPrompts(conversationId: string): Promise<string> {
  const visibleEntries = getPromptVisibleEntries();
  if (visibleEntries.length === 0) {
    return '';
  }

  const syncedEntries = await syncSkillEntriesToConversationWorkspace(
    visibleEntries,
    conversationId,
  );
  for (const { entry } of syncedEntries) {
    const currentEntry = visibleEntries.find((candidate) => candidate.id === entry.id);
    if (!currentEntry) {
      continue;
    }
    if (!sameManagedSource(currentEntry.source, entry.source)) {
      useSkillsStore.getState().updateEntry(entry.id, { source: entry.source });
    }
  }
  const materializedSkills = syncedEntries.map(({ entry, location }) => {
    return {
      name: entry.metadata.name,
      location,
    };
  });
  if (materializedSkills.length === 0) {
    return '';
  }
  return buildSkillsPrompt(materializedSkills);
}

// ── Skill Eligibility ────────────────────────────────────────────────────

/**
 * Check if a skill is compatible with the current mobile platform.
 * Skills that require desktop-only binaries (e.g., gh, docker) are
 * ineligible on mobile.
 */
export function isSkillCompatible(metadata: SkillMetadata): {
  compatible: boolean;
  reason?: string;
} {
  const compatibility = getSkillCompatibility(metadata, getSettingsSkillEligibilityContext());
  return {
    compatible: compatibility.compatible,
    reason: compatibility.reason,
  };
}

// ── Skill Invocation Policy Filter ───────────────────────────────────────

/**
 * Filter tool definitions based on skill invocation policies.
 * - 'auto': always included (default)
 * - 'manual': only included when explicitly requested by user
 * - 'agent-decides': included but with an instructional wrapper
 */
export function filterToolsByInvocationPolicy(
  tools: ToolDefinition[],
  requestedSkills?: string[],
): ToolDefinition[] {
  return tools.filter((tool) => {
    const parsed = parseSkillToolName(tool.name);
    if (!parsed) return true; // not a skill tool, always include

    const skill = loadedSkills.get(parsed.skillId);
    if (!skill) return true;

    const policy = skill.invocationPolicy || 'auto';
    if (policy === 'auto') return true;
    if (policy === 'manual') {
      return requestedSkills?.includes(skill.name) || requestedSkills?.includes(skill.id) || false;
    }
    // 'agent-decides' — always include
    return true;
  });
}

// ── Skill Auto-Discovery ─────────────────────────────────────────────────
// Scans workspace directories for SKILL.md files and auto-registers them.

export async function discoverSkillsInDirectory(
  dirPath: string,
  promptExecutor?: (prompt: string) => Promise<string>,
): Promise<SkillEntry[]> {
  const discovered: SkillEntry[] = [];

  try {
    const { Directory, File } = await import('expo-file-system');
    const dir = new Directory(dirPath);
    if (!dir.exists) return discovered;

    const items = dir.list();
    for (const item of items) {
      // Check if directory contains a SKILL.md
      if (typeof item === 'object' && 'list' in item) {
        const skillFile = new File(item as InstanceType<typeof Directory>, 'SKILL.md');
        if (skillFile.exists) {
          try {
            const content = await skillFile.text();
            const metadata = parseSkillManifest(content);
            if (metadata) {
              // Check if already registered
              const store = useSkillsStore.getState();
              const exists = store.entries.some((e) => e.metadata.name === metadata.name);
              if (!exists) {
                const entry: SkillEntry = {
                  id: generateId(),
                  metadata,
                  enabled: true,
                  installedAt: Date.now(),
                  source: { source: 'bundled' },
                  systemPrompt: content.replace(/^---[\s\S]*?---/, '').trim() || undefined,
                };
                store.addEntry(entry);
                activateSkill(entry, promptExecutor);
                discovered.push(entry);
              }
            }
          } catch {
            // Skip malformed SKILL.md files
          }
        }
      }
    }
  } catch {
    // Directory scan failed — non-critical
  }

  return discovered;
}
