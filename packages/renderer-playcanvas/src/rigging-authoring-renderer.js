import {
  Asset,
  BoundingBox,
  Entity,
  Vec3,
} from "playcanvas";
import {
  buildRigEditorIntent,
  ensureRigRoot,
  nextRigJointId,
  normalizeRigDocument,
  normalizeRigEditor,
  rigRestWorldTransforms,
} from "@greenways/hodos-world-model/rigging";
import { AdvancedWorldRenderer } from "./advanced-world-renderer.js";
import { RigSkeletonOverlay } from "./rigging-skeleton-overlay.js";
import { RigTranslateHandles } from "./rigging-translate-handles.js";

const EPSILON = 1e-7;

function arrayPoint(value) {
  return [value.x, value.y, value.z];
}

function finitePoint(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    ? [...value]
    : null;
}

export function intersectRayPlane(rayValue, pointValue, normalValue) {
  const origin = finitePoint(rayValue?.origin);
  const direction = finitePoint(rayValue?.direction);
  const point = finitePoint(pointValue);
  const normal = finitePoint(normalValue);
  if (!origin || !direction || !point || !normal) return null;
  const denominator = direction[0] * normal[0] + direction[1] * normal[1] + direction[2] * normal[2];
  if (Math.abs(denominator) <= EPSILON) return null;
  const distance = ((point[0] - origin[0]) * normal[0]
    + (point[1] - origin[1]) * normal[1]
    + (point[2] - origin[2]) * normal[2]) / denominator;
  if (distance < 0) return null;
  return origin.map((entry, axis) => entry + direction[axis] * distance);
}

export function intersectRayBounds(rayValue, boundsValue) {
  const origin = finitePoint(rayValue?.origin);
  const direction = finitePoint(rayValue?.direction);
  const minimum = finitePoint(boundsValue?.min);
  const maximum = finitePoint(boundsValue?.max);
  if (!origin || !direction || !minimum || !maximum) return null;
  let near = -Infinity;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(direction[axis]) <= EPSILON) {
      if (origin[axis] < minimum[axis] || origin[axis] > maximum[axis]) return null;
      continue;
    }
    const left = (minimum[axis] - origin[axis]) / direction[axis];
    const right = (maximum[axis] - origin[axis]) / direction[axis];
    near = Math.max(near, Math.min(left, right));
    far = Math.min(far, Math.max(left, right));
    if (near > far) return null;
  }
  const distance = near >= 0 ? near : far >= 0 ? far : null;
  return distance === null ? null : origin.map((entry, axis) => entry + direction[axis] * distance);
}

export function rigPlacementPoint({
  ray,
  mode = "depth",
  bounds = null,
  anchor = [0, 0, 0],
  cameraForward = [0, 0, -1],
  gridY = 0,
  surfacePoint = null,
} = {}) {
  if (mode === "surface") {
    const supplied = finitePoint(surfacePoint);
    if (supplied) return supplied;
    const bounded = intersectRayBounds(ray, bounds);
    if (bounded) return bounded;
  }
  if (mode === "grid") {
    const grid = intersectRayPlane(ray, [0, Number(gridY) || 0, 0], [0, 1, 0]);
    if (grid) return grid;
  }
  const depth = intersectRayPlane(ray, anchor, cameraForward);
  if (depth) return depth;
  const origin = finitePoint(ray?.origin);
  const direction = finitePoint(ray?.direction);
  if (!origin || !direction) return [...anchor];
  return origin.map((entry, axis) => entry + direction[axis]);
}

