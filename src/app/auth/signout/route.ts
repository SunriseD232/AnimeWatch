import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { absoluteUrl } from '@/lib/site-url';

export async function POST(request: NextRequest) {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(absoluteUrl('/', request.url), {
    status: 303,
  });
}
