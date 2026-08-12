import { Vec3 } from "playcanvas";
import { rigRestWorldTransforms } from "@greenways/hodos-world-model/rigging";

export const RIG_TRANSLATE_AXES = Object.freeze({
  x: Object.freeze([1, 0, 0]),
  y: Object.freeze([0, 1, 0]),
  z: Object.freeze([0, 0, 1]),
});

function finitePoint(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    ? [...value]
    : null;
}

function projectPoint(camera, canvas, point) {
  if (!camera?.camera?.worldToScreen || !canvas?.getBoundingClientRect) return null;
  const rect = canvas.getBoundingClientRect();
  const width = camera.camera.renderTarget?.width
    ?? camera.camera.system?.app?.graphicsDevice?.width
    ?? canvas.width
    ?? rect.width;
  const height = camera.camera.renderTarget?.height
    ?? camera.camera.system?.app?.graphicsDevice?.height
    ?? canvas.height
    ?? rect.height;
  if (!rect.width || !rect.height || !width || !height) return null;
  const projected = new Vec3();
  camera.camera.worldToScreen(new Vec3(...point), projected);
  return {
    x: projected.x / width * rect.width,
    y: projected.y / height * rect.height,
    depth: projected.z,
    visible: projected.z > 0,
  };
}

export function projectRigTranslateAxes(camera, canvas, positionValue, worldLengthValue = 0.35) {
  const position = finitePoint(positionValue);
  const worldLength = Math.max(0.0001, Number(worldLengthValue) || 0.35);
  if (!position) return null;
  const origin = projectPoint(camera, canvas, position);
  if (!origin?.visible) return null;
  const axes = {};
  for (const [axis, direction] of Object.entries(RIG_TRANSLATE_AXES)) {
    const endpoint = projectPoint(
      camera,
      canvas,
      position.map((entry, index) => entry + direction[index] * worldLength),
    );
    if (!endpoint?.visible) continue;
    const dx = endpoint.x - origin.x;
    const dy = endpoint.y - origin.y;
    const screenLength = Math.hypot(dx, dy);
    if (screenLength < 4) continue;
    axes[axis] = {
      axis,
      direction: [...direction],
      endpoint,
      screenDirection: [dx / screenLength, dy / screenLength],
      screenLength,
      worldLength,
    };
  }
  return { origin, position, axes };
}

export function rigScreenAxisAmount({
  startX,
  startY,
  clientX,
  clientY,
  screenDirection,
  screenLength,
  worldLength,
} = {}) {
  const direction = Array.isArray(screenDirection) ? screenDirection : [0, 0];
  const length = Math.max(0.0001, Number(screenLength) || 0);
  const world = Number(worldLength) || 0;
  const dx = Number(clientX) - Number(startX);
  const dy = Number(clientY) - Number(startY);
  return (dx * direction[0] + dy * direction[1]) / length * world;
}

export class RigTranslateHandles {
  constructor({
    app,
    camera,
    canvas,
    root,
    worldLength = 0.35,
    onPreview = null,
    onCommit = null,
    onCancel = null,
  } = {}) {
    if (!root?.ownerDocument) throw new TypeError("RigTranslateHandles requires an overlay root");
    this.app = app;
    this.camera = camera;
    this.canvas = canvas;
    this.host = root;
    this.worldLength = Math.max(0.0001, Number(worldLength) || 0.35);
    this.onPreview = typeof onPreview === "function" ? onPreview : () => {};
    this.onCommit = typeof onCommit === "function" ? onCommit : () => {};
    this.onCancel = typeof onCancel === "function" ? onCancel : () => {};
    this.document = null;
    this.editor = null;
    this.activeId = null;
    this.position = null;
    this.preview = null;
    this.drag = null;
    this.root = root.ownerDocument.createElement("div");
    this.root.className = "hodos-rigging-translate-handles";
    this.root.hidden = true;
    this.root.setAttribute("aria-label", "Move active joint");
    this.buttons = new Map();
    for (const axis of Object.keys(RIG_TRANSLATE_AXES)) {
      const control = root.ownerDocument.createElement("button");
      control.type = "button";
      control.className = "hodos-rigging-translate-handle";
      control.dataset.axis = axis;
      control.textContent = axis.toUpperCase();
      control.setAttribute("aria-label", `Move active joint along ${axis.toUpperCase()}`);
      control.addEventListener("pointerdown", (event) => this.start(axis, event));
      this.buttons.set(axis, control);
      this.root.append(control);
    }
    this.root.addEventListener("pointermove", (event) => this.move(event));
    this.root.addEventListener("pointerup", (event) => this.finish(event, false));
    this.root.addEventListener("pointercancel", (event) => this.finish(event, true));
    this.host.append(this.root);
    this.updateBound = () => this.update();
    this.app?.on?.("update", this.updateBound);
  }

