import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { getKodikPlayerEnabled, setKodikPlayerEnabled } from '@/lib/settings';

/**
 * GET/POST /api/admin/kodik-player — живой рубильник вкладки «Kodik» в
 * переключателе плеера (см. lib/settings.ts, components/Player.tsx) для
 * components/KodikPlayerToggle.tsx в профиле. Только для админов — та же
 * проверка, что и у /api/admin/relay.
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
  const enabled = await getKodikPlayerEnabled(true);
  return NextResponse.json({ enabled });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 });
  }

  await setKodikPlayerEnabled(body.enabled);
  return NextResponse.json({ enabled: body.enabled });
}
