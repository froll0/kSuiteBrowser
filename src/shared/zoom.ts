/** Zoom levels offered by the browser, in percent (same steps as Chrome). */
export const ZOOM_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500] as const;

/** Next zoom step from the current percentage (which may be between steps, e.g. after pinch zoom). */
export function stepZoom(current: number, direction: 'in' | 'out'): number {
  if (direction === 'in') return ZOOM_STEPS.find((z) => z > current + 0.5) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 0.5) ?? ZOOM_STEPS[0];
}

/** Zoom that applies to a host: the user's choice for it, else the default. */
export function zoomFor(host: string, siteZoom: Record<string, number>, defaultZoom: number): number {
  return siteZoom[host.toLowerCase()] ?? defaultZoom;
}

/** New per-site map after the user picked `zoom` for `host`; choosing the default removes the entry. */
export function withSiteZoom(siteZoom: Record<string, number>, host: string, zoom: number, defaultZoom: number): Record<string, number> {
  const next = { ...siteZoom };
  if (zoom === defaultZoom) delete next[host.toLowerCase()];
  else next[host.toLowerCase()] = zoom;
  return next;
}
