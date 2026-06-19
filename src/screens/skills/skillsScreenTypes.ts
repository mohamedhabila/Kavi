import type { buildSkillEligibilityContext } from '../../services/skills/eligibility';
import type { AppPalette } from '../../theme/useAppTheme';
import type { createSkillsScreenStyles } from './skillsScreenStyles';

export type SkillsScreenStyles = ReturnType<typeof createSkillsScreenStyles>;
export type SkillsScreenPalette = AppPalette;
export type SkillsScreenTranslation = (key: string, params?: any) => string;
export type SkillEligibilityContext = ReturnType<typeof buildSkillEligibilityContext>;
