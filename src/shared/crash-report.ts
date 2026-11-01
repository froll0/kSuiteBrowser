/**
 * Crash reports, optional and anonymous. Velo keeps a short local list of what went wrong (which
 * process, why, versions) and never sends anything by itself: the user can open a GitHub issue that is
 * already filled in, read it, and decide to send it. No addresses, file paths, memory dumps or ids.
 */
export interface CrashEntry {
  at: number;
  /** main · renderer (a page) · gpu · utility · …, as Electron names the process. */
  process: string;
  /** crashed, oom, killed, abnormal-exit, launch-failed, integrity-failure, unclean-exit, exception… */
  reason: string;
  exitCode: number | null;
  /** For exceptions in the browser itself: the error's type and message, cleaned. */
  detail?: string;
  version: string;
  electron: string;
  os: string;
}

/** Removes what could identify the user or what they were doing: addresses, paths, e-mails, long ids. */
export function scrub(text: string): string {
  return String(text ?? '')
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'")]+/gi, '<url>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/(?:[A-Za-z]:)?(?:[\\/][^\s\\/'":]+){2,}[\\/]?/g, '<path>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<id>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

export const MAX_CRASHES = 30;

/** Keeps the most recent entries. */
export function addCrash(list: CrashEntry[], entry: CrashEntry): CrashEntry[] {
  const clean: CrashEntry = { ...entry, reason: scrub(entry.reason).slice(0, 40), process: scrub(entry.process).slice(0, 40), ...(entry.detail ? { detail: scrub(entry.detail) } : {}) };
  return [...list, clean].slice(-MAX_CRASHES);
}

/** The address of a new GitHub issue with the report, for the user to read and send. */
export function issueUrl(repo: { owner: string; repo: string }, entries: CrashEntry[]): string {
  const latest = entries.slice(-10);
  const lines = latest.map((e) => `- ${new Date(e.at).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${e.process} · ${e.reason}${e.exitCode !== null ? ` (${e.exitCode})` : ''}${e.detail ? ` · ${e.detail}` : ''}`);
  const first = latest[latest.length - 1];
  const body = [
    '<!-- Report created by Velo. It contains no addresses, files or personal data: check it before sending. -->',
    '**Arresti anomali / Crashes**',
    '',
    ...lines,
    '',
    `Velo ${first?.version ?? '?'} · Electron ${first?.electron ?? '?'} · ${first?.os ?? '?'}`,
    '',
    '**Cosa stavi facendo? / What were you doing?**',
    '',
  ].join('\n');
  const title = `Crash: ${first?.process ?? '?'} ${first?.reason ?? ''}`.trim();
  return `https://github.com/${repo.owner}/${repo.repo}/issues/new?labels=crash&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
