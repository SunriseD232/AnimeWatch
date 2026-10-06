import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Тексты для кодов из join_watch_party (миграция 0048). */
const REASONS: Record<string, string> = {
  party_not_found: 'Такой комнаты нет: её закрыли или ссылка с ошибкой.',
  party_expired: 'Комната закрылась: ссылки на совместный просмотр живут сутки.',
  party_full: 'В комнате уже пять человек — больше не помещается.',
};

/**
 * Ссылка-приглашение в комнату совместного просмотра. Записывает человека в
 * участники (только после этого Realtime пустит его в канал комнаты) и
 * открывает страницу просмотра с ?party=<id> — оттуда комнату подхватывает
 * WatchPartyProvider. Анонима сюда не пустит общий гейт логина в middleware.
 */
export default async function PartyInvitePage({ params }: { params: { id: string } }) {
  const id = params.id;
  let reason = 'party_not_found';
  if (UUID_RE.test(id)) {
    const { data, error } = await createClient().rpc('join_watch_party', { p_party: id });
    const row = Array.isArray(data) ? data[0] : null;
    if (!error && row) {
      const target =
        row.content_type === 'cinema'
          ? `/cinema/watch/${row.shikimori_id}/${row.season}/${row.episode}`
          : `/watch/${row.shikimori_id}/${row.episode}`;
      redirect(`${target}?party=${id}`);
    }
    const known = Object.keys(REASONS).find((code) => error?.message.includes(code));
    if (known) reason = known;
  }

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-2xl font-semibold text-white">Не получилось войти в комнату</h1>
      <p className="text-gray-300">{REASONS[reason]}</p>
      <Link
        href="/"
        className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
      >
        На главную
      </Link>
    </div>
  );
}
