import {
  diagnoseRigWeights,
  normalizeRigDocument,
  rigInverseBindMatrices,
} from "@greenways/hodos-world-model/rigging";
import {
  bindGeometryEvidence,
  buildRiggingBindGeometry,
  destroyRiggingBindGeometry,
} from "./rigging-bind-geometry.js";
import {
  RIG_WEIGHT_TASK_PROVIDER_ID,
  RIG_WEIGHT_TASK_PROVIDER_VERSION,
  RiggingWeightTaskRunner,
} from "./rigging-weight-task.js";

export const RIG_WEIGHT_ARTIFACT_PROVIDER_ID = "playcanvas/rigging-weight-artifacts";
export const RIG_WEIGHT_ARTIFACT_PROVIDER_VERSION = "0-alpha.1";

function positiveInteger(value, fallback, label) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) throw new TypeError(`${label} must be a positive safe integer`);
  return candidate;
}

function finitePositive(value, fallback, label) {
  const candidate = value ?? fallback;
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate <= 0) {
    throw new TypeError(`${label} must be positive and finite`);
  }
  return candidate;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function float32Bytes(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) view.setFloat32(index * 4, values[index], true);
  return bytes;
}

function uint16Bytes(values) {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) view.setUint16(index * 2, values[index], true);
  return bytes;
}

function concatenate(parts) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (!Number.isSafeInteger(length)) throw new RangeError("Artifact hash input exceeds the safe byte range");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

async function sha256(parts) {
  if (!globalThis.crypto?.subtle) throw new Error("Content-addressed rig weights require Web Crypto SHA-256");
  const bytes = concatenate(parts);
  try {
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
    return [...digest].map((entry) => entry.toString(16).padStart(2, "0")).join("");
  } finally {
    bytes.fill(0);
  }
}

function metadataBytes(value) {
  return new TextEncoder().encode(stableStringify(value));
}

function artifactError(code, message, details = null) {
  const error = new Error(message);
  error.name = "RigWeightArtifactError";
  error.code = code;
  error.details = details;
  return error;
}

function cloneSummary(value) {
  return Object.freeze({ ...value });
}

function zeroWeightArtifact(artifact) {
  artifact?.jointIndices?.fill?.(0);
  artifact?.weights?.fill?.(0);
  artifact?.componentAssignments?.fill?.(0);
}

function zeroBindArtifact(artifact) {
  artifact?.inverseBindMatrices?.fill?.(0);
}

export class RiggingWeightArtifactStore {
  constructor({
    source,
    document,
    binaryChunk,
    geometry = {},
    taskRunner = null,
    maximumArtifacts = 64,
    maximumBytes = 512 * 1024 * 1024,
  } = {}) {
    if (!source?.contentId) throw new TypeError("Weight artifact store requires a source content identity");
    this.source = Object.freeze({ ...source });
    this.document = document;
    this.binaryChunk = binaryChunk;
    this.geometryOptions = Object.freeze({ ...geometry });
    this.taskRunner = taskRunner ?? new RiggingWeightTaskRunner();
    this.ownsTaskRunner = taskRunner === null;
    this.maximumArtifacts = positiveInteger(maximumArtifacts, 64, "maximumArtifacts");
    this.maximumBytes = positiveInteger(maximumBytes, 512 * 1024 * 1024, "maximumBytes");
    this.geometry = null;
    this.geometryPromise = null;
    this.weights = new Map();
    this.binds = new Map();
    this.lastEvidence = null;
    this.destroyed = false;
  }

  assertActive() {
    if (this.destroyed) throw artifactError("rig/weights-destroyed", "Rig weight artifact store was destroyed");
  }

