import { buildDelegatedInitialMessages } from '../../src/engine/tools/builtin-session-prompt';
import { discoverDelegatedWorkspaceInputs } from '../../src/engine/tools/builtin-session-workspace-inputs';
import type { Message } from '../../src/types/message';

describe('delegated worker prompt inputs', () => {
  it('places exact attachment workspace paths in the worker instruction text', () => {
    const sourceMessage: Message = {
      id: 'user-1',
      role: 'user',
      content: 'Review the archive.',
      timestamp: 1,
      attachments: [
        {
          id: 'attachment-1',
          type: 'file',
          uri: 'file:///private/input.zip',
          name: 'input.zip',
          mimeType: 'application/zip',
          size: 123,
          base64: 'must-not-propagate',
          workspacePath: 'attachments/files/attachment-1-input.zip',
        },
      ],
    };

    const messages = buildDelegatedInitialMessages('Inspect the supplied input.', sourceMessage);

    expect(messages).toHaveLength(1);
    expect(messages?.[0]?.content).toContain('[DELEGATED WORKSPACE INPUTS]');
    expect(messages?.[0]?.content).toContain(
      '{"name":"input.zip","path":"attachments/files/attachment-1-input.zip"}',
    );
    expect(messages?.[0]?.attachments?.[0]?.base64).toBeUndefined();
    expect(messages?.[0]?.attachments?.[0]?.workspacePath).toBe(
      'attachments/files/attachment-1-input.zip',
    );
  });

  it('keeps the worker prompt unchanged when an attachment has no workspace path', () => {
    const sourceMessage: Message = {
      id: 'user-2',
      role: 'user',
      content: 'Listen to this.',
      timestamp: 1,
      attachments: [
        {
          id: 'attachment-2',
          type: 'audio',
          uri: 'file:///private/note.m4a',
          name: 'note.m4a',
          mimeType: 'audio/mp4',
          size: 50,
        },
      ],
    };

    expect(buildDelegatedInitialMessages('Transcribe it.', sourceMessage)?.[0]?.content).toBe(
      'Transcribe it.',
    );
  });

  it('preserves exact discovered paths after the source attachment message is compacted', () => {
    const messages = buildDelegatedInitialMessages('Audit the guide.', undefined, [
      {
        name: 'guide.md',
        path: 'attachments/files/attachment-3-guide.md',
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages?.[0]?.content).toContain('[DELEGATED WORKSPACE INPUTS]');
    expect(messages?.[0]?.content).toContain(
      '{"name":"guide.md","path":"attachments/files/attachment-3-guide.md"}',
    );
    expect(messages?.[0]?.attachments).toBeUndefined();
  });

  it('discovers only a bounded recursive inventory below the attachment root', async () => {
    const listDirectory = jest.fn(async (_conversationId: string, path = '') => {
      if (path === 'attachments') {
        return {
          path,
          entries: [
            { name: 'files', isDirectory: true },
            { name: '../escape.txt', isDirectory: false },
          ],
        };
      }
      if (path === 'attachments/files') {
        return {
          path,
          entries: Array.from({ length: 25 }, (_, index) => ({
            name: `input-${String(index).padStart(2, '0')}.txt`,
            isDirectory: false,
          })),
        };
      }
      return { path, entries: [] };
    });

    const inputs = await discoverDelegatedWorkspaceInputs(
      {
        workspaceConversationId: 'workspace-primary',
        workspaceReadFallbackConversationId: 'workspace-fallback',
      },
      listDirectory,
    );

    expect(inputs).toHaveLength(20);
    expect(inputs[0]).toEqual({
      name: 'input-00.txt',
      path: 'attachments/files/input-00.txt',
    });
    expect(inputs.every((input) => input.path.startsWith('attachments/'))).toBe(true);
    expect(listDirectory).toHaveBeenCalledWith('workspace-primary', 'attachments', [
      'workspace-fallback',
    ]);
  });
});
