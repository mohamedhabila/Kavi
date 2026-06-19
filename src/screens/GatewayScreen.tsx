// ---------------------------------------------------------------------------
// Kavi — Gateway Connection Screen
// ---------------------------------------------------------------------------
// Manages the WebSocket connection to an Kavi Gateway node.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Radio, Wifi, WifiOff, RefreshCw, Copy } from 'lucide-react-native';
import { useAppTheme, AppPalette } from '../theme/useAppTheme';
import { useTranslation } from '../i18n/useTranslation';
import {
  getGatewayClient,
  createGatewayClient,
  disconnectGateway,
} from '../services/gateway/client';
import type { GatewayConnectionState } from '../types/gateway';
import { emitGatewayEvent } from '../services/events/bus';
import * as Clipboard from 'expo-clipboard';
import { useBackToChat } from '../navigation/useBackToChat';

export const GatewayScreen: React.FC = () => {
  const handleBack = useBackToChat();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [gatewayUrl, setGatewayUrl] = useState('');
  const [gatewayToken, setGatewayToken] = useState('');
  const [connectionState, setConnectionState] = useState<GatewayConnectionState>('disconnected');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Array<{ id: string; name: string; status?: string }>>([]);

  const client = getGatewayClient();

  useEffect(() => {
    if (client) {
      const unsub = client.onStateChange((s) => setConnectionState(s));
      return unsub;
    }
  }, [client]);

  const handleConnect = useCallback(async () => {
    const url = gatewayUrl.trim();
    if (!url) {
      Alert.alert(t('common.error'), t('gateway.enterUrl'));
      return;
    }
    try {
      const c = createGatewayClient({ url, token: gatewayToken });
      c.onStateChange((s) => setConnectionState(s));
      c.connect();
      void emitGatewayEvent('connected', { gatewayUrl: url });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      void emitGatewayEvent('error', { gatewayUrl: url, error: errMsg });
      Alert.alert(t('gateway.connectionFailed'), errMsg);
    }
  }, [gatewayToken, gatewayUrl, t]);

  const handleDisconnect = useCallback(() => {
    Alert.alert(t('common.disconnect'), t('gateway.disconnectConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.disconnect'),
        style: 'destructive',
        onPress: () => {
          disconnectGateway();
          setConnectionState('disconnected');
          setPairingCode(null);
          setNodes([]);
          void emitGatewayEvent('disconnected');
        },
      },
    ]);
  }, [t]);

  const handleRequestPairing = useCallback(async () => {
    const c = getGatewayClient();
    if (!c) return;
    try {
      const code = await c.requestPairingCode();
      setPairingCode(code);
      void emitGatewayEvent('paired');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      void emitGatewayEvent('error', { error: errMsg });
      Alert.alert(t('gateway.pairingFailed'), errMsg);
    }
  }, [t]);

  const handleCopyCode = useCallback(async () => {
    if (pairingCode) {
      await Clipboard.setStringAsync(pairingCode);
      Alert.alert(t('common.copied'), t('gateway.codeCopied'));
    }
  }, [pairingCode, t]);

  const handleListNodes = useCallback(async () => {
    const c = getGatewayClient();
    if (!c) return;
    try {
      const list = await c.listNodes();
      setNodes(list);
      list.forEach((n) => void emitGatewayEvent('node_registered', { nodeId: n.id }));
    } catch (err: unknown) {
      Alert.alert(t('common.error'), err instanceof Error ? err.message : String(err));
    }
  }, [t]);

  const isConnected = connectionState === 'connected';

  const stateIcon = isConnected ? (
    <Wifi size={16} color={colors.success || colors.primary} />
  ) : (
    <WifiOff size={16} color={colors.danger} />
  );

  const stateLabel =
    connectionState === 'connecting'
      ? t('gateway.connecting')
      : connectionState === 'reconnecting'
        ? t('gateway.reconnecting')
        : connectionState === 'connected'
          ? t('gateway.connected')
          : t('gateway.disconnected');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('gateway.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {/* Explanation card */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>{t('gateway.infoTitle')}</Text>
          <Text style={styles.infoText}>{t('gateway.infoText')}</Text>
        </View>

        {/* Connection status */}
        <View style={styles.statusRow}>
          {stateIcon}
          <Text style={styles.statusText}>{stateLabel}</Text>
        </View>

        {/* Gateway URL input */}
        {!isConnected && (
          <View style={styles.section}>
            <Text style={styles.label}>{t('gateway.url')}</Text>
            <TextInput
              style={styles.input}
              value={gatewayUrl}
              onChangeText={setGatewayUrl}
              placeholder={t('gateway.urlPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={styles.label}>{t('gateway.token')}</Text>
            <TextInput
              style={styles.input}
              value={gatewayToken}
              onChangeText={setGatewayToken}
              placeholder={t('gateway.tokenPlaceholder')}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleConnect}
              accessibilityRole="button"
              accessibilityLabel={t('common.connect')}
            >
              <Text style={styles.primaryBtnText}>{t('common.connect')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {isConnected && (
          <>
            {/* Pairing */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('gateway.pairing')}</Text>
              {pairingCode ? (
                <View style={styles.codeRow}>
                  <Text style={styles.codeText}>{pairingCode}</Text>
                  <TouchableOpacity
                    onPress={handleCopyCode}
                    accessibilityRole="button"
                    accessibilityLabel={t('gateway.copyPairingCode')}
                  >
                    <Copy size={18} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={handleRequestPairing}
                  accessibilityRole="button"
                  accessibilityLabel={t('gateway.requestPairing')}
                >
                  <Text style={styles.secondaryBtnText}>{t('gateway.requestPairing')}</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Nodes */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('gateway.nodes')}</Text>
                <TouchableOpacity
                  onPress={handleListNodes}
                  accessibilityRole="button"
                  accessibilityLabel={t('gateway.refreshNodesList')}
                >
                  <RefreshCw size={16} color={colors.primary} />
                </TouchableOpacity>
              </View>
              {nodes.length === 0 ? (
                <Text style={styles.emptyText}>{t('gateway.noNodes')}</Text>
              ) : (
                nodes.map((node) => (
                  <View key={node.id} style={styles.nodeCard}>
                    <Radio size={14} color={colors.primary} />
                    <View style={styles.nodeInfo}>
                      <Text style={styles.nodeName}>{node.name || node.id}</Text>
                      <Text style={styles.nodeStatus}>{node.status || t('gateway.online')}</Text>
                    </View>
                  </View>
                ))
              )}
            </View>

            <TouchableOpacity
              style={styles.dangerBtn}
              onPress={handleDisconnect}
              accessibilityRole="button"
              accessibilityLabel={t('common.disconnect')}
            >
              <Text style={styles.dangerBtnText}>{t('common.disconnect')}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.header,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    content: {
      flex: 1,
    },
    contentInner: {
      padding: 16,
    },
    infoCard: {
      backgroundColor: colors.surfaceAlt || colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    infoTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 6,
    },
    infoText: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 12,
      paddingHorizontal: 16,
      backgroundColor: colors.surface,
      borderRadius: 10,
      marginBottom: 16,
    },
    statusText: {
      fontSize: 15,
      fontWeight: '500',
      color: colors.text,
    },
    section: {
      marginBottom: 20,
    },
    sectionTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 10,
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    label: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.textSecondary,
      marginBottom: 6,
    },
    input: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 12,
      fontSize: 15,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 12,
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
    },
    primaryBtnText: {
      color: colors.onPrimary,
      fontSize: 16,
      fontWeight: '600',
    },
    secondaryBtn: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    secondaryBtnText: {
      color: colors.primary,
      fontSize: 15,
      fontWeight: '500',
    },
    dangerBtn: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.danger,
      marginTop: 16,
    },
    dangerBtnText: {
      color: colors.danger,
      fontSize: 16,
      fontWeight: '600',
    },
    codeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    codeText: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.primary,
      letterSpacing: 4,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textTertiary,
      textAlign: 'center',
      padding: 16,
    },
    nodeCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 12,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    nodeInfo: { flex: 1 },
    nodeName: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.text,
    },
    nodeStatus: {
      fontSize: 12,
      color: colors.textTertiary,
      marginTop: 2,
    },
  });
