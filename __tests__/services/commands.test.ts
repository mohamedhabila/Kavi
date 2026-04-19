// ---------------------------------------------------------------------------
// Tests — Slash Command Parser & Builtins
// ---------------------------------------------------------------------------

import { isSlashCommand, parseCommand } from '../../src/services/commands/parser';

// Must be imported AFTER bus is available (clears hooks)
import { clearInternalHooks } from '../../src/services/events/bus';
import { getCommand, getAllCommands, registerCommand } from '../../src/services/commands/builtins';

beforeEach(() => {
  clearInternalHooks();
});

describe('isSlashCommand', () => {
  it('returns true for slash-prefixed input', () => {
    expect(isSlashCommand('/help')).toBe(true);
    expect(isSlashCommand('  /help')).toBe(true);
  });

  it('returns false for regular text', () => {
    expect(isSlashCommand('hello')).toBe(false);
    expect(isSlashCommand('no slash')).toBe(false);
  });
});

describe('parseCommand', () => {
  it('returns null for non-slash input', () => {
    expect(parseCommand('hello')).toBeNull();
  });

  it('parses command name', () => {
    const result = parseCommand('/help');
    expect(result?.name).toBe('help');
    expect(result?.args).toBe('');
  });

  it('parses command with args', () => {
    const result = parseCommand('/model gpt-5.4');
    expect(result?.name).toBe('model');
    expect(result?.args).toBe('gpt-5.4');
  });

  it('lowercases command name', () => {
    expect(parseCommand('/HELP')?.name).toBe('help');
  });

  it('preserves raw input', () => {
    const input = '  /think high';
    expect(parseCommand(input)?.raw).toBe(input);
  });

  it('handles multiline args', () => {
    const result = parseCommand('/memory search\nmore text');
    expect(result?.args).toBe('search\nmore text');
  });

  it('returns null for bare slash', () => {
    expect(parseCommand('/')).toBeNull();
  });
});

describe('Built-in commands', () => {
  it('registers 13 built-in commands', () => {
    const cmds = getAllCommands();
    expect(cmds.length).toBeGreaterThanOrEqual(13);
  });

  it('each command has name starting with /', () => {
    for (const cmd of getAllCommands()) {
      expect(cmd.name.startsWith('/')).toBe(true);
    }
  });

  describe('/new', () => {
    it('returns new_conversation action', async () => {
      const cmd = getCommand('new');
      expect(cmd).toBeDefined();
      const result = await cmd!.handler({ conversationId: 'test', args: '' });
      expect(result.action).toBe('new_conversation');
    });
  });

  describe('/stop', () => {
    it('returns stop action', () => {
      const cmd = getCommand('stop')!;
      const result = cmd.handler({ conversationId: null, args: '' });
      expect(result).toEqual(expect.objectContaining({ action: 'stop' }));
    });
  });

  describe('/status', () => {
    it('returns session status', () => {
      const result = getCommand('status')!.handler({ conversationId: 'abc', args: '' });
      expect((result as any).response).toContain('Session Status');
      expect((result as any).response).toContain('abc');
    });
  });

  describe('/help', () => {
    it('lists all commands', () => {
      const result = getCommand('help')!.handler({ conversationId: null, args: '' });
      expect((result as any).response).toContain('Available Commands');
    });
  });

  describe('/think', () => {
    it('accepts valid level', () => {
      const result = getCommand('think')!.handler({ conversationId: null, args: 'high' });
      expect((result as any).response).toContain('high');
    });

    it('rejects invalid level', () => {
      const result = getCommand('think')!.handler({ conversationId: null, args: 'invalid' });
      expect((result as any).response).toContain('level is');
    });
  });

  describe('/model', () => {
    it('prompts when no args', () => {
      const result = getCommand('model')!.handler({ conversationId: null, args: '' });
      expect((result as any).response).toContain('Use `/model');
    });

    it('switches model when args given', () => {
      const result = getCommand('model')!.handler({ conversationId: null, args: 'gpt-5.4' });
      expect((result as any).response).toContain('gpt-5.4');
    });
  });

  describe('registerCommand', () => {
    it('adds a custom command', () => {
      registerCommand('test_custom', 'test', () => ({ response: 'ok' }));
      expect(getCommand('test_custom')).toBeDefined();
    });
  });
});
