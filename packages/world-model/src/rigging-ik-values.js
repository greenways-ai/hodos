import {
  finiteNumber,
  isPlainObject,
  optionalString,
  portableIssues,
  requiredString,
  safeInteger,
  vector,
} from "./rigging-values.js";

export const RIG_IK_REQUEST_SCHEMA = "hodos.rig-ik-request/0-alpha";
export const RIG_IK_PROPOSAL_SCHEMA = "hodos.rig-ik-proposal/0-alpha";
export const RIG_IK_EVIDENCE_SCHEMA = "hodos.rig-ik-evidence/0-alpha";
export const RIG_IK_ACCEPTANCE_SCHEMA = "hodos.rig-ik-acceptance/0-alpha";

export const RIG_IK_METHODS = Object.freeze(["analytic-two-bone", "fabrik"]);
export const RIG_IK_LIMIT_POLICIES = Object.freeze(["clamp", "reject", "ignore"]);
export const RIG_IK_PROPOSAL_STATUSES = Object.freeze(["converged", "clamped"]);
export const RIG_IK_EVIDENCE_STATUSES = Object.freeze([
  "converged",
  "clamped",
  "failed",
  "cancelled",
  "rejected",
]);
export const RIG_IK_CLASSIFICATIONS = Object.freeze([
  "reachable",
  "unreachable",
  "singular",
  "iteration-exhausted",
  "cancelled",
  "stale",
  "invalid-chain",
  "limit-clamped",
  "limit-rejected",
  "resource-limit",
  "provider-error",
]);

export const RIG_IK_LIMITS = Object.freeze({
  maximumChainLength: 64,
  maximumIterations: 64,
  maximumTemporaryBytes: 4 * 1024 * 1024,
  maximumEvidenceJoints: 64,
  maximumProposalJoints: 64,
  minimumTolerance: 1e-8,
  maximumTolerance: 1,
});

export class RigIkValidationError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = "RigIkValidationError";
    this.issues = issues.map((entry) => ({ ...entry }));
  }
}

function boundedInteger(value, fallback, path, maximum, minimum = 1) {
  const result = safeInteger(value, fallback, path, minimum);
  if (result > maximum) throw new RangeError(`${path} cannot exceed ${maximum}`);
  return result;
}

function nonNegativeNumber(value, fallback, path) {
  const result = finiteNumber(value, fallback, path);
  if (result < 0) throw new RangeError(`${path} cannot be negative`);
  return result;
}

function boundedTolerance(value, fallback, path) {
  const result = finiteNumber(value, fallback, path);
  if (result < RIG_IK_LIMITS.minimumTolerance || result > RIG_IK_LIMITS.maximumTolerance) {
    throw new RangeError(`${path} must be between ${RIG_IK_LIMITS.minimumTolerance} and ${RIG_IK_LIMITS.maximumTolerance}`);
  }
  return result;
}

function canonicalQuaternion(value, path) {
  const quaternion = vector(value, [0, 0, 0, 1], 4, path);
  const length = Math.hypot(...quaternion);
  if (length <= Number.EPSILON) throw new TypeError(`${path} cannot be a zero quaternion`);
  const normalized = quaternion.map((entry) => entry / length);
  return normalized[3] < 0 ? normalized.map((entry) => -entry) : normalized;
}

function enumValue(value, allowed, path) {
  const result = requiredString(value, path);
  if (!allowed.includes(result)) throw new TypeError(`Unsupported ${path}: ${result}`);
  return result;
}

function optionalVector(value, path) {
  return value === undefined || value === null ? null : vector(value, [0, 0, 0], 3, path);
}

