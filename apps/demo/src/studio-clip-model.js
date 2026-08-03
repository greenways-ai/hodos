export const STUDIO_CLIP_SNAP_SECONDS = 0.25;
export const STUDIO_MIN_CLIP_SECONDS = 0.25;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const snap = (value) => Math.round(value / STUDIO_CLIP_SNAP_SECONDS) * STUDIO_CLIP_SNAP_SECONDS;
const randomId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function trimClipStart(clip, deltaSeconds) {
  const start = Math.max(0, finite(clip.startSeconds));
  const sourceStart = Math.max(0, finite(clip.sourceStartSeconds));
  const duration = Math.max(STUDIO_MIN_CLIP_SECONDS, finite(clip.duration, STUDIO_MIN_CLIP_SECONDS));
  const minimumDelta = -Math.min(start, sourceStart);
  const maximumDelta = duration - STUDIO_MIN_CLIP_SECONDS;
  const delta = clamp(snap(finite(deltaSeconds)), minimumDelta, maximumDelta);
  return {
    ...clip,
    startSeconds: start + delta,
    sourceStartSeconds: sourceStart + delta,
    duration: duration - delta,
  };
}

export function trimClipEnd(clip, deltaSeconds, maximumSourceDuration) {
  const sourceStart = Math.max(0, finite(clip.sourceStartSeconds));
  const duration = Math.max(STUDIO_MIN_CLIP_SECONDS, finite(clip.duration, STUDIO_MIN_CLIP_SECONDS));
  const maximum = Math.max(
    STUDIO_MIN_CLIP_SECONDS,
    finite(maximumSourceDuration) - sourceStart,
  );
  const nextDuration = clamp(
    snap(duration + finite(deltaSeconds)),
    STUDIO_MIN_CLIP_SECONDS,
    maximum,
  );
  return { ...clip, duration: nextDuration };
}

export function splitClip(clip, {
  offsetSeconds = finite(clip.duration) / 2,
  rightId = randomId("clip"),
} = {}) {
  const duration = finite(clip.duration);
  if (duration < STUDIO_MIN_CLIP_SECONDS * 2) {
    throw new Error(`Clip must be at least ${STUDIO_MIN_CLIP_SECONDS * 2} seconds to split`);
  }
  const offset = clamp(
    snap(finite(offsetSeconds, duration / 2)),
    STUDIO_MIN_CLIP_SECONDS,
    duration - STUDIO_MIN_CLIP_SECONDS,
  );
  return {
    left: { ...clip, duration: offset },
    right: {
      ...clip,
      id: rightId,
      startSeconds: finite(clip.startSeconds) + offset,
      sourceStartSeconds: finite(clip.sourceStartSeconds) + offset,
      duration: duration - offset,
    },
  };
}

export function duplicateClip(clip, {
  id = randomId("clip"),
  gapSeconds = STUDIO_CLIP_SNAP_SECONDS,
} = {}) {
  return {
    ...clip,
    id,
    startSeconds: finite(clip.startSeconds) + finite(clip.duration) + Math.max(0, finite(gapSeconds)),
  };
}
