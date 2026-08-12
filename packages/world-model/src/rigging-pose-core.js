import {
  AXES,
  clonePortable,
  isPlainObject,
  optionalString,
  portableIssues,
  requiredString,
  safeInteger,
  vector,
} from "./rigging-values.js";
import { normalizeRigDocument } from "./rigging-validation.js";

export const RIG_POSE_SCHEMA = "hodos.rig-pose/0-alpha";
export const RIG_POSE_SUITE_SCHEMA = "hodos.rig-pose-suite/0-alpha";
export const RIG_POSE_OUTCOME_SCHEMA = "hodos.rig-pose-outcome/0-alpha";
export const RIG_POSE_SUITE_OUTCOME_SCHEMA = "hodos.rig-pose-suite-outcome/0-alpha";
export const RIG_POSE_INTENT_SCHEMA = "hodos.rig-pose-intent/0-alpha";
export const RIG_POSE_INTENT_OUTCOME_SCHEMA = "hodos.rig-pose-intent-outcome/0-alpha";
export const RIG_POSE_INTENT_TYPES = Object.freeze([
  "pose/joint-set",
  "pose/joint-remove",
  "pose/reset",
]);
export const RIG_POSE_LIMIT_POLICIES = Object.freeze(["warn", "reject", "ignore"]);

const MAX_POSE_OVERRIDES = 1024;
const MAX_POSE_CHAINS = 128;
const MAX_POSE_CASES = 128;
const MAX_CHAIN_JOINTS = 256;
const MAX_POSE_VIOLATIONS = 64;
const EPSILON = 1e-8;

export class RigPoseValidationError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = "RigPoseValidationError";
    this.issues = issues.map((entry) => ({ ...entry }));
  }
}

function canonicalQuaternion(value, path) {
  const quaternion = vector(value, [0, 0, 0, 1], 4, path);
  const length = Math.hypot(...quaternion);
  if (length <= Number.EPSILON) throw new TypeError(`${path} cannot be a zero quaternion`);
  if (Math.abs(1 - length) > 1e-5) throw new TypeError(`${path} must be a normalized quaternion`);
  const normalized = quaternion.map((entry) => entry / length);
  return normalized[3] < 0 ? normalized.map((entry) => -entry) : normalized;
}

function normalizedVector(value, fallback, path) {
  const result = vector(value, fallback, 3, path);
  const length = Math.hypot(...result);
  if (length <= EPSILON) throw new TypeError(`${path} cannot be a zero vector`);
  return result.map((entry) => entry / length);
}

function normalizePoseJoint(value, index) {
  if (!isPlainObject(value)) throw new TypeError(`joints[${index}] must be an object`);
  const translation = value.translation === undefined || value.translation === null
    ? null
    : vector(value.translation, [0, 0, 0], 3, `joints[${index}].translation`);
  const rotation = value.rotation === undefined || value.rotation === null
    ? null
    : canonicalQuaternion(value.rotation, `joints[${index}].rotation`);
  if (translation === null && rotation === null) {
    throw new TypeError(`joints[${index}] requires translation or rotation`);
  }
  return {
    jointId: requiredString(value.jointId, `joints[${index}].jointId`),
    translation,
    rotation,
  };
}

function normalizePoseMetadata(value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw new TypeError("metadata must be an object");
  return clonePortable(value);
}

