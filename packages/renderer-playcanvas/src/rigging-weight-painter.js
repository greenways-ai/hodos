import {
  normalizeRigDocument,
  normalizeRigWeightEdit,
} from "@greenways/hodos-world-model/rigging";

export const RIG_WEIGHT_PAINT_PROVIDER_ID = "playcanvas/rigging-weight-painter";
export const RIG_WEIGHT_PAINT_PROVIDER_VERSION = "0-alpha.1";
export const RIG_WEIGHT_PAINT_OPERATIONS = Object.freeze([
  "add",
  "subtract",
  "replace",
  "rigid",
  "smooth",
  "flood",
  "prune",
  "normalize",
]);

function finiteRange(value, fallback, minimum, maximum, label) {
  const candidate = value ?? fallback;
  if (typeof candidate !== "number" || !Number.isFinite(candidate)
    || candidate < minimum || candidate > maximum) {
    throw new TypeError(`${label} must be finite and between ${minimum} and ${maximum}`);
  }
  return candidate;
}

function positiveInteger(value, fallback, label) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return candidate;
}

function point(value, label = "point") {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new TypeError(`${label} must contain three finite numbers`);
  }
  return [...value];
}

export function normalizeRigWeightPaintSettings(value = {}) {
  const operation = String(value.operation ?? "add");
  if (!RIG_WEIGHT_PAINT_OPERATIONS.includes(operation)) {
    throw new TypeError(`Unsupported rig weight paint operation: ${operation}`);
  }
  return Object.freeze({
    operation,
    radius: finiteRange(value.radius, 0.25, 0.0001, 100_000, "radius"),
    radiusPixels: finiteRange(value.radiusPixels, 32, 8, 256, "radiusPixels"),
    strength: finiteRange(value.strength, operation === "smooth" ? 0.5 : 0.1, 0, 1, "strength"),
    threshold: finiteRange(value.threshold, 0.01, 0, 1, "threshold"),
    iterations: positiveInteger(value.iterations, 1, "iterations"),
    minimumWeight: finiteRange(value.minimumWeight, 1e-8, 0, 1, "minimumWeight"),
    abruptGradientThreshold: finiteRange(value.abruptGradientThreshold, 0.5, 0, 1, "abruptGradientThreshold"),
    maximumSelectedVertices: positiveInteger(value.maximumSelectedVertices, 250_000, "maximumSelectedVertices"),
    maximumNeighborVisits: positiveInteger(value.maximumNeighborVisits, 6_000_000, "maximumNeighborVisits"),
    maximumDiagnosticEdges: positiveInteger(value.maximumDiagnosticEdges, 3_000_000, "maximumDiagnosticEdges"),
    maximumProblemVertices: positiveInteger(value.maximumProblemVertices, 32, "maximumProblemVertices"),
  });
}

export function rigWeightPaintEdit(documentValue, jointIdValue, settingsValue = {}) {
  const document = normalizeRigDocument(documentValue);
  const settings = normalizeRigWeightPaintSettings(settingsValue);
  const jointId = jointIdValue === null || jointIdValue === undefined ? null : String(jointIdValue);
  const jointIndex = jointId === null ? -1 : document.joints.findIndex((joint) => joint.id === jointId);
  if (["add", "subtract", "replace", "rigid", "flood"].includes(settings.operation) && jointIndex < 0) {
    throw new RangeError(`${settings.operation} painting requires an active joint`);
  }
  return normalizeRigWeightEdit({
    operation: settings.operation,
    jointIndex: jointIndex < 0 ? null : jointIndex,
    strength: settings.strength,
    threshold: settings.threshold,
    iterations: settings.iterations,
    minimumWeight: settings.minimumWeight,
    abruptGradientThreshold: settings.abruptGradientThreshold,
  });
}

function errorEvent(error, phase) {
  return Object.freeze({
    type: "error",
    phase,
    error: Object.freeze({
      name: error?.name ?? "Error",
      code: error?.code ?? null,
      message: String(error?.message ?? error).slice(0, 1024),
    }),
  });
}

