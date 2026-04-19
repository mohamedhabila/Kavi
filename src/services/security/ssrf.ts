// ---------------------------------------------------------------------------
// Kavi — SSRF Protection
// ---------------------------------------------------------------------------
// Blocks requests to private/internal network ranges.

const PRIVATE_IP_RANGES = [
  /^127\./, // Loopback
  /^10\./, // Class A private
  /^172\.(1[6-9]|2\d|3[0-1])\./, // Class B private
  /^192\.168\./, // Class C private
  /^169\.254\./, // Link-local
  /^0\./, // Current network
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./, // Shared address space (RFC 6598)
  /^198\.18\./, // Benchmark testing
  /^::1$/, // IPv6 loopback
  /^fe80:/i, // IPv6 link-local
  /^fc00:/i, // IPv6 unique local
  /^fd[0-9a-f]{2}:/i, // IPv6 unique local
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
  '169.254.169.254',
  '[::1]',
]);

export function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((pattern) => pattern.test(ip));
}

export function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith('.internal') || lower.endsWith('.local')) return true;
  return false;
}

export function isAllowedUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);

    if (!['http:', 'https:'].includes(url.protocol)) return false;

    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (isBlockedHostname(hostname)) return false;
    if (isPrivateIp(hostname)) return false;

    return true;
  } catch {
    return false;
  }
}
