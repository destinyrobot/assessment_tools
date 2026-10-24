/// <reference lib="deno.ns" />
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

/**
 * The service_role key is only ever read from the Edge Function environment.
 * It is never exposed to the browser bundle (Vite only inlines VITE_* vars).
 */
let cached: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (cached) return cached;
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured');
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'lifecourse-edge' } },
  });
  return cached;
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing required env: ${name}`);
  return value;
}