export function normalizeRigPose(value = {}, { maxOverrides = MAX_POSE_OVERRIDES } = {}) {
  if (!Number.isSafeInteger(maxOverrides) || maxOverrides <= 0) {
    throw new TypeError("maxOverrides must be a positive safe integer");
  }
  const issues = portableIssues(value);
  if (issues.length) throw new RigPoseValidationError("Rig pose contains non-portable values", issues);
  if (!isPlainObject(value)) throw new RigPoseValidationError("Rig pose must be an object");
  try {
    const joints = (value.joints ?? []).map(normalizePoseJoint);
    if (joints.length > maxOverrides) {
      throw new RangeError(`Pose override count exceeds the bounded limit of ${maxOverrides}`);
    }
    const ids = new Set();
    for (const joint of joints) {
      if (ids.has(joint.jointId)) throw new RangeError(`Duplicate pose joint: ${joint.jointId}`);
      ids.add(joint.jointId);
    }
    joints.sort((left, right) => left.jointId.localeCompare(right.jointId));
    const schema = value.schema ?? RIG_POSE_SCHEMA;
    if (schema !== RIG_POSE_SCHEMA) throw new TypeError(`Expected ${RIG_POSE_SCHEMA}`);
    return {
      schema,
      id: requiredString(value.id, "id"),
      revision: safeInteger(value.revision, 0, "revision", 0),
      rigId: requiredString(value.rigId, "rigId"),
      rigRevision: safeInteger(value.rigRevision, 0, "rigRevision", 0),
      name: value.name === undefined ? requiredString(value.id, "id") : requiredString(value.name, "name"),
      description: optionalString(value.description, "description"),
      joints,
      metadata: normalizePoseMetadata(value.metadata),
    };
  } catch (error) {
    throw error instanceof RigPoseValidationError
      ? error
      : new RigPoseValidationError(error.message);
  }
}

export function createRigPose({
  id,
  rigId,
  rigRevision = 0,
  name,
  description,
  joints = [],
  metadata,
} = {}) {
  return normalizeRigPose({
    schema: RIG_POSE_SCHEMA,
    id,
    revision: 0,
    rigId,
    rigRevision,
    name,
    description,
    joints,
    metadata,
  });
}

function assertPoseMatchesRig(document, pose) {
  if (pose.schema !== RIG_POSE_SCHEMA) throw new RigPoseValidationError(`Expected ${RIG_POSE_SCHEMA}`);
  if (pose.rigId !== document.id) {
    throw new RigPoseValidationError(`Pose rig identity ${pose.rigId} does not match ${document.id}`);
  }
  if (pose.rigRevision !== document.revision) {
    throw new RigPoseValidationError(`Stale rig pose: expected rig revision ${pose.rigRevision}, found ${document.revision}`);
  }
  const jointIds = new Set(document.joints.map((joint) => joint.id));
  for (const override of pose.joints) {
    if (!jointIds.has(override.jointId)) throw new RigPoseValidationError(`Unknown pose joint: ${override.jointId}`);
  }
  return pose;
}

export function normalizeRigPoseForRig(documentValue, poseValue, options = {}) {
  const document = normalizeRigDocument(documentValue);
  const pose = normalizeRigPose(poseValue, options);
  return assertPoseMatchesRig(document, pose);
}

function nextPoseRevision(pose, joints) {
  return normalizeRigPose({ ...pose, revision: pose.revision + 1, joints });
}

export function setRigPoseJoint(poseValue, jointIdValue, patch = {}) {
  const pose = normalizeRigPose(poseValue);
  const jointId = requiredString(jointIdValue, "jointId");
  if (!isPlainObject(patch)) throw new TypeError("Pose joint patch must be an object");
  const current = pose.joints.find((entry) => entry.jointId === jointId) ?? {
    jointId,
    translation: null,
    rotation: null,
  };
  const next = {
    jointId,
    translation: patch.translation === undefined
      ? current.translation
      : patch.translation === null
        ? null
        : vector(patch.translation, [0, 0, 0], 3, "patch.translation"),
    rotation: patch.rotation === undefined
      ? current.rotation
      : patch.rotation === null
        ? null
        : canonicalQuaternion(patch.rotation, "patch.rotation"),
  };
  const joints = pose.joints.filter((entry) => entry.jointId !== jointId);
  if (next.translation !== null || next.rotation !== null) joints.push(next);
  return nextPoseRevision(pose, joints);
}

export function removeRigPoseJoint(poseValue, jointIdValue) {
  const pose = normalizeRigPose(poseValue);
  const jointId = requiredString(jointIdValue, "jointId");
  return nextPoseRevision(pose, pose.joints.filter((entry) => entry.jointId !== jointId));
}

export function resetRigPose(poseValue) {
  const pose = normalizeRigPose(poseValue);
  return nextPoseRevision(pose, []);
}

