import {
  applyRigWeightEdit,
  diagnoseRigWeightAdjacency,
  diagnoseRigWeights,
  normalizeRigDocument,
} from "@greenways/hodos-world-model/rigging";
import {
  RIG_WEIGHT_SELECTION_PROVIDER_ID,
  RIG_WEIGHT_SELECTION_PROVIDER_VERSION,
  RiggingWeightSelectionStore,
} from "./rigging-weight-selections.js";

export const RIG_WEIGHT_EDIT_PROVIDER_ID = "playcanvas/rigging-weight-editing";
export const RIG_WEIGHT_EDIT_PROVIDER_VERSION = "0-alpha.1";

function positiveInteger(value, fallback, label) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) throw new TypeError(`${label} must be a positive safe integer`);
  return candidate;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object" && !ArrayBuffer.isView(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function metadataBytes(value) {
  return new TextEncoder().encode(JSON.stringify(stableValue(value)));
}

function uint16Bytes(values) {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) view.setUint16(index * 2, values[index], true);
  return bytes;
}

function uint32Bytes(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) view.setUint32(index * 4, values[index], true);
  return bytes;
}

function float32Bytes(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) view.setFloat32(index * 4, values[index], true);
  return bytes;
}

async function sha256(parts) {
  if (!globalThis.crypto?.subtle) throw new Error("Content-addressed rig weight edits require Web Crypto SHA-256");
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (!Number.isSafeInteger(length)) throw new RangeError("Weight edit hash input exceeds the safe byte range");
  const bytes = new Uint8Array(length);
  let offset = 0;
  try {
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
    return [...digest].map((entry) => entry.toString(16).padStart(2, "0")).join("");
  } finally {
    bytes.fill(0);
    for (const part of parts) part.fill?.(0);
  }
}

function editingError(code, message, details = null) {
  const error = new Error(message);
  error.name = "RigWeightEditingError";
  error.code = code;
  error.details = details;
  return error;
}

function zeroPreview(preview) {
  preview?.jointIndices?.fill?.(0);
  preview?.weights?.fill?.(0);
  preview?.selectedVertices?.fill?.(0);
}

function cloneSummary(value) {
  return Object.freeze({ ...value });
}

export class RiggingWeightEditingStore {
  constructor({
    artifactStore,
    id = "rig-weight-edit",
    maximumPreviews = 8,
    maximumPreviewBytes = 256 * 1024 * 1024,
    maximumSelections = 64,
    maximumVerticesPerSelection = 250_000,
    maximumSelectionEntries = 1_000_000,
  } = {}) {
    if (!artifactStore?.prepareGeometry || !(artifactStore.weights instanceof Map)) {
      throw new TypeError("Rig weight editing requires a weight artifact store");
    }
    this.artifactStore = artifactStore;
    this.id = String(id || "rig-weight-edit").slice(0, 128);
    this.maximumPreviews = positiveInteger(maximumPreviews, 8, "maximumPreviews");
    this.maximumPreviewBytes = positiveInteger(maximumPreviewBytes, 256 * 1024 * 1024, "maximumPreviewBytes");
    this.selectionOptions = Object.freeze({
      maximumSelections,
      maximumVerticesPerSelection,
      maximumTotalEntries: maximumSelectionEntries,
    });
    this.selectionStore = null;
    this.previews = new Map();
    this.nextPreview = 1;
    this.lastEvidence = null;
    this.destroyed = false;
  }

  assertActive() {
    if (this.destroyed) throw editingError("rig/weight-edit-destroyed", "Rig weight editing store was destroyed");
  }

  async prepare(options = {}) {
    this.assertActive();
    await this.artifactStore.prepareGeometry(options);
    if (!this.selectionStore) {
      this.selectionStore = new RiggingWeightSelectionStore({
        geometry: this.artifactStore.geometry,
        id: `${this.id}:selection`,
        ...this.selectionOptions,
      });
    }
    return Object.freeze({
      geometry: this.artifactStore.geometry.evidence,
      selections: this.selectionStore.evidence(),
    });
  }

  async selectSphere(options) {
    await this.prepare(options?.geometry ?? {});
    return this.selectionStore.selectSphere(options);
  }

  async selectComponents(options) {
    await this.prepare(options?.geometry ?? {});
    return this.selectionStore.selectComponents(options);
  }

  async selectVertices(vertices) {
    await this.prepare();
    return this.selectionStore.selectVertices(vertices);
  }

  async unionSelections(ids) {
    await this.prepare();
    return this.selectionStore.union(ids);
  }

  describeSelection(id) {
    this.assertActive();
    if (!this.selectionStore) throw editingError("rig/selection-unprepared", "Rig weight selections are not prepared");
    return this.selectionStore.describe(id);
  }

