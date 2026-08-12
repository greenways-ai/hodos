import assert from "node:assert/strict";
import test from "node:test";
import { createHodosHost, hodosCoreAddon } from "@greenways/hodos-core";
import {
  applyRigIkProposal,
  createRigDocument,
  createRigIkRequest,
  createRigPose,
  createRigPoseSuite,
  hodosWorldModelAddon,
  rigPoseWorldTransforms,
} from "@greenways/hodos-world-model";
import {
  HODOS_PLAYCANVAS_RIGGING_IK_ADDON_ID,
  RIG_IK_PROVIDER_ID,
  RIG_IK_PROVIDER_VERSION,
  RiggingIkProvider,
  hodosPlayCanvasRiggingIkAddon,
  solveRiggingIk,
} from "../src/rigging-ik-addon.js";

const close = (actual, expected, tolerance = 1e-4) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
};

function makeFixture({
  id,
  names,
  translations,
  roles = [],
  limits = {},
  coordinateSystem,
} = {}) {
  const joints = names.map((name, index) => ({
    id: name,
    parent: index === 0 ? null : names[index - 1],
    role: roles[index] ?? `role:${index}`,
    rest: { translation: index === 0 ? [0, 0, 0] : translations[index - 1] },
    ...(limits[name] ? { limits: limits[name] } : {}),
  }));
  const document = createRigDocument({
    id: `rig:${id}`,
    assetId: `sha256:${id}`,
    ...(coordinateSystem ? { coordinateSystem } : {}),
    joints,
  });
  const pose = createRigPose({ id: `pose:${id}`, rigId: document.id, rigRevision: document.revision });
  const suite = createRigPoseSuite({
    id: `suite:${id}`,
    rigId: document.id,
    rigRevision: document.revision,
    chains: [{ id: "primary", name: `${id} primary`, joints: names }],
  });
  return { document, pose, suite, names };
}

function requestFor(fixture, {
  method = "fabrik",
  target,
  pole,
  limitPolicy = "clamp",
  tolerance = 1e-4,
  maximumIterations = 24,
  maximumChainLength = 32,
  maximumTemporaryBytes = 512 * 1024,
} = {}) {
  return createRigIkRequest({
    id: `ik:${fixture.document.id}:${method}:${target.join(",")}`,
    method,
    rigId: fixture.document.id,
    rigRevision: fixture.document.revision,
    poseId: fixture.pose.id,
    poseRevision: fixture.pose.revision,
    suiteId: fixture.suite.id,
    chainId: "primary",
    target,
    ...(pole ? { pole } : {}),
    limitPolicy,
    tolerance,
    maximumIterations,
    maximumChainLength,
    maximumTemporaryBytes,
  });
}

function solveInput(fixture, request, signal) {
  return {
    document: fixture.document,
    pose: fixture.pose,
    suite: fixture.suite,
    request,
    ...(signal ? { signal } : {}),
  };
}

function tipDistance(fixture, pose, target) {
  const transforms = rigPoseWorldTransforms(fixture.document, pose);
  const tip = transforms.find((entry) => entry.id === fixture.names.at(-1)).translation;
  return Math.hypot(...tip.map((entry, index) => entry - target[index]));
}

test("the IK contribution is isolated behind the rig.ik host capability", async () => {
  const denied = createHodosHost();
  denied.register(hodosCoreAddon, hodosWorldModelAddon, hodosPlayCanvasRiggingIkAddon);
  await assert.rejects(
    denied.activate(HODOS_PLAYCANVAS_RIGGING_IK_ADDON_ID),
    /requires host capabilities: rig\.ik/,
  );

  const granted = createHodosHost({ capabilities: ["rig.ik"] });
  granted.register(hodosCoreAddon, hodosWorldModelAddon, hodosPlayCanvasRiggingIkAddon);
  await granted.activate(HODOS_PLAYCANVAS_RIGGING_IK_ADDON_ID);
  const contribution = granted.getContribution("rig.ik", "playcanvas-local");
  assert.equal(contribution.providerId, RIG_IK_PROVIDER_ID);
  assert.equal(contribution.providerVersion, RIG_IK_PROVIDER_VERSION);
  assert.equal(contribution.Provider, RiggingIkProvider);
});

