import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY обязательны');
  process.exit(1);
}

export function createServiceClient() {
  return createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type DownloadTask = {
  id: string;
  user_id: string;
  tg_id: string;
  content_type: 'anime' | 'cinema';
  shikimori_id: number;
  anime_title: string;
  poster_url: string | null;
  season: number;
  episode: number;
  source: 'anilibria' | 'alloha' | 'videoseed' | null;
  video_url: string | null;
  status: string;
  error: string | null;
  retry_count: number;
  created_at: string;
  started_at: string | null;
};
