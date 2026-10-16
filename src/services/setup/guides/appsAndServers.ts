// ---------------------------------------------------------------------------
// Kavi — Guided setup: building apps (Expo) and working on a server (SSH)
// ---------------------------------------------------------------------------
// Pages chosen by what Kavi's own web_fetch extracts without a Firecrawl key (probed
// 2026-10-16, __tests__/integration/setupGuidePages.live.test.ts): docs and pricing pages
// that render on the server. DigitalOcean's pricing docs and Droplet how-to render in the
// browser and come back empty, so its product page and quickstart are read instead.

import { guidePages, type SetupGuide, type SetupOption, type SetupPage } from '../setupGuideTypes';

const EXPO_PRICING: SetupPage = {
  url: 'https://expo.dev/pricing',
  about: "Expo's plans: what the free plan includes and what paid plans add",
};
const EXPO_TOKENS: SetupPage = {
  url: 'https://docs.expo.dev/accounts/programmatic-access/',
  about: 'how to create the access token Kavi uses',
};

const APPLE_ENROLLMENT: SetupPage = {
  url: 'https://developer.apple.com/programs/enroll/',
  about: 'how to enroll in the Apple Developer Program, what it costs and what Apple asks for',
};
const PLAY_ACCOUNT: SetupPage = {
  url: 'https://support.google.com/googleplay/android-developer/answer/6112435',
  about: 'how to create a Google Play developer account, its fee and verification',
};

const APP_OPTIONS: ReadonlyArray<SetupOption> = [
  {
    id: 'expo',
    name: 'Expo (EAS)',
    why: 'Builds Android and iPhone apps in the cloud, ships updates and hosts the web version; Kavi works through an Expo account.',
    pages: [EXPO_PRICING, EXPO_TOKENS],
  },
  {
    id: 'apple_app_store',
    name: 'Apple Developer Program',
    why: 'Needed only to publish on the App Store or install builds on a real iPhone.',
    pages: [APPLE_ENROLLMENT],
  },
  {
    id: 'google_play',
    name: 'Google Play Console',
    why: 'Needed only to publish on Google Play.',
    pages: [PLAY_ACCOUNT],
  },
];

export function appBuildingGuide(optionId?: string): SetupGuide {
  const chosen = APP_OPTIONS.find((option) => option.id === optionId);
  return {
    topic: 'app_building',
    title: chosen ? `Set up ${chosen.name}` : 'Build and publish apps with Expo',
    unlocks:
      'Kavi can create mobile apps and build them for Android and iPhone with Expo, ship updates to people who already have the app, publish the web version, and send builds to the app stores.',
    options: APP_OPTIONS,
    ...(chosen ? { optionId: chosen.id } : {}),
    // "What does it cost" covers the stores too, so the overview reads their pages as well.
    pages: guidePages(APP_OPTIONS, optionId, [
      EXPO_PRICING,
      EXPO_TOKENS,
      APPLE_ENROLLMENT,
      PLAY_ACCOUNT,
    ]),
    kaviSteps: [
      'In Kavi, open the Expo account form (Kavi can open it), set Owner to the Expo username and Type to Personal, and paste the access token. Never paste it into the chat.',
    ],
    enterInKavi: [
      { field: 'Owner', value: 'the Expo username (or the organization name)' },
      { field: 'Type', value: 'Personal' },
      { field: 'Token', value: 'the access token the person created on expo.dev' },
    ],
    form: { kind: 'settings', section: 'expo-account-edit', draft: { accountType: 'personal' } },
    afterSetup:
      'List the Expo projects to confirm the token works, then continue with the app the person asked for. The app stores need their own accounts, and only when the person wants to publish there: use option apple_app_store or google_play to guide those. The web version needs neither.',
  };
}