  async prepareGeometry(options = {}) {
    this.assertActive();
    if (this.geometry && !this.geometry.destroyed) return bindGeometryEvidence(this.geometry);
    if (this.geometryPromise) return this.geometryPromise;
    this.geometryPromise = (async () => {
      const geometry = await buildRiggingBindGeometry({ document: this.document, binaryChunk: this.binaryChunk }, {
        ...this.geometryOptions,
        ...options,
      });
      if (this.destroyed) {
        destroyRiggingBindGeometry(geometry);
        throw artifactError("rig/weights-destroyed", "Rig weight store was destroyed while geometry was building");
      }
      this.geometry = geometry;
      return bindGeometryEvidence(geometry);
    })().finally(() => { this.geometryPromise = null; });
    return this.geometryPromise;
  }

  artifactCount() {
    return this.weights.size + this.binds.size;
  }

  totalBytes() {
    let total = 0;
    for (const artifact of this.weights.values()) total += artifact.byteLength;
    for (const artifact of this.binds.values()) total += artifact.byteLength;
    return total;
  }

  ensureCapacity(additionalArtifacts, additionalBytes) {
    if (this.artifactCount() + additionalArtifacts > this.maximumArtifacts) {
      throw artifactError("rig/weight-artifact-capacity", "Weight artifact store reached its bounded artifact limit", {
        artifacts: this.artifactCount(),
        additionalArtifacts,
        maximumArtifacts: this.maximumArtifacts,
      });
    }
    if (this.totalBytes() + additionalBytes > this.maximumBytes) {
      throw artifactError("rig/weight-byte-capacity", "Weight artifact store reached its bounded byte limit", {
        totalBytes: this.totalBytes(),
        additionalBytes,
        maximumBytes: this.maximumBytes,
      });
    }
  }

