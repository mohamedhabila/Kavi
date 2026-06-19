// Silence warnings during tests
const originalWarn = console.warn;
const originalError = console.error;

const suppressedWarnPrefixes = [
  'Failed to import chat attachments into the conversation workspace.',
];

console.warn = (...args: any[]) => {
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('Animated') ||
      args[0].includes('useNativeDriver') ||
      suppressedWarnPrefixes.some((prefix) => args[0].startsWith(prefix)))
  ) {
    return;
  }
  originalWarn(...args);
};

console.error = (...args: any[]) => {
  const message = args
    .map((arg) => {
      try {
        return String(arg);
      } catch {
        return '';
      }
    })
    .join(' ');

  if (message.includes('findNodeHandle is deprecated in StrictMode')) {
    return;
  }
  originalError(...args);
};
