export const WORLD_DRAFT_NUDGE_STEP = 0.25;

export function sourcePosition(source) {
  const value = source?.position;
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    ? [...value]
    : [0, 0, 0];
}

export function nudgePosition(position, axis, delta = WORLD_DRAFT_NUDGE_STEP) {
  const next = sourcePosition({ position });
  if (![0, 1, 2].includes(axis)) throw new Error("World draft axis must be 0, 1, or 2");
  if (!Number.isFinite(delta)) throw new Error("World draft nudge must be finite");
  next[axis] = Math.round((next[axis] + delta) * 1000) / 1000;
  return next;
}
