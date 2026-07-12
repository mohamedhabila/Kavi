// ---------------------------------------------------------------------------
// Kavi — Built-in Slash Commands
// ---------------------------------------------------------------------------

import { triggerInternalHook, createInternalHookEvent } from '../events/bus';
import { formatUsageReport } from '../usage/tracker';
import { getLoadedHooks as getRegisteredHooks } from '../hooks/loader';
import { useSettingsStore } from '../../store/useSettingsStore';
import { listScheduledJobs } from '../scheduler/commands';
import { useSkillsStore } from '../skills/manager';
import { searchMemoryFactsForManagement } from '../memory/facts/managementSearch';
import { serializeMemoryFact } from '../memory/memoryFactSerialization';

export type CommandContext = {
  conversationId: string | null;
  args: string;
  agentRunId?: string;
  executionSignal?: AbortController;
};

export type CommandResult = {
  response?: string;
  action?: 'new_conversation' | 'stop' | 'clear_context' | 'export' | 'none';
  shouldDisplay?: boolean;
};

export type CommandHandler = (ctx: CommandContext) => Promise<CommandResult> | CommandResult;

const commandRegistry = new Map<string, { description: string; handler: CommandHandler }>();

export function registerCommand(name: string, description: string, handler: CommandHandler): void {
  commandRegistry.set(name.toLowerCase(), { description, handler });
}

export function getCommand(name: string) {
  return commandRegistry.get(name.toLowerCase());
}

export function getAllCommands(): Array<{ name: string; description: string }> {
  return Array.from(commandRegistry.entries()).map(([name, { description }]) => ({
    name: `/${name}`,
    description,
  }));
}

// Register built-in commands

registerCommand('new', 'Start a new conversation', async (ctx) => {
  await triggerInternalHook(
    createInternalHookEvent('command', 'new', ctx.conversationId ?? 'system', {
      commandName: 'new',
      agentRunId: ctx.agentRunId,
      executionSignal: ctx.executionSignal,
    }),
  );
  return { action: 'new_conversation', response: 'Starting new conversation...' };
});

registerCommand('reset', 'Reset the current conversation context', async (ctx) => {
  await triggerInternalHook(
    createInternalHookEvent('command', 'reset', ctx.conversationId ?? 'system', {
      commandName: 'reset',
      agentRunId: ctx.agentRunId,
      executionSignal: ctx.executionSignal,
    }),
  );
  return { action: 'clear_context', response: 'Context cleared.' };
});

registerCommand('stop', 'Stop the current generation', () => {
  return { action: 'stop', response: 'Stopping...' };
});

registerCommand('status', 'Show current session status', (ctx) => {
  return {
    response: `**Session Status**\n- Conversation: ${ctx.conversationId ?? 'none'}\n- Ready`,
    shouldDisplay: true,
  };
});

registerCommand('help', 'Show available commands', () => {
  const cmds = getAllCommands();
  const lines = cmds.map((c) => `\`${c.name}\` — ${c.description}`);
  return {
    response: `**Available Commands**\n\n${lines.join('\n')}`,
    shouldDisplay: true,
  };
});

registerCommand('compact', 'Trigger context compaction', async (ctx) => {
  await triggerInternalHook(
    createInternalHookEvent('command', 'compact', ctx.conversationId ?? 'system', {
      commandName: 'compact',
      agentRunId: ctx.agentRunId,
      executionSignal: ctx.executionSignal,
    }),
  );
  return { response: 'Compaction triggered.', shouldDisplay: true };
});

registerCommand('export', 'Export current conversation', () => {
  return { action: 'export', response: 'Exporting conversation...' };
});

registerCommand('memory', 'Search remembered facts', (ctx) => {
  const query = ctx.args.trim().slice(0, 200);
  if (!query) {
    return { response: 'Use `/memory <query>` to search memory.', shouldDisplay: true };
  }

  const result = searchMemoryFactsForManagement(query, 10);
  if (result.totalCurrentFacts === 0) {
    return { response: 'Memory is empty.', shouldDisplay: true };
  }
  if (result.totalMatches === 0) {
    return { response: `No remembered facts matching "${query}".`, shouldDisplay: true };
  }
  const preview = result.facts.map((memoryFact) => {
    const fact = serializeMemoryFact(memoryFact);
    const value = fact.value.replace(/\s+/g, ' ').trim().slice(0, 300);
    return `- **${fact.subject} · ${fact.predicate}**: ${value}`;
  });
  return {
    response: `**Remembered facts: "${query}"** (${result.totalMatches} matches)\n\n${preview.join('\n')}${result.totalMatches > result.facts.length ? '\n…' : ''}`,
    shouldDisplay: true,
  };
});

