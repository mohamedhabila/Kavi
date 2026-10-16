// ---------------------------------------------------------------------------
// Kavi — Guided setup: what a guide says
// ---------------------------------------------------------------------------
// A guide holds only what cannot go stale because it is about Kavi: what setting it up
// unlocks, the Kavi form it ends at and what goes in it, the steps inside Kavi, and the
// safety rules. Everything about the vendor (plans, prices, limits, the steps on its site)
// comes from the vendor's own pages, read when the guide is asked for, so the person is
// walked through what the vendor offers today. Secrets are never typed into the chat: the
// person enters them in the Kavi form.

export const SETUP_TOPICS = [
  'app_building',
  'server',
  'connect_app',
  'ai_provider',
  'service_key',
  'phone_access',
  'phone_calls',
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

/** A vendor page a guide's facts come from, read when the guide is asked for. */
export type SetupPage = Readonly<{
  url: string;
  /** What the page is read for, e.g. "current plans and prices". */
  about: string;
  /** How much of the page to read; defaults to the first 5,000 characters. */
  maxChars?: number;
}>;

export type SetupOption = Readonly<{
  id: string;
  name: string;
  /** Why someone would pick it, in terms that do not change with a price list. */
  why: string;
  /** The pages with this option's current terms and steps. */
  pages?: ReadonlyArray<SetupPage>;
}>;

export type SetupGuide = Readonly<{
  topic: SetupTopic;
  title: string;
  /** What Kavi can do for the person once this is set up. */
  unlocks: string;
  options?: ReadonlyArray<SetupOption>;
  /** The option the person chose, when they have. */
  optionId?: string;
  /** Read live: the options' pages to compare them, or the chosen option's pages. */
  pages: ReadonlyArray<SetupPage>;
  /** The steps inside Kavi, exactly; the steps on the vendor's site come from its pages. */
  kaviSteps: ReadonlyArray<string>;
  /** What to enter in Kavi's form, field by field. */
  enterInKavi?: ReadonlyArray<Readonly<{ field: string; value: string }>>;
  form?: SetupForm;
  /** What Kavi does once the person says it is done: check it works, then carry on. */
  afterSetup: string;
  /** Things Kavi must or should do for the person's safety, in order. */
  safety?: ReadonlyArray<string>;
}>;

/** The pages a guide reads: the chosen option's own, else the overview of every option. */
export function guidePages(
  options: ReadonlyArray<SetupOption> | undefined,
  optionId: string | undefined,
  overview: ReadonlyArray<SetupPage>,
): ReadonlyArray<SetupPage> {
  const chosen = options?.find((option) => option.id === optionId);
  return chosen?.pages?.length ? chosen.pages : overview;
}
