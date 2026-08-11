import assert from "node:assert/strict";
import test from "node:test";
import {
  RIG_EVIDENCE_SCHEMA,
  RIG_OUTCOME_SCHEMA,
  RIG_SCHEMA,
  addRigJoint,
  applyRigIntent,
  attachRigSkin,
  createRigDocument,
  deleteRigJoint,
  diagnoseRigWeights,
  mirrorRigJoints,
  normalizeRigDocument,
  normalizeVertexInfluences,
  renameRigJoint,
  reparentRigJoint,
  rigJointSegments,
  rigMetrics,
  rigRestWorldTransforms,
  seedRigWeightsByDistance,
  updateRigJoint,
  validateRigDocument,
} from "../src/rigging-model.js";

const closeTo = (actual, expected, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
};

function baseRig() {
  return createRigDocument({
    id: "rig:opal-creature",
    assetId: "sha256:source",
    joints: [
      { id: "root", parent: null, role: "root" },
      {
        id: "left-wing-base",
        parent: "root",
        role: "appendage/wing",
        rest: { translation: [-1, 0.5, 0] },
      },
      {
        id: "left-wing-tip",
        parent: "left-wing-base",
        role: "appendage/wing-tip",
        rest: { translation: [-0.75, 0.25, 0] },
      },
    ],
  });
}

test("rig documents normalize into a portable arbitrary skeleton contract", () => {
  const rig = baseRig();
  assert.equal(rig.schema, RIG_SCHEMA);
  assert.equal(rig.revision, 0);
  assert.deepEqual(rig.coordinateSystem, { up: "y", handedness: "right", unitScale: 1 });
  assert.deepEqual(rig.joints[0].rest, {
    translation: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });
  assert.deepEqual(rig.skin, {
    handleType: "rig/weights",
    weightSetId: null,
    maxInfluences: 4,
  });
  assert.deepEqual(validateRigDocument(rig), {
    valid: true,
    errors: [],
    warnings: [],
    truncated: false,
  });
});

test("validation rejects duplicate identities, missing parents, cycles and invalid transforms", () => {
  const duplicate = {
    ...baseRig(),
    joints: [
      baseRig().joints[0],
      { ...baseRig().joints[1], id: "root" },
    ],
  };
  assert.equal(validateRigDocument(duplicate).valid, false);
  assert.ok(validateRigDocument(duplicate).errors.some(({ code }) => code === "joint/duplicate-id"));

  const missing = {
    ...baseRig(),
    joints: [{ ...baseRig().joints[1], parent: "not-there" }],
  };
  assert.ok(validateRigDocument(missing).errors.some(({ code }) => code === "joint/missing-parent"));

  const cycle = {
    ...baseRig(),
    joints: [
      { ...baseRig().joints[0], parent: "left-wing-base" },
      { ...baseRig().joints[1], parent: "root" },
    ],
  };
  assert.ok(validateRigDocument(cycle).errors.some(({ code }) => code === "joint/cycle"));

  const invalidScale = {
    ...baseRig(),
    joints: [{ ...baseRig().joints[0], rest: { ...baseRig().joints[0].rest, scale: [1, 0, 1] } }],
  };
  assert.ok(validateRigDocument(invalidScale).errors.some(({ code }) => code === "joint/scale"));

  const invalidRotation = {
    ...baseRig(),
    joints: [{ ...baseRig().joints[0], rest: { ...baseRig().joints[0].rest, rotation: [0, 0, 0, 2] } }],
  };
  assert.ok(validateRigDocument(invalidRotation).errors.some(({ code }) => code === "joint/non-unit-rotation"));

  assert.throws(() => normalizeRigDocument({ ...baseRig(), renderer: new Float32Array([1, 2, 3]) }), /non-portable/i);
  const sparse = [...baseRig().joints];
  sparse.length += 1;
  assert.throws(() => normalizeRigDocument({ ...baseRig(), joints: sparse }), /non-portable/i);
});

