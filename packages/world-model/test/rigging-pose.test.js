import assert from "node:assert/strict";
import test from "node:test";
import {
  RIG_POSE_INTENT_OUTCOME_SCHEMA,
  RIG_POSE_OUTCOME_SCHEMA,
  RIG_POSE_SCHEMA,
  RIG_POSE_SUITE_OUTCOME_SCHEMA,
  RIG_POSE_SUITE_SCHEMA,
  applyRigPoseIntent,
  createRigPose,
  createRigPoseSuite,
  evaluateRigPose,
  evaluateRigPoseLimits,
  evaluateRigPoseSuite,
  normalizeRigPose,
  removeRigPoseJoint,
  resetRigPose,
  rigPoseWorldTransforms,
  setRigPoseJoint,
  validateRigPoseSuiteForRig,
} from "../src/rigging-pose.js";
import { createRigDocument } from "../src/rigging-validation.js";

const quaternion = (axis, radians) => {
  const half = radians / 2;
  const sine = Math.sin(half);
  return [axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(half)];
};

function creatureRig() {
  return createRigDocument({
    id: "rig:creature",
    assetId: "sha256:creature",
    joints: [
      { id: "root", parent: null, role: "root", rest: { translation: [1, 0, 0] } },
      {
        id: "arm",
        parent: "root",
        role: "appendage",
        rest: { translation: [2, 0, 0] },
        limits: {
          swing: 0.4,
          twist: [-0.2, 0.2],
          axes: { z: [-0.25, 0.25] },
        },
      },
      { id: "tip", parent: "arm", role: "appendage-tip", rest: { translation: [1, 0, 0] } },
    ],
  });
}

function blankPose(document = creatureRig(), id = "pose:blank") {
  return createRigPose({
    id,
    rigId: document.id,
    rigRevision: document.revision,
  });
}

const close = (actual, expected, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
};

const vectorClose = (actual, expected, tolerance = 1e-6) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((entry, index) => close(entry, expected[index], tolerance));
};

test("pose documents normalize sparse overrides deterministically", () => {
  const document = creatureRig();
  const pose = normalizeRigPose({
    schema: RIG_POSE_SCHEMA,
    id: "pose:ordered",
    rigId: document.id,
    rigRevision: document.revision,
    joints: [
      { jointId: "tip", translation: [0, 1, 0] },
      { jointId: "arm", rotation: quaternion([0, 0, 1], 0.2) },
    ],
  });
  assert.equal(pose.schema, RIG_POSE_SCHEMA);
  assert.equal(pose.revision, 0);
  assert.deepEqual(pose.joints.map(({ jointId }) => jointId), ["arm", "tip"]);
  assert.throws(() => normalizeRigPose({
    id: "pose:bad",
    rigId: document.id,
    rigRevision: 0,
    joints: [{ jointId: "arm", rotation: [0, 0, 0, 2] }],
  }), /normalized quaternion/);
  assert.throws(() => normalizeRigPose({
    schema: "other/pose",
    id: "pose:wrong",
    rigId: document.id,
    rigRevision: 0,
  }), /Expected hodos\.rig-pose/);
});

test("immutable pose helpers advance one pose revision", () => {
  const original = blankPose();
  const rotated = setRigPoseJoint(original, "arm", { rotation: quaternion([0, 0, 1], 0.1) });
  const translated = setRigPoseJoint(rotated, "arm", { translation: [0, 0.5, 0] });
  assert.equal(original.revision, 0);
  assert.equal(original.joints.length, 0);
  assert.equal(rotated.revision, 1);
  assert.equal(translated.revision, 2);
  assert.ok(translated.joints[0].rotation);
  assert.deepEqual(translated.joints[0].translation, [0, 0.5, 0]);
  const removed = removeRigPoseJoint(translated, "arm");
  assert.equal(removed.revision, 3);
  assert.deepEqual(removed.joints, []);
  assert.equal(resetRigPose(rotated).revision, 2);
});

test("pose FK composes local rest transforms, translation offsets and delta rotations", () => {
  const document = creatureRig();
  const pose = createRigPose({
    id: "pose:turn",
    rigId: document.id,
    rigRevision: document.revision,
    joints: [{
      jointId: "root",
      translation: [0, 1, 0],
      rotation: quaternion([0, 0, 1], Math.PI / 2),
    }],
  });
  const transforms = rigPoseWorldTransforms(document, pose);
  vectorClose(transforms.find(({ id }) => id === "root").translation, [1, 1, 0]);
  vectorClose(transforms.find(({ id }) => id === "arm").translation, [1, 3, 0]);
  vectorClose(transforms.find(({ id }) => id === "tip").translation, [1, 4, 0]);
});