function quaternionMultiply(left, right) {
  const [ax, ay, az, aw] = left;
  const [bx, by, bz, bw] = right;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function quaternionConjugate(value) {
  return [-value[0], -value[1], -value[2], value[3]];
}

function rotateVector(quaternion, value) {
  const [x, y, z, w] = quaternion;
  const [vx, vy, vz] = value;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

function normalizedQuaternion(value, path) {
  const length = Math.hypot(...value);
  if (length <= Number.EPSILON) throw new RigPoseValidationError(`${path} produced a zero quaternion`);
  const result = value.map((entry) => entry / length);
  return result[3] < 0 ? result.map((entry) => -entry) : result;
}

export function rigPoseLocalTransforms(documentValue, poseValue) {
  const document = normalizeRigDocument(documentValue);
  const pose = normalizeRigPoseForRig(document, poseValue);
  const overrideById = new Map(pose.joints.map((entry) => [entry.jointId, entry]));
  return document.joints.map((joint, index) => {
    const override = overrideById.get(joint.id);
    const deltaRotation = override?.rotation ?? [0, 0, 0, 1];
    return {
      id: joint.id,
      index,
      parent: joint.parent,
      role: joint.role,
      translation: joint.rest.translation.map((entry, axis) => entry + (override?.translation?.[axis] ?? 0)),
      rotation: normalizedQuaternion(quaternionMultiply(joint.rest.rotation, deltaRotation), `pose.${joint.id}.rotation`),
      scale: [...joint.rest.scale],
      deltaTranslation: override?.translation ? [...override.translation] : [0, 0, 0],
      deltaRotation: [...deltaRotation],
      overridden: Boolean(override),
    };
  });
}

export function rigPoseWorldTransforms(documentValue, poseValue) {
  const local = rigPoseLocalTransforms(documentValue, poseValue);
  const localById = new Map(local.map((entry) => [entry.id, entry]));
  const worldById = new Map();
  function resolve(id) {
    if (worldById.has(id)) return worldById.get(id);
    const joint = localById.get(id);
    let world;
    if (!joint.parent) {
      world = {
        translation: [...joint.translation],
        rotation: [...joint.rotation],
        scale: [...joint.scale],
      };
    } else {
      const parent = resolve(joint.parent);
      const scaled = joint.translation.map((entry, axis) => entry * parent.scale[axis]);
      const rotated = rotateVector(parent.rotation, scaled);
      world = {
        translation: rotated.map((entry, axis) => entry + parent.translation[axis]),
        rotation: normalizedQuaternion(quaternionMultiply(parent.rotation, joint.rotation), `world.${id}.rotation`),
        scale: joint.scale.map((entry, axis) => entry * parent.scale[axis]),
      };
    }
    worldById.set(id, world);
    return world;
  }
  return local.map((joint) => ({ ...joint, ...resolve(joint.id) }));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function wrapRadians(value) {
  let result = value;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function quaternionToEulerXYZ(quaternion) {
  const [x, y, z, w] = quaternion;
  return [
    Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)),
    Math.asin(clamp(2 * (w * y - z * x), -1, 1)),
    Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)),
  ].map(wrapRadians);
}

function defaultLimitAxis(document, joint) {
  const ownLength = Math.hypot(...joint.rest.translation);
  if (ownLength > EPSILON) return joint.rest.translation.map((entry) => entry / ownLength);
  const child = document.joints.find((candidate) => candidate.parent === joint.id
    && Math.hypot(...candidate.rest.translation) > EPSILON);
  if (child) return normalizedVector(child.rest.translation, [0, 1, 0], `joint.${joint.id}.limitAxis`);
  const fallback = [0, 0, 0];
  fallback[AXES.indexOf(document.coordinateSystem.up)] = 1;
  return fallback;
}