test("joint authoring operations are immutable and advance one revision", () => {
  const original = baseRig();
  const added = addRigJoint(original, {
    id: "tail-base",
    parent: "root",
    role: "appendage/tail",
    rest: { translation: [0, -0.5, -0.5] },
  });
  assert.equal(original.revision, 0);
  assert.equal(original.joints.length, 3);
  assert.equal(added.revision, 1);
  assert.equal(added.joints.length, 4);

  const updated = updateRigJoint(added, "tail-base", {
    limits: { swing: 0.8, twist: [-0.25, 0.25] },
  });
  assert.deepEqual(updated.joints.find(({ id }) => id === "tail-base").limits, {
    swing: 0.8,
    twist: [-0.25, 0.25],
  });
  assert.equal(updated.revision, 2);

  const renamed = renameRigJoint(updated, "tail-base", "tail-1");
  assert.equal(renamed.joints.find(({ id }) => id === "tail-1").parent, "root");
  assert.equal(renamed.revision, 3);

  const skinned = attachRigSkin(renamed, {
    weightSetId: "weights:sha256:accepted",
    maxInfluences: 4,
  }, {
    inverseMatricesId: "bind:sha256:accepted",
  });
  assert.equal(skinned.skin.weightSetId, "weights:sha256:accepted");
  assert.equal(skinned.bind.inverseMatricesId, "bind:sha256:accepted");
  assert.equal(skinned.revision, 4);
});

test("reparenting blocks cycles and deletion requires an explicit cascade policy", () => {
  const rig = baseRig();
  assert.throws(() => reparentRigJoint(rig, "root", "left-wing-tip"), /cycle/i);
  assert.throws(() => deleteRigJoint(rig, "left-wing-base"), /enable cascade/i);
  const deleted = deleteRigJoint(rig, "left-wing-base", { cascade: true });
  assert.deepEqual(deleted.joints.map(({ id }) => id), ["root"]);
  assert.equal(deleted.revision, 1);
});

test("selected joint chains mirror deterministically without assuming humanoid anatomy", () => {
  const rig = baseRig();
  const mirrored = mirrorRigJoints(rig, {
    jointIds: ["left-wing-base", "left-wing-tip"],
    idMap: {
      "left-wing-base": "right-wing-base",
      "left-wing-tip": "right-wing-tip",
    },
    axis: "x",
  });
  const base = mirrored.joints.find(({ id }) => id === "right-wing-base");
  const tip = mirrored.joints.find(({ id }) => id === "right-wing-tip");
  assert.equal(base.parent, "root");
  assert.equal(tip.parent, "right-wing-base");
  assert.deepEqual(base.rest.translation, [1, 0.5, 0]);
  assert.deepEqual(tip.rest.translation, [0.75, 0.25, 0]);
  assert.equal(mirrored.revision, 1);
  assert.equal(validateRigDocument(mirrored).valid, true);
  assert.throws(() => mirrorRigJoints(rig, {
    jointIds: ["left-wing-base"],
    idMap: { "left-wing-base": "root" },
  }), /already exists/i);
});

test("rest world transforms and bone segments include parent rotation and scale", () => {
  const halfTurnZ = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const rig = createRigDocument({
    id: "rig:transform",
    assetId: "sha256:transform",
    joints: [
      {
        id: "root",
        parent: null,
        rest: { translation: [1, 0, 0], rotation: halfTurnZ, scale: [2, 2, 2] },
      },
      {
        id: "child",
        parent: "root",
        rest: { translation: [1, 0, 0] },
      },
    ],
  });
  const transforms = rigRestWorldTransforms(rig);
  closeTo(transforms[1].translation[0], 1);
  closeTo(transforms[1].translation[1], 2);
  closeTo(transforms[1].translation[2], 0);
  const segments = rigJointSegments(rig);
  assert.deepEqual(segments[1].start, [1, 0, 0]);
  closeTo(segments[1].length, 2);
});

test("vertex influences combine duplicates, cap deterministically and normalize", () => {
  const normalized = normalizeVertexInfluences([
    { joint: 2, weight: 1 },
    { joint: 1, weight: 2 },
    { joint: 2, weight: 1 },
    { joint: 3, weight: 0.5 },
  ], { maxInfluences: 2 });
  assert.deepEqual(normalized.influences.map(({ joint }) => joint), [1, 2]);
  closeTo(normalized.influences[0].weight, 0.5);
  closeTo(normalized.influences[1].weight, 0.5);
  closeTo(normalized.discardedMass, 0.5 / 4.5);
});