function normalizedError(value, path = "error") {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object or null`);
  return {
    code: requiredString(value.code, `${path}.code`),
    message: requiredString(value.message, `${path}.message`),
  };
}

function portableObject(value, label) {
  const issues = portableIssues(value);
  if (issues.length) throw new RigIkValidationError(`${label} contains non-portable values`, issues);
  if (!isPlainObject(value)) throw new RigIkValidationError(`${label} must be an object`);
}

export function normalizeRigIkRequest(value = {}) {
  portableObject(value, "Rig IK request");
  try {
    const schema = value.schema ?? RIG_IK_REQUEST_SCHEMA;
    if (schema !== RIG_IK_REQUEST_SCHEMA) throw new TypeError(`Expected ${RIG_IK_REQUEST_SCHEMA}`);
    const method = enumValue(value.method, RIG_IK_METHODS, "method");
    const limitPolicy = value.limitPolicy === undefined
      ? "clamp"
      : enumValue(value.limitPolicy, RIG_IK_LIMIT_POLICIES, "limitPolicy");
    return {
      schema,
      id: requiredString(value.id, "id"),
      method,
      rigId: requiredString(value.rigId, "rigId"),
      rigRevision: safeInteger(value.rigRevision, 0, "rigRevision", 0),
      poseId: requiredString(value.poseId, "poseId"),
      poseRevision: safeInteger(value.poseRevision, 0, "poseRevision", 0),
      suiteId: optionalString(value.suiteId, "suiteId"),
      chainId: requiredString(value.chainId, "chainId"),
      target: vector(value.target, [0, 0, 0], 3, "target"),
      pole: optionalVector(value.pole, "pole"),
      limitPolicy,
      tolerance: boundedTolerance(value.tolerance, 1e-4, "tolerance"),
      maximumChainLength: boundedInteger(
        value.maximumChainLength,
        32,
        "maximumChainLength",
        RIG_IK_LIMITS.maximumChainLength,
        2,
      ),
      maximumIterations: boundedInteger(
        value.maximumIterations,
        24,
        "maximumIterations",
        RIG_IK_LIMITS.maximumIterations,
      ),
      maximumTemporaryBytes: boundedInteger(
        value.maximumTemporaryBytes,
        512 * 1024,
        "maximumTemporaryBytes",
        RIG_IK_LIMITS.maximumTemporaryBytes,
        1024,
      ),
      maximumEvidenceJoints: boundedInteger(
        value.maximumEvidenceJoints,
        32,
        "maximumEvidenceJoints",
        RIG_IK_LIMITS.maximumEvidenceJoints,
      ),
    };
  } catch (error) {
    throw error instanceof RigIkValidationError ? error : new RigIkValidationError(error.message);
  }
}

export function createRigIkRequest(value = {}) {
  const request = {
    schema: RIG_IK_REQUEST_SCHEMA,
    id: value.id,
    method: value.method,
    rigId: value.rigId,
    rigRevision: value.rigRevision,
    poseId: value.poseId,
    poseRevision: value.poseRevision,
    chainId: value.chainId,
    target: value.target,
  };
  for (const key of [
    "suiteId",
    "pole",
    "limitPolicy",
    "tolerance",
    "maximumChainLength",
    "maximumIterations",
    "maximumTemporaryBytes",
    "maximumEvidenceJoints",
  ]) {
    if (value[key] !== undefined) request[key] = value[key];
  }
  return normalizeRigIkRequest(request);
}

function normalizeProposalJoint(value, index) {
  if (!isPlainObject(value)) throw new TypeError(`joints[${index}] must be an object`);
  return {
    jointId: requiredString(value.jointId, `joints[${index}].jointId`),
    rotation: canonicalQuaternion(value.rotation, `joints[${index}].rotation`),
  };
}

export function normalizeRigIkProposal(value = {}) {
  portableObject(value, "Rig IK proposal");
  try {
    const schema = value.schema ?? RIG_IK_PROPOSAL_SCHEMA;
    if (schema !== RIG_IK_PROPOSAL_SCHEMA) throw new TypeError(`Expected ${RIG_IK_PROPOSAL_SCHEMA}`);
    const joints = (value.joints ?? []).map(normalizeProposalJoint);
    if (!joints.length) throw new TypeError("Rig IK proposal requires at least one joint rotation");
    if (joints.length > RIG_IK_LIMITS.maximumProposalJoints) {
      throw new RangeError(`Rig IK proposal joint count cannot exceed ${RIG_IK_LIMITS.maximumProposalJoints}`);
    }
    const ids = new Set();
    for (const joint of joints) {
      if (ids.has(joint.jointId)) throw new RangeError(`Duplicate Rig IK proposal joint: ${joint.jointId}`);
      ids.add(joint.jointId);
    }
    return {
      schema,
      requestId: requiredString(value.requestId, "requestId"),
      providerId: requiredString(value.providerId, "providerId"),
      providerVersion: requiredString(value.providerVersion, "providerVersion"),
      method: enumValue(value.method, RIG_IK_METHODS, "method"),
      status: enumValue(value.status, RIG_IK_PROPOSAL_STATUSES, "status"),
      rigId: requiredString(value.rigId, "rigId"),
      rigRevision: safeInteger(value.rigRevision, 0, "rigRevision", 0),
      poseId: requiredString(value.poseId, "poseId"),
      basePoseRevision: safeInteger(value.basePoseRevision, 0, "basePoseRevision", 0),
      suiteId: optionalString(value.suiteId, "suiteId"),
      chainId: requiredString(value.chainId, "chainId"),
      target: vector(value.target, [0, 0, 0], 3, "target"),
      joints,
    };
  } catch (error) {
    throw error instanceof RigIkValidationError ? error : new RigIkValidationError(error.message);
  }
}

function normalizeBounds(value = {}) {
  if (!isPlainObject(value)) throw new TypeError("bounds must be an object");
  return {
    maximumChainLength: boundedInteger(
      value.maximumChainLength,
      32,
      "bounds.maximumChainLength",
      RIG_IK_LIMITS.maximumChainLength,
      2,
    ),
    maximumIterations: boundedInteger(
      value.maximumIterations,
      24,
      "bounds.maximumIterations",
      RIG_IK_LIMITS.maximumIterations,
    ),
    maximumTemporaryBytes: boundedInteger(
      value.maximumTemporaryBytes,
      512 * 1024,
      "bounds.maximumTemporaryBytes",
      RIG_IK_LIMITS.maximumTemporaryBytes,
      1024,
    ),
    maximumEvidenceJoints: boundedInteger(
      value.maximumEvidenceJoints,
      32,
      "bounds.maximumEvidenceJoints",
      RIG_IK_LIMITS.maximumEvidenceJoints,
    ),
  };
}

function normalizeLimitEvidence(value = {}) {
  if (!isPlainObject(value)) throw new TypeError("limits must be an object");
  return {
    policy: enumValue(value.policy ?? "clamp", RIG_IK_LIMIT_POLICIES, "limits.policy"),
    encountered: safeInteger(value.encountered, 0, "limits.encountered", 0),
    remaining: safeInteger(value.remaining, 0, "limits.remaining", 0),
    clampedJointCount: safeInteger(value.clampedJointCount, 0, "limits.clampedJointCount", 0),
  };
}

export function normalizeRigIkEvidence(value = {}) {
  portableObject(value, "Rig IK evidence");
  try {
    const schema = value.schema ?? RIG_IK_EVIDENCE_SCHEMA;
    if (schema !== RIG_IK_EVIDENCE_SCHEMA) throw new TypeError(`Expected ${RIG_IK_EVIDENCE_SCHEMA}`);
    const bounds = normalizeBounds(value.bounds ?? {});
    const jointIds = (value.jointIds ?? []).map((entry, index) => requiredString(entry, `jointIds[${index}]`));
    if (jointIds.length > bounds.maximumEvidenceJoints) {
      throw new RangeError("Rig IK evidence joint ids exceed maximumEvidenceJoints");
    }
    const chainLength = safeInteger(value.chainLength, 0, "chainLength", 0);
    if (chainLength > RIG_IK_LIMITS.maximumChainLength) {
      throw new RangeError(`chainLength cannot exceed ${RIG_IK_LIMITS.maximumChainLength}`);
    }
    const iterations = safeInteger(value.iterations, 0, "iterations", 0);
    if (iterations > bounds.maximumIterations) {
      throw new RangeError("iterations cannot exceed bounds.maximumIterations");
    }
    const temporaryBytes = safeInteger(value.temporaryBytes, 0, "temporaryBytes", 0);
    if (temporaryBytes > RIG_IK_LIMITS.maximumTemporaryBytes) {
      throw new RangeError(`temporaryBytes cannot exceed ${RIG_IK_LIMITS.maximumTemporaryBytes}`);
    }
    return {
      schema,
      requestId: requiredString(value.requestId, "requestId"),
      providerId: requiredString(value.providerId, "providerId"),
      providerVersion: requiredString(value.providerVersion, "providerVersion"),
      method: enumValue(value.method, RIG_IK_METHODS, "method"),
      status: enumValue(value.status, RIG_IK_EVIDENCE_STATUSES, "status"),
      classification: enumValue(value.classification, RIG_IK_CLASSIFICATIONS, "classification"),
      rigId: requiredString(value.rigId, "rigId"),
      rigRevision: safeInteger(value.rigRevision, 0, "rigRevision", 0),
      poseId: requiredString(value.poseId, "poseId"),
      basePoseRevision: safeInteger(value.basePoseRevision, 0, "basePoseRevision", 0),
      suiteId: optionalString(value.suiteId, "suiteId"),
      chainId: requiredString(value.chainId, "chainId"),
      chainLength,
      iterations,
      converged: value.converged === true,
      targetDistance: nonNegativeNumber(value.targetDistance, 0, "targetDistance"),
      finalDistance: nonNegativeNumber(value.finalDistance, 0, "finalDistance"),
      minimumReach: nonNegativeNumber(value.minimumReach, 0, "minimumReach"),
      maximumReach: nonNegativeNumber(value.maximumReach, 0, "maximumReach"),
      temporaryBytes,
      bounds,
      limits: normalizeLimitEvidence(value.limits ?? {}),
      jointIds,
      truncated: value.truncated === true,
      error: normalizedError(value.error),
    };
  } catch (error) {
    throw error instanceof RigIkValidationError ? error : new RigIkValidationError(error.message);
  }
}

export function normalizeRigIkResult(value = {}) {
  if (!isPlainObject(value)) throw new RigIkValidationError("Rig IK result must be an object");
  const evidence = normalizeRigIkEvidence(value.evidence);
  const proposal = value.proposal === undefined || value.proposal === null
    ? null
    : normalizeRigIkProposal(value.proposal);
  const ok = value.ok === true;
  const successfulEvidence = evidence.status === "converged" || evidence.status === "clamped";
  if (ok && !proposal) throw new RigIkValidationError("Successful Rig IK results require a proposal");
  if (!ok && proposal) throw new RigIkValidationError("Failed Rig IK results cannot contain a proposal");
  if (ok !== successfulEvidence) {
    throw new RigIkValidationError("Rig IK result success must match the evidence status");
  }
  if (evidence.converged !== (evidence.status === "converged")) {
    throw new RigIkValidationError("Rig IK evidence converged flag must match its status");
  }
  if (ok && evidence.error !== null) throw new RigIkValidationError("Successful Rig IK results cannot contain an error");
  if (!ok && evidence.error === null) throw new RigIkValidationError("Failed Rig IK results require an error");
  if (proposal) {
    for (const key of [
      "requestId",
      "providerId",
      "providerVersion",
      "method",
      "rigId",
      "rigRevision",
      "poseId",
      "basePoseRevision",
      "suiteId",
      "chainId",
      "status",
    ]) {
      if (proposal[key] !== evidence[key]) {
        throw new RigIkValidationError(`Rig IK proposal and evidence disagree on ${key}`);
      }
    }
  }
  return { ok, proposal, evidence };
}