export class RiggingAuthoringRenderer extends AdvancedWorldRenderer {
  constructor(canvas, {
    assetHost = null,
    onRigIntent,
    onRigEditor,
    surfacePick = null,
    surfaceOffset = 0,
    ...options
  } = {}) {
    super(canvas, options);
    this.assetHost = assetHost;
    this.onRigIntent = typeof onRigIntent === "function" ? onRigIntent : () => {};
    this.onRigEditor = typeof onRigEditor === "function" ? onRigEditor : () => {};
    this.surfacePick = typeof surfacePick === "function" ? surfacePick : null;
    this.surfaceOffset = Number.isFinite(surfaceOffset) ? surfaceOffset : 0;
    this.rigSurfaceEvidence = null;
    this.rigSurfaceLastRay = null;
    this.rigDocument = ensureRigRoot(normalizeRigDocument({ id: "rig:untitled", assetId: "asset:unassigned" }));
    this.rigEditor = normalizeRigEditor({}, this.rigDocument);
    this.rigOverlay = new RigSkeletonOverlay({ app: this.app, camera: this.camera, canvas: this.canvas });
    this.rigOverlay.sync(this.rigDocument, this.rigEditor);
    this.rigTranslateHandles = this.entityOverlayRoot ? new RigTranslateHandles({
      app: this.app,
      camera: this.camera,
      canvas: this.canvas,
      root: this.entityOverlayRoot,
      onPreview: (jointId, position) => this.previewRigJoint(jointId, position),
      onCommit: (jointId, position) => this.commitRigJointMove(jointId, position),
      onCancel: () => this.clearRigPreview(),
    }) : null;
    this.rigTranslateHandles?.sync(this.rigDocument, this.rigEditor);
    this.rigAssetRoot = new Entity("Hodos local rigging asset");
    this.app.root.addChild(this.rigAssetRoot);
    this.rigAsset = null;
    this.rigAssetEntity = null;
    this.rigAssetUrl = null;
    this.rigAssetHandle = null;
    this.rigAssetBounds = null;
    this.rigDrag = null;
    this.installRiggingPointerControls();
  }

  setAssetHost(host) {
    this.assetHost = host;
  }

  syncRigging(documentValue, editorValue = {}) {
    this.rigDocument = normalizeRigDocument(documentValue);
    this.rigEditor = normalizeRigEditor(editorValue, this.rigDocument);
    this.rigOverlay.sync(this.rigDocument, this.rigEditor);
    this.rigTranslateHandles?.sync(this.rigDocument, this.rigEditor);
  }

  setRigEditor(editorValue = {}) {
    this.rigEditor = normalizeRigEditor(editorValue, this.rigDocument);
    this.rigOverlay.sync(this.rigDocument, this.rigEditor);
    this.rigTranslateHandles?.sync(this.rigDocument, this.rigEditor);
  }

  previewRigJoint(jointId, worldPosition) {
    this.rigOverlay.sync(this.rigDocument, this.rigEditor, {
      preview: { jointId, worldPosition },
    });
    this.rigTranslateHandles?.setPreview(jointId, worldPosition);
  }

  clearRigPreview() {
    this.rigOverlay.sync(this.rigDocument, this.rigEditor);
    this.rigTranslateHandles?.clearPreview();
  }

  commitRigJointMove(jointId, worldPosition) {
    const intent = buildRigEditorIntent(this.rigDocument, this.rigEditor, {
      type: "move",
      jointId,
      worldPosition,
    });
    this.clearRigPreview();
    this.onRigIntent({
      intent,
      editorAfter: { selection: [jointId], active: jointId, focused: jointId },
    });
    return intent;
  }

