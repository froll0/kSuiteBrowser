/**
 * Runs in every web page frame. It adds, in the page's own world, the protections that need to be
 * there: notice of protected content requests (Widevine) and fingerprinting protection.
 *
 * Fingerprinting protection, two modes:
 * - standard ("farbling", as in Brave): values that identify a device (canvas and WebGL images, audio
 *   processing, CPU count, graphics card) are slightly altered with a key that depends on the site
 *   and on the browser session. A site sees stable values; two sites, or the same site tomorrow,
 *   see different ones, so they can't recognise the same person.
 * - strict (Tor windows, or chosen in the settings): uniform values, the same for everyone, as Tor
 *   Browser does (blank canvas reads, rounded screen size, generic hardware, no device lists).
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { ShieldConfig } from '../shared/fingerprint';


if (/^https?:$/.test(location.protocol)) {
  let config: ShieldConfig = { mode: 'standard', seed: 1, cores: 4 };
  try {
    config = ipcRenderer.sendSync('shield:config') as ShieldConfig;
  } catch {
    /* defaults */
  }
  const bridge = { drmWanted: () => ipcRenderer.send('shield:drm-wanted') };
  try {
    contextBridge.executeInMainWorld({ func: installShield, args: [bridge, config] });
  } catch {
    /* page without a main world (e.g. some PDFs) */
  }
}

type ShieldBridge = { drmWanted(): void };

