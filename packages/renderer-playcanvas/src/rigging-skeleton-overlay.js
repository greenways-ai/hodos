import {
  BLEND_NORMAL,
  Color,
  Entity,
  Quat,
  StandardMaterial,
  Vec3,
} from "playcanvas";
import {
  normalizeRigDocument,
  normalizeRigEditor,
  previewRigJoint,
  rigRestWorldTransforms,
} from "@greenways/hodos-world-model/rigging";

const DEFAULT_COLORS = Object.freeze({
  joint: "#7fc7bd",
  root: "#e6bf68",
  selected: "#f0a84c",
  active: "#fff1b5",
  bone: "#5f8e88",
  selectedBone: "#d99742",
});

function color(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(value || "");
  if (!match) return new Color(1, 1, 1);
  const number = Number.parseInt(match[1], 16);
  return new Color(((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255);
}

function material(value, opacity = 1) {
  const output = new StandardMaterial();
  output.diffuse.copy(color(value));
  output.emissive.copy(color(value));
  output.emissiveIntensity = 0.55;
  output.opacity = opacity;
  output.metalness = 0.05;
  output.gloss = 0.65;
  if (opacity < 1) {
    output.blendType = BLEND_NORMAL;
    output.depthWrite = false;
  }
  output.update();
  return output;
}

function setEntityMaterial(entity, value) {
  if (!entity?.render) return;
  entity.render.material = value;
  for (const instance of entity.render.meshInstances ?? []) instance.material = value;
}

function point(value) {
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

export function rigSkeletonProjection(documentValue, editorValue = {}, previewValue = null) {
  const canonical = normalizeRigDocument(documentValue);
  const document = previewValue?.jointId && previewValue?.worldPosition
    ? previewRigJoint(canonical, previewValue.jointId, previewValue.worldPosition)
    : canonical;
  const editor = normalizeRigEditor(editorValue, document);
  const transforms = rigRestWorldTransforms(document);
  const byId = new Map(transforms.map((entry) => [entry.id, entry]));
  const joints = document.joints.map((joint, index) => {
    const transform = byId.get(joint.id);
    return {
      id: joint.id,
      parent: joint.parent,
      role: joint.role,
      index,
      position: point(transform.translation),
      selected: editor.selection.includes(joint.id),
      active: editor.active === joint.id,
      root: joint.parent === null,
    };
  });
  const jointById = new Map(joints.map((entry) => [entry.id, entry]));
  const bones = joints.filter((joint) => joint.parent).map((joint) => {
    const parent = jointById.get(joint.parent);
    return {
      id: `${joint.parent}->${joint.id}`,
      parentId: joint.parent,
      jointId: joint.id,
      start: point(parent.position),
      end: point(joint.position),
      selected: joint.selected || parent.selected,
      active: joint.active,
    };
  });
  return { document, editor, joints, bones };
}

export function projectRigJoints(projection, camera, canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = camera?.camera?.renderTarget?.width
    ?? camera?.camera?.system?.app?.graphicsDevice?.width
    ?? canvas.width
    ?? rect.width;
  const height = camera?.camera?.renderTarget?.height
    ?? camera?.camera?.system?.app?.graphicsDevice?.height
    ?? canvas.height
    ?? rect.height;
  if (!rect.width || !rect.height || !width || !height || !camera?.camera?.worldToScreen) return [];
  const projected = new Vec3();
  return projection.joints.map((joint) => {
    camera.camera.worldToScreen(new Vec3(...joint.position), projected);
    return {
      id: joint.id,
      x: projected.x / width * rect.width + rect.left,
      y: projected.y / height * rect.height + rect.top,
      depth: projected.z,
      visible: projected.z > 0,
      active: joint.active,
      selected: joint.selected,
    };
  });
}

export function pickProjectedRigJoint(candidates, clientX, clientY, radius = 22) {
  let nearest = null;
  for (const candidate of candidates) {
    if (!candidate.visible) continue;
    const distance = Math.hypot(candidate.x - clientX, candidate.y - clientY);
    if (distance > radius) continue;
    if (!nearest
      || distance < nearest.distance
      || (distance === nearest.distance && candidate.depth < nearest.candidate.depth)) {
      nearest = { candidate, distance };
    }
  }
  return nearest?.candidate ?? null;
}

export class RigSkeletonOverlay {
  constructor({
    app,
    camera,
    canvas,
    markerSize = 0.09,
    boneRadius = 0.025,
    colors = {},
  } = {}) {
    if (!app?.root) throw new TypeError("RigSkeletonOverlay requires a PlayCanvas application");
    if (!camera?.camera) throw new TypeError("RigSkeletonOverlay requires a PlayCanvas camera entity");
    if (!canvas?.getBoundingClientRect) throw new TypeError("RigSkeletonOverlay requires a canvas");
    this.app = app;
    this.camera = camera;
    this.canvas = canvas;
    this.markerSize = Math.max(0.001, Number(markerSize) || 0.09);
    this.boneRadius = Math.max(0.001, Number(boneRadius) || 0.025);
    this.colors = Object.freeze({ ...DEFAULT_COLORS, ...colors });
    this.materials = {
      joint: material(this.colors.joint),
      root: material(this.colors.root),
      selected: material(this.colors.selected),
      active: material(this.colors.active),
      bone: material(this.colors.bone, 0.82),
      selectedBone: material(this.colors.selectedBone, 0.95),
    };
    this.root = new Entity("Hodos rig skeleton overlay");
    this.app.root.addChild(this.root);
    this.joints = new Map();
    this.bones = new Map();
    this.projection = null;
    this.visible = true;
  }

  sync(documentValue, editorValue = {}, { preview = null } = {}) {
    this.projection = rigSkeletonProjection(documentValue, editorValue, preview);
    const jointIds = new Set(this.projection.joints.map(({ id }) => id));
    const boneIds = new Set(this.projection.bones.map(({ id }) => id));
    for (const [id, entry] of this.joints) if (!jointIds.has(id)) this.removeJoint(id, entry);
    for (const [id, entry] of this.bones) if (!boneIds.has(id)) this.removeBone(id, entry);
    for (const joint of this.projection.joints) this.syncJoint(joint);
    for (const bone of this.projection.bones) this.syncBone(bone);
    this.root.enabled = this.visible && this.projection.editor.mode === "edit";
    return this.projection;
  }

  syncJoint(joint) {
    let entry = this.joints.get(joint.id);
    if (!entry) {
      const entity = new Entity(`Rig joint ${joint.id}`);
      entity.addComponent("render", { type: "sphere", material: this.materials.joint });
      entity.tags?.add?.("hodos-rig-joint", `hodos-rig-joint:${joint.id}`);
      this.root.addChild(entity);
      entry = { entity, jointId: joint.id };
      this.joints.set(joint.id, entry);
    }
    entry.entity.setPosition(...joint.position);
    const scale = this.markerSize * (joint.active ? 1.45 : joint.selected ? 1.22 : joint.root ? 1.12 : 1);
    entry.entity.setLocalScale(scale, scale, scale);
    setEntityMaterial(entry.entity, joint.active
      ? this.materials.active
      : joint.selected
        ? this.materials.selected
        : joint.root
          ? this.materials.root
          : this.materials.joint);
    entry.entity.enabled = true;
  }

  syncBone(bone) {
    let entry = this.bones.get(bone.id);
    if (!entry) {
      const entity = new Entity(`Rig bone ${bone.id}`);
      entity.addComponent("render", { type: "cylinder", material: this.materials.bone });
      entity.tags?.add?.("hodos-rig-bone", `hodos-rig-bone:${bone.jointId}`);
      this.root.addChild(entity);
      entry = { entity, boneId: bone.id };
      this.bones.set(bone.id, entry);
    }
    const start = new Vec3(...bone.start);
    const end = new Vec3(...bone.end);
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length <= 1e-8) {
      entry.entity.enabled = false;
      return;
    }
    const midpoint = start.clone().add(end).mulScalar(0.5);
    const rotation = new Quat();
    rotation.setFromDirections(new Vec3(0, 1, 0), direction.clone().normalize());
    entry.entity.enabled = true;
    entry.entity.setPosition(midpoint);
    entry.entity.setRotation(rotation);
    entry.entity.setLocalScale(this.boneRadius, length / 2, this.boneRadius);
    setEntityMaterial(entry.entity, bone.selected ? this.materials.selectedBone : this.materials.bone);
  }

  pick(clientX, clientY, { radius = 22 } = {}) {
    if (!this.projection || !this.root.enabled) return null;
    return pickProjectedRigJoint(projectRigJoints(this.projection, this.camera, this.canvas), clientX, clientY, radius);
  }

  position(jointId) {
    return this.projection?.joints.find((joint) => joint.id === jointId)?.position ?? null;
  }

  setVisible(value) {
    this.visible = Boolean(value);
    if (this.root) this.root.enabled = this.visible && this.projection?.editor?.mode !== "preview";
  }

  removeJoint(id, entry = this.joints.get(id)) {
    entry?.entity?.destroy?.();
    this.joints.delete(id);
  }

  removeBone(id, entry = this.bones.get(id)) {
    entry?.entity?.destroy?.();
    this.bones.delete(id);
  }

  destroy() {
    for (const [id, entry] of [...this.joints]) this.removeJoint(id, entry);
    for (const [id, entry] of [...this.bones]) this.removeBone(id, entry);
    this.root?.destroy?.();
    for (const value of Object.values(this.materials)) value.destroy?.();
    this.projection = null;
  }
}
