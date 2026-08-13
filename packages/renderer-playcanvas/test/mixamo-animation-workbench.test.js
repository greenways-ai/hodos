import assert from "node:assert/strict";
import test from "node:test";
import {
  AnimCurve,
  AnimData,
  AnimTrack,
  INTERPOLATION_LINEAR,
} from "playcanvas";
import {
  createMixamoPoseTrack,
  createProceduralMixamoMannequin,
  retargetMixamoAnimationTrack,
} from "../src/mixamo-animation-workbench.js";
import { inspectPlayCanvasMixamoCharacter } from "../src/mixamo-character-loader.js";

function testApp() {
  return { _entityIndex: Object.create(null) };
}

function renameMixamoJoints(root, transform) {
  const visit = (node) => {
    if (node.name.startsWith("mixamorig:")) node.name = transform(node.name.slice("mixamorig:".length));
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
}

test("the procedural mannequin is a rights-clean Mixamo-compatible character", () => {
  const mannequin = createProceduralMixamoMannequin(testApp(), {
    attach: false,
    visuals: false,
    animation: false,
  });
  const profile = inspectPlayCanvasMixamoCharacter(mannequin.root, {
    id: "procedural/profile",
    assetId: "builtin:hodos/mannequin",
  });
  assert.equal(profile.status, "supported");
  assert.equal(profile.family, "mixamo");
  assert.equal(profile.missingRequired.length, 0);
  assert.equal(profile.joints.hips.nodeName, "mixamorig:Hips");
  mannequin.root.destroy();
});

test("pose keys compile to real PlayCanvas rotation curves", () => {
  const mannequin = createProceduralMixamoMannequin(testApp(), {
    attach: false,
    visuals: false,
    animation: false,
  });
  const profile = inspectPlayCanvasMixamoCharacter(mannequin.root, { id: "pose/profile" });
  const track = createMixamoPoseTrack({
    name: "Browser wave",
    duration: 2,
    profile,
    keyframes: [
      { at: 0, joints: { "right-arm": [0, 0, 0], "right-forearm": [0, 0, 0] } },
      { at: 1, joints: { "right-arm": [0, 0, 72], "right-forearm": [25, 0, 55] } },
      { at: 2, joints: { "right-arm": [0, 0, 0], "right-forearm": [0, 0, 0] } },
    ],
  });
  assert.equal(track.name, "Browser wave");
  assert.equal(track.duration, 2);
  assert.equal(track.curves.length, 2);
  assert.deepEqual(track.curves.map((curve) => curve.paths[0].propertyPath), [
    ["localRotation"],
    ["localRotation"],
  ]);
  assert.ok(track.outputs.every((output) => output.components === 4));
  mannequin.root.destroy();
});

test("same-family retargeting remaps joint paths and makes root motion explicit", () => {
  const source = createProceduralMixamoMannequin(testApp(), {
    attach: false,
    visuals: false,
    animation: false,
  });
  const target = createProceduralMixamoMannequin(testApp(), {
    attach: false,
    visuals: false,
    animation: false,
  });
  const sourceProfile = inspectPlayCanvasMixamoCharacter(source.root, { id: "source/profile" });
  renameMixamoJoints(target.root, (name) => name);
  const targetProfile = inspectPlayCanvasMixamoCharacter(target.root, { id: "target/profile" });

  const inputs = [new AnimData(1, [0, 1])];
  const outputs = [
    new AnimData(4, [0, 0, 0, 1, 0, 0.3826834, 0, 0.9238795]),
    new AnimData(3, [0, 0, 0, 0, 0, 1]),
  ];
  const sourceArm = sourceProfile.joints["right-arm"].nodeName;
  const sourceHips = sourceProfile.joints.hips.nodeName;
  const track = new AnimTrack("Source motion", 1, inputs, outputs, [
    new AnimCurve([{
      entityPath: [sourceArm],
      component: "graph",
      propertyPath: ["localRotation"],
    }], 0, 0, INTERPOLATION_LINEAR),
    new AnimCurve([{
      entityPath: [sourceHips],
      component: "graph",
      propertyPath: ["localPosition"],
    }], 0, 1, INTERPOLATION_LINEAR),
  ]);

  const inPlace = retargetMixamoAnimationTrack(track, sourceProfile, targetProfile, {
    name: "in-place",
    rootMotion: "none",
  });
  assert.equal(inPlace.track.curves.length, 1);
  assert.equal(inPlace.track.curves[0].paths[0].entityPath[0], "RightArm");
  assert.deepEqual(inPlace.evidence.mappedJoints, ["right-arm"]);
  assert.ok(inPlace.evidence.droppedJoints.includes("hips:root-motion"));

  const moving = retargetMixamoAnimationTrack(track, sourceProfile, targetProfile, {
    name: "moving",
    rootMotion: "apply",
  });
  assert.equal(moving.track.curves.length, 2);
  assert.equal(moving.track.curves[1].paths[0].entityPath[0], "Hips");
  assert.deepEqual(moving.evidence.mappedJoints, ["hips", "right-arm"]);
  source.root.destroy();
  target.root.destroy();
});
