import { normalizePythonExecutionRequest } from '../../../src/services/python/requestNormalization';

// `packages` wheel URLs and `indexUrls` are fetched by Pyodide's own package
// loader inside the WebView (see src/services/python/bootstrap/source/nativeHttpBridge.ts,
// `bridgeNativeHttpRequest`'s `isResolvingPyodidePackages()` short-circuit), which binds
// straight to the WebView's raw `fetch`. That path never reaches `requirePythonNetworkAccess()`
// (the `allowNetwork` gate) or the native `isAllowedUrl` SSRF check in
// src/services/python/httpBridge.ts, because both only see requests routed through the native
// bridge. A model could otherwise point `packages`/`indexUrls` at a LAN host or the cloud
// metadata address and have it fetched from the device regardless of `allowNetwork`.
// `normalizePythonExecutionRequest` is the RN-side choke point every execution request passes
// through before `executePython` (src/services/python/pyodideBridge.ts) queues a message for the
// worker, so it is where every model-supplied URL must clear the same allowlist.
describe('python execution requests reject model-supplied URLs outside the network policy', () => {
  it('rejects an indexUrls entry pointing at the cloud metadata address', () => {
    const result = normalizePythonExecutionRequest({
      code: 'print(1)',
      indexUrls: ['http://169.254.169.254/latest/meta-data/'],
    });

    expect(result.request).toBeUndefined();
    expect(result.error).toContain('http://169.254.169.254/latest/meta-data/');
    expect(result.error).toContain('outside the permitted network policy');
  });

  it('rejects a packages wheel URL pointing at a private LAN address', () => {
    const result = normalizePythonExecutionRequest({
      code: 'print(1)',
      packages: ['http://192.168.1.1/pkg-1.0.0-py3-none-any.whl'],
    });

    expect(result.request).toBeUndefined();
    expect(result.error).toContain('http://192.168.1.1/pkg-1.0.0-py3-none-any.whl');
    expect(result.error).toContain('outside the permitted network policy');
  });

  it('rejects a PEP 508 direct reference whose URL half targets a private LAN address', () => {
    const result = normalizePythonExecutionRequest({
      code: 'print(1)',
      packages: ['mypkg @ http://10.0.0.5/mypkg-1.0.0-py3-none-any.whl'],
    });

    expect(result.request).toBeUndefined();
    expect(result.error).toContain('http://10.0.0.5/mypkg-1.0.0-py3-none-any.whl');
  });

  it('rejects a PEP 508 direct reference even when followed by an environment marker', () => {
    const result = normalizePythonExecutionRequest({
      code: 'print(1)',
      packages: ['mypkg @ http://10.0.0.5/mypkg-1.0.0-py3-none-any.whl ; python_version >= "3.8"'],
    });

    expect(result.request).toBeUndefined();
    expect(result.error).toContain('http://10.0.0.5/mypkg-1.0.0-py3-none-any.whl');
  });

  it('does not gate on allowNetwork: a disallowed URL is rejected even when allowNetwork is true', () => {
    const result = normalizePythonExecutionRequest({
      code: 'print(1)',
      allowNetwork: true,
      indexUrls: ['http://169.254.169.254/'],
    });

    expect(result.request).toBeUndefined();
    expect(result.error).toContain('169.254.169.254');
  });

  it('passes through a public https wheel URL unchanged', () => {
    const wheelUrl = 'https://files.pythonhosted.org/packages/xy/pkg-1.0.0-py3-none-any.whl';
    const result = normalizePythonExecutionRequest({
      code: 'print(1)',
      packages: [wheelUrl],
    });

    expect(result.error).toBeUndefined();
    expect(result.request?.packages).toEqual([wheelUrl]);
  });

  it('passes through a public https index URL unchanged', () => {
    const indexUrl = 'https://packages.example/simple';
    const result = normalizePythonExecutionRequest({
      code: 'print(1)',
      indexUrls: [indexUrl],
    });

    expect(result.error).toBeUndefined();
    expect(result.request?.indexUrls).toEqual([indexUrl]);
  });

  it('leaves plain package names and version pins untouched', () => {
    const result = normalizePythonExecutionRequest({
      code: 'import numpy',
      packages: ['numpy', 'numpy==1.26.0'],
    });

    expect(result.error).toBeUndefined();
    expect(result.request?.packages).toEqual(['numpy', 'numpy==1.26.0']);
  });

  it('does not touch requests with no packages or indexUrls at all', () => {
    const result = normalizePythonExecutionRequest({ code: 'import numpy' });

    expect(result.error).toBeUndefined();
    expect(result.request?.packages).toEqual([]);
    expect(result.request?.indexUrls).toEqual([]);
  });
});
