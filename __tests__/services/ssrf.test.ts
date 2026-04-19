// ---------------------------------------------------------------------------
// Tests — SSRF Protection
// ---------------------------------------------------------------------------

import { isPrivateIp, isBlockedHostname, isAllowedUrl } from '../../src/services/security/ssrf';

describe('isPrivateIp', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.255',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '192.168.255.255',
    '169.254.1.1',
    '0.0.0.0',
    '100.64.0.1',
    '198.18.0.1',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12::1',
  ])('blocks private IP %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '203.0.113.1',
    '172.32.0.1', // Just outside private range
    '192.169.0.1',
  ])('allows public IP %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('isBlockedHostname', () => {
  it.each([
    'localhost',
    'metadata.google.internal',
    'metadata',
    'instance-data',
    '169.254.169.254',
    '[::1]',
  ])('blocks hostname %s', (hostname) => {
    expect(isBlockedHostname(hostname)).toBe(true);
  });

  it('blocks .internal suffix', () => {
    expect(isBlockedHostname('anything.internal')).toBe(true);
  });

  it('blocks .local suffix', () => {
    expect(isBlockedHostname('myhost.local')).toBe(true);
  });

  it('allows normal hostnames', () => {
    expect(isBlockedHostname('example.com')).toBe(false);
    expect(isBlockedHostname('api.openai.com')).toBe(false);
  });
});

describe('isAllowedUrl', () => {
  it('allows HTTPS URLs', () => {
    expect(isAllowedUrl('https://example.com/path')).toBe(true);
  });

  it('allows HTTP URLs', () => {
    expect(isAllowedUrl('http://example.com')).toBe(true);
  });

  it('blocks non-HTTP protocols', () => {
    expect(isAllowedUrl('ftp://example.com')).toBe(false);
    expect(isAllowedUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedUrl('javascript:alert(1)')).toBe(false);
  });

  it('blocks localhost', () => {
    expect(isAllowedUrl('http://localhost:3000')).toBe(false);
  });

  it('blocks private IPs', () => {
    expect(isAllowedUrl('http://192.168.1.1/admin')).toBe(false);
    expect(isAllowedUrl('http://10.0.0.1')).toBe(false);
  });

  it('blocks cloud metadata endpoints', () => {
    expect(isAllowedUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isAllowedUrl('http://metadata.google.internal/')).toBe(false);
  });

  it('returns false for invalid URLs', () => {
    expect(isAllowedUrl('not-a-url')).toBe(false);
    expect(isAllowedUrl('')).toBe(false);
  });
});
