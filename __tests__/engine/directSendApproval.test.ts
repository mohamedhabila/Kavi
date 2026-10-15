jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../src/services/events/bus', () => ({ emitAgentEvent: jest.fn() }));
jest.mock('../../src/services/security/audit', () => ({ logToolCall: jest.fn() }));
jest.mock('../../src/services/remote/approvalStore', () => ({
  needsApprovalWithContext: jest.fn(),
  ONE_SHOT_APPROVAL_DECISION_POLICY: {
    persistentApproval: 'forbidden',
    expiryFallback: 'reject',
  },
  requestToolApproval: jest.fn(),
}));
jest.mock('../../src/engine/tools/toolDispatchRouter', () => ({ executeToolInner: jest.fn() }));

import { NativeModules, Platform } from 'react-native';
import { closeExecutionJournalDb } from '../../src/services/executionJournal/database';
import { executeTool } from '../../src/engine/tools';
import { executeToolInner } from '../../src/engine/tools/toolDispatchRouter';
import {
  needsApprovalWithContext,
  requestToolApproval,
} from '../../src/services/remote/approvalStore';
import { useToolPermissionsStore } from '../../src/services/security/permissions';

const sqliteMock = jest.requireMock('expo-sqlite') as { __resetExpoSqliteForTests(): void };
const originalOS = Platform.OS;
const ID = '0|com.whatsapp|1|ana|10123';

beforeEach(() => {
  try {
    closeExecutionJournalDb();
  } catch {}
  sqliteMock.__resetExpoSqliteForTests();
  useToolPermissionsStore.getState().reset();
  jest.mocked(needsApprovalWithContext).mockReset().mockReturnValue(true);
  jest.mocked(requestToolApproval).mockReset().mockResolvedValue('rejected');
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
  NativeModules.KaviNotificationReader = {
    describe: jest.fn().mockResolvedValue({ app: 'WhatsApp', title: 'Ana Lopes' }),
  };
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS });
  delete NativeModules.KaviNotificationReader;
  try {
    closeExecutionJournalDb();
  } catch {}
});

// Approving a direct send is the last thing the person sees before the message goes out, so
// the approval request carries the recipient read from the phone and the exact text.
describe('approving a message Kavi sends directly', () => {
  it('asks with the recipient and the message, and sends nothing when declined', async () => {
    const outcome = await executeTool(
      'notifications_reply',
      JSON.stringify({ id: ID, message: 'Yes, Friday works' }),
      'conversation-1',
      { toolCallId: 'tool-call-reply', executionRunId: 'execution-run-reply' },
    );

    expect(requestToolApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'notifications_reply',
        reviewPresentation: {
          title: 'Reply in WhatsApp to Ana Lopes',
          description: 'Yes, Friday works',
        },
      }),
    );
    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'approval_denied' });
    expect(executeToolInner).not.toHaveBeenCalled();
  });
});
