export const RIG_WEIGHT_SELECTION_PROVIDER_ID = "playcanvas/rigging-weight-selections";
export const RIG_WEIGHT_SELECTION_PROVIDER_VERSION = "0-alpha.1";

function positiveInteger(value, fallback, label) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) throw new TypeError(`${label} must be a positive safe integer`);
  return candidate;
}

function finiteVector3(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw new TypeError(`${label} must contain three finite numbers`);
  }
  return [...value];
}

function uniqueVertices(value, vertexCount, maximumVertices) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value instanceof DataView) {
    throw new TypeError("Selection vertices must be an array or typed array");
  }
  if (!Number.isSafeInteger(value.length) || value.length > maximumVertices) {
    throw new RangeError(`Selection input exceeds the bounded limit of ${maximumVertices} vertices`);
  }
  const values = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
    if (!Number.isSafeInteger(candidate) || candidate < 0 || candidate >= vertexCount) {
      throw new RangeError(`Selection vertex ${index} is outside the geometry range`);
    }
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    values.push(candidate);
    if (values.length > maximumVertices) {
      throw new RangeError(`Selection exceeds the bounded limit of ${maximumVertices} vertices`);
    }
  }
  values.sort((left, right) => left - right);
  return new Uint32Array(values);
}

function selectionError(code, message, details = null) {
  const error = new Error(message);
  error.name = "RigWeightSelectionError";
  error.code = code;
  error.details = details;
  return error;
}

function zeroSelection(selection) {
  selection?.vertices?.fill?.(0);
}

export class RiggingWeightSelectionStore {
  constructor({
    geometry,
    id = "rig-weight-selection",
    maximumSelections = 64,
    maximumVerticesPerSelection = 250_000,
    maximumTotalEntries = 1_000_000,
  } = {}) {
    if (!(geometry?.positions instanceof Float32Array) || !(geometry?.componentIds instanceof Uint32Array)) {
      throw new TypeError("Rig weight selections require prepared binding geometry");
    }
    this.geometry = geometry;
    this.id = String(id || "rig-weight-selection").slice(0, 128);
    this.maximumSelections = positiveInteger(maximumSelections, 64, "maximumSelections");
    this.maximumVerticesPerSelection = positiveInteger(maximumVerticesPerSelection, 250_000, "maximumVerticesPerSelection");
    this.maximumTotalEntries = positiveInteger(maximumTotalEntries, 1_000_000, "maximumTotalEntries");
    this.selections = new Map();
    this.nextId = 1;
    this.destroyed = false;
  }

  assertActive() {
    if (this.destroyed) throw selectionError("rig/selection-destroyed", "Rig weight selection store was destroyed");
  }

  totalEntries() {
    let total = 0;
    for (const selection of this.selections.values()) total += selection.vertices.length;
    return total;
  }

  store(kind, verticesValue, metadata = {}) {
    this.assertActive();
    const vertices = uniqueVertices(
      verticesValue,
      this.geometry.vertexCount,
      this.maximumVerticesPerSelection,
    );
    if (this.selections.size >= this.maximumSelections) {
      vertices.fill(0);
      throw selectionError("rig/selection-capacity", "Rig weight selection store reached its bounded selection limit");
    }
    if (this.totalEntries() + vertices.length > this.maximumTotalEntries) {
      vertices.fill(0);
      throw selectionError("rig/selection-entry-capacity", "Rig weight selection store reached its bounded vertex-entry limit");
    }
    const id = `${this.id}:${this.nextId++}`;
    this.selections.set(id, {
      id,
      kind,
      vertices,
      metadata: Object.freeze({ ...metadata }),
    });
    return this.describe(id);
  }

