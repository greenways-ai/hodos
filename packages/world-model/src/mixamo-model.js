import {
  clonePortable,
  isPlainObject,
  issue,
  optionalString,
  requiredString,
  safeInteger,
  validationResult,
} from "./model-values.js";

export const MIXAMO_PROFILE_SCHEMA = "hodos.mixamo-profile/0-alpha";
export const MIXAMO_RETARGET_PLAN_SCHEMA = "hodos.mixamo-retarget-plan/0-alpha";
export const MIXAMO_PROVIDER_ID = "mixamo/humanoid";
export const MIXAMO_PROVIDER_VERSION = "0-alpha.1";

export const MIXAMO_SUPPORTED_MEDIA_TYPES = Object.freeze([
  "model/gltf-binary",
  "model/gltf+json",
]);

export const MIXAMO_CORE_JOINTS = Object.freeze([
  "hips",
  "spine",
  "spine-1",
  "spine-2",
  "neck",
  "head",
  "left-shoulder",
  "left-arm",
  "left-forearm",
  "left-hand",
  "right-shoulder",
  "right-arm",
  "right-forearm",
  "right-hand",
  "left-up-leg",
  "left-leg",
  "left-foot",
  "right-up-leg",
  "right-leg",
  "right-foot",
]);

const OPTIONAL_BASE_JOINTS = [
  "head-top-end",
  "left-toe-base",
  "left-toe-end",
  "right-toe-base",
  "right-toe-end",
];
const OPTIONAL_FINGERS = ["thumb", "index", "middle", "ring", "pinky"]
  .flatMap((finger) => [1, 2, 3].flatMap((segment) => [
    `left-hand-${finger}-${segment}`,
    `right-hand-${finger}-${segment}`,
  ]));

export const MIXAMO_OPTIONAL_JOINTS = Object.freeze([
  ...OPTIONAL_BASE_JOINTS,
  ...OPTIONAL_FINGERS,
]);

export const MIXAMO_JOINTS = Object.freeze([
  ...MIXAMO_CORE_JOINTS,
  ...MIXAMO_OPTIONAL_JOINTS,
]);

const JOINT_SET = new Set(MIXAMO_JOINTS);
const CORE_JOINT_SET = new Set(MIXAMO_CORE_JOINTS);
const ROOT_MOTION_MODES = new Set(["none", "extract", "apply"]);

const MIXAMO_PARENTS = Object.freeze({
  hips: null,
  spine: "hips",
  "spine-1": "spine",
  "spine-2": "spine-1",
  neck: "spine-2",
  head: "neck",
  "head-top-end": "head",
  "left-shoulder": "spine-2",
  "left-arm": "left-shoulder",
  "left-forearm": "left-arm",
  "left-hand": "left-forearm",
  "right-shoulder": "spine-2",
  "right-arm": "right-shoulder",
  "right-forearm": "right-arm",
  "right-hand": "right-forearm",
  "left-up-leg": "hips",
  "left-leg": "left-up-leg",
  "left-foot": "left-leg",
  "left-toe-base": "left-foot",
  "left-toe-end": "left-toe-base",
  "right-up-leg": "hips",
  "right-leg": "right-up-leg",
  "right-foot": "right-leg",
  "right-toe-base": "right-foot",
  "right-toe-end": "right-toe-base",
  ...Object.fromEntries(OPTIONAL_FINGERS.map((joint) => {
    const match = /^(left|right)-hand-(thumb|index|middle|ring|pinky)-(\d)$/.exec(joint);
    const [, side, finger, segment] = match;
    return [joint, Number(segment) === 1 ? `${side}-hand` : `${side}-hand-${finger}-${Number(segment) - 1}`];
  })),
});

const SIMPLE_ALIASES = Object.freeze({
  hips: "hips",
  spine: "spine",
  spine1: "spine-1",
  spine2: "spine-2",
  neck: "neck",
  head: "head",
  headtopend: "head-top-end",
  leftshoulder: "left-shoulder",
  leftarm: "left-arm",
  leftforearm: "left-forearm",
  lefthand: "left-hand",
  rightshoulder: "right-shoulder",
  rightarm: "right-arm",
  rightforearm: "right-forearm",
  righthand: "right-hand",
  leftupleg: "left-up-leg",
  leftleg: "left-leg",
  leftfoot: "left-foot",
  lefttoebase: "left-toe-base",
  lefttoeend: "left-toe-end",
  rightupleg: "right-up-leg",
  rightleg: "right-leg",
  rightfoot: "right-foot",
  righttoebase: "right-toe-base",
  righttoeend: "right-toe-end",
});

