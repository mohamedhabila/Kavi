import type { CanvasComponent, CanvasSurface } from '../../types/canvas';

function injectMessageBridge(html: string, surfaceId: string): string {
  const bridge = `<script>\nfunction sendAction(componentId, action, value) {\n  window.ReactNativeWebView?.postMessage(JSON.stringify({\n    type: 'userAction',\n    surfaceId: '${surfaceId}',\n    componentId: componentId,\n    action: action,\n    value: value\n  }));\n}\n</script>`;

  // Inject bridge script before a closing document tag when one is available.
  if (html.includes('</body>')) {
    return html.replace('</body>', `${bridge}\n</body>`);
  }
  if (html.includes('</html>')) {
    return html.replace('</html>', `${bridge}\n</html>`);
  }
  return html + bridge;
}

export function renderCanvasSurfaceToHtml(surface: CanvasSurface): string {
  if (surface.renderMode === 'html' && surface.rawHtml) {
    return injectMessageBridge(surface.rawHtml, surface.id);
  }

  const resolvedComponents = resolveDataBindings(surface.components, surface.dataModel);
  const componentHtml = resolvedComponents.map(renderComponent).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         padding: 16px; background: #1a1a2e; color: #e0e0e0; }
  .container { display: flex; flex-direction: column; gap: 12px; }
  .card { background: #16213e; border-radius: 12px; padding: 16px; }
  .text { font-size: 16px; line-height: 1.5; }
  .heading { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
  .button { background: #0f3460; color: #e94560; border: none; border-radius: 8px;
            padding: 12px 24px; font-size: 16px; cursor: pointer; text-align: center; }
  .button:active { opacity: 0.7; }
  .input { background: #0f3460; border: 1px solid #333; border-radius: 8px;
           padding: 12px; color: #e0e0e0; font-size: 16px; width: 100%; }
  .image { max-width: 100%; border-radius: 8px; }
  .list { list-style: none; }
  .list-item { padding: 12px 0; border-bottom: 1px solid #333; }
  .row { display: flex; gap: 8px; align-items: center; }
  .spacer { flex: 1; }
  .badge { background: #e94560; color: white; border-radius: 12px;
           padding: 2px 8px; font-size: 12px; }
  .progress { width: 100%; height: 8px; background: #0f3460; border-radius: 4px;
              overflow: hidden; }
  .progress-bar { height: 100%; background: #e94560; border-radius: 4px;
                  transition: width 0.3s ease; }
  .select { background: #0f3460; border: 1px solid #333; border-radius: 8px;
            padding: 12px; color: #e0e0e0; font-size: 16px; width: 100%; }
  .checkbox-label, .radio-label { display: flex; align-items: center; gap: 8px;
                                  font-size: 16px; padding: 4px 0; cursor: pointer; }
  .checkbox-label input, .radio-label input { width: 18px; height: 18px; accent-color: #e94560; }
  .form { display: flex; flex-direction: column; gap: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { background: #0f3460; text-align: left; padding: 10px; border-bottom: 2px solid #e94560; }
  td { padding: 10px; border-bottom: 1px solid #333; }
  tr:hover td { background: #16213e; }
</style>
</head>
<body>
<div class="container" data-surface-id="${surface.id}">
${componentHtml}
</div>
<script>
function sendAction(componentId, action, value) {
  window.ReactNativeWebView?.postMessage(JSON.stringify({
    type: 'userAction',
    surfaceId: '${surface.id}',
    componentId: componentId,
    action: action,
    value: value
  }));
}
document.querySelectorAll('[data-action]').forEach(el => {
  el.addEventListener('click', () => {
    sendAction(el.dataset.componentId, el.dataset.action, el.dataset.value);
  });
});
document.querySelectorAll('input[type="text"], input[type="email"], input[type="number"], input[type="password"], input[type="tel"], input[type="url"], input:not([type]), textarea').forEach(el => {
  el.addEventListener('change', () => {
    sendAction(el.dataset.componentId, 'change', el.value);
  });
});
document.querySelectorAll('select').forEach(el => {
  el.addEventListener('change', () => {
    sendAction(el.dataset.componentId, 'change', el.value);
  });
});
document.querySelectorAll('input[type="checkbox"]').forEach(el => {
  el.addEventListener('change', () => {
    sendAction(el.dataset.componentId, 'change', el.checked);
  });
});
document.querySelectorAll('input[type="radio"]').forEach(el => {
  el.addEventListener('change', () => {
    sendAction(el.dataset.componentId, 'change', el.value);
  });
});
</script>
</body>
</html>`;
}

function renderComponent(comp: CanvasComponent): string {
  const id = comp.id;
  const props = comp.props || {};

  switch (comp.type) {
    case 'text':
      return `<p class="text" data-component-id="${id}">${escapeHtml(props.text || '')}</p>`;

    case 'heading':
      return `<h2 class="heading" data-component-id="${id}">${escapeHtml(props.text || '')}</h2>`;

    case 'button':
      return `<button class="button" data-component-id="${id}" data-action="${props.action || 'click'}" data-value="${escapeHtml(props.value || '')}">${escapeHtml(props.label || 'Button')}</button>`;

    case 'input':
      return `<input class="input" data-component-id="${id}" placeholder="${escapeHtml(props.placeholder || '')}" value="${escapeHtml(props.value || '')}" type="${props.inputType || 'text'}" />`;

    case 'textarea':
      return `<textarea class="input" data-component-id="${id}" placeholder="${escapeHtml(props.placeholder || '')}" rows="${props.rows || 3}">${escapeHtml(props.value || '')}</textarea>`;

    case 'image':
      return `<img class="image" data-component-id="${id}" src="${escapeHtml(props.src || '')}" alt="${escapeHtml(props.alt || '')}" />`;

    case 'card': {
      const inner = (comp.children || []).map(renderComponent).join('\n');
      return `<div class="card" data-component-id="${id}">${inner}</div>`;
    }

    case 'row': {
      const rowInner = (comp.children || []).map(renderComponent).join('\n');
      return `<div class="row" data-component-id="${id}">${rowInner}</div>`;
    }

    case 'list': {
      const items = (comp.children || [])
        .map((c) => `<li class="list-item">${renderComponent(c)}</li>`)
        .join('\n');
      return `<ul class="list" data-component-id="${id}">${items}</ul>`;
    }

    case 'badge':
      return `<span class="badge" data-component-id="${id}">${escapeHtml(props.text || '')}</span>`;

    case 'progress': {
      const pct = Math.max(0, Math.min(100, Number(props.value) || 0));
      return `<div class="progress" data-component-id="${id}"><div class="progress-bar" style="width:${pct}%"></div></div>`;
    }

    case 'spacer':
      return `<div class="spacer"></div>`;

    case 'divider':
      return `<hr style="border-color: #333; margin: 8px 0;" />`;

    case 'select': {
      const optionsHtml = (props.options || [])
        .map((opt: any) => {
          const val = typeof opt === 'string' ? opt : opt.value;
          const label = typeof opt === 'string' ? opt : opt.label || opt.value;
          const sel = val === props.value ? ' selected' : '';
          return `<option value="${escapeHtml(val)}"${sel}>${escapeHtml(label)}</option>`;
        })
        .join('');
      return `<select class="select" data-component-id="${id}">${optionsHtml}</select>`;
    }

    case 'checkbox':
      return `<label class="checkbox-label" data-component-id="${id}"><input type="checkbox" data-component-id="${id}" ${props.checked ? 'checked' : ''} />${escapeHtml(props.label || '')}</label>`;

    case 'radio': {
      const name = escapeHtml(props.name || props.group || id);
      return `<label class="radio-label" data-component-id="${id}"><input type="radio" name="${name}" data-component-id="${id}" value="${escapeHtml(props.value || '')}" ${props.checked ? 'checked' : ''} />${escapeHtml(props.label || '')}</label>`;
    }

    case 'form': {
      const formInner = (comp.children || []).map(renderComponent).join('\n');
      return `<form class="form" data-component-id="${id}" onsubmit="event.preventDefault(); sendAction('${id}', 'submit', Object.fromEntries(new FormData(this)));">${formInner}</form>`;
    }

    case 'table': {
      const headers = (props.headers || [])
        .map((h: string) => `<th>${escapeHtml(h)}</th>`)
        .join('');
      const rows = (props.rows || [])
        .map(
          (row: string[]) =>
            `<tr>${row.map((cell: string) => `<td>${escapeHtml(String(cell))}</td>`).join('')}</tr>`,
        )
        .join('');
      return `<table data-component-id="${id}"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    }

    case 'container':
    default: {
      const inside = (comp.children || []).map(renderComponent).join('\n');
      return `<div class="container" data-component-id="${id}">${inside}</div>`;
    }
  }
}

function resolveDataBindings(
  components: CanvasComponent[],
  dataModel: Record<string, any>,
): CanvasComponent[] {
  return components.map((comp) => {
    const resolved = { ...comp, props: { ...comp.props } };

    if (comp.dataBindings) {
      for (const [propKey, dataPath] of Object.entries(comp.dataBindings)) {
        const value = getNestedValue(dataModel, dataPath);
        if (value !== undefined) {
          resolved.props[propKey] = value;
        }
      }
    }

    if (comp.children) {
      resolved.children = resolveDataBindings(comp.children, dataModel);
    }

    return resolved;
  });
}

function getNestedValue(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
