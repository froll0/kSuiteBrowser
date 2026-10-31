import type { ShieldConfig } from './fingerprint';

/**
 * Fingerprinting protection inside Web Workers (dedicated and shared), which page preloads never reach.
 * Run by the main process in each worker before its own code (see main/worker-shield.ts), with the same
 * key as the page: the same noise for the same site. Serialized, so it may only use what is inside it.
 */
export function installWorkerShield(config: ShieldConfig): void {
  if (config.mode === 'off') return;
  const g = globalThis as unknown as Record<string, any>;
  const strict = config.mode === 'strict';

  const disguised = new WeakMap<object, Function>();
  const wrap = (target: Record<string, any> | undefined, key: string, make: (original: Function) => Function) => {
    const desc = target && Object.getOwnPropertyDescriptor(target, key);
    if (!desc || typeof desc.value !== 'function') return;
    const original = desc.value as Function;
    const impl = make(original);
    const proxy = new Proxy(original, { apply: (_t, self, args) => impl.apply(self, args) });
    disguised.set(proxy, original);
    Object.defineProperty(target, key, { ...desc, value: proxy });
  };
  const getter = (target: Record<string, any> | undefined, key: string, value: () => unknown) => {
    const desc = target && Object.getOwnPropertyDescriptor(target, key);
    if (!desc?.get) return;
    const proxy = new Proxy(desc.get, { apply: () => value() });
    disguised.set(proxy, desc.get);
    Object.defineProperty(target, key, { ...desc, get: proxy });
  };
  const nativeToString = Function.prototype.toString;
  wrap(Function.prototype, 'toString', () => function (this: unknown) {
    return nativeToString.call(disguised.get(this as object) ?? this);
  });

  const hash = (...n: number[]) => {
    let h = config.seed >>> 0;
    for (const x of n) {
      h = Math.imul(h ^ (x | 0), 0x9e3779b1);
      h ^= h >>> 15;
      h = Math.imul(h, 0x85ebca77);
      h ^= h >>> 13;
    }
    return h >>> 0;
  };
  const farble = (data: Uint8ClampedArray | Uint8Array, width: number, height: number, x0 = 0, y0 = 0) => {
    if (strict) return void data.fill(0);
    if (width * height > 1_500_000) return;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const h = hash(x + x0, y + y0);
        if ((h & 15) !== 0) continue;
        const c = (h >>> 4) % 3;
        const i = (y * width + x) * 4;
        if (data[i + 3] !== 0) data[i + c] ^= 1;
      }
    }
  };

  // Device: the same values the page sees.
  const nav = g.WorkerNavigator?.prototype;
  getter(nav, 'hardwareConcurrency', () => config.cores);
  getter(nav, 'deviceMemory', () => 8);
  if (strict) {
    getter(nav, 'languages', () => Object.freeze(['en-US', 'en']));
    getter(nav, 'language', () => 'en-US');
  }
  wrap(g.NavigatorUAData?.prototype, 'getHighEntropyValues', (original) => async function (this: unknown, hints: string[]) {
    const out: Record<string, unknown> = { ...(await original.call(this, hints)) };
    for (const k of ['platformVersion', 'model', 'architecture', 'bitness', 'uaFullVersion']) if (k in out) out[k] = '';
    if ('wow64' in out) out.wow64 = false;
    if ('formFactors' in out) out.formFactors = [];
    if ('fullVersionList' in out && Array.isArray(out.brands)) out.fullVersionList = (out.brands as Array<{ brand: string; version: string }>).map((b) => ({ brand: b.brand, version: `${b.version}.0.0.0` }));
    return out;
  });

  // OffscreenCanvas (2D) reads.
  const C2D = g.OffscreenCanvasRenderingContext2D?.prototype;
  const rawGetImageData = C2D?.getImageData as Function | undefined;
  wrap(C2D, 'getImageData', (original) => function (this: unknown, sx: number, sy: number, sw: number, sh: number, settings?: unknown) {
    const img = original.call(this, sx, sy, sw, sh, settings);
    farble(img.data, img.width, img.height, sx, sy);
    return img;
  });
  wrap(g.OffscreenCanvas?.prototype, 'convertToBlob', (original) => function (this: any, options?: unknown) {
    const { width, height } = this;
    if (!width || !height || !rawGetImageData) return original.call(this, options);
    const copy = new g.OffscreenCanvas(width, height);
    const ctx = copy.getContext('2d');
    if (!ctx) return original.call(this, options);
    if (!strict) {
      ctx.drawImage(this, 0, 0);
      const img = rawGetImageData.call(ctx, 0, 0, width, height);
      farble(img.data, width, height);
      ctx.putImageData(img, 0, 0);
    }
    return original.call(copy, options);
  });

  // WebGL on an OffscreenCanvas.
  for (const ctor of [g.WebGLRenderingContext, g.WebGL2RenderingContext]) {
    const proto = ctor?.prototype;
    wrap(proto, 'getParameter', (original) => function (this: unknown, pname: number) {
      if (pname === 0x9245) return 'WebKit';
      if (pname === 0x9246) return 'WebKit WebGL';
      return original.call(this, pname);
    });
    wrap(proto, 'readPixels', (original) => function (this: unknown, ...a: any[]) {
      original.apply(this, a);
      const [x, y, width, height, , , pixels] = a;
      if (pixels && Object.prototype.toString.call(pixels) === '[object Uint8Array]') farble(pixels, width, height, x, y);
    });
  }
}
