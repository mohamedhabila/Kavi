const shellCallbacks: { onData?: (chunk: string) => void } = {};
const mockShellWrite = jest.fn().mockResolvedValue('');
const mockShellClose = jest.fn();
const mockOpenSshShell = jest.fn(async (target: any, onData: (chunk: string) => void) => {
  shellCallbacks.onData = onData;
  return {
    target,
    write: mockShellWrite,
    close: mockShellClose,
  };
});

jest.mock('../../src/services/ssh/connector', () => ({
  openSshShell: (...args: any[]) => mockOpenSshShell(...args),
  getSshTargetLabel: (target: any) => `${target.username}@${target.host}:${target.port}`,
}));

import { useSshSessionStore } from '../../src/services/ssh/sessionStore';

describe('ssh session store', () => {
  const target = {
    id: 'ssh-1',
    name: 'Build box',
    host: 'ssh.example.com',
    port: 22,
    username: 'developer',
    authMode: 'password',
    enabled: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete shellCallbacks.onData;
    useSshSessionStore.setState({ sessions: {} });
  });

  it('opens a shell session and appends shell output', async () => {
    const sessionId = await useSshSessionStore.getState().openShellSession(target as any);
    expect(mockOpenSshShell).toHaveBeenCalledWith(target, expect.any(Function));

    shellCallbacks.onData?.('hello\n');
    const session = useSshSessionStore.getState().sessions[sessionId];
    expect(session.status).toBe('connected');
    expect(session.transcript).toContain('hello');
  });

  it('sends shell commands and updates the transcript', async () => {
    const sessionId = await useSshSessionStore.getState().openShellSession(target as any);
    await useSshSessionStore.getState().sendShellCommand(sessionId, 'ls');

    expect(mockShellWrite).toHaveBeenCalledWith('ls\n');
    expect(useSshSessionStore.getState().sessions[sessionId].transcript).toContain('$ ls');
  });

  it('writes raw shell input without appending a local command transcript', async () => {
    const sessionId = await useSshSessionStore.getState().openShellSession(target as any);
    const transcriptBefore = useSshSessionStore.getState().sessions[sessionId].transcript;

    await useSshSessionStore.getState().writeShellInput(sessionId, 'l');

    expect(mockShellWrite).toHaveBeenCalledWith('l');
    expect(useSshSessionStore.getState().sessions[sessionId].transcript).toBe(transcriptBefore);
  });

  it('closes shell sessions cleanly', async () => {
    const sessionId = await useSshSessionStore.getState().openShellSession(target as any);
    useSshSessionStore.getState().closeShellSession(sessionId);

    expect(mockShellClose).toHaveBeenCalled();
    expect(useSshSessionStore.getState().sessions[sessionId].status).toBe('closed');
  });
});