test("joint limits produce deterministic swing and axis violations", () => {
  const document = creatureRig();
  const pose = createRigPose({
    id: "pose:over-limit",
    rigId: document.id,
    rigRevision: document.revision,
    joints: [{ jointId: "arm", rotation: quaternion([0, 0, 1], 0.5) }],
  });
  const limits = evaluateRigPoseLimits(document, pose);
  assert.equal(limits.totalViolations, 2);
  assert.deepEqual(limits.violations.map(({ kind }) => kind), ["swing", "axis"]);
  close(limits.violations.find(({ kind }) => kind === "axis").value, 0.5);
  const warned = evaluateRigPose(document, pose);
  assert.equal(warned.ok, true);
  assert.equal(warned.outcome.schema, RIG_POSE_OUTCOME_SCHEMA);
  assert.equal(warned.outcome.status, "warn");
  assert.equal(warned.outcome.metrics.violationCount, 2);
  const rejected = evaluateRigPose(document, pose, { limitPolicy: "reject" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.outcome.status, "rejected");
  assert.equal(rejected.transforms, null);
});

test("twist limits use the deterministic authored-joint primary axis", () => {
  const document = creatureRig();
  const pose = createRigPose({
    id: "pose:twist",
    rigId: document.id,
    rigRevision: document.revision,
    joints: [{ jointId: "arm", rotation: quaternion([1, 0, 0], 0.3) }],
  });
  const limits = evaluateRigPoseLimits(document, pose);
  assert.equal(limits.totalViolations, 1);
  assert.equal(limits.violations[0].kind, "twist");
  close(limits.violations[0].value, 0.3);
});

test("pose identity, rig revision and joint references are checked before evaluation", () => {
  const document = creatureRig();
  assert.throws(() => evaluateRigPose(document, {
    ...blankPose(document),
    rigId: "rig:other",
  }), /does not match/);
  assert.throws(() => evaluateRigPose(document, {
    ...blankPose(document),
    rigRevision: 42,
  }), /Stale rig pose/);
  assert.throws(() => evaluateRigPose(document, {
    ...blankPose(document),
    joints: [{ jointId: "missing", translation: [1, 0, 0], rotation: null }],
  }), /Unknown pose joint/);
});

test("portable named chains and role-gated pose cases evaluate in declared order", () => {
  const document = creatureRig();
  const suite = createRigPoseSuite({
    id: "suite:appendage",
    rigId: document.id,
    rigRevision: document.revision,
    chains: [{ id: "appendage", joints: ["root", "arm", "tip"] }],
    cases: [
      {
        id: "gentle",
        chainId: "appendage",
        requiredRoles: ["appendage"],
        pose: { joints: [{ jointId: "arm", rotation: quaternion([0, 0, 1], 0.1) }] },
      },
      {
        id: "missing-wing",
        requiredRoles: ["wing"],
        pose: { joints: [] },
      },
      {
        id: "disabled",
        enabled: false,
        pose: { joints: [] },
      },
    ],
  });
  assert.equal(suite.schema, RIG_POSE_SUITE_SCHEMA);
  const result = evaluateRigPoseSuite(document, suite);
  assert.equal(result.outcome.schema, RIG_POSE_SUITE_OUTCOME_SCHEMA);
  assert.deepEqual(result.cases.map(({ caseId, status }) => [caseId, status]), [
    ["gentle", "pass"],
    ["missing-wing", "skipped"],
    ["disabled", "skipped"],
  ]);
  assert.deepEqual(result.cases[0].chainJointIds, ["root", "arm", "tip"]);
  assert.deepEqual(result.outcome.summary, { passed: 1, warned: 0, rejected: 0, skipped: 2 });
});

test("non-contiguous and unknown suite chains are rejected", () => {
  const document = creatureRig();
  const nonContiguous = createRigPoseSuite({
    id: "suite:bad-chain",
    rigId: document.id,
    rigRevision: document.revision,
    chains: [{ id: "bad", joints: ["root", "tip"] }],
    cases: [],
  });
  assert.throws(() => validateRigPoseSuiteForRig(document, nonContiguous), /not contiguous/);
  const missing = createRigPoseSuite({
    id: "suite:missing-chain",
    rigId: document.id,
    rigRevision: document.revision,
    chains: [{ id: "bad", joints: ["root", "missing"] }],
    cases: [],
  });
  assert.throws(() => validateRigPoseSuiteForRig(document, missing), /Unknown chain joint/);
});

test("pose intents apply one immutable edit and reject stale revisions", () => {
  const document = creatureRig();
  const pose = blankPose(document, "pose:intents");
  const applied = applyRigPoseIntent(document, pose, {
    id: "intent:set-arm",
    type: "pose/joint-set",
    expectedRigRevision: document.revision,
    expectedPoseRevision: pose.revision,
    jointId: "arm",
    patch: { rotation: quaternion([0, 0, 1], 0.1) },
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.outcome.schema, RIG_POSE_INTENT_OUTCOME_SCHEMA);
  assert.equal(applied.pose.revision, 1);
  assert.equal(pose.revision, 0);
  const rejected = applyRigPoseIntent(document, applied.pose, {
    id: "intent:stale",
    type: "pose/reset",
    expectedRigRevision: document.revision,
    expectedPoseRevision: 0,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.pose.revision, 1);
  assert.match(rejected.outcome.error.message, /Stale pose revision/);
});

test("root translation offsets are reported as bounded root drift", () => {
  const document = createRigDocument({
    id: "rig:multi-root",
    assetId: "sha256:multi-root",
    joints: [
      { id: "root-a", parent: null },
      { id: "root-b", parent: null },
    ],
  });
  const pose = createRigPose({
    id: "pose:drift",
    rigId: document.id,
    rigRevision: document.revision,
    joints: [
      { jointId: "root-a", translation: [3, 4, 0] },
      { jointId: "root-b", translation: [0, 2, 0] },
    ],
  });
  assert.equal(evaluateRigPose(document, pose).outcome.metrics.rootDrift, 5);
});
