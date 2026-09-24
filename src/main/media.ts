import type { WebContents, WebFrameMain } from 'electron';

export type MediaAction = 'toggle-play' | 'play' | 'pause' | 'toggle-mute' | 'toggle-loop' | 'toggle-controls' | 'toggle-pip' | `rate:${number}`;

/** Where the media element is: its address (from the context menu) and, in the main frame, the click point. */
export interface MediaTarget {
  src?: string;
  x?: number;
  y?: number;
}

export interface MediaInfo {
  hasVideo: boolean;
  playing: boolean;
  pip: boolean;
}

/**
 * Script run in the page frame. It finds the element (same address, element under the click, or the
 * most relevant video) and applies the action. Picture-in-picture needs a user gesture: the call is
 * made with userGesture = true, which is what the menu click is.
 */
function script(action: MediaAction | 'info', target: MediaTarget): string {
  return `(() => {
    const target = ${JSON.stringify(target)};
    const all = [...document.querySelectorAll('video, audio')];
    const isVideo = (e) => e.tagName === 'VIDEO';
    const area = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height; };
    const playing = (e) => !e.paused && !e.ended && e.readyState > 2;
    if (${JSON.stringify(action)} === 'info') {
      const videos = all.filter(isVideo);
      return { hasVideo: videos.some((v) => area(v) > 0 || v === document.pictureInPictureElement), playing: all.some(playing), pip: Boolean(document.pictureInPictureElement) };
    }
    let el = null;
    if (target.src) el = all.find((e) => e.currentSrc === target.src || e.src === target.src) || null;
    if (!el && typeof target.x === 'number') {
      const hit = document.elementFromPoint(target.x, target.y);
      el = hit && hit.closest ? hit.closest('video, audio') : null;
    }
    if (!el) {
      // The video worth showing: in picture-in-picture, then playing, then the largest.
      el = document.pictureInPictureElement
        || all.filter(isVideo).sort((a, b) => (playing(b) - playing(a)) || (area(b) - area(a)))[0]
        || all.find(playing) || all[0] || null;
    }
    if (!el) return false;
    const action = ${JSON.stringify(action)};
    if (action === 'toggle-play') el.paused ? el.play() : el.pause();
    else if (action === 'play') el.play();
    else if (action === 'pause') el.pause();
    else if (action === 'toggle-mute') el.muted = !el.muted;
    else if (action === 'toggle-loop') el.loop = !el.loop;
    else if (action === 'toggle-controls') el.controls = !el.controls;
    else if (action.startsWith('rate:')) el.playbackRate = Number(action.slice(5));
    else if (action === 'toggle-pip' && isVideo(el)) {
      if (document.pictureInPictureElement === el) return document.exitPictureInPicture().then(() => true);
      // The user asked for it: sites that disable picture-in-picture don't get the last word.
      el.disablePictureInPicture = false;
      return el.requestPictureInPicture().then(() => true);
    }
    return true;
  })()`;
}

export async function runMediaAction(frame: WebFrameMain | null | undefined, action: MediaAction, target: MediaTarget = {}): Promise<boolean> {
  if (!frame || frame.isDestroyed()) return false;
  try {
    return Boolean(await frame.executeJavaScript(script(action, target), true));
  } catch {
    return false;
  }
}

/** The frames of a page that have media, main frame first (players are often in embedded frames). */
async function mediaFrames(contents: WebContents): Promise<Array<{ frame: WebFrameMain; info: MediaInfo }>> {
  const found: Array<{ frame: WebFrameMain; info: MediaInfo }> = [];
  for (const frame of contents.mainFrame.framesInSubtree) {
    try {
      const info = (await frame.executeJavaScript(script('info', {}))) as MediaInfo;
      if (info && (info.hasVideo || info.playing || info.pip)) found.push({ frame, info });
    } catch {
      /* frame gone or not scriptable */
    }
  }
  return found;
}

export async function pageMedia(contents: WebContents): Promise<MediaInfo> {
  const frames = await mediaFrames(contents);
  return {
    hasVideo: frames.some((f) => f.info.hasVideo),
    playing: frames.some((f) => f.info.playing),
    pip: frames.some((f) => f.info.pip),
  };
}

/** Applies an action to the page's main media: the frame in picture-in-picture, then a playing video, then any. */
export async function pageMediaAction(contents: WebContents, action: MediaAction): Promise<boolean> {
  const frames = await mediaFrames(contents);
  const pick =
    frames.find((f) => f.info.pip) ??
    frames.find((f) => f.info.playing && f.info.hasVideo) ??
    (action === 'toggle-pip' ? frames.find((f) => f.info.hasVideo) : frames.find((f) => f.info.playing)) ??
    frames[0];
  return pick ? runMediaAction(pick.frame, action) : false;
}
