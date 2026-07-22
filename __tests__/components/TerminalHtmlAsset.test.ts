import fs from 'fs';
import path from 'path';

describe('xterm.html local runtime bundle', () => {
  const terminalHtmlPath = path.join(__dirname, '../../assets/terminal/xterm.html');
  const androidTerminalHtmlPath = path.join(
    __dirname,
    '../../android/app/src/main/assets/terminal/xterm.html',
  );
  const terminalTemplatePath = path.join(__dirname, '../../assets/terminal/xterm.template.html');
  const terminalHtml = fs.readFileSync(terminalHtmlPath, 'utf8');
  const androidTerminalHtml = fs.readFileSync(androidTerminalHtmlPath, 'utf8');
  const terminalTemplate = fs.readFileSync(terminalTemplatePath, 'utf8');

  it('ships the xterm renderer without runtime CDN imports', () => {
    expect(terminalHtml).toContain('window.__KAVI_XTERM__=__KaviXtermBundle.createXtermModules();');
    expect(terminalHtml).toContain("window.__KAVI_XTERM_BUILD__='local-bundle';");
    expect(terminalHtml).not.toContain('cdn.jsdelivr.net');
    expect(terminalHtml).not.toContain('loadScript');
    expect(terminalHtml).not.toContain('XTERM_CDN');
  });

  it('keeps the generated source and Android terminal assets identical', () => {
    expect(androidTerminalHtml).toBe(terminalHtml);
  });

  it('retains the bundle placeholder only in the source template', () => {
    expect(terminalTemplate).toContain('/* __INLINE_XTERM_BUNDLE__ */');
    expect(terminalHtml).not.toContain('/* __INLINE_XTERM_BUNDLE__ */');
  });
});