test("nearest-segment binding is deterministic, normalized and typed-array based", () => {
  const rig = createRigDocument({
    id: "rig:weights",
    assetId: "sha256:weights",
    skin: { maxInfluences: 2 },
    joints: [
      { id: "root", parent: null },
      { id: "right", parent: "root", rest: { translation: [1, 0, 0] } },
      { id: "left", parent: "root", rest: { translation: [-1, 0, 0] } },
    ],
  });
  const positions = new Float32Array([
    0.9, 0, 0,
    -0.9, 0, 0,
    0, 0, 0,
  ]);
  const first = seedRigWeightsByDistance({ document: rig, positions });
  const second = seedRigWeightsByDistance({ document: rig, positions });
  assert.ok(first.jointIndices instanceof Uint16Array);
  assert.ok(first.weights instanceof Float32Array);
  assert.deepEqual([...first.jointIndices], [...second.jointIndices]);
  assert.deepEqual([...first.weights], [...second.weights]);
  assert.equal(first.jointIndices[0], 1);
  assert.equal(first.jointIndices[2], 2);
  for (let vertex = 0; vertex < 3; vertex += 1) {
    const offset = vertex * 2;
    closeTo(first.weights[offset] + first.weights[offset + 1], 1, 1e-5);
  }
  assert.equal(first.summary.unweightedVertices, 0);
  assert.equal(first.summary.nonNormalizedVertices, 0);
  assert.equal(first.summary.distanceEvaluations, 9);
  assert.throws(() => seedRigWeightsByDistance({
    document: rig,
    positions,
    maximumDistanceEvaluations: 8,
  }), /bounded limit/i);
});

test("weight diagnostics expose malformed vertices without retaining mesh buffers", () => {
  const diagnostics = diagnoseRigWeights({
    jointIndices: [0, 0, 2, 0, 5, 0],
    weights: [0.5, 0.5, 0.25, 0.25, 1, 0],
    vertexCount: 3,
    maxInfluences: 2,
    jointCount: 3,
  });
  assert.equal(diagnostics.duplicateJointVertices, 1);
  assert.equal(diagnostics.nonNormalizedVertices, 1);
  assert.equal(diagnostics.outOfRangeJointVertices, 1);
  assert.equal(diagnostics.unweightedVertices, 0);
  assert.equal("weights" in diagnostics, false);
});

test("semantic intents return bounded outcomes and evidence while rejecting stale edits", () => {
  const rig = baseRig();
  const applied = applyRigIntent(rig, {
    id: "operation:add-tail",
    sequence: 12,
    expectedRevision: 0,
    type: "rig/joint-create",
    joint: {
      id: "tail",
      parent: "root",
      role: "appendage/tail",
      rest: { translation: [0, 0, -1] },
    },
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.outcome.schema, RIG_OUTCOME_SCHEMA);
  assert.equal(applied.evidence.schema, RIG_EVIDENCE_SCHEMA);
  assert.equal(applied.outcome.revisionBefore, 0);
  assert.equal(applied.outcome.revisionAfter, 1);
  assert.equal(applied.evidence.metrics.jointCount, 4);
  assert.equal(JSON.stringify(applied).includes("Float32Array"), false);

  const rejected = applyRigIntent(applied.document, {
    id: "operation:stale",
    expectedRevision: 0,
    type: "rig/joint-delete",
    jointId: "tail",
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.outcome.status, "rejected");
  assert.equal(rejected.document.revision, 1);
  assert.ok(rejected.outcome.error.message.includes("Stale rig revision"));
  assert.deepEqual(rejected.document, applied.document);
});

test("rig metrics remain compact for botanical and multi-root skeletons", () => {
  const rig = createRigDocument({
    id: "rig:lotus",
    assetId: "sha256:lotus",
    joints: [
      { id: "root", parent: null, role: "root" },
      { id: "petal-n-base", parent: "root", role: "petal", rest: { translation: [0, 0.2, 0] } },
      { id: "petal-n-tip", parent: "petal-n-base", role: "petal-tip", rest: { translation: [0, 0.8, 0] } },
      { id: "pollen-root", parent: null, role: "pollen" },
    ],
  });
  const validation = validateRigDocument(rig);
  assert.equal(validation.valid, true);
  assert.equal(validation.warnings[0].code, "joint/multiple-roots");
  assert.deepEqual(rigMetrics(rig), {
    jointCount: 4,
    rootCount: 2,
    leafCount: 2,
    maxDepth: 2,
    hasWeights: false,
    hasInverseBindMatrices: false,
  });
});
