/**
 * Browser automation tool definitions for remote browser sessions.
 *
 * These tools allow the AI agent to control a live remote browser session
 * (launched via Browserbase or Browserless) with navigation, interaction,
 * screenshot, snapshot (page content), observation, and state management.
 */

import type { ToolDefinition } from '../../types';

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export const BROWSER_NAVIGATE_TOOL: ToolDefinition = {
  name: 'browser_navigate',
  description:
    'Navigate the remote browser to a URL. Requires an active browser session. ' +
    'Returns the final URL after any redirects.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID (from browser_launch)' },
      url: { type: 'string', description: 'URL to navigate to' },
    },
    required: ['sessionId', 'url'],
  },
};

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

export const BROWSER_CLICK_TOOL: ToolDefinition = {
  name: 'browser_click',
  description:
    'Click an element in the remote browser. Use element references from browser_snapshot ' +
    'or CSS selectors. Supports double-click and right-click.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      ref: { type: 'string', description: 'Element reference or selector to click' },
      doubleClick: { type: 'boolean', description: 'Double-click instead of single click' },
      button: {
        type: 'string',
        enum: ['left', 'right', 'middle'],
        description: 'Mouse button (default: left)',
      },
    },
    required: ['sessionId', 'ref'],
  },
};

export const BROWSER_TYPE_TOOL: ToolDefinition = {
  name: 'browser_type',
  description:
    'Type text into an input element in the remote browser. Optionally submit the form after typing.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      ref: { type: 'string', description: 'Element reference or selector for the input' },
      text: { type: 'string', description: 'Text to type' },
      submit: { type: 'boolean', description: 'Press Enter after typing to submit' },
      slowly: {
        type: 'boolean',
        description: 'Type one character at a time (for JS-heavy inputs)',
      },
    },
    required: ['sessionId', 'ref', 'text'],
  },
};

export const BROWSER_PRESS_KEY_TOOL: ToolDefinition = {
  name: 'browser_press_key',
  description:
    'Press a keyboard key in the remote browser. Use key names like "Enter", "Tab", "Escape", "ArrowDown", etc.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      key: {
        type: 'string',
        description: 'Key to press (e.g. "Enter", "Tab", "Escape", "ArrowDown")',
      },
    },
    required: ['sessionId', 'key'],
  },
};

export const BROWSER_HOVER_TOOL: ToolDefinition = {
  name: 'browser_hover',
  description: 'Hover over an element in the remote browser.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      ref: { type: 'string', description: 'Element reference or selector to hover' },
    },
    required: ['sessionId', 'ref'],
  },
};

export const BROWSER_SELECT_TOOL: ToolDefinition = {
  name: 'browser_select',
  description: 'Select one or more options from a <select> dropdown in the remote browser.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      ref: { type: 'string', description: 'Element reference or selector for the select element' },
      values: { type: 'array', items: { type: 'string' }, description: 'Option values to select' },
    },
    required: ['sessionId', 'ref', 'values'],
  },
};

export const BROWSER_DRAG_TOOL: ToolDefinition = {
  name: 'browser_drag',
  description: 'Drag an element from one position to another in the remote browser.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      startRef: { type: 'string', description: 'Element reference to drag from' },
      endRef: { type: 'string', description: 'Element reference to drag to' },
    },
    required: ['sessionId', 'startRef', 'endRef'],
  },
};

// ---------------------------------------------------------------------------
// Wait
// ---------------------------------------------------------------------------

export const BROWSER_WAIT_TOOL: ToolDefinition = {
  name: 'browser_wait',
  description:
    'Wait for a condition in the remote browser: specific text to appear/disappear, ' +
    'a selector to become visible, a URL pattern, or a fixed delay.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      timeMs: { type: 'number', description: 'Fixed wait time in milliseconds' },
      text: { type: 'string', description: 'Wait for this text to appear on the page' },
      textGone: { type: 'string', description: 'Wait for this text to disappear from the page' },
      selector: { type: 'string', description: 'Wait for this CSS selector to be visible' },
      url: { type: 'string', description: 'Wait for the page URL to match this pattern' },
      loadState: {
        type: 'string',
        enum: ['load', 'domcontentloaded', 'networkidle'],
        description: 'Wait for this page load state',
      },
    },
    required: ['sessionId'],
  },
};

// ---------------------------------------------------------------------------
// Screenshot & Snapshot
// ---------------------------------------------------------------------------

