import type { CanvasComponent } from '../../types/canvas';
import { generateId } from '../../utils/id';
import { looksLikeHtml, normalizeCanvasTextContent } from './builtin-canvas-helpers';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCanvasType(rawType?: string): string {
  const normalized = (rawType || '').trim().toLowerCase();
  switch (normalized) {
    case 'paragraph':
    case 'label':
    case 'copy':
      return 'text';
    case 'title':
    case 'header':
      return 'heading';
    case 'btn':
    case 'cta':
      return 'button';
    case 'textbox':
    case 'textinput':
      return 'input';
    case 'img':
    case 'photo':
      return 'image';
    case 'stack':
    case 'column':
    case 'section':
      return 'container';
    case 'columns':
    case 'hstack':
      return 'row';
    case 'checklist':
      return 'list';
    case 'rule':
    case 'hr':
      return 'divider';
    default:
      return normalized || 'container';
  }
}

function normalizeCanvasComponent(
  value: unknown,
  fallbackType: string = 'text',
): CanvasComponent | null {
  if (typeof value === 'string') {
    const text = normalizeCanvasTextContent(value);
    if (!text) return null;
    return {
      id: `canvas-text-${generateId()}`,
      type: 'text',
      props: { text },
    };
  }

  if (!isRecord(value)) {
    return null;
  }

  const explicitProps = isRecord(value.props) ? { ...value.props } : {};
  const props = { ...explicitProps } as Record<string, unknown>;
  const promotedKeys = [
    'text',
    'label',
    'src',
    'alt',
    'value',
    'placeholder',
    'rows',
    'inputType',
    'options',
    'checked',
    'name',
    'group',
    'headers',
    'action',
  ];
  for (const key of promotedKeys) {
    if (props[key] === undefined && value[key] !== undefined) {
      props[key] = value[key];
    }
  }

  const inferredType =
    typeof value.type === 'string'
      ? value.type
      : typeof value.kind === 'string'
        ? value.kind
        : typeof value.component === 'string'
          ? value.component
          : props.text != null
            ? 'text'
            : Array.isArray(value.children) || Array.isArray(value.items)
              ? 'container'
              : fallbackType;

  const childrenSource = Array.isArray(value.children)
    ? value.children
    : Array.isArray(value.items)
      ? value.items
      : Array.isArray(value.components)
        ? value.components
        : undefined;

  const children = childrenSource
    ?.map((child) => normalizeCanvasComponent(child))
    .filter((child): child is CanvasComponent => Boolean(child));

  return {
    id:
      typeof value.id === 'string' && value.id.trim()
        ? value.id.trim()
        : `canvas-${normalizeCanvasType(inferredType)}-${generateId()}`,
    type: normalizeCanvasType(inferredType),
    props,
    ...(children?.length ? { children } : {}),
  };
}

export function normalizeCanvasComponentsInput(input: unknown): CanvasComponent[] | undefined {
  if (input == null) {
    return undefined;
  }

  if (typeof input === 'string') {
    const trimmed = normalizeCanvasTextContent(input);
    if (!trimmed) return undefined;
    if (looksLikeHtml(trimmed)) return undefined;

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return normalizeCanvasComponentsInput(JSON.parse(trimmed));
      } catch {
        return [{ id: `canvas-text-${generateId()}`, type: 'text', props: { text: trimmed } }];
      }
    }

    return [{ id: `canvas-text-${generateId()}`, type: 'text', props: { text: trimmed } }];
  }

  if (Array.isArray(input)) {
    const normalized = input
      .map((entry) => normalizeCanvasComponent(entry))
      .filter((entry): entry is CanvasComponent => Boolean(entry));
    return normalized.length ? normalized : undefined;
  }

  if (isRecord(input)) {
    if (Array.isArray(input.components)) {
      return normalizeCanvasComponentsInput(input.components);
    }
    const single = normalizeCanvasComponent(input, 'container');
    return single ? [single] : undefined;
  }

  return undefined;
}
