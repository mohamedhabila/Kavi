import { createForegroundCommandResultController } from '../../src/engine/graph/foregroundRun/commandResultController';
import type { Conversation } from '../../src/types/conversation';

const mockExportConversationAsMarkdown = jest.fn(() => '# Exported');
const mockShareTextExport = jest.fn().mockResolvedValue({
  fileName: 'Test_Chat.md',
  fileUri: 'file:///tmp/Test_Chat.md',
});

jest.mock('../../src/services/session/manager', () => ({
  exportConversationAsMarkdown: (...args: unknown[]) => mockExportConversationAsMarkdown(...args),
}));

jest.mock('../../src/services/share/localShare', () => ({
  shareTextExport: (...args: unknown[]) => mockShareTextExport(...args),
}));

function createConversation(): Conversation {
  return {
    id: 'conv1',
    title: 'Test Chat',
    mode: 'agentic',
    providerId: 'openai',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    usage: {
      entries: [],
      totalInput: 0,
      totalOutput: 0,
      totalCost: 0,
    },
  };
}

function createHarness(overrides: { conversation?: Conversation } = {}) {
  const actions = {
    appendConversationLog: jest.fn(),
    ensureCanonicalConversation: jest.fn(),
    updateAssistantMessage: jest.fn(),
  };

  const controller = createForegroundCommandResultController({
    accessors: {
      getConversation: () => overrides.conversation,
      getCurrentAssistantMessageId: () => 'assistant-1',
    },
    actions,
    exportDialogTitle: 'Export conversation',
    mode: 'agentic',
    personaId: 'super-agent',
  });

  return {
    actions,
    controller,
  };
}

describe('foreground command result controller', () => {
  beforeEach(() => {
    mockExportConversationAsMarkdown.mockClear();
    mockShareTextExport.mockClear();
  });

  it('updates the active assistant turn and shares markdown exports outside the screen layer', async () => {
    const conversation = createConversation();
    const harness = createHarness({ conversation });

    await harness.controller.handleCommandResult({
      action: 'export',
      response: 'Exporting conversation...',
    });

    expect(harness.actions.updateAssistantMessage).toHaveBeenCalledWith(
      'assistant-1',
      'Exporting conversation...',
    );
    expect(harness.actions.appendConversationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'command',
        level: 'success',
        title: 'Command result: export',
        detail: 'Exporting conversation...',
      }),
    );
    expect(mockExportConversationAsMarkdown).toHaveBeenCalledWith(conversation);
    expect(mockShareTextExport).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '# Exported',
        fileName: 'Test_Chat.md',
        dialogTitle: 'Export conversation',
        mimeType: 'text/markdown',
      }),
    );
  });

  it('requests a fresh canonical conversation for new-conversation command results', async () => {
    const harness = createHarness();

    await harness.controller.handleCommandResult({
      action: 'new_conversation',
      response: 'Starting new conversation...',
    });

    expect(harness.actions.ensureCanonicalConversation).toHaveBeenCalledWith({
      personaId: 'super-agent',
      mode: 'agentic',
      reportMissingProvider: true,
    });
    expect(mockShareTextExport).not.toHaveBeenCalled();
  });

  it('skips export sharing when the conversation is unavailable', async () => {
    const harness = createHarness();

    await harness.controller.handleCommandResult({
      action: 'export',
      response: 'Exporting conversation...',
    });

    expect(mockExportConversationAsMarkdown).not.toHaveBeenCalled();
    expect(mockShareTextExport).not.toHaveBeenCalled();
  });
});
