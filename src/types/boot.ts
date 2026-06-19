export interface BootConfig {
  enabled: boolean;
  content?: string;
  lastRunAt?: number;
  lastStatus?: 'ran' | 'skipped' | 'failed';
}

export interface BootRunResult {
  status: 'ran' | 'skipped' | 'failed';
  reason?: string;
  output?: string;
}
