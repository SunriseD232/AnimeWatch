import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { getVpsRelayEnabled, setVpsRelayEnabled } from '@/lib/settings';

/**
 * GET/POST /api/admin/relay — живой рубильник relay через VPS (см.
 * lib/settings.ts, lib/extract/proxy.ts) для components/RelayToggle.tsx в
 * профиле. Только для админов (см. lib/admin.ts) — та же проверка, что и у
 * остальных внутренних админ-разделов (/code и т.п.).
 */

async function requireAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return isAdminEmail(user?.email) ? user : null;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const enabled = await getVpsRelayEnabled();
  return NextResponse.json({ enabled });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 });
  }

  await setVpsRelayEnabled(body.enabled);
  return NextResponse.json({ enabled: body.enabled });
}
