import { isSlashCommand, parseCommand } from '../../../src/services/commands/parser';

describe('slash command parser', () => {
  it('treats non-string input as not-a-command', () => {
    expect(isSlashCommand(undefined)).toBe(false);
    expect(isSlashCommand(null)).toBe(false);
    expect(isSlashCommand({ text: '/help' })).toBe(false);
  });

  it('returns null when parsing non-string input', () => {
    expect(parseCommand(undefined)).toBeNull();
    expect(parseCommand(null)).toBeNull();
    expect(parseCommand({ text: '/help' })).toBeNull();
  });

  it('still parses valid slash commands', () => {
    expect(isSlashCommand('   /help')).toBe(true);
    expect(parseCommand('   /help now')).toEqual({
      name: 'help',
      args: 'now',
      raw: '   /help now',
    });
  });
});
