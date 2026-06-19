import { buildToolGoalEvidenceStrings } from '../../../src/engine/goals/toolEvidence';
import { routeToolEvidenceToActiveGoals } from '../../../src/engine/goals/evidenceRouting';

describe('toolEvidence', () => {
  it('builds structural python evidence from normalized tool results', () => {
    const evidence = buildToolGoalEvidenceStrings({
      toolName: 'python',
      content: JSON.stringify({
        status: 'completed',
        files: [{ path: 'reports/analysis.json' }, { path: 'reports/summary.md' }],
      }),
    });

    expect(evidence).toEqual([
      'python:execution:success',
      'python:artifact:reports/analysis.json',
      'python:artifact:reports/summary.md',
    ]);
  });

  it('falls back to truncated generic evidence for non-json python output', () => {
    const evidence = buildToolGoalEvidenceStrings({
      toolName: 'python',
      content: 'plain output',
    });

    expect(evidence).toEqual(['python:plain output']);
  });

  it('records python exit_code in structural evidence tokens', () => {
    const evidence = buildToolGoalEvidenceStrings({
      toolName: 'python',
      content: JSON.stringify({ status: 'completed', exitCode: 0 }),
    });

    expect(evidence).toContain('python:exit_code:0');
  });

  it('builds generic tool evidence for non-python tools', () => {
    const evidence = buildToolGoalEvidenceStrings({
      toolName: 'read_file',
      content: 'file body',
    });

    expect(evidence).toEqual(['read_file:file body']);
  });

  it('adds compact top-level JSON evidence for long generic tool results', () => {
    const evidence = buildToolGoalEvidenceStrings({
      toolName: 'calendar_create_event',
      content: JSON.stringify({
        status: 'created',
        eventId: 'e2e-event-1',
        event: {
          title: 'A'.repeat(260),
        },
      }),
    });

    expect(evidence[0]).toContain('calendar_create_event:');
    expect(evidence[0].length).toBeLessThanOrEqual(230);
    expect(evidence).toContain(
      'calendar_create_event:{"status":"created","eventId":"e2e-event-1"}',
    );
  });

  it('adds bounded nested scalar evidence for structured memory results', () => {
    const evidence = buildToolGoalEvidenceStrings({
      toolName: 'memory_remember',
      content: JSON.stringify({
        ok: true,
        status: 'created',
        fact: {
          id: 'fact-1',
          subject: 'knowu-user',
          predicate: 'preferred_message_contact',
          value: 'Avery',
        },
      }),
    });

    expect(evidence).toContain(
      'memory_remember:{"fact":{"predicate":"preferred_message_contact"}}',
    );
    expect(evidence).toContain('memory_remember:{"fact":{"value":"Avery"}}');
  });

  it('adds compact array length evidence for long generic array results', () => {
    const evidence = buildToolGoalEvidenceStrings({
      toolName: 'photos_latest',
      content: JSON.stringify([
        { id: 'photo-1', uri: 'media-library://photo-1', filename: 'a'.repeat(240) },
        { id: 'photo-2', uri: 'media-library://photo-2', filename: 'b'.repeat(240) },
      ]),
    });

    expect(evidence[0]).toContain('photos_latest:');
    expect(evidence[0].length).toBeLessThanOrEqual(230);
    expect(evidence).toContain('photos_latest:{"length":2}');
    expect(evidence).toContain('photos_latest:[{"id":"photo-1"}]');
  });

  it('emits structural file hash evidence from workspace write results', () => {
    const evidence = buildToolGoalEvidenceStrings({
      toolName: 'write_file',
      content: JSON.stringify({
        status: 'written',
        path: 'artifacts/state-carry.txt',
        size: 17,
        sha256: 'ded15d058dd8e304f816979f5e6b1ac6de4c6bcc183a231941ac1c2f59e77b62',
      }),
    });

    expect(evidence).toContain(
      'write_file:file_hash:artifacts/state-carry.txt:sha256:ded15d058dd8e304f816979f5e6b1ac6de4c6bcc183a231941ac1c2f59e77b62',
    );
    expect(evidence).toContain(
      'write_file:{"status":"written","path":"artifacts/state-carry.txt","size":17,"sha256":"ded15d058dd8e304f816979f5e6b1ac6de4c6bcc183a231941ac1c2f59e77b62"}',
    );
  });

  it('routes matching evidence to blocked goals that later become completable', () => {
    const routed = routeToolEvidenceToActiveGoals({
      toolName: 'contacts_search',
      toolDefinitions: [
        {
          name: 'contacts_search',
          contract: {
            category: 'contacts',
            capabilities: ['read'],
            resourceKinds: ['contacts'],
          },
        },
      ],
      goals: [
        {
          id: 'contact-action',
          title: 'Contact action',
          status: 'blocked',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          completionPolicy: 'blocking',
          successCriteria: ['evidence.json_field:0.id:e2e-contact-avery'],
        },
      ],
      evidenceStrings: ['contacts_search:[{"id":"e2e-contact-avery"}]'],
    });

    expect(routed).toEqual([
      {
        goalId: 'contact-action',
        evidence: 'contacts_search:[{"id":"e2e-contact-avery"}]',
      },
    ]);
  });
});