registerCommand('model', 'Switch model', (ctx) => {
  const settings = useSettingsStore.getState();
  const provider = settings.providers.find((p) => p.id === settings.activeProviderId);
  if (!ctx.args) {
    return {
      response: `Current model: **${provider?.model || 'none'}** (${provider?.name || 'no provider'})\n\nUse \`/model <name>\` to switch.`,
      shouldDisplay: true,
    };
  }
  if (provider) {
    settings.updateProvider({ ...provider, model: ctx.args.trim() });
    settings.setActiveProviderAndModel(provider.id, ctx.args.trim());
    settings.setLastUsedModel(provider.id, ctx.args.trim());
  }
  return { response: `Model switched to: **${ctx.args.trim()}**`, shouldDisplay: true };
});

registerCommand('think', 'Set thinking level (off/minimal/low/medium/high/xhigh)', (ctx) => {
  const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
  const level = ctx.args.toLowerCase();
  if (!levels.includes(level)) {
    const current = useSettingsStore.getState().thinkingLevel || 'medium';
    return {
      response: `Current thinking level: **${current}**\n\nUse \`/think <level>\` where level is: ${levels.join(', ')}`,
      shouldDisplay: true,
    };
  }
  useSettingsStore.getState().setThinkingLevel(level as any);
  return { response: `Thinking level set to: **${level}**`, shouldDisplay: true };
});

registerCommand('verbose', 'Toggle verbose mode', () => {
  return { response: 'Verbose mode toggled.', shouldDisplay: true };
});

registerCommand('skills', 'List installed skills', () => {
  const entries = useSkillsStore.getState().entries;
  if (entries.length === 0) {
    return {
      response: 'No skills installed yet. Use ClawHub to browse and install skills.',
      shouldDisplay: true,
    };
  }
  const lines = entries.map(
    (s) =>
      `- **${s.metadata.name}** (${s.enabled ? 'enabled' : 'disabled'}) — ${s.metadata.description || 'no description'}`,
  );
  return {
    response: `**Installed Skills (${entries.length})**\n\n${lines.join('\n')}`,
    shouldDisplay: true,
  };
});

registerCommand('cron', 'List scheduled tasks', async () => {
  const jobs = await listScheduledJobs();
  if (jobs.length === 0) {
    return {
      response: 'No scheduled tasks. Ask me to schedule one with the `cron` tool.',
      shouldDisplay: true,
    };
  }
  const lines = jobs.map((j) => {
    const sched = j.schedule;
    const schedStr =
      sched.kind === 'cron' ? sched.expr : sched.kind === 'every' ? `${sched.everyMs}ms` : 'once';
    const state = j.runningAttemptId
      ? 'running'
      : j.nextRetryAtMs
        ? 'retry scheduled'
        : j.enabled
          ? 'enabled'
          : 'disabled';
    const warnings = [
      j.lastError ? `last error: ${j.lastError}` : undefined,
      j.lastDeliveryError ? `delivery warning: ${j.lastDeliveryError}` : undefined,
      j.lastWakeError ? `wake warning: ${j.lastWakeError}` : undefined,
    ].filter(Boolean);
    return `- **${j.name}** (${state}) — ${sched.kind}: \`${schedStr}\`${warnings.length > 0 ? ` — ${warnings.join('; ')}` : ''}`;
  });
  return {
    response: `**Scheduled Tasks (${jobs.length})**\n\n${lines.join('\n')}`,
    shouldDisplay: true,
  };
});

registerCommand('usage', 'Show token usage report', () => {
  const report = formatUsageReport();
  return { response: report, shouldDisplay: true };
});

registerCommand('hooks', 'List registered hooks', () => {
  const hooks = getRegisteredHooks();
  if (hooks.length === 0) {
    return {
      response: 'No hooks registered. Create HOOK.md files to add automation hooks.',
      shouldDisplay: true,
    };
  }
  const lines = hooks.map(
    (h) => `- **${h.name}** → \`${h.event}\` (${h.enabled ? 'enabled' : 'disabled'})`,
  );
  return { response: `**Registered Hooks**\n\n${lines.join('\n')}`, shouldDisplay: true };
});
