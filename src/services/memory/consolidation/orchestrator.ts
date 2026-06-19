import type { ProcessTurnResult } from '../turnProcessor';
import { processConsolidationTurn, type ProcessConsolidationTurnInput } from './turnPipeline';

export type RunConsolidationInput = ProcessConsolidationTurnInput;

export async function runConsolidation(input: RunConsolidationInput): Promise<ProcessTurnResult> {
  return processConsolidationTurn(input);
}
