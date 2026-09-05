const { spawnSync } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

/**
 * Regression guard for GHSA-5p2g-fcmc-qvqq (CVE-2025-71329, JXL/HEIF) and
 * GHSA-w3rx-r6r6-pgpr (ICNS) in `image-size`, reached through
 * `metro` -> `@expo/metro` -> `expo`.
 *
 * There is no fixed release upstream: the advisories cover every published
 * version (<= 2.0.2), so `patches/image-size+1.2.1.patch` is what removes the
 * defect. These tests fail if that patch stops being applied.
 *
 * `image-size` dispatches on sniffed magic bytes rather than file extension, so
 * Metro's image-extension allowlist does not keep these parsers out of reach: a
 * `.png` asset whose bytes are an ICNS or JXL container is routed here and can
 * wedge a bundle build or dev server until the process is killed.
 *
 * Each parse runs in a child process under a wall-clock timeout, because an
 * unpatched parse is a synchronous infinite loop that Jest's own `testTimeout`
 * cannot interrupt.
 */

const projectRoot = join(__dirname, '../..');
const parseTimeoutMs = 5_000;

type ParseOutcome = { status: 'returned' | 'threw'; detail: string };

function resolveImageSize(): string {
  try {
    return require.resolve('image-size', { paths: [projectRoot] });
  } catch {
    throw new Error(
      'image-size is no longer installed. If Metro dropped the dependency, delete ' +
        'patches/image-size+1.2.1.patch and this test along with it.',
    );
  }
}

/** Parses `bytes` in a child process, failing the test if it does not terminate. */
function parseUnderTimeout(bytes: Buffer): ParseOutcome {
  // The image bytes travel over stdin, not argv: Linux caps a single argument at
  // 128 KiB, so a real asset passed as a base64 argument fails to spawn there
  // while the same call succeeds on macOS.
  const script = `
    const imageSize = require(${JSON.stringify(resolveImageSize())});
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      const input = new Uint8Array(Buffer.concat(chunks));
      try {
        process.stdout.write('returned ' + JSON.stringify(imageSize(input)));
      } catch (error) {
        process.stdout.write('threw ' + error.message);
      }
    });
  `;

  const child = spawnSync(process.execPath, ['-e', script], {
    input: bytes,
    timeout: parseTimeoutMs,
    encoding: 'utf8',
  });

  if (child.killed || child.signal === 'SIGTERM') {
    throw new Error(
      `image-size did not terminate within ${parseTimeoutMs}ms — the infinite-loop patch ` +
        'is not applied. Run `npx patch-package` (npm postinstall does this automatically).',
    );
  }
  if (child.status !== 0) {
    throw new Error(`image-size child process failed: ${child.stderr || child.error}`);
  }

  const output = child.stdout;
  return output.startsWith('returned ')
    ? { status: 'returned', detail: output.slice('returned '.length) }
    : { status: 'threw', detail: output.slice('threw '.length) };
}

/** ICNS file whose single entry declares a data length of 0. */
function craftIcnsWithZeroLengthEntry(): Buffer {
  const icns = Buffer.alloc(64);
  icns.write('icns', 0, 'ascii');
  icns.writeUInt32BE(icns.length, 4); // file length
  icns.write('ic09', 8, 'ascii'); // entry type
  icns.writeUInt32BE(0, 12); // entry length — never advances the cursor
  return icns;
}

/** JXL container whose `jxlp` box declares a size of 0. */
function craftJxlWithZeroSizeBox(): Buffer {
  const jxl = Buffer.alloc(40);
  jxl.writeUInt32BE(12, 0); // signature box size
  jxl.write('JXL ', 4, 'ascii');
  jxl.writeUInt32BE(0x0d0a870a, 8);
  jxl.writeUInt32BE(20, 12); // ftyp box size
  jxl.write('ftyp', 16, 'ascii');
  jxl.write('jxl ', 20, 'ascii'); // major brand
  jxl.writeUInt32BE(0, 32); // jxlp box size — never advances the cursor
  jxl.write('jxlp', 36, 'ascii');
  return jxl;
}