function swingTwist(deltaRotation, axis) {
  const projection = deltaRotation[0] * axis[0]
    + deltaRotation[1] * axis[1]
    + deltaRotation[2] * axis[2];
  let twist = [axis[0] * projection, axis[1] * projection, axis[2] * projection, deltaRotation[3]];
  if (Math.hypot(...twist) <= EPSILON) twist = [0, 0, 0, 1];
  twist = normalizedQuaternion(twist, "joint.twist");
  const swing = normalizedQuaternion(quaternionMultiply(deltaRotation, quaternionConjugate(twist)), "joint.swing");
  const swingAngle = 2 * Math.atan2(Math.hypot(swing[0], swing[1], swing[2]), Math.abs(swing[3]));
  const twistAngle = wrapRadians(2 * Math.atan2(
    twist[0] * axis[0] + twist[1] * axis[1] + twist[2] * axis[2],
    twist[3],
  ));
  return { swingAngle, twistAngle };
}

function violation(jointId, kind, value, minimum, maximum, axis = null) {
  const excess = value < minimum ? minimum - value : value > maximum ? value - maximum : 0;
  return { jointId, kind, axis, value, minimum, maximum, excess };
}

export function evaluateRigPoseLimits(documentValue, poseValue, {
  maximumViolations = MAX_POSE_VIOLATIONS,
  tolerance = 1e-6,
} = {}) {
  if (!Number.isSafeInteger(maximumViolations) || maximumViolations <= 0) {
    throw new TypeError("maximumViolations must be a positive safe integer");
  }
  if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0) {
    throw new TypeError("tolerance must be a non-negative finite number");
  }
  const document = normalizeRigDocument(documentValue);
  const pose = normalizeRigPoseForRig(document, poseValue);
  const overrideById = new Map(pose.joints.map((entry) => [entry.jointId, entry]));
  const violations = [];
  let totalViolations = 0;
  let maxSwing = 0;
  let maxTwist = 0;
  let maxAxisExcess = 0;
  const push = (entry) => {
    totalViolations += 1;
    if (violations.length < maximumViolations) violations.push(entry);
  };
  for (const joint of document.joints) {
    if (!joint.limits) continue;
    const delta = overrideById.get(joint.id)?.rotation ?? [0, 0, 0, 1];
    const axis = defaultLimitAxis(document, joint);
    const { swingAngle, twistAngle } = swingTwist(delta, axis);
    maxSwing = Math.max(maxSwing, swingAngle);
    maxTwist = Math.max(maxTwist, Math.abs(twistAngle));
    if (joint.limits.swing !== undefined && swingAngle > joint.limits.swing + tolerance) {
      push(violation(joint.id, "swing", swingAngle, 0, joint.limits.swing));
    }
    if (joint.limits.twist !== undefined) {
      const [minimum, maximum] = joint.limits.twist;
      if (twistAngle < minimum - tolerance || twistAngle > maximum + tolerance) {
        push(violation(joint.id, "twist", twistAngle, minimum, maximum));
      }
    }
    const euler = quaternionToEulerXYZ(delta);
    for (const axisName of AXES) {
      const limits = joint.limits.axes?.[axisName];
      if (!limits) continue;
      const value = euler[AXES.indexOf(axisName)];
      const [minimum, maximum] = limits;
      if (value < minimum - tolerance || value > maximum + tolerance) {
        const entry = violation(joint.id, "axis", value, minimum, maximum, axisName);
        maxAxisExcess = Math.max(maxAxisExcess, entry.excess);
        push(entry);
      }
    }
  }
  return {
    violations,
    totalViolations,
    truncated: totalViolations > violations.length,
    maxSwing,
    maxTwist,
    maxAxisExcess,
  };
}

function poseMetrics(document, pose, limits) {
  const roots = new Set(document.joints.filter((joint) => joint.parent === null).map((joint) => joint.id));
  const rootDrift = pose.joints
    .filter((entry) => roots.has(entry.jointId) && entry.translation)
    .reduce((maximum, entry) => Math.max(maximum, Math.hypot(...entry.translation)), 0);
  return {
    jointCount: document.joints.length,
    overrideCount: pose.joints.length,
    translatedJointCount: pose.joints.filter((entry) => entry.translation !== null).length,
    rotatedJointCount: pose.joints.filter((entry) => entry.rotation !== null).length,
    violationCount: limits.totalViolations,
    maxSwing: limits.maxSwing,
    maxTwist: limits.maxTwist,
    maxAxisExcess: limits.maxAxisExcess,
    rootDrift,
  };
}

