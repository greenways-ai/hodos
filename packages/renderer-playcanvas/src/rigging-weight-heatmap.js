import { Vec3 } from "playcanvas";

export const RIG_WEIGHT_HEATMAP_PROVIDER_ID = "playcanvas/rigging-weight-heatmap";
export const RIG_WEIGHT_HEATMAP_PROVIDER_VERSION = "0-alpha.1";

function typedArray(value, constructor, label) {
  if (!(value instanceof constructor)) throw new TypeError(`${label} must be ${constructor.name}`);
  return value;
}

function positiveInteger(value, fallback, label) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return candidate;
}

function finiteRange(value, fallback, minimum, maximum, label) {
  const candidate = value ?? fallback;
  if (typeof candidate !== "number" || !Number.isFinite(candidate)
    || candidate < minimum || candidate > maximum) {
    throw new TypeError(`${label} must be finite and between ${minimum} and ${maximum}`);
  }
  return candidate;
}

function validateShape({ positions, jointIndices, weights, vertexCount, maxInfluences, jointIndex }) {
  typedArray(positions, Float32Array, "positions");
  typedArray(jointIndices, Uint16Array, "jointIndices");
  typedArray(weights, Float32Array, "weights");
  if (!Number.isSafeInteger(vertexCount) || vertexCount < 0) {
    throw new TypeError("vertexCount must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(maxInfluences) || maxInfluences < 1 || maxInfluences > 4) {
    throw new TypeError("maxInfluences must be an integer from 1 to 4");
  }
  if (!Number.isSafeInteger(jointIndex) || jointIndex < 0) {
    throw new TypeError("jointIndex must be a non-negative safe integer");
  }
  if (positions.length !== vertexCount * 3) throw new RangeError("positions must contain vertexCount xyz triples");
  if (jointIndices.length !== vertexCount * maxInfluences || weights.length !== jointIndices.length) {
    throw new RangeError("Weight buffers do not match vertexCount × maxInfluences");
  }
}

export function rigJointWeightAtVertex(jointIndices, weights, vertex, maxInfluences, jointIndex) {
  let value = 0;
  const offset = vertex * maxInfluences;
  for (let slot = 0; slot < maxInfluences; slot += 1) {
    const weight = weights[offset + slot];
    if (!Number.isFinite(weight)) throw new TypeError(`weights contains a non-finite value at vertex ${vertex}`);
    if (jointIndices[offset + slot] === jointIndex) value += Math.max(0, weight);
  }
  return Math.max(0, Math.min(1, value));
}

function boundedVertices(selection, vertexCount, maximumPoints) {
  if (selection === null || selection === undefined) {
    const stride = Math.max(1, Math.ceil(vertexCount / maximumPoints));
    const vertices = [];
    for (let vertex = 0; vertex < vertexCount; vertex += stride) vertices.push(vertex);
    if (vertexCount && vertices.at(-1) !== vertexCount - 1 && vertices.length < maximumPoints) vertices.push(vertexCount - 1);
    return vertices;
  }
  if (!(selection instanceof Uint32Array) && !Array.isArray(selection)) {
    throw new TypeError("selection must be Uint32Array or an array");
  }
  const unique = [];
  let previous = -1;
  const sorted = [...selection].sort((left, right) => left - right);
  for (const vertex of sorted) {
    if (!Number.isSafeInteger(vertex) || vertex < 0 || vertex >= vertexCount) {
      throw new RangeError(`selection contains an out-of-range vertex: ${vertex}`);
    }
    if (vertex === previous) continue;
    previous = vertex;
    unique.push(vertex);
  }
  if (unique.length <= maximumPoints) return unique;
  const stride = Math.ceil(unique.length / maximumPoints);
  return unique.filter((_, index) => index % stride === 0).slice(0, maximumPoints);
}

export function createRigWeightHeatmapSample({
  artifactId = null,
  positions,
  jointIndices,
  weights,
  vertexCount,
  maxInfluences,
  jointIndex,
  selection = null,
  maximumPoints = 5_000,
  minimumWeight = 0,
} = {}) {
  validateShape({ positions, jointIndices, weights, vertexCount, maxInfluences, jointIndex });
  const pointLimit = positiveInteger(maximumPoints, 5_000, "maximumPoints");
  const threshold = finiteRange(minimumWeight, 0, 0, 1, "minimumWeight");
  const candidates = boundedVertices(selection, vertexCount, pointLimit);
  const included = [];
  let maximumWeight = 0;
  let totalWeight = 0;
  for (const vertex of candidates) {
    const value = rigJointWeightAtVertex(jointIndices, weights, vertex, maxInfluences, jointIndex);
    if (value < threshold) continue;
    const positionOffset = vertex * 3;
    const point = [positions[positionOffset], positions[positionOffset + 1], positions[positionOffset + 2]];
    if (!point.every(Number.isFinite)) throw new TypeError(`positions contains a non-finite value at vertex ${vertex}`);
    included.push({ vertex, point, value });
    maximumWeight = Math.max(maximumWeight, value);
    totalWeight += value;
  }
  const samplePositions = new Float32Array(included.length * 3);
  const sampleValues = new Float32Array(included.length);
  const sampleVertices = new Uint32Array(included.length);
  included.forEach((entry, index) => {
    samplePositions.set(entry.point, index * 3);
    sampleValues[index] = entry.value;
    sampleVertices[index] = entry.vertex;
  });
  return {
    provider: Object.freeze({ id: RIG_WEIGHT_HEATMAP_PROVIDER_ID, version: RIG_WEIGHT_HEATMAP_PROVIDER_VERSION }),
    artifactId: artifactId ? String(artifactId) : null,
    jointIndex,
    count: included.length,
    positions: samplePositions,
    values: sampleValues,
    vertices: sampleVertices,
    evidence: Object.freeze({
      provider: Object.freeze({ id: RIG_WEIGHT_HEATMAP_PROVIDER_ID, version: RIG_WEIGHT_HEATMAP_PROVIDER_VERSION }),
      artifactId: artifactId ? String(artifactId) : null,
      jointIndex,
      sourceVertices: vertexCount,
      candidateVertices: candidates.length,
      sampledVertices: included.length,
      maximumPoints: pointLimit,
      minimumWeight: threshold,
      maximumWeight,
      meanWeight: included.length ? totalWeight / included.length : 0,
      truncated: candidates.length < vertexCount || included.length >= pointLimit,
    }),
  };
}

export function destroyRigWeightHeatmapSample(sample) {
  if (!sample) return false;
  sample.positions?.fill?.(0);
  sample.values?.fill?.(0);
  sample.vertices?.fill?.(0);
  sample.count = 0;
  return true;
}

export function rigWeightHeatmapColor(value) {
  const weight = Math.max(0, Math.min(1, Number(value) || 0));
  const red = Math.round(35 + weight * 220);
  const green = Math.round(weight < 0.5 ? 105 + weight * 260 : 235 - (weight - 0.5) * 350);
  const blue = Math.round(235 - weight * 205);
  const alpha = 0.24 + weight * 0.7;
  return `rgba(${red}, ${Math.max(30, Math.min(235, green))}, ${blue}, ${alpha.toFixed(3)})`;
}

function resizeCanvas(canvas, hostCanvas) {
  const rect = hostCanvas.getBoundingClientRect();
  const ratio = Math.max(1, Math.min(2, globalThis.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }
  return { rect, ratio, width, height };
}

function project(camera, hostCanvas, point, size) {
  if (!camera?.camera?.worldToScreen) return null;
  const projected = new Vec3();
  camera.camera.worldToScreen(new Vec3(...point), projected);
  if (projected.z <= 0) return null;
  const renderWidth = camera.camera.renderTarget?.width
    ?? camera.camera.system?.app?.graphicsDevice?.width
    ?? hostCanvas.width
    ?? size.rect.width;
  const renderHeight = camera.camera.renderTarget?.height
    ?? camera.camera.system?.app?.graphicsDevice?.height
    ?? hostCanvas.height
    ?? size.rect.height;
  if (!renderWidth || !renderHeight) return null;
  return [
    projected.x / renderWidth * size.width,
    projected.y / renderHeight * size.height,
  ];
}

export class RigWeightHeatmapOverlay {
  constructor({ app, camera, canvas, root } = {}) {
    if (!root?.ownerDocument) throw new TypeError("RigWeightHeatmapOverlay requires an overlay root");
    this.app = app;
    this.camera = camera;
    this.hostCanvas = canvas;
    this.root = root.ownerDocument.createElement("canvas");
    this.root.className = "hodos-rigging-weight-heatmap";
    this.root.hidden = true;
    this.root.setAttribute("aria-hidden", "true");
    this.context = this.root.getContext("2d");
    this.sample = null;
    this.brush = null;
    root.append(this.root);
    this.updateBound = () => this.draw();
    this.app?.on?.("update", this.updateBound);
  }

  setSample(sample) {
    if (sample === this.sample) {
      this.draw();
      return;
    }
    this.clearSample();
    this.sample = sample ?? null;
    this.root.hidden = !this.sample && !this.brush;
    this.draw();
  }

  clearSample() {
    destroyRigWeightHeatmapSample(this.sample);
    this.sample = null;
    if (!this.brush) this.root.hidden = true;
  }

  setBrush(clientX, clientY, radius = 28) {
    const rect = this.hostCanvas.getBoundingClientRect();
    this.brush = {
      x: clientX - rect.left,
      y: clientY - rect.top,
      radius: Math.max(8, Number(radius) || 28),
    };
    this.root.hidden = false;
    this.draw();
  }

  clearBrush() {
    this.brush = null;
    if (!this.sample) this.root.hidden = true;
    this.draw();
  }

  draw() {
    if (!this.context) return;
    const size = resizeCanvas(this.root, this.hostCanvas);
    const context = this.context;
    context.clearRect(0, 0, size.width, size.height);
    if (this.sample) {
      for (let index = 0; index < this.sample.count; index += 1) {
        const offset = index * 3;
        const point = project(this.camera, this.hostCanvas, [
          this.sample.positions[offset],
          this.sample.positions[offset + 1],
          this.sample.positions[offset + 2],
        ], size);
        if (!point) continue;
        const value = this.sample.values[index];
        const radius = (1.4 + value * 3.8) * size.ratio;
        context.beginPath();
        context.arc(point[0], point[1], radius, 0, Math.PI * 2);
        context.fillStyle = rigWeightHeatmapColor(value);
        context.fill();
      }
    }
    if (this.brush) {
      context.beginPath();
      context.arc(this.brush.x * size.ratio, this.brush.y * size.ratio, this.brush.radius * size.ratio, 0, Math.PI * 2);
      context.strokeStyle = "rgba(255, 241, 181, 0.96)";
      context.lineWidth = 2 * size.ratio;
      context.setLineDash([6 * size.ratio, 4 * size.ratio]);
      context.stroke();
      context.setLineDash([]);
    }
  }

  destroy() {
    this.app?.off?.("update", this.updateBound);
    this.clearSample();
    this.brush = null;
    this.root?.remove?.();
    this.context = null;
  }
}