const SERVER_OPTIONS: ReadonlyArray<SetupOption> = [
  {
    id: 'oracle_free',
    name: 'Oracle Cloud Always Free',
    why: 'The free option with real resources; it logs in with an SSH key file rather than a password, and sign-ups are not always accepted.',
    pages: [
      {
        url: 'https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm',
        about: 'what the Always Free tier includes and its conditions',
      },
      {
        url: 'https://docs.oracle.com/en-us/iaas/Content/Compute/tutorials/first-linux-instance/overview.htm',
        about: 'how to create the server and connect to it',
      },
    ],
  },
  {
    id: 'digitalocean',
    name: 'DigitalOcean Droplet',
    why: 'The easiest from a phone: it can be created with a password, so nothing has to be copied from a computer.',
    pages: [
      {
        url: 'https://docs.digitalocean.com/products/droplets/getting-started/quickstart/',
        about: 'how to create a Droplet',
      },
      {
        url: 'https://docs.digitalocean.com/products/droplets/how-to/connect-with-ssh/',
        about: 'the username and login a new Droplet uses',
      },
    ],
  },
  {
    id: 'ovh',
    name: 'OVHcloud VPS',
    why: 'Often the most memory per dollar; the control panel is harder to use on a phone.',
    pages: [
      {
        url: 'https://help.ovhcloud.com/csm/en-vps-getting-started?id=kb_article_view&sysparm_article=KB0047706',
        about: 'how to get started with the VPS and log in',
      },
      { url: 'https://us.ovhcloud.com/vps/', about: 'current VPS plans and prices' },
    ],
  },
];

const SERVER_OVERVIEW: ReadonlyArray<SetupPage> = [
  {
    url: 'https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm',
    about: "Oracle's Always Free resources",
  },
  { url: 'https://www.digitalocean.com/products/droplets', about: 'DigitalOcean Droplet prices' },
  { url: 'https://us.ovhcloud.com/vps/', about: 'OVHcloud VPS plans and prices' },
  // A website on the server needs a name too; this registrar lists every ending's price.
  {
    url: 'https://porkbun.com/products/domains',
    about: 'what a domain name costs a year (.com and other endings), for a website on the server',
  },
];

/** What the SSH form opens with, per provider: only what the provider's setup fixes. */
const SSH_DRAFTS: Readonly<Record<string, Readonly<Record<string, string | number>>>> = {
  digitalocean: { username: 'root', authMode: 'password' },
  oracle_free: { authMode: 'private-key' },
};

export function serverGuide(optionId?: string): SetupGuide {
  const chosen = SERVER_OPTIONS.find((option) => option.id === optionId);
  return {
    topic: 'server',
    title: chosen ? `Get a ${chosen.name} for Kavi` : 'Get a server Kavi can work on',
    unlocks:
      'Kavi can run commands, install and update software, host websites and apps, and manage files on a server (a VPS) over SSH, and keep it secure.',
    options: SERVER_OPTIONS,
    ...(chosen ? { optionId: chosen.id } : {}),
    pages: guidePages(SERVER_OPTIONS, optionId, SERVER_OVERVIEW),
    kaviSteps: [
      'In Kavi, open the SSH server form (Kavi can open it) and enter the server address, the username and the password or private key the provider gave. Never paste a password or key into the chat.',
    ],
    enterInKavi: [
      { field: 'Host', value: "the server's IP address" },
      { field: 'Port', value: '22' },
      { field: 'Username', value: "the username the provider's page names for a new server" },
      {
        field: 'Password or private key',
        value: 'what the provider gave when the server was created',
      },
      { field: 'Host key', value: 'Trust on first use' },
    ],
    form: {
      kind: 'settings',
      section: 'ssh-edit',
      draft: {
        port: 22,
        hostKeyPolicy: 'trust-on-first-use',
        ...(chosen ? SSH_DRAFTS[chosen.id] : {}),
      },
    },
    afterSetup:
      'Connect once (for example, run `uname -a`) to confirm it works, then continue with what the person asked. Offer to secure the server right away (see safety); do it only after they agree.',
    safety: [
      'Update the system: `apt update && apt -y full-upgrade && apt -y install unattended-upgrades`.',
      'Allow SSH through the firewall before turning it on, or the person is locked out: `ufw allow OpenSSH` first, then `ufw --force enable`.',
      'Install brute-force protection: `apt -y install fail2ban` (its SSH protection is on by default on Ubuntu).',
      'Only after a key-based login is confirmed working: turn off password logins by writing `PasswordAuthentication no` to `/etc/ssh/sshd_config.d/00-kavi.conf` (the name makes it win over cloud images that turn passwords on), check with `sshd -t`, then `systemctl reload ssh`.',
      "Provider firewalls (DigitalOcean Cloud Firewalls, Oracle security lists) are separate from the server's own: open the same ports there.",
    ],
  };
}