  async bind(rigValue, options = {}) {
    this.assertActive();
    const rig = normalizeRigDocument(rigValue);
    if (rig.assetId !== this.source.contentId) {
      throw artifactError("rig/weight-source-mismatch", "Rig asset identity does not match the local GLB source", {
        rigAssetId: rig.assetId,
        sourceId: this.source.contentId,
      });
    }
    await this.prepareGeometry(options.geometry ?? {});
    const geometry = this.geometry;
    const strategy = options.strategy ?? "nearest-segment";
    const maxInfluences = options.maxInfluences ?? rig.skin.maxInfluences;
    const task = {
      strategy,
      document: rig,
      positions: geometry.positions,
      componentIds: geometry.componentIds,
      componentCount: geometry.componentCount,
      maxInfluences,
      falloff: finitePositive(options.falloff, 2, "falloff"),
      epsilon: finitePositive(options.epsilon, 1e-4, "epsilon"),
      maximumVertices: options.maximumVertices ?? geometry.vertexCount,
      maximumComponents: options.maximumComponents ?? Math.max(1, geometry.componentCount),
      maximumDistanceEvaluations: options.maximumDistanceEvaluations ?? Math.max(1, geometry.vertexCount * rig.joints.length),
    };
    const result = await this.taskRunner.run(task);
    if (this.destroyed) {
      zeroWeightArtifact(result);
      throw artifactError("rig/weights-destroyed", "Rig weight store was destroyed while binding was running");
    }
    if (!(result.jointIndices instanceof Uint16Array) || !(result.weights instanceof Float32Array)) {
      throw artifactError("rig/weight-task-result", "Rig weight task returned invalid typed arrays");
    }
    const diagnostics = diagnoseRigWeights({
      jointIndices: result.jointIndices,
      weights: result.weights,
      vertexCount: geometry.vertexCount,
      maxInfluences,
      jointCount: rig.joints.length,
    });
    if (diagnostics.nonFiniteVertices || diagnostics.negativeWeightVertices || diagnostics.outOfRangeJointVertices
      || diagnostics.duplicateJointVertices || diagnostics.nonNormalizedVertices || diagnostics.unweightedVertices) {
      zeroWeightArtifact(result);
      throw artifactError("rig/weight-task-invalid", "Rig weight task produced invalid accepted weights", diagnostics);
    }
    const inverseBindMatrices = rigInverseBindMatrices(rig);
    const bindMetadata = {
      provider: { id: RIG_WEIGHT_ARTIFACT_PROVIDER_ID, version: RIG_WEIGHT_ARTIFACT_PROVIDER_VERSION },
      sourceId: this.source.contentId,
      rigId: rig.id,
      revision: rig.revision,
      jointIds: rig.joints.map((joint) => joint.id),
      matrices: rig.joints.length,
    };
    const bindHex = await sha256([metadataBytes(bindMetadata), float32Bytes(inverseBindMatrices)]);
    const inverseMatricesId = `bind:sha256:${bindHex}`;
    const weightMetadata = {
      provider: { id: RIG_WEIGHT_ARTIFACT_PROVIDER_ID, version: RIG_WEIGHT_ARTIFACT_PROVIDER_VERSION },
      taskProvider: { id: RIG_WEIGHT_TASK_PROVIDER_ID, version: RIG_WEIGHT_TASK_PROVIDER_VERSION },
      sourceId: this.source.contentId,
      rigId: rig.id,
      revision: rig.revision,
      jointIds: rig.joints.map((joint) => joint.id),
      vertexCount: geometry.vertexCount,
      maxInfluences,
      strategy,
      falloff: task.falloff,
      epsilon: task.epsilon,
      inverseMatricesId,
    };
    const weightParts = [
      metadataBytes(weightMetadata),
      uint16Bytes(result.jointIndices),
      float32Bytes(result.weights),
      ...(result.componentAssignments ? [uint16Bytes(result.componentAssignments)] : []),
    ];
    const weightHex = await sha256(weightParts);
    if (this.destroyed) {
      zeroWeightArtifact(result);
      inverseBindMatrices.fill(0);
      throw artifactError("rig/weights-destroyed", "Rig weight store was destroyed while artifact identity was being computed");
    }
    const weightSetId = `weights:sha256:${weightHex}`;
    const weightByteLength = result.jointIndices.byteLength + result.weights.byteLength
      + (result.componentAssignments?.byteLength ?? 0);
    const bindByteLength = inverseBindMatrices.byteLength;
    const newWeight = !this.weights.has(weightSetId);
    const newBind = !this.binds.has(inverseMatricesId);
    try {
      this.ensureCapacity(Number(newWeight) + Number(newBind), (newWeight ? weightByteLength : 0) + (newBind ? bindByteLength : 0));
    } catch (error) {
      zeroWeightArtifact(result);
      inverseBindMatrices.fill(0);
      throw error;
    }
    if (newWeight) {
      this.weights.set(weightSetId, {
        id: weightSetId,
        sourceId: this.source.contentId,
        rigId: rig.id,
        rigRevision: rig.revision,
        strategy,
        vertexCount: geometry.vertexCount,
        maxInfluences,
        jointIds: Object.freeze(rig.joints.map((joint) => joint.id)),
        jointIndices: result.jointIndices,
        weights: result.weights,
        componentAssignments: result.componentAssignments ?? null,
        summary: cloneSummary({ ...result.summary, ...diagnostics }),
        byteLength: weightByteLength,
      });
    } else {
      zeroWeightArtifact(result);
    }
    if (newBind) {
      this.binds.set(inverseMatricesId, {
        id: inverseMatricesId,
        sourceId: this.source.contentId,
        rigId: rig.id,
        rigRevision: rig.revision,
        jointIds: Object.freeze(rig.joints.map((joint) => joint.id)),
        inverseBindMatrices,
        byteLength: bindByteLength,
      });
    } else {
      inverseBindMatrices.fill(0);
    }
    const artifact = this.weights.get(weightSetId);
    this.lastEvidence = Object.freeze({
      provider: Object.freeze({ id: RIG_WEIGHT_ARTIFACT_PROVIDER_ID, version: RIG_WEIGHT_ARTIFACT_PROVIDER_VERSION }),
      status: "ready",
      sourceId: this.source.contentId,
      rigId: rig.id,
      rigRevision: rig.revision,
      strategy,
      weightSetId,
      inverseMatricesId,
      vertexCount: artifact.vertexCount,
      jointCount: artifact.jointIds.length,
      maxInfluences,
      components: geometry.componentCount,
      diagnostics: cloneSummary(artifact.summary),
    });
    return Object.freeze({
      weightSetId,
      inverseMatricesId,
      skin: Object.freeze({
        handleType: "rig/weights",
        weightSetId,
        maxInfluences,
      }),
      bind: Object.freeze({ inverseMatricesId }),
      evidence: this.lastEvidence,
    });
  }

