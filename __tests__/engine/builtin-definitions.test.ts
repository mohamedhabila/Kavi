// ---------------------------------------------------------------------------
// Builtin Tool Definitions — tests
// ---------------------------------------------------------------------------

import {
  ALL_BUILTIN_TOOL_DEFINITIONS,
  SESSION_SEND_TOOL,
  SESSION_SURFACE_OUTPUT_TOOL,
} from '../../src/engine/tools/builtin-definitions';

describe('Builtin Tool Definitions', () => {
  it('exports an array of tool definitions', () => {
    expect(Array.isArray(ALL_BUILTIN_TOOL_DEFINITIONS)).toBe(true);
    expect(ALL_BUILTIN_TOOL_DEFINITIONS.length).toBeGreaterThan(0);
  });

  it('all definitions have required fields', () => {
    for (const def of ALL_BUILTIN_TOOL_DEFINITIONS) {
      expect(def).toHaveProperty('name');
      expect(def).toHaveProperty('description');
      expect(typeof def.name).toBe('string');
      expect(typeof def.description).toBe('string');
      expect(def.name.length).toBeGreaterThan(0);
    }
  });

  it('canvas tools expose explicit contracts', () => {
    for (const name of [
      'canvas_list',
      'canvas_read',
      'canvas_create',
      'canvas_update',
      'canvas_delete',
      'canvas_navigate',
      'canvas_eval',
      'canvas_snapshot',
    ]) {
      expect(ALL_BUILTIN_TOOL_DEFINITIONS.find((d) => d.name === name)?.contract).toBeDefined();
    }
  });

  it('expo tools expose explicit contracts', () => {
    for (const name of [
      'expo_eas_create_project',
      'expo_eas_list_projects',
      'expo_eas_status',
      'expo_eas_probe',
      'expo_eas_build',
      'expo_eas_update',
      'expo_eas_submit',
      'expo_eas_deploy_web',
      'expo_eas_workflow_runs',
      'expo_eas_workflow_status',
      'expo_eas_workflow_wait',
      'expo_eas_graphql',
    ]) {
      expect(ALL_BUILTIN_TOOL_DEFINITIONS.find((d) => d.name === name)?.contract).toBeDefined();
    }
  });

  it('includes canvas tools', () => {
    const names = ALL_BUILTIN_TOOL_DEFINITIONS.map((d) => d.name);
    expect(names).toContain('canvas_list');
    expect(names).toContain('canvas_read');
    expect(names).toContain('canvas_create');
    expect(names).toContain('canvas_update');
    expect(names).toContain('canvas_delete');
  });

  it('describes session-first canvas workflow', () => {
    const canvasCreate = ALL_BUILTIN_TOOL_DEFINITIONS.find((d) => d.name === 'canvas_create');
    const canvasRead = ALL_BUILTIN_TOOL_DEFINITIONS.find((d) => d.name === 'canvas_read');
    const canvasNavigate = ALL_BUILTIN_TOOL_DEFINITIONS.find((d) => d.name === 'canvas_navigate');
    const canvasList = ALL_BUILTIN_TOOL_DEFINITIONS.find((d) => d.name === 'canvas_list');

    expect(canvasCreate?.description).toContain('canvas surface');
    expect(canvasCreate?.description).toContain('content');
    expect(canvasCreate?.description).toContain('filePath');
    expect(canvasCreate?.description).toContain('directoryPath');
    expect(canvasRead?.description).toContain('live DOM');
    expect(canvasNavigate?.description).toContain('http or https');
    expect(canvasNavigate?.description).toContain('local files');
    expect(canvasList?.description).toContain('current session');
  });

  it('includes session tools', () => {
    const names = ALL_BUILTIN_TOOL_DEFINITIONS.map((d) => d.name);
    expect(names).toContain('sessions_list');
    expect(names).toContain('sessions_send');
    expect(names).toContain('sessions_output');
    expect(names).toContain('sessions_surface_output');
    expect(names).toContain('sessions_wait');
    expect(names).toContain('sessions_cancel');
  });

  it('documents sessions_surface_output as a direct-delivery tool with optional boundaries', () => {
    expect(SESSION_SURFACE_OUTPUT_TOOL.description).toContain(
      'visible assistant answer without retyping it',
    );
    expect(SESSION_SURFACE_OUTPUT_TOOL.description).toContain('markers');
    expect(SESSION_SURFACE_OUTPUT_TOOL.description).toContain('prefix');
    expect(SESSION_SURFACE_OUTPUT_TOOL.input_schema.properties).toHaveProperty('sessionId');
    expect(SESSION_SURFACE_OUTPUT_TOOL.input_schema.properties).toHaveProperty('prefix');
    expect(SESSION_SURFACE_OUTPUT_TOOL.input_schema.properties).toHaveProperty('suffix');
    expect(SESSION_SURFACE_OUTPUT_TOOL.input_schema.properties).toHaveProperty('startMarker');
    expect(SESSION_SURFACE_OUTPUT_TOOL.input_schema.properties).toHaveProperty('endMarker');
  });

  it('includes media tools', () => {
    const names = ALL_BUILTIN_TOOL_DEFINITIONS.map((d) => d.name);
    expect(names).toContain('pdf_read');
    expect(names).toContain('camera_snap');
    expect(names).toContain('audio_transcribe');
  });

  it('includes memory search tool', () => {
    const names = ALL_BUILTIN_TOOL_DEFINITIONS.map((d) => d.name);
    expect(names).toContain('memory_search');
  });

  it('includes SSH remote tools', () => {
    const names = ALL_BUILTIN_TOOL_DEFINITIONS.map((d) => d.name);
    expect(names).toContain('ssh_exec');
    expect(names).toContain('ssh_background_job_status');
    expect(names).toContain('ssh_background_job_wait');
    expect(names).toContain('ssh_fs');
  });

  it('has unique tool names', () => {
    const names = ALL_BUILTIN_TOOL_DEFINITIONS.map((d) => d.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('all tools have input_schema defined', () => {
    for (const def of ALL_BUILTIN_TOOL_DEFINITIONS) {
      expect(def).toHaveProperty('input_schema');
      expect(def.input_schema).toHaveProperty('type', 'object');
      expect(def.input_schema).toHaveProperty('properties');
    }
  });

  it('sessions_send mirrors the background-first wait contract', () => {
    expect(SESSION_SEND_TOOL.description).toContain('background');
    expect(SESSION_SEND_TOOL.description).toContain('waitForCompletion=true');
    expect(SESSION_SEND_TOOL.input_schema.properties).toHaveProperty('waitForCompletion');
    expect(SESSION_SEND_TOOL.input_schema.properties).toHaveProperty('waitTimeoutMs');
  });

  it('sessions_wait keeps the blocking contract and bounded default wait window', () => {
    const sessionsWait = ALL_BUILTIN_TOOL_DEFINITIONS.find((d) => d.name === 'sessions_wait');

    expect(sessionsWait?.description).toContain('Block until one or more sub-agent sessions');
    expect(sessionsWait?.description).toContain('wait for all currently running child sessions');
    expect(sessionsWait?.input_schema.properties.waitTimeoutMs.description).toContain(
      '3-minute default wait window',
    );
  });

  it('canvas_update includes focused update fields for html and component canvases', () => {
    const canvasUpdate = ALL_BUILTIN_TOOL_DEFINITIONS.find((d) => d.name === 'canvas_update');
    expect(canvasUpdate).toBeDefined();
    const props = canvasUpdate!.input_schema.properties;
    expect(props).toHaveProperty('content');
    expect(props.content.type).toBe('string');
    expect(props).toHaveProperty('filePath');
    expect(props.filePath.type).toBe('string');
    expect(props).toHaveProperty('directoryPath');
    expect(props.directoryPath.type).toBe('string');
    expect(props).toHaveProperty('entryFile');
    expect(props.entryFile.type).toBe('string');
    expect(props).toHaveProperty('contentEdits');
    expect(props).toHaveProperty('componentOperations');
    expect(canvasUpdate!.description).toContain('contentEdits');
    expect(canvasUpdate!.description).toContain('componentOperations');
    expect(canvasUpdate!.description).toContain('filePath');
    expect(canvasUpdate!.description).toContain('directoryPath');
  });
});
