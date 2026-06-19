export const readFileToolDefinition = {
  name: 'read_file',
  description: 'Read a file',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
};

export const completedReadFileToolResult = {
  id: 'tool-read-1',
  name: 'read_file',
  arguments: JSON.stringify({ path: 'src/index.ts' }),
  status: 'completed' as const,
  result: 'file contents',
};