test("analytic two-bone IK uses arbitrary chain names, pole targets, and deterministic bend selection", async () => {
  const fixture = makeFixture({
    id: "limb",
    names: ["base-plate", "amber-hinge", "tool-tip"],
    translations: [[2, 0, 0], [1, 0, 0]],
  });
  const target = [2, 1, 0];
  const request = requestFor(fixture, {
    method: "analytic-two-bone",
    target,
    pole: [0, 0, 2],
  });
  const first = await solveRiggingIk(solveInput(fixture, request));
  const second = await solveRiggingIk(solveInput(fixture, request));
  assert.deepEqual(second, first);
  assert.equal(first.ok, true);
  assert.equal(first.evidence.status, "converged");
  assert.equal(first.evidence.classification, "reachable");
  assert.deepEqual(first.proposal.joints.map((entry) => entry.jointId), ["base-plate", "amber-hinge"]);
  const accepted = applyRigIkProposal(fixture.document, fixture.pose, first.proposal);
  assert.equal(accepted.ok, true);
  close(tipDistance(fixture, accepted.pose, target), 0, 1e-4);
});

test("unreachable two-bone targets produce a reach-clamped proposal and compact classification", async () => {
  const fixture = makeFixture({
    id: "asymmetric-limb",
    names: ["socket", "fold", "needle"],
    translations: [[2, 0, 0], [0.5, 0, 0]],
  });
  const target = [10, 0, 0];
  const result = await solveRiggingIk(solveInput(fixture, requestFor(fixture, {
    method: "analytic-two-bone",
    target,
    pole: [0, 1, 0],
  })));
  assert.equal(result.ok, true);
  assert.equal(result.proposal.status, "clamped");
  assert.equal(result.evidence.classification, "unreachable");
  close(result.evidence.maximumReach, 2.5);
  close(result.evidence.finalDistance, 7.5);
});

test("singular chains are classified without returning or applying a proposal", async () => {
  const fixture = makeFixture({
    id: "singular",
    names: ["origin", "coincident", "tip"],
    translations: [[0, 0, 0], [1, 0, 0]],
  });
  const before = structuredClone(fixture.pose);
  const result = await solveRiggingIk(solveInput(fixture, requestFor(fixture, {
    method: "analytic-two-bone",
    target: [1, 1, 0],
    pole: [0, 0, 1],
  })));
  assert.equal(result.ok, false);
  assert.equal(result.proposal, null);
  assert.equal(result.evidence.classification, "singular");
  assert.deepEqual(fixture.pose, before);
});

const generalFixtures = [
  makeFixture({
    id: "tail",
    names: ["tail-root", "tail-a", "tail-b", "tail-c", "tail-tip"],
    translations: [[1, 0, 0], [0.9, 0.1, 0], [0.8, 0.15, 0], [0.7, 0.2, 0]],
  }),
  makeFixture({
    id: "petal",
    names: ["stamen", "petal-low", "petal-mid", "petal-crown"],
    translations: [[0, 1, 0], [0.35, 0.8, 0], [0.25, 0.65, 0]],
  }),
  makeFixture({
    id: "wing",
    names: ["wing-pin", "leading-edge", "outer-feather", "wing-tip"],
    translations: [[1.4, 0.2, 0], [0.9, 0.5, 0.1], [0.55, 0.2, 0.2]],
  }),
  makeFixture({
    id: "asymmetric-chain",
    names: ["root-a", "long-b", "short-c", "offset-d"],
    translations: [[2, 0, 0], [0.45, 0.3, 0], [0.2, 0.1, 0.15]],
  }),
];

const generalTargets = [
  [2.6, 1.6, 0.2],
  [1.1, 2.0, 0.45],
  [2.1, 1.35, 0.65],
  [1.85, 0.95, 0.5],
];

test("bounded FABRIK conformance covers tails, petals, wings, and asymmetric chains", async () => {
  for (let index = 0; index < generalFixtures.length; index += 1) {
    const fixture = generalFixtures[index];
    const target = generalTargets[index];
    const request = requestFor(fixture, { target, tolerance: 1e-5, maximumIterations: 48 });
    const result = await solveRiggingIk(solveInput(fixture, request));
    assert.equal(result.ok, true, fixture.document.id);
    assert.ok(["reachable", "unreachable", "limit-clamped"].includes(result.evidence.classification));
    assert.ok(result.evidence.iterations <= request.maximumIterations);
    assert.ok(result.evidence.temporaryBytes <= request.maximumTemporaryBytes);
    const accepted = applyRigIkProposal(fixture.document, fixture.pose, result.proposal);
    assert.equal(accepted.ok, true);
    assert.ok(tipDistance(fixture, accepted.pose, target) <= Math.max(0.02, result.evidence.finalDistance + 1e-5));
  }
});

