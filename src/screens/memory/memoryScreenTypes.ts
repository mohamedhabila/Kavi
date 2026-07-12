import type { MemoryFactManagementQueryResult } from '../../services/memory/memoryTools';
import type { MemoryEpisode } from '../../services/memory/episodes/types';
import type { MemoryDiagnosticsSnapshot } from '../../services/memory/memoryDiagnostics';
import type { MemoryOverviewSnapshot } from '../../services/memory/memoryOverview';
import type { AppPalette } from '../../theme/useAppTheme';
import type { createMemoryScreenStyles } from './memoryScreenStyles';

export type MemoryTab = 'overview' | 'facts';
export type MemoryFactRow = MemoryFactManagementQueryResult['facts'][number];
export type MemoryEpisodeRow = MemoryEpisode;
export type MemoryScreenStyles = ReturnType<typeof createMemoryScreenStyles>;
export type MemoryScreenPalette = AppPalette;
export type MemoryScreenTranslation = (key: string, params?: any) => string;
export type MemoryOverview = MemoryOverviewSnapshot;
export type MemoryDiagnostics = MemoryDiagnosticsSnapshot;