function nonNegativeInteger(value, fallback, label) {
  return safeInteger(value, fallback, label, 0);
}

function nodeIdentifier(value, fallback, label) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Number.isSafeInteger(value) && value >= 0) return `node:${value}`;
  if (value === null || value === undefined) return fallback;
  throw new TypeError(`${label} must be a non-empty string or non-negative integer`);
}

function nodeName(value, label) {
  return requiredString(value, label);
}

function rawLeafName(value) {
  const raw = requiredString(value, "Mixamo joint name");
  const pathLeaf = raw.split(/[|/\\]/).at(-1);
  return pathLeaf.split(":").at(-1);
}

export function hasMixamoJointPrefix(value) {
  return /(?:^|[|/\\:])mixamorig(?:[:_\-\s]|[A-Z])/i.test(String(value))
    || /(?:^|[|/\\:])mixamo(?:[:_\-\s]|[A-Z])/i.test(String(value));
}

export function normalizeMixamoJointName(value) {
  let leaf = rawLeafName(value)
    .replace(/^mixamorig[:_\-\s]*/i, "")
    .replace(/^mixamo[:_\-\s]*/i, "");
  const compact = leaf.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const simple = SIMPLE_ALIASES[compact];
  if (simple) return simple;
  const finger = /^(left|right)hand(thumb|index|middle|ring|pinky)([123])$/.exec(compact);
  if (finger) return `${finger[1]}-hand-${finger[2]}-${finger[3]}`;
  return null;
}

function normalizeSkeletonNodes(value, maximumNodes) {
  if (!Array.isArray(value)) throw new TypeError("Mixamo skeleton nodes must be an array");
  if (value.length > maximumNodes) {
    throw new TypeError(`Mixamo skeleton exceeds the ${maximumNodes} node limit`);
  }
  const output = value.map((entry, index) => {
    if (typeof entry === "string") {
      return {
        id: `node:${index}`,
        name: nodeName(entry, `Mixamo skeleton node ${index} name`),
        parentId: null,
      };
    }
    if (!isPlainObject(entry)) throw new TypeError(`Mixamo skeleton node ${index} must be an object or name`);
    const id = nodeIdentifier(entry.id ?? entry.nodeId ?? entry.guid ?? entry.index, `node:${index}`, `Mixamo skeleton node ${index} id`);
    const rawParent = entry.parentId ?? entry.parentNodeId ?? entry.parentIndex ?? null;
    return {
      id,
      name: nodeName(entry.name ?? entry.nodeName, `Mixamo skeleton node ${index} name`),
      parentId: rawParent === null || rawParent === undefined
        ? null
        : nodeIdentifier(rawParent, null, `Mixamo skeleton node ${index} parent`),
    };
  });
  const ids = new Set();
  for (const node of output) {
    if (ids.has(node.id)) throw new Error(`Mixamo skeleton repeats node id ${node.id}`);
    ids.add(node.id);
  }
  for (const node of output) {
    if (node.parentId !== null && !ids.has(node.parentId)) {
      throw new Error(`Mixamo skeleton node ${node.id} references missing parent ${node.parentId}`);
    }
  }
  return output;
}

function recognizedAncestor(node, nodeById, jointByNodeId) {
  let parentId = node.parentId;
  const seen = new Set();
  for (let depth = 0; parentId !== null && depth < 64; depth += 1) {
    if (seen.has(parentId)) return { joint: null, cycle: true };
    seen.add(parentId);
    if (jointByNodeId.has(parentId)) return { joint: jointByNodeId.get(parentId), cycle: false };
    parentId = nodeById.get(parentId)?.parentId ?? null;
  }
  return { joint: null, cycle: false };
}

function diagnostic(code, path, message, severity = "error") {
  return issue(code, path, message, severity);
}