export function evaluateRigPose(documentValue, poseValue, {
  limitPolicy = "warn",
  maximumViolations = MAX_POSE_VIOLATIONS,
  tolerance = 1e-6,
} = {}) {
  if (!RIG_POSE_LIMIT_POLICIES.includes(limitPolicy)) {
    throw new TypeError(`Unsupported pose limit policy: ${limitPolicy}`);
  }
  const document = normalizeRigDocument(documentValue);
  const pose = normalizeRigPoseForRig(document, poseValue);
  const limits = evaluateRigPoseLimits(document, pose, { maximumViolations, tolerance });
  const rejected = limitPolicy === "reject" && limits.totalViolations > 0;
  const transforms = rejected ? null : rigPoseWorldTransforms(document, pose);
  const status = rejected ? "rejected" : limits.totalViolations && limitPolicy !== "ignore" ? "warn" : "pass";
  return {
    ok: !rejected,
    pose,
    transforms,
    outcome: {
      schema: RIG_POSE_OUTCOME_SCHEMA,
      rigId: document.id,
      rigRevision: document.revision,
      poseId: pose.id,
      poseRevision: pose.revision,
      status,
      limitPolicy,
      metrics: poseMetrics(document, pose, limits),
      violations: limits.violations.map((entry) => ({ ...entry })),
      truncated: limits.truncated,
    },
  };
}

function normalizeChain(value, index) {
  if (!isPlainObject(value)) throw new TypeError(`chains[${index}] must be an object`);
  if (!Array.isArray(value.joints) || !value.joints.length) {
    throw new TypeError(`chains[${index}].joints must be a non-empty array`);
  }
  if (value.joints.length > MAX_CHAIN_JOINTS) {
    throw new RangeError(`Chain joint count exceeds the bounded limit of ${MAX_CHAIN_JOINTS}`);
  }
  const joints = value.joints.map((entry, jointIndex) => requiredString(entry, `chains[${index}].joints[${jointIndex}]`));
  if (new Set(joints).size !== joints.length) throw new RangeError(`chains[${index}] contains duplicate joints`);
  return {
    id: requiredString(value.id, `chains[${index}].id`),
    name: value.name === undefined ? requiredString(value.id, `chains[${index}].id`) : requiredString(value.name, `chains[${index}].name`),
    joints,
  };
}

function normalizeSuiteCase(value, index, suite) {
  if (!isPlainObject(value)) throw new TypeError(`cases[${index}] must be an object`);
  const id = requiredString(value.id, `cases[${index}].id`);
  const poseValue = value.pose ?? {};
  if (!isPlainObject(poseValue)) throw new TypeError(`cases[${index}].pose must be an object`);
  const pose = normalizeRigPose({
    ...poseValue,
    schema: RIG_POSE_SCHEMA,
    id: poseValue.id ?? `${suite.id}/${id}`,
    rigId: poseValue.rigId ?? suite.rigId,
    rigRevision: poseValue.rigRevision ?? suite.rigRevision,
  });
  const requiredRoles = (value.requiredRoles ?? []).map((entry, roleIndex) => requiredString(entry, `cases[${index}].requiredRoles[${roleIndex}]`));
  return {
    id,
    name: value.name === undefined ? id : requiredString(value.name, `cases[${index}].name`),
    enabled: value.enabled !== false,
    chainId: optionalString(value.chainId, `cases[${index}].chainId`),
    requiredRoles: [...new Set(requiredRoles)],
    pose,
  };
}

