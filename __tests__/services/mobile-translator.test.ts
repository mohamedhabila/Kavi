import { analyzeBundledPythonSkill } from '../../src/services/skills/mobileTranslator';

describe('mobileTranslator bundled Python analysis', () => {
  it('returns undefined when the bundle has no Python files', () => {
    expect(
      analyzeBundledPythonSkill('Run the tool.', {
        'SKILL.md': 'Run the tool.',
      }),
    ).toBeUndefined();
  });

  it('uses the referenced Python sidecar instead of every Python file in the bundle', () => {
    const result = analyzeBundledPythonSkill(
      'Run `uv run scripts/generate.py --prompt "hello"`.',
      {
        'scripts/generate.py': [
          '# /// script',
          '# dependencies = [',
          '#   "httpx",',
          '# ]',
          '# ///',
          'import httpx',
          'print("ok")',
        ].join('\n'),
        'scripts/unused.py': 'print("skip")\n',
      },
    );

    expect(result).toEqual({
      scriptPaths: ['scripts/generate.py'],
      dependencies: ['httpx'],
      pyodideCompatible: false,
    });
  });

  it('falls back to all bundled Python files when the body does not reference a script path', () => {
    const result = analyzeBundledPythonSkill('Run the packaged helpers.', {
      'scripts/one.py': [
        '# /// script',
        '# dependencies = [',
        '#   "httpx",',
        '# ]',
        '# ///',
        'import json',
        'print("one")',
      ].join('\n'),
      'scripts/two.py': [
        '# /// script',
        '# dependencies = [',
        '#   "rich",',
        '# ]',
        '# ///',
        'import math',
        'print("two")',
      ].join('\n'),
    });

    expect(result).toEqual({
      scriptPaths: ['scripts/one.py', 'scripts/two.py'],
      dependencies: ['httpx', 'rich'],
      pyodideCompatible: true,
    });
  });

  it('normalizes skill-scoped sidecar paths and keeps kavi.http bundles Pyodide-compatible', () => {
    const result = analyzeBundledPythonSkill(
      'Run `python3 skills/demo/scripts/fetch.py`.',
      {
        'scripts/fetch.py': [
          'from kavi.http import get_json',
          'data = await get_json("https://api.example.com/data")',
          'print(data)',
        ].join('\n'),
      },
    );

    expect(result).toEqual({
      scriptPaths: ['scripts/fetch.py'],
      dependencies: undefined,
      pyodideCompatible: true,
    });
  });
});