  async loadRiggingAsset(handleValue) {
    const handle = String(handleValue || "");
    if (!this.assetHost?.has?.(handle)) throw new RangeError(`Unknown local rigging asset handle: ${handle}`);
    if (this.rigAssetHandle === handle && this.rigAssetEntity) return this.rigAssetEntity;
    if (typeof globalThis.Blob !== "function" || !globalThis.URL?.createObjectURL) {
      throw new Error("Local rigging asset rendering requires Blob object URLs");
    }
    this.disposeRiggingAsset();
    const description = this.assetHost.describe(handle);
    const bytes = this.assetHost.readBytes(handle);
    let url = null;
    let asset = null;
    try {
      const blob = new globalThis.Blob([bytes], { type: description.source.mediaType || "model/gltf-binary" });
      bytes.fill(0);
      url = globalThis.URL.createObjectURL(blob);
      asset = new Asset(description.source.fileName || "asset.glb", "container", {
        url,
        filename: description.source.fileName || "asset.glb",
      });
      this.app.assets.add(asset);
      await new Promise((resolve, reject) => {
        asset.once("load", resolve);
        asset.once("error", (error) => reject(error instanceof Error ? error : new Error(String(error))));
        this.app.assets.load(asset);
      });
      const instance = asset.resource?.instantiateRenderEntity?.();
      if (!instance) throw new Error("PlayCanvas did not create a render entity for the local GLB");
      this.rigAssetRoot.addChild(instance);
      this.rigAsset = asset;
      this.rigAssetEntity = instance;
      this.rigAssetUrl = url;
      this.rigAssetHandle = handle;
      this.applyRiggingBounds(description.preflight?.geometry?.bounds ?? null);
      this.rigSurfaceEvidence = typeof this.assetHost?.prepareSurface === "function"
        ? await this.assetHost.prepareSurface(handle)
        : null;
      return instance;
    } catch (error) {
      bytes.fill(0);
      if (asset) {
        this.app.assets.remove(asset);
        asset.unload?.();
      }
      if (url) globalThis.URL.revokeObjectURL(url);
      throw error;
    }
  }

  applyRiggingBounds(boundsValue) {
    const minimum = finitePoint(boundsValue?.min);
    const maximum = finitePoint(boundsValue?.max);
    const center = finitePoint(boundsValue?.center);
    const size = finitePoint(boundsValue?.size);
    if (!minimum || !maximum || !center || !size) {
      this.rigAssetBounds = null;
      return;
    }
    this.rigAssetBounds = { min: minimum, max: maximum, center, size };
    this.bounds = new BoundingBox(new Vec3(...center), new Vec3(size[0] / 2, size[1] / 2, size[2] / 2));
    this.resetCamera();
  }

  disposeRiggingAsset() {
    this.rigAssetEntity?.destroy?.();
    if (this.rigAsset) {
      this.app.assets.remove(this.rigAsset);
      this.rigAsset.unload?.();
    }
    if (this.rigAssetUrl) globalThis.URL.revokeObjectURL(this.rigAssetUrl);
    this.rigAsset = null;
    this.rigAssetEntity = null;
    this.rigAssetUrl = null;
    this.rigAssetHandle = null;
    this.rigAssetBounds = null;
    this.rigSurfaceEvidence = null;
    this.rigSurfaceLastRay = null;
  }

