import { TOOL_DEFINITIONS } from '../tools/definitions';
import { TOOL_CATALOG_TOOL } from '../tools/builtin-definitions-coordination';
import { normalizeToolName } from '../tools/toolNameNormalization';
import type { ToolDefinition } from '../../types/tool';

/**
 * The result for a call naming a tool that does not exist.
 *
 * `Tool "x" is not registered.` states a fact and leaves no move, so the cheapest thing
 * left is to guess another name and try again. Nearly every miss is a near-miss — a
 * pluralised name, a provider prefix, the sibling of the right tool — so naming the
 * closest registered tool and handing over its contract turns a dead end into a corrected
 * call on the next turn. Discovery is offered as a fallback, never as a required step.
 */

/** Damerau-Levenshtein distance, bounded so a wild guess is not "close" to everything. */
function editDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  let previous = Array.from({ length: cols }, (_unused, index) => index);

  for (let row = 1; row < rows; row += 1) {
    const current = [row, ...Array.from({ length: cols - 1 }, () => 0)];
    for (let col = 1; col < cols; col += 1) {
      const substitutionCost = left[row - 1] === right[col - 1] ? 0 : 1;
      current[col] = Math.min(
        current[col - 1]! + 1,
        previous[col]! + 1,
        previous[col - 1]! + substitutionCost,
      );
    }
    previous = current;
  }

  return previous[cols - 1]!;
}

/**
 * How close two tool names are, in [0, 1].
 *
 * A shared token counts for a lot: `calendar_list` against `calendar_events` is a near
 * miss even though a third of the characters differ, because the domain word matches.
 */
function nameSimilarity(candidate: string, requested: string): number {
  const left = candidate.toLowerCase();
  const right = requested.toLowerCase();
  if (left === right) {
    return 1;
  }

  const longest = Math.max(left.length, right.length);
  const characterScore = longest === 0 ? 0 : 1 - editDistance(left, right) / longest;

  const leftTokens = new Set(left.split(/[^a-z0-9]+/u).filter(Boolean));
  const rightTokens = right.split(/[^a-z0-9]+/u).filter(Boolean);
  const sharedTokens = rightTokens.filter((token) => leftTokens.has(token)).length;
  const tokenScore = rightTokens.length === 0 ? 0 : sharedTokens / rightTokens.length;

  if (left.includes(right) || right.includes(left)) {
    return Math.max(0.75, characterScore, tokenScore);
  }
  return Math.max(characterScore, tokenScore);
}

/** Below this a "did you mean" is noise rather than help. */
const SUGGESTION_THRESHOLD = 0.45;

export function findNearestRegisteredTool(
  requestedName: string,
  availableToolNames?: ReadonlySet<string>,
): ToolDefinition | undefined {
  const requested = normalizeToolName(requestedName);
  if (!requested) {
    return undefined;
  }

  let best: { tool: ToolDefinition; score: number } | undefined;
  for (const tool of TOOL_DEFINITIONS) {
    const name = normalizeToolName(tool?.name ?? '');
    if (!name) {
      continue;
    }
    // Only ever point at something the run could actually call.
    if (availableToolNames && availableToolNames.size > 0 && !availableToolNames.has(name)) {
      continue;
    }
    const score = nameSimilarity(name, requested);
    if (score >= SUGGESTION_THRESHOLD && (!best || score > best.score)) {
      best = { tool, score };
    }
  }

  return best?.tool;
}

function renderToolContract(tool: ToolDefinition): string {
  const schema = JSON.stringify(tool.input_schema ?? {});
  const description = (tool.description ?? '').trim();
  const summary = description.length > 400 ? `${description.slice(0, 400)}…` : description;
  return `${tool.name}: ${summary}\ninput_schema: ${schema}`;
}

export function buildUnknownToolResult(params: {
  toolName: string;
  availableToolNames?: ReadonlySet<string>;
}): string {
  const suggestion = findNearestRegisteredTool(params.toolName, params.availableToolNames);
  if (!suggestion) {
    return (
      `Tool "${params.toolName}" is not registered, and no registered tool has a similar name. ` +
      `Use \`${TOOL_CATALOG_TOOL.name}\` to see what this run can call.`
    );
  }

  return (
    `Tool "${params.toolName}" is not registered. Did you mean "${suggestion.name}"? ` +
    `Its contract is below — call it directly with these arguments.\n\n` +
    `${renderToolContract(suggestion)}\n\n` +
    `If that is not the capability you wanted, \`${TOOL_CATALOG_TOOL.name}\` lists everything available.`
  );
}