test("iteration exhaustion and stale revisions leave the accepted pose unchanged", async () => {
  const fixture = makeFixture({
    id: "exhaustion",
    names: ["root", "j1", "j2", "j3", "j4", "tip"],
    translations: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-0.5, 0.5, 0], [0.4, 0, 0.4]],
  });
  const before = structuredClone(fixture.pose);
  const exhausted = await solveRiggingIk(solveInput(fixture, requestFor(fixture, {
    target: [0.25, -0.5, 2.75],
    tolerance: 1e-8,
    maximumIterations: 1,
  })));
  assert.equal(exhausted.ok, false);
  assert.equal(exhausted.evidence.classification, "iteration-exhausted");
  assert.deepEqual(fixture.pose, before);

  const staleRequest = { ...requestFor(fixture, { target: [1, 1, 1] }), poseRevision: fixture.pose.revision + 1 };
  const stale = await solveRiggingIk(solveInput(fixture, staleRequest));
  assert.equal(stale.ok, false);
  assert.equal(stale.evidence.classification, "stale");
  assert.deepEqual(fixture.pose, before);
});

test("cancellation and provider destruction stop bounded solves without late proposals", async () => {
  const fixture = makeFixture({
    id: "cancel",
    names: ["root", "a", "b", "c", "d", "e", "tip"],
    translations: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0.5, 0.5, 0.5]],
  });
  const controller = new AbortController();
  controller.abort();
  const cancelled = await solveRiggingIk(
    solveInput(fixture, requestFor(fixture, { target: [2, 2, 2], maximumIterations: 64 }), controller.signal),
  );
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.evidence.status, "cancelled");

  let provider;
  provider = new RiggingIkProvider({
    yieldEvery: 1,
    yieldControl: async () => provider.destroy(),
    maximumIterations: 64,
  });
  const destroyed = await provider.solve(solveInput(fixture, requestFor(fixture, {
    target: [0.2, -0.7, 2.8],
    tolerance: 1e-8,
    maximumIterations: 64,
  })));
  assert.equal(destroyed.ok, false);
  assert.equal(destroyed.evidence.classification, "cancelled");
  await assert.rejects(() => provider.solve(solveInput(fixture, requestFor(fixture, { target: [1, 1, 1] }))), /destroyed/);
});

test("chain and temporary-byte limits reject before solver arrays are allocated", async () => {
  const fixture = generalFixtures[0];
  const chainLimited = await solveRiggingIk(solveInput(fixture, requestFor(fixture, {
    target: [1, 1, 0],
    maximumChainLength: 2,
  })));
  assert.equal(chainLimited.ok, false);
  assert.equal(chainLimited.evidence.classification, "resource-limit");

  const longFixture = makeFixture({
    id: "byte-limit",
    names: ["root", "a", "b", "c", "d", "e", "f", "tip"],
    translations: Array.from({ length: 7 }, () => [0.5, 0.25, 0.1]),
  });
  const byteLimited = await solveRiggingIk(solveInput(longFixture, requestFor(longFixture, {
    target: [1, 1, 0],
    maximumTemporaryBytes: 1024,
  })), { maximumTemporaryBytes: 1024 });
  assert.equal(byteLimited.ok, false);
  assert.equal(byteLimited.evidence.classification, "resource-limit");
  assert.equal(byteLimited.evidence.error.code, "rig-ik/temporary-byte-limit");
  assert.ok(byteLimited.evidence.temporaryBytes > byteLimited.evidence.bounds.maximumTemporaryBytes);
});

test("authored limits can reject or clamp a proposal without mutating the base pose", async () => {
  const fixture = makeFixture({
    id: "limited-wing",
    names: ["pin", "elbow", "tip"],
    translations: [[1, 0, 0], [1, 0, 0]],
    limits: { pin: { axes: { z: [-0.1, 0.1] } } },
  });
  const target = [0, 2, 0];
  const rejected = await solveRiggingIk(solveInput(fixture, requestFor(fixture, {
    method: "analytic-two-bone",
    target,
    pole: [0, 0, 1],
    limitPolicy: "reject",
  })));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.evidence.classification, "limit-rejected");
  assert.equal(fixture.pose.revision, 0);

  const clamped = await solveRiggingIk(solveInput(fixture, requestFor(fixture, {
    method: "analytic-two-bone",
    target,
    pole: [0, 0, 1],
    limitPolicy: "clamp",
  })));
  assert.equal(clamped.ok, true);
  assert.equal(clamped.proposal.status, "clamped");
  assert.equal(clamped.evidence.limits.remaining, 0);
  assert.ok(clamped.evidence.limits.clampedJointCount > 0);
});
