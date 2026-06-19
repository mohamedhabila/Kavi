import { inferToolCapabilityDescriptor } from '../../src/engine/tools/capabilityRegistry';
import { BROWSER_WAIT_TOOL } from '../../src/engine/tools/browser-definitions';
import { createGitHubSkill } from '../../src/services/integrations/github/skill';
import {
  getSkillToolDefinitions,
  registerSkill,
  unregisterSkill,
} from '../../src/services/skills/manager';
import { CALENDAR_LIST_TOOL } from '../../src/engine/tools/native/calendar/definitions';
import { ALL_NATIVE_TOOL_DEFINITIONS } from '../../src/engine/tools/native/definitions';
import {
  CLIPBOARD_READ_TOOL,
  CLIPBOARD_TOOL,
  CLIPBOARD_WRITE_TOOL,
} from '../../src/engine/tools/native/clipboard/definitions';
import {
  CONTACTS_GET_TOOL,
  CONTACTS_SEARCH_TOOL,
} from '../../src/engine/tools/native/contacts/definitions';
import {
  DEVICE_STATUS_TOOL,
  DEVICE_PERMISSIONS_TOOL,
} from '../../src/engine/tools/native/device/definitions';
import { LOCATION_CURRENT_TOOL } from '../../src/engine/tools/native/location/definitions';
import {
  MAPS_OPEN_TOOL,
  SMS_COMPOSE_TOOL,
} from '../../src/engine/tools/native/communication/definitions';
import {
  NOTIFICATION_CANCEL_TOOL,
  NOTIFICATION_SCHEDULE_TOOL,
} from '../../src/engine/tools/native/notifications/definitions';
import { SHARE_TEXT_TOOL, SHARE_URL_TOOL } from '../../src/engine/tools/native/share/definitions';
import {
  EXPO_EAS_CREATE_PROJECT_TOOL,
  EXPO_EAS_WORKFLOW_WAIT_TOOL,
} from '../../src/engine/tools/builtin-definitions-expo';
import {
  SSH_BACKGROUND_JOB_WAIT_TOOL,
  SSH_EXEC_TOOL,
} from '../../src/engine/tools/builtin-definitions-ssh';
import { CANVAS_READ_TOOL } from '../../src/engine/tools/builtin-definitions-canvas';
import {
  MEMORY_RECALL_TOOL,
  MEMORY_SEARCH_TOOL,
} from '../../src/engine/tools/builtin-definitions-memory';
import {
  SESSION_SEND_TOOL,
  SESSION_SPAWN_TOOL,
  SESSION_STATUS_TOOL,
  SESSION_WAIT_TOOL,
} from '../../src/engine/tools/builtin-definitions-sessions';
import { PDF_READ_TOOL, WAIT_TOOL } from '../../src/engine/tools/builtin-definitions-utility';
import { TOOL_CATALOG_TOOL } from '../../src/engine/tools/builtin-definitions-coordination';
import { WEB_FETCH_TOOL } from '../../src/engine/tools/web-fetch';
import { WEB_SEARCH_TOOL } from '../../src/engine/tools/web-search';
import {
  WORKSPACE_DELEGATE_TASK_TOOL,
  WORKSPACE_STATUS_TOOL,
} from '../../src/engine/tools/workspace-definitions';
import {
  getRegisteredToolWorkflowContractIssues,
  getToolsMissingExplicitCapabilities,
} from '../../src/engine/tools/validateToolContracts';
import { getToolWorkflowContractIssues } from '../../src/engine/tools/toolWorkflowContracts';

