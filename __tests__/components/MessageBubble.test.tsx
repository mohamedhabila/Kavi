// ---------------------------------------------------------------------------
// Tests — MessageBubble Component
// ---------------------------------------------------------------------------

import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { MessageBubble } from '../../src/components/chat/MessageBubble';
import { AgentRun, Message } from '../../src/types';
import * as Clipboard from 'expo-clipboard';
import { shareTextExport } from '../../src/services/share/localShare';

const mockMarkedLexer = jest.fn(
  (value: string, options?: { tokenizer?: { html?: (src: string) => unknown } }) => {
    const tokens: Array<{ type: string; raw: string; text?: string; lang?: string }> = [];
    const htmlHandler = options?.tokenizer?.html;
    let remaining = value;

    if (remaining.startsWith('<')) {
      const tokenizerResult = htmlHandler ? htmlHandler(remaining) : { type: 'html' };
      if (tokenizerResult !== undefined) {
        return [{ type: 'html', raw: remaining, text: remaining }];
      }

      const firstNewline = remaining.indexOf('\n');
      const htmlLine = firstNewline >= 0 ? remaining.slice(0, firstNewline + 1) : remaining;
      tokens.push({ type: 'paragraph', raw: htmlLine, text: htmlLine.trimEnd() });
      remaining = firstNewline >= 0 ? remaining.slice(firstNewline + 1) : '';
    }

    const codeBlockRe = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRe.exec(remaining)) !== null) {
      if (match.index > cursor) {
        const markdown = remaining.slice(cursor, match.index);
        tokens.push({ type: 'paragraph', raw: markdown, text: markdown });
      }

      tokens.push({
        type: 'code',
        raw: match[0],
        text: match[2] || '',
        lang: match[1]?.trim() || undefined,
      });
      cursor = match.index + match[0].length;
    }

    if (cursor < remaining.length) {
      const markdown = remaining.slice(cursor);
      tokens.push({ type: 'paragraph', raw: markdown, text: markdown });
    }

    return tokens;
  },
);

jest.mock('react-native-marked', () => {
  const React = require('react');
  const { Text } = require('react-native');

  return {
    __esModule: true,
    default: jest.fn(({ value }: { value: string }) =>
      React.createElement(Text, { testID: 'legacy-markdown' }, value),
    ),
    MarkedLexer: (value: string, options?: { tokenizer?: { html?: (src: string) => unknown } }) =>
      mockMarkedLexer(value, options),
    Renderer: class {
      private keyIndex = 0;

      getKey() {
        this.keyIndex += 1;
        return `mock-renderer-key-${this.keyIndex}`;
      }
    },
    useMarkdown: jest.fn((value: string) => [
      React.createElement(Text, { key: `markdown-${value}` }, value),
    ]),
  };
});

// Mock theme
jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      mode: 'dark',
      background: '#000',
      surface: '#111',
      surfaceAlt: '#222',
      panel: '#111',
      header: '#111',
      border: '#333',
      subtleBorder: '#444',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      placeholder: '#555',
      primary: '#0f0',
      onPrimary: '#fff',
      primarySoft: '#030',
      danger: '#f00',
      onDanger: '#fff',
      dangerSoft: '#300',
      success: '#0f0',
      overlay: 'rgba(0,0,0,0.5)',
      userBubble: '#060',
      assistantBubble: '#111',
      inputBackground: '#222',
      inputBorder: '#444',
      codeBackground: '#000',
      link: '#0f0',
      onPrimaryLink: '#bfb',
      toolCard: '#111',
      toolCardHeader: '#222',
      warning: '#ff0',
      warningBackground: '#332800',
      accent: '#0f0',
      info: '#0af',
    },
  }),
  AppPalette: {},
}));

jest.mock('../../src/services/share/localShare', () => ({
  shareTextExport: jest.fn(),
}));

const makeMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'msg1',
  role: 'user',
  content: 'Hello world',
  timestamp: Date.now(),
  ...overrides,
});

const makeAgentRun = (overrides: Partial<AgentRun> = {}): AgentRun => ({
  id: 'run-1',
  userMessageId: 'user-1',
  goal: 'Audit the repository and apply the fix.',
  status: 'running',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_500,
  currentPhase: 'review',
  latestSummary: 'Still verifying the worker output.',
  plan: {
    objective: 'Audit the repository and apply the fix.',
    successCriteria: ['The workflow state is persisted.', 'The workflow widget stays inline.'],
    stopConditions: [
      'Stop when the fix is verified.',
      'Stop if a concrete blocker remains unresolved.',
    ],
    workstreams: [
      {
        id: 'ws-1',
        title: 'Repository audit',
        goal: 'Inspect the current agentic workflow implementation',
      },
    ],
    updatedAt: 1_700_000_000_150,
  },
  summary: {
    assistantTurns: 2,
    startedTools: 2,
    completedTools: 2,
    failedTools: 0,
    spawnedSubAgents: 1,
    durationMs: 12_000,
  },
  phases: [
    { key: 'assess', title: 'Assess', status: 'completed', updatedAt: 1_700_000_000_100 },
    {
      key: 'plan',
      title: 'Plan',
      status: 'completed',
      detail: 'Inspect, patch, and verify.',
      updatedAt: 1_700_000_000_150,
    },
    { key: 'work', title: 'Work', status: 'completed', updatedAt: 1_700_000_000_200 },
    { key: 'review', title: 'Review', status: 'active', updatedAt: 1_700_000_000_400 },
    { key: 'deliver', title: 'Deliver', status: 'pending', updatedAt: 1_700_000_000_500 },
  ],
  checkpoints: [
    {
      id: 'cp-1',
      timestamp: 1_700_000_000_000,
      kind: 'run',
      title: 'Turn started',
      detail: 'Audit the repository and apply the fix.',
    },
    {
      id: 'cp-1b',
      timestamp: 1_700_000_000_100,
      kind: 'tool',
      title: 'Tool started: read_file',
      detail: '{"path":"src/store/useChatStore.ts"}',
    },
    {
      id: 'cp-2',
      timestamp: 1_700_000_000_500,
      kind: 'sub-agent',
      title: 'Worker completed: Backend Architect',
      detail: 'Worker completed the repository scan.',
    },
  ],
  ...overrides,
});