/** Executed in the page's world; serialized, so it may only use what is inside it. */
function installShield(bridge: ShieldBridge, config: ShieldConfig): void {
  /** Replaced function -> the original, for toString. */
  const disguised = new WeakMap<object, Function>();
  /** Replaces a function keeping its native look (toString, name, length) through a Proxy. */
  const wrap = <T extends (...a: any[]) => any>(target: Record<string, any>, key: string, make: (original: T) => (this: any, ...a: Parameters<T>) => ReturnType<T>) => {
    const desc = Object.getOwnPropertyDescriptor(target, key);
    const original = desc?.value as T | undefined;
    if (typeof original !== 'function') return;
    const impl = make(original);
    const proxy = new Proxy(original, { apply: (_t, thisArg, args) => impl.apply(thisArg, args as Parameters<T>) });
    disguised.set(proxy, original);
    Object.defineProperty(target, key, { ...desc, value: proxy });
  };
  /** Replaces an accessor's getter, same idea. */
  const getter = (target: Record<string, any> | undefined, key: string, value: (original: () => unknown, self: any) => unknown) => {
    if (!target) return;
    const desc = Object.getOwnPropertyDescriptor(target, key);
    if (!desc?.get) return;
    const original = desc.get;
    const proxy = new Proxy(original, { apply: (_t, thisArg) => value(() => original.call(thisArg), thisArg) });
    disguised.set(proxy, original);
    Object.defineProperty(target, key, { ...desc, get: proxy });
  };
  const strict = config.mode === 'strict';
  let drmTold = false;
  const done = new WeakSet<object>();
  const protectFrame = (child: any) => {
    try {
      if (done.has(child) || !child.Function) return; // cross-origin: it has its own preload
      protect(child);
    } catch {
      /* not reachable */
    }
  };

  /** Installs everything on one window (the page, or a same-origin frame of it). */
  const protect = (w: Record<string, any>) => {
    done.add(w);
    // V8 prints a Proxy of a function as "function () { [native code] }", without its name: toString
    // answers for the original instead, so the replaced functions can't be told apart.
    const nativeToString = w.Function.prototype.toString as Function;
    wrap<() => string>(w.Function.prototype, 'toString', () =>
      function (this: unknown) {
        return nativeToString.call(disguised.get(this as object) ?? this);
      },
    );

    // ---------- Protected content notice ----------
    wrap<(ks: string, cfg: unknown) => Promise<unknown>>(w.Navigator?.prototype ?? {}, 'requestMediaKeySystemAccess', (original) =>
      function (this: unknown, ks: string, cfg: unknown) {
        if (!drmTold && /widevine/i.test(String(ks))) {
          drmTold = true;
          bridge.drmWanted();
        }
        return original.call(this, ks, cfg);
      },
    );

    if (config.mode === 'off') return;

      // A same-origin frame (about:blank, srcdoc) gets no preload: protected as soon as the page reaches it.
      for (const ctor of [w.HTMLIFrameElement, w.HTMLFrameElement, w.HTMLObjectElement]) {
        for (const key of ['contentWindow', 'contentDocument']) {
          getter(ctor?.prototype, key, (original) => {
            const value = original() as any;
            const child = key === 'contentWindow' ? value : value?.defaultView;
            if (child) protectFrame(child);
              return value;
          });
        }
      }

    // ---------- Deterministic noise ----------
    /** 32-bit hash of the site key and some numbers (stable for the same inputs). */
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
    /** Flips the lowest bit of one channel in about one pixel out of sixteen, depending on its position. */
    const farblePixels = (data: Uint8ClampedArray | Uint8Array, width: number, height: number, x0 = 0, y0 = 0) => {
      if (width * height > 1_500_000) return;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const h = hash(x + x0, y + y0);
          if ((h & 15) !== 0) continue;
          const i = (y * width + x) * 4 + ((h >>> 4) % 3);
          if (data[i + 3 - ((h >>> 4) % 3)] !== 0) data[i] ^= 1;
        }
      }
    };

    // ---------- Canvas 2D ----------
    type GetImageData = (sx: number, sy: number, sw: number, sh: number, settings?: unknown) => ImageData;
    /** Unaltered getImageData of each 2D context type (regular and offscreen canvases). */
    const rawGetImageData = new Map<object, GetImageData>();
    for (const proto of [w.CanvasRenderingContext2D?.prototype, w.OffscreenCanvasRenderingContext2D?.prototype]) {
      if (!proto || typeof proto.getImageData !== 'function') continue;
      rawGetImageData.set(proto, proto.getImageData);
      wrap<GetImageData>(proto, 'getImageData', (original) =>
        function (this: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number, settings?: unknown) {
          const img = original.call(this, sx, sy, sw, sh, settings);
          if (strict) img.data.fill(0);
          else farblePixels(img.data, img.width, img.height, sx, sy);
          return img;
        },
      );
    }
    /** A copy of a canvas with the same noise, for toDataURL/toBlob. */
    const farbledCopy = (source: HTMLCanvasElement | OffscreenCanvas): HTMLCanvasElement | OffscreenCanvas | null => {
      const { width, height } = source;
      if (!width || !height) return null;
      const copy = w.OffscreenCanvas ? new w.OffscreenCanvas(width, height) : Object.assign(w.document.createElement('canvas'), { width, height });
      const ctx = (copy as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D | null;
      const raw = ctx && rawGetImageData.get(Object.getPrototypeOf(ctx));
      if (!ctx || !raw) return null;
      if (!strict) {
        ctx.drawImage(source as CanvasImageSource, 0, 0);
        const img = raw.call(ctx, 0, 0, width, height);
        farblePixels(img.data, width, height);
        ctx.putImageData(img, 0, 0);
      }
      return copy;
    };
    const HCE = w.HTMLCanvasElement?.prototype;
    if (HCE) {
      wrap<(type?: string, quality?: unknown) => string>(HCE, 'toDataURL', (original) =>
        function (this: HTMLCanvasElement, type?: string, quality?: unknown) {
          const copy = farbledCopy(this);
          if (!copy) return original.call(this, type, quality);
          if (copy instanceof w.HTMLCanvasElement) return original.call(copy, type, quality);
          // OffscreenCanvas has no toDataURL: through a regular canvas.
          const c = w.document.createElement('canvas');
          c.width = this.width;
          c.height = this.height;
          c.getContext('2d')?.drawImage(copy as unknown as CanvasImageSource, 0, 0);
          return original.call(c, type, quality);
        },
      );
      wrap<(cb: BlobCallback, type?: string, quality?: unknown) => void>(HCE, 'toBlob', (original) =>
        function (this: HTMLCanvasElement, cb: BlobCallback, type?: string, quality?: unknown) {
          const copy = farbledCopy(this);
          if (!copy) return original.call(this, cb, type, quality);
          const c = w.document.createElement('canvas');
          c.width = this.width;
          c.height = this.height;
          c.getContext('2d')?.drawImage(copy as unknown as CanvasImageSource, 0, 0);
          return original.call(c, cb, type, quality);
        },
      );
    }
    const OC = w.OffscreenCanvas?.prototype;
    if (OC) {
      wrap<(options?: ImageEncodeOptions) => Promise<Blob>>(OC, 'convertToBlob', (original) =>
        function (this: OffscreenCanvas, options?: ImageEncodeOptions) {
          const copy = farbledCopy(this) as OffscreenCanvas | null;
          return original.call(copy ?? this, options);
        },
      );
    }

    // ---------- WebGL ----------
    for (const ctor of [w.WebGLRenderingContext, w.WebGL2RenderingContext]) {
      const proto = ctor?.prototype;
      if (!proto) continue;
      wrap<(pname: number) => unknown>(proto, 'getParameter', (original) =>
        function (this: WebGLRenderingContext, pname: number) {
          // UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL: the exact graphics card.
          if (pname === 0x9245) return 'WebKit';
          if (pname === 0x9246) return 'WebKit WebGL';
          return original.call(this, pname);
        },
      );
      wrap<(...a: any[]) => void>(proto, 'readPixels', (original) =>
        function (this: WebGLRenderingContext, ...a: any[]) {
          original.apply(this, a);
          const [x, y, width, height, , , pixels] = a as [number, number, number, number, number, number, ArrayBufferView | null];
          if (pixels && Object.prototype.toString.call(pixels) === '[object Uint8Array]') {
            const bytes = pixels as Uint8Array;
            if (strict) bytes.fill(0);
            else farblePixels(bytes, width, height, x, y);
          }
        },
      );
    }

    // ---------- Audio ----------
    const farbled = new WeakSet<object>();
    const farbleSamples = (data: Float32Array, salt: number) => {
      for (let i = 0; i < data.length; i += 1) {
        const h = hash(i, salt);
        if ((h & 7) === 0) data[i] += ((h >>> 8) / 0xffffff - 0.5) * 1e-7;
      }
    };
    const AB = w.AudioBuffer?.prototype;
    if (AB) {
      wrap<(channel: number) => Float32Array>(AB, 'getChannelData', (original) =>
        function (this: AudioBuffer, channel: number) {
          const data = original.call(this, channel);
          if (!farbled.has(data)) {
            farbled.add(data);
            farbleSamples(data, channel + 1);
          }
          return data;
        },
      );
      wrap<(dest: Float32Array, channel: number, start?: number) => void>(AB, 'copyFromChannel', (original) =>
        function (this: AudioBuffer, dest: Float32Array, channel: number, start?: number) {
          original.call(this, dest, channel, start);
          farbleSamples(dest, channel + 101 + (start ?? 0));
        },
      );
    }
    const AN = w.AnalyserNode?.prototype;
    if (AN) {
      wrap<(array: Float32Array) => void>(AN, 'getFloatFrequencyData', (original) =>
        function (this: AnalyserNode, array: Float32Array) {
          original.call(this, array);
          for (let i = 0; i < array.length; i++) if ((hash(i, 7) & 7) === 0) array[i] += ((hash(i, 8) >>> 8) / 0xffffff - 0.5) * 1e-4;
        },
      );
    }

    // ---------- Hardware and device ----------
    const nav = w.Navigator?.prototype;
    getter(nav, 'hardwareConcurrency', () => config.cores);
    getter(nav, 'deviceMemory', () => 8);
    // Local fonts list: never.
    if (typeof w.queryLocalFonts === 'function') wrap(w, 'queryLocalFonts', () => () => Promise.reject(new w.DOMException('Accesso ai caratteri negato', 'NotAllowedError')));
    // Battery level and charge times are a cross-site identifier.
    wrap(nav ?? {}, 'getBattery', () => () =>
      Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1, onchargingchange: null, onchargingtimechange: null, ondischargingtimechange: null, onlevelchange: null, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }),
    );
    const conn = w.NetworkInformation?.prototype;
    getter(conn, 'rtt', () => 100);
    getter(conn, 'downlink', () => 10);
    getter(conn, 'effectiveType', () => '4g');
    // High-entropy client hints (exact OS version, CPU architecture, device model) stay generic.
    const uad = w.NavigatorUAData?.prototype;
    if (uad) {
      wrap<(hints: string[]) => Promise<Record<string, unknown>>>(uad, 'getHighEntropyValues', (original) =>
        async function (this: unknown, hints: string[]) {
          const values = await original.call(this, hints);
          const out: Record<string, unknown> = { ...values };
          if ('platformVersion' in out) out.platformVersion = '';
          if ('model' in out) out.model = '';
          if ('architecture' in out) out.architecture = '';
          if ('bitness' in out) out.bitness = '';
          if ('wow64' in out) out.wow64 = false;
          if ('fullVersionList' in out && Array.isArray(out.brands)) out.fullVersionList = (out.brands as Array<{ brand: string; version: string }>).map((b) => ({ brand: b.brand, version: `${b.version}.0.0.0` }));
          if ('uaFullVersion' in out) out.uaFullVersion = '';
          if ('formFactors' in out) out.formFactors = [];
          return out;
        },
      );
    }

    if (strict) protectStrict(w);
  };

  const protectStrict = (w: Record<string, any>) => {
    const nav = w.Navigator?.prototype;

    // ---------- Strict: the same values for everyone ----------
    getter(nav, 'languages', () => Object.freeze(['en-US', 'en']));
    getter(nav, 'language', () => 'en-US');
    getter(nav, 'maxTouchPoints', () => 0);
    // Screen = the window, rounded (like Tor Browser's letterboxing): no real monitor size.
    const round = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);
    const scr = w.Screen?.prototype;
    getter(scr, 'width', () => round(w.innerWidth, 200));
    getter(scr, 'height', () => round(w.innerHeight, 100));
    getter(scr, 'availWidth', () => round(w.innerWidth, 200));
    getter(scr, 'availHeight', () => round(w.innerHeight, 100));
    getter(scr, 'colorDepth', () => 24);
    getter(scr, 'pixelDepth', () => 24);
    for (const key of ['outerWidth', 'outerHeight']) {
      const desc = Object.getOwnPropertyDescriptor(w, key);
      if (desc?.get) {
        const original = desc.get;
        const proxy = new Proxy(original, { apply: () => (key === 'outerWidth' ? w.innerWidth : w.innerHeight) });
        Object.defineProperty(w, key, { ...desc, get: proxy });
      }
    }
    for (const key of ['screenX', 'screenY', 'screenLeft', 'screenTop']) {
      const desc = Object.getOwnPropertyDescriptor(w, key);
      if (desc?.get) Object.defineProperty(w, key, { ...desc, get: new Proxy(desc.get, { apply: () => 0 }) });
    }
    // No list of cameras, microphones and speakers.
    const md = w.MediaDevices?.prototype;
    if (md) wrap(md, 'enumerateDevices', () => () => Promise.resolve([]));
};

  protect(window as unknown as Record<string, any>);
}
