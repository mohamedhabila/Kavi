import { NATIVE_HTTP_BRIDGE_WORKER_SOURCE } from '../../../src/services/python/bootstrap/source/nativeHttpBridge';
import { buildPyodideWorkerSource } from '../../../src/services/python/bootstrap/worker';
import { CORE_DOMAIN_TOOLS } from '../../../src/engine/tools/domains/core';

// Traced live on an Android emulator. `installControlledNetworkPrimitives` replaced
// `self.fetch` with the user-space native HTTP bridge, and Pyodide downloads its own
// wheels with `fetch` — so the package loader was talking to a bridge that cannot deliver
// a binary wheel. Five delegated workers in one run each died after three attempts at
// `ModuleNotFoundError: No module named 'numpy'`, having tried a bare import, micropip and
// the `packages` argument in turn, while the tool description promised all three.

const bridge = NATIVE_HTTP_BRIDGE_WORKER_SOURCE.join('\n');

describe('the runtime keeps a real fetch for resolving its own packages', () => {
  it('captures the untouched fetch before replacing it', () => {
    const captureIndex = bridge.indexOf('pyodidePackageLoaderFetch = typeof self.fetch');
    const replaceIndex = bridge.indexOf('self.fetch = bridgeNativeHttpRequest');

    expect(captureIndex).toBeGreaterThan(-1);
    expect(replaceIndex).toBeGreaterThan(-1);
    // Capturing after the swap would store the bridge itself and change nothing.
    expect(captureIndex).toBeLessThan(replaceIndex);
  });

  it('short-circuits the bridge to that fetch while packages resolve', () => {
    expect(bridge).toContain('if (isResolvingPyodidePackages()) {');
    expect(bridge).toContain('return pyodidePackageLoaderFetch(requestInput, options);');
    // The escape must precede the gate, or resolution still fails when allowNetwork is off.
    expect(bridge.indexOf('isResolvingPyodidePackages()')).toBeLessThan(
      bridge.indexOf('requirePythonNetworkAccess();\n'),
    );
  });

  it('closes the escape again once resolution finishes', () => {
    expect(bridge).toContain('function endPyodidePackageResolution()');
    expect(bridge).toContain('pyodidePackageResolutionDepth = Math.max(0, pyodidePackageResolutionDepth - 1)');
    // Depth-counted so nesting cannot leave it permanently open.
    expect(bridge).toContain('pyodidePackageResolutionDepth += 1');
  });

  it('never opens for ordinary Python code', () => {
    // isResolvingPyodidePackages requires a live depth AND a captured fetch, so a bridge
    // call made from user code outside the resolution window still hits the gate.
    expect(bridge).toContain(
      'return pyodidePackageResolutionDepth > 0 && typeof pyodidePackageLoaderFetch === "function";',
    );
  });
});

describe('the worker opens the escape around both loading paths', () => {
  const worker = buildPyodideWorkerSource();

  it('wraps micropip installs and import auto-loading together', () => {
    // Anchor on call sites, not the function definitions that also appear in the bundle.
    const begin = worker.indexOf('    beginPyodidePackageResolution();');
    const micropip = worker.indexOf('buildMicropipInstallCode(packagesToInstall');
    const imports = worker.indexOf('pyodide.loadPackagesFromImports(sourceForImports)');
    const end = worker.indexOf('      endPyodidePackageResolution();');

    expect(begin).toBeGreaterThan(-1);
    expect(begin).toBeLessThan(micropip);
    expect(micropip).toBeLessThan(imports);
    expect(imports).toBeLessThan(end);
  });

  it('closes it in a finally, so a failed install cannot leave it open', () => {
    const end = worker.indexOf('      endPyodidePackageResolution();');
    const finallyIndex = worker.lastIndexOf('} finally {', end);
    expect(finallyIndex).toBeGreaterThan(-1);
  });

  it('resolves packages regardless of allowNetwork', () => {
    // allowNetwork governs code the model writes. It is applied by
    // beginPythonNetworkObservation, which runs after resolution has already closed.
    const end = worker.indexOf('      endPyodidePackageResolution();');
    expect(worker.indexOf('beginPythonNetworkObservation(message.allowNetwork')).toBeGreaterThan(
      end,
    );
  });
});

const pythonDescription = CORE_DOMAIN_TOOLS.find((t) => t.name === 'python')?.description ?? '';

describe('the tool description matches what the runtime does', () => {
  it('tells the model imports install themselves and no flag is needed', () => {
    expect(pythonDescription).toContain('Third-party packages install themselves');
    expect(pythonDescription).toContain("install from the runtime's package index without `allowNetwork`");
  });

  it('tells the model wheel and index URLs go through the network allowlist', () => {
    expect(pythonDescription).toContain("wheel and index URLs must pass the app's network allowlist");
  });

  it('no longer implies micropip is the route a caller must take', () => {
    expect(pythonDescription).not.toContain(
      'installs additional PyPI or wheel-based packages through micropip',
    );
  });
});
