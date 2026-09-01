import { DEFAULT_THEME, THEME_STORAGE_KEY, BG_PRESETS } from '@/lib/theme';

/**
 * Синхронный скрипт в <head> — применяет сохранённую тему ДО первой
 * отрисовки. Без него каждая загрузка страницы у пользователя с непустой
 * темой давала бы кадр стандартной синей палитры с последующей перекраской
 * (классический FOUC), причём тем заметнее, чем медленнее устройство.
 *
 * Отсюда же и ограничения на код внутри: он инлайнится строкой и исполняется
 * до React, поэтому не может импортировать lib/theme.ts — логика перевода
 * hex → каналы и осветления hover продублирована в компактном виде. Дубль
 * сознательный и намеренно крошечный; общий источник правды на значения
 * (дефолт и пресеты фона) всё же передаётся сюда из lib/theme.ts через
 * сериализацию ниже, чтобы палитры не разъезжались.
 *
 * Скрипт обязан быть максимально устойчивым: любое исключение здесь
 * заблокировало бы отрисовку страницы, поэтому всё тело в try/catch, а любой
 * сбой означает просто дефолтную палитру из globals.css.
 */
export default function ThemeScript() {
  const palettes = Object.fromEntries(
    BG_PRESETS.map((p) => [p.id, [p.bg, p.soft, p.card]]),
  );

  const code = `
(function () {
  try {
    var raw = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if (!raw) return;
    var t = JSON.parse(raw);
    var PAL = ${JSON.stringify(palettes)};
    var hex = /^#[0-9a-f]{6}$/i.test(t && t.accent) ? t.accent : ${JSON.stringify(DEFAULT_THEME.accent)};
    var pal = PAL[t && t.palette] || PAL[${JSON.stringify(DEFAULT_THEME.palette)}];
    var ch = function (h) {
      var n = parseInt(h.slice(1), 16);
      return ((n >> 16) & 255) + ' ' + ((n >> 8) & 255) + ' ' + (n & 255);
    };
    var lighten = function (h) {
      var n = parseInt(h.slice(1), 16);
      var m = function (c) { return Math.round(c + (255 - c) * 0.22); };
      return m((n >> 16) & 255) + ' ' + m((n >> 8) & 255) + ' ' + m(n & 255);
    };
    var s = document.documentElement.style;
    s.setProperty('--accent', ch(hex));
    s.setProperty('--accent-hover', lighten(hex));
    s.setProperty('--bg', ch(pal[0]));
    s.setProperty('--bg-soft', ch(pal[1]));
    s.setProperty('--bg-card', ch(pal[2]));
  } catch (e) {}
})();
`;

  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
