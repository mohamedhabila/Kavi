import { TOOL_CATALOG_CATEGORIES } from '../../engine/tools/builtin-tool-catalogConfig';
import { hashString, uniqueSorted, type E2ERedactedHash } from './e2eTraceRedaction';

const SAFE_PUBLIC_TOOL_NAME_SET = new Set<string>([
  'tool_catalog',
  'tool_describe',
  'update_goals',
  ...Object.values(TOOL_CATALOG_CATEGORIES).flatMap((category) => category.tools),
]);

export type E2ERedactedToolName = {
  name?: string;
  nameHash: E2ERedactedHash;
};

export type E2ERedactedToolNameList = {
  names: string[];
  nameHashes: E2ERedactedHash[];
};

export function buildRedactedToolName(name: string): E2ERedactedToolName {
  return {
    ...(SAFE_PUBLIC_TOOL_NAME_SET.has(name) ? { name } : {}),
    nameHash: hashString(name),
  };
}

export function buildRedactedToolNameList(names: ReadonlyArray<string>): E2ERedactedToolNameList {
  const uniqueNames = uniqueSorted(names);
  return {
    names: uniqueNames.filter((name) => SAFE_PUBLIC_TOOL_NAME_SET.has(name)),
    nameHashes: uniqueNames.map(hashString),
  };
}