export function inspectMixamoSkeleton(nodesValue, {
  id = "mixamo/profile",
  assetId = null,
  revision = 0,
  mediaType = "model/gltf-binary",
  maximumNodes = 1024,
  unknownNameLimit = 32,
} = {}) {
  const nodes = normalizeSkeletonNodes(nodesValue, nonNegativeInteger(maximumNodes, 1024, "Mixamo maximumNodes"));
  id = requiredString(id, "Mixamo profile id");
  assetId = optionalString(assetId, "Mixamo profile assetId");
  revision = nonNegativeInteger(revision, 0, "Mixamo profile revision");
  mediaType = requiredString(mediaType, "Mixamo profile mediaType");
  unknownNameLimit = nonNegativeInteger(unknownNameLimit, 32, "Mixamo unknownNameLimit");

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const candidates = new Map();
  const jointByNodeId = new Map();
  const unknownNames = [];
  let prefixedNames = 0;

  for (const node of nodes) {
    if (hasMixamoJointPrefix(node.name)) prefixedNames += 1;
    const joint = normalizeMixamoJointName(node.name);
    if (!joint) {
      if (unknownNames.length < unknownNameLimit) unknownNames.push(node.name);
      continue;
    }
    if (!candidates.has(joint)) candidates.set(joint, []);
    candidates.get(joint).push(node);
    jointByNodeId.set(node.id, joint);
  }

  const errors = [];
  const warnings = [];
  if (!MIXAMO_SUPPORTED_MEDIA_TYPES.includes(mediaType)) {
    errors.push(diagnostic(
      "mixamo/media-type",
      "$.source.mediaType",
      `Mixamo runtime support requires converted glTF or GLB, not ${mediaType}`,
    ));
  }

  const missingRequired = MIXAMO_CORE_JOINTS.filter((joint) => !candidates.has(joint));
  for (const joint of missingRequired) {
    errors.push(diagnostic(
      "mixamo/missing-joint",
      `$.joints.${joint}`,
      `Mixamo skeleton is missing required joint ${joint}`,
    ));
  }

  const duplicateJoints = [];
  for (const [joint, entries] of candidates) {
    if (entries.length <= 1) continue;
    duplicateJoints.push(joint);
    errors.push(diagnostic(
      "mixamo/duplicate-joint",
      `$.joints.${joint}`,
      `Mixamo skeleton maps ${entries.length} nodes to ${joint}`,
    ));
  }

  const joints = {};
  const parentMismatches = [];
  for (const joint of MIXAMO_JOINTS) {
    const entries = candidates.get(joint);
    if (!entries || entries.length !== 1) continue;
    const node = entries[0];
    const ancestor = recognizedAncestor(node, nodeById, jointByNodeId);
    if (ancestor.cycle) {
      errors.push(diagnostic(
        "mixamo/hierarchy-cycle",
        `$.joints.${joint}`,
        `Mixamo skeleton hierarchy cycles above ${joint}`,
      ));
    }
    const expectedParent = MIXAMO_PARENTS[joint] ?? null;
    const parentJoint = ancestor.joint;
    if (expectedParent !== null && parentJoint !== null && expectedParent !== parentJoint) {
      parentMismatches.push(joint);
      warnings.push(diagnostic(
        "mixamo/parent-mismatch",
        `$.joints.${joint}.parentJoint`,
        `Mixamo joint ${joint} is below ${parentJoint}; expected ${expectedParent}`,
        "warning",
      ));
    }
    joints[joint] = {
      joint,
      nodeId: node.id,
      nodeName: node.name,
      parentJoint,
      parentNodeId: node.parentId,
    };
  }

  if (prefixedNames === 0 && missingRequired.length === 0) {
    warnings.push(diagnostic(
      "mixamo/prefix-stripped",
      "$.source.namespace",
      "Skeleton is Mixamo-compatible but its mixamorig namespace was stripped during conversion",
      "warning",
    ));
  }

  const status = errors.length === 0 ? "supported" : "unsupported";
  const profile = {
    schema: MIXAMO_PROFILE_SCHEMA,
    id,
    revision,
    assetId,
    provider: {
      id: MIXAMO_PROVIDER_ID,
      version: MIXAMO_PROVIDER_VERSION,
    },
    family: prefixedNames > 0 ? "mixamo" : "mixamo-compatible",
    status,
    rootJoint: joints.hips ? "hips" : null,
    source: {
      mediaType,
      nodeCount: nodes.length,
      recognizedNodeCount: jointByNodeId.size,
      prefixedNameCount: prefixedNames,
      unknownNameCount: nodes.length - jointByNodeId.size,
      unknownNames,
    },
    joints,
    missingRequired,
    duplicateJoints,
    parentMismatches,
    capabilities: status === "supported"
      ? ["character.animation", "mixamo.same-family-retarget"]
      : [],
    diagnostics: {
      errors,
      warnings,
    },
  };
  return clonePortable(profile);
}

