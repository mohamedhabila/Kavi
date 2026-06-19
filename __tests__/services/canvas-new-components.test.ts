// ---------------------------------------------------------------------------
// Tests for new canvas component types (select, checkbox, radio, form, table)
// and new canvas actions (navigate, eval, snapshot)
// ---------------------------------------------------------------------------

import {
  processCanvasMessage,
  clearAllSurfaces,
  renderSurfaceToHtml,
  setCanvasEventHandler,
} from '../../src/services/canvas/renderer';
import type { ServerToClientMessage, CanvasEventHandler } from '../../src/services/canvas/types';

describe('Canvas Renderer — New Components & Actions', () => {
  beforeEach(() => {
    clearAllSurfaces();
    setCanvasEventHandler({});
  });

  // ── Select component ─────────────────────────────────────────────

  describe('select component', () => {
    it('renders a select dropdown with string options', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'sel-1',
        title: 'Select Test',
        catalogId: 'test',
        components: [
          {
            id: 'dropdown',
            type: 'select',
            props: {
              options: ['Apple', 'Banana', 'Cherry'],
              value: 'Banana',
            },
          },
        ],
      });

      const html = renderSurfaceToHtml('sel-1');
      expect(html).toBeDefined();
      expect(html).toContain('<select');
      expect(html).toContain('class="select"');
      expect(html).toContain('<option value="Apple">Apple</option>');
      expect(html).toContain('<option value="Banana" selected>Banana</option>');
      expect(html).toContain('<option value="Cherry">Cherry</option>');
    });

    it('renders a select dropdown with object options', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'sel-2',
        title: 'Select Object Test',
        catalogId: 'test',
        components: [
          {
            id: 'dropdown',
            type: 'select',
            props: {
              options: [
                { value: 'us', label: 'United States' },
                { value: 'uk', label: 'United Kingdom' },
              ],
            },
          },
        ],
      });

      const html = renderSurfaceToHtml('sel-2');
      expect(html).toContain('<option value="us">United States</option>');
      expect(html).toContain('<option value="uk">United Kingdom</option>');
    });

    it('renders an empty select when no options provided', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'sel-3',
        title: 'Empty Select',
        catalogId: 'test',
        components: [{ id: 'dropdown', type: 'select', props: {} }],
      });

      const html = renderSurfaceToHtml('sel-3');
      expect(html).toContain('<select');
      expect(html).toContain('</select>');
    });
  });

  // ── Checkbox component ───────────────────────────────────────────

  describe('checkbox component', () => {
    it('renders a checkbox with label', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'chk-1',
        title: 'Checkbox Test',
        catalogId: 'test',
        components: [
          { id: 'cb1', type: 'checkbox', props: { label: 'Accept terms', checked: true } },
        ],
      });

      const html = renderSurfaceToHtml('chk-1');
      expect(html).toContain('type="checkbox"');
      expect(html).toContain('Accept terms');
      expect(html).toContain('checked');
      expect(html).toContain('checkbox-label');
    });

    it('renders unchecked checkbox', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'chk-2',
        title: 'Unchecked',
        catalogId: 'test',
        components: [{ id: 'cb2', type: 'checkbox', props: { label: 'Option A' } }],
      });

      const html = renderSurfaceToHtml('chk-2');
      expect(html).toContain('type="checkbox"');
      expect(html).not.toContain(' checked ');
    });
  });

  // ── Radio component ──────────────────────────────────────────────

  describe('radio component', () => {
    it('renders radio buttons with name group', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'rad-1',
        title: 'Radio Test',
        catalogId: 'test',
        components: [
          {
            id: 'r1',
            type: 'radio',
            props: { name: 'color', label: 'Red', value: 'red', checked: true },
          },
          { id: 'r2', type: 'radio', props: { name: 'color', label: 'Blue', value: 'blue' } },
        ],
      });

      const html = renderSurfaceToHtml('rad-1');
      expect(html).toContain('type="radio"');
      expect(html).toContain('name="color"');
      expect(html).toContain('Red');
      expect(html).toContain('Blue');
      expect(html).toContain('value="red"');
      expect(html).toContain('value="blue"');
    });
  });

  // ── Form component ───────────────────────────────────────────────

  describe('form component', () => {
    it('renders a form container with children', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'form-1',
        title: 'Form Test',
        catalogId: 'test',
        components: [
          {
            id: 'f1',
            type: 'form',
            props: {},
            children: [
              { id: 'inp1', type: 'input', props: { placeholder: 'Name' } },
              { id: 'btn1', type: 'button', props: { label: 'Submit' } },
            ],
          },
        ],
      });

      const html = renderSurfaceToHtml('form-1');
      expect(html).toContain('<form');
      expect(html).toContain('class="form"');
      expect(html).toContain('onsubmit');
      expect(html).toContain('sendAction');
      expect(html).toContain('placeholder="Name"');
      expect(html).toContain('Submit');
    });
  });

  // ── Table component ──────────────────────────────────────────────

  describe('table component', () => {
    it('renders a table with headers and rows', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'tbl-1',
        title: 'Table Test',
        catalogId: 'test',
        components: [
          {
            id: 't1',
            type: 'table',
            props: {
              headers: ['Name', 'Age', 'City'],
              rows: [
                ['Alice', '30', 'NYC'],
                ['Bob', '25', 'LA'],
              ],
            },
          },
        ],
      });

      const html = renderSurfaceToHtml('tbl-1');
      expect(html).toContain('<table');
      expect(html).toContain('<thead>');
      expect(html).toContain('<tbody>');
      expect(html).toContain('<th>Name</th>');
      expect(html).toContain('<th>Age</th>');
      expect(html).toContain('<th>City</th>');
      expect(html).toContain('<td>Alice</td>');
      expect(html).toContain('<td>30</td>');
      expect(html).toContain('<td>LA</td>');
    });

    it('renders empty table when no rows provided', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'tbl-2',
        title: 'Empty Table',
        catalogId: 'test',
        components: [{ id: 't2', type: 'table', props: { headers: ['Col A'], rows: [] } }],
      });

      const html = renderSurfaceToHtml('tbl-2');
      expect(html).toContain('<th>Col A</th>');
      expect(html).toContain('<tbody></tbody>');
    });
  });

  // ── Navigate action ──────────────────────────────────────────────

  describe('navigate action', () => {
    it('calls onNavigate handler', () => {
      const handler: CanvasEventHandler = { onNavigate: jest.fn() };
      setCanvasEventHandler(handler);

      // First create the surface
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'nav-1',
        title: 'Nav Surface',
        catalogId: 'test',
        components: [],
      });

      processCanvasMessage({
        type: 'navigate',
        surfaceId: 'nav-1',
        url: 'https://example.com',
      } as ServerToClientMessage);

      expect(handler.onNavigate).toHaveBeenCalledWith('nav-1', 'https://example.com');
    });

    it('no-ops for non-existent surface', () => {
      const handler: CanvasEventHandler = { onNavigate: jest.fn() };
      setCanvasEventHandler(handler);

      processCanvasMessage({
        type: 'navigate',
        surfaceId: 'nonexistent',
        url: 'https://example.com',
      } as ServerToClientMessage);

      expect(handler.onNavigate).not.toHaveBeenCalled();
    });
  });

  // ── Eval action ──────────────────────────────────────────────────

  describe('eval action', () => {
    it('calls onEval handler', () => {
      const handler: CanvasEventHandler = { onEval: jest.fn() };
      setCanvasEventHandler(handler);

      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'eval-1',
        title: 'Eval Surface',
        catalogId: 'test',
        components: [],
      });

      processCanvasMessage({
        type: 'eval',
        surfaceId: 'eval-1',
        script: 'document.title = "Hello"',
      } as ServerToClientMessage);

      expect(handler.onEval).toHaveBeenCalledWith('eval-1', 'document.title = "Hello"');
    });
  });

  // ── Snapshot action ──────────────────────────────────────────────

  describe('snapshot action', () => {
    it('calls onSnapshot handler with format', () => {
      const handler: CanvasEventHandler = { onSnapshot: jest.fn() };
      setCanvasEventHandler(handler);

      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'snap-1',
        title: 'Snap Surface',
        catalogId: 'test',
        components: [],
      });

      processCanvasMessage({
        type: 'snapshot',
        surfaceId: 'snap-1',
        format: 'jpeg',
        quality: 0.8,
      } as ServerToClientMessage);

      expect(handler.onSnapshot).toHaveBeenCalledWith('snap-1', 'jpeg', 0.8);
    });
  });

  // ── CSS includes styles for new components ──────────────────────

  describe('CSS styles', () => {
    it('includes styles for select, checkbox, radio, form, table', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'css-1',
        title: 'CSS Test',
        catalogId: 'test',
        components: [{ id: 'c1', type: 'text', props: { text: 'test' } }],
      });

      const html = renderSurfaceToHtml('css-1');
      expect(html).toContain('.select');
      expect(html).toContain('.checkbox-label');
      expect(html).toContain('.radio-label');
      expect(html).toContain('.form');
      expect(html).toContain('table');
      expect(html).toContain('th {');
      expect(html).toContain('td {');
    });
  });

  // ── Event listeners for new components ──────────────────────────

  describe('event listeners', () => {
    it('includes change listener for select elements', () => {
      processCanvasMessage({
        type: 'createSurface',
        surfaceId: 'evt-1',
        title: 'Events Test',
        catalogId: 'test',
        components: [{ id: 's1', type: 'select', props: { options: ['A'] } }],
      });

      const html = renderSurfaceToHtml('evt-1');
      expect(html).toContain("querySelectorAll('select')");
      expect(html).toContain('querySelectorAll(\'input[type="checkbox"]\')');
      expect(html).toContain('querySelectorAll(\'input[type="radio"]\')');
    });
  });
});
