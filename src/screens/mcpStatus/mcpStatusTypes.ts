import type { AppPalette } from '../../theme/useAppTheme';
import type { createMcpStatusStyles } from './mcpStatusStyles';

export type McpStatusStyles = ReturnType<typeof createMcpStatusStyles>;
export type McpStatusTranslation = (key: string, params?: any) => string;
export type McpStatusPalette = AppPalette;