const makePilotEvaluation = (): NonNullable<AgentRun['latestPilotEvaluation']> => ({
  evaluatorVersion: 'pilot-v1',
  evaluatedAt: 1_700_000_000_450,
  objective: 'Audit the repository and apply the fix.',
  completionScore: 4,
  adherenceScore: 4,
  evidenceScore: 3,
  processScore: 4,
  overallScore: 15,
  maxOverallScore: 20,
  approvalThreshold: 15,
  approved: false,
  recommendedAction: 'continue',
  controlAction: 'continue',
  confidence: 'medium',
  summary: 'Continue autonomously while verifying the worker output.',
  rationale: 'The workflow has strong progress, but the final verification is still pending.',
  strengths: ['The repository state is already captured.'],
  gaps: ['The final verification pass has not finished yet.'],
  nextActions: ['Run the final verification pass.'],
  criterionEvaluations: [
    {
      criterion: 'Verification',
      score: 3,
      maxScore: 5,
      status: 'partial',
      rationale: 'Verification is still in progress.',
    },
  ],
});

function joinMarkdownCalls() {
  const marked = require('react-native-marked');
  return marked.useMarkdown.mock.calls.map(([value]: [string]) => value).join('');
}

function getMarkdownCalls(): string[] {
  const marked = require('react-native-marked');
  return marked.useMarkdown.mock.calls.map(([value]: [string]) => value);
}

function getTextContent(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(getTextContent).join('');
  }

  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

