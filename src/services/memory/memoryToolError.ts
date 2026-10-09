/** The tagged error every memory tool returns instead of throwing out of the tool loop. */
export interface MemoryToolError {
  status: 'rejected' | 'failed_unknown';
  ok: false;
  error: string;
  code:
    | 'invalid_args'
    | 'not_found'
    | 'memory_disabled'
    | 'grounding_required'
    | 'conflict'
    | 'permission_denied'
    | 'internal';
}

export function memoryToolError(code: MemoryToolError['code'], message: string): MemoryToolError {
  return {
    status: code === 'internal' ? 'failed_unknown' : 'rejected',
    ok: false,
    code,
    error: message,
  };
}
