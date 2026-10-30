import { createServiceClient } from '@/lib/supabase/service';
import { getAdminUserIds } from '@/lib/feedbackServer';
import { vlessDispatcher } from '@/lib/net/vlessProxy';

/**
 * Баланс OpenRouter — предоплатный: когда кредиты кончаются, модель
 * начинает отвечать HTTP 402, и крон рекомендаций молча пишет пустые
 * подборки (в логах PM2 это видно, на сайте — нет). Поэтому админам
 * приходит уведомление в колокольчик заранее, когда остаток падает ниже
 * OPENROUTER_LOW_BALANCE_USD, и ещё раз — когда деньги кончились совсем.
 *
 * Проверяется раз в сутки из крона рекомендаций (единственный потребитель
 * OpenRouter здесь), см. refreshRecommendations в lib/recommendationsEngine.ts.
 */

/** Порог «скоро кончатся». Один прогон крона стоит центы, так что доллара
 *  хватает на недели — успеть пополнить. */
export const OPENROUTER_LOW_BALANCE_USD = 1;

const CREDITS_URL = 'https://openrouter.ai/api/v1/credits';
const TOPUP_URL = 'https://openrouter.ai/settings/credits';

export interface OpenRouterBalance {
  totalCredits: number;
  totalUsage: number;
  remaining: number;
}

/** /api/v1/credits — куплено и потрачено по всему аккаунту (не только по
 *  этому ключу: тем же аккаунтом могут пользоваться и другие проекты, а
 *  кончаются деньги у всех разом). null — не удалось узнать. */
export async function fetchOpenRouterBalance(): Promise<OpenRouterBalance | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(CREDITS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      // Next кэширует fetch по умолчанию — без no-store баланс навсегда
      // остался бы тем, что пришёл первым запросом после деплоя.
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
      // openrouter.ai с этой VPS напрямую закрыт WAF — тот же туннель, что и
      // у запросов к модели (см. requestRecommendations).
      // @ts-expect-error -- dispatcher — опция undici, не входит в типы lib.dom fetch.
      dispatcher: vlessDispatcher(),
    });
    if (!res.ok) {
      console.error(`[openrouterBalance] /credits ответил HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { data?: { total_credits?: number; total_usage?: number } };
    const totalCredits = Number(json.data?.total_credits);
    const totalUsage = Number(json.data?.total_usage);
    if (!Number.isFinite(totalCredits) || !Number.isFinite(totalUsage)) return null;
    return { totalCredits, totalUsage, remaining: totalCredits - totalUsage };
  } catch (err) {
    console.error('[openrouterBalance] баланс не пришёл:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Уведомление всем ADMIN_EMAILS. Дедуп-ключ привязан к сумме купленных
 * кредитов: пока не пополнили, повторные прогоны крона ничего не создают
 * (unique(user_id, key)), а после пополнения сумма меняется — и следующее
 * «скоро кончатся» снова придёт. Если баланс узнать не удалось (402 пришёл,
 * а /credits молчит) — ключ по дате, не чаще раза в сутки.
 */
export async function notifyAdminsAboutOpenRouter(
  state: 'low' | 'empty',
  balance: OpenRouterBalance | null,
): Promise<void> {
  const adminIds = await getAdminUserIds();
  if (adminIds.length === 0) return;

  const keyPart = balance ? `credits-${balance.totalCredits}` : new Date().toISOString().slice(0, 10);
  const left = balance ? ` Осталось $${Math.max(balance.remaining, 0).toFixed(2)} из $${balance.totalCredits}.` : '';

  const title =
    state === 'empty' ? 'OpenRouter: деньги кончились' : 'OpenRouter: деньги скоро кончатся';
  const message =
    state === 'empty'
      ? `Модель отвечает отказом в оплате — рекомендации на главной перестали обновляться.${left} Пополнить баланс — по ссылке.`
      : `Баланс ниже $${OPENROUTER_LOW_BALANCE_USD}.${left} Когда он кончится, рекомендации на главной перестанут обновляться.`;

  const rows = adminIds.map((userId) => ({
    user_id: userId,
    key: `openrouter-${state}-${keyPart}`,
    title,
    message,
    href: TOPUP_URL,
  }));

  const { error } = await createServiceClient()
    .from('system_notifications')
    .upsert(rows, { onConflict: 'user_id,key', ignoreDuplicates: true });
  if (error) console.error('[openrouterBalance] уведомление не записалось:', error.message);
}

/** Суточная проверка: узнаёт баланс и при необходимости уведомляет. */
export async function checkOpenRouterBalance(): Promise<OpenRouterBalance | null> {
  const balance = await fetchOpenRouterBalance();
  if (!balance) return null;
  if (balance.remaining <= 0) await notifyAdminsAboutOpenRouter('empty', balance);
  else if (balance.remaining < OPENROUTER_LOW_BALANCE_USD) await notifyAdminsAboutOpenRouter('low', balance);
  return balance;
}
