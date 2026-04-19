// ---------------------------------------------------------------------------
// Built-in Slash Commands — tests
// ---------------------------------------------------------------------------

jest.mock('../../src/services/events/bus', () => ({
  triggerInternalHook: jest.fn().mockResolvedValue(undefined),
  createInternalHookEvent: jest.fn(
    (type: string, action: string, sessionKey: string, context: any) => ({
      type,
      action,
      sessionKey,
      context,
      timestamp: new Date(),
      messages: [],
    }),
  ),
}));

jest.mock('../../src/services/usage/tracker', () => ({
  formatUsageReport: jest.fn().mockReturnValue('**Usage Report**\nTotal: 1000 tokens'),
}));

jest.mock('../../src/services/hooks/loader', () => ({
  getLoadedHooks: jest.fn().mockReturnValue([]),
}));

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: jest.fn().mockReturnValue({
      providers: [{ id: 'p1', name: 'TestProvider', model: 'gpt-5.4', enabled: true }],
      activeProviderId: 'p1',
      thinkingLevel: 'medium',
      updateProvider: jest.fn(),
      setActiveProviderAndModel: jest.fn(),
      setLastUsedModel: jest.fn(),
      setThinkingLevel: jest.fn(),
    }),
  },
}));

jest.mock('../../src/services/scheduler/store', () => ({
  useSchedulerStore: {
    getState: jest.fn().mockReturnValue({
      jobs: [],
    }),
  },
}));

jest.mock('../../src/services/skills/manager', () => ({
  useSkillsStore: {
    getState: jest.fn().mockReturnValue({
      entries: [],
    }),
  },
}));

jest.mock('../../src/services/memory/store', () => ({
  readGlobalMemory: jest.fn().mockResolvedValue('test query found here\nanother line'),
}));

import { getCommand, getAllCommands, registerCommand } from '../../src/services/commands/builtins';

