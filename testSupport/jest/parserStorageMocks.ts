jest.mock('yaml', () => ({
  __esModule: true,
  default: {
    parse: (text: string) => {
      if (!text.trim()) return {};
      const lines = text.split('\n');
      const root: Record<string, unknown> = {};

      const parseScalar = (value: string): unknown => {
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
        return value;
      };

      const getNextContainer = (
        currentIndex: number,
        currentIndent: number,
      ): Record<string, unknown> | unknown[] => {
        for (let nextIndex = currentIndex + 1; nextIndex < lines.length; nextIndex += 1) {
          const nextLine = lines[nextIndex];
          if (!nextLine.trim()) {
            continue;
          }

          const nextIndent = nextLine.match(/^\s*/)?.[0].length || 0;
          if (nextIndent <= currentIndent) {
            break;
          }

          return nextLine.trim().startsWith('- ') ? [] : {};
        }

        return {};
      };

      const stack: Array<{ indent: number; container: Record<string, unknown> | unknown[] }> = [
        { indent: -1, container: root },
      ];

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line.trim()) {
          continue;
        }

        const indent = line.match(/^\s*/)?.[0].length || 0;
        const trimmed = line.trim();

        while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
          stack.pop();
        }

        const currentContainer = stack[stack.length - 1].container;

        const arrayMatch = trimmed.match(/^-\s+(.+)$/);
        if (arrayMatch) {
          if (Array.isArray(currentContainer)) {
            currentContainer.push(parseScalar(arrayMatch[1].trim()));
          }
          continue;
        }

        const kvMatch = trimmed.match(/^([a-zA-Z_]\w*)\s*:\s*(.*)$/);
        if (kvMatch) {
          const key = kvMatch[1];
          const val = kvMatch[2].trim();

          if (Array.isArray(currentContainer)) {
            continue;
          }

          if (!val) {
            const nextContainer = getNextContainer(index, indent);
            currentContainer[key] = nextContainer;
            stack.push({ indent, container: nextContainer });
            continue;
          }

          currentContainer[key] = parseScalar(val);
        }
      }

      return root;
    },
    stringify: (obj: any) => JSON.stringify(obj),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn().mockResolvedValue(undefined),
    getItem: jest.fn().mockResolvedValue(null),
    removeItem: jest.fn().mockResolvedValue(undefined),
    multiGet: jest.fn().mockResolvedValue([]),
    multiSet: jest.fn().mockResolvedValue(undefined),
    multiRemove: jest.fn().mockResolvedValue(undefined),
    getAllKeys: jest.fn().mockResolvedValue([]),
    clear: jest.fn().mockResolvedValue(undefined),
  },
}));
