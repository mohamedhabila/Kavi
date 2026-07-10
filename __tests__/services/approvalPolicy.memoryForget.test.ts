import {
  buildAllowlistKey,
  requiresActionApproval,
} from '../../src/services/remote/approvalPolicy';

describe('memory withdrawal approval policy', () => {
  it('requires explicit approval for standalone irreversible withdrawal', () => {
    expect(requiresActionApproval('memory_forget', { factId: 'fact-1' })).toBe(true);
    expect(buildAllowlistKey('memory_forget', { factId: 'fact-1' })).toBe('memory_forget');
  });

  it('does not turn reversible memory management into a withdrawal alias', () => {
    expect(
      requiresActionApproval('memory_manage', { action: 'invalidate', factId: 'fact-1' }),
    ).toBe(false);
    expect(requiresActionApproval('memory_manage', { action: 'forget', factId: 'fact-1' })).toBe(
      false,
    );
  });
});
