import { __getStore, executePython, executeTool } from '../helpers/toolsExecutorHarness';

describe('executeTool', () => {
  const CONV_ID = 'test-conversation';

  describe('javascript', () => {
    it('should execute simple JavaScript', async () => {
      const result = await executeTool(
        'javascript',
        JSON.stringify({ code: 'return 2 + 2;' }),
        CONV_ID,
      );
      expect(result).toBe('4');
    });

    it('should return the last expression without requiring an explicit return', async () => {
      const result = await executeTool(
        'javascript',
        JSON.stringify({ code: 'const value = 40;\nvalue + 2;' }),
        CONV_ID,
      );

      expect(result).toBe('42');
    });

    it('should handle code with no return value', async () => {
      const result = await executeTool(
        'javascript',
        JSON.stringify({ code: 'const x = 5;' }),
        CONV_ID,
      );
      expect(result).toBe('(no return value)');
    });

    it('should handle errors in code execution', async () => {
      const result = await executeTool(
        'javascript',
        JSON.stringify({ code: 'throw new Error("test error");' }),
        CONV_ID,
      );
      expect(result).toContain('Error');
      expect(result).toContain('test error');
    });

    it('should handle string return values', async () => {
      const result = await executeTool(
        'javascript',
        JSON.stringify({ code: 'return "hello";' }),
        CONV_ID,
      );
      expect(result).toBe('hello');
    });

    it('should return a friendly error when code is missing', async () => {
      const result = await executeTool(
        'javascript',
        JSON.stringify({ script: 'return 42;' }),
        CONV_ID,
      );

      expect(result).toContain('Error');
      expect(result).toContain('code');
    });

    it('should accept fenced JavaScript code', async () => {
      const result = await executeTool(
        'javascript',
        JSON.stringify({ code: '```javascript\nconst total = 40 + 2;\ntotal\n```' }),
        CONV_ID,
      );

      expect(result).toBe('42');
    });

    it('should read workspace files and require workspace modules from inline JavaScript', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({
          path: 'helpers/math.js',
          content: 'module.exports = (value) => value * 2;',
        }),
        CONV_ID,
      );
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'data/value.txt', content: '21' }),
        CONV_ID,
      );

      const result = await executeTool(
        'javascript',
        JSON.stringify({
          code: 'const double = require("helpers/math"); return double(Number(fs.readFile("data/value.txt")));',
        }),
        CONV_ID,
      );

      expect(result).toBe('42');
    });

    it('should support Node-style require("fs") sync workspace access', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'data/value.txt', content: '21' }),
        CONV_ID,
      );

      const result = await executeTool(
        'javascript',
        JSON.stringify({
          code: 'const fs = require("fs"); return Number(fs.readFileSync("data/value.txt", "utf8")) * 2;',
        }),
        CONV_ID,
      );

      expect(result).toBe('42');
    });

    it('should execute workspace JavaScript files by path and sync written files back', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({
          path: 'tools/double.js',
          content: 'module.exports = (value) => value * 2;',
        }),
        CONV_ID,
      );
      await executeTool(
        'write_file',
        JSON.stringify({
          path: 'tools/main.js',
          content:
            'const double = require("./double"); const answer = double(21); fs.writeFile("outputs/result.txt", String(answer)); module.exports = answer;',
        }),
        CONV_ID,
      );

      const result = await executeTool(
        'javascript',
        JSON.stringify({ path: 'tools/main.js', argv: ['--prompt', 'hello'] }),
        CONV_ID,
      );

      expect(JSON.parse(result)).toEqual(
        expect.objectContaining({
          summary: 'JavaScript execution completed and changed 1 workspace file.',
          status: 'completed',
          output: '42',
          fileCount: 1,
          files: [expect.objectContaining({ path: 'tools/outputs/result.txt' })],
        }),
      );
      expect(
        __getStore()['file:///mock/documents/workspace/test-conversation/tools/outputs/result.txt'],
      ).toBe('42');
    });

    it('should sync deleted workspace files after successful JavaScript execution', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'temp/remove.txt', content: 'delete me' }),
        CONV_ID,
      );

      const result = await executeTool(
        'javascript',
        JSON.stringify({ code: 'fs.deleteFile("temp/remove.txt");' }),
        CONV_ID,
      );

      expect(JSON.parse(result)).toEqual(
        expect.objectContaining({
          summary: 'JavaScript execution completed and changed 0 workspace files, deleted 1 path.',
          status: 'completed',
          deletedCount: 1,
          deletedPaths: ['temp/remove.txt'],
        }),
      );
      expect(
        __getStore()['file:///mock/documents/workspace/test-conversation/temp/remove.txt'],
      ).toBeUndefined();
    });
  });

  describe('python', () => {
    it('should execute Python via the Pyodide bridge', async () => {
      const result = await executeTool(
        'python',
        JSON.stringify({ code: 'print(40 + 2)', packages: ['numpy', 'numpy'] }),
        CONV_ID,
      );

      expect(result).toBe('42');
      expect(executePython).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'print(40 + 2)',
          files: [],
          workingDirectory: '',
          packages: ['numpy'],
        }),
      );
    });

    it('should forward a validated timeout override to the Pyodide bridge', async () => {
      const result = await executeTool(
        'python',
        JSON.stringify({ code: 'print(42)', timeoutMs: 120000 }),
        CONV_ID,
      );

      expect(result).toBe('42');
      expect(executePython).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'print(42)',
          timeoutMs: 120000,
        }),
      );
    });

    it('should reject invalid timeout overrides', async () => {
      const result = await executeTool(
        'python',
        JSON.stringify({ code: 'print(42)', timeoutMs: 999 }),
        CONV_ID,
      );

      expect(result).toContain('timeoutMs');
      expect(executePython).not.toHaveBeenCalled();
    });

    it('should return a friendly error when code is missing', async () => {
      const result = await executeTool('python', JSON.stringify({ script: 'print(42)' }), CONV_ID);

      expect(result).toContain('Error');
      expect(result).toContain('code');
    });

    it('should reject non-string package entries', async () => {
      const result = await executeTool(
        'python',
        JSON.stringify({ code: 'print(42)', packages: ['requests', 123] }),
        CONV_ID,
      );

      expect(result).toContain('packages');
      expect(executePython).not.toHaveBeenCalled();
    });

    it('should forward custom package indexes to the Pyodide bridge', async () => {
      const result = await executeTool(
        'python',
        JSON.stringify({
          code: 'print(42)',
          packages: ['requests'],
          indexUrls: ['https://packages.example/simple', 'https://packages.example/simple'],
        }),
        CONV_ID,
      );

      expect(result).toBe('42');
      expect(executePython).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'print(42)',
          files: [],
          workingDirectory: '',
          packages: ['requests'],
          indexUrls: ['https://packages.example/simple'],
        }),
      );
    });

    it('should reject invalid custom package indexes', async () => {
      const result = await executeTool(
        'python',
        JSON.stringify({ code: 'print(42)', indexUrls: ['ftp://packages.example/simple'] }),
        CONV_ID,
      );

      expect(result).toContain('indexUrls');
      expect(executePython).not.toHaveBeenCalled();
    });

    it('should execute workspace Python scripts by path and merge PEP 723 dependencies', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({
          path: 'skills/image-helper/scripts/generate.py',
          content: [
            '# /// script',
            '# dependencies = [',
            '#   "httpx",',
            '# ]',
            '# ///',
            'import sys',
            'print(sys.argv[1])',
          ].join('\n'),
        }),
        CONV_ID,
      );

      executePython.mockResolvedValueOnce({ success: true, output: 'script ok' });

      const result = await executeTool(
        'python',
        JSON.stringify({
          path: 'skills/image-helper/scripts/generate.py',
          argv: ['--prompt', 'hello world'],
          packages: ['requests'],
          env: { GEMINI_API_KEY: 'secret' },
        }),
        CONV_ID,
      );

      expect(result).toBe('script ok');
      expect(executePython).toHaveBeenCalledWith(
        expect.objectContaining({
          scriptPath: 'skills/image-helper/scripts/generate.py',
          argv: ['--prompt', 'hello world'],
          workingDirectory: '',
          packages: ['requests', 'httpx'],
          env: { GEMINI_API_KEY: 'secret' },
          files: expect.arrayContaining([
            expect.objectContaining({ path: 'skills/image-helper/scripts/generate.py' }),
          ]),
        }),
      );
    });

    it('should mount the conversation workspace for inline Python execution', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'util.py', content: 'def answer():\n    return 42\n' }),
        CONV_ID,
      );

      await executeTool(
        'python',
        JSON.stringify({ code: 'import util\nprint(util.answer())' }),
        CONV_ID,
      );

      expect(executePython).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'import util\nprint(util.answer())',
          workingDirectory: '',
          files: expect.arrayContaining([expect.objectContaining({ path: 'util.py' })]),
        }),
      );
    });

    it('should mount sibling workspace files for path-based Python imports', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({
          path: 'pkg/main.py',
          content: 'from shared.util import answer\nprint(answer())\n',
        }),
        CONV_ID,
      );
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'shared/util.py', content: 'def answer():\n    return 42\n' }),
        CONV_ID,
      );

      await executeTool('python', JSON.stringify({ path: 'pkg/main.py' }), CONV_ID);

      expect(executePython).toHaveBeenCalledWith(
        expect.objectContaining({
          scriptPath: 'pkg/main.py',
          workingDirectory: '',
          files: expect.arrayContaining([
            expect.objectContaining({ path: 'pkg/main.py' }),
            expect.objectContaining({ path: 'shared/util.py' }),
          ]),
        }),
      );
    });

    it('should fall back to the worker session workspace for path-based Python scripts when the shared workspace lacks them', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'skills/demo/script.py', content: 'print("session script")\n' }),
        'worker-session',
      );

      await executeTool(
        'python',
        JSON.stringify({ path: 'skills/demo/script.py' }),
        'worker-session',
        {
          workspaceConversationId: 'parent-conversation',
          workspaceReadFallbackConversationId: 'worker-session',
        },
      );

      expect(executePython).toHaveBeenCalledWith(
        expect.objectContaining({
          scriptPath: 'skills/demo/script.py',
          files: expect.arrayContaining([
            expect.objectContaining({ path: 'skills/demo/script.py' }),
          ]),
        }),
      );
    });

    it('should write Python script outputs back into the conversation workspace', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'scripts/export.py', content: 'print("export")' }),
        CONV_ID,
      );

      executePython.mockResolvedValueOnce({
        success: true,
        output: 'saved',
        files: [
          {
            path: 'outputs/result.txt',
            contentBase64: Buffer.from('done', 'utf8').toString('base64'),
          },
        ],
      });

      const result = await executeTool(
        'python',
        JSON.stringify({ path: 'scripts/export.py' }),
        CONV_ID,
      );

      expect(JSON.parse(result)).toEqual(
        expect.objectContaining({
          summary: 'Python execution completed and wrote 1 workspace file.',
          status: 'completed',
          output: 'saved',
          fileCount: 1,
          files: [expect.objectContaining({ path: 'outputs/result.txt' })],
        }),
      );
      expect(
        __getStore()['file:///mock/documents/workspace/test-conversation/outputs/result.txt'],
      ).toBe('done');
    });

    it('should normalize large Python output into a bounded summary', async () => {
      executePython.mockResolvedValueOnce({
        success: true,
        output: Array.from({ length: 400 }, (_, index) => `line ${index + 1}`).join('\n'),
      });

      const result = await executeTool(
        'python',
        JSON.stringify({ code: 'for i in range(400): print(i)' }),
        CONV_ID,
      );

      expect(JSON.parse(result)).toEqual(
        expect.objectContaining({
          summary: 'Python execution completed with trimmed output for context.',
          status: 'completed',
          truncated: true,
        }),
      );
    });

    it('should not summarize short successful Python output just because it mentions error text', async () => {
      executePython.mockResolvedValueOnce({
        success: true,
        output: 'error count: 0',
      });

      const result = await executeTool(
        'python',
        JSON.stringify({ code: 'print("error count: 0")' }),
        CONV_ID,
      );

      expect(result).toBe('error count: 0');
    });

    it('should surface runtime failures from the Pyodide bridge', async () => {
      executePython.mockResolvedValueOnce({
        success: false,
        output: '',
        error: 'Python runtime unavailable',
      });

      const result = await executeTool('python', JSON.stringify({ code: 'print(42)' }), CONV_ID);

      expect(result).toContain('Python runtime unavailable');
    });
  });
});
