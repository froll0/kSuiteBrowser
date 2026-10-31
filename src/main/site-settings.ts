import type { Session } from 'electron';
import { siteOf } from '../shared/privacy-rules';
import { cookieBelongsTo } from '../shared/forget-sites';
import { permissionLabel } from '../shared/external-protocols';
import { ASKABLE_PERMISSIONS } from '../shared/settings-schema';
import type { SettingsStore } from './settings';
import type { SiteSettingsInfo, SiteSettingsPatch } from '../shared/types';

/** Hostname typed or passed to velo://site/ ("Example.com", "https://example.com/x" → "example.com"). */
export function normalizeSiteHost(input: string): string | null {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return null;
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`).hostname;
    return /^[a-z0-9.-]+$/.test(host) && (host.includes('.') || host === 'localhost') ? host : null;
  } catch {
    return null;
  }
}

/** Everything Velo remembers about a site, for velo://site/. */
export async function siteSettingsInfo(settings: SettingsStore, session: Session, host: string): Promise<SiteSettingsInfo> {
  const s = settings.get();
  const site = siteOf(`https://${host}/`) ?? host;
  const saved = s.sitePermissions.filter((p) => p.host === host);
  const names = [...new Set([...ASKABLE_PERMISSIONS, ...saved.map((p) => p.permission)])];
  const permissions = names.map((permission) => {
    const remembered = saved.find((p) => p.permission === permission);
    const fallback: 'ask' | 'block' = (ASKABLE_PERMISSIONS as readonly string[]).includes(permission) && s.permissionDefaults[permission as keyof typeof s.permissionDefaults] === 'block' ? 'block' : 'ask';
    return {
      permission,
      label: permissionLabel(permission),
      state: remembered ? (remembered.allowed ? 'allow' : 'block') : 'default',
      fallback,
    } as SiteSettingsInfo['permissions'][number];
  });
  const cookies = (await session.cookies.get({})).filter((c) => c.domain && cookieBelongsTo(c.domain, site));
  return {
    host,
    site,
    permissions,
    zoom: s.siteZoom[host] ?? null,
    defaultZoom: s.defaultZoom,
    protectionOff: s.protectionExceptions.includes(site),
    httpAllowed: s.httpExceptions.includes(host),
    remembered: s.rememberedSites.includes(site),
    forgetSitesOnClose: s.forgetSitesOnClose,
    cookies: cookies.length,
  };
}

const toggled = (list: string[], item: string, on: boolean) => (on ? [...new Set([...list, item])] : list.filter((x) => x !== item));

export function applySiteSettings(settings: SettingsStore, host: string, patch: SiteSettingsPatch): void {
  const s = settings.get();
  const site = siteOf(`https://${host}/`) ?? host;
  const next: Parameters<SettingsStore['update']>[0] = {};
  if (patch.permission && typeof patch.permission.name === 'string') {
    const { name, state } = patch.permission;
    const others = s.sitePermissions.filter((p) => !(p.host === host && p.permission === name));
    next.sitePermissions = state === 'default' ? others : [...others, { host, permission: name, allowed: state === 'allow' }];
  }
  if (patch.zoom !== undefined) {
    const zoom = { ...s.siteZoom };
    if (patch.zoom === null) delete zoom[host];
    else zoom[host] = patch.zoom;
    next.siteZoom = zoom;
  }
  if (typeof patch.protectionOff === 'boolean') next.protectionExceptions = toggled(s.protectionExceptions, site, patch.protectionOff);
  if (typeof patch.httpAllowed === 'boolean') next.httpExceptions = toggled(s.httpExceptions, host, patch.httpAllowed);
  if (typeof patch.remembered === 'boolean') next.rememberedSites = toggled(s.rememberedSites, site, patch.remembered);
  if (Object.keys(next).length) settings.update(next);
}

/** Deletes the cookies of the site (and its subdomains) and the storage of its main origins. */
export async function clearSiteData(session: Session, host: string): Promise<void> {
  const site = siteOf(`https://${host}/`) ?? host;
  const cookies = (await session.cookies.get({})).filter((c) => c.domain && cookieBelongsTo(c.domain, site));
  await Promise.all(cookies.map((c) => session.cookies.remove(`${c.secure ? 'https' : 'http'}://${(c.domain ?? '').replace(/^\./, '')}${c.path ?? '/'}`, c.name)));
  const hosts = new Set([host, site, `www.${site}`]);
  await Promise.all([...hosts].flatMap((h) => [`https://${h}`, `http://${h}`]).map((origin) => session.clearStorageData({ origin })));
}
