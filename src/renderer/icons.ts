import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bell, Bookmark, BookOpen, BookUser, Headphones, Square, Type, Calculator, Calendar, CalendarClock, CaseSensitive, ChevronDown,
  ChevronRight, ChevronUp, CircleAlert, CircleCheck, Clock, Cloud, Copy, Download, EllipsisVertical, ExternalLink, Eye, EyeOff,
  File, FileArchive, FileAudio, FileCode, FileSpreadsheet, FileText, FileVideo, Folder, FolderOpen, Globe, History, Image,
  Inbox, Info, KeyRound, LayoutGrid, Lock, Mail, MapPin, MessagesSquare, Monitor, Moon, PanelRight, Pencil, Pin, Plus,
  RefreshCw, RotateCw, Search, Send, Settings, Shield, ShieldCheck, ShieldOff, Sparkles, Star, Sun, TriangleAlert, Trash2,
  Upload, User, Video, Volume2, VolumeX, X, House, PanelLeft, PanelLeftClose, PanelLeftOpen, Palette, GripVertical, createElement, type IconNode,
} from 'lucide';

/** Icons used by the browser UI and the internal pages (Lucide, ISC license). */
export const ICONS = {
  arrowDown: ArrowDown, arrowLeft: ArrowLeft, arrowRight: ArrowRight, arrowUp: ArrowUp, bell: Bell, bookmark: Bookmark,
  bookOpen: BookOpen, bookUser: BookUser, headphones: Headphones, stop: Square, type: Type, calculator: Calculator, calendar: Calendar, calendarClock: CalendarClock, caseSensitive: CaseSensitive, chevronDown: ChevronDown,
  chevronRight: ChevronRight, chevronUp: ChevronUp, alert: CircleAlert, check: CircleCheck, clock: Clock, cloud: Cloud,
  copy: Copy, download: Download, more: EllipsisVertical, external: ExternalLink, eye: Eye, eyeOff: EyeOff, file: File,
  fileArchive: FileArchive, fileAudio: FileAudio, fileCode: FileCode, fileSheet: FileSpreadsheet, fileText: FileText,
  fileVideo: FileVideo, folder: Folder, folderOpen: FolderOpen, globe: Globe, history: History, image: Image, inbox: Inbox,
  info: Info, key: KeyRound, grid: LayoutGrid, lock: Lock, mail: Mail, mapPin: MapPin, chat: MessagesSquare,
  monitor: Monitor, moon: Moon, panel: PanelRight, pencil: Pencil, pin: Pin, plus: Plus, refresh: RefreshCw,
  reload: RotateCw, search: Search, send: Send, settings: Settings, shield: Shield, shieldCheck: ShieldCheck,
  shieldOff: ShieldOff, sparkles: Sparkles, star: Star, sun: Sun, warning: TriangleAlert, trash: Trash2, upload: Upload,
  user: User, video: Video, volume: Volume2, volumeOff: VolumeX, close: X, home: House, panelLeft: PanelLeft,
  panelLeftClose: PanelLeftClose, panelLeftOpen: PanelLeftOpen, palette: Palette, grip: GripVertical,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

/** An SVG icon element; decorative (aria-hidden) since buttons carry their own label. */
export function icon(name: IconName, size = 18, className = ''): SVGElement {
  const el = createElement(ICONS[name], {
    width: size,
    height: size,
    'stroke-width': size <= 16 ? 2 : 1.75,
    'aria-hidden': 'true',
    focusable: 'false',
    class: `i i-${name}${className ? ` ${className}` : ''}`,
  });
  return el;
}

/** Icon for a kDrive item, from its type and name. */
export function fileIcon(file: { type: string; name: string; mimeType?: string | null }): IconName {
  if (file.type === 'dir') return 'folder';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = file.mimeType ?? '';
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(ext)) return 'image';
  if (mime.startsWith('video/') || ['mp4', 'mov', 'mkv', 'webm', 'avi'].includes(ext)) return 'fileVideo';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'flac', 'ogg', 'm4a'].includes(ext)) return 'fileAudio';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'fileArchive';
  if (['xls', 'xlsx', 'csv', 'ods', 'numbers'].includes(ext)) return 'fileSheet';
  if (['js', 'ts', 'json', 'html', 'css', 'py', 'java', 'c', 'cpp', 'sh', 'xml', 'yml', 'yaml'].includes(ext)) return 'fileCode';
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'odt', 'rtf', 'pages'].includes(ext)) return 'fileText';
  return 'file';
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The kSuite Browser mark (a "k" on the brand gradient), used for internal pages. */
export function logoMark(size = 16): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'logo-mark');
  const id = `lg${Math.random().toString(36).slice(2, 8)}`;
  svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34a8ff"/><stop offset="1" stop-color="#3b55f0"/></linearGradient></defs>
<rect width="64" height="64" rx="16" fill="url(#${id})"/>
<path d="M24 16v32M42 25 25.5 38M31 33.5 43 48" fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  return svg;
}

/** Replaces <… data-icon="name" data-size="16"> placeholders in static markup with SVG icons. */
export function hydrateIcons(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    const name = el.dataset.icon as IconName;
    if (!(name in ICONS) || el.querySelector(':scope > svg.i')) continue;
    el.prepend(icon(name, Number(el.dataset.size) || 18));
  }
}
