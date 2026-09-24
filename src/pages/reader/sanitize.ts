/**
 * Rebuilds an article's HTML (it comes from the web page) keeping only reading elements:
 * no scripts, styles, forms, frames or event handlers, links only to web and mail addresses.
 * Parsing happens in an inert document (DOMParser), nothing from it is ever executed.
 */

const KEEP = new Set([
  'p', 'br', 'hr', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img', 'figure', 'figcaption', 'blockquote', 'q', 'cite', 'pre', 'code',
  'kbd', 'samp', 'em', 'i', 'strong', 'b', 'u', 's', 'del', 'ins', 'mark', 'small', 'sub', 'sup', 'abbr', 'time', 'ul', 'ol',
  'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'details', 'summary',
]);
/** Dropped with everything inside. */
const DROP = new Set([
  'script', 'style', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input',
  'button', 'select', 'textarea', 'option', 'svg', 'math', 'link', 'meta', 'base', 'canvas', 'video', 'audio', 'source',
  'track', 'map', 'area', 'dialog', 'portal', 'slot',
]);
const ATTRS: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  ol: ['start', 'reversed'],
  time: ['datetime'],
  abbr: ['title'],
  q: ['cite'],
  blockquote: ['cite'],
};

function safeUrl(value: string, kind: 'link' | 'image', base: string): string | null {
  try {
    const u = new URL(value.trim(), base);
    if (kind === 'link') return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : null;
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
    if (u.protocol === 'data:' && /^data:image\/(png|jpe?g|gif|webp|avif);/i.test(u.href)) return u.href;
    return null;
  } catch {
    return null;
  }
}

function copy(node: Node, out: Node, base: string, doc: Document): void {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.appendChild(doc.createTextNode(child.textContent ?? ''));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    let tag = el.tagName.toLowerCase();
    if (DROP.has(tag)) continue;
    if (tag === 'h1') tag = 'h2';
    if (!KEEP.has(tag)) {
      // Unknown wrappers (div, span, section…) keep their content.
      if (/^(div|section|article|main|header|footer|aside|center|picture|nav)$/.test(tag)) {
        const block = doc.createElement('div');
        copy(el, block, base, doc);
        if (block.childNodes.length) out.appendChild(block);
      } else {
        copy(el, out, base, doc);
      }
      continue;
    }
    const clean = doc.createElement(tag);
    for (const name of ATTRS[tag] ?? []) {
      const value = el.getAttribute(name);
      if (value === null) continue;
      if (name === 'href') {
        const url = safeUrl(value, 'link', base);
        if (url) clean.setAttribute('href', url);
      } else if (name === 'src' || name === 'cite') {
        const url = safeUrl(value, name === 'src' ? 'image' : 'link', base);
        if (url) clean.setAttribute(name, url);
      } else if (/^(width|height|colspan|rowspan|start)$/.test(name)) {
        if (/^\d{1,4}$/.test(value)) clean.setAttribute(name, value);
      } else {
        clean.setAttribute(name, value.slice(0, 500));
      }
    }
    for (const name of ['lang', 'dir']) {
      const value = el.getAttribute(name);
      if (value && /^[a-zA-Z-]{1,20}$/.test(value)) clean.setAttribute(name, value);
    }
    if (tag === 'img') {
      // Lazy-loading pages often keep the real image in data-src.
      if (!clean.hasAttribute('src')) {
        const lazy = el.getAttribute('data-src') ?? el.getAttribute('data-original') ?? el.getAttribute('data-lazy-src');
        const url = lazy ? safeUrl(lazy, 'image', base) : null;
        if (!url) continue;
        clean.setAttribute('src', url);
      }
      clean.setAttribute('loading', 'lazy');
      clean.setAttribute('decoding', 'async');
    }
    copy(el, clean, base, doc);
    out.appendChild(clean);
  }
}

export function sanitizeArticle(html: string, baseUrl: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const fragment = document.createDocumentFragment();
  copy(parsed.body, fragment, baseUrl, document);
  return fragment;
}