/** Builds a single ISO-BMFF box: a 4-byte big-endian size, a 4-byte type, then the payload. */
function isoBox(type: string, payload: Buffer): Buffer {
  const box = Buffer.alloc(8 + payload.length);
  box.writeUInt32BE(box.length, 0);
  box.write(type, 4, 'ascii');
  payload.copy(box, 8);
  return box;
}

/** Minimal well-formed HEIC container: ftyp + meta/iprp/ipco/ispe declaring `width`x`height`. */
function craftHeif(width: number, height: number): { bytes: Buffer; metaSizeOffset: number } {
  const ftyp = isoBox('ftyp', Buffer.concat([Buffer.from('heic', 'ascii'), Buffer.alloc(4)]));
  const ispePayload = Buffer.alloc(12); // version/flags(4) + width(4) + height(4)
  ispePayload.writeUInt32BE(width, 4);
  ispePayload.writeUInt32BE(height, 8);
  const ipco = isoBox('ipco', isoBox('ispe', ispePayload));
  const iprp = isoBox('iprp', ipco);
  const meta = isoBox('meta', Buffer.concat([Buffer.alloc(4), iprp])); // version/flags(4) + iprp
  return { bytes: Buffer.concat([ftyp, meta]), metaSizeOffset: ftyp.length };
}

/** HEIC container whose `meta` box declares a size of 0 — never advances a naive box walk. */
function craftHeifWithZeroSizeMetaBox(): Buffer {
  const { bytes, metaSizeOffset } = craftHeif(640, 480);
  bytes.writeUInt32BE(0, metaSizeOffset);
  return bytes;
}

/** HEIC container whose `meta` box declares a size larger than the whole buffer. */
function craftHeifWithOversizedMetaBox(): Buffer {
  const { bytes, metaSizeOffset } = craftHeif(640, 480);
  bytes.writeUInt32BE(0xffffffff, metaSizeOffset);
  return bytes;
}

describe('image-size infinite-loop hardening', () => {
  it('keeps the patch that upstream has not released a fix for', () => {
    const patchPath = join(projectRoot, 'patches/image-size+1.2.1.patch');
    expect(existsSync(patchPath)).toBe(true);

    const patch = readFileSync(patchPath, 'utf8');
    expect(patch).toContain('dist/types/icns.js');
    expect(patch).toContain('dist/types/jxl.js');
    expect(patch).toContain('dist/types/heif.js');
  });

  it('terminates on an ICNS entry that declares a zero data length', () => {
    expect(parseUnderTimeout(craftIcnsWithZeroLengthEntry()).status).toBe('returned');
  });

  it('terminates on a JXL container with a zero-size jxlp box', () => {
    const outcome = parseUnderTimeout(craftJxlWithZeroSizeBox());
    expect(outcome.status).toBe('threw');
    expect(outcome.detail).toContain('Reached end of input');
  });

  it('terminates on a HEIF container with a zero-size meta box', () => {
    const outcome = parseUnderTimeout(craftHeifWithZeroSizeMetaBox());
    expect(outcome.status).toBe('threw');
    expect(outcome.detail).toContain('Invalid HEIF');
  });

  it('terminates on a HEIF container whose meta box size exceeds the buffer', () => {
    const outcome = parseUnderTimeout(craftHeifWithOversizedMetaBox());
    expect(outcome.status).toBe('threw');
    expect(outcome.detail).toContain('Invalid HEIF');
  });

  it('still reports correct dimensions for a well-formed minimal HEIF container', () => {
    const outcome = parseUnderTimeout(craftHeif(640, 480).bytes);
    expect(outcome.status).toBe('returned');
    expect(JSON.parse(outcome.detail)).toMatchObject({ type: 'heic', width: 640, height: 480 });
  });

  it('still reports correct dimensions for a well-formed asset', () => {
    const outcome = parseUnderTimeout(readFileSync(join(projectRoot, 'assets/icon.png')));

    expect(outcome.status).toBe('returned');
    expect(JSON.parse(outcome.detail)).toMatchObject({ type: 'png', width: 1024, height: 1024 });
  });
});