export function normalizeRigPoseSuite(value = {}) {
  const issues = portableIssues(value);
  if (issues.length) throw new RigPoseValidationError("Rig pose suite contains non-portable values", issues);
  if (!isPlainObject(value)) throw new RigPoseValidationError("Rig pose suite must be an object");
  try {
    const schema = value.schema ?? RIG_POSE_SUITE_SCHEMA;
    if (schema !== RIG_POSE_SUITE_SCHEMA) throw new TypeError(`Expected ${RIG_POSE_SUITE_SCHEMA}`);
    const base = {
      schema,
      id: requiredString(value.id, "id"),
      rigId: requiredString(value.rigId, "rigId"),
      rigRevision: safeInteger(value.rigRevision, 0, "rigRevision", 0),
      name: value.name === undefined ? requiredString(value.id, "id") : requiredString(value.name, "name"),
      description: optionalString(value.description, "description"),
    };
    const chains = (value.chains ?? []).map(normalizeChain);
    if (chains.length > MAX_POSE_CHAINS) throw new RangeError(`Chain count exceeds the bounded limit of ${MAX_POSE_CHAINS}`);
    const chainIds = new Set();
    for (const chain of chains) {
      if (chainIds.has(chain.id)) throw new RangeError(`Duplicate chain id: ${chain.id}`);
      chainIds.add(chain.id);
    }
    const cases = (value.cases ?? []).map((entry, index) => normalizeSuiteCase(entry, index, base));
    if (cases.length > MAX_POSE_CASES) throw new RangeError(`Pose case count exceeds the bounded limit of ${MAX_POSE_CASES}`);
    const caseIds = new Set();
    for (const entry of cases) {
      if (caseIds.has(entry.id)) throw new RangeError(`Duplicate pose case id: ${entry.id}`);
      caseIds.add(entry.id);
      if (entry.chainId && !chainIds.has(entry.chainId)) throw new RangeError(`Unknown pose chain: ${entry.chainId}`);
    }
    return { ...base, chains, cases, metadata: normalizePoseMetadata(value.metadata) };
  } catch (error) {
    throw error instanceof RigPoseValidationError ? error : new RigPoseValidationError(error.message);
  }
}

export function createRigPoseSuite(value = {}) {
  return normalizeRigPoseSuite({ schema: RIG_POSE_SUITE_SCHEMA, ...value });
}

export function validateRigPoseSuiteForRig(documentValue, suiteValue) {
  const document = normalizeRigDocument(documentValue);
  const suite = normalizeRigPoseSuite(suiteValue);
  if (suite.rigId !== document.id) throw new RigPoseValidationError(`Pose suite rig identity ${suite.rigId} does not match ${document.id}`);
  if (suite.rigRevision !== document.revision) {
    throw new RigPoseValidationError(`Stale pose suite: expected rig revision ${suite.rigRevision}, found ${document.revision}`);
  }
  const jointById = new Map(document.joints.map((joint) => [joint.id, joint]));
  for (const chain of suite.chains) {
    chain.joints.forEach((jointId) => {
      if (!jointById.has(jointId)) throw new RigPoseValidationError(`Unknown chain joint: ${jointId}`);
    });
    for (let index = 1; index < chain.joints.length; index += 1) {
      const previous = chain.joints[index - 1];
      const current = chain.joints[index];
      if (jointById.get(current).parent !== previous) {
        throw new RigPoseValidationError(`Chain ${chain.id} is not contiguous at ${previous} -> ${current}`);
      }
    }
  }
  for (const entry of suite.cases) assertPoseMatchesRig(document, entry.pose);
  return suite;
}

