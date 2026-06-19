import { Text, TouchableOpacity, View } from 'react-native';
import { Cpu, FolderOpen, GitBranch, Menu, Terminal, X } from 'lucide-react-native';
import { ModelSelector } from '../../components/chat/ModelSelector';
import { PersonaSelector } from '../../components/chat/PersonaSelector';
import { formatLocalRuntimeBadgeLabel } from '../chatFormatting';
import { createStyles } from '../ChatScreen.styles';
import type { AppPalette } from '../../theme/useAppTheme';
import type { Conversation } from '../../types/conversation';
import type { LocalLlmRuntimeStatus } from '../../services/localLlm/types';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

type ChatScreenHeaderProps = {
  activeConversation?: Conversation;
  activeLocalRuntimeStatus: LocalLlmRuntimeStatus | null;
  activeProviderId: string | null;
  colors: AppPalette;
  currentModel?: string | null;
  isAgenticMode: boolean;
  isConversationBusy: boolean;
  onModelSelect: (providerId: string, model: string) => void;
  onOpenFiles: () => void;
  onOpenMenu: () => void;
  onOpenTerminal: () => void;
  onPersonaSelect: (personaId: string) => void;
  onToggleMode: () => void;
  onToggleSideThread: () => void;
  styles: ReturnType<typeof createStyles>;
  t: TranslationFn;
};

export function ChatScreenHeader(props: ChatScreenHeaderProps) {
  return (
    <View style={props.styles.header}>
      <TouchableOpacity
        style={props.styles.headerMenuButton}
        onPress={props.onOpenMenu}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={props.t('chat.openMenu')}
      >
        <Menu size={24} color={props.colors.text} />
      </TouchableOpacity>
      <View style={props.styles.headerCenter}>
        <View style={props.styles.headerControls}>
          <TouchableOpacity
            onPress={props.onToggleMode}
            disabled={props.isConversationBusy}
            style={[
              props.styles.modeBadge,
              props.isAgenticMode ? props.styles.modeBadgeAgentic : props.styles.modeBadgeDirect,
              props.isConversationBusy && { opacity: 0.5 },
            ]}
            hitSlop={8}
            accessibilityRole="switch"
            accessibilityState={{ checked: props.isAgenticMode }}
            accessibilityLabel={props.t('chat.conversationModeAccessibility', {
              current: props.isAgenticMode
                ? props.t('chat.agenticModeLabel')
                : props.t('chat.chitchatModeLabel'),
              next: props.isAgenticMode
                ? props.t('chat.chitchatModeLabel')
                : props.t('chat.agenticModeLabel'),
            })}
            accessibilityHint={props.t('chat.conversationModeSwitchHint')}
          >
            <Text
              style={[
                props.styles.modeBadgeText,
                props.isAgenticMode
                  ? props.styles.modeBadgeTextAgentic
                  : props.styles.modeBadgeTextDirect,
              ]}
              numberOfLines={1}
            >
              {props.isAgenticMode
                ? props.t('chat.agenticModeChip')
                : props.t('chat.chitchatModeChip')}
            </Text>
          </TouchableOpacity>
          {!props.isAgenticMode ? (
            <View style={props.styles.headerPersonaSelector}>
              <PersonaSelector
                selectedPersonaId={props.activeConversation?.personaId || 'default'}
                onSelect={props.onPersonaSelect}
              />
            </View>
          ) : null}
          <View style={props.styles.headerModelSelector}>
            <ModelSelector
              selectedProviderId={
                props.activeConversation?.providerId ?? props.activeProviderId ?? null
              }
              selectedModel={props.currentModel ?? null}
              onSelect={props.onModelSelect}
            />
            {props.activeLocalRuntimeStatus ? (
              <View
                style={[
                  props.styles.headerRuntimeBadge,
                  props.activeLocalRuntimeStatus.activeBackend === 'gpu'
                    ? props.styles.headerRuntimeBadgeGpu
                    : props.styles.headerRuntimeBadgeCpu,
                ]}
              >
                <Cpu
                  size={11}
                  color={
                    props.activeLocalRuntimeStatus.activeBackend === 'gpu'
                      ? props.colors.primary
                      : props.colors.textSecondary
                  }
                />
                <Text
                  style={[
                    props.styles.headerRuntimeBadgeText,
                    props.activeLocalRuntimeStatus.activeBackend === 'gpu'
                      ? props.styles.headerRuntimeBadgeTextGpu
                      : props.styles.headerRuntimeBadgeTextCpu,
                  ]}
                  numberOfLines={1}
                >
                  {formatLocalRuntimeBadgeLabel(props.activeLocalRuntimeStatus)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
      <View style={props.styles.headerActions}>
        <TouchableOpacity
          style={props.styles.headerActionButton}
          onPress={props.onOpenFiles}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={props.t('nav.files')}
        >
          <FolderOpen size={20} color={props.colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={props.styles.headerActionButton}
          onPress={props.onOpenTerminal}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={props.t('nav.terminal')}
        >
          <Terminal size={20} color={props.colors.textSecondary} />
        </TouchableOpacity>
        {props.activeConversation ? (
          <TouchableOpacity
            style={props.styles.headerActionButton}
            onPress={props.onToggleSideThread}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              props.activeConversation.isSideThread
                ? props.t('chat.discardSideThread')
                : props.t('chat.startSideThread')
            }
            testID={
              props.activeConversation.isSideThread
                ? 'chat-discard-side-thread'
                : 'chat-start-side-thread'
            }
          >
            {props.activeConversation.isSideThread ? (
              <X size={20} color={props.colors.textSecondary} />
            ) : (
              <GitBranch size={20} color={props.colors.textSecondary} />
            )}
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}
