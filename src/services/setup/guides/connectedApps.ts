// ---------------------------------------------------------------------------
// Kavi — Guided setup: connecting a service (MCP)
// ---------------------------------------------------------------------------
// Vendors' own remote MCP servers, each under its exact name in the official MCP Registry
// (checked 2026-10-16). When a guide is asked for, the registry entry is read again and its
// current address wins over the one here, which only stands in while the registry is
// unreachable. A service not listed here is looked up in the registry by name.

import type { SetupGuide, SetupOption } from '../setupGuideTypes';

/** A vendor's own server, as the directory offers it. */
export type DirectoryServer = SetupOption &
  Readonly<{
    /** The server's name in the MCP Registry, `namespace/server`, the vendor's namespace. */
    registryName: string;
    /** The address last seen in the registry. */
    url: string;
    /** Sign-in the vendor's server expects; a token is entered in the form instead of OAuth. */
    auth: 'oauth' | 'token';
    note?: string;
  }>;

export const MCP_DIRECTORY: ReadonlyArray<DirectoryServer> = [
  {
    id: 'notion',
    name: 'Notion',
    registryName: 'com.notion/mcp',
    url: 'https://mcp.notion.com/mcp',
    auth: 'oauth',
    why: 'read and write Notion pages and databases',
  },
  {
    id: 'linear',
    name: 'Linear',
    registryName: 'app.linear/linear',
    url: 'https://mcp.linear.app/mcp',
    auth: 'oauth',
    why: 'read and manage Linear issues and projects',
  },
  {
    id: 'atlassian',
    name: 'Atlassian (Jira, Confluence)',
    registryName: 'com.atlassian/atlassian-mcp-server',
    url: 'https://mcp.atlassian.com/v2/mcp',
    auth: 'oauth',
    why: 'read and update Jira issues and Confluence pages',
  },
  {
    id: 'monday',
    name: 'monday.com',
    registryName: 'com.monday/monday.com',
    url: 'https://mcp.monday.com/mcp',
    auth: 'oauth',
    why: 'read and update monday.com boards and items',
  },
  {
    id: 'github',
    name: 'GitHub',
    registryName: 'io.github.github/github-mcp-server',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: 'token',
    why: 'work with GitHub repositories, issues and pull requests',
    pages: [
      {
        url: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
        about: 'how to create the personal access token the server takes',
      },
    ],
    note: 'GitHub signs in other apps unreliably here: create a personal access token and enter it in the form as the Authorization header (Bearer and the token).',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    registryName: 'com.stripe/mcp',
    url: 'https://mcp.stripe.com',
    auth: 'oauth',
    why: 'look up Stripe payments, customers and invoices',
  },
  {
    id: 'paypal',
    name: 'PayPal',
    registryName: 'com.paypal.mcp/mcp',
    url: 'https://mcp.paypal.com/mcp',
    auth: 'oauth',
    why: 'work with PayPal invoices and transactions',
  },
  {
    id: 'zapier',
    name: 'Zapier (thousands of apps)',
    registryName: 'com.zapier/mcp',
    url: 'https://mcp.zapier.com/api/v1/connect',
    auth: 'oauth',
    why: 'use the apps connected in Zapier, such as Gmail, Google Sheets and Slack; the way to reach many apps that have no server of their own',
  },
  {
    id: 'canva',
    name: 'Canva',
    registryName: 'com.canva.mcp/mcp',
    url: 'https://mcp.canva.com/mcp',
    auth: 'oauth',
    why: 'create and edit Canva designs',
  },
  {
    id: 'figma',
    name: 'Figma',
    registryName: 'com.figma.mcp/mcp',
    url: 'https://mcp.figma.com/mcp',
    auth: 'oauth',
    why: 'read Figma designs',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    registryName: 'co.huggingface/hf-mcp-server',
    url: 'https://huggingface.co/mcp',
    auth: 'oauth',
    why: 'search models, datasets and Spaces on Hugging Face',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    registryName: 'com.supabase/mcp',
    url: 'https://mcp.supabase.com/mcp',
    auth: 'oauth',
    why: 'manage Supabase databases and projects',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    registryName: 'com.vercel/vercel-mcp',
    url: 'https://mcp.vercel.com',
    auth: 'oauth',
    why: 'manage Vercel projects and deployments',
  },
  {
    id: 'cloudflare_docs',
    name: 'Cloudflare docs',
    registryName: 'com.cloudflare.mcp/mcp',
    url: 'https://docs.mcp.cloudflare.com/mcp',
    auth: 'oauth',
    why: 'search Cloudflare documentation (Cloudflare runs a separate server per product)',
  },
  {
    id: 'microsoft_learn',
    name: 'Microsoft Learn',
    registryName: 'com.microsoft/microsoft-learn-mcp',
    url: 'https://learn.microsoft.com/api/mcp',
    auth: 'oauth',
    why: 'search Microsoft documentation (not Outlook or OneDrive)',
  },
];

/** The guide for connecting [server], at the address the registry has for it now. */
export function connectAppGuide(server?: DirectoryServer, url = server?.url): SetupGuide {
  const signIn =
    server?.auth === 'token'
      ? 'Create the access token the service asks for (its page says how), enter it in the form, and save.'
      : "Save the form. The service's own sign-in page opens: sign in there and allow Kavi access.";
  return {
    topic: 'connect_app',
    title: server ? `Connect ${server.name}` : 'Connect a service',
    unlocks: server
      ? `Kavi can ${server.why}.`
      : "Kavi can use a service's own tools (Notion, Linear, Jira, GitHub, Stripe, Canva, Zapier and many more) once it is connected through an MCP server.",
    options: server ? [server] : MCP_DIRECTORY,
    ...(server ? { optionId: server.id } : {}),
    pages: server?.pages ?? [],
    kaviSteps: server
      ? [
          `Open the connection form (Kavi can open it with ${server.name}'s address filled in).`,
          signIn,
          'Come back to Kavi and say it is done.',
        ]
      : [
          'Say which service to connect. Kavi offers the vendor’s own server when there is one, or looks for it in the official MCP Registry.',
        ],
    ...(server && url
      ? {
          enterInKavi: [
            { field: 'Name', value: server.name },
            { field: 'URL', value: url },
          ],
          form: {
            kind: 'settings' as const,
            section: 'mcp-edit' as const,
            draft: { name: server.name, url },
          },
        }
      : {}),
    afterSetup:
      'Once it shows as connected, use its tools for what the person asked. If the service refuses the sign-in ("client not allowed"), use a token from the service instead, when it offers one.',
    safety: [
      'Connect only the vendor’s own server. A registry entry published by someone else may need another account or see the person’s data.',
    ],
  };
}
