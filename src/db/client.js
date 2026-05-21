import { createClient } from '@supabase/supabase-js';
import { env } from '../utils/config.js';

// Supabase JS handles its own connection pooling against PostgREST.
// We export a singleton so every query helper shares it.
export const supabase = createClient(env.supabase.url, env.supabase.key, {
  auth: { persistSession: false },
});
