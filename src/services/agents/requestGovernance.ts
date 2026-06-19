export type RequestAssessmentAction = 'proceed' | 'clarify';

export interface RequestAssessment {
  action: RequestAssessmentAction;
}
