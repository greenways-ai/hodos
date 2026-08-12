import {
  createRiggingAccessorReader,
  riggingActiveNodeInstances,
  riggingTriangleAreaSquared,
  riggingTriangleCountFor,
  riggingTriangleIndices,
  transformRiggingPoint,
} from "./rigging-surface-index.js";

export const RIG_BIND_GEOMETRY_PROVIDER_ID = "playcanvas/rigging-bind-geometry";
export const RIG_BIND_GEOMETRY_PROVIDER_VERSION = "0-alpha.1";

const TRIANGLE_MODES = new Set([4, 5, 6]);
const DEFAULT_LIMITS = Object.freeze({
  maximumVertices: 500_000,
  maximumTriangles: 1_000_000,
  maximumPrimitives: 50_000,
  maximumNodes: 4_096,
  maximumAdjacencyEntries: 6_000_000,
  maximumBytes: 256 * 1024 * 1024,
  yieldEveryTriangles: 4_096,
  yieldEveryVertices: 4_096,
});

export class RigBindGeometryError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "RigBindGeometryError";
    this.code = code;
    this.details = details;
  }
}

function positiveInteger(value, fallback, label) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return candidate;
}

function normalizeLimits(value = {}) {
  return Object.freeze(Object.fromEntries(
    Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => [key, positiveInteger(value[key], fallback, key)]),
  ));
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function plainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function defaultYieldControl() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function estimateBytes(vertexCount, triangleCount, adjacencyEntries) {
  return vertexCount * (3 * 4 + 4 * 4 + 4 + 4)
    + triangleCount * 3 * 4
    + adjacencyEntries * 4
    + (vertexCount + 1) * 4;
}

function freezeEvidence(value) {
  return Object.freeze({
    provider: Object.freeze({ id: RIG_BIND_GEOMETRY_PROVIDER_ID, version: RIG_BIND_GEOMETRY_PROVIDER_VERSION }),
    status: value.status,
    vertices: value.vertices,
    triangles: value.triangles,
    primitives: value.primitives,
    instances: value.instances,
    components: value.components,
    adjacencyEntries: value.adjacencyEntries,
    skippedPrimitives: value.skippedPrimitives,
    degenerateTriangles: value.degenerateTriangles,
    byteLength: value.byteLength,
    limits: Object.freeze({ ...value.limits }),
  });
}

function addNeighbor(sets, left, right, counters, limits) {
  if (left === right || sets[left].has(right)) return;
  sets[left].add(right);
  counters.entries += 1;
  if (counters.entries > limits.maximumAdjacencyEntries) {
    throw new RigBindGeometryError(
      "rig/binding-adjacency-limit",
      "Binding geometry exceeds its bounded adjacency limit",
      { adjacencyEntries: counters.entries, maximumAdjacencyEntries: limits.maximumAdjacencyEntries },
    );
  }
}

function buildAdjacency(vertexCount, triangles, limits) {
  const sets = Array.from({ length: vertexCount }, () => new Set());
  const counters = { entries: 0 };
  for (let offset = 0; offset < triangles.length; offset += 3) {
    const a = triangles[offset];
    const b = triangles[offset + 1];
    const c = triangles[offset + 2];
    addNeighbor(sets, a, b, counters, limits); addNeighbor(sets, b, a, counters, limits);
    addNeighbor(sets, b, c, counters, limits); addNeighbor(sets, c, b, counters, limits);
    addNeighbor(sets, c, a, counters, limits); addNeighbor(sets, a, c, counters, limits);
  }
  const offsets = new Uint32Array(vertexCount + 1);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) offsets[vertex + 1] = offsets[vertex] + sets[vertex].size;
  const adjacency = new Uint32Array(offsets[vertexCount]);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const values = [...sets[vertex]].sort((left, right) => left - right);
    adjacency.set(values, offsets[vertex]);
    sets[vertex].clear();
  }
  return { offsets, adjacency };
}

function connectedComponents(vertexCount, offsets, adjacency) {
  const ids = new Uint32Array(vertexCount);
  ids.fill(0xffffffff);
  const queue = new Uint32Array(vertexCount);
  let componentCount = 0;
  for (let root = 0; root < vertexCount; root += 1) {
    if (ids[root] !== 0xffffffff) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = root;
    ids[root] = componentCount;
    while (head < tail) {
      const vertex = queue[head++];
      for (let offset = offsets[vertex]; offset < offsets[vertex + 1]; offset += 1) {
        const neighbor = adjacency[offset];
        if (ids[neighbor] !== 0xffffffff) continue;
        ids[neighbor] = componentCount;
        queue[tail++] = neighbor;
      }
    }
    componentCount += 1;
  }
  queue.fill(0);
  return { ids, componentCount };
}

