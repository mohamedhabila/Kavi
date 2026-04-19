// ---------------------------------------------------------------------------
// Tests — mobileTranslator: Pattern detection & mobile execution guides
// ---------------------------------------------------------------------------

import {
  detectSkillPatterns,
  buildMobileExecutionGuide,
  isHttpOnlyPythonSkill,
  isPyodideCompatibleSkill,
  extractReferencedEnvVars,
} from '../../src/services/skills/mobileTranslator';

describe('mobileTranslator', () => {
  // ── Pattern detection ──────────────────────────────────────────────

  describe('detectSkillPatterns', () => {
    it('detects python-http pattern in requests-based code', () => {
      const body = `
\`\`\`python
import requests
response = requests.get("https://api.example.com/data")
print(response.json())
\`\`\`
`;
      const patterns = detectSkillPatterns(body);
      expect(patterns.map((p) => p.pattern)).toContain('python-http');
    });

    it('detects curl-api pattern', () => {
      const body = `
Use curl to fetch data:
\`\`\`bash
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/items
\`\`\`
`;
      const patterns = detectSkillPatterns(body);
      expect(patterns.map((p) => p.pattern)).toContain('curl-api');
    });

    it('detects curl-jq pipeline', () => {
      const body = `
\`\`\`bash
curl https://api.example.com/data | jq '.items[] | .name'
\`\`\`
`;
      const patterns = detectSkillPatterns(body);
      expect(patterns.map((p) => p.pattern)).toContain('curl-jq');
    });

    it('detects python-script pattern for uv-run scripts', () => {
      const body = `
\`\`\`bash
uv run my_script.py --input data.csv
\`\`\`
`;
      const patterns = detectSkillPatterns(body);
      expect(patterns.map((p) => p.pattern)).toContain('python-script');
    });

    it('detects shell-pipe pattern', () => {
      const body = `
\`\`\`bash
cat file.txt | grep "pattern" | sort | uniq -c
\`\`\`
`;
      const patterns = detectSkillPatterns(body);
      expect(patterns.map((p) => p.pattern)).toContain('shell-pipe');
    });

    it('returns empty for plain prompt skills', () => {
      const body = `
You are a helpful writing assistant. Help the user brainstorm ideas
and improve their writing style.
`;
      const patterns = detectSkillPatterns(body);
      expect(patterns).toEqual([]);
    });
  });

  // ── HTTP-only Python detection ─────────────────────────────────────

  describe('isHttpOnlyPythonSkill', () => {
    it('returns true for requests-only Python', () => {
      const body = `
\`\`\`python
import requests
import json
r = requests.get("https://api.weather.com/current")
data = r.json()
print(json.dumps(data, indent=2))
\`\`\`
`;
      expect(isHttpOnlyPythonSkill(body)).toBe(true);
    });

    it('returns false for Python using subprocess', () => {
      const body = `
\`\`\`python
import subprocess
result = subprocess.run(["ls", "-la"], capture_output=True)
print(result.stdout)
\`\`\`
`;
      expect(isHttpOnlyPythonSkill(body)).toBe(false);
    });

    it('returns false for requests-based Python that also writes files', () => {
      const body = `
\`\`\`python
import requests
response = requests.get("https://api.example.com/data")
with open("output.txt", "w") as handle:
    handle.write(response.text)
\`\`\`
`;
      expect(isHttpOnlyPythonSkill(body)).toBe(false);
    });

    it('returns false for non-Python skills', () => {
      const body = 'You are a writing assistant.';
      expect(isHttpOnlyPythonSkill(body)).toBe(false);
    });
  });

  // ── Pyodide compatibility ──────────────────────────────────────────

  describe('isPyodideCompatibleSkill', () => {
    it('returns true for data processing Python', () => {
      const body = `
\`\`\`python
import json
data = json.loads('{"key": "value"}')
print(data["key"])
\`\`\`
`;
      expect(isPyodideCompatibleSkill(body)).toBe(true);
    });

    it('returns false for Python with threading', () => {
      const body = `
\`\`\`python
import threading
t = threading.Thread(target=worker)
t.start()
\`\`\`
`;
      expect(isPyodideCompatibleSkill(body)).toBe(false);
    });

    it('returns false for Python with socket', () => {
      const body = `
\`\`\`python
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
\`\`\`
`;
      expect(isPyodideCompatibleSkill(body)).toBe(false);
    });

    it('returns false for requests-based Python that still relies on sync browser HTTP', () => {
      const body = `
\`\`\`python
import requests
response = requests.get("https://api.example.com/data")
print(response.text)
\`\`\`
`;
      expect(isPyodideCompatibleSkill(body)).toBe(false);
    });

    it('returns true for Python that uses kavi.http async helpers', () => {
      const body = `
\`\`\`python
response = await kavi.http.get("https://api.example.com/data")
print(await response.text())
\`\`\`
`;
      expect(isPyodideCompatibleSkill(body)).toBe(true);
    });

    it('returns true for Python that imports convenience helpers from kavi.http', () => {
      const body = `
\`\`\`python
from kavi.http import get_json
data = await get_json("https://api.example.com/data", params={"q": "cats"}, timeout=30)
print(data)
\`\`\`
`;
      expect(isPyodideCompatibleSkill(body)).toBe(true);
      expect(isHttpOnlyPythonSkill(body)).toBe(true);
    });
  });

  // ── Environment variable extraction ────────────────────────────────

  describe('extractReferencedEnvVars', () => {
    it('extracts $VARIABLE patterns from curl commands', () => {
      const body = `
\`\`\`bash
curl -H "Authorization: Bearer $API_KEY" https://api.example.com
curl -H "X-Custom: $CUSTOM_HEADER" https://api.example.com/other
\`\`\`
`;
      const vars = extractReferencedEnvVars(body);
      expect(vars).toContain('API_KEY');
      expect(vars).toContain('CUSTOM_HEADER');
    });

    it('extracts $VARIABLE patterns from Python code', () => {
      const body = `
\`\`\`bash
curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com
curl -H "X-Key: $OPENAI_API_KEY" https://api.openai.com
\`\`\`
`;
      const vars = extractReferencedEnvVars(body);
      expect(vars).toContain('GITHUB_TOKEN');
      expect(vars).toContain('OPENAI_API_KEY');
    });
  });

  // ── Mobile execution guide ─────────────────────────────────────────

  describe('buildMobileExecutionGuide', () => {
    it('returns non-empty guide for curl-based skills', () => {
      const body = `
\`\`\`bash
curl https://api.example.com/data
\`\`\`
`;
      const guide = buildMobileExecutionGuide(body);
      expect(guide.length).toBeGreaterThan(0);
      expect(guide).toContain('web_fetch');
    });

    it('returns empty string for pure prompt skills', () => {
      const body = 'You are a helpful assistant for creative writing.';
      const guide = buildMobileExecutionGuide(body);
      expect(guide).toBe('');
    });
  });
});
