import { executeStructuredNativeAction } from '../structuredAction';

export async function executeOpenUrl(args: { url: string }): Promise<string> {
  return executeStructuredNativeAction('open_url', args as Record<string, unknown>);
}

export async function executeEmailCompose(args: Record<string, unknown>): Promise<string> {
  return executeStructuredNativeAction('email_compose', args);
}

export async function executeSmsCompose(args: Record<string, unknown>): Promise<string> {
  return executeStructuredNativeAction('sms_compose', args);
}

export async function executePhoneCall(args: {
  number: string;
  defaultCountry?: string;
}): Promise<string> {
  return executeStructuredNativeAction('phone_call', args as Record<string, unknown>);
}

export async function executeMapsOpen(args: Record<string, unknown>): Promise<string> {
  return executeStructuredNativeAction('maps_open', args);
}
