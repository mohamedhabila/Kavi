// ---------------------------------------------------------------------------
// Kavi — Web Tool Definitions
// ---------------------------------------------------------------------------
// Web search and fetch tools.

import { ToolDefinition } from '../../../types/tool';
import { WEB_SEARCH_TOOL } from '../web-search';
import { WEB_FETCH_TOOL } from '../web-fetch';

export const WEB_DOMAIN_TOOLS: ToolDefinition[] = [WEB_SEARCH_TOOL, WEB_FETCH_TOOL];
