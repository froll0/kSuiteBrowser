import { hydrateIcons } from '../../renderer/icons';
import type { ReaderArticle, Settings } from '../../shared/types';
import { internal } from '../shared/bridge';
import { sanitizeArticle } from './sanitize';

hydrateIcons();

const root = document.documentElement;
const original = new URLSearchParams(location.search).get('url') ?? '';
const $ = (id: string) => document.getElementById(id)!;
let settings: Settings;

// ---------- Typography ----------

function applyPrefs(s: Settings): void {
  settings = s;
  // "Come il browser" follows the browser theme.
  const browserDark = s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const theme = s.readerTheme === 'auto' ? (browserDark ? 'dark' : 'light') : s.readerTheme;
  root.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  root.classList.remove('t-light', 't-sepia', 't-dark', 'font-serif', 'font-sans', 'w-narrow', 'w-medium', 'w-wide');
  root.classList.add(`t-${theme}`, `font-${s.readerFont}`, `w-${s.readerWidth}`);
  root.style.setProperty('--r-size', `${s.readerFontSize}px`);
  $('size').textContent = String(s.readerFontSize);
  for (const b of document.querySelectorAll<HTMLElement>('[data-font]')) b.setAttribute('aria-checked', String(b.dataset.font === s.readerFont));
  for (const b of document.querySelectorAll<HTMLElement>('[data-theme-choice]')) b.setAttribute('aria-checked', String(b.dataset.themeChoice === s.readerTheme));
  for (const b of document.querySelectorAll<HTMLElement>('[data-width]')) b.setAttribute('aria-checked', String(b.dataset.width === s.readerWidth));
  $('ai').hidden = !s.aiEnabled;
}

const save = (patch: Partial<Settings>) => void internal.reader.prefs(patch).then(applyPrefs);
$('smaller').addEventListener('click', () => save({ readerFontSize: Math.max(14, settings.readerFontSize - 1) }));
$('bigger').addEventListener('click', () => save({ readerFontSize: Math.min(30, settings.readerFontSize + 1) }));
for (const b of document.querySelectorAll<HTMLElement>('[data-font]')) b.addEventListener('click', () => save({ readerFont: b.dataset.font as Settings['readerFont'] }));
for (const b of document.querySelectorAll<HTMLElement>('[data-theme-choice]')) b.addEventListener('click', () => save({ readerTheme: b.dataset.themeChoice as Settings['readerTheme'] }));
for (const b of document.querySelectorAll<HTMLElement>('[data-width]')) b.addEventListener('click', () => save({ readerWidth: b.dataset.width as Settings['readerWidth'] }));
$('exit').addEventListener('click', () => void internal.reader.exit());
$('ai').addEventListener('click', () => void internal.reader.askAi('summary'));
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) return;
  if (e.key === 'Escape' && speaking) stopSpeaking();
});

// ---------- Article ----------

function readingMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
}

function render(article: ReaderArticle): void {
  document.title = article.title;
  let host = '';
  try {
    host = new URL(article.url).hostname.replace(/^www\./, '');
  } catch {
    /* no host */
  }
  $('site').textContent = article.siteName || host;
  $('title').textContent = article.title;
  const content = $('content');
  content.replaceChildren(sanitizeArticle(article.content, article.url));
  // The title is shown above: drop a first heading repeating it.
  const first = content.querySelector('h2');
  if (first && first.textContent?.trim() === article.title.trim()) first.remove();
  // Same for a first paragraph that only repeats the author ("di Anna Rossi"), shown in the meta line.
  const norm = (s: string) => s.toLowerCase().replace(/^(di|by|von|par|de)\s+/, '').trim();
  const lead = content.querySelector('p');
  if (article.byline && lead && norm(lead.textContent ?? '') === norm(article.byline)) lead.remove();
  const article_ = $('ks-reader-article');
  if (article.lang) article_.setAttribute('lang', article.lang);
  if (article.dir) article_.setAttribute('dir', article.dir);
  const meta = [article.byline, formatDate(article.publishedTime), `${readingMinutes(content.textContent ?? '')} min di lettura`].filter(Boolean);
  $('meta').textContent = meta.join(' · ');
  setupSpeech(article.lang);
}

// ---------- Listen (text to speech) ----------

let speaking = false;

function stopSpeaking(): void {
  speaking = false;
  speechSynthesis.cancel();
  for (const el of document.querySelectorAll('.speaking')) el.classList.remove('speaking');
  const button = $('listen');
  button.lastElementChild!.textContent = 'Ascolta';
}

function setupSpeech(lang: string | null): void {
  if (!('speechSynthesis' in window)) return;
  const button = $('listen');
  const show = () => {
    if (speechSynthesis.getVoices().length > 0) button.hidden = false;
  };
  show();
  speechSynthesis.addEventListener('voiceschanged', show);
  button.addEventListener('click', () => {
    if (speaking) return stopSpeaking();
    const blocks = [$('title'), ...document.querySelectorAll<HTMLElement>('#content p, #content h2, #content h3, #content li, #content blockquote')]
      .filter((el) => (el.textContent ?? '').trim());
    const wanted = (lang || document.documentElement.lang || 'it').slice(0, 2).toLowerCase();
    const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(wanted)) ?? null;
    speaking = true;
    button.lastElementChild!.textContent = 'Ferma';
    let i = 0;
    const next = () => {
      for (const el of document.querySelectorAll('.speaking')) el.classList.remove('speaking');
      if (!speaking || i >= blocks.length) return stopSpeaking();
      const el = blocks[i++];
      el.classList.add('speaking');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const u = new SpeechSynthesisUtterance(el.textContent ?? '');
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? wanted;
      u.onend = next;
      u.onerror = next;
      speechSynthesis.speak(u);
    };
    next();
  });
  addEventListener('pagehide', () => speechSynthesis.cancel());
}

// ---------- Start ----------

void (async () => {
  applyPrefs(await internal.settings());
  internal.onSettings(applyPrefs);
  const article = original ? await internal.reader.article(original) : null;
  if (article) {
    render(article);
    return;
  }
  // Not in memory any more (e.g. after restarting the browser): back to the page.
  $('content').replaceChildren(Object.assign(document.createElement('p'), { className: 'missing', textContent: 'Caricamento della pagina originale…' }));
  if (/^https?:\/\//i.test(original)) location.replace(original);
})();