  readSelection(id) {
    this.assertActive();
    if (!this.selectionStore) throw editingError("rig/selection-unprepared", "Rig weight selections are not prepared");
    return this.selectionStore.read(id);
  }

  releaseSelection(id) {
    this.assertActive();
    return this.selectionStore?.release(id) ?? false;
  }

  baseArtifact(id) {
    this.assertActive();
    const artifact = this.artifactStore.weights.get(id);
    if (!artifact) throw editingError("rig/weight-artifact", `Unknown base weight artifact: ${id}`);
    return artifact;
  }

  validateRig(rigValue, artifact) {
    const rig = normalizeRigDocument(rigValue);
    if (rig.assetId !== this.artifactStore.source.contentId || artifact.sourceId !== rig.assetId) {
      throw editingError("rig/weight-source-mismatch", "Rig, base weights, and local GLB source identities must match");
    }
    const joints = rig.joints.map((joint) => joint.id);
    if (joints.length !== artifact.jointIds.length || joints.some((joint, index) => joint !== artifact.jointIds[index])) {
      throw editingError("rig/weight-joint-mismatch", "Rig joint ordering does not match the base weight artifact");
    }
    if (!rig.bind.inverseMatricesId) {
      throw editingError("rig/weight-bind", "Rig must reference an accepted inverse bind artifact before weight editing");
    }
    if (!artifact.inverseMatricesId || artifact.inverseMatricesId !== rig.bind.inverseMatricesId) {
      throw editingError("rig/weight-bind-mismatch", "Base weights and the active rig must reference the same inverse bind artifact");
    }
    if (artifact.maxInfluences !== rig.skin.maxInfluences) {
      throw editingError("rig/weight-influence-mismatch", "Base weights and the active rig use different influence limits");
    }
    if (this.artifactStore.geometry && artifact.vertexCount !== this.artifactStore.geometry.vertexCount) {
      throw editingError("rig/weight-geometry-mismatch", "Base weights do not match the prepared binding geometry vertex count");
    }
    return rig;
  }

  previewBytes() {
    let total = 0;
    for (const preview of this.previews.values()) total += preview.byteLength;
    return total;
  }

  ensurePreviewCapacity(byteLength) {
    if (this.previews.size >= this.maximumPreviews) {
      throw editingError("rig/weight-preview-capacity", "Rig weight editing reached its bounded preview limit");
    }
    if (this.previewBytes() + byteLength > this.maximumPreviewBytes) {
      throw editingError("rig/weight-preview-bytes", "Rig weight editing reached its bounded preview byte limit");
    }
  }

  async artifactId({ rig, base, selection, result }) {
    const metadata = {
      provider: { id: RIG_WEIGHT_EDIT_PROVIDER_ID, version: RIG_WEIGHT_EDIT_PROVIDER_VERSION },
      sourceId: rig.assetId,
      rigId: rig.id,
      revision: rig.revision,
      jointIds: rig.joints.map((joint) => joint.id),
      baseWeightSetId: base.id,
      inverseMatricesId: rig.bind.inverseMatricesId,
      vertexCount: base.vertexCount,
      maxInfluences: base.maxInfluences,
      edit: result.edit,
    };
    const digest = await sha256([
      metadataBytes(metadata),
      uint32Bytes(selection),
      uint16Bytes(result.jointIndices),
      float32Bytes(result.weights),
    ]);
    return `weights:sha256:${digest}`;
  }

  validateResult(result) {
    const diagnostics = result.summary;
    if (diagnostics.nonFiniteVertices || diagnostics.negativeWeightVertices
      || diagnostics.outOfRangeJointVertices || diagnostics.duplicateJointVertices
      || diagnostics.nonNormalizedVertices
      || (diagnostics.unweightedVertices && !diagnostics.intentionallyUnweighted)) {
      throw editingError("rig/weight-edit-invalid", "Rig weight edit produced invalid accepted weights", diagnostics);
    }
  }

