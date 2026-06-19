import type { AppPalette } from '../../theme/useAppTheme';
import type { ConfigEditorModalShellStyles } from '../components/ConfigEditorModal';

export type TranslationFn = (key: string, params?: any) => string;
export type StyleMap = Record<string, any>;

export type SettingsRemoteConfigModalSharedProps = {
  colors: AppPalette;
  styles: StyleMap;
  shellStyles: ConfigEditorModalShellStyles;
  t: TranslationFn;
};
