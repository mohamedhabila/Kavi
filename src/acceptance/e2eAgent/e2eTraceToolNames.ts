import { TOOL_DEFINITIONS } from '../../engine/tools/definitions';
import { hashString, uniqueSorted, type E2ERedactedHash } from './e2eTraceRedaction';

/** Built-in tool names are public; MCP and user skill names are reported only as hashes. */
const SAFE_PUBLIC_TOOL_NAME_SET = new Set<string>(TOOL_DEFINITIONS.map((tool) => tool.name));

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
