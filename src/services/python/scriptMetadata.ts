function findPep723ScriptBlock(source: string): { lines: string[]; blockStart: number; blockEnd: number } | null {
  if (!source) {
    return null;
  }

  const lines = source.split(/\r?\n/);
  let blockStart = -1;
  let blockEnd = -1;

  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*#\s*\/\/\/\s*script\s*$/.test(lines[index])) {
      blockStart = index;
      break;
    }
  }

  if (blockStart < 0) {
    return null;
  }

  for (let index = blockStart + 1; index < lines.length; index += 1) {
    if (/^\s*#\s*\/\/\/\s*$/.test(lines[index])) {
      blockEnd = index;
      break;
    }
  }

  if (blockEnd <= blockStart + 1) {
    return null;
  }

  return { lines, blockStart, blockEnd };
}

export function stripPep723MetadataBlock(source: string): string {
  const block = findPep723ScriptBlock(source);
  if (!block) {
    return source;
  }

  return [
    ...block.lines.slice(0, block.blockStart),
    ...block.lines.slice(block.blockEnd + 1),
  ].join('\n');
}

export function extractPep723Dependencies(source: string): string[] {
  const block = findPep723ScriptBlock(source);
  if (!block) {
    return [];
  }

  const metadataBlock = block.lines
    .slice(block.blockStart + 1, block.blockEnd)
    .map((line) => line.replace(/^\s*#\s?/, ''))
    .join('\n');

  const dependenciesMatch = metadataBlock.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m);
  if (!dependenciesMatch) {
    return [];
  }

  const dependencies = new Set<string>();
  const dependencyPattern = /["']([^"']+)["']/g;
  let match: RegExpExecArray | null;

  while ((match = dependencyPattern.exec(dependenciesMatch[1])) !== null) {
    const dependency = match[1].trim();
    if (dependency) {
      dependencies.add(dependency);
    }
  }

  return Array.from(dependencies).sort();
}