function normalizeDiagnosticList(value, path) {
  if (!Array.isArray(value ?? [])) throw new TypeError(`${path} must be an array`);
  return clonePortable(value ?? []);
}

export function normalizeMixamoProfile(value, label = "Mixamo profile") {
  const profile = clonePortable(value);
  if (!isPlainObject(profile)) throw new TypeError(`${label} must be an object`);
  if ((profile.schema ?? MIXAMO_PROFILE_SCHEMA) !== MIXAMO_PROFILE_SCHEMA) {
    throw new Error(`${label} has unsupported schema: ${String(profile.schema)}`);
  }
  const jointsInput = profile.joints ?? {};
  if (!isPlainObject(jointsInput)) throw new TypeError(`${label}.joints must be an object`);
  const joints = {};
  const nodeIds = new Set();
  for (const joint of Object.keys(jointsInput).sort()) {
    if (!JOINT_SET.has(joint)) throw new Error(`${label} contains unsupported joint ${joint}`);
    const entry = jointsInput[joint];
    if (!isPlainObject(entry)) throw new TypeError(`${label}.joints.${joint} must be an object`);
    const nodeId = requiredString(entry.nodeId, `${label}.joints.${joint}.nodeId`);
    if (nodeIds.has(nodeId)) throw new Error(`${label} maps node ${nodeId} more than once`);
    nodeIds.add(nodeId);
    joints[joint] = {
      joint,
      nodeId,
      nodeName: requiredString(entry.nodeName, `${label}.joints.${joint}.nodeName`),
      parentJoint: optionalString(entry.parentJoint, `${label}.joints.${joint}.parentJoint`),
      parentNodeId: optionalString(entry.parentNodeId, `${label}.joints.${joint}.parentNodeId`),
    };
  }
  const missingRequired = MIXAMO_CORE_JOINTS.filter((joint) => !joints[joint]);
  const status = requiredString(profile.status ?? (missingRequired.length ? "unsupported" : "supported"), `${label}.status`);
  if (!new Set(["supported", "unsupported"]).has(status)) {
    throw new Error(`${label}.status has unsupported value: ${status}`);
  }
  if (status === "supported" && missingRequired.length) {
    throw new Error(`${label} claims support while missing ${missingRequired.join(", ")}`);
  }
  const mediaType = requiredString(profile.source?.mediaType ?? "model/gltf-binary", `${label}.source.mediaType`);
  return {
    schema: MIXAMO_PROFILE_SCHEMA,
    id: requiredString(profile.id, `${label}.id`),
    revision: nonNegativeInteger(profile.revision, 0, `${label}.revision`),
    assetId: optionalString(profile.assetId, `${label}.assetId`),
    provider: {
      id: requiredString(profile.provider?.id ?? MIXAMO_PROVIDER_ID, `${label}.provider.id`),
      version: requiredString(profile.provider?.version ?? MIXAMO_PROVIDER_VERSION, `${label}.provider.version`),
    },
    family: requiredString(profile.family ?? "mixamo-compatible", `${label}.family`),
    status,
    rootJoint: optionalString(profile.rootJoint, `${label}.rootJoint`),
    source: {
      mediaType,
      nodeCount: nonNegativeInteger(profile.source?.nodeCount, Object.keys(joints).length, `${label}.source.nodeCount`),
      recognizedNodeCount: nonNegativeInteger(profile.source?.recognizedNodeCount, Object.keys(joints).length, `${label}.source.recognizedNodeCount`),
      prefixedNameCount: nonNegativeInteger(profile.source?.prefixedNameCount, 0, `${label}.source.prefixedNameCount`),
      unknownNameCount: nonNegativeInteger(profile.source?.unknownNameCount, 0, `${label}.source.unknownNameCount`),
      unknownNames: Array.isArray(profile.source?.unknownNames) ? profile.source.unknownNames.map(String) : [],
    },
    joints,
    missingRequired,
    duplicateJoints: Array.isArray(profile.duplicateJoints) ? profile.duplicateJoints.map(String) : [],
    parentMismatches: Array.isArray(profile.parentMismatches) ? profile.parentMismatches.map(String) : [],
    capabilities: Array.isArray(profile.capabilities) ? profile.capabilities.map(String) : [],
    diagnostics: {
      errors: normalizeDiagnosticList(profile.diagnostics?.errors, `${label}.diagnostics.errors`),
      warnings: normalizeDiagnosticList(profile.diagnostics?.warnings, `${label}.diagnostics.warnings`),
    },
  };
}

