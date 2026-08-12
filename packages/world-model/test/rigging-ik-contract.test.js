import assert from "node:assert/strict";
import test from "node:test";
import {
  RIG_IK_ACCEPTANCE_SCHEMA,
  RIG_IK_EVIDENCE_SCHEMA,
  RIG_IK_PROPOSAL_SCHEMA,
  RIG_IK_REQUEST_SCHEMA,
  applyRigIkProposal,
  createRigDocument,
  createRigIkRequest,
  createRigPose,
  createRigPoseSuite,
  normalizeRigIkEvidence,
  normalizeRigIkProposal,
  normalizeRigIkResult,
  resolveRigIkChain,
} from "../src/rigging-model.js";

function fixture() {
  const document = createRigDocument({
    id: "rig:ik-contract",
    assetId: "sha256:ik-contract",
    joints: [
      { id: "anchor", parent: null },
      { id: "hinge", parent: "anchor", rest: { translation: [2, 0, 0] } },
      { id: "tip", parent: "hinge", rest: { translation: [1, 0, 0] } },
    ],
  });
  const pose = createRigPose({ id: "pose:ik-contract", rigId: document.id, rigRevision: document.revision });
  const suite = createRigPoseSuite({
    id: "suite:ik-contract",
    rigId: document.id,
    rigRevision: document.revision,
    chains: [{ id: "appendage", joints: ["anchor", "hinge", "tip"] }],
  });
  return { document, pose, suite };
}

function requestFor({ document, pose, suite }) {
  return createRigIkRequest({
    id: "ik:contract",
    method: "analytic-two-bone",
    rigId: document.id,
    rigRevision: document.revision,
    poseId: pose.id,
    poseRevision: pose.revision,
    suiteId: suite.id,
    chainId: "appendage",
    target: [2, 1, 0],
  });
}

test("Rig IK requests are bounded portable values with explicit revision targets", () => {
  const values = fixture();
  const request = requestFor(values);
  assert.equal(request.schema, RIG_IK_REQUEST_SCHEMA);
  assert.equal(request.pole, null);
  assert.equal(request.limitPolicy, "clamp");
  assert.equal(request.maximumIterations, 24);
  assert.deepEqual(JSON.parse(JSON.stringify(request)), request);
  assert.throws(() => createRigIkRequest({ ...request, maximumIterations: 65 }), /cannot exceed 64/);
  assert.throws(() => createRigIkRequest({ ...request, target: [0, Number.NaN, 0] }), /non-portable/);
});

test("named IK chains resolve only through a suite accepted for the exact rig revision", () => {
  const values = fixture();
  assert.deepEqual(resolveRigIkChain(values.document, values.suite, "appendage"), {
    id: "appendage",
    name: "appendage",
    joints: ["anchor", "hinge", "tip"],
  });
  assert.throws(
    () => resolveRigIkChain(values.document, values.suite, "missing-chain"),
    /Unknown Rig IK chain: missing-chain/,
  );
  assert.throws(
    () => resolveRigIkChain({ ...values.document, revision: 1 }, values.suite, "appendage"),
    /Stale pose suite/,
  );
});

test("IK proposals apply as one revision-checked semantic pose commit", () => {
  const values = fixture();
  const request = requestFor(values);
  const proposal = normalizeRigIkProposal({
    schema: RIG_IK_PROPOSAL_SCHEMA,
    requestId: request.id,
    providerId: "fixture/ik",
    providerVersion: "0-alpha.1",
    method: request.method,
    status: "converged",
    rigId: request.rigId,
    rigRevision: request.rigRevision,
    poseId: request.poseId,
    basePoseRevision: request.poseRevision,
    suiteId: request.suiteId,
    chainId: request.chainId,
    target: request.target,
    joints: [
      { jointId: "anchor", rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] },
      { jointId: "hinge", rotation: [0, 0, 0, 1] },
    ],
  });
  const applied = applyRigIkProposal(values.document, values.pose, proposal);
  assert.equal(applied.ok, true);
  assert.equal(applied.pose.revision, values.pose.revision + 1);
  assert.equal(applied.outcome.schema, RIG_IK_ACCEPTANCE_SCHEMA);
  assert.equal(applied.outcome.status, "applied");
  assert.equal(applied.pose.joints.length, 2);
  const stale = applyRigIkProposal(values.document, applied.pose, proposal);
  assert.equal(stale.ok, false);
  assert.deepEqual(stale.pose, applied.pose);
  assert.equal(stale.outcome.poseRevisionAfter, applied.pose.revision);
});

test("compact convergence evidence and result envelopes remain portable", () => {
  const values = fixture();
  const request = requestFor(values);
  const evidence = normalizeRigIkEvidence({
    schema: RIG_IK_EVIDENCE_SCHEMA,
    requestId: request.id,
    providerId: "fixture/ik",
    providerVersion: "0-alpha.1",
    method: request.method,
    status: "converged",
    classification: "reachable",
    rigId: request.rigId,
    rigRevision: request.rigRevision,
    poseId: request.poseId,
    basePoseRevision: request.poseRevision,
    suiteId: request.suiteId,
    chainId: request.chainId,
    chainLength: 3,
    iterations: 1,
    converged: true,
    targetDistance: Math.sqrt(5),
    finalDistance: 0,
    minimumReach: 1,
    maximumReach: 3,
    temporaryBytes: 432,
    bounds: {
      maximumChainLength: 32,
      maximumIterations: 24,
      maximumTemporaryBytes: 524288,
      maximumEvidenceJoints: 32,
    },
    limits: { policy: "clamp", encountered: 0, remaining: 0, clampedJointCount: 0 },
    jointIds: ["anchor", "hinge", "tip"],
    truncated: false,
    error: null,
  });
  const result = normalizeRigIkResult({
    ok: false,
    proposal: null,
    evidence: { ...evidence, status: "failed", classification: "singular", converged: false,
      error: { code: "rig-ik/singular", message: "singular" } },
  });
  assert.equal(result.evidence.schema, RIG_IK_EVIDENCE_SCHEMA);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);

  const proposal = normalizeRigIkProposal({
    schema: RIG_IK_PROPOSAL_SCHEMA,
    requestId: request.id,
    providerId: evidence.providerId,
    providerVersion: evidence.providerVersion,
    method: request.method,
    status: "converged",
    rigId: request.rigId,
    rigRevision: request.rigRevision,
    poseId: request.poseId,
    basePoseRevision: request.poseRevision,
    suiteId: request.suiteId,
    chainId: request.chainId,
    target: request.target,
    joints: [{ jointId: "anchor", rotation: [0, 0, 0, 1] }],
  });
  assert.throws(() => normalizeRigIkResult({
    ok: true,
    proposal: { ...proposal, requestId: "different-request" },
    evidence: { ...evidence, converged: true },
  }), /disagree on requestId/);
});
