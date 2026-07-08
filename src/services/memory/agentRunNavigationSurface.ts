const ROUTE_NUMERIC_SEGMENT_PATTERN = /^\d+$/;
const ROUTE_OPAQUE_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{32,}$/;

function routeSegmentKey(segment: string): string {
  if (ROUTE_NUMERIC_SEGMENT_PATTERN.test(segment)) return ':number';
  if (ROUTE_OPAQUE_SEGMENT_PATTERN.test(segment)) return ':token';
  return segment;
}

function navigationSurfaceParts(
  url: string | undefined,
): { origin: string; segments: string[] } | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed, 'https://kavi.local');
    return {
      origin: parsed.origin,
      segments: parsed.pathname.split('/').filter(Boolean).map(routeSegmentKey),
    };
  } catch {
    const pathname = trimmed.split(/[?#]/, 1)[0]?.trim();
    if (!pathname) return null;
    return {
      origin: '',
      segments: pathname.split('/').filter(Boolean).map(routeSegmentKey),
    };
  }
}

export function agentRunNavigationSurfaceKey(url: string | undefined): string | undefined {
  const parts = navigationSurfaceParts(url);
  return parts ? `${parts.origin}/${parts.segments.join('/')}` : undefined;
}

export function agentRunNavigationSurfaceDepth(url: string | undefined): number {
  return navigationSurfaceParts(url)?.segments.length ?? 0;
}

export function agentRunNavigationSurfaceFamilyKey(url: string | undefined): string | undefined {
  const parts = navigationSurfaceParts(url);
  if (!parts || parts.segments.length === 0) return undefined;
  return `${parts.origin}/${parts.segments.slice(0, Math.min(4, parts.segments.length)).join('/')}`;
}
