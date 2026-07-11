import { sendLocalNotification } from '../notifications/service';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  providerRequiresApiKey,
  resolveConversationModel,
  resolveEnabledProvider,
  resolveProviderApiKey,
} from '../llm/support/providerSupport';
import { hasBootMd, runBootOnce } from './bootRunner';

export async function runBootOnLaunchIfPresent(): Promise<void> {
  try {
    if (!(await hasBootMd())) return;
    const settings = useSettingsStore.getState();
    const provider = resolveEnabledProvider(settings.providers, settings.activeProviderId);
    if (!provider) return;
    const model = resolveConversationModel(provider, {
      activeProviderId: settings.activeProviderId,
      activeModel: settings.activeModel,
    });
    if (!model) return;
    const apiKey = await resolveProviderApiKey(provider);
    if (providerRequiresApiKey(provider) && !apiKey) return;

    const result = await runBootOnce({ ...provider, apiKey }, settings.providers, model);
    if (result.status === 'failed') {
      console.warn('[startup] BOOT.md execution failed:', result.reason || 'unknown failure');
      await sendLocalNotification({
        title: 'Startup task failed',
        body: 'Kavi could not complete BOOT.md. Open the app to review your startup instructions.',
      }).catch((error) => console.warn('[startup] BOOT.md failure notification failed:', error));
    }
  } catch (error) {
    console.warn('[startup] BOOT.md launch failed:', error);
  }
}