describe('MessageBubble', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMarkedLexer.mockClear();
  });

  it('should render user message', () => {
    const { getByText } = render(<MessageBubble message={makeMessage()} />);
    expect(getByText('Hello world')).toBeTruthy();
  });

  it('should render assistant message', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Hi there!' });
    const { getByText } = render(<MessageBubble message={msg} />);
    expect(getByText('Hi there!')).toBeTruthy();
  });

  it('should hide duplicate plain transcript text when a user voice note attachment carries the same transcript', () => {
    const msg = makeMessage({
      role: 'user',
      content: 'Ship the mobile hotfix tonight',
      attachments: [
        {
          id: 'voice-1',
          type: 'audio',
          uri: 'file:///voice-note.m4a',
          name: 'voice-note.m4a',
          mimeType: 'audio/mp4',
          size: 4096,
          durationMs: 4200,
          transcript: 'Ship the mobile hotfix tonight',
          waveformLevels: [0.22, 0.48, 0.36],
        },
      ],
    });

    const { getAllByText, getByTestId } = render(<MessageBubble message={msg} />);

    expect(getByTestId('audio-attachment-card-voice-1')).toBeTruthy();
    expect(getAllByText('Ship the mobile hotfix tonight')).toHaveLength(1);
  });

  it('should hide internal media context from user messages with image attachments', () => {
    const onEdit = jest.fn();
    const msg = makeMessage({
      role: 'user',
      content:
        'What is in this image?\n\n<media_context>\n[Image Attachment #1]\nDescription:\nA long hidden description.\n</media_context>',
      attachments: [
        {
          id: 'user-image-1',
          type: 'image',
          uri: 'file:///mock/documents/workspace/conv-1/user-image-1.png',
          name: 'user-image-1.png',
          mimeType: 'image/png',
          size: 2048,
        },
      ],
    });

    const { getByText, queryByText, getByTestId } = render(
      <MessageBubble message={msg} onEdit={onEdit} />,
    );
    const attachmentStyle = StyleSheet.flatten(getByTestId('message-attachments').props.style);
    const expectedWidth = Math.max(160, Math.floor(Dimensions.get('window').width * 0.88) - 24);

    expect(getByText('What is in this image?')).toBeTruthy();
    expect(getByTestId('message-attachments')).toBeTruthy();
    expect(attachmentStyle.width).toBe(expectedWidth);
    expect(attachmentStyle.overflow).toBe('hidden');
    expect(queryByText(/A long hidden description\./)).toBeNull();

    fireEvent.press(getByTestId('icon-Copy').parent || getByTestId('icon-Copy'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('What is in this image?');

    fireEvent.press(getByTestId('icon-Edit2').parent || getByTestId('icon-Edit2'));
    expect(onEdit).toHaveBeenCalledWith('msg1', 'What is in this image?');
  });

  it('should render assistant image attachments inline and open workspace-backed generated files', () => {
    const onViewFile = jest.fn();
    const onShareWorkspaceFile = jest.fn();
    const msg = makeMessage({
      role: 'assistant',
      content: 'Here is the generated image.',
      attachments: [
        {
          id: 'generated-image-tool-1',
          type: 'image',
          uri: 'file:///mock/documents/workspace/conv-1/generated-image-tool-1.png',
          name: 'generated-image-tool-1.png',
          mimeType: 'image/png',
          size: 4096,
          workspacePath: 'generated-image-tool-1.png',
        },
      ],
    });
    const { getByTestId, getByLabelText, UNSAFE_getByType } = render(
      <MessageBubble
        message={msg}
        onViewFile={onViewFile}
        onShareWorkspaceFile={onShareWorkspaceFile}
      />,
    );
    const { Image } = require('react-native');
    const attachmentStyle = StyleSheet.flatten(getByTestId('message-attachments').props.style);
    const expectedWidth = Math.max(160, Math.floor(Dimensions.get('window').width * 0.96) - 24);

    expect(getByTestId('message-attachments')).toBeTruthy();
    expect(attachmentStyle.width).toBe(expectedWidth);
    expect(attachmentStyle.overflow).toBe('hidden');
    expect(getByTestId('message-attachment-generated-image-tool-1')).toBeTruthy();
    expect(getByTestId('message-attachment-generated-image-tool-1')).toBeTruthy();
    expect(UNSAFE_getByType(Image)).toBeTruthy();

    fireEvent.press(getByTestId('message-attachment-generated-image-tool-1'));
    expect(getByTestId('message-attachment-preview-modal')).toBeTruthy();
    expect(getByTestId('message-attachment-preview-image')).toBeTruthy();

    fireEvent.press(getByTestId('message-attachment-open-file-generated-image-tool-1'));
    expect(onViewFile).toHaveBeenCalledWith('generated-image-tool-1.png');

    fireEvent.press(getByTestId('message-attachment-share-file-generated-image-tool-1'));
    expect(onShareWorkspaceFile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'generated-image-tool-1',
        workspacePath: 'generated-image-tool-1.png',
      }),
    );
  });

  it('should render attachment-only assistant response segments', () => {
    const msg = makeMessage({ role: 'assistant', content: '' });

    const { getByTestId } = render(
      <MessageBubble
        message={msg}
        responseSegments={[
          {
            id: 'segment-image-only',
            messageId: 'assistant-image-only',
            content: '',
            timestamp: Date.now(),
            attachments: [
              {
                id: 'generated-image-tool-2',
                type: 'image',
                uri: 'file:///mock/documents/workspace/conv-1/generated-image-tool-2.png',
                name: 'generated-image-tool-2.png',
                mimeType: 'image/png',
                size: 2048,
                workspacePath: 'generated-image-tool-2.png',
              },
            ],
          },
        ]}
      />,
    );

    expect(getByTestId('message-attachments')).toBeTruthy();
    expect(getByTestId('message-attachment-generated-image-tool-2')).toBeTruthy();
  });

  it('should render worker attachments alongside the sub-agent activity card', () => {
    const onViewFile = jest.fn();
    const msg = makeMessage({
      role: 'assistant',
      content: 'Lifecycle text hidden by the card.',
      attachments: [
        {
          id: 'generated-image-worker-1',
          type: 'image',
          uri: 'file:///mock/documents/workspace/conv-1/generated-worker.png',
          name: 'generated-worker.png',
          mimeType: 'image/png',
          size: 2048,
          workspacePath: 'generated-worker.png',
        },
      ],
      subAgentEvent: {
        type: 'sub-agent',
        event: 'completed',
        snapshot: {
          sessionId: 'sub-worker-1',
          parentConversationId: 'conv-1',
          depth: 1,
          startedAt: Date.now() - 8_000,
          updatedAt: Date.now(),
          status: 'completed',
          sandboxPolicy: 'safe-only',
          output: 'Generated a worker image.',
        },
      },
    });

    const { getByTestId } = render(<MessageBubble message={msg} onViewFile={onViewFile} />);

    expect(getByTestId('sub-agent-card-depth-1')).toBeTruthy();
    expect(getByTestId('message-attachments')).toBeTruthy();
    fireEvent.press(getByTestId('message-attachment-open-file-generated-image-worker-1'));
    expect(onViewFile).toHaveBeenCalledWith('generated-worker.png');
  });

  it('should render the upgraded assistant bubble chrome', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Styled answer' });
    const { getByTestId, getByText } = render(<MessageBubble message={msg} />);

    expect(getByTestId('assistant-bubble-chrome')).toBeTruthy();
    expect(getByText('Assistant')).toBeTruthy();
    expect(getByText('Styled answer')).toBeTruthy();
  });

  it('should render a compact workflow widget and toggle its details', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Implemented the fix.' });
    const { getByTestId, getByText, queryByTestId, queryByText } = render(
      <MessageBubble
        message={msg}
        agentRun={makeAgentRun({ latestPilotEvaluation: makePilotEvaluation() })}
      />,
    );

    expect(getByTestId('agent-workflow-widget')).toBeTruthy();
    expect(getByText('Agent workflow')).toBeTruthy();
    expect(getByTestId('agent-workflow-pilot-chip')).toBeTruthy();
    expect(getByText('Audit the repository and apply the fix.')).toBeTruthy();
    expect(queryByText('Still verifying the worker output.')).toBeNull();
    expect(getByText('Pilot: Continue')).toBeTruthy();
    expect(getByText('Stage: Review')).toBeTruthy();
    expect(getByText('Last tool: Read File')).toBeTruthy();
    expect(getByText('Turn 2')).toBeTruthy();
    expect(queryByTestId('agent-workflow-details')).toBeNull();
    expect(queryByText('Success criteria')).toBeNull();

    fireEvent.press(getByTestId('agent-workflow-toggle'));

    expect(getByTestId('agent-workflow-details')).toBeTruthy();
    expect(getByTestId('agent-workflow-pilot-section')).toBeTruthy();
    expect(getByTestId('agent-workflow-phase-plan')).toBeTruthy();
    expect(getByTestId('agent-workflow-timeline')).toBeTruthy();
    expect(getByText('Confidence: Medium')).toBeTruthy();
    expect(getByText('Score: 15/20')).toBeTruthy();
    expect(getByText('Continue autonomously while verifying the worker output.')).toBeTruthy();
    expect(getByText('Still verifying the worker output.')).toBeTruthy();
    expect(getByText('Success criteria')).toBeTruthy();
    expect(getByText(/The workflow state is persisted\./)).toBeTruthy();
    expect(getByText('Tool started: read_file')).toBeTruthy();

    fireEvent.press(getByTestId('agent-workflow-toggle'));
    expect(queryByTestId('agent-workflow-details')).toBeNull();
  });

  it('should render structured sub-agent activity cards instead of raw lifecycle text', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Fallback lifecycle text that should not be rendered inline.',
      subAgentEvent: {
        type: 'sub-agent',
        event: 'completed',
        snapshot: {
          sessionId: 'sub-1234567890abcdef',
          parentConversationId: 'conv-1',
          parentSessionId: 'sub-root',
          name: 'Backend Architect',
          depth: 2,
          startedAt: Date.now() - 15_000,
          updatedAt: Date.now(),
          status: 'completed',
          sandboxPolicy: 'safe-only',
          output: 'Worker finished the implementation.',
          toolsUsed: ['read_file', 'file_edit'],
          iterations: 2,
        },
      },
    });

    const { getByText, getByTestId, queryByText } = render(<MessageBubble message={msg} />);

    expect(getByText('Backend Architect')).toBeTruthy();
    expect(getByText('Completed')).toBeTruthy();
    expect(getByText('Session sub-1234567890abc...')).toBeTruthy();
    expect(getByTestId('sub-agent-card-depth-2')).toBeTruthy();
    expect(queryByText('Fallback lifecycle text that should not be rendered inline.')).toBeNull();
  });

  it('should render current sub-agent activity from resolved transcript segments', () => {
    const sessionId = 'sub-1234567890abcdef';
    const msg = makeMessage({
      role: 'assistant',
      content: 'Fallback lifecycle text that should not be rendered inline.',
    });

    const { getByText } = render(
      <MessageBubble
        message={msg}
        responseSegments={[
          {
            id: 'segment-sub-agent',
            messageId: 'assistant-sub-agent',
            content: '',
            timestamp: Date.now(),
            subAgentEvent: {
              type: 'sub-agent',
              event: 'started',
              snapshot: {
                sessionId,
                parentConversationId: 'conv-1',
                name: 'Backend Architect',
                depth: 1,
                startedAt: Date.now() - 15_000,
                updatedAt: Date.now(),
                status: 'running',
                sandboxPolicy: 'safe-only',
                currentActivity: 'Reading repository files',
                activeToolName: 'read_file',
              },
            },
          },
        ]}
      />,
    );

    expect(getByText('Reading repository files')).toBeTruthy();
    expect(getByText('read_file')).toBeTruthy();
  });

  it('should update a same-session transcript worker card in place instead of duplicating it', () => {
    const sessionId = 'sub-1234567890abcdef';
    const msg = makeMessage({
      role: 'assistant',
      content: 'Worker lifecycle update',
    });

    const { getAllByTestId, getByText, queryByText } = render(
      <MessageBubble
        message={msg}
        responseSegments={[
          {
            id: 'segment-started',
            messageId: 'assistant-started',
            content: '',
            timestamp: Date.now() - 1,
            subAgentEvent: {
              type: 'sub-agent',
              event: 'started',
              snapshot: {
                sessionId,
                parentConversationId: 'conv-1',
                name: 'Backend Architect',
                depth: 1,
                startedAt: Date.now() - 15_000,
                updatedAt: Date.now() - 1,
                status: 'running',
                sandboxPolicy: 'safe-only',
                currentActivity: 'Inspecting repository files',
              },
            },
          },
          {
            id: 'segment-completed',
            messageId: 'assistant-completed',
            content: '',
            timestamp: Date.now(),
            subAgentEvent: {
              type: 'sub-agent',
              event: 'completed',
              snapshot: {
                sessionId,
                parentConversationId: 'conv-1',
                name: 'Backend Architect',
                depth: 1,
                startedAt: Date.now() - 15_000,
                updatedAt: Date.now(),
                status: 'completed',
                sandboxPolicy: 'safe-only',
                output: 'Worker finished the implementation.',
              },
            },
          },
        ]}
      />,
    );

    expect(getAllByTestId('sub-agent-card-depth-1')).toHaveLength(1);
    expect(getByText('Completed')).toBeTruthy();
    expect(queryByText('Inspecting repository files')).toBeNull();
    expect(getByText('Worker finished the implementation.')).toBeTruthy();
  });

  it('should append same-session worker tool calls beneath the collapsed activity card', () => {
    const sessionId = 'sub-append-tool-history';
    const msg = makeMessage({
      role: 'assistant',
      content: 'Worker lifecycle update',
    });

    const { getAllByTestId, getByText } = render(
      <MessageBubble
        message={msg}
        responseSegments={[
          {
            id: 'segment-started',
            messageId: 'assistant-started',
            content: '',
            timestamp: Date.now() - 1,
            toolCalls: [
              {
                id: 'tc1',
                name: 'read_file',
                arguments: '{"path":"src/store/useChatStore.ts"}',
                status: 'completed',
                result: 'file contents',
              },
            ],
            subAgentEvent: {
              type: 'sub-agent',
              event: 'started',
              snapshot: {
                sessionId,
                parentConversationId: 'conv-1',
                name: 'Backend Architect',
                depth: 1,
                startedAt: Date.now() - 15_000,
                updatedAt: Date.now() - 1,
                status: 'running',
                sandboxPolicy: 'safe-only',
                currentActivity: 'Inspecting repository files',
              },
            },
          },
          {
            id: 'segment-completed',
            messageId: 'assistant-completed',
            content: '',
            timestamp: Date.now(),
            toolCalls: [
              {
                id: 'tc1',
                name: 'read_file',
                arguments: '{"path":"src/store/useChatStore.ts"}',
                status: 'completed',
                result: 'updated file contents',
              },
              {
                id: 'tc2',
                name: 'write_file',
                arguments: '{"path":"src/components/chat/assistantBubbleModel.ts"}',
                status: 'completed',
                result: 'write complete',
              },
            ],
            subAgentEvent: {
              type: 'sub-agent',
              event: 'completed',
              snapshot: {
                sessionId,
                parentConversationId: 'conv-1',
                name: 'Backend Architect',
                depth: 1,
                startedAt: Date.now() - 15_000,
                updatedAt: Date.now(),
                status: 'completed',
                sandboxPolicy: 'safe-only',
                output: 'Worker finished the implementation.',
              },
            },
          },
        ]}
      />,
    );

    expect(getAllByTestId('sub-agent-card-depth-1')).toHaveLength(1);
    expect(getByText('Read File')).toBeTruthy();
    expect(getByText('Write File')).toBeTruthy();
  });

  it('should strip leaked internal Gemini history text from assistant rendering', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: [
        'Previous internal tool call: tool_catalog (category="files").',
        'Previous internal tool result: tool_catalog returned with structured tool catalog data.',
        'Here is the real answer.',
      ].join('\n'),
    });
    const { getByText, queryByText } = render(<MessageBubble message={msg} />);

    expect(getByText('Here is the real answer.')).toBeTruthy();
    expect(queryByText(/Previous internal tool call/)).toBeNull();
    expect(queryByText(/Previous internal tool result/)).toBeNull();
  });

  it('should strip leaked internal Gemini history text when copying assistant content', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: [
        '[Historical context: assistant called tool "tool_catalog" with arguments {}]',
        '[Historical context: tool "tool_catalog" returned: giant blob]',
        'Clean answer.',
      ].join('\n'),
    });
    const { getByTestId } = render(<MessageBubble message={msg} />);

    fireEvent.press(getByTestId('icon-Copy').parent || getByTestId('icon-Copy'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('Clean answer.');
  });

  it('should render markdown through static elements instead of the markdown list wrapper', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Very long **markdown** reply' });
    const { getByText, queryByTestId } = render(<MessageBubble message={msg} />);
    const marked = require('react-native-marked');

    expect(getByText('Very long **markdown** reply')).toBeTruthy();
    expect(marked.useMarkdown).toHaveBeenCalled();
    expect(marked.default).not.toHaveBeenCalled();
    expect(queryByTestId('legacy-markdown')).toBeNull();
  });

  it('should return null for tool messages', () => {
    const msg = makeMessage({ role: 'tool', content: 'tool result' });
    const { toJSON } = render(<MessageBubble message={msg} />);
    expect(toJSON()).toBeNull();
  });

  it('should copy message content on copy press', () => {
    const msg = makeMessage({ content: 'Copy me' });
    const { getByTestId } = render(<MessageBubble message={msg} />);
    const copyIcon = getByTestId('icon-Copy');
    fireEvent.press(copyIcon.parent || copyIcon);
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('Copy me');
  });

  it('should show edit button for user messages', () => {
    const onEdit = jest.fn();
    const msg = makeMessage({ role: 'user', content: 'Edit me' });
    const { getByTestId } = render(<MessageBubble message={msg} onEdit={onEdit} />);
    const editIcon = getByTestId('icon-Edit2');
    expect(editIcon).toBeTruthy();
    fireEvent.press(editIcon.parent || editIcon);
    expect(onEdit).toHaveBeenCalledWith('msg1', 'Edit me');
  });

  it('should show retry button for assistant messages', () => {
    const onRetry = jest.fn();
    const msg = makeMessage({ role: 'assistant', content: 'Retry me' });
    const { getByTestId } = render(<MessageBubble message={msg} onRetry={onRetry} />);
    const retryIcon = getByTestId('icon-RotateCcw');
    fireEvent.press(retryIcon.parent || retryIcon);
    expect(onRetry).toHaveBeenCalledWith('msg1');
  });

  it('should share an assistant response transcript', async () => {
    const msg = makeMessage({ role: 'assistant', content: 'Share me' });
    const { getByTestId } = render(<MessageBubble message={msg} />);

    fireEvent.press(getByTestId('icon-Share2').parent || getByTestId('icon-Share2'));

    await waitFor(() => {
      expect(shareTextExport).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Share me'),
          mimeType: 'text/markdown',
        }),
      );
    });
  });

  it('should not show actions when streaming', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Streaming...' });
    const { queryByTestId } = render(<MessageBubble message={msg} isStreaming={true} />);
    expect(queryByTestId('icon-Copy')).toBeNull();
  });

  it('should show streaming dot when content is empty and streaming', () => {
    const msg = makeMessage({ role: 'assistant', content: '' });
    const { getByLabelText } = render(<MessageBubble message={msg} isStreaming={true} />);
    expect(getByLabelText('Assistant is typing')).toBeTruthy();
  });

  it('should show error badge for error messages', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Failed', isError: true });
    const { getByText } = render(<MessageBubble message={msg} />);
    expect(getByText('Error')).toBeTruthy();
  });

  it('should render reasoning block for assistant with reasoning', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Answer',
      reasoning: 'Let me think about this...',
    });
    const { getByText } = render(<MessageBubble message={msg} />);
    // ThinkingBlock shows "Thinking" label
    expect(getByText('Thinking')).toBeTruthy();
  });

  it('should hide the inline reasoning block when assistant reasoning is only a placeholder', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: '',
      reasoning: '…',
    });
    const { getByLabelText, queryByTestId, queryByText } = render(
      <MessageBubble message={msg} isStreaming={true} />,
    );

    expect(queryByTestId('assistant-inline-reasoning')).toBeNull();
    expect(queryByText('Thinking...')).toBeNull();
    expect(getByLabelText('Assistant is typing')).toBeTruthy();
  });

  it('should hide the inline reasoning block for synthetic tool-status reasoning', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Answer',
      reasoning: 'Using read_file…',
    });
    const { getByText, queryByTestId, queryByText } = render(<MessageBubble message={msg} />);

    expect(queryByTestId('assistant-inline-reasoning')).toBeNull();
    expect(queryByText('Thinking')).toBeNull();
    expect(getByText('Answer')).toBeTruthy();
  });

  it('should render assistant reasoning inline within the response bubble content', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Answer',
      reasoning: 'Let me think about this...',
    });
    const { getByTestId, getByText, queryByTestId } = render(<MessageBubble message={msg} />);

    const contentContainer = getByTestId('assistant-content-container');

    expect(queryByTestId('assistant-reasoning-surface')).toBeNull();
    expect(within(contentContainer).getByTestId('assistant-inline-reasoning')).toBeTruthy();
    expect(getByText('Thinking')).toBeTruthy();
    expect(getByText('Answer')).toBeTruthy();
  });

  it('should render streaming reasoning inline ahead of the response content', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Answer',
      reasoning: 'Need plan',
    });
    const { getByTestId, getByText, queryByTestId } = render(
      <MessageBubble message={msg} isStreaming={true} />,
    );

    const contentContainer = getByTestId('assistant-content-container');

    expect(queryByTestId('assistant-reasoning-surface')).toBeNull();
    expect(within(contentContainer).getByTestId('assistant-inline-reasoning')).toBeTruthy();
    expect(within(contentContainer).getByText('Thinking...')).toBeTruthy();
    expect(within(contentContainer).getByTestId('message-streaming-text')).toBeTruthy();
    expect(within(contentContainer).queryByText('Need plan')).toBeNull();
    expect(getByText('Thinking...')).toBeTruthy();
  });

  it('should render tool calls in assistant messages', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Done',
      toolCalls: [
        {
          id: 'tc1',
          name: 'read_file',
          arguments: '{"path":"test.txt"}',
          status: 'completed',
          result: 'file contents',
        },
      ],
    });
    const { getByText } = render(<MessageBubble message={msg} />);
    expect(getByText('Read File')).toBeTruthy();
  });

  it('should render grouped assistant rounds as one bubble with inline tool order', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Combined response' });
    const { getByText } = render(
      <MessageBubble
        message={msg}
        responseSegments={[
          {
            id: 'segment-1',
            messageId: 'assistant-1',
            content: 'First round',
            toolCalls: [
              {
                id: 'tc1',
                name: 'read_file',
                arguments: '{"path":"test.txt"}',
                status: 'completed',
                result: 'file contents',
              },
            ],
            timestamp: Date.now(),
          },
          {
            id: 'segment-2',
            messageId: 'assistant-2',
            content: 'Second round',
            timestamp: Date.now(),
          },
        ]}
      />,
    );

    expect(getByText('First round')).toBeTruthy();
    expect(getByText('Read File')).toBeTruthy();
    expect(getByText('Second round')).toBeTruthy();
  });

  it('should render a repeated tool status update only once across grouped assistant segments', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Combined response' });
    const { getByText, queryAllByText } = render(
      <MessageBubble
        message={msg}
        responseSegments={[
          {
            id: 'segment-1',
            messageId: 'assistant-1',
            content: 'Checking the file.',
            toolCalls: [
              {
                id: 'tc1',
                name: 'read_file',
                arguments: '{"path":"test.txt"}',
                status: 'pending',
              },
            ],
            timestamp: Date.now(),
          },
          {
            id: 'segment-2',
            messageId: 'assistant-2',
            content: '',
            toolCalls: [
              {
                id: 'tc1',
                name: 'read_file',
                arguments: '{"path":"test.txt"}',
                status: 'running',
                progressText: 'Reading source',
              },
            ],
            timestamp: Date.now() + 1,
          },
          {
            id: 'segment-3',
            messageId: 'assistant-3',
            content: 'Found the issue.',
            toolCalls: [
              {
                id: 'tc1',
                name: 'read_file',
                arguments: '{"path":"test.txt"}',
                status: 'completed',
                result: 'file contents',
              },
            ],
            timestamp: Date.now() + 2,
          },
        ]}
      />,
    );

    expect(getByText('Checking the file.')).toBeTruthy();
    expect(getByText('Found the issue.')).toBeTruthy();
    expect(queryAllByText('Read File')).toHaveLength(1);
  });

  it('should show a working banner while assistant response is streaming', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Creating the files now.',
      toolCalls: [
        {
          id: 'tc1',
          name: 'write_file',
          arguments: '{"path":"game/index.html"}',
          status: 'running',
        },
      ],
    });
    const { getAllByText, getByTestId } = render(<MessageBubble message={msg} isStreaming />);
    expect(getByTestId('assistant-bubble-status-pill')).toBeTruthy();
    expect(getAllByText('Creating game/index.html').length).toBeGreaterThan(0);
  });

  it('should clamp line-heavy streaming content to a recent preview', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: Array.from({ length: 60 }, (_, index) => `line ${index}`).join('\n'),
    });
    const { getByTestId, getByText, queryByText } = render(
      <MessageBubble message={msg} isStreaming />,
    );

    expect(getByTestId('message-streaming-text')).toBeTruthy();
    expect(getByText(/line 59/)).toBeTruthy();
    expect(queryByText(/line 0/)).toBeNull();
  });

  it('should collapse assistant code blocks by default', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Here is the page:\n\n```html\n<div>Hello</div>\n```',
    });
    const { getByText, queryByText } = render(<MessageBubble message={msg} />);

    expect(getByText('Show code')).toBeTruthy();
    expect(queryByText('<div>Hello</div>')).toBeNull();
  });

  it('should expand assistant code blocks on toggle', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Here is the page:\n\n```html\n<div>Hello</div>\n```',
    });
    const { getByText } = render(<MessageBubble message={msg} />);

    fireEvent.press(getByText('Show code'));
    expect(getByText('<div>Hello</div>')).toBeTruthy();
  });

  it('should collapse unterminated fenced code blocks using the markdown lexer', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'Here is the fix:\n\n```ts\nconst x = 1;\nconst y = 2;',
    });
    const { getByText, queryByText } = render(<MessageBubble message={msg} />);

    expect(getByText('Here is the fix:\n\n')).toBeTruthy();
    expect(getByText('Show code')).toBeTruthy();
    expect(queryByText('const x = 1;\nconst y = 2;')).toBeNull();
  });

  it('should preserve later code blocks when malformed html starts the message', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: '<div>\n```ts\nconst x = 1;\n',
    });
    const { getByText } = render(<MessageBubble message={msg} />);

    expect(getByText('<div>')).toBeTruthy();
    expect(getByText('Show code')).toBeTruthy();
  });

  it('should suppress older incomplete assistant segments when a newer malformed retry follows', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Latest malformed partial' });
    const { getByText, queryByText } = render(
      <MessageBubble
        message={msg}
        responseSegments={[
          {
            id: 'segment-incomplete-1',
            messageId: 'assistant-incomplete-1',
            content: 'Old malformed partial',
            timestamp: Date.now(),
            assistantMetadata: {
              kind: 'final',
              completionStatus: 'incomplete',
              finishReason: 'response_failed',
            },
          },
          {
            id: 'segment-incomplete-2',
            messageId: 'assistant-incomplete-2',
            content: 'Latest malformed partial',
            timestamp: Date.now() + 1,
            assistantMetadata: {
              kind: 'final',
              completionStatus: 'incomplete',
              finishReason: 'response_failed',
            },
          },
        ]}
      />,
    );

    expect(queryByText('Old malformed partial')).toBeNull();
    expect(getByText('Latest malformed partial')).toBeTruthy();
  });

  it('should keep very long code blocks collapsed inline without the stale viewer flow', () => {
    const msg = makeMessage({
      role: 'assistant',
      content:
        '```ts\n' + Array.from({ length: 120 }, (_, index) => `line ${index}`).join('\n') + '\n```',
    });
    const { getByText, queryByTestId, queryByText } = render(<MessageBubble message={msg} />);

    expect(queryByTestId('assistant-preview-text')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
    expect(getByText('Show code')).toBeTruthy();
    expect(queryByText(/line 119/)).toBeNull();

    fireEvent.press(getByText('Show code'));

    expect(getByText(/line 119/)).toBeTruthy();
  });

  it('should render long assistant content inline without Show more', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: Array.from({ length: 25 }, (_, index) => `- item ${index}`).join('\n'),
    });
    const { getByTestId, queryByTestId, queryByText } = render(<MessageBubble message={msg} />);

    expect(getByTestId('assistant-content-container')).toBeTruthy();
    expect(queryByTestId('assistant-preview-text')).toBeNull();
    expect(queryByText('Show more…')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
    expect(joinMarkdownCalls()).toContain('- item 24');
  });

  it('should render very long markdown inline without Show more', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: Array.from(
        { length: 300 },
        (_, index) => `paragraph ${index} ${'x'.repeat(40)}`,
      ).join('\n\n'),
    });
    const { getByTestId, queryByTestId, queryByText } = render(<MessageBubble message={msg} />);

    expect(getByTestId('assistant-content-container')).toBeTruthy();
    expect(queryByTestId('assistant-preview-text')).toBeNull();
    expect(queryByText('Show more…')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
    expect(getMarkdownCalls().some((value) => value.includes('paragraph 299'))).toBe(true);
  });

  it('should keep a completed long agent final response inline without Show more', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: Array.from({ length: 30 }, (_, index) => `- item ${index}`).join('\n'),
      assistantMetadata: {
        kind: 'final',
        completionStatus: 'complete',
        finishReason: 'pilot_approved',
      },
    });
    const { getByTestId, getByText, queryByText, queryByTestId } = render(
      <MessageBubble message={msg} agentRun={makeAgentRun({ status: 'completed' })} />,
    );

    expect(getByTestId('assistant-content-container')).toBeTruthy();
    expect(queryByTestId('assistant-preview-text')).toBeNull();
    expect(queryByText('Show more…')).toBeNull();
    expect(getByText(/item 29/)).toBeTruthy();
  });

  it('should use retryMessageId when retrying a merged assistant response', () => {
    const onRetry = jest.fn();
    const msg = makeMessage({ role: 'assistant', content: 'Retry me' });
    const { getByTestId } = render(
      <MessageBubble message={msg} onRetry={onRetry} retryMessageId="assistant-tail" />,
    );

    fireEvent.press(getByTestId('icon-RotateCcw').parent || getByTestId('icon-RotateCcw'));
    expect(onRetry).toHaveBeenCalledWith('assistant-tail');
  });

  it('should render visual decorations for message effects', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Celebrate', effectId: 'confetti' });
    const { getByTestId } = render(<MessageBubble message={msg} />);
    expect(getByTestId('message-effect-confetti')).toBeTruthy();
  });

  it('should not render the stale full response viewer for long assistant content', () => {
    const longContent = 'A'.repeat(8000);
    const msg = makeMessage({ role: 'assistant', content: longContent });
    const { queryByText, queryByTestId } = render(<MessageBubble message={msg} />);

    expect(queryByText('Show more…')).toBeNull();
    expect(queryByTestId('assistant-fullscreen-viewer')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
  });

  it('should render short assistant content without Show more button', () => {
    const msg = makeMessage({ role: 'assistant', content: 'Short response.' });
    const { queryByText, queryByTestId, getByTestId } = render(<MessageBubble message={msg} />);
    expect(queryByText('Show more…')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
    expect(getByTestId('assistant-content-container')).toBeTruthy();
  });

  it('should render long markdown inline without the stale preview viewer flow', () => {
    const longContent = Array.from(
      { length: 250 },
      (_, index) => `paragraph ${index} ${'b'.repeat(40)}`,
    ).join('\n\n');
    const msg = makeMessage({ role: 'assistant', content: longContent });
    const { queryByText, queryByTestId } = render(<MessageBubble message={msg} />);

    expect(queryByText('Show more…')).toBeNull();
    expect(queryByTestId('assistant-preview-text')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
    expect(getMarkdownCalls().some((value) => value.includes('paragraph 249'))).toBe(true);
  });

  it('should render markdown tables inline without preview collapse', () => {
    const tableRows = Array.from(
      { length: 8 },
      (_, index) =>
        `| Risk ${index} | ${index % 2 === 0 ? 'Medium' : 'High'} | Transition from READ_EXTERNAL_STORAGE to the system photo picker, upgrade expo-image-picker support, and audit long-running background workflows for compatibility. |`,
    );
    const msg = makeMessage({
      role: 'assistant',
      content: [
        '### Android 16 Risk Matrix',
        '',
        '| Risk Area | Impact Level | Mitigation Strategy |',
        '| :--- | :--- | :--- |',
        ...tableRows,
      ].join('\n'),
    });
    const { queryByTestId } = render(<MessageBubble message={msg} />);

    expect(queryByTestId('assistant-preview-text')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
    expect(getMarkdownCalls().some((value) => value.includes('Android 16 Risk Matrix'))).toBe(true);
    expect(
      getMarkdownCalls().some((value) =>
        value.includes('Risk Area | Impact Level | Mitigation Strategy'),
      ),
    ).toBe(true);
  });

  it('should fall back to plain text when assistant content exceeds the markdown parse budget', () => {
    const marked = require('react-native-marked');
    const msg = makeMessage({
      role: 'assistant',
      content: 'L'.repeat(40_100),
    });
    const { getByTestId, getByText, queryByTestId } = render(<MessageBubble message={msg} />);

    expect(queryByTestId('assistant-preview-text')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
    expect(marked.useMarkdown).not.toHaveBeenCalled();
    expect(getByTestId('assistant-plain-full')).toBeTruthy();
    expect(getByText('Large response shown as plain text for stability.')).toBeTruthy();
    expect(marked.useMarkdown).not.toHaveBeenCalled();
  });

  it('should warn inline when the response is truncated to the hard render limit', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'T'.repeat(140_100),
    });
    const { getByText, queryByTestId } = render(<MessageBubble message={msg} />);

    expect(queryByTestId('assistant-fullscreen-viewer')).toBeNull();
    expect(queryByTestId('open-full-response-button')).toBeNull();
    expect(getByText('Extremely long response truncated for stability.')).toBeTruthy();
  });
});
