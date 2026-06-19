import { needsApprovalWithContext } from '../../src/services/remote/approvalStore';
import { executeTool } from '../../src/engine/tools/index';

jest.mock('../../src/engine/tools/toolDispatchRouter', () => ({
  executeToolInner: jest.fn(async () => '{"calendars":[]}'),
}));

jest.mock('../../src/services/remote/approvalStore', () => {
  const actual = jest.requireActual('../../src/services/remote/approvalStore');
  return {
    ...actual,
    needsApprovalWithContext: jest.fn(() => true),
    requestToolApproval: jest.fn(async () => 'rejected'),
  };
});

describe('E2E eval approval bypass', () => {
  const previous = process.env.RUN_E2E_AGENT_EVAL;

  beforeEach(() => {
    process.env.RUN_E2E_AGENT_EVAL = '1';
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.RUN_E2E_AGENT_EVAL;
    } else {
      process.env.RUN_E2E_AGENT_EVAL = previous;
    }
  });

  it('skips approval gate when RUN_E2E_AGENT_EVAL is set', async () => {
    const result = await executeTool('calendar_list', '{}', 'conv-e2e-approval');
    expect(result).toBe('{"calendars":[]}');
    const { requestToolApproval } = require('../../src/services/remote/approvalStore');
    expect(requestToolApproval).not.toHaveBeenCalled();
  });

  it('still evaluates approval outside E2E eval runtime', () => {
    delete process.env.RUN_E2E_AGENT_EVAL;
    expect(needsApprovalWithContext('calendar_create', { title: 'Test' })).toBe(true);
  });
});