  describeWeight(id) {
    this.assertActive();
    const artifact = this.weights.get(id);
    if (!artifact) throw artifactError("rig/weight-artifact", `Unknown weight artifact: ${id}`);
    return Object.freeze({
      id: artifact.id,
      sourceId: artifact.sourceId,
      rigId: artifact.rigId,
      rigRevision: artifact.rigRevision,
      strategy: artifact.strategy,
      vertexCount: artifact.vertexCount,
      maxInfluences: artifact.maxInfluences,
      jointIds: Object.freeze([...artifact.jointIds]),
      byteLength: artifact.byteLength,
      summary: cloneSummary(artifact.summary),
    });
  }

  describeBind(id) {
    this.assertActive();
    const artifact = this.binds.get(id);
    if (!artifact) throw artifactError("rig/bind-artifact", `Unknown bind artifact: ${id}`);
    return Object.freeze({
      id: artifact.id,
      sourceId: artifact.sourceId,
      rigId: artifact.rigId,
      rigRevision: artifact.rigRevision,
      jointIds: Object.freeze([...artifact.jointIds]),
      matrices: artifact.jointIds.length,
      byteLength: artifact.byteLength,
    });
  }

  readWeight(id) {
    const artifact = this.weights.get(id);
    if (!artifact) throw artifactError("rig/weight-artifact", `Unknown weight artifact: ${id}`);
    return Object.freeze({
      jointIndices: artifact.jointIndices.slice(),
      weights: artifact.weights.slice(),
      componentAssignments: artifact.componentAssignments?.slice?.() ?? null,
    });
  }

  readBind(id) {
    const artifact = this.binds.get(id);
    if (!artifact) throw artifactError("rig/bind-artifact", `Unknown bind artifact: ${id}`);
    return artifact.inverseBindMatrices.slice();
  }

  evidence() {
    return Object.freeze({
      provider: Object.freeze({ id: RIG_WEIGHT_ARTIFACT_PROVIDER_ID, version: RIG_WEIGHT_ARTIFACT_PROVIDER_VERSION }),
      status: this.destroyed ? "destroyed" : this.lastEvidence ? "ready" : "unprepared",
      sourceId: this.source.contentId,
      geometry: bindGeometryEvidence(this.geometry),
      weightArtifacts: this.destroyed ? 0 : this.weights.size,
      bindArtifacts: this.destroyed ? 0 : this.binds.size,
      totalBytes: this.destroyed ? 0 : this.totalBytes(),
      maximumArtifacts: this.maximumArtifacts,
      maximumBytes: this.maximumBytes,
      last: this.destroyed ? null : this.lastEvidence,
    });
  }

  destroy() {
    if (this.destroyed) return;
    destroyRiggingBindGeometry(this.geometry);
    this.geometry = null;
    for (const artifact of this.weights.values()) zeroWeightArtifact(artifact);
    for (const artifact of this.binds.values()) zeroBindArtifact(artifact);
    this.weights.clear();
    this.binds.clear();
    if (this.ownsTaskRunner) this.taskRunner.destroy();
    this.lastEvidence = null;
    this.destroyed = true;
  }
}
