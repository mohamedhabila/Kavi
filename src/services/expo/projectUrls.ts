import type { ExpoProjectConfig } from '../../types/remote';
import type { ExpoPublicUrl } from './contracts';

function normalizePublicUrl(value?: string | null): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return undefined;
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function getExpoProjectPublicUrls(
  project: Pick<ExpoProjectConfig, 'webUrl' | 'previewUrl' | 'customDomain'>,
): ExpoPublicUrl[] | undefined {
  const urls: ExpoPublicUrl[] = [];
  const webUrl = normalizePublicUrl(project.webUrl);
  const previewUrl = normalizePublicUrl(project.previewUrl);
  const customDomain = normalizePublicUrl(project.customDomain);

  if (webUrl) {
    urls.push({ label: 'web', url: webUrl });
  }
  if (previewUrl) {
    urls.push({ label: 'preview', url: previewUrl });
  }
  if (customDomain) {
    urls.push({ label: 'custom-domain', url: customDomain });
  }

  return urls.length ? urls : undefined;
}
