import type { RefObject } from 'react';

import type { CodeEditorWebViewRef, EditorLanguage } from '../../components/editor/CodeEditorWebView';
import type { FileEntry } from '../../components/files/FileBrowser';
import type { AppPalette } from '../../theme/useAppTheme';
import type { SshTargetConfig, WorkspaceTargetConfig } from '../../types/remote';
import type { createCodeEditorScreenStyles } from './codeEditorScreenStyles';

export type CodeEditorSource = 'local' | 'workspace' | 'ssh';
export type CodeEditorTarget = SshTargetConfig | WorkspaceTargetConfig | null;
export type CodeEditorStyles = ReturnType<typeof createCodeEditorScreenStyles>;
export type CodeEditorPalette = AppPalette;
export type CodeEditorTranslation = (key: string, params?: any) => string;
export type CodeEditorRef = RefObject<CodeEditorWebViewRef | null>;
export type CodeEditorLanguage = EditorLanguage;
export type CodeEditorFileEntry = FileEntry;
