import {
  getOperationalEvidenceKind,
  hasOperationalEvidenceFromSources,
  isOperationalEvidenceSourceName,
} from '../../src/services/agents/approvalSignals';

describe('approvalSignals', () => {
  it('classifies local artifact mutations structurally', () => {
    expect(getOperationalEvidenceKind({ sourceName: 'write_file' })).toBe('artifact');
    expect(getOperationalEvidenceKind({ sourceName: 'ssh_fs' })).toBe('artifact');
    expect(getOperationalEvidenceKind({ sourceName: 'share_url' })).toBe('artifact');
    expect(getOperationalEvidenceKind({ sourceName: 'calendar_create_event' })).toBe('artifact');
  });

  it('classifies external runs structurally', () => {
    expect(getOperationalEvidenceKind({ sourceName: 'open_url' })).toBe('external_run');
    expect(getOperationalEvidenceKind({ sourceName: 'notification_send' })).toBe('external_run');
    expect(getOperationalEvidenceKind({ sourceName: 'expo_eas_workflow_status' })).toBe(
      'external_run',
    );
    expect(getOperationalEvidenceKind({ sourceName: 'workspace_delegate_task' })).toBe(
      'external_run',
    );
  });

  it('keeps session tools and workflow-ledger tools out of operational evidence', () => {
    expect(getOperationalEvidenceKind({ sourceName: 'sessions_wait' })).toBeUndefined();
    expect(getOperationalEvidenceKind({ sourceName: 'sessions_output' })).toBeUndefined();
    expect(getOperationalEvidenceKind({ sourceName: 'record_workflow_evidence' })).toBeUndefined();
  });

  it('counts opaque dynamic tool results only when explicitly allowed and previewed', () => {
    expect(
      getOperationalEvidenceKind({
        sourceName: 'skill__acme_ops__release_delivery',
        preview: 'Release deployment completed successfully.',
      }),
    ).toBeUndefined();

    expect(
      getOperationalEvidenceKind({
        sourceName: 'skill__acme_ops__release_delivery',
        preview: 'Release deployment completed successfully.',
        includeOpaqueDynamicToolResults: true,
      }),
    ).toBe('external_run');
  });

  it('surfaces operational evidence from structured result sources', () => {
    expect(
      hasOperationalEvidenceFromSources({
        structuredEvidenceEntries: [
          { status: 'verified', sourceName: 'write_file' },
          { status: 'resolved', toolName: 'open_url' },
        ],
      }),
    ).toBe(true);

    expect(isOperationalEvidenceSourceName('sessions_status')).toBe(false);
  });
});
