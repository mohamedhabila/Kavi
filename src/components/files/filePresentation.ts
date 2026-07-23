const FILE_TYPE_LABELS: Record<string, string> = {
  c: 'C',
  cpp: 'C++',
  css: 'CSS',
  go: 'Go',
  h: 'C Header',
  html: 'HTML',
  java: 'Java',
  js: 'JavaScript',
  json: 'JSON',
  jsx: 'JavaScript',
  kt: 'Kotlin',
  md: 'Markdown',
  py: 'Python',
  rb: 'Ruby',
  rs: 'Rust',
  sh: 'Shell',
  sql: 'SQL',
  swift: 'Swift',
  ts: 'TypeScript',
  tsx: 'TypeScript',
  txt: 'Text',
  xml: 'XML',
  yaml: 'YAML',
  yml: 'YAML',
};

export function getConversationFileTypeLabel(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return FILE_TYPE_LABELS[extension] ?? (extension ? extension.toUpperCase() : 'File');
}
