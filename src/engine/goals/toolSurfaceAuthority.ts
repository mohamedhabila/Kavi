// ---------------------------------------------------------------------------
// Kavi — Chitchat Tool Authority
// ---------------------------------------------------------------------------
// The tools a chitchat run may actually execute, as distinct from the tools a
// turn advertises (`resolveTurnToolSurface` in ./toolSurface). Extracted from
// toolSurface.ts to keep that file under the repository's maintainability
// line limit; the two modules share the same contract-derived predicate
// (`isChitchatAuthorizedTool`) so disclosure and authority can never quietly
// disagree about a given tool.
// ---------------------------------------------------------------------------

import type { ToolDefinition } from '../../types/tool';
import type { ConversationMode } from '../../types/conversation';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { isToolAllowedForConversationMode } from '../tools/conversationModeToolAuthority';

/**
 * An open-world tool reaches an unbounded external surface — the whole web, an
 * arbitrary device action — rather than a fixed, reviewed one. Read-only open-world
 * tools (`web_search`, `web_fetch`) stay in bounds for chitchat: discovery cannot
 * itself change anything, so there is nothing here for escalation to gate. A tool
 * that is open-world *and* can act on what it reaches — a device automation, an
 * unreviewed MCP tool that both browses and mutates — is exactly the capability
 * chitchat's "no persona swap" boundary exists to keep behind escalation, so it is
 * excluded regardless of category.
 */
function isOpenWorldMutatingTool(tool: Pick<ToolDefinition, 'contract'>): boolean {
  const riskHints = tool.contract?.riskHints ?? [];
  return riskHints.includes('open_world') && !riskHints.includes('read_only');
}

/**
 * Whether chitchat may call this tool at all, decided entirely from its contract:
 * not a category reserved for agentic orchestration (`conversationModeToolAuthority`)
 * and not an open-world tool that can also mutate what it reaches. This is the one
 * predicate both `resolveAuthorizedToolNames` (what a chitchat run may execute) and
 * `resolveTurnToolSurface` (whether a discovered instance of it stays on the
 * surface) consult, so the two questions can never quietly disagree.
 */
export function isChitchatAuthorizedTool(tool: Pick<ToolDefinition, 'name' | 'contract'>): boolean {
  return isToolAllowedForConversationMode(tool, 'chitchat') && !isOpenWorldMutatingTool(tool);
}

/**
 * The tools a run may execute, as distinct from the tools a turn advertises.
 *
 * `resolveTurnToolSurface` answers "what is worth showing the model next" — it narrows by
 * progressive disclosure, token budget, and workflow staging. That is a guess about the
 * near future, and a guess is not grounds for refusing a call: which capability a task
 * needs only becomes knowable once the work is under way. Treating the advertised list as
 * a permission list made every unpredicted need a hard error, and the error told the run
 * to route through `tool_catalog` — a step that is pure overhead at best, and was
 * traced on-device failing to return at all, stranding a capability the run already held.
 *
 * Authority is a genuinely different question with a genuinely different answer, and it is
 * the one execution must consult. In an agentic run every registered, policy-authorized
 * tool is authorized; disclosure only decides the order the model meets them. Chitchat is
 * a real restriction rather than a presentation choice — the mode exists so a casual
 * conversation cannot mutate state — so there the permitted set is the answer, and a turn
 * needing more escalates rather than quietly proceeding.
 *
 * The permitted set itself is contract-derived (`isChitchatAuthorizedTool`), not a
 * maintained list of tool names: every registered tool is authorized unless its contract
 * places it in a category agentic orchestration owns, or marks it an open-world tool that
 * can also mutate what it reaches. A tool this run has activated through `tool_catalog`
 * needs no separate allowance — if its contract clears the bar, it was already authorized
 * before it was discovered; if it does not, discovering it is exactly the signal
 * `detectChitchatModeEscalation` uses to escalate the conversation instead.
 */
export function resolveAuthorizedToolNames(params: {
  allTools: ReadonlyArray<ToolDefinition>;
  conversationMode?: ConversationMode;
  explicitToolSurfaceToolNames?: ReadonlyArray<string>;
}): Set<string> {
  /**
   * An empty set means "no mode restriction applies", not "nothing is permitted".
   *
   * An agentic run's authority is already stated completely by the run allowlist and the
   * memory policy, both enforced before this is consulted. Enumerating a second set here
   * could only disagree with them, and would do so silently: tools reach the surface from
   * registries this list does not see — `tool_catalog` among them — so an enumeration
   * built from `allTools` would quietly refuse capabilities the run genuinely holds.
   */
  if (params.conversationMode !== 'chitchat') {
    return new Set<string>();
  }

  // Discovery is always permitted: learning what exists mutates nothing, and chitchat
  // needs it to recognise when a request has outgrown the mode.
  const authorized = new Set<string>(['tool_catalog', 'tool_describe']);
  for (const tool of params.allTools) {
    const normalizedName = normalizeToolName(tool.name);
    if (normalizedName && isChitchatAuthorizedTool(tool)) {
      authorized.add(normalizedName);
    }
  }
  for (const toolName of params.explicitToolSurfaceToolNames ?? []) {
    const normalized = normalizeToolName(toolName);
    if (normalized) {
      authorized.add(normalized);
    }
  }
  return authorized;
}
