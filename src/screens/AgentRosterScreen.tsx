// ---------------------------------------------------------------------------
// Kavi — Agent Roster & Queue Screen
// ---------------------------------------------------------------------------
// Shows built-in + custom personas, sub-agent activity, task queue status.

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { useNavigation } from '@react-navigation/native';
import { Menu, Users, Plus, Edit3, Trash2, Bot, Cpu, X } from 'lucide-react-native';
import { useAppTheme, AppPalette } from '../theme/useAppTheme';
import { useTranslation } from '../i18n/useTranslation';
import { SubAgentActivityCard } from '../components/agents/SubAgentActivityCard';
import { SubAgentDetailModal } from '../components/agents/SubAgentDetailModal';
import { BUILT_IN_PERSONAS, type AgentPersona } from '../services/agents/personas';
import { usePersonaConfigStore } from '../services/agents/store';
import { listActiveSubAgents, onSubAgentEvent } from '../services/agents/subAgent';
import {
  buildSubAgentHierarchy,
  buildSubAgentRollupMap,
} from '../services/agents/lifecycle/subAgentHierarchyPresentation';
import { generateId } from '../utils/id';

export const AgentRosterScreen: React.FC = () => {
  const navigation = useNavigation<DrawerNavigationProp<any>>();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const overrides = usePersonaConfigStore((s) => s.overrides);
  const customPersonas = usePersonaConfigStore((s) => s.customPersonas);
  const upsertCustom = usePersonaConfigStore((s) => s.upsertCustomPersona);
  const removeCustom = usePersonaConfigStore((s) => s.removeCustomPersona);
  const setOverride = usePersonaConfigStore((s) => s.setOverride);
  const clearOverride = usePersonaConfigStore((s) => s.clearOverride);

  const [activeTab, setActiveTab] = useState<'roster' | 'queue'>('roster');
  const [showEditor, setShowEditor] = useState(false);
  const [editingPersona, setEditingPersona] = useState<AgentPersona | null>(null);
  const [subAgents, setSubAgents] = useState(listActiveSubAgents());
  const [selectedSubAgent, setSelectedSubAgent] = useState<(typeof subAgents)[number] | null>(null);

  // Merge built-in + custom personas
  const allPersonas: AgentPersona[] = useMemo(() => {
    return [
      ...BUILT_IN_PERSONAS.map((p) => ({
        ...p,
        ...overrides[p.id],
      })),
      ...customPersonas,
    ];
  }, [overrides, customPersonas]);

  const refreshQueue = useCallback(() => {
    setSubAgents(listActiveSubAgents());
  }, []);

  useEffect(
    () =>
      onSubAgentEvent(() => {
        setSubAgents(listActiveSubAgents());
      }),
    [],
  );

  const hierarchicalSubAgents = useMemo(() => buildSubAgentHierarchy(subAgents), [subAgents]);
  const subAgentRollups = useMemo(() => buildSubAgentRollupMap(subAgents), [subAgents]);

  const handleEditPersona = useCallback((persona: AgentPersona) => {
    setEditingPersona(persona);
    setShowEditor(true);
  }, []);

  const handleDeletePersona = useCallback(
    (persona: AgentPersona) => {
      const isBuiltIn = BUILT_IN_PERSONAS.some((p) => p.id === persona.id);
      if (isBuiltIn) {
        Alert.alert(
          t('agentRoster.resetTitle'),
          t('agentRoster.resetConfirm', { name: persona.name }),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('agentRoster.resetAction'), onPress: () => clearOverride(persona.id) },
          ],
        );
      } else {
        Alert.alert(
          t('agentRoster.deleteTitle'),
          t('agentRoster.deleteConfirm', { name: persona.name }),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('common.delete'),
              style: 'destructive',
              onPress: () => removeCustom(persona.id),
            },
          ],
        );
      }
    },
    [clearOverride, removeCustom, t],
  );

  const handleNewPersona = useCallback(() => {
    setEditingPersona(null);
    setShowEditor(true);
  }, []);

  const handleSavePersona = useCallback(
    (persona: AgentPersona) => {
      const isBuiltIn = BUILT_IN_PERSONAS.some((p) => p.id === persona.id);
      if (isBuiltIn) {
        setOverride(persona.id, {
          name: persona.name,
          description: persona.description,
          systemPrompt: persona.systemPrompt,
          model: persona.model,
          providerId: persona.providerId,
          temperature: persona.temperature,
          thinkingLevel: persona.thinkingLevel,
        });
      } else {
        upsertCustom(persona);
      }
      setShowEditor(false);
      setEditingPersona(null);
    },
    [setOverride, upsertCustom],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.openDrawer()} hitSlop={8}>
          <Menu size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('agentRoster.title')}</Text>
        <TouchableOpacity onPress={handleNewPersona} hitSlop={8}>
          <Plus size={24} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'roster' && styles.tabActive]}
          onPress={() => setActiveTab('roster')}
        >
          <Users size={16} color={activeTab === 'roster' ? colors.primary : colors.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'roster' && styles.tabTextActive]}>
            {t('agentRoster.personasTab', { count: allPersonas.length })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'queue' && styles.tabActive]}
          onPress={() => {
            setActiveTab('queue');
            refreshQueue();
          }}
        >
          <Cpu size={16} color={activeTab === 'queue' ? colors.primary : colors.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'queue' && styles.tabTextActive]}>
            {t('agentRoster.subAgentsTab', { count: subAgents.length })}
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'roster' ? (
        <FlatList
          data={allPersonas}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const isBuiltIn = BUILT_IN_PERSONAS.some((p) => p.id === item.id);
            const hasOverride = !!overrides[item.id];
            return (
              <View style={styles.personaCard}>
                <View style={styles.personaHeader}>
                  <Text style={styles.personaIcon}>{item.icon || '🤖'}</Text>
                  <View style={styles.personaInfo}>
                    <View style={styles.personaNameRow}>
                      <Text style={styles.personaName}>{item.name}</Text>
                      {isBuiltIn && (
                        <View style={styles.builtInBadge}>
                          <Text style={styles.builtInText}>{t('agentRoster.builtInBadge')}</Text>
                        </View>
                      )}
                      {hasOverride && (
                        <View style={styles.customBadge}>
                          <Text style={styles.customBadgeText}>
                            {t('agentRoster.modifiedBadge')}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.personaDesc} numberOfLines={2}>
                      {item.description}
                    </Text>
                  </View>
                </View>
                <View style={styles.personaMeta}>
                  {item.model && (
                    <Text style={styles.metaText}>
                      {t('agentRoster.modelMeta', { model: item.model })}
                    </Text>
                  )}
                  {item.thinkingLevel && item.thinkingLevel !== 'off' && (
                    <Text style={styles.metaText}>
                      {t('agentRoster.thinkingMeta', { level: item.thinkingLevel })}
                    </Text>
                  )}
                  {item.temperature !== undefined && (
                    <Text style={styles.metaText}>
                      {t('agentRoster.temperatureMeta', { value: item.temperature })}
                    </Text>
                  )}
                </View>
                <View style={styles.personaActions}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleEditPersona(item)}
                  >
                    <Edit3 size={14} color={colors.primary} />
                    <Text style={styles.actionText}>{t('common.edit')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleDeletePersona(item)}
                  >
                    <Trash2 size={14} color={colors.danger} />
                    <Text style={[styles.actionText, { color: colors.danger }]}>
                      {isBuiltIn ? t('agentRoster.resetAction') : t('common.delete')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      ) : (
        <FlatList
          data={hierarchicalSubAgents}
          keyExtractor={(item) => item.snapshot.sessionId}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Bot size={48} color={colors.textTertiary} />
              <Text style={styles.emptyTitle}>{t('agentRoster.emptyQueueTitle')}</Text>
              <Text style={styles.emptySubtext}>{t('agentRoster.emptyQueueDescription')}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <SubAgentActivityCard
              snapshot={item.snapshot}
              visualDepth={item.visualDepth}
              variant="queue"
              rollup={subAgentRollups.get(item.snapshot.sessionId)}
              showOpenDetailsAction
              onOpenDetails={setSelectedSubAgent}
            />
          )}
        />
      )}

      <SubAgentDetailModal
        visible={!!selectedSubAgent}
        selectedSnapshot={selectedSubAgent}
        availableSnapshots={subAgents}
        onClose={() => setSelectedSubAgent(null)}
      />

      {/* Persona Editor Modal */}
      <PersonaEditorModal
        visible={showEditor}
        persona={editingPersona}
        colors={colors}
        t={t}
        onSave={handleSavePersona}
        onCancel={() => {
          setShowEditor(false);
          setEditingPersona(null);
        }}
      />
    </SafeAreaView>
  );
};

