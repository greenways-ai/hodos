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
import { RigWeightHeatmapOverlay } from "./rigging-weight-heatmap.js";
import {
  RiggingWeightStrokeController,
  normalizeRigWeightPaintSettings,
} from "./rigging-weight-painter.js";

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
    onRigWeights,
    surfacePick = null,
    surfaceOffset = 0,
    ...options
  } = {}) {
    super(canvas, options);
    this.assetHost = assetHost;
    this.onRigIntent = typeof onRigIntent === "function" ? onRigIntent : () => {};
    this.onRigEditor = typeof onRigEditor === "function" ? onRigEditor : () => {};
    this.onRigWeights = typeof onRigWeights === "function" ? onRigWeights : () => {};
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
    this.rigActivity = "skeleton";
    this.rigWeightSettings = normalizeRigWeightPaintSettings();
    this.rigWeightPointer = null;
    this.rigWeightStroke = null;
    this.rigWeightHeatmap = this.entityOverlayRoot ? new RigWeightHeatmapOverlay({
      app: this.app,
      camera: this.camera,
      canvas: this.canvas,
      root: this.entityOverlayRoot,
    }) : null;
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
    if (this.rigActivity === "weights") this.refreshRigWeightHeatmap().catch((error) => this.emitRigWeightError(error, "heatmap"));
  }

  setRigEditor(editorValue = {}) {
    this.rigEditor = normalizeRigEditor(editorValue, this.rigDocument);
    this.rigOverlay.sync(this.rigDocument, this.rigEditor);
    this.rigTranslateHandles?.sync(this.rigDocument, this.rigEditor);
    if (this.rigActivity === "weights") this.refreshRigWeightHeatmap().catch((error) => this.emitRigWeightError(error, "heatmap"));
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

  emitRigWeightError(error, phase = "weights") {
    const event = Object.freeze({
      type: "error",
      phase,
      error: Object.freeze({
        name: error?.name ?? "Error",
        code: error?.code ?? null,
        message: String(error?.message ?? error).slice(0, 1024),
      }),
    });
    this.onRigWeights(event);
    return event;
  }

  setRigActivity(value) {
    const activity = value === "weights" ? "weights" : "skeleton";
    if (activity === this.rigActivity) return activity;
    this.rigActivity = activity;
    if (activity !== "weights") {
      this.cancelRigWeightStroke().catch(() => {});
      this.rigWeightHeatmap?.clearSample?.();
      this.rigWeightHeatmap?.clearBrush?.();
    } else {
      this.refreshRigWeightHeatmap().catch((error) => this.emitRigWeightError(error, "heatmap"));
    }
    this.onRigWeights(Object.freeze({ type: "activity", activity }));
    return activity;
  }

  setRigWeightSettings(value = {}) {
    this.rigWeightSettings = normalizeRigWeightPaintSettings({ ...this.rigWeightSettings, ...value });
    this.onRigWeights(Object.freeze({ type: "settings", settings: this.rigWeightSettings }));
    return this.rigWeightSettings;
  }

  activeRigWeightJointIndex() {
    return this.rigEditor.active
      ? this.rigDocument.joints.findIndex((joint) => joint.id === this.rigEditor.active)
      : -1;
  }

  async refreshRigWeightHeatmap({ previewId = null, selection = null } = {}) {
    if (this.rigActivity !== "weights" || !this.rigAssetHandle || !this.rigWeightHeatmap) return null;
    const jointIndex = this.activeRigWeightJointIndex();
    const weightSetId = this.rigDocument.skin?.weightSetId;
    if (jointIndex < 0 || (!previewId && !weightSetId)) {
      this.rigWeightHeatmap.clearSample();
      return null;
    }
    const sample = previewId
      ? this.assetHost.weightPreviewHeatmap(this.rigAssetHandle, previewId, jointIndex, { selection })
      : this.assetHost.weightHeatmap(this.rigAssetHandle, weightSetId, jointIndex, { selection });
    this.rigWeightHeatmap.setSample(sample);
    this.onRigWeights(Object.freeze({
      type: "heatmap",
      artifactId: sample.artifactId,
      jointId: this.rigEditor.active,
      evidence: sample.evidence,
    }));
    return sample.evidence;
  }

  attachRigWeightResult(result, source = "binding") {
    if (!result?.skin?.weightSetId || !result?.bind?.inverseMatricesId) {
      throw new TypeError("Rig weight result must contain skin and bind artifact identities");
    }
    this.onRigIntent({
      intent: {
        type: "rig/skin-attach",
        skin: result.skin,
        bind: result.bind,
        expectedRevision: this.rigDocument.revision,
      },
      editorAfter: null,
    });
    this.onRigWeights(Object.freeze({ type: source, status: "committed", result }));
    return result;
  }

  async bindRigWeights(strategy = "nearest-segment", options = {}) {
    if (!this.rigAssetHandle) throw new Error("Open a local GLB before binding weights");
    if (!this.rigDocument.joints.length) throw new Error("Create at least one joint before binding weights");
    this.onRigWeights(Object.freeze({ type: "binding", status: "running", strategy }));
    try {
      const result = await this.assetHost.bindRig(this.rigAssetHandle, this.rigDocument, { strategy, ...options });
      this.attachRigWeightResult(result, "binding");
      return result;
    } catch (error) {
      this.emitRigWeightError(error, "binding");
      throw error;
    }
  }

  async diagnoseRigWeights(options = {}) {
    const weightSetId = this.rigDocument.skin?.weightSetId;
    if (!this.rigAssetHandle || !weightSetId) throw new Error("Bind the rig before running weight diagnostics");
    try {
      const evidence = await this.assetHost.diagnoseWeights(
        this.rigAssetHandle,
        this.rigDocument,
        weightSetId,
        options,
      );
      this.onRigWeights(Object.freeze({ type: "diagnostics", status: evidence.status, evidence }));
      return evidence;
    } catch (error) {
      this.emitRigWeightError(error, "diagnostics");
      throw error;
    }
  }

  ensureRigWeightStroke() {
    if (this.rigWeightStroke) return this.rigWeightStroke;
    if (!this.assetHost) throw new Error("Weight painting requires a local asset host");
    this.rigWeightStroke = new RiggingWeightStrokeController({
      assetHost: this.assetHost,
      onPreview: (event) => {
        this.refreshRigWeightHeatmap({ previewId: event.preview.id }).catch((error) => this.emitRigWeightError(error, "heatmap"));
        this.onRigWeights(event);
      },
      onCommit: (event) => this.attachRigWeightResult(event.result, "paint"),
      onCancel: (event) => {
        this.refreshRigWeightHeatmap().catch(() => {});
        this.onRigWeights(event);
      },
      onError: (event) => this.onRigWeights(event),
    });
    return this.rigWeightStroke;
  }

  rigWeightSurfacePoint(clientX, clientY) {
    if (!this.rigAssetHandle || typeof this.assetHost?.raycastSurface !== "function") return null;
    const rayValue = this.screenRay(clientX, clientY);
    if (!rayValue) return null;
    const result = this.assetHost.raycastSurface(this.rigAssetHandle, {
      origin: arrayPoint(rayValue.origin),
      direction: arrayPoint(rayValue.direction),
    }, { backface: "double" });
    return finitePoint(result?.hit?.point);
  }

  async startRigWeightStroke(event) {
    const weightSetId = this.rigDocument.skin?.weightSetId;
    if (!weightSetId) throw new Error("Bind the rig before painting weights");
    const point = this.rigWeightSurfacePoint(event.clientX, event.clientY);
    if (!point) throw new Error("The pointer did not hit locally readable triangle geometry");
    const controller = this.ensureRigWeightStroke();
    controller.configure({
      handle: this.rigAssetHandle,
      document: this.rigDocument,
      baseWeightSetId: weightSetId,
      jointId: this.rigEditor.active,
      settings: this.rigWeightSettings,
    });
    return controller.begin(point);
  }

  moveRigWeightStroke(event) {
    const point = this.rigWeightSurfacePoint(event.clientX, event.clientY);
    if (!point || !this.rigWeightStroke?.isActive()) return Promise.resolve(null);
    return this.rigWeightStroke.move(point);
  }

  finishRigWeightStroke() {
    return this.rigWeightStroke?.finish?.() ?? Promise.resolve(null);
  }

  cancelRigWeightStroke() {
    return this.rigWeightStroke?.cancel?.() ?? Promise.resolve(false);
  }

  async loadRiggingAsset(handleValue) {
    const handle = String(handleValue || "");
    if (!this.assetHost?.has?.(handle)) throw new RangeError(`Unknown local rigging asset handle: ${handle}`);
    if (this.rigAssetHandle === handle && this.rigAssetEntity) return this.rigAssetEntity;
    if (typeof globalThis.Blob !== "function" || !globalThis.URL?.createObjectURL) {
      throw new Error("Local rigging asset rendering requires Blob object URLs");
    }
    await this.cancelRigWeightStroke();
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
      if (this.rigActivity === "weights") await this.refreshRigWeightHeatmap();
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
    this.cancelRigWeightStroke().catch(() => {});
    this.rigWeightHeatmap?.clearSample?.();
    this.rigWeightHeatmap?.clearBrush?.();
    this.rigWeightPointer = null;
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
      if (this.rigActivity === "weights") {
        this.rigWeightPointer = event.pointerId;
        this.canvas.setPointerCapture(event.pointerId);
        this.rigWeightHeatmap?.setBrush(event.clientX, event.clientY, this.rigWeightSettings.radiusPixels);
        this.startRigWeightStroke(event).catch((error) => this.emitRigWeightError(error, "paint"));
        consume(event);
        return;
      }
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
      if (this.rigActivity === "weights") {
        this.rigWeightHeatmap?.setBrush(event.clientX, event.clientY, this.rigWeightSettings.radiusPixels);
        if (this.rigWeightPointer === event.pointerId) {
          this.moveRigWeightStroke(event).catch((error) => this.emitRigWeightError(error, "paint"));
          consume(event);
        }
        return;
      }
      const drag = this.rigDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.current = this.rigPointAt(event.clientX, event.clientY, drag.anchor);
      if (drag.tool === "translate") this.previewRigJoint(drag.jointId, drag.current);
      consume(event);
    }, { capture: true, signal });

    const finish = (event, cancelled = false) => {
      if (this.rigActivity === "weights" && this.rigWeightPointer === event.pointerId) {
        this.rigWeightPointer = null;
        this.rigWeightHeatmap?.clearBrush();
        const operation = cancelled ? this.cancelRigWeightStroke() : this.finishRigWeightStroke();
        operation.catch((error) => this.emitRigWeightError(error, cancelled ? "cancel" : "paint"));
        consume(event);
        return;
      }
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
    this.rigWeightStroke?.destroy?.().catch?.(() => {});
    this.rigWeightStroke = null;
    this.rigWeightHeatmap?.destroy?.();
    this.rigTranslateHandles?.destroy?.();
    this.rigOverlay?.destroy?.();
    this.rigAssetRoot?.destroy?.();
    super.destroy();
  }
}