  selectSphere({ center, radius, maximumScannedVertices = null } = {}) {
    this.assertActive();
    const origin = finiteVector3(center, "center");
    if (typeof radius !== "number" || !Number.isFinite(radius) || radius <= 0) {
      throw new TypeError("radius must be positive and finite");
    }
    const maximum = positiveInteger(
      maximumScannedVertices,
      Math.max(1, this.geometry.vertexCount),
      "maximumScannedVertices",
    );
    if (this.geometry.vertexCount > maximum) {
      throw selectionError("rig/selection-scan-limit", "Sphere selection exceeds its bounded vertex scan limit", {
        vertexCount: this.geometry.vertexCount,
        maximumScannedVertices: maximum,
      });
    }
    const radiusSquared = radius * radius;
    const vertices = [];
    for (let vertex = 0; vertex < this.geometry.vertexCount; vertex += 1) {
      const offset = vertex * 3;
      const dx = this.geometry.positions[offset] - origin[0];
      const dy = this.geometry.positions[offset + 1] - origin[1];
      const dz = this.geometry.positions[offset + 2] - origin[2];
      if (dx * dx + dy * dy + dz * dz <= radiusSquared) vertices.push(vertex);
    }
    return this.store("sphere", vertices, { center: Object.freeze(origin), radius });
  }

  selectComponents({ seedVertices = [], components = [] } = {}) {
    this.assertActive();
    if ((!Array.isArray(components) && !ArrayBuffer.isView(components)) || components instanceof DataView) {
      throw new TypeError("components must be an array or typed array");
    }
    if (!Number.isSafeInteger(components.length) || components.length > Math.max(1, this.geometry.componentCount)) {
      throw new RangeError("Component selection exceeds the bounded geometry component count");
    }
    const componentSet = new Set();
    const seeds = uniqueVertices(seedVertices, this.geometry.vertexCount, this.maximumVerticesPerSelection);
    for (const vertex of seeds) componentSet.add(this.geometry.componentIds[vertex]);
    seeds.fill(0);
    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      if (!Number.isSafeInteger(component) || component < 0 || component >= this.geometry.componentCount) {
        throw new RangeError(`components[${index}] is outside the geometry component range`);
      }
      componentSet.add(component);
    }
    const vertices = [];
    for (let vertex = 0; vertex < this.geometry.vertexCount; vertex += 1) {
      if (componentSet.has(this.geometry.componentIds[vertex])) vertices.push(vertex);
    }
    return this.store("components", vertices, {
      components: Object.freeze([...componentSet].sort((left, right) => left - right)),
    });
  }

  selectVertices(vertices) {
    return this.store("vertices", vertices);
  }

  union(selectionIds) {
    this.assertActive();
    if (!Array.isArray(selectionIds) || !selectionIds.length) throw new TypeError("union requires selection ids");
    const vertices = new Set();
    for (const id of selectionIds) {
      for (const vertex of this.record(id).vertices) vertices.add(vertex);
      if (vertices.size > this.maximumVerticesPerSelection) {
        throw selectionError("rig/selection-size", "Union exceeds the bounded selection vertex limit");
      }
    }
    return this.store("union", [...vertices], { selections: selectionIds.length });
  }

  record(id) {
    this.assertActive();
    const selection = this.selections.get(id);
    if (!selection) throw selectionError("rig/selection-handle", `Unknown rig weight selection: ${id}`);
    return selection;
  }

  describe(id) {
    const selection = this.record(id);
    return Object.freeze({
      id: selection.id,
      kind: selection.kind,
      vertices: selection.vertices.length,
      byteLength: selection.vertices.byteLength,
      metadata: selection.metadata,
    });
  }

  read(id) {
    return this.record(id).vertices.slice();
  }

  release(id) {
    this.assertActive();
    const selection = this.selections.get(id);
    if (!selection) return false;
    zeroSelection(selection);
    this.selections.delete(id);
    return true;
  }

  evidence() {
    return Object.freeze({
      provider: Object.freeze({ id: RIG_WEIGHT_SELECTION_PROVIDER_ID, version: RIG_WEIGHT_SELECTION_PROVIDER_VERSION }),
      status: this.destroyed ? "destroyed" : "ready",
      selections: this.destroyed ? 0 : this.selections.size,
      totalEntries: this.destroyed ? 0 : this.totalEntries(),
      maximumSelections: this.maximumSelections,
      maximumVerticesPerSelection: this.maximumVerticesPerSelection,
      maximumTotalEntries: this.maximumTotalEntries,
    });
  }

  destroy() {
    if (this.destroyed) return;
    for (const selection of this.selections.values()) zeroSelection(selection);
    this.selections.clear();
    this.geometry = null;
    this.destroyed = true;
  }
}
