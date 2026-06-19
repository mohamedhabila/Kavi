// ---------------------------------------------------------------------------
// Kavi — PersonaSelector Component
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Bot, Check, ChevronDown, ClipboardList, Code2, Pencil, Search } from 'lucide-react-native';
import { AgentPersona } from '../../services/agents/personas';
import { getAvailablePersonasForConfig } from '../../services/agents/registry';
import { usePersonaConfigStore } from '../../services/agents/store';
import { useAppTheme, AppPalette } from '../../theme/useAppTheme';
import { useTranslation } from '../../i18n/useTranslation';

interface PersonaSelectorProps {
  selectedPersonaId: string | null;
  onSelect: (personaId: string) => void;
}

type PersonaVisual = {
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  background: string;
  border: string;
  color: string;
};

const PERSONA_VISUALS: Record<string, PersonaVisual> = {
  default: { Icon: Bot, background: '#E6F0FF', border: '#B8D3FF', color: '#1E56B3' },
  coder: { Icon: Code2, background: '#E8F7EE', border: '#B7E2C6', color: '#186A3B' },
  researcher: { Icon: Search, background: '#FFF4DD', border: '#F2D4A0', color: '#8B5A12' },
  writer: { Icon: Pencil, background: '#FCEBF1', border: '#E8BED0', color: '#9F3A63' },
  planner: { Icon: ClipboardList, background: '#ECEFFF', border: '#C7D0FF', color: '#3F51B5' },
};

function getPersonaVisual(personaId: string): PersonaVisual {
  return PERSONA_VISUALS[personaId] || PERSONA_VISUALS.default;
}

function PersonaBadge({ persona, size }: { persona: AgentPersona; size: 'compact' | 'regular' }) {
  const visual = getPersonaVisual(persona.id);
  const iconSize = size === 'compact' ? 15 : 20;
  const badgeStyle = size === 'compact' ? stylesStatic.compactBadge : stylesStatic.regularBadge;
  const Icon = visual.Icon;

  return (
    <View
      style={[
        stylesStatic.badgeBase,
        badgeStyle,
        { backgroundColor: visual.background, borderColor: visual.border },
      ]}
    >
      <Icon size={iconSize} color={visual.color} />
    </View>
  );
}

export const PersonaSelector: React.FC<PersonaSelectorProps> = React.memo(
  ({ selectedPersonaId, onSelect }) => {
    const { colors } = useAppTheme();
    const { t } = useTranslation();
    const styles = createStyles(colors);
    const [visible, setVisible] = useState(false);
    const customPersonas = usePersonaConfigStore((state) => state.customPersonas);
    const overrides = usePersonaConfigStore((state) => state.overrides);
    const personas = useMemo(
      () => getAvailablePersonasForConfig(overrides, customPersonas),
      [customPersonas, overrides],
    );

    const current = personas.find((p) => p.id === selectedPersonaId) || personas[0];

    return (
      <>
        <TouchableOpacity
          style={styles.selector}
          onPress={() => setVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={t('persona.selectorLabel', { name: current.name })}
        >
          <PersonaBadge persona={current} size="compact" />
          <ChevronDown size={12} color={colors.textSecondary} />
        </TouchableOpacity>

        <Modal
          visible={visible}
          transparent
          animationType="slide"
          onRequestClose={() => setVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modal}>
              <Text style={styles.title}>{t('persona.title')}</Text>
              <FlatList
                data={personas}
                keyExtractor={(p) => p.id}
                renderItem={({ item }) => {
                  const isSelected = item.id === (selectedPersonaId || 'default');
                  return (
                    <TouchableOpacity
                      style={[styles.item, isSelected && styles.itemSelected]}
                      onPress={() => {
                        onSelect(item.id);
                        setVisible(false);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t('persona.selectPersona', { name: item.name })}
                      accessibilityState={{ selected: isSelected }}
                    >
                      <PersonaBadge persona={item} size="regular" />
                      <View style={styles.itemContent}>
                        <Text style={[styles.itemName, isSelected && styles.itemNameSelected]}>
                          {item.name}
                        </Text>
                        <Text style={styles.itemDesc} numberOfLines={1}>
                          {item.description}
                        </Text>
                      </View>
                      {isSelected && <Check size={16} color={colors.primary} />}
                    </TouchableOpacity>
                  );
                }}
              />
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setVisible(false)}
                accessibilityRole="button"
                accessibilityLabel={t('persona.closeSelector')}
              >
                <Text style={styles.closeBtnText}>{t('common.close')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </>
    );
  },
);

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    selector: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingHorizontal: 6,
      paddingVertical: 4,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 12,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    modal: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '60%',
      padding: 20,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 16,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      borderRadius: 12,
      gap: 12,
      marginBottom: 4,
    },
    itemSelected: {
      backgroundColor: colors.primarySoft || colors.surfaceAlt,
    },
    itemContent: {
      flex: 1,
    },
    itemName: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    itemNameSelected: {
      color: colors.primary,
    },
    itemDesc: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    closeBtn: {
      alignItems: 'center',
      paddingVertical: 14,
      marginTop: 8,
    },
    closeBtnText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.primary,
    },
  });

const stylesStatic = StyleSheet.create({
  badgeBase: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  compactBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  regularBadge: {
    width: 40,
    height: 40,
    borderRadius: 14,
  },
});