export async function buildRiggingBindGeometry({ document, binaryChunk } = {}, options = {}) {
  if (!plainObject(document)) throw new TypeError("Binding geometry requires a parsed glTF document");
  const limits = normalizeLimits(options);
  const yieldControl = typeof options.yieldControl === "function" ? options.yieldControl : defaultYieldControl;
  const accessors = createRiggingAccessorReader(document, binaryChunk);
  const instances = riggingActiveNodeInstances(document, limits);
  const meshes = safeArray(document.meshes);
  const positions = [];
  const metadata = [];
  const triangles = [];
  const primitiveRanges = [];
  let primitiveCount = 0;
  let skippedPrimitives = 0;
  let degenerateTriangles = 0;
  let processedTriangles = 0;
  let processedVertices = 0;

  for (const instance of instances) {
    const mesh = meshes[instance.meshIndex];
    const primitives = safeArray(mesh?.primitives);
    for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex += 1) {
      primitiveCount += 1;
      if (primitiveCount > limits.maximumPrimitives) {
        throw new RigBindGeometryError("rig/binding-primitive-limit", "GLB exceeds the bounded binding primitive limit", {
          maximumPrimitives: limits.maximumPrimitives,
        });
      }
      const primitive = plainObject(primitives[primitiveIndex]) ? primitives[primitiveIndex] : {};
      const mode = primitive.mode ?? 4;
      if (!TRIANGLE_MODES.has(mode) || primitive.extensions?.KHR_draco_mesh_compression) {
        skippedPrimitives += 1;
        continue;
      }
      const position = accessors.descriptor(primitive.attributes?.POSITION);
      if (position.type !== "VEC3" || position.componentType !== 5126) {
        throw new RigBindGeometryError("rig/binding-position", "Binding POSITION accessors must be floating-point VEC3 values", {
          node: instance.nodeIndex,
          mesh: instance.meshIndex,
          primitive: primitiveIndex,
        });
      }
      const indices = primitive.indices === undefined ? null : accessors.descriptor(primitive.indices);
      if (indices && (indices.type !== "SCALAR" || ![5121, 5123, 5125].includes(indices.componentType))) {
        throw new RigBindGeometryError("rig/binding-indices", "Binding indices must be unsigned scalar accessors");
      }
      const elementCount = indices?.count ?? position.count;
      const declaredTriangles = riggingTriangleCountFor(mode, elementCount);
      const localVertices = new Map();
      const vertexStart = positions.length / 3;
      const triangleStart = triangles.length / 3;
      const readIndex = indices
        ? (element) => accessors.read(indices, element, 0)
        : (element) => element;
      const resolveVertex = (sourceIndex, point) => {
        if (localVertices.has(sourceIndex)) return localVertices.get(sourceIndex);
        const vertex = positions.length / 3;
        if (vertex >= limits.maximumVertices) {
          throw new RigBindGeometryError("rig/binding-vertex-limit", "GLB exceeds the bounded binding vertex limit", {
            maximumVertices: limits.maximumVertices,
          });
        }
        positions.push(...point);
        metadata.push(instance.nodeIndex, instance.meshIndex, primitiveIndex, sourceIndex);
        localVertices.set(sourceIndex, vertex);
        processedVertices += 1;
        return vertex;
      };
      for (let localTriangle = 0; localTriangle < declaredTriangles; localTriangle += 1) {
        if (triangles.length / 3 >= limits.maximumTriangles) {
          throw new RigBindGeometryError("rig/binding-triangle-limit", "GLB exceeds the bounded binding triangle limit", {
            maximumTriangles: limits.maximumTriangles,
          });
        }
        const sourceIndices = riggingTriangleIndices(mode, localTriangle, readIndex);
        if (sourceIndices.some((entry) => !Number.isSafeInteger(entry) || entry < 0 || entry >= position.count)) {
          throw new RigBindGeometryError("rig/binding-index-range", "Triangle index references a vertex outside the POSITION accessor", {
            node: instance.nodeIndex,
            mesh: instance.meshIndex,
            primitive: primitiveIndex,
            triangle: localTriangle,
          });
        }
        const points = sourceIndices.map((index) => transformRiggingPoint(instance.matrix, accessors.vector(position, index).slice(0, 3)));
        if (points.some((point) => !point.every(Number.isFinite))) {
          throw new RigBindGeometryError("rig/binding-non-finite", "Binding geometry contains a non-finite transformed vertex");
        }
        if (sourceIndices[0] === sourceIndices[1] || sourceIndices[1] === sourceIndices[2] || sourceIndices[2] === sourceIndices[0]
          || riggingTriangleAreaSquared(points[0], points[1], points[2]) <= 1e-16) {
          degenerateTriangles += 1;
          continue;
        }
        triangles.push(
          resolveVertex(sourceIndices[0], points[0]),
          resolveVertex(sourceIndices[1], points[1]),
          resolveVertex(sourceIndices[2], points[2]),
        );
        processedTriangles += 1;
        if (processedTriangles % limits.yieldEveryTriangles === 0
          || processedVertices >= limits.yieldEveryVertices && processedVertices % limits.yieldEveryVertices === 0) {
          await yieldControl();
        }
      }
      primitiveRanges.push(Object.freeze({
        node: instance.nodeIndex,
        mesh: instance.meshIndex,
        primitive: primitiveIndex,
        vertexStart,
        vertexCount: positions.length / 3 - vertexStart,
        triangleStart,
        triangleCount: triangles.length / 3 - triangleStart,
      }));
    }
  }
  const vertexCount = positions.length / 3;
  const triangleCount = triangles.length / 3;
  if (!vertexCount || !triangleCount) {
    throw new RigBindGeometryError("rig/binding-unavailable", "GLB has no locally readable non-degenerate triangle geometry", {
      primitives: primitiveCount,
      skippedPrimitives,
      degenerateTriangles,
    });
  }
  const positionBuffer = new Float32Array(positions);
  const metadataBuffer = new Int32Array(metadata);
  const triangleBuffer = new Uint32Array(triangles);
  positions.length = 0; metadata.length = 0; triangles.length = 0;
  const { offsets: adjacencyOffsets, adjacency } = buildAdjacency(vertexCount, triangleBuffer, limits);
  const { ids: componentIds, componentCount } = connectedComponents(vertexCount, adjacencyOffsets, adjacency);
  const byteLength = estimateBytes(vertexCount, triangleCount, adjacency.length);
  if (byteLength > limits.maximumBytes) {
    for (const buffer of [positionBuffer, metadataBuffer, triangleBuffer, adjacencyOffsets, adjacency, componentIds]) buffer.fill(0);
    throw new RigBindGeometryError("rig/binding-byte-limit", "Binding geometry exceeds its bounded memory profile", {
      byteLength,
      maximumBytes: limits.maximumBytes,
    });
  }
  const geometry = {
    provider: { id: RIG_BIND_GEOMETRY_PROVIDER_ID, version: RIG_BIND_GEOMETRY_PROVIDER_VERSION },
    positions: positionBuffer,
    metadata: metadataBuffer,
    triangles: triangleBuffer,
    adjacencyOffsets,
    adjacency,
    componentIds,
    componentCount,
    vertexCount,
    triangleCount,
    primitiveRanges: Object.freeze(primitiveRanges),
    destroyed: false,
    evidence: null,
  };
  geometry.evidence = freezeEvidence({
    status: skippedPrimitives || degenerateTriangles ? "warn" : "ready",
    vertices: vertexCount,
    triangles: triangleCount,
    primitives: primitiveCount,
    instances: instances.length,
    components: componentCount,
    adjacencyEntries: adjacency.length,
    skippedPrimitives,
    degenerateTriangles,
    byteLength,
    limits: {
      maximumVertices: limits.maximumVertices,
      maximumTriangles: limits.maximumTriangles,
      maximumAdjacencyEntries: limits.maximumAdjacencyEntries,
      maximumBytes: limits.maximumBytes,
    },
  });
  return geometry;
}