export class RiggingWeightStrokeController {
  constructor({
    assetHost,
    onPreview = null,
    onCommit = null,
    onCancel = null,
    onError = null,
  } = {}) {
    if (!assetHost) throw new TypeError("RiggingWeightStrokeController requires an asset host");
    this.assetHost = assetHost;
    this.onPreview = typeof onPreview === "function" ? onPreview : () => {};
    this.onCommit = typeof onCommit === "function" ? onCommit : () => {};
    this.onCancel = typeof onCancel === "function" ? onCancel : () => {};
    this.onError = typeof onError === "function" ? onError : () => {};
    this.configuration = null;
    this.stroke = null;
    this.nextToken = 1;
    this.destroyed = false;
  }

  configure({
    handle,
    document,
    baseWeightSetId,
    jointId = null,
    settings = {},
  } = {}) {
    if (this.destroyed) throw new Error("Rigging weight stroke controller was destroyed");
    const rig = normalizeRigDocument(document);
    const artifact = String(baseWeightSetId || "");
    if (!handle) throw new TypeError("Weight painting requires an opaque asset handle");
    if (!artifact) throw new TypeError("Weight painting requires a base weight artifact");
    this.configuration = Object.freeze({
      handle: String(handle),
      document: rig,
      baseWeightSetId: artifact,
      jointId: jointId === null ? null : String(jointId),
      settings: normalizeRigWeightPaintSettings(settings),
      edit: rigWeightPaintEdit(rig, jointId, settings),
    });
    return this.configuration;
  }

  isActive() {
    return Boolean(this.stroke && !this.stroke.cancelled && !this.stroke.finished);
  }

  async begin(worldPoint) {
    if (!this.configuration) throw new Error("Configure weight painting before beginning a stroke");
    if (this.stroke) await this.cancel({ notify: false });
    const stroke = {
      token: this.nextToken++,
      configuration: this.configuration,
      selectionId: null,
      previewId: null,
      latestPoint: point(worldPoint),
      draining: null,
      cancelled: false,
      finished: false,
      points: 0,
    };
    this.stroke = stroke;
    await this.drain(stroke);
    return this.describe(stroke);
  }

  move(worldPoint) {
    const stroke = this.stroke;
    if (!stroke || stroke.cancelled || stroke.finished) return Promise.resolve(null);
    stroke.latestPoint = point(worldPoint);
    return this.drain(stroke).then(() => this.describe(stroke));
  }

  drain(stroke) {
    if (stroke.draining) return stroke.draining;
    stroke.draining = (async () => {
      try {
        while (stroke.latestPoint && !stroke.cancelled && this.stroke === stroke) {
          const next = stroke.latestPoint;
          stroke.latestPoint = null;
          await this.applyPoint(stroke, next);
        }
      } catch (error) {
        if (!this.destroyed) this.onError(errorEvent(error, "preview"));
        stroke.cancelled = true;
        stroke.latestPoint = null;
        if (stroke.previewId) {
          this.safeDiscardPreview(stroke.configuration.handle, stroke.previewId);
          stroke.previewId = null;
        }
        this.releaseSelection(stroke);
        if (this.stroke === stroke) this.stroke = null;
        throw error;
      } finally {
        stroke.draining = null;
      }
    })();
    return stroke.draining;
  }

