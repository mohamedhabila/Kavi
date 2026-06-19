// ---------------------------------------------------------------------------
// Kavi — Extended Tool Definitions
// ---------------------------------------------------------------------------
// File edit, search, cron, and image tools.

import { ToolDefinition } from '../../../types/tool';
import {
  FILE_EDIT_TOOL,
  GLOB_SEARCH_TOOL,
  TEXT_SEARCH_TOOL,
  CRON_TOOL,
  IMAGE_GEN_TOOL,
  IMAGE_EDIT_TOOL,
} from '../extended-definitions';

export const EXTENDED_DOMAIN_TOOLS: ToolDefinition[] = [
  FILE_EDIT_TOOL,
  GLOB_SEARCH_TOOL,
  TEXT_SEARCH_TOOL,
  CRON_TOOL,
  IMAGE_GEN_TOOL,
  IMAGE_EDIT_TOOL,
];
