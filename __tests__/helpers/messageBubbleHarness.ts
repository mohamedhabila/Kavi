import type { AgentRun } from '../../src/types/agentRun';
import type { Message } from '../../src/types/message';

export const mockMarkedLexer = jest.fn(
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

export const makeMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'msg1',
  role: 'user',
  content: 'Hello world',
  timestamp: Date.now(),
  ...overrides,
});

export const makeAgentRun = (overrides: Partial<AgentRun> = {}): AgentRun => ({
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

export function joinMarkdownCalls() {
  const marked = require('react-native-marked');
  return marked.useMarkdown.mock.calls.map(([value]: [string]) => value).join('');
}

export function getMarkdownCalls(): string[] {
  const marked = require('react-native-marked');
  return marked.useMarkdown.mock.calls.map(([value]: [string]) => value);
}

import { MessageBubble } from '../../src/components/chat/MessageBubble';
import * as Clipboard from 'expo-clipboard';
import { shareTextExport } from '../../src/services/share/localShare';

export { Clipboard, MessageBubble, shareTextExport };

export function installMessageBubbleTestHarness() {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMarkedLexer.mockClear();
  });
}