export function bindGeometryEvidence(geometry) {
  if (!geometry) return Object.freeze({
    provider: Object.freeze({ id: RIG_BIND_GEOMETRY_PROVIDER_ID, version: RIG_BIND_GEOMETRY_PROVIDER_VERSION }),
    status: "unprepared",
    vertices: 0,
    triangles: 0,
    components: 0,
    adjacencyEntries: 0,
    byteLength: 0,
  });
  if (geometry.destroyed) return Object.freeze({
    provider: Object.freeze({ id: RIG_BIND_GEOMETRY_PROVIDER_ID, version: RIG_BIND_GEOMETRY_PROVIDER_VERSION }),
    status: "destroyed",
    vertices: 0,
    triangles: 0,
    components: 0,
    adjacencyEntries: 0,
    byteLength: 0,
  });
  return geometry.evidence;
}

export function destroyRiggingBindGeometry(geometry) {
  if (!geometry || geometry.destroyed) return false;
  for (const key of ["positions", "metadata", "triangles", "adjacencyOffsets", "adjacency", "componentIds"]) {
    geometry[key]?.fill?.(0);
  }
  geometry.destroyed = true;
  geometry.vertexCount = 0;
  geometry.triangleCount = 0;
  geometry.componentCount = 0;
  geometry.primitiveRanges = Object.freeze([]);
  return true;
}
