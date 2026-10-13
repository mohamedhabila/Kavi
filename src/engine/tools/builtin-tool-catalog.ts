// ---------------------------------------------------------------------------
// Kavi — tool_catalog
// ---------------------------------------------------------------------------
// The run exposes a small set of tools per turn; the rest of the catalog is found by
// searching for what is needed (see builtin-tool-catalogSearch.ts). A tool a search returns
// becomes callable on the model's next step.
// ---------------------------------------------------------------------------

import { searchToolCatalog } from './builtin-tool-catalogSearch';
import type {
  ExecuteToolCatalogArgs,
  ExecuteToolCatalogOptions,
} from './builtin-tool-catalogTypes';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';
import { resolveMemoryPolicyVisibleToolNames } from './memoryPolicyCatalogVisibility';

export async function executeToolCatalog(
  args: ExecuteToolCatalogArgs,
  options?: ExecuteToolCatalogOptions,
): Promise<ToolRuntimeOutcome> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    return failedToolOutcome(
      JSON.stringify({
        error: 'tool_catalog needs a query: say in a few words what you need to do.',
      }),
    );
  }
  const tools = searchToolCatalog(query, {
    availableToolNames: resolveMemoryPolicyVisibleToolNames(options?.availableToolNames),
    visibleToolNames: resolveMemoryPolicyVisibleToolNames(options?.visibleToolNames),
  });
  return completedToolOutcome(JSON.stringify({ mode: 'search', query, tools }));
}
