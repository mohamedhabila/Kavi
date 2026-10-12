export interface SchedulerExecutionResult {
  output: string;
  conversationId?: string;
  conversationDurable?: boolean;
  warnings?: string[];
}
