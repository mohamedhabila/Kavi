// ---------------------------------------------------------------------------
// Kavi — E2E mail integration for a scenario
// ---------------------------------------------------------------------------
// Connects the scenario's inbox (an in-process MCP server) to Kavi the way a person's mail
// integration is connected, and takes it away again when the scenario ends.

import { mcpManager } from '../../services/mcp/manager';
import { useApprovalStore } from '../../services/remote/approvalStore';
import type { McpServerConfig } from '../../types/remote';
import { startE2EMailServer, type E2EMailMessage } from './e2eMailMcpServer';
import { recordE2EMailReply } from './e2eNativeMobileFixtures';

const E2E_MAIL_SERVER_ID = 'mail';
const E2E_MAIL_TOOL_NAMES = ['mail_search', 'mail_read', 'mail_draft_reply', 'mail_send_draft'];

export type E2EMailIntegration = Readonly<{ disconnect: () => Promise<void> }>;

export async function connectE2EMailIntegration(
  messages: ReadonlyArray<E2EMailMessage>,
): Promise<E2EMailIntegration> {
  const server = await startE2EMailServer(messages, recordE2EMailReply);
  const config: McpServerConfig = {
    id: E2E_MAIL_SERVER_ID,
    name: 'Mail',
    url: server.url,
    transport: 'streamable-http',
    enabled: true,
    tools: [],
    allowedTools: [],
    trust: { source: 'manual' },
    trustToolAnnotations: true,
  };
  try {
    await mcpManager.connectServer(config);
  } catch (error) {
    await server.close();
    throw new Error(
      `The e2e mail integration did not connect: ${error instanceof Error ? error.message : String(error)}; ` +
        `server: ${server.errors.join(' | ') || 'no errors'}`,
    );
  }
  const approvals = E2E_MAIL_TOOL_NAMES.map((name) => `mcp__${E2E_MAIL_SERVER_ID}__${name}`).filter(
    (key) => !useApprovalStore.getState().isAllowlisted(key),
  );
  for (const key of approvals) useApprovalStore.getState().addToAllowlist(key);

  return {
    disconnect: async () => {
      for (const key of approvals) useApprovalStore.getState().removeFromAllowlist(key);
      mcpManager.disconnectServer(E2E_MAIL_SERVER_ID);
      await server.close();
    },
  };
}
