import { ALL_NATIVE_TOOL_DEFINITIONS } from '../../src/engine/tools/native/definitions';
import {
  describeToolInvocation,
  getToolTelemetryCategory,
} from '../../src/services/security/toolPrivacy';

describe('tool invocation privacy presentation', () => {
  it('classifies every runtime native tool as native telemetry', () => {
    for (const tool of ALL_NATIVE_TOOL_DEFINITIONS) {
      expect(getToolTelemetryCategory(tool.name)).toBe('native');
    }
  });

  it('redacts native sensitive arguments into structural metadata', () => {
    const cases: Array<{
      toolName: string;
      args: Record<string, unknown>;
      forbidden: string[];
      expected: Record<string, unknown>;
    }> = [
      {
        toolName: 'calendar_create_event',
        args: {
          title: 'Therapy intake with Dr. Ames',
          location: '221 Private Lane',
          notes: 'Insurance number ABC-123',
          startDate: '2026-06-12T10:00:00Z',
          endDate: '2026-06-12T11:00:00Z',
        },
        forbidden: ['Therapy intake', '221 Private Lane', 'ABC-123', '2026-06-12T10:00:00Z'],
        expected: { hasTitle: true, hasLocation: true, hasNotes: true, hasStartDate: true },
      },
      {
        toolName: 'clipboard_write',
        args: { text: 'bank-token-7442' },
        forbidden: ['bank-token-7442'],
        expected: { textLength: 15 },
      },
      {
        toolName: 'notification_schedule',
        args: { title: 'Call oncology', body: 'Ask about scan result', delaySeconds: 600 },
        forbidden: ['Call oncology', 'scan result'],
        expected: { hasTitle: true, hasBody: true, delaySeconds: 600 },
      },
      {
        toolName: 'notification_cancel',
        args: { id: 'private-notification-id' },
        forbidden: ['private-notification-id'],
        expected: { hasId: true },
      },
      {
        toolName: 'calendar_update_event',
        args: { id: 'private-event-id', title: 'Therapy follow-up' },
        forbidden: ['private-event-id', 'Therapy follow-up'],
        expected: { hasId: true, hasTitle: true },
      },
      {
        toolName: 'photos_latest',
        args: { count: 4 },
        forbidden: [],
        expected: { count: 4 },
      },
      {
        toolName: 'screen_record',
        args: { format: 'jpeg' },
        forbidden: [],
        expected: { format: 'jpeg' },
      },
    ];

    for (const entry of cases) {
      const presentation = describeToolInvocation(entry.toolName, entry.args);
      const redacted = JSON.parse(presentation.redactedArguments);
      expect(redacted).toEqual(expect.objectContaining(entry.expected));
      expect(redacted).not.toHaveProperty('argumentCount');

      const serializedPresentation = JSON.stringify({
        description: presentation.description,
        redactedArguments: presentation.redactedArguments,
      });
      for (const forbidden of entry.forbidden) {
        expect(serializedPresentation).not.toContain(forbidden);
      }
    }
  });

  it('keeps native permission and device queries structural', () => {
    expect(JSON.parse(describeToolInvocation('device_permissions', {}).redactedArguments)).toEqual(
      {},
    );
    expect(
      JSON.parse(describeToolInvocation('device_query', { kind: 'permissions' }).redactedArguments),
    ).toEqual({ kind: 'permissions' });
    expect(JSON.parse(describeToolInvocation('location_current', {}).redactedArguments)).toEqual(
      {},
    );
    expect(
      JSON.parse(describeToolInvocation('camera_clip', { camera: 'front' }).redactedArguments),
    ).toEqual({
      camera: 'front',
    });
  });
});
