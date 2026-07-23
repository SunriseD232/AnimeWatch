import { VIBIX_TRIAL_END, daysUntilVibixTrialEnd } from '@/lib/vibixTrial';

const DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * Только для админов (см. lib/admin.ts) — статус пробного периода Vibix,
 * основного плеера кино с точным трекингом позиции (ARCHITECTURE.md §7).
 * Началось 17.07.2026 на 3 месяца — нужно вручную продлевать/переподключать
 * до истечения. Уведомления в колокольчик на тех же датах — см.
 * lib/vibixTrial.ts и api/cron/check-episodes.
 */
export default function VibixTrialStatus() {
  const daysLeft = daysUntilVibixTrialEnd();
  const expired = daysLeft < 0;

  return (
    <div
      className={[
        'rounded-2xl border p-4 text-sm',
        expired
          ? 'border-red-900/40 bg-red-950/30 text-red-200'
          : 'border-amber-900/40 bg-amber-950/20 text-amber-200',
      ].join(' ')}
    >
      <p className="font-semibold">Пробный период Vibix</p>
      <p className="mt-1 text-gray-300">
        {expired
          ? `Истёк ${DATE_FORMAT.format(VIBIX_TRIAL_END)} — нужно переподключать Vibix вручную.`
          : `Истекает ${DATE_FORMAT.format(VIBIX_TRIAL_END)} — осталось ${daysLeft} дн. Через 3 месяца после старта (17.07.2026) нужно подключать снова.`}
      </p>
    </div>
  );
}
