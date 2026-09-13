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
      var m = function (c) { return Math.round(c + (255 - c) * 0.14); };
      return m((n >> 16) & 255) + ' ' + m((n >> 8) & 255) + ' ' + m(n & 255);
    };
    // Текст поверх заливки акцентом — тёмный или белый, см. accentForeground
    // в lib/theme.ts (там же расчёт и порог 0.189).
    var fg = function (h) {
      var n = parseInt(h.slice(1), 16);
      var c = function (v) {
        v = v / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      var l = 0.2126 * c((n >> 16) & 255) + 0.7152 * c((n >> 8) & 255) + 0.0722 * c(n & 255);
      return l > 0.189 ? '11 11 15' : '255 255 255';
    };
    // Акцент для текста на тёмных поверхностях — см. accentText в lib/theme.ts
    // (порог 4.6:1 против подложки акцентом 15% поверх карточки палитры).
    var lum = function (h) {
      var n = parseInt(h.slice(1), 16);
      var c = function (v) {
        v = v / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * c((n >> 16) & 255) + 0.7152 * c((n >> 8) & 255) + 0.0722 * c(n & 255);
    };
    var toHex = function (r, g, b) {
      return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
    };
    var text = function (h, card) {
      var a = parseInt(h.slice(1), 16), k = parseInt(card.slice(1), 16);
      var mx = function (sh) { return Math.round(((k >> sh) & 255) + ((((a >> sh) & 255) - ((k >> sh) & 255)) * 0.15)); };
      var surface = lum(toHex(mx(16), mx(8), mx(0)));
      for (var step = 0; step <= 20; step++) {
        var t2 = step * 0.05;
        var up = function (sh) { var v = (a >> sh) & 255; return Math.round(v + (255 - v) * t2); };
        var cand = toHex(up(16), up(8), up(0));
        var l = lum(cand);
        var ratio = (Math.max(l, surface) + 0.05) / (Math.min(l, surface) + 0.05);
        if (ratio >= 4.6) return ch(cand);
      }
      return '255 255 255';
    };
    var s = document.documentElement.style;
    s.setProperty('--accent', ch(hex));
    s.setProperty('--accent-hover', lighten(hex));
    s.setProperty('--accent-fg', fg(hex));
    s.setProperty('--accent-text', text(hex, pal[2]));
    s.setProperty('--bg', ch(pal[0]));
    s.setProperty('--bg-soft', ch(pal[1]));
    s.setProperty('--bg-card', ch(pal[2]));
  } catch (e) {}
})();
`;

  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
