export const MIXAMO_ANIMATION_DEMO_EXPERIENCE = "animation";
export const MIXAMO_ANIMATION_MAX_SEQUENCE = 32;
export const MIXAMO_ANIMATION_MAX_POSE_KEYS = 128;

export const MIXAMO_ANIMATION_EDITABLE_JOINTS = Object.freeze([
  "hips",
  "spine",
  "spine-1",
  "spine-2",
  "neck",
  "head",
  "left-arm",
  "left-forearm",
  "right-arm",
  "right-forearm",
  "left-up-leg",
  "left-leg",
  "right-up-leg",
  "right-leg",
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

function clipDescriptor(value) {
  const id = requiredString(value?.id, "Animation clip id");
  return Object.freeze({
    id,
    label: typeof value?.label === "string" && value.label.trim()
      ? value.label.trim()
      : typeof value?.state === "string" && value.state.trim()
        ? value.state.trim()
        : id,
    duration: Math.max(0, finite(value?.duration)),
    loop: value?.loop === true,
    source: typeof value?.source === "string" && value.source.trim()
      ? value.source.trim()
      : String(value?.resourceId ?? "unknown").startsWith("builtin:")
        ? "Hodos"
        : String(value?.resourceId ?? "").startsWith("authored:")
          ? "Authored"
          : String(value?.resourceId ?? "").startsWith("animation-source:")
            ? "Imported"
            : "Character",
    resourceId: typeof value?.resourceId === "string" && value.resourceId.trim()
      ? value.resourceId.trim()
      : null,
  });
}

function normalizedClips(values) {
  const map = new Map();
  for (const value of values ?? []) {
    const clip = clipDescriptor(value);
    map.set(clip.id, clip);
  }
  return [...map.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function sequenceItem(value, clips, index = 0) {
  const clipId = requiredString(value?.clipId ?? value, "Animation sequence clip id");
  if (!clips.some((clip) => clip.id === clipId)) {
    throw new Error(`Animation sequence references missing clip ${clipId}`);
  }
  return Object.freeze({
    id: typeof value?.id === "string" && value.id.trim()
      ? value.id.trim()
      : `cue:${index + 1}:${clipId}`,
    clipId,
    blend: clamp(finite(value?.blend, 0.2), 0, 2),
    speed: clamp(finite(value?.speed, 1), 0.05, 4),
  });
}

function poseKey(value) {
  const at = Math.max(0, finite(value?.at));
  const joints = {};
  for (const [joint, quaternion] of Object.entries(value?.joints ?? {})) {
    if (!MIXAMO_ANIMATION_EDITABLE_JOINTS.includes(joint)) continue;
    if (!Array.isArray(quaternion) || quaternion.length !== 4 || !quaternion.every(Number.isFinite)) {
      throw new TypeError(`Pose key ${joint} must contain four finite quaternion components`);
    }
    joints[joint] = [...quaternion];
  }
  return Object.freeze({ at, joints: Object.freeze(joints) });
}

export function createMixamoAnimationDemoState(value = {}) {
  const clips = normalizedClips(value.clips ?? []);
  const selectedClip = clips.some((clip) => clip.id === value.selectedClip)
    ? value.selectedClip
    : clips[0]?.id ?? null;
  const sequence = (value.sequence ?? [])
    .slice(0, MIXAMO_ANIMATION_MAX_SEQUENCE)
    .map((item, index) => sequenceItem(item, clips, index));
  const poseKeys = (value.poseKeys ?? [])
    .slice(0, MIXAMO_ANIMATION_MAX_POSE_KEYS)
    .map(poseKey)
    .sort((left, right) => left.at - right.at);
  return Object.freeze({
    character: value.character ?? null,
    clips,
    selectedClip,
    playback: Object.freeze({
      status: value.playback?.status ?? "paused",
      speed: clamp(finite(value.playback?.speed, 1), 0.05, 4),
      blend: clamp(finite(value.playback?.blend, 0.2), 0, 2),
      current: value.playback?.current ?? value.playback?.clipId ?? null,
    }),
    pose: Object.freeze({
      joint: MIXAMO_ANIMATION_EDITABLE_JOINTS.includes(value.pose?.joint)
        ? value.pose.joint
        : "right-arm",
      rotation: Array.isArray(value.pose?.rotation) && value.pose.rotation.length === 3
        ? value.pose.rotation.map((entry) => clamp(finite(entry), -180, 180))
        : [0, 0, 0],
      at: Math.max(0, finite(value.pose?.at)),
      duration: clamp(finite(value.pose?.duration, 2), 0.25, 30),
    }),
    poseKeys,
    sequence,
    sequenceStatus: value.sequenceStatus ?? "idle",
    sequenceCurrent: value.sequenceCurrent ?? null,
    busy: value.busy === true,
    message: typeof value.message === "string" ? value.message : null,
    error: typeof value.error === "string" ? value.error : null,
  });
}

export function reduceMixamoAnimationDemoState(stateValue, event = {}) {
  const state = createMixamoAnimationDemoState(stateValue);
  switch (event.type) {
    case "animation/busy":
      return createMixamoAnimationDemoState({
        ...state,
        busy: event.busy === true,
        message: event.message ?? state.message,
        error: event.busy === true ? null : state.error,
      });
    case "animation/character-ready":
      return createMixamoAnimationDemoState({
        ...state,
        character: event.character,
        clips: event.clips ?? state.clips,
        selectedClip: event.selectedClip,
        sequence: [],
        poseKeys: [],
        playback: {
          ...state.playback,
          current: event.character?.animation?.clips?.[0]?.id ?? null,
        },
        message: event.message ?? null,
        error: null,
        busy: false,
      });
    case "animation/clips-replace":
      return createMixamoAnimationDemoState({
        ...state,
        clips: event.clips ?? [],
        selectedClip: event.selectedClip ?? state.selectedClip,
        sequence: [],
      });
    case "animation/clips-add":
      return createMixamoAnimationDemoState({
        ...state,
        clips: [...state.clips, ...(event.clips ?? [])],
        selectedClip: event.selectedClip ?? event.clips?.[0]?.id ?? state.selectedClip,
        message: event.message ?? state.message,
        error: null,
        busy: false,
      });
    case "animation/select-clip":
      return createMixamoAnimationDemoState({ ...state, selectedClip: event.clipId });
    case "animation/playback":
      return createMixamoAnimationDemoState({
        ...state,
        playback: {
          ...state.playback,
          ...event.playback,
          current: event.playback?.current ?? event.playback?.clipId ?? state.playback.current,
        },
        error: null,
      });
    case "animation/pose-joint":
      return createMixamoAnimationDemoState({
        ...state,
        pose: { ...state.pose, joint: event.joint, rotation: [0, 0, 0] },
      });
    case "animation/pose-rotation": {
      const axis = Number(event.axis);
      if (![0, 1, 2].includes(axis)) throw new TypeError("Pose rotation axis must be zero, one, or two");
      const rotation = [...state.pose.rotation];
      rotation[axis] = clamp(finite(event.value), -180, 180);
      return createMixamoAnimationDemoState({ ...state, pose: { ...state.pose, rotation } });
    }
    case "animation/pose-time":
      return createMixamoAnimationDemoState({
        ...state,
        pose: { ...state.pose, at: clamp(finite(event.at), 0, state.pose.duration) },
      });
    case "animation/pose-duration":
      return createMixamoAnimationDemoState({
        ...state,
        pose: {
          ...state.pose,
          duration: event.duration,
          at: clamp(state.pose.at, 0, clamp(finite(event.duration, 2), 0.25, 30)),
        },
      });
    case "animation/pose-captured": {
      const next = poseKey(event.key);
      const keys = state.poseKeys.filter((entry) => Math.abs(entry.at - next.at) > 1e-6);
      keys.push(next);
      keys.sort((left, right) => left.at - right.at);
      return createMixamoAnimationDemoState({
        ...state,
        poseKeys: keys.slice(-MIXAMO_ANIMATION_MAX_POSE_KEYS),
        message: `Captured pose at ${next.at.toFixed(2)}s`,
        error: null,
      });
    }
    case "animation/pose-clear":
      return createMixamoAnimationDemoState({
        ...state,
        poseKeys: [],
        message: "Cleared authored pose keys",
        error: null,
      });
    case "animation/pose-reset":
      return createMixamoAnimationDemoState({
        ...state,
        pose: { ...state.pose, rotation: [0, 0, 0] },
        message: "Restored the captured rest pose",
        error: null,
      });
    case "animation/sequence-add": {
      if (!state.selectedClip || state.sequence.length >= MIXAMO_ANIMATION_MAX_SEQUENCE) return state;
      return createMixamoAnimationDemoState({
        ...state,
        sequence: [
          ...state.sequence,
          sequenceItem(
            event.item ?? { clipId: state.selectedClip },
            state.clips,
            state.sequence.length,
          ),
        ],
      });
    }
    case "animation/sequence-remove":
      return createMixamoAnimationDemoState({
        ...state,
        sequence: state.sequence.filter((item) => item.id !== event.id),
      });
    case "animation/sequence-clear":
      return createMixamoAnimationDemoState({
        ...state,
        sequence: [],
        sequenceStatus: "idle",
        sequenceCurrent: null,
      });
    case "animation/sequence-status":
      return createMixamoAnimationDemoState({
        ...state,
        sequenceStatus: event.status,
        sequenceCurrent: event.current ?? state.sequenceCurrent,
        message: event.message ?? state.message,
        error: null,
      });
    case "animation/message":
      return createMixamoAnimationDemoState({
        ...state,
        busy: false,
        message: event.message ?? null,
        error: null,
      });
    case "animation/error":
      return createMixamoAnimationDemoState({
        ...state,
        busy: false,
        error: event.error instanceof Error ? event.error.message : String(event.error),
        message: null,
      });
    default:
      return state;
  }
}
