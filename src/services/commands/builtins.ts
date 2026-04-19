// ---------------------------------------------------------------------------
// Kavi — Built-in Slash Commands
// ---------------------------------------------------------------------------

import { triggerInternalHook, createInternalHookEvent } from '../events/bus';
import { formatUsageReport } from '../usage/tracker';
import { getLoadedHooks as getRegisteredHooks } from '../hooks/loader';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useSchedulerStore } from '../scheduler/store';
import { useSkillsStore } from '../skills/manager';
import { readGlobalMemory } from '../memory/store';

export type CommandContext = {
  conversationId: string | null;
  args: string;
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
    }),
  );
  return { action: 'new_conversation', response: 'Starting new conversation...' };
});

registerCommand('reset', 'Reset the current conversation context', async (ctx) => {
  await triggerInternalHook(
    createInternalHookEvent('command', 'reset', ctx.conversationId ?? 'system', {
      commandName: 'reset',
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
    }),
  );
  return { response: 'Compaction triggered.', shouldDisplay: true };
});

registerCommand('export', 'Export current conversation', () => {
  return { action: 'export', response: 'Exporting conversation...' };
});

registerCommand('memory', 'Search or view memory', async (ctx) => {
  if (!ctx.args) {
    return { response: 'Use `/memory <query>` to search memory.', shouldDisplay: true };
  }
  const memory = await readGlobalMemory();
  if (!memory) {
    return { response: 'Memory is empty.', shouldDisplay: true };
  }
  const query = ctx.args.toLowerCase();
  const lines = memory.split('\n').filter((l) => l.toLowerCase().includes(query));
  if (lines.length === 0) {
    return { response: `No memory entries matching "${ctx.args}".`, shouldDisplay: true };
  }
  const preview = lines.slice(0, 10).join('\n');
  return {
    response: `**Memory Search: "${ctx.args}"** (${lines.length} matches)\n\n${preview}${lines.length > 10 ? '\n…' : ''}`,
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

registerCommand('cron', 'List scheduled tasks', () => {
  const jobs = useSchedulerStore.getState().jobs;
  if (jobs.length === 0) {
    return {
      response: 'No scheduled tasks. Use the `create_task` tool to schedule tasks.',
      shouldDisplay: true,
    };
  }
  const lines = jobs.map((j) => {
    const sched = j.schedule;
    const schedStr =
      sched.kind === 'cron' ? sched.expr : sched.kind === 'every' ? `${sched.everyMs}ms` : 'once';
    return `- **${j.name}** (${j.enabled ? 'enabled' : 'disabled'}) — ${sched.kind}: \`${schedStr}\``;
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
