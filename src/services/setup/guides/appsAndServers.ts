// ---------------------------------------------------------------------------
// Kavi — Guided setup: building apps (Expo) and working on a server (SSH)
// ---------------------------------------------------------------------------
// Facts checked against the vendors' own pages on 2026-10-15. Steps whose exact button
// labels could not be confirmed name the page and what to look for, not a label.

import type { SetupGuide, SetupOption } from '../setupGuideTypes';

const APP_BUILDING_STEPS = [
  'On the phone, open expo.dev/signup and sign up with Google, GitHub or Apple, or with an email, username and password. The username is what Kavi calls the Owner.',
  'Open expo.dev/settings/access-tokens while signed in, create a new access token and name it "Kavi".',
  'Copy the token right away: Expo shows it only once.',
  'In Kavi, open the Expo account form (Kavi can open it), set Owner to the Expo username and Type to Personal, and paste the token. Never paste it into the chat.',
];

export const APP_BUILDING_GUIDE: SetupGuide = {
  topic: 'app_building',
  title: 'Build and publish apps with Expo',
  unlocks:
    'Kavi can create mobile apps and build them for Android and iPhone with Expo (EAS), ship updates to people who already have the app, publish the web version, and send builds to the app stores.',
  options: [
    {
      id: 'expo_free',
      name: 'Expo Free plan',
      cost: 'Free: 15 Android and 15 iOS builds a month (low-priority queue, 45-minute limit each), updates for 1,000 monthly users, and free web hosting (no custom domain).',
      notes:
        'Enough to build and try an app. Starter is $19/month plus usage for faster builds and a custom domain.',
      url: 'https://expo.dev/pricing',
    },
  ],
  optionId: 'expo_free',
  steps: APP_BUILDING_STEPS,
  enterInKavi: [
    { field: 'Owner', value: 'the Expo username (or the organization name)' },
    { field: 'Type', value: 'Personal' },
    { field: 'Token', value: 'the access token from expo.dev/settings/access-tokens' },
  ],
  form: { kind: 'settings', section: 'expo-account-edit', draft: { accountType: 'personal' } },
  afterSetup:
    'List the Expo projects to confirm the token works, then continue with the app the person asked for. Publishing to the stores needs more, and only when they want it: the Apple Developer Program ($99 a year: install the Apple Developer app, Account, Enroll, with a photo ID; approval can take days) for iPhone, and a Google Play Console account ($25 once, identity verification; new personal accounts must run a closed test with 12 testers for 14 days before going public) for Android. The free web version needs neither.',
  sources: [
    'https://expo.dev/pricing',
    'https://docs.expo.dev/accounts/programmatic-access/',
    'https://developer.apple.com/programs/enroll/',
    'https://support.google.com/googleplay/android-developer/answer/14151465',
  ],
  verifiedOn: '2026-10-15',
};

const SERVER_OPTIONS: ReadonlyArray<SetupOption> = [
  {
    id: 'oracle_free',
    name: 'Oracle Cloud Always Free',
    cost: 'Free: Arm servers with 2 cores and 12 GB of memory in total, plus two small AMD ones with 1 GB each; 200 GB of disk and 10 TB of traffic a month, in the home region only.',
    notes:
      'The only free option with real resources, but sign-ups are sometimes refused, a card is needed for verification, popular regions often report "out of capacity", and a server that stays idle for 7 days can be reclaimed. Uses an SSH key file rather than a password.',
    url: 'https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm',
  },
  {
    id: 'digitalocean',
    name: 'DigitalOcean Droplet',
    cost: '$6/month: 1 GB of memory, 25 GB of disk, 1 TB of traffic, IPv4 included ($4/month for 512 MB).',
    notes:
      'The easiest from a phone: it can be created with a password, so nothing has to be copied from a computer. Less memory per dollar than the others.',
    url: 'https://www.digitalocean.com/pricing/droplets',
  },
  {
    id: 'ovh',
    name: 'OVHcloud VPS-1',
    cost: 'About $4.50/month: 2 cores, 4 GB of memory, 40 GB of disk, unmetered traffic (the price may assume a yearly term).',
    notes: 'The best value per dollar; the control panel is harder to use on a phone.',
    url: 'https://us.ovhcloud.com/vps/',
  },
];

export const SERVER_GUIDE: SetupGuide = {
  topic: 'server',
  title: 'Get a server Kavi can work on',
  unlocks:
    'Kavi can run commands, install and update software, host websites and apps, and manage files on a server (a VPS) over SSH, and keep it secure.',
  options: SERVER_OPTIONS,
  optionId: 'digitalocean',
  steps: [
    'Open digitalocean.com on the phone, sign up and add a payment method.',
    'Choose Create, then Droplet.',
    'Pick the region closest to the person (or to the people who will use what runs on it).',
    'For the image, pick Ubuntu, the newest version marked LTS.',
    'For the size, pick Basic and the $6/month plan.',
    'For authentication, pick Password and make a long one; save it in the password manager.',
    'Create the Droplet, wait until it is ready, then copy its IP address from the list.',
    'In Kavi, open the SSH server form (Kavi can open it) and fill in the IP address and the password. Never paste the password into the chat.',
  ],
  enterInKavi: [
    { field: 'Host', value: "the Droplet's IP address" },
    { field: 'Port', value: '22' },
    { field: 'Username', value: 'root' },
    { field: 'Password', value: 'the password chosen when creating the Droplet' },
    { field: 'Host key', value: 'Trust on first use' },
  ],
  form: {
    kind: 'settings',
    section: 'ssh-edit',
    draft: {
      port: 22,
      username: 'root',
      authMode: 'password',
      hostKeyPolicy: 'trust-on-first-use',
    },
  },
  afterSetup:
    "Connect once (for example, run `uname -a`) to confirm it works, then continue with what the person asked. Offer to secure the server right away (see safety); do it only after they agree. For Oracle the username is usually ubuntu and the login is the private key file they saved while creating the server (pasted into the form's private-key field).",
  safety: [
    'Update the system: `apt update && apt -y full-upgrade && apt -y install unattended-upgrades`.',
    'Allow SSH through the firewall before turning it on, or the person is locked out: `ufw allow OpenSSH` first, then `ufw --force enable`.',
    'Install brute-force protection: `apt -y install fail2ban` (its SSH protection is on by default on Ubuntu).',
    'Only after a key-based login is confirmed working: turn off password logins by writing `PasswordAuthentication no` to `/etc/ssh/sshd_config.d/00-kavi.conf` (the name makes it win over cloud images that turn passwords on), check with `sshd -t`, then `systemctl reload ssh`.',
    "Provider firewalls (DigitalOcean Cloud Firewalls, Oracle security lists) are separate from the server's own: open the same ports there.",
  ],
  sources: [
    'https://docs.digitalocean.com/products/droplets/how-to/create/',
    'https://www.digitalocean.com/pricing/droplets',
    'https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm',
    'https://us.ovhcloud.com/vps/',
  ],
  verifiedOn: '2026-10-15',
};
