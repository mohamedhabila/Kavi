import type { SkillEntry } from '../skills/types';

export type SkillInstallFailureKind =
  | 'compatibility'
  | 'invalid_manifest'
  | 'invalid_source'
  | 'source_unavailable'
  | 'transport'
  | 'unexpected';

export type SkillInstallResult =
  | { success: true; skillEntry: SkillEntry }
  | { success: false; failureKind: SkillInstallFailureKind; error: string };
