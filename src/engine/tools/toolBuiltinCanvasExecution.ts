import { executeAudioTranscribe, executeCameraSnap } from './builtin-media';
import { executeCanvasCreate, executeCanvasDelete, executeCanvasUpdate } from './builtin-canvas-mutationExecution';
import { executeCanvasEval, executeCanvasList, executeCanvasNavigate, executeCanvasRead, executeCanvasSnapshot } from './builtin-canvas-runtime';
import { executePdfRead, executeWait } from './builtin-utility';
import type { BuiltinToolExecutionParams } from './toolBuiltinExecutionTypes';

export const BUILTIN_CANVAS_TOOL_NAMES = new Set([
  'canvas_list',
  'canvas_read',
  'canvas_create',
  'canvas_update',
  'canvas_delete',
  'canvas_navigate',
  'canvas_eval',
  'canvas_snapshot',
  'wait',
  'pdf_read',
  'camera_snap',
  'audio_transcribe',
]);

export async function executeBuiltinCanvasTool(
  params: BuiltinToolExecutionParams,
): Promise<string | null> {
  const { name, args, conversationFileContext } = params;

  switch (name) {
    case 'canvas_list':
      return executeCanvasList(args);
    case 'canvas_read':
      return executeCanvasRead(args);
    case 'canvas_create':
      return executeCanvasCreate(args, conversationFileContext);
    case 'canvas_update':
      return executeCanvasUpdate(args, conversationFileContext);
    case 'canvas_delete':
      return executeCanvasDelete(args);
    case 'canvas_navigate':
      return executeCanvasNavigate(args);
    case 'canvas_eval':
      return executeCanvasEval(args);
    case 'canvas_snapshot':
      return executeCanvasSnapshot(args);
    case 'wait':
      return executeWait(args);
    case 'pdf_read':
      return executePdfRead(args);
    case 'camera_snap':
      return executeCameraSnap(args);
    case 'audio_transcribe':
      return executeAudioTranscribe(args);
    default:
      return null;
  }
}
