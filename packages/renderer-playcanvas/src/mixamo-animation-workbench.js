import {
  AnimCurve,
  AnimData,
  AnimEvents,
  AnimTrack,
  Color,
  Entity,
  INTERPOLATION_LINEAR,
  Quat,
  StandardMaterial,
} from "playcanvas";
import { normalizeMixamoJointName } from "@greenways/hodos-world-model/mixamo";
import {
  PlayCanvasMixamoCharacterHostError,
  createPlayCanvasMixamoCharacterHost,
  inspectPlayCanvasMixamoCharacter,
} from "./mixamo-character-loader.js";
import {
  optionalString,
  portableCopy,
  positiveSafeInteger,
  requiredString,
} from "./mixamo-character-values.js";

export const PLAYCANVAS_MIXAMO_ANIMATION_WORKBENCH_SCHEMA = "hodos.playcanvas-mixamo-animation-workbench/0-alpha";
export const DEFAULT_MIXAMO_ANIMATION_MAX_SOURCES = 32;
export const DEFAULT_MIXAMO_ANIMATION_MAX_POSE_KEYS = 128;

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

const ROOT_MOTION_MODES = new Set(["none", "extract", "apply"]);

function finite(value, fallback, label) {
  const candidate = value ?? fallback;
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return candidate;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedEuler(value, label = "Pose rotation") {
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError(`${label} must contain three values`);
  return value.map((entry, index) => clamp(finite(entry, 0, `${label}[${index}]`), -180, 180));
}

function normalizedQuaternion(value, label = "Pose quaternion") {
  if (!Array.isArray(value) || value.length !== 4) throw new TypeError(`${label} must contain four values`);
  const quaternion = new Quat(...value.map((entry, index) => finite(entry, undefined, `${label}[${index}]`)));
  quaternion.normalize();
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function quaternionFromPose(value, label) {
  if (Array.isArray(value) && value.length === 4) return normalizedQuaternion(value, label);
  const [x, y, z] = normalizedEuler(value, label);
  const quaternion = new Quat().setFromEulerAngles(x, y, z);
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function clipIdentifier(value, fallback = "clip") {
  const normalized = String(value ?? fallback)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
  return normalized || fallback;
}

function uniqueClipId(candidate, used) {
  if (!used.has(candidate)) return candidate;
  let suffix = 2;
  while (used.has(`${candidate}-${suffix}`)) suffix += 1;
  return `${candidate}-${suffix}`;
}

function sourceFileName(source, fallback) {
  const name = source?.name ?? source?.fileName ?? source?.filename ?? null;
  return typeof name === "string" && name.trim() ? name.trim() : fallback;
}

function animationTrack(asset) {
  if (asset?.resource && typeof asset.resource === "object") return asset.resource;
  return asset && typeof asset === "object" ? asset : null;
}

function containerAnimations(asset) {
  return Array.isArray(asset?.resource?.animations) ? asset.resource.animations : [];
}

function unloadAsset(app, asset) {
  if (!asset) return;
  let failure = null;
  try {
    asset.unload?.();
  } catch (error) {
    failure = error;
  }
  try {
    app?.assets?.remove?.(asset);
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
}

function material(color, { metalness = 0.05, gloss = 0.55 } = {}) {
  const output = new StandardMaterial();
  output.diffuse = new Color(...color);
  output.metalness = metalness;
  output.gloss = gloss;
  output.update();
  return output;
}

function addPrimitive(app, parent, {
  name,
  type = "box",
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1],
  surface,
  castShadows = true,
} = {}) {
  const entity = new Entity(name, app);
  parent.addChild(entity);
  entity.setLocalPosition(...position);
  entity.setLocalEulerAngles(...rotation);
  entity.setLocalScale(...scale);
  entity.addComponent("render", {
    type,
    material: surface,
    castShadows,
    receiveShadows: true,
  });
  return entity;
}

const PROCEDURAL_JOINTS = Object.freeze([
  ["Hips", null, [0, 1.02, 0]],
  ["Spine", "Hips", [0, 0.25, 0]],
  ["Spine1", "Spine", [0, 0.24, 0]],
  ["Spine2", "Spine1", [0, 0.23, 0]],
  ["Neck", "Spine2", [0, 0.2, 0]],
  ["Head", "Neck", [0, 0.22, 0]],
  ["LeftShoulder", "Spine2", [-0.16, 0.1, 0]],
  ["LeftArm", "LeftShoulder", [-0.31, 0, 0]],
  ["LeftForeArm", "LeftArm", [-0.34, 0, 0]],
  ["LeftHand", "LeftForeArm", [-0.29, 0, 0]],
  ["RightShoulder", "Spine2", [0.16, 0.1, 0]],
  ["RightArm", "RightShoulder", [0.31, 0, 0]],
  ["RightForeArm", "RightArm", [0.34, 0, 0]],
  ["RightHand", "RightForeArm", [0.29, 0, 0]],
  ["LeftUpLeg", "Hips", [-0.14, -0.12, 0]],
  ["LeftLeg", "LeftUpLeg", [0, -0.43, 0]],
  ["LeftFoot", "LeftLeg", [0, -0.43, 0.04]],
  ["RightUpLeg", "Hips", [0.14, -0.12, 0]],
  ["RightLeg", "RightUpLeg", [0, -0.43, 0]],
  ["RightFoot", "RightLeg", [0, -0.43, 0.04]],
]);

function decorateProceduralMannequin(app, root, joints) {
  const stone = material([0.72, 0.76, 0.72], { metalness: 0.1, gloss: 0.7 });
  const emerald = material([0.04, 0.28, 0.2], { metalness: 0.12, gloss: 0.72 });
  const gold = material([0.9, 0.62, 0.12], { metalness: 0.35, gloss: 0.8 });
  addPrimitive(app, joints.Hips, { name: "hips-shell", scale: [0.25, 0.14, 0.16], surface: emerald });
  addPrimitive(app, joints.Spine, { name: "torso-lower", position: [0, 0.11, 0], scale: [0.2, 0.22, 0.13], surface: stone });
  addPrimitive(app, joints.Spine1, { name: "torso-upper", position: [0, 0.1, 0], scale: [0.25, 0.2, 0.14], surface: stone });
  addPrimitive(app, joints.Neck, { name: "neck-shell", position: [0, 0.08, 0], scale: [0.07, 0.12, 0.07], surface: gold });
  addPrimitive(app, joints.Head, { name: "head-shell", position: [0, 0.1, 0], type: "sphere", scale: [0.15, 0.18, 0.15], surface: stone });
  addPrimitive(app, joints.LeftShoulder, { name: "left-upper-arm", position: [-0.15, 0, 0], scale: [0.31, 0.08, 0.08], surface: emerald });
  addPrimitive(app, joints.LeftArm, { name: "left-forearm", position: [-0.17, 0, 0], scale: [0.34, 0.07, 0.07], surface: stone });
  addPrimitive(app, joints.LeftForeArm, { name: "left-hand", position: [-0.15, 0, 0], scale: [0.22, 0.08, 0.1], surface: gold });
  addPrimitive(app, joints.RightShoulder, { name: "right-upper-arm", position: [0.15, 0, 0], scale: [0.31, 0.08, 0.08], surface: emerald });
  addPrimitive(app, joints.RightArm, { name: "right-forearm", position: [0.17, 0, 0], scale: [0.34, 0.07, 0.07], surface: stone });
  addPrimitive(app, joints.RightForeArm, { name: "right-hand", position: [0.15, 0, 0], scale: [0.22, 0.08, 0.1], surface: gold });
  addPrimitive(app, joints.LeftUpLeg, { name: "left-thigh", position: [0, -0.21, 0], scale: [0.11, 0.43, 0.12], surface: emerald });
  addPrimitive(app, joints.LeftLeg, { name: "left-shin", position: [0, -0.21, 0], scale: [0.09, 0.42, 0.1], surface: stone });
  addPrimitive(app, joints.LeftFoot, { name: "left-foot-shell", position: [0, -0.03, 0.09], scale: [0.12, 0.08, 0.28], surface: gold });
  addPrimitive(app, joints.RightUpLeg, { name: "right-thigh", position: [0, -0.21, 0], scale: [0.11, 0.43, 0.12], surface: emerald });
  addPrimitive(app, joints.RightLeg, { name: "right-shin", position: [0, -0.21, 0], scale: [0.09, 0.42, 0.1], surface: stone });
  addPrimitive(app, joints.RightFoot, { name: "right-foot-shell", position: [0, -0.03, 0.09], scale: [0.12, 0.08, 0.28], surface: gold });
  root.tags?.add?.("hodos-animation-demo");
}

export function createProceduralMixamoMannequin(app, {
  name = "Hodos Mixamo Mannequin",
  attach = true,
  visuals = true,
  animation = true,
} = {}) {
  if (!app) throw new TypeError("Procedural Mixamo mannequin requires a PlayCanvas app");
  const root = new Entity(name, app);
  const armature = new Entity("Armature", app);
  root.addChild(armature);
  const joints = {};
  for (const [joint, parent, position] of PROCEDURAL_JOINTS) {
    const entity = new Entity(`mixamorig:${joint}`, app);
    entity.setLocalPosition(...position);
    (parent ? joints[parent] : armature).addChild(entity);
    joints[joint] = entity;
  }
  if (attach) {
    if (!app?.root?.addChild) throw new TypeError("Procedural Mixamo mannequin requires a PlayCanvas app when attach is enabled");
    app.root.addChild(root);
  }
  if (visuals) decorateProceduralMannequin(app, root, joints);
  if (animation) {
    if (typeof root.addComponent !== "function") throw new TypeError("Procedural Mixamo mannequin cannot create an AnimComponent");
    root.addComponent("anim", { activate: false, speed: 1 });
  }
  return Object.freeze({ root, joints: Object.freeze({ ...joints }) });
}

function normalizedPoseKeys(keyframes, duration) {
  if (!Array.isArray(keyframes) || !keyframes.length) throw new TypeError("Mixamo pose track requires at least one keyframe");
  const output = keyframes.map((keyframe, index) => {
    const at = clamp(finite(keyframe?.at, 0, `Pose key ${index} time`), 0, duration);
    const joints = keyframe?.joints;
    if (!joints || typeof joints !== "object" || Array.isArray(joints)) {
      throw new TypeError(`Pose key ${index} joints must be an object`);
    }
    return { at, joints };
  });
  output.sort((left, right) => left.at - right.at);
  return output;
}

export function createMixamoPoseTrack({
  name = "Authored pose",
  duration = 2,
  profile,
  keyframes,
  interpolation = INTERPOLATION_LINEAR,
  events = [],
} = {}) {
  name = requiredString(name, "Mixamo pose track name");
  duration = Math.max(0.001, finite(duration, 2, "Mixamo pose track duration"));
  if (!profile?.joints || typeof profile.joints !== "object") throw new TypeError("Mixamo pose track requires a skeleton profile");
  const keys = normalizedPoseKeys(keyframes, duration);
  const inputs = [];
  const outputs = [];
  const curves = [];
  const jointIds = [...new Set(keys.flatMap((keyframe) => Object.keys(keyframe.joints)))].sort();
  for (const joint of jointIds) {
    const target = profile.joints[joint];
    if (!target?.nodeName) continue;
    const jointKeys = keys
      .filter((keyframe) => keyframe.joints[joint] !== undefined)
      .map((keyframe) => ({
        at: keyframe.at,
        quaternion: quaternionFromPose(keyframe.joints[joint], `Pose key ${joint}`),
      }));
    if (!jointKeys.length) continue;
    const deduplicated = [];
    for (const key of jointKeys) {
      if (deduplicated.length && Math.abs(deduplicated.at(-1).at - key.at) <= 1e-6) deduplicated[deduplicated.length - 1] = key;
      else deduplicated.push(key);
    }
    if (deduplicated[0].at > 0) deduplicated.unshift({ at: 0, quaternion: [...deduplicated[0].quaternion] });
    if (deduplicated.at(-1).at < duration) deduplicated.push({ at: duration, quaternion: [...deduplicated.at(-1).quaternion] });
    if (deduplicated.length === 1) deduplicated.push({ at: duration, quaternion: [...deduplicated[0].quaternion] });
    const input = inputs.push(new AnimData(1, deduplicated.map((key) => key.at))) - 1;
    const output = outputs.push(new AnimData(4, deduplicated.flatMap((key) => key.quaternion))) - 1;
    curves.push(new AnimCurve([{
      entityPath: [target.nodeName],
      component: "graph",
      propertyPath: ["localRotation"],
    }], input, output, interpolation));
  }
  if (!curves.length) throw new PlayCanvasMixamoCharacterHostError("mixamo/pose-empty", "Pose keys do not target any recognized Mixamo joints");
  return new AnimTrack(name, duration, inputs, outputs, curves, new AnimEvents(events));
}

export function retargetMixamoAnimationTrack(track, sourceProfile, targetProfile, {
  name = null,
  rootMotion = "none",
} = {}) {
  if (!track || typeof track !== "object" || !Array.isArray(track.curves)) {
    throw new TypeError("Mixamo retargeting requires an AnimTrack-like object");
  }
  if (!sourceProfile?.joints || !targetProfile?.joints) {
    throw new TypeError("Mixamo retargeting requires source and target profiles");
  }
  rootMotion = requiredString(rootMotion, "Mixamo root-motion mode");
  if (!ROOT_MOTION_MODES.has(rootMotion)) throw new TypeError(`Unsupported Mixamo root-motion mode: ${rootMotion}`);
  const curves = [];
  const mappedJoints = new Set();
  const droppedJoints = new Set();
  for (const curve of track.curves) {
    const paths = [];
    for (const path of curve.paths ?? []) {
      const sourceName = path?.entityPath?.at?.(-1);
      const joint = sourceName ? normalizeMixamoJointName(sourceName) : null;
      const target = joint ? targetProfile.joints[joint] : null;
      if (!joint || !sourceProfile.joints[joint] || !target?.nodeName) {
        if (sourceName) droppedJoints.add(sourceName);
        continue;
      }
      const property = path.propertyPath?.[0];
      if (property === "localPosition" && joint !== "hips") {
        droppedJoints.add(joint);
        continue;
      }
      if (property === "localPosition" && joint === "hips" && rootMotion !== "apply") {
        droppedJoints.add("hips:root-motion");
        continue;
      }
      paths.push({
        entityPath: [target.nodeName],
        component: path.component ?? "graph",
        propertyPath: [...(path.propertyPath ?? [])],
      });
      mappedJoints.add(joint);
    }
    if (paths.length) curves.push(new AnimCurve(paths, curve.input, curve.output, curve.interpolation));
  }
  if (!curves.length) {
    throw new PlayCanvasMixamoCharacterHostError(
      "mixamo/animation-incompatible",
      `Animation ${track.name ?? "<unnamed>"} contains no compatible Mixamo curves`,
      { droppedJoints: [...droppedJoints].sort() },
    );
  }
  const output = new AnimTrack(
    optionalString(name, "Retargeted Mixamo track name") ?? track.name ?? "Mixamo animation",
    track.duration,
    track.inputs,
    track.outputs,
    curves,
    new AnimEvents(track.events ?? []),
  );
  return Object.freeze({
    track: output,
    evidence: Object.freeze({
      sourceTrack: track.name ?? null,
      targetTrack: output.name,
      duration: output.duration,
      rootMotion,
      mappedJoints: [...mappedJoints].sort(),
      droppedJoints: [...droppedJoints].sort(),
      sourceProfileId: sourceProfile.id ?? null,
      targetProfileId: targetProfile.id ?? null,
    }),
  });
}

function builtInPoseDefinitions() {
  const rest = {
    "spine-2": [0, 0, 0], head: [0, 0, 0],
    "left-arm": [0, 0, 0], "left-forearm": [0, 0, 0],
    "right-arm": [0, 0, 0], "right-forearm": [0, 0, 0],
    "left-up-leg": [0, 0, 0], "left-leg": [0, 0, 0],
    "right-up-leg": [0, 0, 0], "right-leg": [0, 0, 0],
  };
  return Object.freeze([
    {
      id: "idle",
      label: "Garden idle",
      duration: 2.4,
      loop: true,
      keyframes: [
        { at: 0, joints: { ...rest, "spine-2": [0, 0, -1.5], head: [0, -3, 0], "left-arm": [0, 0, -5], "right-arm": [0, 0, 5] } },
        { at: 1.2, joints: { ...rest, "spine-2": [0, 0, 1.5], head: [0, 3, 0], "left-arm": [0, 0, -2], "right-arm": [0, 0, 2] } },
        { at: 2.4, joints: { ...rest, "spine-2": [0, 0, -1.5], head: [0, -3, 0], "left-arm": [0, 0, -5], "right-arm": [0, 0, 5] } },
      ],
    },
    {
      id: "wave",
      label: "Friendly wave",
      duration: 2,
      loop: false,
      keyframes: [
        { at: 0, joints: { ...rest } },
        { at: 0.35, joints: { ...rest, "right-arm": [0, 0, 75], "right-forearm": [0, 0, 50] } },
        { at: 0.75, joints: { ...rest, "right-arm": [0, 0, 78], "right-forearm": [30, 0, 70] } },
        { at: 1.1, joints: { ...rest, "right-arm": [0, 0, 78], "right-forearm": [-25, 0, 45] } },
        { at: 1.45, joints: { ...rest, "right-arm": [0, 0, 78], "right-forearm": [25, 0, 70] } },
        { at: 2, joints: { ...rest } },
      ],
    },
    {
      id: "bow",
      label: "Ballroom bow",
      duration: 2.2,
      loop: false,
      keyframes: [
        { at: 0, joints: { ...rest } },
        { at: 0.65, joints: { ...rest, "spine-2": [36, 0, 0], head: [18, 0, 0], "left-arm": [0, -12, -10], "right-arm": [0, 12, 10] } },
        { at: 1.3, joints: { ...rest, "spine-2": [42, 0, 0], head: [22, 0, 0], "left-arm": [0, -16, -12], "right-arm": [0, 16, 12] } },
        { at: 2.2, joints: { ...rest } },
      ],
    },
    {
      id: "walk",
      label: "In-place walk",
      duration: 1.1,
      loop: true,
      keyframes: [
        { at: 0, joints: { ...rest, "left-up-leg": [28, 0, 0], "left-leg": [-18, 0, 0], "right-up-leg": [-28, 0, 0], "right-leg": [22, 0, 0], "left-arm": [-24, 0, -4], "right-arm": [24, 0, 4] } },
        { at: 0.55, joints: { ...rest, "left-up-leg": [-28, 0, 0], "left-leg": [22, 0, 0], "right-up-leg": [28, 0, 0], "right-leg": [-18, 0, 0], "left-arm": [24, 0, -4], "right-arm": [-24, 0, 4] } },
        { at: 1.1, joints: { ...rest, "left-up-leg": [28, 0, 0], "left-leg": [-18, 0, 0], "right-up-leg": [-28, 0, 0], "right-leg": [22, 0, 0], "left-arm": [-24, 0, -4], "right-arm": [24, 0, 4] } },
      ],
    },
  ]);
}

function nodeForJoint(root, profile, joint) {
  const descriptor = profile?.joints?.[joint];
  if (!descriptor) return null;
  return root.findByGuid?.(descriptor.nodeId)
    ?? root.findByName?.(descriptor.nodeName)
    ?? null;
}

function capturePose(root, profile, joints = MIXAMO_ANIMATION_EDITABLE_JOINTS) {
  const output = {};
  for (const joint of joints) {
    const node = nodeForJoint(root, profile, joint);
    if (!node?.getLocalRotation) continue;
    const rotation = node.getLocalRotation();
    output[joint] = [rotation.x, rotation.y, rotation.z, rotation.w];
  }
  return output;
}

function normalizeCharacterPlacement(root, profile, targetHeight = 1.75) {
  const hips = nodeForJoint(root, profile, "hips");
  const head = nodeForJoint(root, profile, "head");
  const leftFoot = nodeForJoint(root, profile, "left-foot");
  const rightFoot = nodeForJoint(root, profile, "right-foot");
  root.syncHierarchy?.();
  if (!hips?.getPosition || !head?.getPosition) return;
  const hipsPosition = hips.getPosition();
  const headPosition = head.getPosition();
  const approximateHeight = Math.max(0.001, Math.abs(headPosition.y - hipsPosition.y) * 2.25);
  const scale = clamp(targetHeight / approximateHeight, 0.001, 1000);
  root.setLocalScale(scale, scale, scale);
  root.syncHierarchy?.();
  const feet = [leftFoot, rightFoot].filter((entry) => entry?.getPosition).map((entry) => entry.getPosition());
  const footY = feet.length ? Math.min(...feet.map((entry) => entry.y)) : 0;
  const center = hips.getPosition();
  const local = root.getLocalPosition?.() ?? { x: 0, y: 0, z: 0 };
  root.setLocalPosition(local.x - center.x, local.y - footY, local.z - center.z);
  root.syncHierarchy?.();
}

function animationSourceDescriptor(record) {
  return {
    id: record.id,
    fileName: record.fileName,
    mediaType: record.mediaType,
    clips: record.clips.map((clip) => ({ ...clip })),
    sourceProfileId: record.sourceProfile.id,
    targetProfileId: record.targetProfile.id,
  };
}

export class PlayCanvasMixamoAnimationWorkbench {
  constructor({
    app,
    characterHost = null,
    id = "hodos-animation-workbench",
    maximumAnimationSources = DEFAULT_MIXAMO_ANIMATION_MAX_SOURCES,
    maximumPoseKeys = DEFAULT_MIXAMO_ANIMATION_MAX_POSE_KEYS,
    onEvent = () => {},
  } = {}) {
    if (!app?.root || !app?.assets) throw new TypeError("Mixamo animation workbench requires a PlayCanvas Application");
    if (typeof onEvent !== "function") throw new TypeError("Mixamo animation workbench onEvent must be a function");
    this.app = app;
    this.id = requiredString(id, "Mixamo animation workbench id");
    this.host = characterHost ?? createPlayCanvasMixamoCharacterHost({ app, id: `${this.id}/characters` });
    this.ownsHost = !characterHost;
    this.maximumAnimationSources = positiveSafeInteger(
      maximumAnimationSources,
      DEFAULT_MIXAMO_ANIMATION_MAX_SOURCES,
      "maximumAnimationSources",
    );
    this.maximumPoseKeys = positiveSafeInteger(maximumPoseKeys, DEFAULT_MIXAMO_ANIMATION_MAX_POSE_KEYS, "maximumPoseKeys");
    this.onEvent = onEvent;
    this.character = null;
    this.animationSources = new Map();
    this.poseKeys = [];
    this.restPose = {};
    this.playback = { status: "idle", clipId: null, speed: 1, blend: 0 };
    this.sequence = { status: "idle", items: [], index: -1, remaining: 0 };
    this.stageEntities = [];
    this.previousAmbientLight = null;
    this.destroyed = false;
    this.updateBound = (deltaTime) => this.update(deltaTime);
    this.app.on?.("update", this.updateBound);
  }

  async open() {
    this.assertActive();
    this.installStage();
    return this.useProceduralCharacter();
  }

  useProceduralCharacter() {
    this.assertActive();
    this.clearCharacter();
    const mannequin = createProceduralMixamoMannequin(this.app);
    const descriptor = this.host.register(mannequin.root, {
      id: "hodos-mannequin",
      assetId: "builtin:hodos/mixamo-mannequin",
      mediaType: "model/gltf-binary",
    });
    const clips = [];
    for (const definition of builtInPoseDefinitions()) {
      const track = createMixamoPoseTrack({
        name: definition.label,
        duration: definition.duration,
        profile: descriptor.profile,
        keyframes: definition.keyframes,
      });
      clips.push(this.host.assignClip(descriptor.handle, definition.id, track, {
        state: definition.id,
        duration: definition.duration,
        loop: definition.loop,
        resourceId: `builtin:hodos/${definition.id}`,
      }));
    }
    this.character = {
      handle: descriptor.handle,
      root: mannequin.root,
      ownsRoot: true,
      source: "procedural",
    };
    this.restPose = capturePose(mannequin.root, descriptor.profile);
    const current = this.host.describe(descriptor.handle);
    this.play("idle", { blend: 0 });
    this.emit("animation/character-ready", { character: current, clips, message: "Loaded the rights-clean Hodos mannequin" });
    return this.snapshot();
  }

  async loadCharacter(source, {
    id = "local-character",
    assetId = null,
    fileName = null,
    autoScale = true,
  } = {}) {
    this.assertActive();
    this.clearCharacter();
    id = requiredString(id, "Animation demo character id");
    const descriptor = await this.host.load(source, {
      id,
      assetId: optionalString(assetId, "Animation demo character assetId")
        ?? `local:${sourceFileName(source, id)}`,
      fileName,
      autoplay: false,
    });
    const root = this.host.resolveEntity(descriptor.handle);
    if (autoScale) normalizeCharacterPlacement(root, descriptor.profile);
    this.character = { handle: descriptor.handle, root, ownsRoot: false, source: "local" };
    this.restPose = capturePose(root, descriptor.profile);
    const current = this.host.describe(descriptor.handle);
    const first = current.animation.clips[0];
    if (first) this.play(first.id, { blend: 0 });
    else this.playback = { status: "paused", clipId: null, speed: 1, blend: 0 };
    this.emit("animation/character-ready", {
      character: current,
      clips: current.animation.clips,
      message: `Loaded ${sourceFileName(source, id)} locally`,
    });
    return this.snapshot();
  }

  async loadAnimation(source, {
    id = null,
    fileName = null,
    mediaType = null,
    rootMotion = "none",
    loop = true,
    speed = 1,
  } = {}) {
    this.assertActive();
    const character = this.requireCharacter();
    if (this.animationSources.size >= this.maximumAnimationSources) {
      throw new PlayCanvasMixamoCharacterHostError(
        "mixamo/animation-source-limit",
        `Animation workbench reached its ${this.maximumAnimationSources} source limit`,
      );
    }
    const sourceName = sourceFileName(source, `animation-${this.animationSources.size + 1}.glb`);
    id = requiredString(id ?? clipIdentifier(sourceName.replace(/\.[^.]+$/, ""), "animation"), "Animation source id");
    if (this.animationSources.has(id)) {
      id = uniqueClipId(id, new Set(this.animationSources.keys()));
    }
    const prepared = this.host.prepareSource(source, { id, fileName, mediaType });
    let asset = null;
    let ownsAsset = false;
    let sourceRoot = null;
    try {
      ({ asset, owned: ownsAsset } = await this.host.loadContainerAsset(this.app, prepared));
      if (typeof asset?.resource?.instantiateRenderEntity !== "function") {
        throw new PlayCanvasMixamoCharacterHostError(
          "mixamo/animation-container",
          `${prepared.fileName} is not an instantiable animation GLB/glTF container`,
        );
      }
      sourceRoot = asset.resource.instantiateRenderEntity({ castShadows: false, receiveShadows: false });
      const sourceProfile = inspectPlayCanvasMixamoCharacter(sourceRoot, {
        id: `${id}/source-profile`,
        assetId: `local:${prepared.fileName}`,
        mediaType: prepared.mediaType,
      });
      if (sourceProfile.status !== "supported") {
        throw new PlayCanvasMixamoCharacterHostError(
          "mixamo/animation-skeleton",
          `${prepared.fileName} does not contain a compatible Mixamo skeleton`,
          { missingRequired: sourceProfile.missingRequired, errors: sourceProfile.diagnostics.errors },
        );
      }
      const target = this.host.describe(character.handle);
      const tracks = containerAnimations(asset);
      if (!tracks.length) {
        throw new PlayCanvasMixamoCharacterHostError(
          "mixamo/animation-empty",
          `${prepared.fileName} contains no animation tracks`,
        );
      }
      const used = new Set(target.animation.clips.map((clip) => clip.id));
      const clips = [];
      const evidence = [];
      for (let index = 0; index < tracks.length; index += 1) {
        const sourceAsset = tracks[index];
        const track = animationTrack(sourceAsset);
        if (!track) continue;
        const candidate = clipIdentifier(track.name ?? sourceAsset?.name, `${id}-${index + 1}`);
        const clipId = uniqueClipId(candidate, used);
        used.add(clipId);
        const retargeted = retargetMixamoAnimationTrack(track, sourceProfile, target.profile, {
          name: clipId,
          rootMotion,
        });
        clips.push(this.host.assignClip(character.handle, clipId, retargeted.track, {
          state: clipId,
          duration: retargeted.track.duration,
          loop,
          speed,
          resourceId: `animation-source:${id}:${index}`,
        }));
        evidence.push(retargeted.evidence);
      }
      if (!clips.length) {
        throw new PlayCanvasMixamoCharacterHostError(
          "mixamo/animation-empty",
          `${prepared.fileName} contains no assignable animation tracks`,
        );
      }
      this.animationSources.set(id, {
        id,
        app: this.app,
        asset,
        ownsAsset,
        fileName: prepared.fileName,
        mediaType: prepared.mediaType,
        sourceProfile,
        targetProfile: target.profile,
        clips,
        evidence,
      });
      this.emit("animation/clips-added", {
        source: animationSourceDescriptor(this.animationSources.get(id)),
        clips,
        message: `Added ${clips.length} clip${clips.length === 1 ? "" : "s"} from ${prepared.fileName}`,
      });
      return portableCopy({ source: animationSourceDescriptor(this.animationSources.get(id)), clips, evidence });
    } catch (error) {
      if (ownsAsset) {
        try {
          unloadAsset(this.app, asset);
        } catch {
          // Preserve the primary animation import failure.
        }
      }
      throw error;
    } finally {
      try {
        sourceRoot?.destroy?.();
      } catch {
        // Source skeleton inspection entities are transient.
      }
      try {
        prepared.revoke?.();
      } catch {
        // Object URL cleanup must not replace the import result.
      }
    }
  }

  play(clipId, { blend = 0.2, speed = 1 } = {}) {
    this.assertActive();
    const character = this.requireCharacter();
    const result = this.host.play(character.handle, requiredString(clipId, "Animation clip id"), {
      blend: clamp(finite(blend, 0.2, "Animation blend"), 0, 2),
      speed: clamp(finite(speed, 1, "Animation speed"), 0.05, 4),
    });
    this.playback = { status: "playing", clipId: result.clipId, speed: result.speed, blend: result.blend };
    this.emit("animation/playback", { playback: this.playback });
    return result;
  }

  pause() {
    this.assertActive();
    const character = this.requireCharacter();
    const paused = this.host.pause(character.handle);
    this.playback = { ...this.playback, status: paused ? "paused" : this.playback.status };
    this.emit("animation/playback", { playback: this.playback });
    return paused;
  }

  setJointRotation(joint, euler) {
    this.assertActive();
    const character = this.requireCharacter();
    joint = requiredString(joint, "Mixamo pose joint");
    if (!MIXAMO_ANIMATION_EDITABLE_JOINTS.includes(joint)) {
      throw new PlayCanvasMixamoCharacterHostError("mixamo/pose-joint", `Joint ${joint} is not exposed by the compact pose editor`);
    }
    this.pause();
    const descriptor = this.host.describe(character.handle);
    const node = nodeForJoint(character.root, descriptor.profile, joint);
    if (!node?.setLocalRotation) throw new PlayCanvasMixamoCharacterHostError("mixamo/pose-joint", `Unable to resolve joint ${joint}`);
    const rest = this.restPose[joint];
    if (!rest) throw new PlayCanvasMixamoCharacterHostError("mixamo/pose-rest", `No rest pose was captured for ${joint}`);
    const correctionEuler = normalizedEuler(euler);
    const correction = new Quat().setFromEulerAngles(...correctionEuler);
    const rotation = new Quat(...rest).mul(correction);
    node.setLocalRotation(rotation);
    return Object.freeze({ joint, euler: correctionEuler, quaternion: [rotation.x, rotation.y, rotation.z, rotation.w] });
  }

  capturePoseKey(at) {
    this.assertActive();
    const character = this.requireCharacter();
    at = Math.max(0, finite(at, 0, "Pose key time"));
    const descriptor = this.host.describe(character.handle);
    const key = Object.freeze({ at, joints: Object.freeze(capturePose(character.root, descriptor.profile)) });
    const remaining = this.poseKeys.filter((entry) => Math.abs(entry.at - at) > 1e-6);
    remaining.push(key);
    remaining.sort((left, right) => left.at - right.at);
    this.poseKeys = remaining.slice(-this.maximumPoseKeys);
    this.emit("animation/pose-captured", { key, poseKeyCount: this.poseKeys.length });
    return portableCopy(key);
  }

  clearPoseKeys() {
    this.poseKeys = [];
    this.emit("animation/pose-cleared", {});
  }

  resetPose() {
    const character = this.requireCharacter();
    const descriptor = this.host.describe(character.handle);
    this.pause();
    for (const [joint, value] of Object.entries(this.restPose)) {
      const node = nodeForJoint(character.root, descriptor.profile, joint);
      if (node?.setLocalRotation) node.setLocalRotation(new Quat(...value));
    }
    this.emit("animation/pose-reset", {});
  }

  bakePoseClip({
    id = "authored-pose",
    label = "Authored pose",
    duration = 2,
    loop = false,
  } = {}) {
    this.assertActive();
    const character = this.requireCharacter();
    if (this.poseKeys.length < 2) {
      throw new PlayCanvasMixamoCharacterHostError(
        "mixamo/pose-key-count",
        "Capture at least two timed poses before baking a clip",
      );
    }
    const descriptor = this.host.describe(character.handle);
    const used = new Set(descriptor.animation.clips.map((clip) => clip.id));
    const clipId = uniqueClipId(clipIdentifier(id, "authored-pose"), used);
    duration = Math.max(
      finite(duration, 2, "Authored pose duration"),
      this.poseKeys.at(-1)?.at ?? 0,
      0.25,
    );
    const track = createMixamoPoseTrack({
      name: requiredString(label, "Authored pose label"),
      duration,
      profile: descriptor.profile,
      keyframes: this.poseKeys,
      events: [{ name: "clip-complete", time: duration }],
    });
    const clip = this.host.assignClip(character.handle, clipId, track, {
      state: clipId,
      duration,
      loop,
      resourceId: `authored:${this.id}:${clipId}`,
    });
    this.emit("animation/clip-authored", { clip, poseKeyCount: this.poseKeys.length });
    return clip;
  }

  playSequence(items, { blend = 0.2, speed = 1 } = {}) {
    this.assertActive();
    const descriptor = this.host.describe(this.requireCharacter().handle);
    const clips = new Map(descriptor.animation.clips.map((clip) => [clip.id, clip]));
    const normalized = (items ?? []).map((item, index) => {
      const input = typeof item === "string" ? { clipId: item } : item;
      const clipId = requiredString(input?.clipId ?? input?.clip, `Sequence cue ${index} clip`);
      const clip = clips.get(clipId);
      if (!clip) throw new PlayCanvasMixamoCharacterHostError("mixamo/sequence-clip", `Sequence references missing clip ${clipId}`);
      if (!Number.isFinite(clip.duration) || clip.duration <= 0) {
        throw new PlayCanvasMixamoCharacterHostError("mixamo/sequence-duration", `Sequence clip ${clipId} needs a positive duration`);
      }
      return {
        id: optionalString(input?.id, `Sequence cue ${index} id`) ?? `cue:${index + 1}:${clipId}`,
        clipId,
        duration: clip.duration,
        blend: clamp(finite(input?.blend, blend, `Sequence cue ${index} blend`), 0, 2),
        speed: clamp(finite(input?.speed, speed, `Sequence cue ${index} speed`), 0.05, 4),
      };
    });
    if (!normalized.length) throw new PlayCanvasMixamoCharacterHostError("mixamo/sequence-empty", "Animation sequence requires at least one clip");
    this.sequence = { status: "playing", items: normalized, index: -1, remaining: 0 };
    this.advanceSequence();
    this.emit("animation/sequence-started", { items: normalized });
    return this.snapshot().sequence;
  }

  stopSequence({ message = "Sequence stopped" } = {}) {
    if (this.sequence.status === "idle") return false;
    this.sequence = { status: "idle", items: [], index: -1, remaining: 0 };
    this.emit("animation/sequence-stopped", { message });
    return true;
  }

  update(deltaTime) {
    if (this.sequence.status !== "playing") return;
    this.sequence.remaining -= Math.max(0, finite(deltaTime, 0, "Animation update delta"));
    if (this.sequence.remaining <= 0) this.advanceSequence();
  }

  advanceSequence() {
    const index = this.sequence.index + 1;
    if (index >= this.sequence.items.length) {
      const completed = this.sequence.items;
      this.sequence = { status: "complete", items: completed, index: completed.length - 1, remaining: 0 };
      this.emit("animation/sequence-complete", { items: completed });
      return;
    }
    const item = this.sequence.items[index];
    this.play(item.clipId, { blend: item.blend, speed: item.speed });
    this.sequence = {
      ...this.sequence,
      status: "playing",
      index,
      remaining: item.duration / item.speed,
    };
    this.emit("animation/sequence-cue", { cue: item, index });
  }

  snapshot() {
    const character = this.character ? this.host.describe(this.character.handle) : null;
    return portableCopy({
      schema: PLAYCANVAS_MIXAMO_ANIMATION_WORKBENCH_SCHEMA,
      id: this.id,
      character,
      animationSources: [...this.animationSources.values()].map(animationSourceDescriptor),
      poseKeys: this.poseKeys,
      playback: this.playback,
      sequence: this.sequence,
      capabilities: [
        "character.load",
        "character.animation",
        "animation.import",
        "animation.pose-authoring",
        "animation.sequence",
      ],
    });
  }

  installStage() {
    if (this.stageEntities.length) return;
    this.previousAmbientLight = this.app.scene.ambientLight?.clone?.() ?? this.app.scene.ambientLight ?? null;
    this.app.scene.ambientLight = new Color(0.19, 0.22, 0.2);
    const floor = new Entity("Animation floor");
    floor.setLocalPosition(0, -0.05, 0);
    floor.setLocalScale(8, 0.08, 8);
    floor.addComponent("render", {
      type: "box",
      material: material([0.055, 0.075, 0.065], { gloss: 0.3 }),
      receiveShadows: true,
    });
    const key = new Entity("Animation key light");
    key.setLocalEulerAngles(42, 35, 0);
    key.addComponent("light", {
      type: "directional",
      color: new Color(1, 0.86, 0.61),
      intensity: 1.35,
      castShadows: true,
      shadowResolution: 1024,
    });
    const fill = new Entity("Animation fill light");
    fill.setLocalPosition(-2.5, 2.8, 2.4);
    fill.addComponent("light", {
      type: "omni",
      color: new Color(0.3, 0.72, 0.72),
      intensity: 0.75,
      range: 8,
    });
    this.app.root.addChild(floor);
    this.app.root.addChild(key);
    this.app.root.addChild(fill);
    this.stageEntities.push(floor, key, fill);
  }

  clearCharacter() {
    this.stopSequence({ message: "Sequence cleared" });
    const current = this.character;
    if (current) {
      try {
        this.host.release(current.handle);
      } finally {
        if (current.ownsRoot) current.root?.destroy?.();
      }
    }
    this.character = null;
    this.restPose = {};
    this.poseKeys = [];
    this.playback = { status: "idle", clipId: null, speed: 1, blend: 0 };
    this.releaseAnimationSources();
  }

  releaseAnimationSources() {
    let failure = null;
    for (const record of this.animationSources.values()) {
      if (!record.ownsAsset) continue;
      try {
        unloadAsset(record.app, record.asset);
      } catch (error) {
        failure ??= error;
      }
    }
    this.animationSources.clear();
    if (failure) throw failure;
  }

  requireCharacter() {
    if (!this.character) throw new PlayCanvasMixamoCharacterHostError("mixamo/character-missing", "Animation workbench has no active character");
    return this.character;
  }

  emit(type, details) {
    try {
      this.onEvent(portableCopy({ type, at: Date.now(), ...details }));
    } catch (error) {
      console.error("Hodos animation workbench event failed", error);
    }
  }

  assertActive() {
    if (this.destroyed) throw new PlayCanvasMixamoCharacterHostError("mixamo/workbench-destroyed", "Mixamo animation workbench was destroyed");
  }

  destroy() {
    if (this.destroyed) return;
    let failure = null;
    try {
      this.clearCharacter();
    } catch (error) {
      failure = error;
    }
    for (const entity of this.stageEntities.splice(0)) {
      try {
        entity.destroy?.();
      } catch (error) {
        failure ??= error;
      }
    }
    this.app.off?.("update", this.updateBound);
    if (this.previousAmbientLight) this.app.scene.ambientLight = this.previousAmbientLight;
    this.previousAmbientLight = null;
    if (this.ownsHost) {
      try {
        this.host.destroy();
      } catch (error) {
        failure ??= error;
      }
    }
    this.destroyed = true;
    if (failure) throw failure;
  }
}

export function createPlayCanvasMixamoAnimationWorkbench(options) {
  return new PlayCanvasMixamoAnimationWorkbench(options);
}
