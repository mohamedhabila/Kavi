function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export type FocusedTextEditOperationType = 'replace' | 'delete' | 'insert_before' | 'insert_after';

export interface FocusedTextEditOperation {
  op: FocusedTextEditOperationType;
  oldText: string;
  newText: string;
}

export interface JsonPatchSubsetOperation {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: any;
}

function normalizeFocusedTextEditOperationType(
  rawOp: unknown,
): FocusedTextEditOperationType | null {
  const normalized = typeof rawOp === 'string' ? rawOp.trim().toLowerCase() : 'replace';
  switch (normalized) {
    case 'replace':
      return 'replace';
    case 'delete':
    case 'remove':
      return 'delete';
    case 'insert_before':
    case 'insert-before':
    case 'insertbefore':
      return 'insert_before';
    case 'insert_after':
    case 'insert-after':
    case 'insertafter':
      return 'insert_after';
    default:
      return null;
  }
}

export function normalizeFocusedTextEditOperations(
  rawOperations: unknown,
  toolName: string,
  fieldName: string,
): { operations?: FocusedTextEditOperation[]; error?: string } {
  if (rawOperations == null) {
    return { operations: undefined };
  }

  if (!Array.isArray(rawOperations)) {
    return { error: `Error: "${fieldName}" for ${toolName} must be an array when provided.` };
  }

  const operations: FocusedTextEditOperation[] = [];
  for (let index = 0; index < rawOperations.length; index += 1) {
    const rawOperation = rawOperations[index];
    if (!isRecord(rawOperation)) {
      return { error: `Error: ${fieldName}[${index}] for ${toolName} must be an object.` };
    }

    const op = normalizeFocusedTextEditOperationType(rawOperation.op);
    if (!op) {
      return {
        error:
          `Error: ${fieldName}[${index}].op for ${toolName} must be one of ` +
          'replace, delete, insert_before, or insert_after.',
      };
    }

    const oldText = rawOperation.oldText;
    if (typeof oldText !== 'string' || !oldText.trim()) {
      return {
        error: `Error: ${fieldName}[${index}].oldText for ${toolName} must be a non-empty string.`,
      };
    }

    if (op === 'delete') {
      const newText = rawOperation.newText;
      if (typeof newText !== 'undefined' && newText !== '') {
        return {
          error: `Error: ${fieldName}[${index}].newText for ${toolName} must be omitted or empty when op is delete.`,
        };
      }

      operations.push({ op, oldText, newText: '' });
      continue;
    }

    const newText = rawOperation.newText;
    if (typeof newText !== 'string') {
      return {
        error: `Error: ${fieldName}[${index}].newText for ${toolName} must be a string when op is ${op}.`,
      };
    }

    operations.push({ op, oldText, newText });
  }

  return { operations };
}

export function applyFocusedTextEditOperations(
  content: string,
  operations: FocusedTextEditOperation[],
  targetName: string,
): { content?: string; error?: string } {
  let nextContent = content;

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    const occurrences = nextContent.split(operation.oldText).length - 1;

    if (occurrences === 0) {
      return {
        error: `Error: ${targetName} edit ${index + 1} did not match oldText; oldText not found. Inspect the latest content and include more surrounding context.`,
      };
    }

    if (occurrences > 1) {
      return {
        error:
          `Error: ${targetName} edit ${index + 1} matched oldText ${occurrences} times and must be unique. ` +
          'Focused edits require a unique match. Include more surrounding context.',
      };
    }

    switch (operation.op) {
      case 'replace':
        nextContent = nextContent.replace(operation.oldText, operation.newText);
        break;
      case 'delete':
        nextContent = nextContent.replace(operation.oldText, '');
        break;
      case 'insert_before':
        nextContent = nextContent.replace(
          operation.oldText,
          `${operation.newText}${operation.oldText}`,
        );
        break;
      case 'insert_after':
        nextContent = nextContent.replace(
          operation.oldText,
          `${operation.oldText}${operation.newText}`,
        );
        break;
    }
  }

  return { content: nextContent };
}

function normalizeJsonPatchOperationType(rawOp: unknown): JsonPatchSubsetOperation['op'] | null {
  const normalized = typeof rawOp === 'string' ? rawOp.trim().toLowerCase() : 'replace';
  switch (normalized) {
    case 'add':
    case 'insert':
      return 'add';
    case 'replace':
    case 'set':
    case 'update':
      return 'replace';
    case 'remove':
    case 'delete':
      return 'remove';
    default:
      return null;
  }
}