describe('Built-in Commands', () => {
  it('should have core commands registered', () => {
    const cmds = getAllCommands();
    const names = cmds.map((c) => c.name);
    expect(names).toContain('/new');
    expect(names).toContain('/reset');
    expect(names).toContain('/stop');
    expect(names).toContain('/status');
    expect(names).toContain('/help');
    expect(names).toContain('/compact');
    expect(names).toContain('/export');
    expect(names).toContain('/memory');
    expect(names).toContain('/model');
    expect(names).toContain('/think');
    expect(names).toContain('/verbose');
    expect(names).toContain('/skills');
    expect(names).toContain('/cron');
  });

  it('/new should return new_conversation action', async () => {
    const cmd = getCommand('new');
    expect(cmd).toBeDefined();
    const result = await cmd!.handler({ conversationId: 'conv1', args: '' });
    expect(result.action).toBe('new_conversation');
  });

  it('/reset should return clear_context action', async () => {
    const cmd = getCommand('reset');
    const result = await cmd!.handler({ conversationId: 'conv1', args: '' });
    expect(result.action).toBe('clear_context');
  });

  it('/stop should return stop action', () => {
    const cmd = getCommand('stop');
    const result = cmd!.handler({ conversationId: null, args: '' });
    expect((result as any).action).toBe('stop');
  });

  it('/status should show session info', () => {
    const cmd = getCommand('status');
    const result = cmd!.handler({ conversationId: 'conv1', args: '' });
    expect((result as any).response).toContain('conv1');
    expect((result as any).shouldDisplay).toBe(true);
  });

  it('/status with null conversationId', () => {
    const cmd = getCommand('status');
    const result = cmd!.handler({ conversationId: null, args: '' });
    expect((result as any).response).toContain('none');
  });

  it('/help should list all commands', () => {
    const cmd = getCommand('help');
    const result = cmd!.handler({ conversationId: null, args: '' });
    expect((result as any).response).toContain('/new');
    expect((result as any).response).toContain('/help');
  });

  it('/compact should trigger compaction', async () => {
    const cmd = getCommand('compact');
    const result = await cmd!.handler({ conversationId: 'conv1', args: '' });
    expect((result as any).response).toContain('Compaction');
    expect((result as any).shouldDisplay).toBe(true);
  });

  it('/export should return export action', () => {
    const cmd = getCommand('export');
    const result = cmd!.handler({ conversationId: null, args: '' });
    expect((result as any).action).toBe('export');
  });

  it('/memory with args should search', async () => {
    const cmd = getCommand('memory');
    const result = await cmd!.handler({ conversationId: null, args: 'test query' });
    expect((result as any).response).toContain('test query');
  });

  it('/memory without args should show usage', async () => {
    const cmd = getCommand('memory');
    const result = await cmd!.handler({ conversationId: null, args: '' });
    expect((result as any).response).toContain('/memory');
  });

  it('/model with args should switch model', () => {
    const cmd = getCommand('model');
    const result = cmd!.handler({ conversationId: null, args: 'gpt-5.4' });
    expect((result as any).response).toContain('gpt-5.4');
  });

  it('/model without args should show usage', () => {
    const cmd = getCommand('model');
    const result = cmd!.handler({ conversationId: null, args: '' });
    expect((result as any).response).toContain('/model');
  });

  it('/think with valid level', () => {
    const cmd = getCommand('think');
    for (const level of ['off', 'low', 'medium', 'high']) {
      const result = cmd!.handler({ conversationId: null, args: level });
      expect((result as any).response).toContain(level);
    }
  });

  it('/think with invalid level', () => {
    const cmd = getCommand('think');
    const result = cmd!.handler({ conversationId: null, args: 'turbo' });
    expect((result as any).response).toContain('off');
  });

  it('/verbose should toggle', () => {
    const cmd = getCommand('verbose');
    const result = cmd!.handler({ conversationId: null, args: '' });
    expect((result as any).response).toContain('Verbose');
  });

  it('/skills should respond', () => {
    const cmd = getCommand('skills');
    const result = cmd!.handler({ conversationId: null, args: '' });
    expect((result as any).shouldDisplay).toBe(true);
  });

  it('/cron should respond', () => {
    const cmd = getCommand('cron');
    const result = cmd!.handler({ conversationId: null, args: '' });
    expect((result as any).shouldDisplay).toBe(true);
  });

  it('getCommand is case-insensitive', () => {
    expect(getCommand('NEW')).toBeDefined();
    expect(getCommand('Help')).toBeDefined();
  });

  it('registerCommand adds new command', () => {
    registerCommand('test_custom', 'A test command', () => ({
      response: 'custom!',
      shouldDisplay: true,
    }));
    const cmd = getCommand('test_custom');
    expect(cmd).toBeDefined();
    const result = cmd!.handler({ conversationId: null, args: '' });
    expect((result as any).response).toBe('custom!');
  });

  it('/usage should show token usage report', () => {
    const cmd = getCommand('usage');
    expect(cmd).toBeDefined();
    const result = cmd!.handler({ conversationId: null, args: '' });
    expect((result as any).response).toContain('Usage Report');
    expect((result as any).shouldDisplay).toBe(true);
  });

  it('/hooks with no hooks registered', () => {
    const hookLoader = require('../../src/services/hooks/loader');
    hookLoader.getLoadedHooks.mockReturnValue([]);
    const cmd = getCommand('hooks');
    const result = cmd!.handler({ conversationId: null, args: '' });
    expect((result as any).response).toContain('No hooks registered');
  });

  it('/hooks with registered hooks', () => {
    const hookLoader = require('../../src/services/hooks/loader');
    hookLoader.getLoadedHooks.mockReturnValue([
      { name: 'auto-save', event: 'session:end', enabled: true },
      { name: 'notify', event: 'agent:done', enabled: false },
    ]);
    const cmd = getCommand('hooks');
    const result = cmd!.handler({ conversationId: null, args: '' });
    expect((result as any).response).toContain('auto-save');
    expect((result as any).response).toContain('enabled');
    expect((result as any).response).toContain('disabled');
  });
});
