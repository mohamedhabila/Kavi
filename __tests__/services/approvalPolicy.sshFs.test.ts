import { requiresActionApproval } from '../../src/services/remote/approvalPolicy';
import {
  needsApprovalWithContext,
  useApprovalStore,
} from '../../src/services/remote/approvalStore';

// ssh_fs replaced ssh_write_file, ssh_rename_path, ssh_delete_path and ssh_make_directory,
// which always needed approval; the approval lists kept naming the old tools, so the merged
// tool changed a remote host with no approval at all.
describe('ssh_fs approval policy', () => {
  beforeEach(() => {
    useApprovalStore.setState((state) => ({ ...state, allowlist: [] }));
  });

  it.each(['write', 'rename', 'delete', 'mkdir'])('asks before %s on a remote host', (action) => {
    const args = { action, targetId: 'host-1', path: '/srv/app/config.yml', content: 'x' };

    expect(requiresActionApproval('ssh_fs', args)).toBe(true);
    expect(needsApprovalWithContext('ssh_fs', args)).toBe(true);
  });

  it.each(['list', 'read'])('does not ask to %s', (action) => {
    const args = { action, targetId: 'host-1', path: '/srv/app' };

    expect(requiresActionApproval('ssh_fs', args)).toBe(false);
    expect(needsApprovalWithContext('ssh_fs', args)).toBe(false);
  });

  it('asks when the action is missing or unknown', () => {
    expect(requiresActionApproval('ssh_fs', { targetId: 'host-1' })).toBe(true);
    expect(requiresActionApproval('ssh_fs', { action: 'chmod', targetId: 'host-1' })).toBe(true);
  });
});
