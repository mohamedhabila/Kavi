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
  const script = `
    const imageSize = require(${JSON.stringify(resolveImageSize())});
    const input = new Uint8Array(Buffer.from(process.argv[1], 'base64'));
    try {
      process.stdout.write('returned ' + JSON.stringify(imageSize(input)));
    } catch (error) {
      process.stdout.write('threw ' + error.message);
    }
  `;

  const child = spawnSync(process.execPath, ['-e', script, bytes.toString('base64')], {
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

describe('image-size infinite-loop hardening', () => {
  it('keeps the patch that upstream has not released a fix for', () => {
    const patchPath = join(projectRoot, 'patches/image-size+1.2.1.patch');
    expect(existsSync(patchPath)).toBe(true);

    const patch = readFileSync(patchPath, 'utf8');
    expect(patch).toContain('dist/types/icns.js');
    expect(patch).toContain('dist/types/jxl.js');
  });

  it('terminates on an ICNS entry that declares a zero data length', () => {
    expect(parseUnderTimeout(craftIcnsWithZeroLengthEntry()).status).toBe('returned');
  });

  it('terminates on a JXL container with a zero-size jxlp box', () => {
    const outcome = parseUnderTimeout(craftJxlWithZeroSizeBox());
    expect(outcome.status).toBe('threw');
    expect(outcome.detail).toContain('Reached end of input');
  });

  it('still reports correct dimensions for a well-formed asset', () => {
    const outcome = parseUnderTimeout(readFileSync(join(projectRoot, 'assets/icon.png')));

    expect(outcome.status).toBe('returned');
    expect(JSON.parse(outcome.detail)).toMatchObject({ type: 'png', width: 1024, height: 1024 });
  });
});
