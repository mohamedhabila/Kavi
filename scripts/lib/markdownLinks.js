const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const INLINE_LINK_PATTERN = /!?\[[^\]\n]*(?:\][^\[\]\n]*)*\]\(([^)\n]+)\)/g;
const REFERENCE_LINK_PATTERN = /^\s*\[[^\]\n]+\]:\s*(\S+)/gm;

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function listTrackedMarkdownFiles(projectRoot) {
  const output = execFileSync('git', ['ls-files', '-z', '--', '*.md'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return output
    .split('\0')
    .map((entry) => normalizePath(entry.trim()))
    .filter(Boolean);
}

function lineNumberForIndex(content, index) {
  if (index <= 0) {
    return 1;
  }
  return content.slice(0, index).split('\n').length;
}

function stripOptionalTitle(rawTarget) {
  const trimmed = rawTarget.trim();
  const angleMatch = trimmed.match(/^<([^>]+)>/);
  if (angleMatch) {
    return angleMatch[1].trim();
  }
  return trimmed.split(/\s+/)[0] || '';
}

function extractMarkdownLinks(content) {
  const links = [];
  let match;

  while ((match = INLINE_LINK_PATTERN.exec(content)) !== null) {
    links.push({
      target: stripOptionalTitle(match[1]),
      lineNumber: lineNumberForIndex(content, match.index),
    });
  }

  while ((match = REFERENCE_LINK_PATTERN.exec(content)) !== null) {
    links.push({
      target: stripOptionalTitle(match[1]),
      lineNumber: lineNumberForIndex(content, match.index),
    });
  }

  return links;
}

function isExternalOrAnchorTarget(target) {
  return (
    target === '' ||
    target.startsWith('#') ||
    target.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  );
}

function targetPathWithoutFragment(target) {
  const withoutFragment = target.split('#')[0];
  return withoutFragment.split('?')[0];
}

function safeDecodeUriPath(target) {
  try {
    return decodeURI(target);
  } catch {
    return target;
  }
}

function resolveRelativeLink(projectRoot, sourceFilePath, target) {
  const targetPath = targetPathWithoutFragment(target);
  if (!targetPath || isExternalOrAnchorTarget(targetPath)) {
    return null;
  }

  if (path.isAbsolute(targetPath)) {
    return {
      blocked: true,
      reason: 'absolute local Markdown links are not portable',
    };
  }

  const sourceDir = path.dirname(sourceFilePath);
  const resolvedPath = path.resolve(projectRoot, sourceDir, safeDecodeUriPath(targetPath));
  const relativePath = normalizePath(path.relative(projectRoot, resolvedPath));

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return {
      blocked: true,
      reason: 'relative Markdown link escapes the repository',
    };
  }

  return {
    absolutePath: resolvedPath,
    relativePath,
  };
}

function findMarkdownLinkFailures(projectRoot, markdownFiles = listTrackedMarkdownFiles(projectRoot)) {
  const failures = [];

  for (const filePath of markdownFiles) {
    const absoluteFilePath = path.join(projectRoot, filePath);
    const content = fs.readFileSync(absoluteFilePath, 'utf8');
    const links = extractMarkdownLinks(content);

    for (const link of links) {
      if (isExternalOrAnchorTarget(link.target)) {
        continue;
      }

      const resolved = resolveRelativeLink(projectRoot, filePath, link.target);
      if (!resolved) {
        continue;
      }

      if (resolved.blocked) {
        failures.push({
          filePath,
          lineNumber: link.lineNumber,
          target: link.target,
          message: resolved.reason,
        });
        continue;
      }

      if (!fs.existsSync(resolved.absolutePath)) {
        failures.push({
          filePath,
          lineNumber: link.lineNumber,
          target: link.target,
          message: `missing target ${resolved.relativePath}`,
        });
      }
    }
  }

  return failures;
}

function runMarkdownLinksCli(projectRoot = path.resolve(__dirname, '../..')) {
  const failures = findMarkdownLinkFailures(projectRoot);

  if (failures.length > 0) {
    failures.forEach((failure) => {
      console.error(
        `[check-markdown-links] ${failure.filePath}:${failure.lineNumber}: ${failure.message} (${failure.target})`,
      );
    });
    process.exitCode = 1;
    return;
  }

  console.log('[check-markdown-links] Relative Markdown links point to existing repository paths.');
}

module.exports = {
  extractMarkdownLinks,
  findMarkdownLinkFailures,
  isExternalOrAnchorTarget,
  listTrackedMarkdownFiles,
  resolveRelativeLink,
  runMarkdownLinksCli,
};
