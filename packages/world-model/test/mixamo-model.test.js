import assert from "node:assert/strict";
import test from "node:test";
import {
  MIXAMO_CORE_JOINTS,
  MIXAMO_PROFILE_SCHEMA,
  MIXAMO_RETARGET_PLAN_SCHEMA,
  createMixamoRetargetPlan,
  inspectMixamoSkeleton,
  mixamoCoreJoint,
  mixamoProfileSupported,
  normalizeMixamoJointName,
  normalizeMixamoProfile,
  validateMixamoProfile,
} from "../src/mixamo-model.js";

const parent = {
  Hips: null,
  Spine: "Hips",
  Spine1: "Spine",
  Spine2: "Spine1",
  Neck: "Spine2",
  Head: "Neck",
  LeftShoulder: "Spine2",
  LeftArm: "LeftShoulder",
  LeftForeArm: "LeftArm",
  LeftHand: "LeftForeArm",
  RightShoulder: "Spine2",
  RightArm: "RightShoulder",
  RightForeArm: "RightArm",
  RightHand: "RightForeArm",
  LeftUpLeg: "Hips",
  LeftLeg: "LeftUpLeg",
  LeftFoot: "LeftLeg",
  LeftToeBase: "LeftFoot",
  RightUpLeg: "Hips",
  RightLeg: "RightUpLeg",
  RightFoot: "RightLeg",
  RightToeBase: "RightFoot",
  LeftHandIndex1: "LeftHand",
  LeftHandIndex2: "LeftHandIndex1",
  LeftHandIndex3: "LeftHandIndex2",
};

function skeleton({ prefix = "mixamorig:", suffix = "", includeOptional = true } = {}) {
  const names = Object.keys(parent).filter((name) => includeOptional || ![
    "LeftToeBase",
    "RightToeBase",
    "LeftHandIndex1",
    "LeftHandIndex2",
    "LeftHandIndex3",
  ].includes(name));
  return names.map((name) => ({
    id: `${suffix || "source"}:${name}`,
    name: `${prefix}${name}`,
    parentId: parent[name] ? `${suffix || "source"}:${parent[name]}` : null,
  }));
}

test("normalizes Mixamo namespaces, stripped names, and finger chains", () => {
  assert.equal(normalizeMixamoJointName("mixamorig:Hips"), "hips");
  assert.equal(normalizeMixamoJointName("Armature|mixamorig:LeftForeArm"), "left-forearm");
  assert.equal(normalizeMixamoJointName("mixamorig_LeftHandIndex3"), "left-hand-index-3");
  assert.equal(normalizeMixamoJointName("RightUpLeg"), "right-up-leg");
  assert.equal(normalizeMixamoJointName("BodyMesh"), null);
  assert.equal(mixamoCoreJoint("mixamorig:LeftFoot"), "left-foot");
  assert.equal(mixamoCoreJoint("mixamorig:LeftToeBase"), null);
});

test("inspects a complete Mixamo hierarchy into portable profile evidence", () => {
  const nodes = [
    { id: "mesh", name: "CharacterMesh", parentId: null },
    ...skeleton(),
  ];
  const profile = inspectMixamoSkeleton(nodes, {
    id: "character/opal",
    assetId: "sha256:opal",
  });
  assert.equal(profile.schema, MIXAMO_PROFILE_SCHEMA);
  assert.equal(profile.status, "supported");
  assert.equal(profile.family, "mixamo");
  assert.equal(profile.rootJoint, "hips");
  assert.equal(profile.joints["left-forearm"].parentJoint, "left-arm");
  assert.equal(profile.joints["left-hand-index-3"].parentJoint, "left-hand-index-2");
  assert.equal(profile.source.unknownNames.includes("CharacterMesh"), true);
  assert.equal(profile.missingRequired.length, 0);
  assert.equal(profile.duplicateJoints.length, 0);
  assert.equal(profile.capabilities.includes("character.animation"), true);
  assert.doesNotThrow(() => JSON.stringify(profile));
  assert.equal(JSON.stringify(profile).includes("children"), false);
  assert.equal(mixamoProfileSupported(profile), true);
  assert.equal(validateMixamoProfile(profile).valid, true);
});

test("accepts namespace-stripped converted GLB skeletons with an explicit warning", () => {
  const profile = inspectMixamoSkeleton(skeleton({ prefix: "" }), {
    id: "character/stripped",
    mediaType: "model/gltf+json",
  });
  assert.equal(profile.status, "supported");
  assert.equal(profile.family, "mixamo-compatible");
  assert.equal(profile.source.prefixedNameCount, 0);
  assert.equal(profile.diagnostics.warnings.some(({ code }) => code === "mixamo/prefix-stripped"), true);
});

test("fails closed for missing, duplicate, and unconverted FBX skeletons", () => {
  const missing = skeleton().filter(({ name }) => name !== "mixamorig:Head");
  const missingProfile = inspectMixamoSkeleton(missing, { id: "character/missing" });
  assert.equal(missingProfile.status, "unsupported");
  assert.equal(missingProfile.missingRequired.includes("head"), true);

  const duplicateProfile = inspectMixamoSkeleton([
    ...skeleton(),
    { id: "duplicate-hand", name: "mixamorig:LeftHand", parentId: "source:LeftForeArm" },
  ], { id: "character/duplicate" });
  assert.equal(duplicateProfile.status, "unsupported");
  assert.equal(duplicateProfile.duplicateJoints.includes("left-hand"), true);

  const fbxProfile = inspectMixamoSkeleton(skeleton(), {
    id: "character/fbx",
    mediaType: "application/vnd.autodesk.fbx",
  });
  assert.equal(fbxProfile.status, "unsupported");
  assert.equal(fbxProfile.diagnostics.errors.some(({ code }) => code === "mixamo/media-type"), true);
});

test("builds a deterministic same-family retarget plan and path map", () => {
  const source = inspectMixamoSkeleton(skeleton({ suffix: "source" }), {
    id: "profile/source",
    assetId: "sha256:source",
  });
  const target = inspectMixamoSkeleton(skeleton({ prefix: "", suffix: "target" }), {
    id: "profile/target",
    assetId: "sha256:target",
  });
  const plan = createMixamoRetargetPlan(source, target, {
    id: "retarget/source-to-target",
    rootMotion: "extract",
  });
  assert.equal(plan.schema, MIXAMO_RETARGET_PLAN_SCHEMA);
  assert.equal(plan.mode, "same-family");
  assert.equal(plan.translationPolicy, "hips-only");
  assert.equal(plan.joints.filter(({ joint }) => MIXAMO_CORE_JOINTS.includes(joint)).length, MIXAMO_CORE_JOINTS.length);
  assert.equal(plan.pathMap["mixamorig:LeftForeArm"], "LeftForeArm");
  assert.deepEqual(plan.unmappedSourceOptional, []);
  assert.doesNotThrow(() => JSON.stringify(plan));
});

test("normalization rejects a forged supported profile that omits core joints", () => {
  assert.throws(() => normalizeMixamoProfile({
    schema: MIXAMO_PROFILE_SCHEMA,
    id: "forged",
    status: "supported",
    joints: {},
    source: { mediaType: "model/gltf-binary" },
  }), /claims support while missing/);
});
