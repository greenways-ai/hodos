import {
  RIG_IK_PROPOSAL_SCHEMA,
  applyRigIkProposal,
  evaluateRigPoseLimits,
  normalizeRigDocument,
  normalizeRigIkProposal,
  normalizeRigIkRequest,
  normalizeRigIkResult,
  normalizeRigPose,
  normalizeRigPoseSuite,
  resolveRigIkChain,
  rigPoseWorldTransforms,
} from "@greenways/hodos-world-model/rigging";
import {
  IDENTITY,
  clampJointRotation,
  distance,
  estimateTemporaryBytes,
  quaternionConjugate,
  quaternionFromTo,
  quaternionMultiply,
  subtract,
} from "./rigging-ik-math.js";
import {
  analyticTwoBonePositions,
  fabrikPositions,
} from "./rigging-ik-solvers.js";
import {
  RIG_IK_PROVIDER_ID,
  RIG_IK_PROVIDER_VERSION,
  effectiveBounds,
  evidenceValue,
  failureResult,
  normalizeProviderOptions,
  plainObject,
} from "./rigging-ik-provider-values.js";

function buildRotationPatches({ document, pose, chainIds, solvedPositions, limitPolicy }) {
  const world = rigPoseWorldTransforms(document, pose);
  const worldById = new Map(world.map((entry) => [entry.id, entry]));
  const jointById = new Map(document.joints.map((entry) => [entry.id, entry]));
  const desiredWorldRotationById = new Map();
  const patches = [];
  let clampedJointCount = 0;
  for (let index = 0; index < chainIds.length - 1; index += 1) {
    const jointId = chainIds[index];
    const joint = jointById.get(jointId);
    const baseWorld = worldById.get(jointId);
    const currentDirection = subtract(
      worldById.get(chainIds[index + 1]).translation,
      baseWorld.translation,
    );
    const desiredDirection = subtract(solvedPositions[index + 1], solvedPositions[index]);
    const align = quaternionFromTo(currentDirection, desiredDirection, document.coordinateSystem.handedness);
    const desiredWorld = quaternionMultiply(align, baseWorld.rotation);
    const parentWorld = joint.parent
      ? desiredWorldRotationById.get(joint.parent) ?? worldById.get(joint.parent)?.rotation ?? IDENTITY
      : IDENTITY;
    const desiredLocal = quaternionMultiply(quaternionConjugate(parentWorld), desiredWorld);
    const rawDelta = quaternionMultiply(quaternionConjugate(joint.rest.rotation), desiredLocal);
    const rotation = limitPolicy === "clamp" ? clampJointRotation(document, joint, rawDelta) : rawDelta;
    if (limitPolicy === "clamp" && distance(rotation, rawDelta) > 1e-8) clampedJointCount += 1;
    const actualLocal = quaternionMultiply(joint.rest.rotation, rotation);
    desiredWorldRotationById.set(jointId, quaternionMultiply(parentWorld, actualLocal));
    patches.push({ jointId, rotation });
  }
  return { patches, clampedJointCount };
}

function proposalValue({ request, status, patches }) {
  return normalizeRigIkProposal({
    schema: RIG_IK_PROPOSAL_SCHEMA,
    requestId: request.id,
    providerId: RIG_IK_PROVIDER_ID,
    providerVersion: RIG_IK_PROVIDER_VERSION,
    method: request.method,
    status,
    rigId: request.rigId,
    rigRevision: request.rigRevision,
    poseId: request.poseId,
    basePoseRevision: request.poseRevision,
    suiteId: request.suiteId,
    chainId: request.chainId,
    target: request.target,
    joints: patches,
  });
}

function previewProposal(document, pose, proposal) {
  const applied = applyRigIkProposal(document, pose, proposal);
  if (!applied.ok) throw new Error(applied.outcome.error?.message ?? "Rig IK proposal preview was rejected");
  const transforms = rigPoseWorldTransforms(document, applied.pose);
  const limits = evaluateRigPoseLimits(document, applied.pose);
  return { pose: applied.pose, transforms, limits };
}

function staleMessage(document, pose, suite, request) {
  if (request.rigId !== document.id || request.rigRevision !== document.revision) {
    return `Request targets stale rig ${request.rigId}@${request.rigRevision}; current ${document.id}@${document.revision}`;
  }
  if (request.poseId !== pose.id || request.poseRevision !== pose.revision) {
    return `Request targets stale pose ${request.poseId}@${request.poseRevision}; current ${pose.id}@${pose.revision}`;
  }
  if (pose.rigId !== document.id || pose.rigRevision !== document.revision) {
    return `Base pose targets stale rig ${pose.rigId}@${pose.rigRevision}`;
  }
  if (suite.rigId !== document.id || suite.rigRevision !== document.revision) {
    return `Pose suite targets stale rig ${suite.rigId}@${suite.rigRevision}`;
  }
  if (request.suiteId && request.suiteId !== suite.id) {
    return `Request targets pose suite ${request.suiteId}; supplied ${suite.id}`;
  }
  return null;
}