describe('tool capability contracts', () => {
  it('defines explicit contracts for workspace, ssh, browser, canvas, expo, native, wait, memory, pdf, tool catalog, and workflow ledger tools', () => {
    expect(WORKSPACE_STATUS_TOOL.contract).toBeDefined();
    expect(WORKSPACE_DELEGATE_TASK_TOOL.contract).toBeDefined();
    expect(SSH_EXEC_TOOL.contract).toBeDefined();
    expect(SSH_BACKGROUND_JOB_WAIT_TOOL.contract).toBeDefined();
    expect(BROWSER_WAIT_TOOL.contract).toBeDefined();
    expect(CANVAS_READ_TOOL.contract).toBeDefined();
    expect(EXPO_EAS_CREATE_PROJECT_TOOL.contract).toBeDefined();
    expect(EXPO_EAS_WORKFLOW_WAIT_TOOL.contract).toBeDefined();
    expect(CALENDAR_LIST_TOOL.contract).toBeDefined();
    expect(LOCATION_CURRENT_TOOL.contract).toBeDefined();
    expect(CLIPBOARD_TOOL.contract).toBeDefined();
    expect(SHARE_URL_TOOL.contract).toBeDefined();
    expect(DEVICE_STATUS_TOOL.contract).toBeDefined();
    expect(SESSION_WAIT_TOOL.contract).toBeDefined();
    expect(WAIT_TOOL.contract).toBeDefined();
    expect(MEMORY_SEARCH_TOOL.contract).toBeDefined();
    expect(MEMORY_RECALL_TOOL.contract).toBeDefined();
    expect(PDF_READ_TOOL.contract).toBeDefined();
    expect(TOOL_CATALOG_TOOL.contract).toBeDefined();
    expect(
      createGitHubSkill().tools.find((tool) => tool.name === 'commit_files')?.contract,
    ).toBeDefined();
  });

  it('uses the explicit workspace delegate contract for descriptor inference', () => {
    const descriptor = inferToolCapabilityDescriptor(WORKSPACE_DELEGATE_TASK_TOOL);

    expect(descriptor).toEqual(
      expect.objectContaining({
        category: 'sessions',
        capabilities: expect.arrayContaining(['coordinate', 'write']),
        sideEffects: ['external_run'],
        workflowStages: ['start_external_execution'],
      }),
    );
  });

  it('uses the explicit ssh wait contract for descriptor inference', () => {
    const descriptor = inferToolCapabilityDescriptor(SSH_BACKGROUND_JOB_WAIT_TOOL);

    expect(descriptor).toEqual(
      expect.objectContaining({
        category: 'ssh',
        capabilities: ['monitor', 'wait', 'verify'],
        sideEffects: ['none'],
        workflowStages: [
          'monitor_external_execution',
          'await_external_execution',
          'verify_evidence',
        ],
      }),
    );
  });

  it('uses the explicit session wait contract for descriptor inference', () => {
    const descriptor = inferToolCapabilityDescriptor(SESSION_WAIT_TOOL);

    expect(descriptor).toEqual(
      expect.objectContaining({
        category: 'sessions',
        capabilities: ['wait', 'verify'],
        sideEffects: ['none'],
        workflowStages: ['await_external_execution', 'verify_evidence'],
      }),
    );
  });

  it('uses the explicit browser wait contract for descriptor inference', () => {
    const descriptor = inferToolCapabilityDescriptor(BROWSER_WAIT_TOOL);

    expect(descriptor).toEqual(
      expect.objectContaining({
        category: 'browser',
        capabilities: ['monitor', 'wait', 'verify'],
        sideEffects: ['none'],
        workflowStages: ['monitor_external_execution', 'verify_evidence'],
      }),
    );
  });

  it('uses the explicit canvas read contract for descriptor inference', () => {
    const descriptor = inferToolCapabilityDescriptor(CANVAS_READ_TOOL);

    expect(descriptor).toEqual(
      expect.objectContaining({
        category: 'canvas',
        capabilities: ['discover', 'read', 'verify'],
        sideEffects: ['none'],
        workflowStages: ['inspect_resource', 'verify_evidence'],
      }),
    );
  });

  it('keeps web contracts split between discovery and reading', () => {
    expect(inferToolCapabilityDescriptor(WEB_SEARCH_TOOL)).toEqual(
      expect.objectContaining({
        category: 'web',
        capabilities: ['discover'],
        workflowStages: ['discover_resource'],
      }),
    );

    expect(inferToolCapabilityDescriptor(WEB_FETCH_TOOL)).toEqual(
      expect.objectContaining({
        category: 'web',
        capabilities: ['read', 'verify'],
        workflowStages: ['inspect_resource', 'verify_evidence'],
      }),
    );
  });

  it('uses the explicit expo create-project contract for descriptor inference', () => {
    const descriptor = inferToolCapabilityDescriptor(EXPO_EAS_CREATE_PROJECT_TOOL);

    expect(descriptor).toEqual(
      expect.objectContaining({
        category: 'expo',
        capabilities: ['write'],
        sideEffects: ['remote_mutation'],
        workflowStages: ['guarded_resource_creation', 'mutate_remote_state'],
      }),
    );
  });

  it('uses the explicit expo workflow-wait contract for descriptor inference', () => {
    const descriptor = inferToolCapabilityDescriptor(EXPO_EAS_WORKFLOW_WAIT_TOOL);

    expect(descriptor).toEqual(
      expect.objectContaining({
        category: 'expo',
        capabilities: ['monitor', 'wait', 'verify'],
        sideEffects: ['none'],
        workflowStages: [
          'monitor_external_execution',
          'await_external_execution',
          'verify_evidence',
        ],
      }),
    );
  });

  it('uses the explicit native clipboard contract for descriptor inference', () => {
    const descriptor = inferToolCapabilityDescriptor(CLIPBOARD_TOOL);

    expect(descriptor).toEqual(
      expect.objectContaining({
        category: 'communication',
        capabilities: ['read', 'write', 'verify'],
        sideEffects: ['local_artifact'],
        workflowStages: ['persist_artifact', 'verify_evidence'],
      }),
    );
  });

  it('declares complete mobile-native risk, permission, and recovery metadata', () => {
    for (const tool of ALL_NATIVE_TOOL_DEFINITIONS) {
      const contract = tool.contract;
      expect(contract).toBeDefined();
      expect(contract?.riskLevel).toMatch(/^(low|medium|high|critical)$/);
      expect(Array.isArray(contract?.permissionPrerequisites)).toBe(true);
      expect(Array.isArray(contract?.recoverableErrors)).toBe(true);
      expect(contract?.recoverableErrors?.length).toBeGreaterThan(0);
      expect(contract?.providesEvidence?.length).toBeGreaterThan(0);
      expect(contract?.workflowStages?.length).toBeGreaterThan(0);

      if (!contract?.sideEffects?.includes('none')) {
        expect(contract?.riskHints).toContain('requires_approval');
      }
    }
  });

  it('exposes granular mobile workflow tools through the canonical native runtime catalog', () => {
    const toolNames = ALL_NATIVE_TOOL_DEFINITIONS.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        'device_permissions',
        'contacts_search',
        'contacts_get',
        'clipboard_write',
        'clipboard_read',
        'share_text',
        'notification_schedule',
        'notification_cancel',
      ]),
    );
  });

  it('declares native workflow producer-consumer contracts for current mobile chains', () => {
    expect(DEVICE_PERMISSIONS_TOOL.contract).toEqual(
      expect.objectContaining({
        produces: expect.arrayContaining([
          { kind: 'permission_state', field: 'location.foreground' },
        ]),
        precedes: ['location_current'],
      }),
    );
    expect(LOCATION_CURRENT_TOOL.contract).toEqual(
      expect.objectContaining({
        consumes: [{ kind: 'permission_state', field: 'location.foreground' }],
        produces: [{ kind: 'location' }],
        requiresPermissionEvidence: ['location.foreground'],
      }),
    );
    expect(MAPS_OPEN_TOOL.contract?.consumes).toEqual(
      expect.arrayContaining([{ kind: 'location', required: false }]),
    );
    expect(CONTACTS_SEARCH_TOOL.contract?.produces).toEqual([{ kind: 'contact_candidate' }]);
    expect(CONTACTS_GET_TOOL.contract).toEqual(
      expect.objectContaining({
        consumes: [{ kind: 'contact_candidate' }],
        produces: [{ kind: 'contact_detail' }],
      }),
    );
    expect(SMS_COMPOSE_TOOL.contract?.consumes).toEqual(
      expect.arrayContaining([
        { kind: 'phone_number', required: false },
        { kind: 'contact_candidate', field: 'phoneNumbers', required: false },
      ]),
    );
    expect(CLIPBOARD_WRITE_TOOL.contract).toEqual(
      expect.objectContaining({
        produces: [{ kind: 'clipboard_text' }],
        precedes: ['clipboard_read'],
      }),
    );
    expect(CLIPBOARD_READ_TOOL.contract).toEqual(
      expect.objectContaining({
        consumes: [{ kind: 'clipboard_text' }],
        produces: [{ kind: 'clipboard_text' }],
      }),
    );
    expect(SHARE_TEXT_TOOL.contract?.consumes).toEqual([
      { kind: 'clipboard_text', required: false },
    ]);
    expect(NOTIFICATION_SCHEDULE_TOOL.contract).toEqual(
      expect.objectContaining({
        produces: [{ kind: 'notification_id' }],
        precedes: ['notification_cancel'],
      }),
    );
    expect(NOTIFICATION_CANCEL_TOOL.contract?.consumes).toEqual([{ kind: 'notification_id' }]);
  });

  it('declares delegated session producer-consumer contracts for worker lifecycle chains', () => {
    expect(SESSION_SPAWN_TOOL.contract).toEqual(
      expect.objectContaining({
        produces: [{ kind: 'sub_agent_session' }],
        precedes: ['sessions_wait'],
      }),
    );
    expect(SESSION_SEND_TOOL.contract).toEqual(
      expect.objectContaining({
        produces: [{ kind: 'sub_agent_session' }],
        precedes: ['sessions_wait'],
      }),
    );
    expect(SESSION_STATUS_TOOL.contract).toEqual(
      expect.objectContaining({
        produces: [{ kind: 'sub_agent_session' }],
        precedes: ['sessions_wait'],
      }),
    );
    expect(SESSION_WAIT_TOOL.contract).toEqual(
      expect.objectContaining({
        consumes: [{ kind: 'sub_agent_session', required: false }],
      }),
    );
  });

  it('validates registered workflow producer-consumer links', () => {
    expect(getToolsMissingExplicitCapabilities()).toEqual([]);
    expect(getRegisteredToolWorkflowContractIssues()).toEqual([]);
  });

  it('reports dangling required workflow consumers and predecessor links', () => {
    const issues = getToolWorkflowContractIssues([
      {
        name: 'consumer',
        contract: {
          capabilities: ['write'],
          consumes: [{ kind: 'missing_required_resource' }],
          precedes: ['missing_tool'],
        },
      },
    ]);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'dangling_consumer', toolName: 'consumer' }),
        expect.objectContaining({ code: 'dangling_precedes', toolName: 'consumer' }),
      ]),
    );
  });

  it('propagates native risk and permission metadata through descriptor inference', () => {
    const descriptor = inferToolCapabilityDescriptor(LOCATION_CURRENT_TOOL);

    expect(descriptor).toEqual(
      expect.objectContaining({
        category: 'location',
        riskLevel: 'high',
        permissionPrerequisites: ['location.foreground'],
        recoverableErrors: expect.arrayContaining(['permission_denied', 'platform_unavailable']),
      }),
    );
  });

  it('resolves internal native names through canonical explicit contracts', () => {
    expect(inferToolCapabilityDescriptor({ name: 'share_url', description: 'share_url' })).toEqual(
      expect.objectContaining({
        category: 'communication',
        capabilities: ['write', 'verify'],
        sideEffects: ['local_artifact'],
        workflowStages: ['persist_artifact', 'verify_evidence'],
      }),
    );

    expect(
      inferToolCapabilityDescriptor({ name: 'device_status', description: 'device_status' }),
    ).toEqual(
      expect.objectContaining({
        category: 'device',
        capabilities: ['read', 'verify'],
        sideEffects: ['none'],
        workflowStages: ['inspect_resource', 'verify_evidence'],
      }),
    );
  });

  it('propagates explicit contracts through skill tool definitions', () => {
    registerSkill(createGitHubSkill());

    try {
      const commitTool = getSkillToolDefinitions().find(
        (tool) => tool.name === 'skill__github__commit_files',
      );

      expect(commitTool?.contract).toEqual(
        expect.objectContaining({
          category: 'github',
          capabilities: expect.arrayContaining(['write', 'commit', 'push']),
          sideEffects: ['remote_mutation'],
        }),
      );
    } finally {
      unregisterSkill('github');
    }
  });

  it('resolves skill GitHub names through canonical explicit contracts', () => {
    const descriptor = inferToolCapabilityDescriptor({
      name: 'skill__github__commit_files',
      description: '[GitHub] Create a commit',
    });

    expect(descriptor).toEqual(
      expect.objectContaining({
        category: 'github',
        capabilities: ['write', 'commit', 'push'],
        sideEffects: ['remote_mutation'],
        workflowStages: ['persist_artifact', 'mutate_remote_state', 'verify_evidence'],
      }),
    );
  });

  it('uses the explicit generic wait contract for descriptor inference', () => {
    const descriptor = inferToolCapabilityDescriptor(WAIT_TOOL);

    expect(descriptor).toEqual(
      expect.objectContaining({
        category: 'async_wait',
        capabilities: ['wait'],
        sideEffects: ['none'],
        workflowStages: ['await_external_execution'],
      }),
    );
  });

  it('uses explicit memory, pdf, tool catalog, and workflow ledger contracts for descriptor inference', () => {
    expect(inferToolCapabilityDescriptor(MEMORY_SEARCH_TOOL)).toEqual(
      expect.objectContaining({
        category: 'memory_search',
        capabilities: ['discover', 'read'],
        resourceKinds: ['memory'],
        sideEffects: ['none'],
      }),
    );

    expect(inferToolCapabilityDescriptor(MEMORY_RECALL_TOOL)).toEqual(
      expect.objectContaining({
        category: 'memory_search',
        capabilities: ['discover', 'read'],
        resourceKinds: ['memory'],
        sideEffects: ['none'],
      }),
    );

    expect(inferToolCapabilityDescriptor(PDF_READ_TOOL)).toEqual(
      expect.objectContaining({
        category: 'pdf',
        capabilities: ['read', 'verify'],
        workflowStages: ['inspect_resource', 'verify_evidence'],
      }),
    );

    expect(inferToolCapabilityDescriptor(TOOL_CATALOG_TOOL)).toEqual(
      expect.objectContaining({
        category: 'tools',
        capabilities: ['discover'],
        riskHints: ['read_only', 'idempotent'],
      }),
    );
  });
});
