/**
 * Замер покрытия источников манги.
 *
 * Что делает:
 *   1. Берёт N тайтлов из manga_index (или встроенный сэмпл / JSON-файл).
 *   2. Для каждого ищет тайтл в MangaDex, MangaLib и SelfManga.
 *   3. Считает главы и бесплатные главы.
 *   4. Печатает таблицу и пишет scripts/coverage-report.json.
 *
 * Запуск:
 *   node scripts/measure-coverage.mjs
 *   node scripts/measure-coverage.mjs --limit=100
 *   node scripts/measure-coverage.mjs --titles=scripts/sample-titles.json
 *   node scripts/measure-coverage.mjs --no-db
 *
 * Ничего не пишет в БД. Только читает manga_index и внешние API.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const UA = 'MediaWatch/1.0 (+manga coverage; contact: site admin)';
const REQUEST_TIMEOUT_MS = 20_000;
const MATCH_THRESHOLD = 0.6;

// ─────────────────────────── CLI и env ───────────────────────────

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    const fullPath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(fullPath)) continue;

    const text = fs.readFileSync(fullPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const key = match[1];
      const value = match[2].trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

// ─────────────────────────── Утилиты ───────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeTitle(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleScore(candidates, targets) {
  const normTargets = targets.map(normalizeTitle).filter((t) => t.length >= 2);
  if (normTargets.length === 0) return 0;

  let best = 0;

  for (const candidate of candidates) {
    const name = normalizeTitle(candidate);
    if (!name) continue;

    for (const target of normTargets) {
      if (name === target) {
        best = Math.max(best, 0.95);
      } else if (name.includes(target) || target.includes(name)) {
        const shorter = Math.min(name.length, target.length);
        const longer = Math.max(name.length, target.length);
        best = Math.max(best, 0.55 + (shorter / longer) * 0.3);
      } else {
        const a = new Set(name.split(' '));
        const b = new Set(target.split(' '));
        let hits = 0;
        for (const token of a) if (token.length >= 2 && b.has(token)) hits += 1;
        if (hits > 0) {
          best = Math.max(best, 0.4 + (hits / Math.max(a.size, b.size)) * 0.3);
        }
      }
    }
  }

  return Math.min(1, best);
}

function retryDelayMs(attempt, response) {
  const retryAfter = Number(response?.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(15_000, retryAfter * 1000);
  }
  return Math.min(15_000, 1000 * 2 ** attempt);
}

async function fetchJson(url, headers = {}, spacingMs = 250, attempt = 0) {
  await sleep(spacingMs);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        ...headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await sleep(retryDelayMs(attempt, response));
      return fetchJson(url, headers, spacingMs, attempt + 1);
    }

    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, json: await response.json() };
  } catch (error) {
    if (attempt < 2) {
      await sleep(retryDelayMs(attempt, null));
      return fetchJson(url, headers, spacingMs, attempt + 1);
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchText(url, headers = {}, spacingMs = 350, attempt = 0) {
  await sleep(spacingMs);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
        ...headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await sleep(retryDelayMs(attempt, response));
      return fetchText(url, headers, spacingMs, attempt + 1);
    }

    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, text: await response.text() };
  } catch (error) {
    if (attempt < 2) {
      await sleep(retryDelayMs(attempt, null));
      return fetchText(url, headers, spacingMs, attempt + 1);
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// ─────────────────────────── MangaDex ───────────────────────────

const MANGADEX = 'https://api.mangadex.org';

function mangadexNames(attributes) {
  const names = [];
  const title = attributes?.title;
  if (title && typeof title === 'object') {
    for (const value of Object.values(title)) if (typeof value === 'string') names.push(value);
  }
  for (const alt of attributes?.altTitles ?? []) {
    if (alt && typeof alt === 'object') {
      for (const value of Object.values(alt)) if (typeof value === 'string') names.push(value);
    }
  }
  return names;
}

async function measureMangadex(titleKey) {
  const targets = [titleKey.title, ...(titleKey.altTitles ?? [])].filter(Boolean);
  let search = null;

  for (const query of targets) {
    const response = await fetchJson(
      `${MANGADEX}/manga?title=${encodeURIComponent(query)}&limit=10&includes[]=cover_art`,
    );
    if (!response.ok) continue;
    search = response.json;
    if ((search?.data ?? []).length > 0) break;
  }

  if (!search) return { matched: false, error: 'search failed' };

  let best = null;
  for (const item of search.data ?? []) {
    const attributes = item.attributes ?? {};
    let score = titleScore(mangadexNames(attributes), targets);
    if (score < MATCH_THRESHOLD) continue;

    if (attributes.year && titleKey.year && Math.abs(attributes.year - titleKey.year) <= 1) {
      score = Math.min(1, score + 0.05);
    }

    if (!best || score > best.score) best = { item, score };
  }

  if (!best) return { matched: false, confidence: 0 };

  const chapters = [];
  let pagesFailed = false;

  for (let offset = 0; offset < 6000; offset += 100) {
    const response = await fetchJson(
      `${MANGADEX}/chapter?manga=${encodeURIComponent(best.item.id)}` +
        `&translatedLanguage[]=ru&limit=100&offset=${offset}`,
    );
    if (!response.ok) {
      pagesFailed = true;
      break;
    }
    const data = response.json?.data ?? [];
    if (data.length === 0) break;

    for (const chapter of data) {
      const attributes = chapter.attributes ?? {};
      if (attributes.externalUrl) continue;
      if (!attributes.pages || attributes.pages <= 0) continue;
      const number = attributes.chapter ?? chapter.id;
      chapters.push({
        number: String(number),
        paid: false,
        pages: attributes.pages,
      });
    }

    if (data.length < 100) break;
  }

  const unique = uniqueBy(chapters, (chapter) => chapter.number);
  return {
    matched: true,
    confidence: best.score,
    externalId: best.item.id,
    chapters: unique.length,
    free: unique.length,
    ...(pagesFailed ? { error: 'chapters failed' } : {}),
  };
}

// ─────────────────────────── MangaLib ───────────────────────────

const MANGALIB = 'https://api.cdnlibs.org/api';
const MANGALIB_HEADERS = { Referer: 'https://mangalib.me/' };

async function measureMangalib(titleKey) {
  const targets = [titleKey.title, ...(titleKey.altTitles ?? [])].filter(Boolean);
  let best = null;

  for (const query of targets) {
    const response = await fetchJson(
      `${MANGALIB}/manga?q=${encodeURIComponent(query)}&page=1&limit=20&site_id[]=1`,
      MANGALIB_HEADERS,
      300,
    );
    if (!response.ok) continue;

    for (const item of response.json?.data ?? []) {
      const names = [item.rus_name, item.name, item.eng_name].filter(Boolean);
      let score = titleScore(names, targets);
      if (score < MATCH_THRESHOLD) continue;

      const year = Number(String(item.releaseDateString ?? '').match(/(19|20)\d{2}/)?.[0]);
      if (Number.isFinite(year) && titleKey.year && Math.abs(year - titleKey.year) <= 1) {
        score = Math.min(1, score + 0.05);
      }

      if (!best || score > best.score) best = { item, score };
    }

    if (best) break;
  }

  if (!best) return { matched: false, confidence: 0 };

  const slug = best.item.slug ?? best.item.slug_url;
  const response = await fetchJson(
    `${MANGALIB}/manga/${encodeURIComponent(slug)}/chapters?site_id[]=1`,
    MANGALIB_HEADERS,
    300,
  );
  if (!response.ok) {
    return { matched: true, confidence: best.score, chapters: 0, free: 0, error: 'chapters failed' };
  }

  const chapters = (response.json?.data ?? []).filter((chapter) => chapter.number);

  return {
    matched: true,
    confidence: best.score,
    externalId: slug,
    chapters: chapters.length,
    free: chapters.length,
  };
}

// ─────────────────────────── SelfManga ───────────────────────────

const SELFMANGA = 'https://1.selfmanga.live';
const SELFMANGA_HEADERS = { Referer: `${SELFMANGA}/` };

async function measureSelfmanga(titleKey) {
  const targets = [titleKey.title, ...(titleKey.altTitles ?? [])].filter(Boolean);
  let best = null;

  for (const query of targets) {
    const response = await fetchJson(
      `${SELFMANGA}/api/catalog/search?q=${encodeURIComponent(query)}&limit=50&offset=0`,
      SELFMANGA_HEADERS,
      350,
    );
    if (!response.ok) continue;

    for (const item of response.json?.list ?? []) {
      const element = item.elementId ?? {};
      const names = [item.name];
      let year = null;

      for (const entry of item.elements ?? []) {
        if (entry.typeName === 'another' && entry.name) names.push(entry.name);
        if (entry.typeName === 'year' && entry.name) year = Number(entry.name);
      }

      let score = titleScore(names, targets);
      if (score < MATCH_THRESHOLD) continue;

      if (year && titleKey.year && Math.abs(year - titleKey.year) <= 1) {
        score = Math.min(1, score + 0.05);
      }

      if (!best || score > best.score) best = { item, element, score };
    }

    if (best) break;
  }

  if (!best) return { matched: false, confidence: 0 };

  const slug = best.element.linkName;
  if (!slug) return { matched: true, confidence: best.score, chapters: 0, free: 0 };

  const page = await fetchText(`${SELFMANGA}/${encodeURIComponent(slug)}`, SELFMANGA_HEADERS, 350);
  if (!page.ok) {
    return { matched: true, confidence: best.score, chapters: 0, free: 0, error: 'title failed' };
  }

  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`href=["'](/${escaped}/vol(\\d+)/(\\d+))`, 'g');
  const links = uniqueBy(
    [...page.text.matchAll(regex)].map((match) => `${match[2]}/${match[3]}`),
    (key) => key,
  );

  return {
    matched: true,
    confidence: best.score,
    externalId: slug,
    chapters: links.length,
    free: links.length,
  };
}

// ─────────────────────────── Тайтлы ───────────────────────────

const SAMPLE_TITLES = [
  { title: 'Магическая битва', altTitles: ['Jujutsu Kaisen'], year: 2018 },
  { title: 'Соло Левелинг', altTitles: ['Solo Leveling', 'Na Honjaman Level Up'], year: 2018 },
  { title: 'Клинок, рассекающий демонов', altTitles: ['Kimetsu no Yaiba', 'Demon Slayer'], year: 2016 },
  { title: 'Ван Пис', altTitles: ['One Piece'], year: 1997 },
  { title: 'Атака титанов', altTitles: ['Shingeki no Kyojin', 'Attack on Titan'], year: 2009 },
  { title: 'Моя геройская академия', altTitles: ['Boku no Hero Academia', 'My Hero Academia'], year: 2014 },
  { title: 'Берсерк', altTitles: ['Berserk'], year: 1989 },
  { title: 'Тетрадь смерти', altTitles: ['Death Note'], year: 2003 },
  { title: 'Наруто', altTitles: ['Naruto'], year: 1999 },
  { title: 'Токийский гуль', altTitles: ['Tokyo Ghoul'], year: 2011 },
  { title: 'Стальной алхимик', altTitles: ['Fullmetal Alchemist', 'Hagane no Renkinjutsushi'], year: 2001 },
  { title: 'Блич', altTitles: ['Bleach'], year: 2001 },
  { title: 'Ванпанчмен', altTitles: ['One Punch Man', 'One Punch-Man'], year: 2012 },
  { title: 'Человек-бензопила', altTitles: ['Chainsaw Man'], year: 2018 },
  { title: 'Магистр дьявольского культа', altTitles: ['Mo Dao Zu Shi'], year: 2015 },
  { title: 'Поднятие уровня в одиночку', altTitles: ['Solo Leveling'], year: 2018 },
  { title: 'Реинкарнация безработного', altTitles: ['Mushoku Tensei'], year: 2014 },
  { title: 'О моём перерождении в слизь', altTitles: ['Tensei Shitara Slime Datta Ken'], year: 2013 },
  { title: 'Кайдзю №8', altTitles: ['Kaiju No. 8', 'Kaijuu 8-gou'], year: 2020 },
  { title: 'Фрирен', altTitles: ['Sousou no Frieren', 'Frieren'], year: 2020 },
];

function parseTitlesFile(filePath) {
  const fullPath = path.resolve(process.cwd(), filePath);
  const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('titles file must be an array');

  return raw
    .map((entry) => {
      if (typeof entry === 'string') return { title: entry, altTitles: [], year: null };
      const title = entry.title ?? entry.name ?? entry.rus_name;
      if (!title) return null;
      return {
        title,
        altTitles: Array.isArray(entry.altTitles)
          ? entry.altTitles
          : [entry.original_title, entry.alternative_title].filter(Boolean),
        year: Number(entry.year) || null,
      };
    })
    .filter(Boolean);
}

async function loadTitles(limit, titlesFile) {
  if (titlesFile) return parseTitlesFile(titlesFile);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (hasFlag('no-db') || !url || !key) {
    return SAMPLE_TITLES.slice(0, limit);
  }

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase
      .from('manga_index')
      .select('title_id, title, original_title, alternative_title, year, rank')
      .eq('in_catalog', true)
      .order('rank', { ascending: true, nullsFirst: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) throw new Error('manga_index is empty');

    return data.map((row) => ({
      title: String(row.title),
      altTitles: [row.original_title, row.alternative_title].filter(
        (value) => typeof value === 'string' && value.length > 0,
      ),
      year: row.year != null ? Number(row.year) : null,
    }));
  } catch (error) {
    console.warn(
      `[coverage] не удалось прочитать manga_index (${error.message}); беру сэмпл`,
    );
    return SAMPLE_TITLES.slice(0, limit);
  }
}

// ─────────────────────────── Отчёт ───────────────────────────

function summarize(rows, source) {
  const matched = rows.filter((row) => row[source]?.matched);
  const withChapters = matched.filter((row) => (row[source]?.chapters ?? 0) > 0);
  const chapters = withChapters.reduce((sum, row) => sum + (row[source]?.chapters ?? 0), 0);
  const free = withChapters.reduce((sum, row) => sum + (row[source]?.free ?? 0), 0);
  const failed = rows.filter((row) => row[source]?.error).length;

  return {
    matched: matched.length,
    withChapters: withChapters.length,
    chapters,
    free,
    failed,
    avgChapters: withChapters.length > 0 ? Math.round(chapters / withChapters.length) : 0,
    matchRate: rows.length > 0 ? Math.round((matched.length / rows.length) * 100) : 0,
  };
}

function pad(value, width) {
  return String(value).padEnd(width, ' ');
}

function printTable(rows, sources) {
  const widths = { title: Math.max(24, ...rows.map((row) => row.title.length)) };

  console.log('');
  console.log(
    pad('Тайтл', widths.title) +
      sources.map((source) => pad(source, 14)).join(''),
  );
  console.log('-'.repeat(widths.title + sources.length * 14));

  for (const row of rows) {
    const cells = sources.map((source) => {
      const result = row[source];
      if (!result) return pad('—', 14);
      if (!result.matched) return pad('нет', 14);
      if (result.error) return pad('ошибка', 14);
      return pad(`${result.chapters} гл.`, 14);
    });

    console.log(pad(row.title.slice(0, widths.title), widths.title) + cells.join(''));
  }
}

// ─────────────────────────── main ───────────────────────────

async function main() {
  loadEnv();

  const limit = Math.max(1, Number(readArg('limit', '200')) || 200);
  const titlesFile = readArg('titles', '');

  const titles = await loadTitles(limit, titlesFile);
  const sources = ['mangadex', 'mangalib', 'selfmanga'];

  console.log(`[coverage] тайтлов: ${titles.length}, источники: ${sources.join(', ')}`);

  const rows = [];

  for (let index = 0; index < titles.length; index += 1) {
    const titleKey = titles[index];
    const row = { title: titleKey.title, year: titleKey.year };

    const [mangadex, mangalib, selfmanga] = await Promise.all([
      measureMangadex(titleKey),
      measureMangalib(titleKey),
      measureSelfmanga(titleKey),
    ]);

    row.mangadex = mangadex;
    row.mangalib = mangalib;
    row.selfmanga = selfmanga;
    rows.push(row);

    if ((index + 1) % 10 === 0 || index === titles.length - 1) {
      console.log(`[coverage] обработано ${index + 1}/${titles.length}`);
    }
  }

  const summary = Object.fromEntries(
    sources.map((source) => [source, summarize(rows, source)]),
  );

  printTable(rows, sources);

  console.log('\nИтог:');
  for (const source of sources) {
    const value = summary[source];
    console.log(
      `  ${pad(source, 12)} совпало ${pad(value.matchRate + '%', 5)} ` +
        `с главами ${pad(value.withChapters, 4)} ` +
        `глав ${pad(value.chapters, 7)} ` +
        `среднее ${pad(value.avgChapters, 5)} ` +
        `ошибок ${value.failed}`,
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    limit,
    titlesCount: titles.length,
    sources,
    summary,
    titles: rows,
  };

  const outPath = path.resolve(process.cwd(), 'scripts/coverage-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nОтчёт: ${outPath}`);
}

main().catch((error) => {
  console.error('[coverage] упал:', error);
  process.exitCode = 1;
});