  sync(documentValue, editorValue) {
    this.document = documentValue;
    this.editor = editorValue;
    this.activeId = editorValue?.active ?? null;
    this.position = this.activeId
      ? rigRestWorldTransforms(documentValue).find((entry) => entry.id === this.activeId)?.translation ?? null
      : null;
    if (!this.drag) this.preview = null;
    this.update();
  }

  setPreview(jointId, positionValue) {
    if (jointId !== this.activeId) return;
    this.preview = finitePoint(positionValue);
    this.update();
  }

  clearPreview() {
    this.preview = null;
    this.drag = null;
    this.update();
  }

  start(axis, event) {
    if (!this.activeId || !this.position || this.editor?.tool !== "translate" || this.editor?.mode !== "edit") return;
    const projection = projectRigTranslateAxes(this.camera, this.canvas, this.preview ?? this.position, this.worldLength);
    const projectedAxis = projection?.axes?.[axis];
    if (!projectedAxis) return;
    this.drag = {
      pointerId: event.pointerId,
      jointId: this.activeId,
      axis,
      startX: event.clientX,
      startY: event.clientY,
      anchor: [...(this.preview ?? this.position)],
      projectedAxis,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  move(event) {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const amount = rigScreenAxisAmount({
      startX: drag.startX,
      startY: drag.startY,
      clientX: event.clientX,
      clientY: event.clientY,
      ...drag.projectedAxis,
    });
    this.preview = drag.anchor.map((entry, index) => entry + drag.projectedAxis.direction[index] * amount);
    this.onPreview(drag.jointId, [...this.preview], { axis: drag.axis, pointerType: event.pointerType });
    this.update();
    event.preventDefault();
    event.stopPropagation();
  }

  finish(event, cancelled) {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const position = this.preview ? [...this.preview] : [...drag.anchor];
    this.drag = null;
    this.preview = null;
    if (cancelled) this.onCancel(drag.jointId);
    else this.onCommit(drag.jointId, position, { axis: drag.axis, pointerType: event.pointerType });
    this.update();
    event.preventDefault();
    event.stopPropagation();
  }

  update() {
    const visible = Boolean(
      this.activeId
      && (this.preview ?? this.position)
      && this.editor?.mode === "edit"
      && this.editor?.tool === "translate",
    );
    this.root.hidden = !visible;
    if (!visible) return;
    const projection = projectRigTranslateAxes(this.camera, this.canvas, this.preview ?? this.position, this.worldLength);
    if (!projection) {
      this.root.hidden = true;
      return;
    }
    this.root.style.left = `${projection.origin.x}px`;
    this.root.style.top = `${projection.origin.y}px`;
    for (const [axis, control] of this.buttons) {
      const entry = projection.axes[axis];
      control.hidden = !entry;
      if (!entry) continue;
      control.style.left = `${entry.endpoint.x - projection.origin.x}px`;
      control.style.top = `${entry.endpoint.y - projection.origin.y}px`;
    }
  }

  destroy() {
    this.app?.off?.("update", this.updateBound);
    this.root?.remove?.();
    this.buttons.clear();
    this.drag = null;
    this.preview = null;
  }
}
