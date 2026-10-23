import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { XML_ENTITY_OPTIONS } from '@/lib/xmlLimits';

/**
 * FB2 → HTML на сервере (запасной путь чтения, см. lib/bookShared.ts).
 *
 * Зачем вообще. Основной формат — EPUB: Флибуста конвертирует его из fb2 на
 * лету, и его читает epub.js с точным CFI. Но конвертер иногда падает (битый
 * fb2, нестандартная разметка), а сама книга при этом цела. Тогда мы
 * распаковываем fb2+zip и собираем HTML сами — читать можно, пусть и без
 * постраничной навигации epub.js.
 *
 * Почему preserveOrder. FB2 — обычный XML, а текст в нём чередуется с
 * блоками (`<p>`, `<section>`, `<empty-line>`) в произвольном порядке.
 * fast-xml-parser без этой опции группирует одноимённые теги в массивы и
 * теряет порядок: абзац, стоявший после раздела, уехал бы перед ним. Поэтому
 * разбираем в упорядоченное дерево и обходим его так, как он лежит в файле.
 *
 * Чего здесь НЕТ: картинок. `binary`-секции FB2 хранят иллюстрации в base64,
 * и вытаскивать их в HTML — это уже полноценный конвертер, а не запасной
 * путь. Текст читается, картинок нет — так и написано в интерфейсе.
 */

export interface Fb2Chapter {
  /** Уровень вложенности раздела (0 — верхний). */
  depth: number;
  title: string;
  /** `#fb2-sec-N` — якорь на раздел в собранном HTML. */
  href: string;
}

export interface Fb2Book {
  title: string;
  author: string;
  annotation: string | null;
  html: string;
  chapters: Fb2Chapter[];
}

// ─────────────────────────── Разбор XML ───────────────────────────

type OrderedNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  // Порядок узлов и текст — как в файле (см. комментарий выше).
  preserveOrder: true,
  // Пустые теги (`<empty-line/>`) должны остаться узлами, а не превратиться
  // в пустую строку: иначе абзац-разделитель пропадёт.
  alwaysCreateTextNode: false,
  // Лимит раскрытий сущностей поднят — см. lib/xmlLimits.ts.
  processEntities: XML_ENTITY_OPTIONS,
});

/** Имя тега узла (у узла ровно один ключ, кроме служебного `:@`). */
function tagOf(node: OrderedNode): string | null {
  for (const key of Object.keys(node)) {
    if (key !== ':@') return key;
  }
  return null;
}

/** Дочерние узлы тега в исходном порядке. */
function childrenOf(node: OrderedNode): OrderedNode[] {
  const tag = tagOf(node);
  if (!tag) return [];
  const value = node[tag];
  return Array.isArray(value) ? (value as OrderedNode[]) : [];
}

