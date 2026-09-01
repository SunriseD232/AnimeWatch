'use strict';

/**
 * Человекочитаемые подписи субтитров — общее для всех источников, что их
 * отдают (сейчас Videoseed и Alloha, см. videoseed-shared.js/alloha.js).
 * Код языка — 3-буквенный (rus/eng/...), как приходит из upstream (Alloha
 * отдаёт его прямо в поле track.language; Videoseed — только в имени файла
 * .vtt, см. subtitleLangFromUrl).
 */
const SUBTITLE_LABELS = {
  rus: 'Русский',
  eng: 'English',
  ukr: 'Українська',
  ger: 'Deutsch',
  fre: 'Français',
  spa: 'Español',
  ita: 'Italiano',
  chi: '中文',
  jpn: '日本語',
  kor: '한국어',
  tur: 'Türkçe',
  pol: 'Polski',
};

function subtitleLabel(lang) {
  return SUBTITLE_LABELS[lang.toLowerCase()] || lang.toUpperCase();
}

function subtitleLangFromUrl(url) {
  const match = url.match(/\/([a-zA-Z]{2,3})\.vtt(?:[?#]|$)/);
  return match ? match[1].toLowerCase() : null;
}

module.exports = { SUBTITLE_LABELS, subtitleLabel, subtitleLangFromUrl };