export function validateMixamoProfile(value) {
  try {
    const profile = normalizeMixamoProfile(value);
    const errors = profile.status === "supported" ? [] : profile.diagnostics.errors;
    return validationResult(errors, profile.diagnostics.warnings);
  } catch (error) {
    return validationResult([
      diagnostic("mixamo/profile-invalid", "$", error instanceof Error ? error.message : String(error)),
    ]);
  }
}

export function createMixamoRetargetPlan(sourceValue, targetValue, {
  id = null,
  rootMotion = "none",
  includeOptional = true,
} = {}) {
  const source = normalizeMixamoProfile(sourceValue, "Mixamo source profile");
  const target = normalizeMixamoProfile(targetValue, "Mixamo target profile");
  if (source.status !== "supported") throw new Error(`Mixamo source profile is unsupported: ${source.id}`);
  if (target.status !== "supported") throw new Error(`Mixamo target profile is unsupported: ${target.id}`);
  rootMotion = requiredString(rootMotion, "Mixamo retarget rootMotion");
  if (!ROOT_MOTION_MODES.has(rootMotion)) {
    throw new Error(`Mixamo retarget rootMotion has unsupported value: ${rootMotion}`);
  }
  const jointOrder = includeOptional === false ? MIXAMO_CORE_JOINTS : MIXAMO_JOINTS;
  const joints = jointOrder
    .filter((joint) => source.joints[joint] && target.joints[joint])
    .map((joint) => ({
      joint,
      sourceNodeId: source.joints[joint].nodeId,
      sourceNodeName: source.joints[joint].nodeName,
      targetNodeId: target.joints[joint].nodeId,
      targetNodeName: target.joints[joint].nodeName,
    }));
  const mapped = new Set(joints.map(({ joint }) => joint));
  const missingCore = MIXAMO_CORE_JOINTS.filter((joint) => !mapped.has(joint));
  if (missingCore.length) throw new Error(`Mixamo retarget plan cannot map ${missingCore.join(", ")}`);
  const sourceOptional = MIXAMO_OPTIONAL_JOINTS.filter((joint) => source.joints[joint]);
  const targetOptional = MIXAMO_OPTIONAL_JOINTS.filter((joint) => target.joints[joint]);
  const plan = {
    schema: MIXAMO_RETARGET_PLAN_SCHEMA,
    id: requiredString(id ?? `${source.id}->${target.id}`, "Mixamo retarget plan id"),
    mode: "same-family",
    family: "mixamo",
    provider: {
      id: MIXAMO_PROVIDER_ID,
      version: MIXAMO_PROVIDER_VERSION,
    },
    sourceProfileId: source.id,
    targetProfileId: target.id,
    rootMotion,
    translationPolicy: rootMotion === "none" ? "discard" : "hips-only",
    rotationPolicy: "copy-local",
    scalePolicy: "target-rest-scale",
    joints,
    pathMap: Object.fromEntries(joints.map((entry) => [entry.sourceNodeName, entry.targetNodeName])),
    unmappedSourceOptional: sourceOptional.filter((joint) => !mapped.has(joint)),
    unmappedTargetOptional: targetOptional.filter((joint) => !mapped.has(joint)),
  };
  return clonePortable(plan);
}

export function mixamoProfileSupported(value) {
  try {
    return normalizeMixamoProfile(value).status === "supported";
  } catch {
    return false;
  }
}

export function mixamoCoreJoint(value) {
  const joint = normalizeMixamoJointName(value);
  return joint !== null && CORE_JOINT_SET.has(joint) ? joint : null;
}