// ── Persona Editor Modal ─────────────────────────────────────────────────

const PersonaEditorModal: React.FC<{
  visible: boolean;
  persona: AgentPersona | null;
  colors: AppPalette;
  t: (key: string, params?: Record<string, string | number>) => string;
  onSave: (persona: AgentPersona) => void;
  onCancel: () => void;
}> = ({ visible, persona, colors, t, onSave, onCancel }) => {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [model, setModel] = useState('');
  const [icon, setIcon] = useState('');

  React.useEffect(() => {
    if (persona) {
      setName(persona.name);
      setDescription(persona.description);
      setSystemPrompt(persona.systemPrompt);
      setModel(persona.model ?? '');
      setIcon(persona.icon ?? '🤖');
    } else {
      setName('');
      setDescription('');
      setSystemPrompt('');
      setModel('');
      setIcon('🤖');
    }
  }, [persona, visible]);

  const handleSave = () => {
    if (!name.trim() || !systemPrompt.trim()) {
      Alert.alert(t('agentRoster.requiredTitle'), t('agentRoster.requiredMessage'));
      return;
    }
    onSave({
      id: persona?.id ?? `custom-${generateId()}`,
      name: name.trim(),
      description: description.trim(),
      systemPrompt: systemPrompt.trim(),
      model: model.trim() || undefined,
      icon: icon.trim() || '🤖',
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onCancel}>
            <X size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>
            {persona ? t('agentRoster.editPersonaTitle') : t('agentRoster.newPersonaTitle')}
          </Text>
          <TouchableOpacity onPress={handleSave}>
            <Text style={styles.saveBtn}>{t('common.save')}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>{t('agentRoster.iconLabel')}</Text>
          <TextInput
            style={styles.input}
            value={icon}
            onChangeText={setIcon}
            placeholder={t('agentRoster.iconPlaceholder')}
            placeholderTextColor={colors.textTertiary}
          />

          <Text style={styles.fieldLabel}>{t('agentRoster.nameLabel')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('agentRoster.namePlaceholder')}
            placeholderTextColor={colors.textTertiary}
          />

          <Text style={styles.fieldLabel}>{t('agentRoster.descriptionLabel')}</Text>
          <TextInput
            style={styles.input}
            value={description}
            onChangeText={setDescription}
            placeholder={t('agentRoster.descriptionPlaceholder')}
            placeholderTextColor={colors.textTertiary}
          />

          <Text style={styles.fieldLabel}>{t('agentRoster.systemPromptLabel')}</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={systemPrompt}
            onChangeText={setSystemPrompt}
            placeholder={t('agentRoster.systemPromptPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
          />

          <Text style={styles.fieldLabel}>{t('agentRoster.modelOverrideLabel')}</Text>
          <TextInput
            style={styles.input}
            value={model}
            onChangeText={setModel}
            placeholder={t('agentRoster.modelOverridePlaceholder')}
            placeholderTextColor={colors.textTertiary}
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.header,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
    tabBar: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    tab: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 12,
    },
    tabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
    tabText: { fontSize: 13, color: colors.textSecondary },
    tabTextActive: { color: colors.primary, fontWeight: '600' },
    list: { padding: 16, gap: 12 },
    personaCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 8,
    },
    personaHeader: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    personaIcon: { fontSize: 28 },
    personaInfo: { flex: 1, gap: 2 },
    personaNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    personaName: { fontSize: 15, fontWeight: '600', color: colors.text },
    builtInBadge: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 4,
      backgroundColor: colors.primarySoft,
    },
    builtInText: { fontSize: 10, fontWeight: '600', color: colors.primary },
    customBadge: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 4,
      backgroundColor: colors.warningBackground,
    },
    customBadgeText: { fontSize: 10, fontWeight: '600', color: colors.warning },
    personaDesc: { fontSize: 12, color: colors.textSecondary, lineHeight: 16 },
    personaMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    metaText: { fontSize: 11, color: colors.textTertiary },
    personaActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4 },
    actionText: { fontSize: 12, color: colors.primary, fontWeight: '500' },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 40,
      gap: 12,
      marginTop: 40,
    },
    emptyTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
    emptySubtext: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    // Modal
    modalContainer: { flex: 1, backgroundColor: colors.background },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    modalTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
    saveBtn: { fontSize: 16, fontWeight: '600', color: colors.primary },
    modalBody: { flex: 1, padding: 16, gap: 12 },
    fieldLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
      marginTop: 12,
      marginBottom: 4,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 10,
      fontSize: 14,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    multiline: { minHeight: 120 },
  });