  async applyPoint(stroke, center) {
    const { handle, document, baseWeightSetId, settings, edit } = stroke.configuration;
    const sphere = await this.assetHost.selectWeightSphere(handle, {
      center,
      radius: settings.radius,
      maximumVertices: settings.maximumSelectedVertices,
    });
    let nextSelection = sphere.id;
    if (stroke.selectionId) {
      try {
        const combined = await this.assetHost.unionWeightSelections(handle, [stroke.selectionId, sphere.id]);
        nextSelection = combined.id;
      } finally {
        this.safeReleaseSelection(handle, stroke.selectionId);
        this.safeReleaseSelection(handle, sphere.id);
      }
    }
    if (stroke.cancelled || this.stroke !== stroke) {
      this.safeReleaseSelection(handle, nextSelection);
      return;
    }
    if (stroke.previewId) this.safeDiscardPreview(handle, stroke.previewId);
    stroke.selectionId = nextSelection;
    const preview = await this.assetHost.previewWeightEdit(
      handle,
      document,
      baseWeightSetId,
      stroke.selectionId,
      edit,
      {
        maximumSelectedVertices: settings.maximumSelectedVertices,
        maximumNeighborVisits: settings.maximumNeighborVisits,
        maximumDiagnosticEdges: settings.maximumDiagnosticEdges,
        maximumProblemVertices: settings.maximumProblemVertices,
      },
    );
    if (stroke.cancelled || this.stroke !== stroke) {
      this.safeDiscardPreview(handle, preview.id);
      return;
    }
    stroke.previewId = preview.id;
    stroke.points += 1;
    this.onPreview(Object.freeze({
      type: "preview",
      stroke: this.describe(stroke),
      preview,
    }));
  }

  async finish() {
    const stroke = this.stroke;
    if (!stroke || stroke.cancelled || stroke.finished) return null;
    if (stroke.draining) await stroke.draining;
    if (stroke.latestPoint) await this.drain(stroke);
    if (stroke.cancelled || this.stroke !== stroke || !stroke.previewId) {
      await this.cancelStroke(stroke);
      return null;
    }
    try {
      const result = this.assetHost.commitWeightPreview(stroke.configuration.handle, stroke.previewId);
      stroke.previewId = null;
      stroke.finished = true;
      this.releaseSelection(stroke);
      if (this.stroke === stroke) this.stroke = null;
      this.onCommit(Object.freeze({
        type: "commit",
        points: stroke.points,
        result,
      }));
      return result;
    } catch (error) {
      if (!this.destroyed) this.onError(errorEvent(error, "commit"));
      await this.cancelStroke(stroke, { notify: false });
      throw error;
    }
  }

  safeReleaseSelection(handle, id) {
    if (!id) return false;
    try { return Boolean(this.assetHost.releaseWeightSelection(handle, id)); }
    catch { return false; }
  }

  safeDiscardPreview(handle, id) {
    if (!id) return false;
    try { return Boolean(this.assetHost.discardWeightPreview(handle, id)); }
    catch { return false; }
  }

  releaseSelection(stroke) {
    if (!stroke.selectionId) return;
    this.safeReleaseSelection(stroke.configuration.handle, stroke.selectionId);
    stroke.selectionId = null;
  }

  async cancel({ notify = true } = {}) {
    const stroke = this.stroke;
    if (!stroke) return false;
    return this.cancelStroke(stroke, { notify });
  }

  async cancelStroke(stroke, { notify = true } = {}) {
    if (stroke.cancelled && this.stroke !== stroke) return false;
    stroke.cancelled = true;
    stroke.latestPoint = null;
    if (stroke.draining) {
      try { await stroke.draining; } catch { /* error already surfaced */ }
    }
    if (stroke.previewId) {
      this.safeDiscardPreview(stroke.configuration.handle, stroke.previewId);
      stroke.previewId = null;
    }
    this.releaseSelection(stroke);
    if (this.stroke === stroke) this.stroke = null;
    if (notify) this.onCancel(Object.freeze({ type: "cancel", points: stroke.points }));
    return true;
  }

  describe(stroke = this.stroke) {
    if (!stroke) return null;
    return Object.freeze({
      provider: Object.freeze({ id: RIG_WEIGHT_PAINT_PROVIDER_ID, version: RIG_WEIGHT_PAINT_PROVIDER_VERSION }),
      token: stroke.token,
      points: stroke.points,
      selectionId: stroke.selectionId,
      previewId: stroke.previewId,
      operation: stroke.configuration.settings.operation,
      radius: stroke.configuration.settings.radius,
      baseWeightSetId: stroke.configuration.baseWeightSetId,
      jointId: stroke.configuration.jointId,
    });
  }

  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    try { await this.cancel({ notify: false }); } catch { /* host disposal is allowed to win */ }
    this.configuration = null;
  }
}
