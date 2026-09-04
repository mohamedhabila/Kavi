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
        toolName: 'photos_pick',
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
      {
        toolName: 'reminder',
        args: {
          action: 'create',
          title: 'Take chemo medication',
          notes: 'Pharmacy refill code 99182',
          when: { kind: 'daily', time: '09:00' },
          timezone: 'UTC',
        },
        forbidden: ['Take chemo medication', 'Pharmacy refill code', '99182'],
        expected: { action: 'create', hasTitle: true, hasNotes: true, hasWhen: true },
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

  it('titles the reminder approval dialog per action', () => {
    expect(
      describeToolInvocation('reminder', { action: 'create', title: 'x', when: { kind: 'daily', time: '09:00' } })
        .title,
    ).toBe('Set a reminder');
    expect(describeToolInvocation('reminder', { action: 'update', id: 'r1' }).title).toBe(
      'Update reminder',
    );
    expect(describeToolInvocation('reminder', { action: 'cancel', id: 'r1' }).title).toBe(
      'Cancel reminder',
    );
    expect(describeToolInvocation('reminder', { action: 'list' }).title).toBe('List reminders');
  });

  it('previews the reminder next-fire time without validating it', () => {
    const presentation = describeToolInvocation('reminder', {
      action: 'create',
      title: 'Take out trash',
      when: { kind: 'daily', time: '09:00' },
      timezone: 'UTC',
    });
    expect(presentation.description).toMatch(/fires \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/);

    // An unparsable "when" never throws — the executor is the source of truth for validation.
    const invalid = describeToolInvocation('reminder', { action: 'create', title: 'x', when: 'not an object' });
    expect(invalid.title).toBe('Set a reminder');
  });
});
