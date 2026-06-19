import type { SkillEntry } from '../skills/types';

export interface SkillInstallResult {
  success: boolean;
  skillEntry?: SkillEntry;
  error?: string;
}
