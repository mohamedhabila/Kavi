// ---------------------------------------------------------------------------
// Kavi — Guided setup: connecting a service (MCP)
// ---------------------------------------------------------------------------
// Vendors' own remote MCP servers, by the URLs their entries in the official MCP Registry
// list (checked 2026-10-15). Connecting one is: open the form with the URL filled in, save,
// and sign in on the service's own page when it opens (OAuth). A service not listed here
// is looked up in the registry instead.

import type { SetupGuide, SetupOption } from '../setupGuideTypes';

/** A vendor's own server, as the directory offers it. */
export type DirectoryServer = SetupOption &
  Readonly<{
    url: string;
    /** What connecting it lets Kavi do. */
    does: string;
    /** Sign-in the vendor's server expects; a token is entered in the form instead of OAuth. */
    auth: 'oauth' | 'token';
  }>;

export const MCP_DIRECTORY: ReadonlyArray<DirectoryServer> = [
  {
    id: 'notion',
    name: 'Notion',
    url: 'https://mcp.notion.com/mcp',
    auth: 'oauth',
    does: 'read and write Notion pages and databases',
    cost: 'Free with a Notion account',
    notes: '',
  },
  {
    id: 'linear',
    name: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    auth: 'oauth',
    does: 'read and manage Linear issues and projects',
    cost: 'Free with a Linear account',
    notes: '',
  },
  {
    id: 'atlassian',
    name: 'Atlassian (Jira, Confluence)',
    url: 'https://mcp.atlassian.com/v2/mcp',
    auth: 'oauth',
    does: 'read and update Jira issues and Confluence pages',
    cost: 'Needs an Atlassian Cloud site',
    notes: '',
  },
  {
    id: 'monday',
    name: 'monday.com',
    url: 'https://mcp.monday.com/mcp',
    auth: 'oauth',
    does: 'read and update monday.com boards and items',
    cost: 'Needs a monday.com account',
    notes: '',
  },
  {
    id: 'github',
    name: 'GitHub',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: 'token',
    does: 'work with GitHub repositories, issues and pull requests',
    cost: 'Free with a GitHub account',
    notes:
      'GitHub signs in other apps unreliably here: create a personal access token at github.com/settings/tokens and enter it in the form.',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    url: 'https://mcp.stripe.com',
    auth: 'oauth',
    does: 'look up Stripe payments, customers and invoices',
    cost: 'Needs a Stripe account',
    notes: '',
  },
  {
    id: 'paypal',
    name: 'PayPal',
    url: 'https://mcp.paypal.com/mcp',
    auth: 'oauth',
    does: 'work with PayPal invoices and transactions',
    cost: 'Needs a PayPal business account',
    notes: '',
  },
  {
    id: 'zapier',
    name: 'Zapier (thousands of apps)',
    url: 'https://mcp.zapier.com/api/v1/connect',
    auth: 'oauth',
    does: 'use the apps connected in Zapier, such as Gmail, Google Sheets and Slack',
    cost: 'Free Zapier plan with limits; paid plans for more',
    notes: 'The way to reach many apps that have no server of their own.',
  },
  {
    id: 'canva',
    name: 'Canva',
    url: 'https://mcp.canva.com/mcp',
    auth: 'oauth',
    does: 'create and edit Canva designs',
    cost: 'Free with a Canva account',
    notes: '',
  },
  {
    id: 'figma',
    name: 'Figma',
    url: 'https://mcp.figma.com/mcp',
    auth: 'oauth',
    does: 'read Figma designs',
    cost: 'Needs a Figma account',
    notes: '',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    url: 'https://huggingface.co/mcp',
    auth: 'oauth',
    does: 'search models, datasets and Spaces on Hugging Face',
    cost: 'Free',
    notes: '',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    url: 'https://mcp.supabase.com/mcp',
    auth: 'oauth',
    does: 'manage Supabase databases and projects',
    cost: 'Free tier available',
    notes: '',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    url: 'https://mcp.vercel.com',
    auth: 'oauth',
    does: 'manage Vercel projects and deployments',
    cost: 'Free tier available',
    notes: '',
  },
  {
    id: 'cloudflare_docs',
    name: 'Cloudflare docs',
    url: 'https://docs.mcp.cloudflare.com/mcp',
    auth: 'oauth',
    does: 'search Cloudflare documentation',
    cost: 'Free',
    notes: 'Cloudflare runs separate servers per product; this one is its documentation.',
  },
  {
    id: 'microsoft_learn',
    name: 'Microsoft Learn',
    url: 'https://learn.microsoft.com/api/mcp',
    auth: 'oauth',
    does: 'search Microsoft documentation',
    cost: 'Free',
    notes: 'Documentation only, not Outlook or OneDrive.',
  },
];

export function connectAppGuide(server?: DirectoryServer): SetupGuide {
  const signIn =
    server?.auth === 'token'
      ? 'Create the access token the service asks for (see notes), paste it into the form, and save.'
      : "Save the form. The service's own sign-in page opens: sign in there and allow Kavi access.";
  return {
    topic: 'connect_app',
    title: server ? `Connect ${server.name}` : 'Connect a service',
    unlocks: server
      ? `Kavi can ${server.does}.`
      : "Kavi can use a service's own tools (Notion, Linear, Jira, GitHub, Stripe, Canva, Zapier and many more) once it is connected through an MCP server.",
    options: server ? [server] : MCP_DIRECTORY,
    ...(server ? { optionId: server.id } : {}),
    steps: server
      ? [
          `Open the connection form (Kavi can open it with ${server.name}'s address filled in).`,
          signIn,
          'Come back to Kavi and say it is done.',
        ]
      : [
          'Say which service to connect. Kavi offers the vendor’s own server when there is one, or looks for it in the official MCP Registry.',
        ],
    ...(server
      ? {
          enterInKavi: [
            { field: 'Name', value: server.name },
            { field: 'URL', value: server.url },
          ],
          form: {
            kind: 'settings' as const,
            section: 'mcp-edit' as const,
            draft: { name: server.name, url: server.url },
          },
        }
      : {}),
    afterSetup:
      'Once it shows as connected, use its tools for what the person asked. If the service refuses the sign-in ("client not allowed"), use a token from the service instead, when it offers one.',
    safety: [
      'Connect only the vendor’s own server. A registry entry published by someone else may need another account or see the person’s data.',
    ],
    sources: [
      'https://registry.modelcontextprotocol.io/v0.1/servers',
      'https://modelcontextprotocol.io/specification/2026-07-28',
    ],
    verifiedOn: '2026-10-15',
  };
}