export async function solveRiggingIk(input = {}, options = {}) {
  if (!plainObject(input)) throw new TypeError("Rig IK solve input must be an object");
  const request = normalizeRigIkRequest(input.request);
  const providerOptions = normalizeProviderOptions(options);
  const bounds = effectiveBounds(request, providerOptions);
  const context = { request, bounds };
  if (input.signal?.aborted) {
    return failureResult(context, {
      status: "cancelled",
      classification: "cancelled",
      code: "rig-ik/cancelled",
      message: "Rig IK request was cancelled",
    });
  }
  let document;
  let pose;
  let suite;
  try {
    document = normalizeRigDocument(input.document);
    pose = normalizeRigPose(input.pose);
    suite = normalizeRigPoseSuite(input.suite);
  } catch (error) {
    return failureResult(context, {
      status: "rejected",
      classification: "provider-error",
      code: "rig-ik/invalid-input",
      message: error.message || String(error),
    });
  }
  const stale = staleMessage(document, pose, suite, request);
  if (stale) {
    return failureResult(context, {
      status: "rejected",
      classification: "stale",
      code: "rig-ik/stale",
      message: stale,
    });
  }
  let chain;
  try {
    chain = resolveRigIkChain(document, suite, request.chainId);
  } catch (error) {
    return failureResult(context, {
      status: "rejected",
      classification: "invalid-chain",
      code: "rig-ik/invalid-chain",
      message: error.message || String(error),
    });
  }
  const chainIds = chain.joints;
  if (chainIds.length < 2) {
    return failureResult(context, {
      status: "rejected",
      classification: "invalid-chain",
      code: "rig-ik/short-chain",
      message: "Rig IK chains require at least two joints",
      chainIds,
    });
  }
  if (request.method === "analytic-two-bone" && chainIds.length !== 3) {
    return failureResult(context, {
      status: "rejected",
      classification: "invalid-chain",
      code: "rig-ik/two-bone-chain-length",
      message: "Analytic two-bone IK requires exactly three joints",
      chainIds,
    });
  }
  if (chainIds.length > bounds.maximumChainLength) {
    return failureResult(context, {
      status: "rejected",
      classification: "resource-limit",
      code: "rig-ik/chain-limit",
      message: `Chain length ${chainIds.length} exceeds the provider limit of ${bounds.maximumChainLength}`,
      chainIds,
    });
  }
  const temporaryBytes = estimateTemporaryBytes(chainIds.length);
  if (temporaryBytes > bounds.maximumTemporaryBytes) {
    return failureResult(context, {
      status: "rejected",
      classification: "resource-limit",
      code: "rig-ik/temporary-byte-limit",
      message: `Rig IK requires ${temporaryBytes} temporary bytes; limit ${bounds.maximumTemporaryBytes}`,
      chainIds,
      temporaryBytes,
    });
  }
  let world;
  try {
    world = rigPoseWorldTransforms(document, pose);
  } catch (error) {
    return failureResult(context, {
      status: "rejected",
      classification: "stale",
      code: "rig-ik/stale-pose",
      message: error.message || String(error),
      chainIds,
      temporaryBytes,
    });
  }
  const worldById = new Map(world.map((entry) => [entry.id, entry]));
  const positions = chainIds.map((jointId) => worldById.get(jointId).translation.slice());
  let solved;
  try {
    solved = request.method === "analytic-two-bone"
      ? analyticTwoBonePositions({
        positions,
        target: request.target,
        pole: request.pole,
        tolerance: request.tolerance,
        handedness: document.coordinateSystem.handedness,
      })
      : await fabrikPositions({
        positions,
        target: request.target,
        tolerance: request.tolerance,
        maximumIterations: bounds.maximumIterations,
        signal: input.signal,
        yieldEvery: providerOptions.yieldEvery,
        yieldControl: providerOptions.yieldControl,
      });
  } catch (error) {
    return failureResult(context, {
      classification: "provider-error",
      code: "rig-ik/provider-error",
      message: error.message || String(error),
      chainIds,
      temporaryBytes,
    });
  }
  if (!solved.ok) {
    const cancelled = solved.classification === "cancelled";
    const exhausted = solved.classification === "iteration-exhausted";
    return failureResult(context, {
      status: cancelled ? "cancelled" : "failed",
      classification: solved.classification,
      code: cancelled
        ? "rig-ik/cancelled"
        : exhausted
          ? "rig-ik/iteration-exhausted"
          : "rig-ik/singular",
      message: solved.message,
      chainIds,
      iterations: solved.iterations ?? 0,
      targetDistance: solved.targetDistance ?? 0,
      finalDistance: solved.finalDistance ?? 0,
      minimumReachValue: solved.minimumReachValue ?? 0,
      maximumReach: solved.maximumReach ?? 0,
      temporaryBytes,
    });
  }
  const raw = buildRotationPatches({
    document,
    pose,
    chainIds,
    solvedPositions: solved.positions,
    limitPolicy: "ignore",
  });
  const rawProposal = proposalValue({ request, status: solved.status, patches: raw.patches });
  const rawPreview = previewProposal(document, pose, rawProposal);
  if (request.limitPolicy === "reject" && rawPreview.limits.totalViolations) {
    return failureResult(context, {
      status: "rejected",
      classification: "limit-rejected",
      code: "rig-ik/joint-limit",
      message: `Rig IK proposal violates ${rawPreview.limits.totalViolations} authored joint limits`,
      chainIds,
      iterations: solved.iterations,
      targetDistance: solved.targetDistance,
      finalDistance: solved.finalDistance,
      minimumReachValue: solved.minimumReachValue,
      maximumReach: solved.maximumReach,
      temporaryBytes,
      limits: {
        policy: request.limitPolicy,
        encountered: rawPreview.limits.totalViolations,
        remaining: rawPreview.limits.totalViolations,
        clampedJointCount: 0,
      },
    });
  }
  const selected = request.limitPolicy === "clamp"
    ? buildRotationPatches({
      document,
      pose,
      chainIds,
      solvedPositions: solved.positions,
      limitPolicy: "clamp",
    })
    : raw;
  const preliminaryStatus = solved.status === "clamped" || selected.clampedJointCount ? "clamped" : "converged";
  const proposal = proposalValue({ request, status: preliminaryStatus, patches: selected.patches });
  const preview = previewProposal(document, pose, proposal);
  if (request.limitPolicy === "clamp" && preview.limits.totalViolations) {
    return failureResult(context, {
      status: "rejected",
      classification: "limit-rejected",
      code: "rig-ik/joint-limit-clamp",
      message: `Joint-limit clamping left ${preview.limits.totalViolations} unresolved violations`,
      chainIds,
      iterations: solved.iterations,
      targetDistance: solved.targetDistance,
      finalDistance: solved.finalDistance,
      minimumReachValue: solved.minimumReachValue,
      maximumReach: solved.maximumReach,
      temporaryBytes,
      limits: {
        policy: request.limitPolicy,
        encountered: rawPreview.limits.totalViolations,
        remaining: preview.limits.totalViolations,
        clampedJointCount: selected.clampedJointCount,
      },
    });
  }
  const finalTransformsById = new Map(preview.transforms.map((entry) => [entry.id, entry]));
  const finalDistance = distance(finalTransformsById.get(chainIds.at(-1)).translation, request.target);
  const limitClamped = selected.clampedJointCount > 0;
  const classification = limitClamped
    ? "limit-clamped"
    : solved.classification;
  const status = solved.status === "clamped" || limitClamped || finalDistance > request.tolerance
    ? "clamped"
    : "converged";
  const normalizedProposal = proposal.status === status
    ? proposal
    : proposalValue({ request, status, patches: selected.patches });
  return normalizeRigIkResult({
    ok: true,
    proposal: normalizedProposal,
    evidence: evidenceValue({
      request,
      bounds,
      status,
      classification,
      chainIds,
      iterations: solved.iterations,
      converged: status === "converged",
      targetDistance: solved.targetDistance,
      finalDistance,
      minimumReachValue: solved.minimumReachValue,
      maximumReach: solved.maximumReach,
      temporaryBytes,
      limits: {
        policy: request.limitPolicy,
        encountered: rawPreview.limits.totalViolations,
        remaining: preview.limits.totalViolations,
        clampedJointCount: selected.clampedJointCount,
      },
      error: null,
    }),
  });
}

export class RiggingIkProvider {
  constructor(options = {}) {
    this.options = normalizeProviderOptions(options);
    this.destroyed = false;
    this.controllers = new Set();
  }

  async solve(input = {}) {
    if (this.destroyed) throw new Error("Rig IK provider was destroyed");
    const controller = new AbortController();
    const externalSignal = input.signal;
    const abort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener?.("abort", abort, { once: true });
    this.controllers.add(controller);
    try {
      return await solveRiggingIk({ ...input, signal: controller.signal }, this.options);
    } finally {
      externalSignal?.removeEventListener?.("abort", abort);
      this.controllers.delete(controller);
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
}

export function createRiggingIkProvider(options) {
  return new RiggingIkProvider(options);
}