  async preview(rigValue, baseId, selectionId, edit, options = {}) {
    await this.prepare(options.geometry ?? {});
    const base = this.baseArtifact(baseId);
    const rig = this.validateRig(rigValue, base);
    const selection = this.selectionStore.read(selectionId);
    let result;
    try {
      result = applyRigWeightEdit({
        document: rig,
        jointIndices: base.jointIndices,
        weights: base.weights,
        selectedVertices: selection,
        adjacencyOffsets: this.artifactStore.geometry.adjacencyOffsets,
        adjacency: this.artifactStore.geometry.adjacency,
        componentIds: this.artifactStore.geometry.componentIds,
        edit,
        maximumSelectedVertices: options.maximumSelectedVertices,
        maximumNeighborVisits: options.maximumNeighborVisits,
        maximumDiagnosticEdges: options.maximumDiagnosticEdges,
        maximumProblemVertices: options.maximumProblemVertices,
      });
      this.validateResult(result);
      const candidateId = await this.artifactId({ rig, base, selection, result });
      if (this.destroyed) throw editingError("rig/weight-edit-destroyed", "Rig weight editing store was destroyed while previewing");
      const byteLength = result.jointIndices.byteLength + result.weights.byteLength + result.selectedVertices.byteLength;
      this.ensurePreviewCapacity(byteLength);
      let problemSelectionId = null;
      if (result.problemVertices.length) {
        problemSelectionId = this.selectionStore.selectVertices(result.problemVertices).id;
      }
      result.problemVertices.fill(0);
      const previewId = `${this.id}:preview:${this.nextPreview++}`;
      this.previews.set(previewId, {
        id: previewId,
        candidateId,
        sourceId: rig.assetId,
        rigId: rig.id,
        rigRevision: rig.revision,
        baseWeightSetId: base.id,
        inverseMatricesId: rig.bind.inverseMatricesId,
        strategy: `edit:${result.operation}`,
        edit: result.edit,
        selectionId,
        problemSelectionId,
        vertexCount: base.vertexCount,
        maxInfluences: base.maxInfluences,
        jointIds: Object.freeze([...base.jointIds]),
        jointIndices: result.jointIndices,
        weights: result.weights,
        selectedVertices: result.selectedVertices,
        summary: cloneSummary(result.summary),
        byteLength,
      });
      selection.fill(0);
      return this.describePreview(previewId);
    } catch (error) {
      selection.fill(0);
      result?.jointIndices?.fill?.(0);
      result?.weights?.fill?.(0);
      result?.selectedVertices?.fill?.(0);
      result?.problemVertices?.fill?.(0);
      throw error;
    }
  }

  previewRecord(id) {
    this.assertActive();
    const preview = this.previews.get(id);
    if (!preview) throw editingError("rig/weight-preview", `Unknown rig weight preview: ${id}`);
    return preview;
  }

  describePreview(id) {
    const preview = this.previewRecord(id);
    return Object.freeze({
      id: preview.id,
      candidateId: preview.candidateId,
      sourceId: preview.sourceId,
      rigId: preview.rigId,
      rigRevision: preview.rigRevision,
      baseWeightSetId: preview.baseWeightSetId,
      inverseMatricesId: preview.inverseMatricesId,
      strategy: preview.strategy,
      edit: preview.edit,
      selectionId: preview.selectionId,
      problemSelectionId: preview.problemSelectionId,
      affectedVertices: preview.selectedVertices.length,
      vertexCount: preview.vertexCount,
      maxInfluences: preview.maxInfluences,
      byteLength: preview.byteLength,
      diagnostics: preview.summary,
    });
  }

  readPreview(id) {
    const preview = this.previewRecord(id);
    return Object.freeze({
      jointIndices: preview.jointIndices.slice(),
      weights: preview.weights.slice(),
    });
  }

  discardPreview(id, { releaseProblemSelection = true } = {}) {
    this.assertActive();
    const preview = this.previews.get(id);
    if (!preview) return false;
    zeroPreview(preview);
    this.previews.delete(id);
    if (releaseProblemSelection && preview.problemSelectionId) this.selectionStore?.release(preview.problemSelectionId);
    return true;
  }

