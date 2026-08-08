import { detectSearchProvider } from './providerDispatch';

/**
 * Synchronous view of whether any web search provider is configured.
 *
 * Provider keys live in secure storage behind an async read, but tool-surface
 * selection is synchronous — which is why search availability was never gated and
 * `web_search` was advertised on every turn even with no provider configured. Each
 * such turn spent a model round-trip on a call that could only fail.
 *
 * The snapshot is unknown until a probe settles, and unknown counts as unavailable.
 *
 * It used to start optimistic, so that a working capability was never hidden before it
 * had been checked. Observed on-device, that traded the wrong way: `web_search` was
 * offered and failed on runs with no provider configured, which is the wasted round-trip
 * this gate exists to prevent. The asymmetry is what decides it — advertising a tool that
 * cannot work costs a guaranteed failed call every time, while withholding a working one
 * costs at most the turns before the probe settles, and the refresh fired on every
 * surface build makes that self-healing. A probe error is likewise not a claim that a
 * provider exists, so it leaves the state unknown rather than asserting availability.
 */
let configuredSnapshot: boolean | null = null;
let probeInFlight: Promise<void> | null = null;

export function isSearchProviderConfiguredSnapshot(): boolean {
  return configuredSnapshot === true;
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
      // A probe failure is not evidence either way, so a settled snapshot stands and an
      // unsettled one stays unknown. It must never be read as "a provider is configured".
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

// Primed at import rather than waiting for the first tool-surface build, so the single
// secure-storage read settles as early as possible and the tool is withheld for as few
// turns as possible.
void refreshSearchProviderReadiness();