export function evaluateRigPoseSuite(documentValue, suiteValue, options = {}) {
  const document = normalizeRigDocument(documentValue);
  const suite = validateRigPoseSuiteForRig(document, suiteValue);
  const roles = new Set(document.joints.map((joint) => joint.role));
  const chainById = new Map(suite.chains.map((chain) => [chain.id, chain]));
  const cases = [];
  const summary = { passed: 0, warned: 0, rejected: 0, skipped: 0 };
  for (const entry of suite.cases) {
    const missingRoles = entry.requiredRoles.filter((role) => !roles.has(role));
    if (!entry.enabled || missingRoles.length) {
      summary.skipped += 1;
      cases.push({
        caseId: entry.id,
        name: entry.name,
        status: "skipped",
        reason: entry.enabled ? `Missing roles: ${missingRoles.join(", ")}` : "Disabled",
        chainId: entry.chainId,
        chainJointIds: entry.chainId ? [...chainById.get(entry.chainId).joints] : [],
        outcome: null,
      });
      continue;
    }
    const evaluated = evaluateRigPose(document, entry.pose, options);
    if (evaluated.outcome.status === "pass") summary.passed += 1;
    else if (evaluated.outcome.status === "warn") summary.warned += 1;
    else summary.rejected += 1;
    cases.push({
      caseId: entry.id,
      name: entry.name,
      status: evaluated.outcome.status,
      reason: null,
      chainId: entry.chainId,
      chainJointIds: entry.chainId ? [...chainById.get(entry.chainId).joints] : [],
      outcome: evaluated.outcome,
      transforms: evaluated.transforms,
    });
  }
  const status = summary.rejected ? "rejected" : summary.warned ? "warn" : "pass";
  return {
    suite,
    cases,
    outcome: {
      schema: RIG_POSE_SUITE_OUTCOME_SCHEMA,
      suiteId: suite.id,
      rigId: document.id,
      rigRevision: document.revision,
      status,
      summary,
    },
  };
}

function normalizePoseIntent(value = {}) {
  if (!isPlainObject(value)) throw new TypeError("Pose intent must be an object");
  const type = requiredString(value.type, "intent.type");
  if (!RIG_POSE_INTENT_TYPES.includes(type)) throw new TypeError(`Unsupported pose intent: ${type}`);
  const schema = value.schema ?? RIG_POSE_INTENT_SCHEMA;
  if (schema !== RIG_POSE_INTENT_SCHEMA) throw new TypeError(`Expected ${RIG_POSE_INTENT_SCHEMA}`);
  return {
    schema,
    id: requiredString(value.id, "intent.id"),
    type,
    expectedPoseRevision: safeInteger(value.expectedPoseRevision, 0, "intent.expectedPoseRevision", 0),
    expectedRigRevision: safeInteger(value.expectedRigRevision, 0, "intent.expectedRigRevision", 0),
    jointId: optionalString(value.jointId, "intent.jointId"),
    patch: value.patch === undefined ? {} : clonePortable(value.patch),
  };
}

export function applyRigPoseIntent(documentValue, poseValue, intentValue) {
  const document = normalizeRigDocument(documentValue);
  const pose = normalizeRigPoseForRig(document, poseValue);
  const intent = normalizePoseIntent(intentValue);
  const before = pose.revision;
  const reject = (message) => ({
    ok: false,
    pose,
    outcome: {
      schema: RIG_POSE_INTENT_OUTCOME_SCHEMA,
      intentId: intent.id,
      type: intent.type,
      status: "rejected",
      rigRevision: document.revision,
      poseRevisionBefore: before,
      poseRevisionAfter: before,
      error: { message },
    },
  });
  if (intent.expectedRigRevision !== document.revision) {
    return reject(`Stale rig revision: expected ${intent.expectedRigRevision}, found ${document.revision}`);
  }
  if (intent.expectedPoseRevision !== pose.revision) {
    return reject(`Stale pose revision: expected ${intent.expectedPoseRevision}, found ${pose.revision}`);
  }
  try {
    let next;
    if (intent.type === "pose/joint-set") {
      if (!intent.jointId) throw new TypeError("pose/joint-set requires jointId");
      if (!document.joints.some((joint) => joint.id === intent.jointId)) throw new RangeError(`Unknown joint: ${intent.jointId}`);
      next = setRigPoseJoint(pose, intent.jointId, intent.patch);
    } else if (intent.type === "pose/joint-remove") {
      if (!intent.jointId) throw new TypeError("pose/joint-remove requires jointId");
      next = removeRigPoseJoint(pose, intent.jointId);
    } else {
      next = resetRigPose(pose);
    }
    return {
      ok: true,
      pose: next,
      outcome: {
        schema: RIG_POSE_INTENT_OUTCOME_SCHEMA,
        intentId: intent.id,
        type: intent.type,
        status: "applied",
        rigRevision: document.revision,
        poseRevisionBefore: before,
        poseRevisionAfter: next.revision,
        error: null,
      },
    };
  } catch (error) {
    return reject(error.message || String(error));
  }
}
