import { detectSearchProvider } from './providerDispatch';

/**
 * Synchronous view of whether any web search provider is configured.
 *
 * Provider keys live in secure storage behind an async read, but tool-surface
 * selection is synchronous — which is why search availability was never gated and
 * `web_search` was advertised on every turn even with no provider configured. Each
 * such turn spent a model round-trip on a call that could only fail.
 *
 * The snapshot starts optimistic so a working capability is never hidden before it has
 * been checked, and a refresh is kicked off whenever the surface is built. The first
 * turn of a fresh process may still offer the tool; every turn after the probe settles
 * reflects reality, and adding a key restores the tool without a restart.
 */
let configuredSnapshot = true;
let probeInFlight: Promise<void> | null = null;

export function isSearchProviderConfiguredSnapshot(): boolean {
  return configuredSnapshot;
}

export function refreshSearchProviderReadiness(): Promise<void> {
  if (probeInFlight) {
    return probeInFlight;
  }
  probeInFlight = detectSearchProvider()
    .then((resolved) => {
      configuredSnapshot = resolved !== null;
    })
    .catch(() => {
      // A probe failure is not evidence of an unconfigured provider, so the previous
      // snapshot stands rather than hiding a capability on a transient error.
    })
    .finally(() => {
      probeInFlight = null;
    });
  return probeInFlight;
}

/** Test seam; also lets a settings write invalidate the snapshot immediately. */
export function setSearchProviderReadinessSnapshot(configured: boolean): void {
  configuredSnapshot = configured;
}

// Primed at import rather than waiting for the first tool-surface build. The probe is
// a single secure-storage read and this module loads during startup, so the snapshot
// settles long before the first turn. Without this the first turn of every fresh
// process still advertised a tool that could only fail — the wasted call the gate
// exists to prevent.
void refreshSearchProviderReadiness();
