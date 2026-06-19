// ---------------------------------------------------------------------------
// Kavi — BOOT.md Runner
// ---------------------------------------------------------------------------
// Loads BOOT.md from workspace root, creates a temp session, executes one
// agent turn silently on app launch.

import type { BootConfig, BootRunResult } from '../../types/boot';
import type { LlmProviderConfig } from '../../types/provider';
import { Paths, File, Directory } from 'expo-file-system';
import { runOrchestrator } from '../../engine/orchestrator';
import { bindProviderToModel } from '../llm/support/providerSupport';
import { generateId } from '../../utils/id';
import { unrefTimerIfSupported } from '../../utils/timers';

// ── Storage ──────────────────────────────────────────────────────────────

const BOOT_DIR = 'boot';
const BOOT_FILE = 'BOOT.md';

function getBootDir(): Directory {
  return new Directory(Paths.document, BOOT_DIR);
}

function ensureDir(dir: Directory): void {
  if (!dir.exists) dir.create();
}

// ── BOOT.md read/write ───────────────────────────────────────────────────

export async function readBootMd(): Promise<string | null> {
  const dir = getBootDir();
  ensureDir(dir);
  const file = new File(dir, BOOT_FILE);
  if (!file.exists) return null;
  return await file.text();
}

export function writeBootMd(content: string): void {
  const dir = getBootDir();
  ensureDir(dir);
  const file = new File(dir, BOOT_FILE);
  file.write(content);
}

export async function hasBootMd(): Promise<boolean> {
  const dir = getBootDir();
  ensureDir(dir);
  const file = new File(dir, BOOT_FILE);
  if (!file.exists) return false;
  const content = await file.text();
  return content.trim().length > 0;
}

// ── Boot config persistence ──────────────────────────────────────────────

let bootConfig: BootConfig = {
  enabled: true,
  lastRunAt: undefined,
  lastStatus: undefined,
};

export function getBootConfig(): BootConfig {
  return { ...bootConfig };
}

export function updateBootConfig(update: Partial<BootConfig>): void {
  bootConfig = { ...bootConfig, ...update };
}

// ── Execute BOOT.md ──────────────────────────────────────────────────────

export async function runBootOnce(
  provider: LlmProviderConfig,
  allProviders?: LlmProviderConfig[],
  modelOverride?: string,
): Promise<BootRunResult> {
  if (!bootConfig.enabled) {
    return { status: 'skipped', reason: 'Boot execution disabled' };
  }

  const content = await readBootMd();
  if (!content || !content.trim()) {
    return { status: 'skipped', reason: 'No BOOT.md content' };
  }

  // Prevent running more than once per launch
  const now = Date.now();
  if (bootConfig.lastRunAt && now - bootConfig.lastRunAt < 60000) {
    return { status: 'skipped', reason: 'Boot already ran recently' };
  }

  const sessionId = `boot-${Date.now()}-${generateId()}`;
  let outputText = '';
  const bootModel =
    typeof modelOverride === 'string' && modelOverride.trim().length > 0
      ? modelOverride.trim()
      : provider.model;
  const bootProvider = bindProviderToModel(provider, bootModel);

  try {
    await new Promise<void>((resolve, reject) => {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 30000);
      unrefTimerIfSupported(timeout);
      const clearTimeoutGuard = () => clearTimeout(timeout);

      runOrchestrator(
        {
          provider: bootProvider,
          model: bootModel,
          conversationId: sessionId,
          systemPrompt:
            'You are executing startup instructions from BOOT.md. ' +
            'Complete the tasks silently. Do not ask for user input.',
          messages: [
            {
              id: generateId(),
              role: 'user',
              content: `Execute the following boot instructions:\n\n${content}`,
              timestamp: Date.now(),
            },
          ],
          maxTokens: 4096,
          signal: abortController,
          enableCompaction: false,
          enableFailover: true,
          allProviders,
        },
        {
          onStateChange: () => {},
          onToken: (token) => {
            outputText += token;
          },
          onReasoning: () => {},
          onAssistantStreamReset: () => {
            outputText = '';
          },
          onToolCallStart: () => {},
          onToolCallComplete: () => {},
          onAssistantMessage: (content) => {
            if (content) outputText = content;
          },
          onToolMessage: () => {},
          onError: (err) => {
            clearTimeoutGuard();
            reject(err);
          },
          onDone: () => {
            clearTimeoutGuard();
            resolve();
          },
        },
      ).catch((error) => {
        clearTimeoutGuard();
        reject(error);
      });
    });

    bootConfig.lastRunAt = now;
    bootConfig.lastStatus = 'ran';

    return { status: 'ran', output: outputText };
  } catch (err: unknown) {
    bootConfig.lastRunAt = now;
    bootConfig.lastStatus = 'failed';

    return {
      status: 'failed',
      reason: err instanceof Error ? err.message : String(err),
      output: outputText,
    };
  }
}