export const BROWSER_SCREENSHOT_TOOL: ToolDefinition = {
  name: 'browser_screenshot',
  description:
    'Take a screenshot of the remote browser page. Returns the image as base64. ' +
    'Optionally capture a specific element or the full scrollable page.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      fullPage: {
        type: 'boolean',
        description: 'Capture the full scrollable page (not just viewport)',
      },
      ref: { type: 'string', description: 'Element reference to capture (instead of full page)' },
      type: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format (default: png)' },
    },
    required: ['sessionId'],
  },
};

export const BROWSER_SNAPSHOT_TOOL: ToolDefinition = {
  name: 'browser_snapshot',
  description:
    'Get the current page content as a text snapshot (accessibility/ARIA tree). ' +
    'Returns a structured representation of the page that is useful for understanding ' +
    'page layout, finding elements, and planning interactions.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      maxChars: {
        type: 'number',
        description: 'Maximum characters in the snapshot (default: 200000)',
      },
    },
    required: ['sessionId'],
  },
};

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

export const BROWSER_INSPECT_TOOL: ToolDefinition = {
  name: 'browser_inspect',
  description:
    'Inspect runtime diagnostics from a remote browser session. ' +
    'Use kind to choose: console (console messages, optional level filter), errors (uncaught exceptions, optional clear), or network (XHR/fetch requests, optional substring filter and clear).',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      kind: {
        type: 'string',
        enum: ['console', 'errors', 'network'],
        description: 'Diagnostic kind to fetch.',
      },
      level: {
        type: 'string',
        description: 'Console level filter (log, warn, error, info). Used when kind=console.',
      },
      filter: {
        type: 'string',
        description: 'URL substring filter. Used when kind=network.',
      },
      clear: {
        type: 'boolean',
        description: 'Clear the buffer after reading. Used when kind=errors or kind=network.',
      },
    },
    required: ['sessionId', 'kind'],
  },
};

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

export const BROWSER_COOKIES_TOOL: ToolDefinition = {
  name: 'browser_cookies',
  description: 'Get, set, or clear cookies in the remote browser session.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      action: {
        type: 'string',
        enum: ['get', 'set', 'clear'],
        description: 'Cookie action to perform',
      },
      cookie: {
        type: 'object',
        description: 'Cookie to set (required for "set" action)',
        properties: {
          name: { type: 'string' },
          value: { type: 'string' },
          domain: { type: 'string' },
          path: { type: 'string' },
        },
      },
    },
    required: ['sessionId', 'action'],
  },
};

export const BROWSER_STORAGE_TOOL: ToolDefinition = {
  name: 'browser_storage',
  description: 'Get, set, or clear localStorage/sessionStorage in the remote browser.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      kind: { type: 'string', enum: ['local', 'session'], description: 'Storage type' },
      action: { type: 'string', enum: ['get', 'set', 'clear'], description: 'Storage action' },
      key: { type: 'string', description: 'Storage key (for get/set)' },
      value: { type: 'string', description: 'Value to set (for "set" action)' },
    },
    required: ['sessionId', 'kind', 'action'],
  },
};

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export const BROWSER_LAUNCH_TOOL: ToolDefinition = {
  name: 'browser_launch',
  description:
    'Launch a new remote browser session using a configured browser provider ' +
    '(Browserbase, Browserless, or custom). Returns a session ID for use with other browser tools.',
  input_schema: {
    type: 'object',
    properties: {
      providerId: {
        type: 'string',
        description:
          'Browser provider ID from settings. If omitted, uses the first enabled provider.',
      },
    },
    required: [],
  },
};

export const BROWSER_STOP_TOOL: ToolDefinition = {
  name: 'browser_stop',
  description: 'Stop and close an active remote browser session.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Browser session ID to stop' },
    },
    required: ['sessionId'],
  },
};

export const BROWSER_STATUS_TOOL: ToolDefinition = {
  name: 'browser_status',
  description: 'Check the status of an active remote browser session.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Browser session ID to check' },
    },
    required: ['sessionId'],
  },
};

// ---------------------------------------------------------------------------
// JavaScript evaluation
// ---------------------------------------------------------------------------

export const BROWSER_EVALUATE_TOOL: ToolDefinition = {
  name: 'browser_evaluate',
  description:
    'Evaluate a JavaScript expression in the remote browser page context. ' +
    'Returns the result of the expression. Use for reading page state or triggering actions.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      expression: {
        type: 'string',
        description: 'JavaScript expression to evaluate in the browser page context',
      },
      ref: {
        type: 'string',
        description: 'Element reference (the element will be available as the first argument)',
      },
    },
    required: ['sessionId', 'expression'],
  },
};

// ---------------------------------------------------------------------------
// File upload
// ---------------------------------------------------------------------------

