// ---------------------------------------------------------------------------
// Kavi — Guided setup: what a guide says
// ---------------------------------------------------------------------------
// A guide is code-owned fact, in English for the model, which walks the person through it
// in their own language and at their pace. Secrets are never typed into the chat: every
// guide ends at the Kavi form where the person enters them. Each guide records when its
// facts (prices, limits, page paths) were last checked against the vendors' own pages.

export const SETUP_TOPICS = [
  'app_building',
  'server',
  'connect_app',
  'ai_provider',
  'service_key',
  'phone_access',
] as const;
export type SetupTopic = (typeof SETUP_TOPICS)[number];

/** The Kavi Settings forms a guide can open, already filled in where the guide knows how. */
export type SetupSettingsSection =
  | 'ssh-edit'
  | 'expo-account-edit'
  | 'mcp-edit'
  | 'provider-edit'
  | 'service-keys';

/** The system pages a guide can open (Android). */
export type SetupSystemAccess = 'assistant_role' | 'notification_access';

export type SetupForm =
  | Readonly<{
      kind: 'settings';
      section: SetupSettingsSection;
      /** Values the form opens with; never a secret. */
      draft?: Readonly<Record<string, string | number>>;
    }>
  | Readonly<{ kind: 'system'; access: SetupSystemAccess }>;

export type SetupOption = Readonly<{
  id: string;
  name: string;
  /** What it costs, in the vendor's own terms. */
  cost: string;
  /** Honest trade-offs a beginner should know before choosing. */
  notes: string;
  url?: string;
}>;

export type SetupGuide = Readonly<{
  topic: SetupTopic;
  title: string;
  /** What Kavi can do for the person once this is set up. */
  unlocks: string;
  options?: ReadonlyArray<SetupOption>;
  /** The option these steps follow, when the guide has several. */
  optionId?: string;
  /** Plain-language steps a person can follow on a phone, one action each. */
  steps: ReadonlyArray<string>;
  /** What to enter in Kavi's form, field by field. */
  enterInKavi?: ReadonlyArray<Readonly<{ field: string; value: string }>>;
  form?: SetupForm;
  /** What Kavi does once the person says it is done: check it works, then carry on. */
  afterSetup: string;
  /** Things Kavi must or should do for the person's safety, in order. */
  safety?: ReadonlyArray<string>;
  sources: ReadonlyArray<string>;
  /** When these facts were last checked against the vendors' pages (YYYY-MM-DD). */
  verifiedOn: string;
}>;
