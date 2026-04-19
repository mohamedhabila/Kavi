import fs from 'fs';
import path from 'path';

describe('editor.html CodeMirror loader', () => {
  const editorHtmlPath = path.join(__dirname, '../../assets/editor/editor.html');
  const androidEditorHtmlPath = path.join(
    __dirname,
    '../../android/app/src/main/assets/editor/editor.html',
  );
  const editorTemplatePath = path.join(__dirname, '../../assets/editor/editor.template.html');
  const editorHtml = fs.readFileSync(editorHtmlPath, 'utf8');
  const androidEditorHtml = fs.readFileSync(androidEditorHtmlPath, 'utf8');
  const editorTemplate = fs.readFileSync(editorTemplatePath, 'utf8');

  it('ships a local CodeMirror bundle without runtime CDN imports', () => {
    expect(editorHtml).toContain(
      'window.__KAVI_CODEMIRROR__=__KaviCodeMirrorBundle.createCodeMirrorModules();',
    );
    expect(editorHtml).not.toContain('cdn.jsdelivr.net');
    expect(editorHtml).not.toContain("new Function('url'");
    expect(editorHtml).not.toContain('import(url)');
  });

  it('keeps the generated source and Android editor assets identical', () => {
    expect(androidEditorHtml).toBe(editorHtml);
  });

  it('retains the bundle placeholder only in the source template', () => {
    expect(editorTemplate).toContain('/* __INLINE_CODEMIRROR_BUNDLE__ */');
    expect(editorHtml).not.toContain('/* __INLINE_CODEMIRROR_BUNDLE__ */');
  });

  it('accepts the shipped indentWithTab keybinding export during bundle validation', () => {
    expect(editorHtml).toContain("typeof modules.indentWithTab !== 'undefined'");
    expect(editorHtml).not.toContain("typeof modules.indentWithTab === 'function'");
  });
});
