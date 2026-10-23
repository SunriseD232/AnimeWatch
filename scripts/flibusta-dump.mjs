#!/usr/bin/env node
// Разбор SQL-дампов Флибусты (MySQL, extended INSERT) в TSV для COPY.
//
// Запускается из scripts/flibusta-import.sh: node scripts/flibusta-dump.mjs <каталог>
// В каталоге должны лежать lib.libbook.sql.gz, lib.libavtor.sql.gz,
// lib.libavtorname.sql.gz, lib.libgenre.sql.gz, lib.libgenrelist.sql.gz,
// lib.b.annotations.sql.gz. Рядом появляются book.tsv, avtor.tsv,
// avtorname.tsv, genre.tsv, genrelist.tsv, annot.tsv.
//
// Почему отдельный скрипт, а не крон-роут сайта: дампы — сотни мегабайт, а
// склейка авторов/жанров/аннотаций для 620 тыс. книг в памяти процесса сайта
// отъела бы её у плеера. Здесь всё потоково, а склеивает Postgres
// (scripts/flibusta-merge.sql).
//
// Что берём: только неудалённые книги (Deleted = '0') в FB2 и EPUB — их
// открывает наш читатель. PDF/DjVu/DOC пропускаем: на сайте их не прочитать.
// Аннотации — без тегов, до 600 символов: в БД только лёгкие метаданные.

import { createReadStream, createWriteStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { once } from 'node:events';

const DIR = process.argv[2];
if (!DIR) {
  console.error('usage: flibusta-dump.mjs <каталог с дампами>');
  process.exit(2);
}

const READABLE_TYPES = new Set(['fb2', 'epub']);
const ANNOTATION_LIMIT = 600;

/**
 * Кортежи из строк `INSERT INTO ... VALUES (...),(...);`. Строки в кавычках
 * с \-экранированием (mysqldump), NULL без кавычек → null. Скобки и запятые
 * внутри строк — часть значения, поэтому разбор посимвольный, а не регуляркой.
 */
async function* tuples(file) {
  const lines = createInterface({
    input: createReadStream(join(DIR, file)).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.startsWith('INSERT INTO')) continue;
    let i = line.indexOf(' VALUES ') + 8;
    const n = line.length;
    while (i < n) {
      if (line[i] !== '(') {
        i++;
        continue;
      }
      i++;
      const row = [];
      let cur = '';
      let quoted = false;
      let wasQuoted = false;
      while (i < n) {
        const c = line[i];
        if (quoted) {
          if (c === '\\') {
            const next = line[i + 1];
            cur += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next === '0' ? '' : next;
            i += 2;
            continue;
          }
          if (c === "'") quoted = false;
          else cur += c;
        } else if (c === "'") {
          quoted = true;
          wasQuoted = true;
        } else if (c === ',' || c === ')') {
          row.push(!wasQuoted && cur === 'NULL' ? null : cur);
          cur = '';
          wasQuoted = false;
          if (c === ')') {
            i++;
            break;
          }
        } else {
          cur += c;
        }
        i++;
      }
      yield row;
    }
  }
}

/** Значение для COPY в текстовом формате: \N — NULL, спецсимволы экранированы. */
function cell(value) {
  if (value === null || value === undefined) return '\\N';
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function writer(name) {
  const out = createWriteStream(join(DIR, name));
  let rows = 0;
  return {
    write(values) {
      rows++;
      return out.write(values.map(cell).join('\t') + '\n');
    },
    async close() {
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
      return rows;
    },
  };
}

/** Аннотация без HTML, с переносами абзацев, обрезанная по слову. */
function annotationText(html) {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return null;
  if (text.length <= ANNOTATION_LIMIT) return text;
  const cut = text.slice(0, ANNOTATION_LIMIT);
  const space = cut.lastIndexOf(' ');
  return `${(space > ANNOTATION_LIMIT * 0.7 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const started = Date.now();
const alive = new Set();

// libbook: BookId, FileSize, Time, Title, Title1, Lang, LangEx, SrcLang,
// FileType, Encoding, Year, Deleted, ...
{
  const out = writer('book.tsv');
  for await (const r of tuples('lib.libbook.sql.gz')) {
    if (r[11] !== '0') continue;
    const type = (r[8] ?? '').trim().toLowerCase();
    if (!READABLE_TYPES.has(type)) continue;
    const title = (r[3] ?? '').trim();
    if (!title) continue;
    const year = Number(r[10]);
    alive.add(r[0]);
    await out.write([r[0], title, (r[5] ?? '').trim() || null, type, year >= 1 && year <= 2100 ? year : null, Number(r[1]) || null]);
  }
  console.log(`book.tsv: ${await out.close()} книг`);
}

// libavtor: BookId, AvtorId, Pos
{
  const out = writer('avtor.tsv');
  for await (const r of tuples('lib.libavtor.sql.gz')) {
    if (alive.has(r[0])) await out.write([r[0], r[1], r[2]]);
  }
  console.log(`avtor.tsv: ${await out.close()}`);
}

// libavtorname: AvtorId, FirstName, MiddleName, LastName, NickName, ...
{
  const out = writer('avtorname.tsv');
  for await (const r of tuples('lib.libavtorname.sql.gz')) await out.write([r[0], r[1], r[2], r[3], r[4]]);
  console.log(`avtorname.tsv: ${await out.close()}`);
}

// libgenre: Id, BookId, GenreId
{
  const out = writer('genre.tsv');
  for await (const r of tuples('lib.libgenre.sql.gz')) {
    if (alive.has(r[1])) await out.write([r[1], r[2]]);
  }
  console.log(`genre.tsv: ${await out.close()}`);
}

// libgenrelist: GenreId, GenreCode, GenreDesc, GenreMeta. Описание — то же
// русское название жанра, что Флибуста отдаёт в OPDS (в book_index оно уже
// такое у книг из ночной витрины).
{
  const out = writer('genrelist.tsv');
  for await (const r of tuples('lib.libgenrelist.sql.gz')) await out.write([r[0], (r[2] ?? '').trim() || null]);
  console.log(`genrelist.tsv: ${await out.close()}`);
}

// libbannotations: BookId, nid, Title, Body
{
  const out = writer('annot.tsv');
  const done = new Set();
  for await (const r of tuples('lib.b.annotations.sql.gz')) {
    if (!alive.has(r[0]) || done.has(r[0])) continue;
    const text = annotationText(r[3]);
    if (!text) continue;
    done.add(r[0]);
    await out.write([r[0], text]);
  }
  console.log(`annot.tsv: ${await out.close()}`);
}

console.log(`готово за ${Math.round((Date.now() - started) / 1000)} сек`);
