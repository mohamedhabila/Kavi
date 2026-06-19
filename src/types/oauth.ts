export type OAuthProvider = 'google' | 'github' | 'openai' | 'anthropic';

export interface OAuthProfile {
  provider: OAuthProvider;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
  name?: string;
  avatarUrl?: string;
}
