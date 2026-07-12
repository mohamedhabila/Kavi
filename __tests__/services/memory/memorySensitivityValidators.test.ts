import { classifyMemoryTextSensitivity } from '../../../src/services/memory/memorySensitivityPolicy';

const restrictedStructures = [
  `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(48)}\n-----END PRIVATE KEY-----`,
  `AKIA${'A'.repeat(16)}`,
  `ASIA${'B'.repeat(16)}`,
  `AIza${'C'.repeat(35)}`,
  `ghp_${'d'.repeat(36)}`,
  `github_pat_${'e'.repeat(22)}`,
  `glpat-${'f'.repeat(20)}`,
  `npm_${'a'.repeat(36)}`,
  `pypi-${'b'.repeat(50)}`,
  `xoxb-${'1'.repeat(20)}`,
  `sk-proj-${'c'.repeat(24)}`,
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature12345678',
  'postgresql://alice:s3cr3t@db.example.com/app',
  'https://alice:s3cr3t@example.com/private',
  'ssh://alice:s3cr3t@example.com',
  'sftp://alice:s3cr3t@example.com/home',
] as const;

it.each(restrictedStructures)('detects a high-confidence credential structure: %s', (text) => {
  expect(classifyMemoryTextSensitivity(text)).toBe('restricted');
});

const sensitiveStructures = [
  'person@example.com',
  '+31 20 555 0100',
  'GB82 WEST 1234 5698 7654 32',
  '4111 1111 1111 1111',
  '52.3676, 4.9041',
  '123-45-6789',
  'BSN: 123456782',
] as const;

it.each(sensitiveStructures)('detects validated sensitive structure: %s', (text) => {
  expect(classifyMemoryTextSensitivity(text)).toBe('sensitive');
});

it.each([
  '-----BEGIN PRIVATE KEY----- documentation example',
  `AKIA${'A'.repeat(15)}`,
  `AIza${'C'.repeat(34)}`,
  `ghp_${'d'.repeat(20)}`,
  'header.payload.signature',
  'bm90LWpzb24.YWxzby1ub3QtanNvbg.signature12345678',
  'eyJ0eXAiOiJKV1QifQ.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature12345678',
  'postgresql://db.example.com/app',
  'https://example.com/private',
  'ssh://example.com',
  'person@example',
  '+31 20',
  'GB82 WEST 1234 5698 7654 31',
  '4111 1111 1111 1112',
  '52, 4',
  '000-12-3456',
  'BSN: 123456789',
  'sk-short',
])('rejects structural near-miss: %s', (text) => {
  expect(classifyMemoryTextSensitivity(text)).toBe('normal');
});

it.each(['person@example.com', '123-45-6789'])(
  'is deterministic across repeated calls for global-regex risk: %s',
  (text) => {
    expect(Array.from({ length: 12 }, () => classifyMemoryTextSensitivity(text))).toEqual(
      Array.from({ length: 12 }, () => 'sensitive'),
    );
  },
);