  installRiggingPointerControls() {
    const signal = this.abort.signal;
    const consume = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this.rigEditor.mode !== "edit") return;
      const tool = this.rigEditor.tool;
      const radius = event.pointerType === "touch" ? 36 : event.pointerType === "pen" ? 28 : 22;
      const picked = this.rigOverlay.pick(event.clientX, event.clientY, { radius });
      if (tool === "select") {
        this.onRigEditor({ action: "select", jointId: picked?.id ?? null, mode: event.shiftKey ? "toggle" : "replace" });
        if (picked) consume(event);
        return;
      }
      if (tool === "translate" && picked) {
        const position = this.rigOverlay.position(picked.id);
        this.rigDrag = {
          pointerId: event.pointerId,
          tool,
          jointId: picked.id,
          anchor: position,
          current: position,
        };
        this.canvas.setPointerCapture(event.pointerId);
        this.onRigEditor({ action: "select", jointId: picked.id, mode: "replace" });
        consume(event);
      } else if (tool === "joint-create") {
        const anchor = this.rigEditor.active
          ? this.rigOverlay.position(this.rigEditor.active)
          : this.rigAssetBounds?.center ?? [0, 0, 0];
        const point = this.rigPointAt(event.clientX, event.clientY, anchor);
        this.rigDrag = {
          pointerId: event.pointerId,
          tool,
          jointId: null,
          anchor,
          current: point,
        };
        this.canvas.setPointerCapture(event.pointerId);
        consume(event);
      }
    }, { capture: true, signal });

    this.canvas.addEventListener("pointermove", (event) => {
      const drag = this.rigDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.current = this.rigPointAt(event.clientX, event.clientY, drag.anchor);
      if (drag.tool === "translate") this.previewRigJoint(drag.jointId, drag.current);
      consume(event);
    }, { capture: true, signal });

    const finish = (event, cancelled = false) => {
      const drag = this.rigDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      this.rigDrag = null;
      this.clearRigPreview();
      if (!cancelled) {
        if (drag.tool === "translate") {
          this.commitRigJointMove(drag.jointId, drag.current);
        } else if (drag.tool === "joint-create") {
          const jointId = nextRigJointId(this.rigDocument, "joint");
          const intent = buildRigEditorIntent(this.rigDocument, this.rigEditor, {
            type: "create",
            jointId,
            parentId: this.rigEditor.active,
            worldPosition: drag.current,
          });
          this.onRigIntent({ intent, editorAfter: { selection: [jointId], active: jointId, focused: jointId } });
        }
      }
      consume(event);
    };
    this.canvas.addEventListener("pointerup", (event) => finish(event, false), { capture: true, signal });
    this.canvas.addEventListener("pointercancel", (event) => finish(event, true), { capture: true, signal });
  }

  rigPointAt(clientX, clientY, anchorValue = [0, 0, 0]) {
    const rayValue = this.screenRay(clientX, clientY);
    if (!rayValue) return [...anchorValue];
    const ray = { origin: arrayPoint(rayValue.origin), direction: arrayPoint(rayValue.direction) };
    const cameraForward = arrayPoint(this.orbit.target.clone().sub(this.camera.getPosition()).normalize());
    let surfacePoint = null;
    if (this.rigEditor.snap.mode === "surface") {
      const supplied = this.surfacePick?.({ clientX, clientY, ray, handle: this.rigAssetHandle, renderer: this }) ?? null;
      if (finitePoint(supplied)) surfacePoint = supplied;
      else if (this.rigAssetHandle && typeof this.assetHost?.raycastSurface === "function") {
        this.rigSurfaceLastRay = this.assetHost.raycastSurface(this.rigAssetHandle, ray, {
          backface: "double",
          offset: this.surfaceOffset,
        });
        surfacePoint = finitePoint(this.rigSurfaceLastRay?.hit?.point);
      }
    }
    return rigPlacementPoint({
      ray,
      mode: this.rigEditor.snap.mode,
      bounds: this.rigAssetBounds,
      anchor: anchorValue,
      cameraForward,
      gridY: this.rigAssetBounds?.min?.[1] ?? 0,
      surfacePoint,
    });
  }

  setSurfaceOffset(value) {
    if (!Number.isFinite(value)) throw new TypeError("Surface offset must be finite");
    this.surfaceOffset = value;
  }

  surfaceStatus() {
    return Object.freeze({
      evidence: this.rigSurfaceEvidence,
      lastRay: this.rigSurfaceLastRay,
    });
  }

  focusRigSelection() {
    const active = this.rigEditor.active;
    const position = active
      ? rigRestWorldTransforms(this.rigDocument).find((entry) => entry.id === active)?.translation
      : this.rigAssetBounds?.center;
    if (!position) return;
    this.orbit.target.set(...position);
    const size = this.rigAssetBounds?.size ?? [1, 1, 1];
    this.orbit.distance = Math.max(Math.hypot(...size) * 0.3, 1.2);
    this.updateCamera();
  }

  destroy() {
    this.disposeRiggingAsset();
    this.rigTranslateHandles?.destroy?.();
    this.rigOverlay?.destroy?.();
    this.rigAssetRoot?.destroy?.();
    super.destroy();
  }
}
