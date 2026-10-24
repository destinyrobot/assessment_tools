/**
 * Supabase client configuration.
 *
 * SECURITY: only PUBLIC project values may appear here.
 * `VITE_SUPABASE_PUBLISHABLE_KEY` is the new-style publishable key (or the
 * legacy `anon` key). The `service_role` / secret key must NEVER be placed in
 * any `VITE_*` variable — everything privileged runs inside Edge Functions.
 */

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const publishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  ''
).trim();

export const SUPABASE_URL = url;
export const SUPABASE_PUBLISHABLE_KEY = publishableKey;

/** True when both required public values are present. */
export const isSupabaseConfigured = (): boolean =>
  SUPABASE_URL.startsWith('http') && SUPABASE_PUBLISHABLE_KEY.length > 20;

export const functionsBaseUrl = (): string =>
  `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1`;

export interface PublicEnvShape {
  url: string;
  publishableKey: string;
}

export function describeEnv(): PublicEnvShape {
  return { url: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY };
}