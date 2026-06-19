import { useSettingsStore } from '../../../src/store/useSettingsStore';
import {
  deriveConsolidationStatusSnapshot,
  getConsolidationStatusSnapshot,
} from '../../../src/services/memory/consolidationStatus';

describe('getConsolidationStatusSnapshot', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      disableLongTermMemory: false,
      consolidationProvider: '',
      activeProviderId: 'chat-provider',
      providers: [
        {
          id: 'chat-provider',
          name: 'Chat Provider',
          baseUrl: 'https://api.example.com',
          apiKey: '',
          model: 'gpt-test',
          enabled: true,
        },
      ],
    } as never);
  });

  it('reports disabled memory when long-term memory is opted out', () => {
    useSettingsStore.setState({ disableLongTermMemory: true } as never);
    const snapshot = getConsolidationStatusSnapshot();
    expect(snapshot.memoryDisabled).toBe(true);
    expect(snapshot.mode).toBe('auto');
  });

  it('uses configured provider tier when explicitly selected', () => {
    useSettingsStore.setState({
      consolidationProvider: 'chat-provider',
    } as never);
    const snapshot = getConsolidationStatusSnapshot();
    expect(snapshot.tier).toBe('configured');
    expect(snapshot.isFallback).toBe(false);
    expect(snapshot.providerName).toBe('Chat Provider');
  });

  it('falls back to chat provider when no dedicated provider is selected', () => {
    const snapshot = getConsolidationStatusSnapshot();
    expect(snapshot.tier).toBe('chat');
    expect(snapshot.isFallback).toBe(true);
  });

  it('deriveConsolidationStatusSnapshot matches store snapshot for the same inputs', () => {
    const settings = useSettingsStore.getState();
    expect(
      deriveConsolidationStatusSnapshot({
        disableLongTermMemory: settings.disableLongTermMemory === true,
        memoryConsolidationMode: 'auto',
        consolidationProviderId: settings.consolidationProvider ?? null,
        activeProviderId: settings.activeProviderId ?? null,
        providers: settings.providers,
      }),
    ).toEqual(getConsolidationStatusSnapshot());
  });
});