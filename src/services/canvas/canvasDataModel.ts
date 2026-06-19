import type { DataModelOperation } from './types';

export function applyDataModelOperations(
  model: Record<string, any>,
  operations: DataModelOperation[],
): void {
  for (const op of operations) {
    const parts = op.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    const key = parts[parts.length - 1];
    let target = model;

    for (let i = 0; i < parts.length - 1; i++) {
      if (target[parts[i]] === undefined) {
        if (op.op === 'remove') return;
        target[parts[i]] = {};
      }
      target = target[parts[i]];
    }

    switch (op.op) {
      case 'add':
      case 'replace':
        target[key] = op.value;
        break;
      case 'remove':
        delete target[key];
        break;
    }
  }
}
