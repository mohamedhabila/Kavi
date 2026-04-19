import { pythonLanguage } from '@codemirror/lang-python';
import { getPyodideHtml, getPyodideWorkerSource } from '../../src/services/python/runtimeBootstrap';

function extractInlineScript(html: string): string {
  const match = html.match(/<script>([\s\S]*)<\/script>/i);
  if (!match?.[1]) {
    throw new Error('Unable to extract inline script from Pyodide HTML bootstrap.');
  }

  return match[1];
}

function extractRuntimeHelpers(workerSource: string): string {
  const match = workerSource.match(/var PYODIDE_RUNTIME_HELPERS = ("(?:[^"\\]|\\.)*");/);
  if (!match?.[1]) {
    throw new Error('Unable to extract runtime helpers from Pyodide worker source.');
  }

  return JSON.parse(match[1]);
}

function findPythonSyntaxErrors(source: string): string[] {
  const tree = pythonLanguage.parser.parse(source);
  const cursor = tree.cursor();
  const errors: string[] = [];

  do {
    if (cursor.name !== '⚠' && !cursor.type.isError) {
      continue;
    }

    const snippetStart = Math.max(0, cursor.from - 24);
    const snippetEnd = Math.min(source.length, cursor.to + 24);
    const snippet = source.slice(snippetStart, snippetEnd).replace(/\n/g, '\\n');
    errors.push(`${cursor.name}@${cursor.from}:${cursor.to}:${snippet}`);
  } while (cursor.next());

  return errors;
}

describe('python runtime bootstrap', () => {
  it('generates worker source that is valid JavaScript', () => {
    const workerSource = getPyodideWorkerSource();

    expect(workerSource).toContain(
      'new Error(\'Workspace paths must not contain ".." segments.\')',
    );
    expect(workerSource).toContain('self.__kavi_native_http__');
    expect(workerSource).toContain('await _kavi_execute_inline');
    expect(workerSource).toContain('python-http-response');
    expect(() => new Function(workerSource)).not.toThrow();
  });

  it('generates page bootstrap source that is valid JavaScript', () => {
    const html = getPyodideHtml();
    const pageScript = extractInlineScript(html);

    expect(pageScript).toContain('createWorker();');
    expect(pageScript).toContain("message.type === 'python-http-response'");
    expect(() => new Function(pageScript)).not.toThrow();
  });

  it('generates runtime helpers that are valid Python', () => {
    const workerSource = getPyodideWorkerSource();
    const runtimeHelpers = extractRuntimeHelpers(workerSource);

    expect(runtimeHelpers).toContain('eval_code_async');
    expect(runtimeHelpers).toContain('_kavi_pyodide_http.pyfetch = _kavi_native_pyfetch');
    expect(runtimeHelpers).toContain('def _kavi_merge_query_params(url: str, params=None) -> str:');
    expect(runtimeHelpers).toContain('class _KaviHttpResponse:');
    expect(runtimeHelpers).toContain('async def get_json(self, url: str, **kwargs):');
    expect(runtimeHelpers).toContain('_kavi_module = _kavi_types.ModuleType("kavi")');
    expect(runtimeHelpers).toContain('_kavi_http_module = _kavi_types.ModuleType("kavi.http")');
    expect(runtimeHelpers).toContain('sys.modules["kavi.http"] = _kavi_http_module');
    expect(runtimeHelpers).toContain('sys.modules["kavi"] = _kavi_module');
    expect(runtimeHelpers).toContain('builtins.kavi = _kavi_module');
    expect(findPythonSyntaxErrors(runtimeHelpers)).toEqual([]);
  });
});