export const BROWSER_UPLOAD_TOOL: ToolDefinition = {
  name: 'browser_upload',
  description:
    'Upload a file to a file input element in the remote browser. ' +
    'Provide the element reference and the path to the file on the remote server.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      ref: { type: 'string', description: 'Element reference for the file input' },
      filePath: {
        type: 'string',
        description: 'Path to the file to upload (on the remote browser server)',
      },
      filename: { type: 'string', description: 'Override the filename presented to the page' },
    },
    required: ['sessionId', 'ref', 'filePath'],
  },
};

// ---------------------------------------------------------------------------
// File download
// ---------------------------------------------------------------------------

export const BROWSER_DOWNLOAD_TOOL: ToolDefinition = {
  name: 'browser_download',
  description:
    'Get completed or pending downloads from the remote browser session. ' +
    'Can also trigger a download by providing a URL.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      url: {
        type: 'string',
        description: 'URL to download (optional — if omitted, lists recent downloads)',
      },
      suggestedFilename: { type: 'string', description: 'Suggested filename for the download' },
      waitMs: {
        type: 'number',
        description: 'Maximum time to wait for download to complete (default: 5000ms)',
      },
    },
    required: ['sessionId'],
  },
};

// ---------------------------------------------------------------------------
// PDF generation
// ---------------------------------------------------------------------------

export const BROWSER_PDF_TOOL: ToolDefinition = {
  name: 'browser_pdf',
  description:
    'Generate a PDF of the current page in the remote browser. ' +
    'Returns the PDF as base64 with metadata about page count and size.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      format: {
        type: 'string',
        description: 'Paper format (default: A4). Options: Letter, Legal, Tabloid, A3, A4, A5',
      },
      landscape: { type: 'boolean', description: 'Landscape orientation (default: false)' },
      printBackground: {
        type: 'boolean',
        description: 'Print background graphics (default: true)',
      },
      scale: { type: 'number', description: 'Scale of the PDF rendering (default: 1)' },
    },
    required: ['sessionId'],
  },
};

// ---------------------------------------------------------------------------
// Form fill
// ---------------------------------------------------------------------------

export const BROWSER_FILL_FORM_TOOL: ToolDefinition = {
  name: 'browser_fill_form',
  description:
    'Fill multiple form fields in one action. Provide an array of field ' +
    'descriptors with element references and values.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      fields: {
        type: 'array',
        description: 'Array of form fields to fill',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: 'Element reference for the field' },
            type: {
              type: 'string',
              description: 'Field type: text, checkbox, radio, select, file',
            },
            value: { description: 'Value to set (string, number, or boolean)' },
          },
          required: ['ref', 'type'],
        },
      },
      submit: { type: 'boolean', description: 'Submit the form after filling (default: false)' },
    },
    required: ['sessionId', 'fields'],
  },
};

// ---------------------------------------------------------------------------
// Dialog handling
// ---------------------------------------------------------------------------

export const BROWSER_DIALOG_TOOL: ToolDefinition = {
  name: 'browser_dialog',
  description:
    'Handle JavaScript dialogs (alert, confirm, prompt, beforeunload) in the remote browser. ' +
    'Accept or dismiss the dialog and optionally provide text for prompt dialogs.',
  input_schema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Active browser session ID' },
      action: {
        type: 'string',
        enum: ['accept', 'dismiss'],
        description: 'Accept or dismiss the dialog',
      },
      promptText: {
        type: 'string',
        description: 'Text to enter for prompt dialogs (only used when action is accept)',
      },
    },
    required: ['sessionId', 'action'],
  },
};

// ---------------------------------------------------------------------------
// Aggregated exports
// ---------------------------------------------------------------------------

export const ALL_BROWSER_TOOL_DEFINITIONS: ToolDefinition[] = [
  BROWSER_LAUNCH_TOOL,
  BROWSER_STOP_TOOL,
  BROWSER_STATUS_TOOL,
  BROWSER_NAVIGATE_TOOL,
  BROWSER_CLICK_TOOL,
  BROWSER_TYPE_TOOL,
  BROWSER_PRESS_KEY_TOOL,
  BROWSER_HOVER_TOOL,
  BROWSER_SELECT_TOOL,
  BROWSER_DRAG_TOOL,
  BROWSER_WAIT_TOOL,
  BROWSER_SCREENSHOT_TOOL,
  BROWSER_SNAPSHOT_TOOL,
  BROWSER_INSPECT_TOOL,
  BROWSER_COOKIES_TOOL,
  BROWSER_STORAGE_TOOL,
  BROWSER_EVALUATE_TOOL,
  BROWSER_UPLOAD_TOOL,
  BROWSER_DOWNLOAD_TOOL,
  BROWSER_PDF_TOOL,
  BROWSER_FILL_FORM_TOOL,
  BROWSER_DIALOG_TOOL,
];
