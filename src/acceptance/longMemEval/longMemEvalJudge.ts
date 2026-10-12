// ---------------------------------------------------------------------------
// Kavi — LongMemEval answer judge
// ---------------------------------------------------------------------------
// The judge prompts are LongMemEval's own, verbatim from src/evaluation/evaluate_qa.py
// (get_anscheck_prompt, MIT), so scores compare with published LongMemEval numbers. The
// reference judge is gpt-4o-2024-08-06 at temperature 0 with 10 output tokens; a reply
// counts as correct when it contains "yes", as in the reference script.
// ---------------------------------------------------------------------------

import type { LongMemEvalInstance } from './longMemEvalDataset';

export const LONGMEMEVAL_REFERENCE_JUDGE_MODEL = 'openai/gpt-4o-2024-08-06';
export const LONGMEMEVAL_JUDGE_MAX_TOKENS = 10;

const FACTUAL_TEMPLATE =
  'I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. \n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only.';

const TEMPORAL_TEMPLATE =
  "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct. \n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only.";

const KNOWLEDGE_UPDATE_TEMPLATE =
  'I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.\n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only.';

const PREFERENCE_TEMPLATE =
  "I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.\n\nQuestion: {}\n\nRubric: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only.";

const ABSTENTION_TEMPLATE =
  'I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.\n\nQuestion: {}\n\nExplanation: {}\n\nModel Response: {}\n\nDoes the model correctly identify the question as unanswerable? Answer yes or no only.';

function templateFor(instance: LongMemEvalInstance): string {
  if (instance.abstention) return ABSTENTION_TEMPLATE;
  switch (instance.questionType) {
    case 'single-session-user':
    case 'single-session-assistant':
    case 'multi-session':
      return FACTUAL_TEMPLATE;
    case 'temporal-reasoning':
      return TEMPORAL_TEMPLATE;
    case 'knowledge-update':
      return KNOWLEDGE_UPDATE_TEMPLATE;
    case 'single-session-preference':
      return PREFERENCE_TEMPLATE;
  }
}

/** Python's str.format for the three positional `{}` slots, without re-reading inserted text. */
function fillTemplate(template: string, values: readonly [string, string, string]): string {
  const parts = template.split('{}');
  if (parts.length !== values.length + 1) {
    throw new Error('LongMemEval judge template must have exactly three slots.');
  }
  return parts.reduce((filled, part, index) => filled + part + (values[index] ?? ''), '');
}

export function buildLongMemEvalJudgePrompt(
  instance: LongMemEvalInstance,
  response: string,
): string {
  return fillTemplate(templateFor(instance), [instance.question, instance.answer, response]);
}

/** The reference script's rule: correct when the judge's reply contains "yes". */
export function parseLongMemEvalJudgeLabel(reply: string): boolean {
  return reply.trim().toLowerCase().includes('yes');
}
