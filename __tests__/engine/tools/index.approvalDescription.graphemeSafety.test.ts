const mockRequestToolApproval = jest.fn().mockResolvedValue('denied');

jest.mock('../../../src/services/remote/approvalStore', () => ({
  needsApprovalWithContext: jest.fn().mockReturnValue(true),
  ONE_SHOT_APPROVAL_DECISION_POLICY: 'one-shot',
  requestToolApproval: (...args: unknown[]) => mockRequestToolApproval(...args),
}));

jest.mock('../../../src/services/security/audit', () => ({
  logToolCall: jest.fn(),
}));

jest.mock('../../../src/services/security/permissions', () => ({
  useToolPermissionsStore: {
    getState: () => ({ isAllowed: () => true }),
  },
}));

jest.mock('../../../src/services/executionJournal/toolEffectDispatchLifecycle', () => ({
  dispatchAuthorizedToolEffect: jest.fn(),
  isCodeOwnedEffectFreeInvocation: jest.fn().mockReturnValue(true),
}));

jest.mock('../../../src/engine/tools/toolNameNormalization', () => ({
  isRegisteredToolName: jest.fn().mockReturnValue(true),
  normalizeToolName: (name: string) => name,
  resolveRegisteredToolName: (name: string) => name,
}));

jest.mock('../../../src/engine/tools/toolDispatchRouter', () => ({
  executeToolInner: jest.fn(),
}));

jest.mock('../../../src/engine/toolExecution/toolEffectReceipt', () => ({
  buildToolEffectReceipt: jest.fn(),
}));

jest.mock('../../../src/engine/toolExecution/runtimeExternalToolBinding', () => ({
  resolveRuntimeExternalToolBinding: jest.fn().mockReturnValue(undefined),
}));

jest.mock('../../../src/services/executionJournal/executionRunEffectBarrier', () => ({
  isCodeOwnedExecutionRunId: jest.fn().mockReturnValue(true),
}));

jest.mock('../../../src/engine/toolExecution/modelAuthorityIndependentCompletion', () => ({
  canSettleAfterModelAuthorityChange: jest.fn().mockReturnValue(true),
}));

jest.mock('../../../src/engine/mobileController/toolExecution', () => ({
  executeMobileControllerTool: jest.fn(),
}));

jest.mock('../../../src/engine/mobileController/runtimeExecution', () => ({
  isMobileControllerDeferredExecution: jest.fn().mockReturnValue(false),
}));

jest.mock('../../../src/engine/durability/toolEffectPolicy', () => ({
  isEffectFreeToolPolicy: jest.fn().mockReturnValue(true),
}));

jest.mock('../../../src/services/llm/support/providerErrorClassification', () => ({
  classifyNativeTransportErrorIdentity: jest.fn(),
}));

jest.mock('../../../src/engine/tools/toolExecutionDispatchSupport', () => ({
  buildEffectReconciliationRequiredResult: jest.fn(),
  finalizeEffectReceiptCapture: jest.fn(),
  isModelTurnAuthorityCurrent: jest.fn().mockReturnValue(true),
  isolateExecutorContext: (context: unknown) => context,
  markEffectReconciliationRequired: jest.fn(),
  rejectExpiredModelTurnAuthority: jest.fn(),
  resolveMobileControllerPreDispatchReason: jest.fn(),
  withEffectDispatchObservation: (outcome: unknown) => outcome,
  withPreDispatchObservation: (outcome: unknown) => outcome,
}));

jest.mock('../../../src/engine/toolExecution/toolArgumentJsonRecovery', () => ({
  parseToolArgumentsJson: jest.fn().mockReturnValue({}),
}));

import { executeTool } from '../../../src/engine/tools/index';
import {
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../helpers/graphemeTestFixtures';

describe('executeTool — approval description grapheme safety', () => {
  beforeEach(() => {
    mockRequestToolApproval.mockClear();
  });

  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 200-char args preview budget`, async () => {
      // The description is `Execute toolName(<truncatedArgs>)`; place the cluster so it
      // straddles the 200-char budget applied to the raw JSON args string.
      const filler = buildBoundaryStraddlingText(200, cluster, 100);
      const argsString = JSON.stringify({ note: filler });

      await executeTool('some_tool', argsString, 'conversation-1');

      expect(mockRequestToolApproval).toHaveBeenCalledTimes(1);
      const description = mockRequestToolApproval.mock.calls[0][0].description as string;
      expectGraphemeSafe(description);
      // description is `Execute some_tool(<cut>)` where <cut> is
      // truncateGraphemesWithSuffix(argsString, 200, '…').
      const prefix = 'Execute some_tool(';
      const withoutWrapper = description.slice(prefix.length, -')'.length);
      const cutText = withoutWrapper.slice(0, -'…'.length);
      expect(endsOnGraphemeBoundary(argsString, cutText)).toBe(true);
    });
  }
});