export function normalizeJsonPatchSubsetOperations(
  rawOperations: unknown,
  toolName: string,
  fieldName: string,
): { operations?: JsonPatchSubsetOperation[]; error?: string } {
  if (rawOperations == null) {
    return { operations: undefined };
  }

  if (!Array.isArray(rawOperations)) {
    return { error: `Error: "${fieldName}" for ${toolName} must be an array when provided.` };
  }

  const operations: JsonPatchSubsetOperation[] = [];
  for (let index = 0; index < rawOperations.length; index += 1) {
    const rawOperation = rawOperations[index];
    if (
      !isRecord(rawOperation) ||
      typeof rawOperation.path !== 'string' ||
      !rawOperation.path.trim()
    ) {
      return {
        error: `Error: ${fieldName}[${index}] for ${toolName} must include a non-empty string path.`,
      };
    }

    const op = normalizeJsonPatchOperationType(rawOperation.op);
    if (!op) {
      return {
        error:
          `Error: ${fieldName}[${index}].op for ${toolName} must be one of ` +
          'add, replace, or remove.',
      };
    }

    operations.push(
      typeof rawOperation.value === 'undefined'
        ? { op, path: rawOperation.path }
        : { op, path: rawOperation.path, value: rawOperation.value },
    );
  }

  return { operations };
}

function cloneJsonValue<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function parseJsonPointer(path: string): string[] | null {
  if (!path.startsWith('/')) {
    return null;
  }
  return path.split('/').slice(1).map(decodeJsonPointerSegment);
}

function parseArrayIndex(
  segment: string,
  path: string,
  operation: JsonPatchSubsetOperation['op'],
  arrayLength: number,
): { index?: number; error?: string } {
  if (segment === '-' && operation === 'add') {
    return { index: arrayLength };
  }

  if (!/^\d+$/.test(segment)) {
    return {
      error: `Error: component operation path "${path}" contains invalid array index "${segment}".`,
    };
  }

  const index = Number(segment);
  const maxIndex = operation === 'add' ? arrayLength : arrayLength - 1;
  if (index < 0 || index > maxIndex) {
    return {
      error: `Error: component operation path "${path}" references array index ${index} outside the valid range.`,
    };
  }

  return { index };
}

export function applyJsonPatchSubset<T>(
  target: T,
  operations: JsonPatchSubsetOperation[],
  targetName: string,
): { value?: T; error?: string } {
  const nextValue = cloneJsonValue(target);

  for (const operation of operations) {
    const pathParts = parseJsonPointer(operation.path);
    if (!pathParts || pathParts.length === 0) {
      return {
        error: `Error: ${targetName} operations require RFC 6901-style paths like /0/props/text.`,
      };
    }

    let container: any = nextValue;
    for (let index = 0; index < pathParts.length - 1; index += 1) {
      const segment = pathParts[index];

      if (Array.isArray(container)) {
        const arrayIndex = parseArrayIndex(segment, operation.path, 'replace', container.length);
        if (arrayIndex.error) {
          return { error: arrayIndex.error };
        }
        container = container[arrayIndex.index!];
      } else if (isRecord(container)) {
        if (!(segment in container)) {
          return {
            error: `Error: ${targetName} operation path "${operation.path}" could not resolve "${segment}". Inspect the current structure first.`,
          };
        }
        container = container[segment];
      } else {
        return {
          error: `Error: ${targetName} operation path "${operation.path}" traverses a non-container value.`,
        };
      }

      if (container === null || typeof container !== 'object') {
        return {
          error: `Error: ${targetName} operation path "${operation.path}" traverses a non-container value.`,
        };
      }
    }

    const key = pathParts[pathParts.length - 1];

    if (Array.isArray(container)) {
      const arrayIndex = parseArrayIndex(key, operation.path, operation.op, container.length);
      if (arrayIndex.error) {
        return { error: arrayIndex.error };
      }
      const index = arrayIndex.index!;

      switch (operation.op) {
        case 'add':
          container.splice(index, 0, cloneJsonValue(operation.value));
          break;
        case 'replace':
          container[index] = cloneJsonValue(operation.value);
          break;
        case 'remove':
          container.splice(index, 1);
          break;
      }
      continue;
    }

    if (!isRecord(container)) {
      return {
        error: `Error: ${targetName} operation path "${operation.path}" does not resolve to an object or array container.`,
      };
    }

    switch (operation.op) {
      case 'add':
        container[key] = cloneJsonValue(operation.value);
        break;
      case 'replace':
        if (!(key in container)) {
          return {
            error: `Error: ${targetName} operation path "${operation.path}" does not exist for replace.`,
          };
        }
        container[key] = cloneJsonValue(operation.value);
        break;
      case 'remove':
        if (!(key in container)) {
          return {
            error: `Error: ${targetName} operation path "${operation.path}" does not exist for remove.`,
          };
        }
        delete container[key];
        break;
    }
  }

  return { value: nextValue };
}
