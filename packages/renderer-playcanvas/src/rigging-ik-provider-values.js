import {
  RIG_IK_EVIDENCE_SCHEMA,
  RIG_IK_LIMITS,
  normalizeRigIkEvidence,
  normalizeRigIkResult,
} from "@greenways/hodos-world-model/rigging";

export const RIG_IK_PROVIDER_ID = "playcanvas/rigging-ik";
export const RIG_IK_PROVIDER_VERSION = "0-alpha.1";

export const RIG_IK_PROVIDER_DEFAULTS = Object.freeze({
  maximumChainLength: 32,
  maximumIterations: 24,
  maximumTemporaryBytes: 512 * 1024,
  maximumEvidenceJoints: 32,
  yieldEvery: 4,
});

export function plainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedInteger(value, fallback, maximum, label, minimum = 1) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new TypeError(`${label} must be a safe integer from ${minimum} to ${maximum}`);
  }
  return candidate;
}

export function normalizeProviderOptions(value = {}) {
  if (!plainObject(value)) throw new TypeError("Rig IK provider options must be an object");
  return Object.freeze({
    maximumChainLength: boundedInteger(
      value.maximumChainLength,
      RIG_IK_PROVIDER_DEFAULTS.maximumChainLength,
      RIG_IK_LIMITS.maximumChainLength,
      "maximumChainLength",
      2,
    ),
    maximumIterations: boundedInteger(
      value.maximumIterations,
      RIG_IK_PROVIDER_DEFAULTS.maximumIterations,
      RIG_IK_LIMITS.maximumIterations,
      "maximumIterations",
    ),
    maximumTemporaryBytes: boundedInteger(
      value.maximumTemporaryBytes,
      RIG_IK_PROVIDER_DEFAULTS.maximumTemporaryBytes,
      RIG_IK_LIMITS.maximumTemporaryBytes,
      "maximumTemporaryBytes",
      1024,
    ),
    maximumEvidenceJoints: boundedInteger(
      value.maximumEvidenceJoints,
      RIG_IK_PROVIDER_DEFAULTS.maximumEvidenceJoints,
      RIG_IK_LIMITS.maximumEvidenceJoints,
      "maximumEvidenceJoints",
    ),
    yieldEvery: boundedInteger(value.yieldEvery, RIG_IK_PROVIDER_DEFAULTS.yieldEvery, 64, "yieldEvery"),
    yieldControl: typeof value.yieldControl === "function"
      ? value.yieldControl
      : () => new Promise((resolve) => setTimeout(resolve, 0)),
  });
}

export function effectiveBounds(request, providerOptions) {
  return Object.freeze({
    maximumChainLength: Math.min(request.maximumChainLength, providerOptions.maximumChainLength),
    maximumIterations: Math.min(request.maximumIterations, providerOptions.maximumIterations),
    maximumTemporaryBytes: Math.min(request.maximumTemporaryBytes, providerOptions.maximumTemporaryBytes),
    maximumEvidenceJoints: Math.min(request.maximumEvidenceJoints, providerOptions.maximumEvidenceJoints),
  });
}

function limitedJointIds(jointIds, maximum) {
  return {
    jointIds: jointIds.slice(0, maximum),
    truncated: jointIds.length > maximum,
  };
}

export function evidenceValue({
  request,
  bounds,
  status,
  classification,
  chainIds = [],
  iterations = 0,
  converged = false,
  targetDistance = 0,
  finalDistance = 0,
  minimumReachValue = 0,
  maximumReach = 0,
  temporaryBytes = 0,
  limits = null,
  error = null,
}) {
  const limited = limitedJointIds(chainIds, bounds.maximumEvidenceJoints);
  return normalizeRigIkEvidence({
    schema: RIG_IK_EVIDENCE_SCHEMA,
    requestId: request.id,
    providerId: RIG_IK_PROVIDER_ID,
    providerVersion: RIG_IK_PROVIDER_VERSION,
    method: request.method,
    status,
    classification,
    rigId: request.rigId,
    rigRevision: request.rigRevision,
    poseId: request.poseId,
    basePoseRevision: request.poseRevision,
    suiteId: request.suiteId,
    chainId: request.chainId,
    chainLength: Math.min(chainIds.length, RIG_IK_LIMITS.maximumChainLength),
    iterations,
    converged,
    targetDistance,
    finalDistance,
    minimumReach: minimumReachValue,
    maximumReach,
    temporaryBytes: Math.min(temporaryBytes, RIG_IK_LIMITS.maximumTemporaryBytes),
    bounds,
    limits: limits ?? {
      policy: request.limitPolicy,
      encountered: 0,
      remaining: 0,
      clampedJointCount: 0,
    },
    jointIds: limited.jointIds,
    truncated: limited.truncated || chainIds.length > RIG_IK_LIMITS.maximumChainLength,
    error,
  });
}

export function failureResult(context, {
  status = "failed",
  classification,
  code,
  message,
  chainIds = [],
  iterations = 0,
  targetDistance = 0,
  finalDistance = 0,
  minimumReachValue = 0,
  maximumReach = 0,
  temporaryBytes = 0,
  limits = null,
} = {}) {
  return normalizeRigIkResult({
    ok: false,
    proposal: null,
    evidence: evidenceValue({
      request: context.request,
      bounds: context.bounds,
      status,
      classification,
      chainIds,
      iterations,
      converged: false,
      targetDistance,
      finalDistance,
      minimumReachValue,
      maximumReach,
      temporaryBytes,
      limits,
      error: { code, message },
    }),
  });
}

