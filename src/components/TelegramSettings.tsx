'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const LINK_ERROR_MESSAGES: Record<string, string> = {
  telegram_send_failed:
    'Не удалось отправить код — сначала напишите /start вашему боту в Telegram, затем попробуйте снова.',
  'invalid telegram_id': 'Некорректный Telegram ID',
};

export default function TelegramSettings() {
  const supabase = createClient();
  const [tgId, setTgId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const fetchLink = useCallback(async () => {
    const res = await fetch('/api/telegram/link');
    if (res.ok) {
      const data = await res.json();
      setTgId(data.telegram_id);
    }
  }, []);

  useEffect(() => {
    fetchLink();
  }, [fetchLink]);

  const startLink = async () => {
    setLoading(true);
    setMessage(null);
    setAwaitingCode(false);
    try {
      const res = await fetch('/api/telegram/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_id: input }),
      });
      if (res.ok) {
        setAwaitingCode(true);
        setMessage({ type: 'ok', text: 'Код отправлен вам в Telegram — введите его ниже.' });
      } else {
        const err = await res.json();
        setMessage({ type: 'error', text: LINK_ERROR_MESSAGES[err.error] ?? err.error ?? 'Ошибка' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Сетевая ошибка' });
    } finally {
      setLoading(false);
    }
  };

  const confirmLink = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/telegram/link', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_id: input, code: codeInput }),
      });
      if (res.ok) {
        setMessage({ type: 'ok', text: 'Telegram привязан!' });
        setTgId(input);
        setAwaitingCode(false);
        setInput('');
        setCodeInput('');
      } else {
        const err = await res.json();
        setMessage({ type: 'error', text: err.error || 'Ошибка' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Сетевая ошибка' });
    } finally {
      setLoading(false);
    }
  };

  const unlink = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await fetch('/api/telegram/link', { method: 'DELETE' });
      setTgId(null);
      setMessage({ type: 'ok', text: 'Привязка удалена' });
    } catch {
      setMessage({ type: 'error', text: 'Сетевая ошибка' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Telegram</h2>

      {tgId ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-400">
            Привязан Telegram ID: <code className="rounded bg-black/30 px-1">{tgId}</code>
          </p>
          <p className="text-xs text-gray-500">
            На странице просмотра появится кнопка «Скачать в Telegram».
          </p>
          <button
            type="button"
            onClick={unlink}
            disabled={loading}
            className="self-start rounded-lg border border-red-900/40 bg-red-950/30 px-4 py-2 text-sm font-medium text-red-300 transition hover:bg-red-950/60"
          >
            Отвязать
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-400">
            Привяжите Telegram ID, чтобы скачивать видео на телефон.
            ID можно узнать у бота{' '}
            <code className="rounded bg-black/30 px-1">@userinfobot</code>.
          </p>

          {!awaitingCode ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Ваш Telegram ID (число)"
                value={input}
                onChange={(e) => setInput(e.target.value.replace(/\D/g, ''))}
                className="w-48 rounded-lg border border-white/10 bg-bg-card px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={startLink}
                disabled={loading || !input}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
              >
                {loading ? '…' : 'Привязать'}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Код подтверждения"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                className="w-36 rounded-lg border border-white/10 bg-bg-card px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={confirmLink}
                disabled={loading || !codeInput}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
              >
                {loading ? '…' : 'Подтвердить'}
              </button>
            </div>
          )}

          {message && (
            <p
              className={`text-sm ${
                message.type === 'ok' ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {message.text}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