  commitPreview(id) {
    const preview = this.previewRecord(id);
    const existing = this.artifactStore.weights.get(preview.candidateId);
    if (!existing) {
      try {
        this.artifactStore.ensureCapacity(1, preview.jointIndices.byteLength + preview.weights.byteLength);
      } catch (error) {
        this.discardPreview(id);
        throw error;
      }
      this.artifactStore.weights.set(preview.candidateId, {
        id: preview.candidateId,
        sourceId: preview.sourceId,
        rigId: preview.rigId,
        rigRevision: preview.rigRevision,
        strategy: preview.strategy,
        baseWeightSetId: preview.baseWeightSetId,
        inverseMatricesId: preview.inverseMatricesId,
        edit: preview.edit,
        vertexCount: preview.vertexCount,
        maxInfluences: preview.maxInfluences,
        jointIds: preview.jointIds,
        jointIndices: preview.jointIndices,
        weights: preview.weights,
        componentAssignments: null,
        summary: preview.summary,
        byteLength: preview.jointIndices.byteLength + preview.weights.byteLength,
      });
    } else {
      zeroPreview(preview);
    }
    this.previews.delete(id);
    const artifact = this.artifactStore.weights.get(preview.candidateId);
    this.lastEvidence = Object.freeze({
      provider: Object.freeze({ id: RIG_WEIGHT_EDIT_PROVIDER_ID, version: RIG_WEIGHT_EDIT_PROVIDER_VERSION }),
      status: artifact.summary.unweightedVertices || artifact.summary.abruptGradientEdges ? "warn" : "ready",
      sourceId: artifact.sourceId,
      rigId: artifact.rigId,
      rigRevision: artifact.rigRevision,
      baseWeightSetId: preview.baseWeightSetId,
      weightSetId: artifact.id,
      inverseMatricesId: preview.inverseMatricesId,
      strategy: artifact.strategy,
      selectionId: preview.selectionId,
      problemSelectionId: preview.problemSelectionId,
      affectedVertices: preview.selectedVertices.length,
      diagnostics: cloneSummary(artifact.summary),
    });
    preview.selectedVertices.fill(0);
    return Object.freeze({
      weightSetId: artifact.id,
      inverseMatricesId: preview.inverseMatricesId,
      skin: Object.freeze({
        handleType: "rig/weights",
        weightSetId: artifact.id,
        maxInfluences: artifact.maxInfluences,
      }),
      bind: Object.freeze({ inverseMatricesId: preview.inverseMatricesId }),
      evidence: this.lastEvidence,
    });
  }

  async edit(rig, baseId, selectionId, edit, options = {}) {
    const preview = await this.preview(rig, baseId, selectionId, edit, options);
    try {
      return this.commitPreview(preview.id);
    } catch (error) {
      this.discardPreview(preview.id);
      throw error;
    }
  }

  async diagnose(rigValue, weightSetId, options = {}) {
    await this.prepare(options.geometry ?? {});
    const artifact = this.baseArtifact(weightSetId);
    const rig = this.validateRig(rigValue, artifact);
    const standard = diagnoseRigWeights({
      jointIndices: artifact.jointIndices,
      weights: artifact.weights,
      vertexCount: artifact.vertexCount,
      maxInfluences: artifact.maxInfluences,
      jointCount: rig.joints.length,
    });
    const adjacency = diagnoseRigWeightAdjacency({
      jointIndices: artifact.jointIndices,
      weights: artifact.weights,
      vertexCount: artifact.vertexCount,
      maxInfluences: artifact.maxInfluences,
      adjacencyOffsets: this.artifactStore.geometry.adjacencyOffsets,
      adjacency: this.artifactStore.geometry.adjacency,
      threshold: options.threshold,
      maximumEdges: options.maximumEdges,
      maximumRepresentatives: options.maximumRepresentatives,
    });
    let problemSelectionId = null;
    try {
      if (adjacency.representativeVertices.length) {
        problemSelectionId = this.selectionStore.selectVertices(adjacency.representativeVertices).id;
      }
    } finally {
      adjacency.representativeVertices.fill(0);
    }
    return Object.freeze({
      provider: Object.freeze({ id: RIG_WEIGHT_EDIT_PROVIDER_ID, version: RIG_WEIGHT_EDIT_PROVIDER_VERSION }),
      status: standard.unweightedVertices || adjacency.summary.abruptGradientEdges ? "warn" : "ready",
      sourceId: artifact.sourceId,
      rigId: artifact.rigId,
      weightSetId: artifact.id,
      problemSelectionId,
      diagnostics: Object.freeze({ ...standard, ...adjacency.summary }),
    });
  }

  evidence() {
    return Object.freeze({
      provider: Object.freeze({ id: RIG_WEIGHT_EDIT_PROVIDER_ID, version: RIG_WEIGHT_EDIT_PROVIDER_VERSION }),
      selectionProvider: Object.freeze({ id: RIG_WEIGHT_SELECTION_PROVIDER_ID, version: RIG_WEIGHT_SELECTION_PROVIDER_VERSION }),
      status: this.destroyed ? "destroyed" : this.lastEvidence ? "ready" : "unprepared",
      selections: this.destroyed ? null : this.selectionStore?.evidence?.() ?? null,
      previews: this.destroyed ? 0 : this.previews.size,
      previewBytes: this.destroyed ? 0 : this.previewBytes(),
      maximumPreviews: this.maximumPreviews,
      maximumPreviewBytes: this.maximumPreviewBytes,
      last: this.destroyed ? null : this.lastEvidence,
    });
  }

  destroy() {
    if (this.destroyed) return;
    for (const preview of this.previews.values()) zeroPreview(preview);
    this.previews.clear();
    this.selectionStore?.destroy?.();
    this.selectionStore = null;
    this.artifactStore = null;
    this.lastEvidence = null;
    this.destroyed = true;
  }
}
