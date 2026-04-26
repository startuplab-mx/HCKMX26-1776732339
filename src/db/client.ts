import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type SupabaseClientState = {
  client: SupabaseClient | null;
  reason?: string;
};

let cachedState: SupabaseClientState | null = null;

export const getSupabaseClient = (): SupabaseClientState => {
  if (cachedState) {
    return cachedState;
  }

  const supabaseUrl = Bun.env.SUPABASE_URL;
  const supabaseAnonKey = Bun.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    cachedState = {
      client: null,
      reason: 'SUPABASE_URL or SUPABASE_ANON_KEY not configured',
    };
    return cachedState;
  }

  cachedState = {
    client: createClient(supabaseUrl, supabaseAnonKey),
  };
  return cachedState;
};
