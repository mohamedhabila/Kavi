import { executeStructuredNativeAction } from '../structuredAction';

export async function executeContactsSearch(args: {
  query: string;
  limit?: number;
}): Promise<string> {
  return executeStructuredNativeAction('contacts_search', args as Record<string, unknown>);
}

export async function executeContactsGet(args: { id: string }): Promise<string> {
  return executeStructuredNativeAction('contacts_get', args as Record<string, unknown>);
}

export async function executeContactsPick(): Promise<string> {
  return executeStructuredNativeAction('contacts_pick');
}

export async function executeContactsManageAccess(): Promise<string> {
  return executeStructuredNativeAction('contacts_manage_access');
}

export async function executeContactsView(args: { id: string }): Promise<string> {
  return executeStructuredNativeAction('contacts_view', args as Record<string, unknown>);
}

export async function executeContactsEdit(args: Record<string, unknown>): Promise<string> {
  return executeStructuredNativeAction('contacts_edit', args);
}

export async function executeContactsCreate(args: Record<string, unknown>): Promise<string> {
  return executeStructuredNativeAction('contacts_create', args);
}

export async function executeContactsShare(args: {
  id: string;
  message?: string;
}): Promise<string> {
  return executeStructuredNativeAction('contacts_share', args as Record<string, unknown>);
}

export async function executeContactsSearchFull(args: {
  query: string;
  limit?: number;
}): Promise<string> {
  return executeStructuredNativeAction('contacts_search_full', args as Record<string, unknown>);
}

export async function executeContactsGetFull(args: { id: string }): Promise<string> {
  return executeStructuredNativeAction('contacts_get_full', args as Record<string, unknown>);
}
