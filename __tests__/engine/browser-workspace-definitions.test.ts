// ---------------------------------------------------------------------------
// Tests — Browser + Workspace Tool Definitions
// ---------------------------------------------------------------------------

import { ALL_BROWSER_TOOL_DEFINITIONS } from '../../src/engine/tools/browser-definitions';
import { ALL_WORKSPACE_FILE_TOOL_DEFINITIONS } from '../../src/engine/tools/workspace-definitions';
import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';

describe('ALL_BROWSER_TOOL_DEFINITIONS', () => {
  it('exports exactly 22 browser tools', () => {
    expect(ALL_BROWSER_TOOL_DEFINITIONS).toHaveLength(22);
  });

  const expectedNames = [
    'browser_launch',
    'browser_stop',
    'browser_status',
    'browser_navigate',
    'browser_click',
    'browser_type',
    'browser_press_key',
    'browser_hover',
    'browser_select',
    'browser_drag',
    'browser_wait',
    'browser_screenshot',
    'browser_snapshot',
    'browser_inspect',
    'browser_cookies',
    'browser_storage',
    'browser_evaluate',
    'browser_upload',
    'browser_download',
    'browser_pdf',
    'browser_fill_form',
    'browser_dialog',
  ];

  it('contains all expected browser tool names', () => {
    const names = ALL_BROWSER_TOOL_DEFINITIONS.map((t) => t.name);
    for (const expected of expectedNames) {
      expect(names).toContain(expected);
    }
  });

  it('each tool has name, description, and valid input_schema', () => {
    for (const tool of ALL_BROWSER_TOOL_DEFINITIONS) {
      expect(tool.name).toBeTruthy();
      expect(typeof tool.name).toBe('string');
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe('string');
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.properties).toBeDefined();
      expect(typeof tool.input_schema.properties).toBe('object');
    }
  });

  it('all interaction tools require sessionId', () => {
    const interactionTools = [
      'browser_navigate',
      'browser_click',
      'browser_type',
      'browser_press_key',
      'browser_hover',
      'browser_select',
      'browser_drag',
      'browser_wait',
      'browser_screenshot',
      'browser_snapshot',
      'browser_inspect',
      'browser_cookies',
      'browser_storage',
      'browser_evaluate',
    ];
    for (const name of interactionTools) {
      const tool = ALL_BROWSER_TOOL_DEFINITIONS.find((t) => t.name === name)!;
      expect(tool.input_schema.required).toContain('sessionId');
      expect(tool.input_schema.properties.sessionId).toBeDefined();
    }
  });

  it('browser_navigate requires url', () => {
    const tool = ALL_BROWSER_TOOL_DEFINITIONS.find((t) => t.name === 'browser_navigate')!;
    expect(tool.input_schema.required).toContain('url');
  });

  it('browser_type requires ref and text', () => {
    const tool = ALL_BROWSER_TOOL_DEFINITIONS.find((t) => t.name === 'browser_type')!;
    expect(tool.input_schema.required).toContain('ref');
    expect(tool.input_schema.required).toContain('text');
  });

  it('browser_press_key requires key', () => {
    const tool = ALL_BROWSER_TOOL_DEFINITIONS.find((t) => t.name === 'browser_press_key')!;
    expect(tool.input_schema.required).toContain('key');
  });

  it('browser_click requires ref', () => {
    const tool = ALL_BROWSER_TOOL_DEFINITIONS.find((t) => t.name === 'browser_click')!;
    expect(tool.input_schema.required).toContain('ref');
  });

  it('browser_drag requires startRef and endRef', () => {
    const tool = ALL_BROWSER_TOOL_DEFINITIONS.find((t) => t.name === 'browser_drag')!;
    expect(tool.input_schema.required).toContain('startRef');
    expect(tool.input_schema.required).toContain('endRef');
  });

  it('has no duplicate tool names', () => {
    const names = ALL_BROWSER_TOOL_DEFINITIONS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('ALL_WORKSPACE_FILE_TOOL_DEFINITIONS', () => {
  it('exports exactly 4 workspace tools', () => {
    expect(ALL_WORKSPACE_FILE_TOOL_DEFINITIONS).toHaveLength(4);
  });

  const expectedNames = [
    'workspace_fs',
    'workspace_status',
    'workspace_launch_browser',
    'workspace_delegate_task',
  ];

  it('contains all expected workspace tool names', () => {
    const names = ALL_WORKSPACE_FILE_TOOL_DEFINITIONS.map((t) => t.name);
    for (const expected of expectedNames) {
      expect(names).toContain(expected);
    }
  });

  it('each tool has name, description, and valid input_schema', () => {
    for (const tool of ALL_WORKSPACE_FILE_TOOL_DEFINITIONS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.properties).toBeDefined();
    }
  });

  it('all mutating or target-specific workspace tools expose targetId', () => {
    for (const tool of ALL_WORKSPACE_FILE_TOOL_DEFINITIONS) {
      if (tool.name !== 'workspace_status') {
        expect(tool.input_schema.required).toContain('targetId');
      }
      expect(tool.input_schema.properties.targetId).toBeDefined();
    }
  });

  it('workspace_fs requires action and targetId', () => {
    const tool = ALL_WORKSPACE_FILE_TOOL_DEFINITIONS.find((t) => t.name === 'workspace_fs')!;
    expect(tool.input_schema.required).toContain('action');
    expect(tool.input_schema.required).toContain('targetId');
  });

  it('workspace_delegate_task requires prompt', () => {
    const tool = ALL_WORKSPACE_FILE_TOOL_DEFINITIONS.find(
      (t) => t.name === 'workspace_delegate_task',
    )!;
    expect(tool.input_schema.required).toContain('prompt');
  });

  it('has no duplicate tool names', () => {
    const names = ALL_WORKSPACE_FILE_TOOL_DEFINITIONS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('TOOL_DEFINITIONS integration', () => {
  it('includes all browser tools in TOOL_DEFINITIONS', () => {
    const allNames = TOOL_DEFINITIONS.map((t) => t.name);
    for (const bt of ALL_BROWSER_TOOL_DEFINITIONS) {
      expect(allNames).toContain(bt.name);
    }
  });

  it('includes all workspace tools in TOOL_DEFINITIONS', () => {
    const allNames = TOOL_DEFINITIONS.map((t) => t.name);
    for (const wt of ALL_WORKSPACE_FILE_TOOL_DEFINITIONS) {
      expect(allNames).toContain(wt.name);
    }
  });

  it('has no duplicate tool names across entire registry', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