/** Весь текст внутри узла (без вложенной разметки). */
function textOf(node: OrderedNode): string {
  const parts: string[] = [];
  const walk = (nodes: OrderedNode[]) => {
    for (const child of nodes) {
      const tag = tagOf(child);
      const text = child['#text'];
      if (typeof text === 'string') {
        parts.push(text);
        continue;
      }
      walk(childrenOf(child));
      // Абзацы заголовка — отдельные строки («Часть первая» / «ГЛАВА 1»).
      // Без разделителя они склеились бы в «Часть перваяГЛАВА 1», а пробел
      // внутри абзаца (между <emphasis> и текстом) трогать нельзя.
      if (tag === 'p' || tag === 'empty-line' || tag === 'subtitle') parts.push(' ');
    }
  };
  walk(childrenOf(node));
  return parts.join('').replace(/\s+/g, ' ').trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────── HTML ───────────────────────────

/**
 * Теги, которые превращаются в строчную разметку. Всё остальное с известным
 * именем — блочное: его дети рендерятся как обычно.
 */
function renderInline(tag: string, inner: string): string | null {
  switch (tag) {
    case 'emphasis':
      return `<em>${inner}</em>`;
    case 'strong':
      return `<strong>${inner}</strong>`;
    case 'strikethrough':
      return `<s>${inner}</s>`;
    case 'sub':
      return `<sub>${inner}</sub>`;
    case 'sup':
      return `<sup>${inner}</sup>`;
    case 'code':
      return `<code>${inner}</code>`;
    case 'a':
      // Внутренние ссылки FB2 ведут на сноски/примечания — оставляем текст,
      // саму ссылку не тащим: переход по ней в нашем HTML всё равно некуда.
      return `<span>${inner}</span>`;
    case 'image':
      return '';
    default:
      return null;
  }
}

interface RenderCtx {
  chapters: Fb2Chapter[];
  sectionSeq: number;
}

function renderNodes(nodes: OrderedNode[], ctx: RenderCtx, depth = 0): string {
  let out = '';
  for (const node of nodes) {
    const tag = tagOf(node);
    if (!tag) continue;

    if (tag === '#text') {
      const text = node['#text'];
      if (typeof text === 'string') out += escapeHtml(text);
      continue;
    }

    // Раздел обрабатываем до общего рендера детей: его дети лежат на уровень
    // глубже, и оглавлению нужен именно этот уровень.
    if (tag === 'section') {
      const id = `fb2-sec-${++ctx.sectionSeq}`;
      const titleNode = childrenOf(node).find((n) => tagOf(n) === 'title');
      const title = titleNode ? textOf(titleNode) : '';
      if (title) ctx.chapters.push({ depth, title, href: `#${id}` });
      out += `<section id="${id}" class="fb2-section">${renderNodes(
        childrenOf(node),
        ctx,
        depth + 1,
      )}</section>`;
      continue;
    }

    const inner = renderNodes(childrenOf(node), ctx, depth);

    const inline = renderInline(tag, inner);
    if (inline !== null) {
      out += inline;
      continue;
    }

    switch (tag) {
      case 'title': {
        // Внутри title обычно <p>, иногда <empty-line>. Заголовок уровня
        // раздела — h2, вложенного — тот же h2: визуально вложенность даёт
        // отступ section, а не размер шрифта.
        const plain = textOf(node);
        out += `<h2 class="fb2-title">${escapeHtml(plain)}</h2>`;
        break;
      }
      case 'subtitle':
        out += `<p class="fb2-subtitle">${inner}</p>`;
        break;
      case 'p':
        out += `<p>${inner}</p>`;
        break;
      case 'empty-line':
        out += '<p class="fb2-empty"><br/></p>';
        break;
      case 'epigraph':
        out += `<blockquote class="fb2-epigraph">${inner}</blockquote>`;
        break;
      case 'cite':
        out += `<blockquote class="fb2-cite">${inner}</blockquote>`;
        break;
      case 'poem':
        out += `<div class="fb2-poem">${inner}</div>`;
        break;
      case 'stanza':
        out += `<div class="fb2-stanza">${inner}</div>`;
        break;
      case 'v':
        out += `<p class="fb2-v">${inner}</p>`;
        break;
      case 'text-author':
        out += `<p class="fb2-text-author">${inner}</p>`;
        break;
      case 'table':
        out += `<table class="fb2-table">${inner}</table>`;
        break;
      case 'tr':
        out += `<tr>${inner}</tr>`;
        break;
      case 'td':
        out += `<td>${inner}</td>`;
        break;
      case 'th':
        out += `<th>${inner}</th>`;
        break;
      default:
        // Незнакомый блочный тег (стихи, сноски и т.п.) — отдаём содержимое,
        // чтобы текст не потерялся.
        out += inner;
        break;
    }
  }
  return out;
}

// ─────────────────────────── Публичный вход ───────────────────────────

/** Определяет кодировку по XML-декларации (чаще всего utf-8). */
function decodeXml(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const m = head.match(/encoding\s*=\s*["']([^"']+)["']/i);
  const encoding = (m?.[1] ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * Достаёт fb2 из архива или разбирает файл как есть. Возвращает null, если
 * внутри нет .fb2 или XML не разобрался — вызывающий покажет «не удалось
 * открыть».
 *
 * Почему не только zip. Флибуста отдаёт `/b/{id}/fb2` архивом, но зеркала и
 * прокси иногда разворачивают его в голый XML (а бывает и .fb2 без сжатия).
 * Принимаем оба вида: проверять расширение нам нечем, а первый байт `PK`
 * отличает zip от XML надёжно.
 */
export function parseFb2Zip(buffer: ArrayBuffer): Fb2Book | null {
  const bytes = new Uint8Array(buffer);
  let xml: string;

  if (bytes.length > 1 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes);
    } catch {
      return null;
    }

    const entry = Object.keys(files).find((name) => name.toLowerCase().endsWith('.fb2'));
    if (!entry) return null;
    xml = decodeXml(files[entry]);
  } else {
    // Голый XML. HTML-страница ошибки тоже декодируется, но FictionBook в
    // ней не найдётся — вернём null ниже.
    xml = decodeXml(bytes);
  }

  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch {
    return null;
  }
  if (!Array.isArray(doc)) return null;

  const root = (doc as OrderedNode[]).find((n) => tagOf(n) === 'FictionBook');
  if (!root) return null;

  const rootChildren = childrenOf(root);
  const description = rootChildren.find((n) => tagOf(n) === 'description');
  const titleInfo = description
    ? childrenOf(description).find((n) => tagOf(n) === 'title-info')
    : undefined;

  const title = titleInfo
    ? textOf(childrenOf(titleInfo).find((n) => tagOf(n) === 'book-title') ?? {})
    : '';

  const authors: string[] = [];
  if (titleInfo) {
    for (const author of childrenOf(titleInfo).filter((n) => tagOf(n) === 'author')) {
      const parts = ['first-name', 'middle-name', 'last-name']
        .map((field) => textOf(childrenOf(author).find((n) => tagOf(n) === field) ?? {}))
        .filter(Boolean);
      if (parts.length > 0) authors.push(parts.join(' '));
    }
  }

  const annotationNode = titleInfo
    ? childrenOf(titleInfo).find((n) => tagOf(n) === 'annotation')
    : undefined;

  // Тело: у FB2 их бывает несколько (основной текст + примечания). Примечания
  // (`name="notes"`) пропускаем — это сноски, их место в конце, а не в тексте.
  const bodies = rootChildren
    .filter((n) => tagOf(n) === 'body')
    .filter((n) => {
      const attrs = n[':@'] as Record<string, unknown> | undefined;
      return attrs?.['@_name'] !== 'notes';
    });

  // Оглавление собирается в том же проходе, что и HTML: id раздела известен
  // до того, как в него погружаются дети, поэтому заголовок сразу получает
  // правильный якорь.
  const ctx: RenderCtx = { chapters: [], sectionSeq: 0 };
  let html = '';
  for (const body of bodies) {
    html += `<div class="fb2-body">${renderNodes(childrenOf(body), ctx)}</div>`;
  }

  return {
    title: title || 'Без названия',
    author: authors.join(', ') || 'Автор неизвестен',
    annotation: annotationNode
      ? renderNodes(childrenOf(annotationNode), {
          chapters: [],
          // Счётчик разделов сдвинут, чтобы id в аннотации не совпали с
          // id основного текста. Аннотация рендерится отдельно и в
          // оглавление не входит.
          sectionSeq: 1_000_000,
        })
      : null,
    html,
    chapters: ctx.chapters,
  };
}
