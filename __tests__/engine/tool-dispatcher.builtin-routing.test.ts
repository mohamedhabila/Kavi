import {
  CONV_ID,
  setupToolDispatcherHarness,
  type ToolDispatcherHarness,
} from '../helpers/toolDispatcherHarness';

let executeTool: ToolDispatcherHarness['executeTool'];
let builtinMod: ToolDispatcherHarness['builtinMod'];
let sessionInspectionMod: ToolDispatcherHarness['sessionInspectionMod'];

beforeEach(() => {
  const harness = setupToolDispatcherHarness();
  executeTool = harness.executeTool;
  builtinMod = harness.builtinMod;
  sessionInspectionMod = harness.sessionInspectionMod;
});

describe('executeTool — builtin routing', () => {
  const builtinTools: Array<
    [
      string,
      string,
      'builtin' | 'session',
      (
        | keyof ToolDispatcherHarness['builtinMod']
        | keyof ToolDispatcherHarness['sessionInspectionMod']
      ),
    ]
  > = [
    ['canvas_list', '{}', 'builtin', 'executeCanvasList'],
    ['canvas_read', '{}', 'builtin', 'executeCanvasRead'],
    ['canvas_create', '{"surface":"test"}', 'builtin', 'executeCanvasCreate'],
    ['canvas_update', '{"surface":"test"}', 'builtin', 'executeCanvasUpdate'],
    ['canvas_delete', '{"surface":"test"}', 'builtin', 'executeCanvasDelete'],
    ['canvas_navigate', '{"surface":"test"}', 'builtin', 'executeCanvasNavigate'],
    ['canvas_eval', '{"surface":"test"}', 'builtin', 'executeCanvasEval'],
    ['canvas_snapshot', '{}', 'builtin', 'executeCanvasSnapshot'],
    ['sessions_list', '{}', 'session', 'executeSessionList'],
    ['sessions_history', '{"sessionId":"s1"}', 'session', 'executeSessionHistory'],
    ['sessions_output', '{"sessionId":"s1"}', 'session', 'executeSessionOutput'],
    ['sessions_surface_output', '{"sessionId":"s1"}', 'session', 'executeSessionSurfaceOutput'],
    ['sessions_status', '{"sessionId":"s1"}', 'session', 'executeSessionStatus'],
    ['sessions_wait', '{"sessionId":"s1"}', 'session', 'executeSessionWait'],
    ['sessions_cancel', '{"sessionId":"s1"}', 'session', 'executeSessionCancel'],
    ['wait', '{"ms":100}', 'builtin', 'executeWait'],
    ['pdf_read', '{"path":"test.pdf"}', 'builtin', 'executePdfRead'],
    ['camera_snap', '{}', 'builtin', 'executeCameraSnap'],
    ['audio_transcribe', '{}', 'builtin', 'executeAudioTranscribe'],
    ['memory_search', '{"query":"test"}', 'builtin', 'executeMemorySearch'],
    ['ssh_exec', '{"command":"pwd"}', 'builtin', 'executeSshExec'],
    ['ssh_background_job_status', '{"jobId":"bg-1"}', 'builtin', 'executeSshBackgroundJobStatus'],
    ['ssh_background_job_wait', '{"jobId":"bg-1"}', 'builtin', 'executeSshBackgroundJobWait'],
    ['ssh_list_directory', '{}', 'builtin', 'executeSshListDirectory'],
    ['ssh_read_file', '{"path":"README.md"}', 'builtin', 'executeSshReadFile'],
    ['ssh_write_file', '{"path":"README.md","content":"hello"}', 'builtin', 'executeSshWriteFile'],
    ['ssh_rename_path', '{"oldPath":"a","newPath":"b"}', 'builtin', 'executeSshRenamePath'],
    ['ssh_delete_path', '{"path":"a"}', 'builtin', 'executeSshDeletePath'],
    ['ssh_make_directory', '{"path":"tmp"}', 'builtin', 'executeSshMakeDirectory'],
    ['expo_eas_create_project', '{"name":"Expo App"}', 'builtin', 'executeExpoEasCreateProject'],
    ['expo_eas_status', '{"projectId":"expo-1"}', 'builtin', 'executeExpoEasStatus'],
    ['expo_eas_probe', '{"projectId":"expo-1"}', 'builtin', 'executeExpoEasProbe'],
    ['expo_eas_build', '{"projectId":"expo-1"}', 'builtin', 'executeExpoEasBuild'],
    ['expo_eas_update', '{"projectId":"expo-1"}', 'builtin', 'executeExpoEasUpdate'],
    ['expo_eas_submit', '{"projectId":"expo-1"}', 'builtin', 'executeExpoEasSubmit'],
    ['expo_eas_deploy_web', '{"projectId":"expo-1"}', 'builtin', 'executeExpoEasDeployWeb'],
    ['expo_eas_workflow_runs', '{"projectId":"expo-1"}', 'builtin', 'executeExpoEasWorkflowRuns'],
    [
      'expo_eas_workflow_status',
      '{"projectId":"expo-1"}',
      'builtin',
      'executeExpoEasWorkflowStatus',
    ],
    ['expo_eas_workflow_wait', '{"projectId":"expo-1"}', 'builtin', 'executeExpoEasWorkflowWait'],
    ['expo_eas_graphql', '{"query":"query { __typename }"}', 'builtin', 'executeExpoEasGraphql'],
    ['tool_catalog', '{}', 'builtin', 'executeToolCatalog'],
    ['tool_describe', '{"name":"read_file"}', 'builtin', 'executeToolDescribe'],
    ['poll_create', '{"question":"Pick one","options":["A","B"]}', 'builtin', 'executePollCreate'],
    ['speak', '{"text":"hello"}', 'builtin', 'executeSpeak'],
    ['agents_list', '{}', 'builtin', 'executeAgentsList'],
    ['agents_switch', '{"personaId":"p1"}', 'builtin', 'executeAgentsSwitch'],
    ['agents_configure', '{"name":"test"}', 'builtin', 'executeAgentsConfigure'],
  ];

  it.each(builtinTools)('routes %s', async (toolName, args, moduleName, fnName) => {
    await executeTool(toolName, args, CONV_ID);
    const moduleUnderTest = moduleName === 'session' ? sessionInspectionMod : builtinMod;
    expect(moduleUnderTest[fnName as keyof typeof moduleUnderTest]).toHaveBeenCalled();
  });

  it('passes the current callable tool inventory into tool_catalog', async () => {
    await executeTool('tool_catalog', '{}', CONV_ID, {
      availableToolNames: ['tool_catalog', 'read_file', 'mcp__docs__search_docs'],
    });

    expect(builtinMod.executeToolCatalog).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        availableToolNames: new Set(['tool_catalog', 'read_file', 'mcp__docs__search_docs']),
      }),
    );
  });

  it('passes conversation file context to canvas html tools', async () => {
    await executeTool('canvas_create', '{"filePath":"canvas/preview.html"}', CONV_ID);

    expect(builtinMod.executeCanvasCreate).toHaveBeenCalledWith(
      { filePath: 'canvas/preview.html' },
      expect.objectContaining({
        conversationId: CONV_ID,
        readConversationFile: expect.any(Function),
        listConversationDirectory: expect.any(Function),
      }),
    );
  });
});
