import { requiresActionApproval } from '../../src/services/remote/approvalPolicy';

describe('reminder tool approval policy', () => {
  // A reminder is user-requested, fully reversible (update/cancel at any time),
  // and always visible via the tool's own list action — unlike cron it never
  // resumes a conversation or reaches outside the device. No action should
  // require approval.
  it('never requires approval for create', () => {
    expect(
      requiresActionApproval('reminder', {
        action: 'create',
        title: 'Call mom',
        when: { kind: 'daily', time: '09:00' },
      }),
    ).toBe(false);
  });

  it('never requires approval for list', () => {
    expect(requiresActionApproval('reminder', { action: 'list' })).toBe(false);
  });

  it('never requires approval for update', () => {
    expect(requiresActionApproval('reminder', { action: 'update', id: 'r1', title: 'Updated' })).toBe(
      false,
    );
  });

  it('never requires approval for cancel', () => {
    expect(requiresActionApproval('reminder', { action: 'cancel', id: 'r1' })).toBe(false);
  });

  it('never requires approval even with a missing or unrecognized action', () => {
    expect(requiresActionApproval('reminder', {})).toBe(false);
    expect(requiresActionApproval('reminder', { action: 'explode' })).toBe(false);
    expect(requiresActionApproval('reminder')).toBe(false);
  });
});
