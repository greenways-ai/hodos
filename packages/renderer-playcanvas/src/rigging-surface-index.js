export const RIG_SURFACE_INDEX_PROVIDER_ID = "playcanvas/rigging-surface-index";
export const RIG_SURFACE_INDEX_PROVIDER_VERSION = "0-alpha.1";

const DEFAULT_LIMITS = Object.freeze({
  maximumTriangles: 250_000,
  maximumBytes: 96 * 1024 * 1024,
  maximumNodes: 4_096,
  maximumPrimitives: 50_000,
  leafSize: 8,
  yieldEveryTriangles: 4_096,
  yieldEveryNodes: 256,
  maximumRayNodes: 131_072,
  maximumRayTriangles: 65_536,
});

const COMPONENT_TYPES = Object.freeze({
  5120: { bytes: 1, read: (view, offset) => view.getInt8(offset), min: -128, max: 127 },
  5121: { bytes: 1, read: (view, offset) => view.getUint8(offset), min: 0, max: 255 },
  5122: { bytes: 2, read: (view, offset) => view.getInt16(offset, true), min: -32768, max: 32767 },
  5123: { bytes: 2, read: (view, offset) => view.getUint16(offset, true), min: 0, max: 65535 },
  5125: { bytes: 4, read: (view, offset) => view.getUint32(offset, true), min: 0, max: 4294967295 },
  5126: { bytes: 4, read: (view, offset) => view.getFloat32(offset, true), min: null, max: null },
});

const ACCESSOR_COMPONENTS = Object.freeze({
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
});

const TRIANGLE_MODES = new Set([4, 5, 6]);
const EPSILON = 1e-8;

export class RigSurfaceIndexError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "RigSurfaceIndexError";
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
  const result = {};
  for (const [key, fallback] of Object.entries(DEFAULT_LIMITS)) {
    result[key] = positiveInteger(value[key], fallback, key);
  }
  if (result.leafSize > 64) throw new TypeError("leafSize must not exceed 64 triangles");
  return Object.freeze(result);
}

function plainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteVector(value, length, fallback = null) {
  if (!Array.isArray(value) || value.length !== length || !value.every(Number.isFinite)) return fallback;
  return [...value];
}

function identityMatrix() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiplyMatrices(left, right) {
  const result = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      result[column * 4 + row] =
        left[row] * right[column * 4]
        + left[4 + row] * right[column * 4 + 1]
        + left[8 + row] * right[column * 4 + 2]
        + left[12 + row] * right[column * 4 + 3];
    }
  }
  return result;
}

function matrixFromNode(node, index) {
  if (node.matrix !== undefined) {
    if (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined) {
      throw new RigSurfaceIndexError("rig/surface-node-transform", `Node ${index} combines matrix and TRS transforms`);
    }
    const matrix = finiteVector(node.matrix, 16);
    if (!matrix) throw new RigSurfaceIndexError("rig/surface-node-matrix", `Node ${index} has an invalid matrix`);
    return matrix;
  }
  const translation = node.translation === undefined ? [0, 0, 0] : finiteVector(node.translation, 3);
  const rotation = node.rotation === undefined ? [0, 0, 0, 1] : finiteVector(node.rotation, 4);
  const scale = node.scale === undefined ? [1, 1, 1] : finiteVector(node.scale, 3);
  if (!translation || !rotation || !scale) {
    throw new RigSurfaceIndexError("rig/surface-node-trs", `Node ${index} has an invalid TRS transform`);
  }
  const length = Math.hypot(...rotation);
  if (length <= EPSILON || scale.some((entry) => Math.abs(entry) <= EPSILON)) {
    throw new RigSurfaceIndexError("rig/surface-node-trs", `Node ${index} has a singular transform`);
  }
  const [x, y, z, w] = rotation.map((entry) => entry / length);
  const [sx, sy, sz] = scale;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * sx,
    2 * (xy + wz) * sx,
    2 * (xz - wy) * sx,
    0,
    2 * (xy - wz) * sy,
    (1 - 2 * (xx + zz)) * sy,
    2 * (yz + wx) * sy,
    0,
    2 * (xz + wy) * sz,
    2 * (yz - wx) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
    translation[0], translation[1], translation[2], 1,
  ];
}

function transformPoint(matrix, point) {
  const [x, y, z] = point;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const divisor = Math.abs(w) > EPSILON ? w : 1;
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / divisor,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / divisor,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / divisor,
  ];
}

function activeNodeInstances(document, limits) {
  const nodes = safeArray(document.nodes);
  const meshes = safeArray(document.meshes);
  if (nodes.length > limits.maximumNodes) {
    throw new RigSurfaceIndexError("rig/surface-node-limit", "GLB exceeds the bounded surface-index node limit", {
      nodes: nodes.length,
      maximumNodes: limits.maximumNodes,
    });
  }
  const parents = new Array(nodes.length).fill(null);
  for (let index = 0; index < nodes.length; index += 1) {
    const node = plainObject(nodes[index]) ? nodes[index] : {};
    for (const child of safeArray(node.children)) {
      if (!Number.isSafeInteger(child) || child < 0 || child >= nodes.length) {
        throw new RigSurfaceIndexError("rig/surface-node-child", `Node ${index} references an invalid child`);
      }
      if (parents[child] !== null && parents[child] !== index) {
        throw new RigSurfaceIndexError("rig/surface-node-parent", `Node ${child} has multiple parents`);
      }
      parents[child] = index;
    }
  }
  const local = nodes.map((node, index) => matrixFromNode(plainObject(node) ? node : {}, index));
  const world = new Array(nodes.length);
  const visiting = new Set();
  const resolve = (index) => {
    if (world[index]) return world[index];
    if (visiting.has(index)) throw new RigSurfaceIndexError("rig/surface-node-cycle", "Node hierarchy contains a cycle");
    visiting.add(index);
    const parent = parents[index];
    const matrix = parent === null ? local[index] : multiplyMatrices(resolve(parent), local[index]);
    visiting.delete(index);
    world[index] = matrix;
    return matrix;
  };
  for (let index = 0; index < nodes.length; index += 1) resolve(index);

  const scenes = safeArray(document.scenes);
  const sceneIndex = Number.isSafeInteger(document.scene) ? document.scene : 0;
  let roots;
  if (scenes.length) {
    if (sceneIndex < 0 || sceneIndex >= scenes.length || !plainObject(scenes[sceneIndex])) {
      throw new RigSurfaceIndexError("rig/surface-scene", "GLB selects an invalid scene");
    }
    roots = safeArray(scenes[sceneIndex].nodes);
  } else {
    roots = nodes.map((_, index) => index).filter((index) => parents[index] === null);
  }
  const reachable = new Set();
  const stack = [...roots];
  while (stack.length) {
    const index = stack.pop();
    if (!Number.isSafeInteger(index) || index < 0 || index >= nodes.length) {
      throw new RigSurfaceIndexError("rig/surface-scene-node", "Scene references an invalid node");
    }
    if (reachable.has(index)) continue;
    reachable.add(index);
    stack.push(...safeArray(nodes[index]?.children));
  }
  const instances = [];
  for (const nodeIndex of [...reachable].sort((left, right) => left - right)) {
    const node = plainObject(nodes[nodeIndex]) ? nodes[nodeIndex] : {};
    if (node.mesh === undefined) continue;
    if (!Number.isSafeInteger(node.mesh) || node.mesh < 0 || node.mesh >= meshes.length || !plainObject(meshes[node.mesh])) {
      throw new RigSurfaceIndexError("rig/surface-mesh", `Node ${nodeIndex} references an invalid mesh`);
    }
    instances.push({ nodeIndex, meshIndex: node.mesh, matrix: world[nodeIndex] });
  }
  return instances;
}

function createAccessorReader(document, binaryChunk) {
  const accessors = safeArray(document.accessors);
  const bufferViews = safeArray(document.bufferViews);
  const buffers = safeArray(document.buffers);
  const binaryView = binaryChunk
    ? new DataView(binaryChunk.buffer, binaryChunk.byteOffset, binaryChunk.byteLength)
    : null;
  const cache = new Map();

  function descriptor(index) {
    if (cache.has(index)) return cache.get(index);
    if (!Number.isSafeInteger(index) || index < 0 || index >= accessors.length || !plainObject(accessors[index])) {
      throw new RigSurfaceIndexError("rig/surface-accessor", `Invalid accessor index: ${index}`);
    }
    const accessor = accessors[index];
    if (accessor.sparse !== undefined) {
      throw new RigSurfaceIndexError("rig/surface-sparse", "Sparse accessors are not supported by the local surface index", { accessor: index });
    }
    const component = COMPONENT_TYPES[accessor.componentType];
    const components = ACCESSOR_COMPONENTS[accessor.type];
    if (!component || !components || !Number.isSafeInteger(accessor.count) || accessor.count < 0) {
      throw new RigSurfaceIndexError("rig/surface-accessor", `Accessor ${index} is malformed`);
    }
    const elementBytes = component.bytes * components;
    if (accessor.bufferView === undefined) {
      const result = Object.freeze({
        index,
        count: accessor.count,
        component,
        componentType: accessor.componentType,
        components,
        type: accessor.type,
        normalized: accessor.normalized === true,
        zero: true,
        offset: 0,
        stride: elementBytes,
      });
      cache.set(index, result);
      return result;
    }
    const viewIndex = accessor.bufferView;
    const bufferView = bufferViews[viewIndex];
    if (!Number.isSafeInteger(viewIndex) || viewIndex < 0 || !plainObject(bufferView)) {
      throw new RigSurfaceIndexError("rig/surface-buffer-view", `Accessor ${index} references an invalid buffer view`);
    }
    if (bufferView.extensions?.EXT_meshopt_compression) {
      throw new RigSurfaceIndexError("rig/surface-meshopt", "Meshopt-compressed geometry requires a decoder before surface indexing");
    }
    const bufferIndex = bufferView.buffer;
    if (bufferIndex !== 0 || !plainObject(buffers[bufferIndex]) || buffers[bufferIndex].uri || !binaryView) {
      throw new RigSurfaceIndexError("rig/surface-external-buffer", "Surface geometry is not available in the local GLB binary chunk");
    }
    const viewOffset = bufferView.byteOffset ?? 0;
    const viewLength = bufferView.byteLength;
    const accessorOffset = accessor.byteOffset ?? 0;
    const stride = bufferView.byteStride ?? elementBytes;
    if (![viewOffset, viewLength, accessorOffset, stride].every((entry) => Number.isSafeInteger(entry) && entry >= 0)
      || stride < elementBytes || stride % component.bytes !== 0 || accessorOffset % component.bytes !== 0) {
      throw new RigSurfaceIndexError("rig/surface-accessor-layout", `Accessor ${index} has an invalid byte layout`);
    }
    const offset = viewOffset + accessorOffset;
    const required = accessor.count ? offset + (accessor.count - 1) * stride + elementBytes : offset;
    if (offset < viewOffset || required > viewOffset + viewLength || required > binaryView.byteLength) {
      throw new RigSurfaceIndexError("rig/surface-accessor-bounds", `Accessor ${index} exceeds its buffer view`);
    }
    const result = Object.freeze({
      index,
      count: accessor.count,
      component,
      componentType: accessor.componentType,
      components,
      type: accessor.type,
      normalized: accessor.normalized === true,
      zero: false,
      offset,
      stride,
    });
    cache.set(index, result);
    return result;
  }

  function read(desc, element, componentIndex = 0) {
    if (!Number.isSafeInteger(element) || element < 0 || element >= desc.count
      || !Number.isSafeInteger(componentIndex) || componentIndex < 0 || componentIndex >= desc.components) return null;
    if (desc.zero) return 0;
    const value = desc.component.read(binaryView, desc.offset + element * desc.stride + componentIndex * desc.component.bytes);
    if (!desc.normalized || desc.componentType === 5126) return value;
    if (desc.component.min === 0) return value / desc.component.max;
    return Math.max(value / desc.component.max, -1);
  }

  function vector(desc, element) {
    const result = new Array(desc.components);
    for (let component = 0; component < desc.components; component += 1) {
      result[component] = read(desc, element, component);
    }
    return result;
  }

  return Object.freeze({ descriptor, read, vector });
}

function triangleCountFor(mode, elementCount) {
  if (mode === 4) return Math.floor(elementCount / 3);
  if (mode === 5 || mode === 6) return Math.max(0, elementCount - 2);
  return 0;
}

function triangleIndices(mode, triangle, readIndex) {
  if (mode === 4) return [readIndex(triangle * 3), readIndex(triangle * 3 + 1), readIndex(triangle * 3 + 2)];
  if (mode === 5) {
    return triangle % 2 === 0
      ? [readIndex(triangle), readIndex(triangle + 1), readIndex(triangle + 2)]
      : [readIndex(triangle + 1), readIndex(triangle), readIndex(triangle + 2)];
  }
  return [readIndex(0), readIndex(triangle + 1), readIndex(triangle + 2)];
}

function triangleAreaSquared(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  return cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2];
}

function indexByteEstimate(triangles) {
  const triangleBytes = triangles * (9 * 4 + 4 * 4 + 3 * 4 + 6 * 4 + 4);
  const maximumBvhNodes = Math.max(1, triangles * 2);
  const bvhBytes = maximumBvhNodes * (6 * 4 + 4 * 4);
  return triangleBytes + bvhBytes;
}

function defaultYieldControl() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function freezeEvidence(value) {
  return Object.freeze({
    provider: Object.freeze({ id: RIG_SURFACE_INDEX_PROVIDER_ID, version: RIG_SURFACE_INDEX_PROVIDER_VERSION }),
    status: value.status,
    triangles: value.triangles,
    primitives: value.primitives,
    instances: value.instances,
    skippedPrimitives: value.skippedPrimitives,
    degenerateTriangles: value.degenerateTriangles,
    bvhNodes: value.bvhNodes,
    byteLength: value.byteLength,
    limits: Object.freeze({ ...value.limits }),
  });
}

function initializeTriangleBounds(positions, triangle, bounds, centroids) {
  const offset = triangle * 9;
  const boundsOffset = triangle * 6;
  const centerOffset = triangle * 3;
  for (let axis = 0; axis < 3; axis += 1) {
    const a = positions[offset + axis];
    const b = positions[offset + 3 + axis];
    const c = positions[offset + 6 + axis];
    bounds[boundsOffset + axis] = Math.min(a, b, c);
    bounds[boundsOffset + 3 + axis] = Math.max(a, b, c);
    centroids[centerOffset + axis] = (a + b + c) / 3;
  }
}

function swap(values, left, right) {
  const value = values[left];
  values[left] = values[right];
  values[right] = value;
}

function quickSelect(order, centroids, left, right, target, axis) {
  while (left < right) {
    const pivotIndex = (left + right) >> 1;
    const pivot = centroids[order[pivotIndex] * 3 + axis];
    let low = left;
    let high = right;
    while (low <= high) {
      while (centroids[order[low] * 3 + axis] < pivot) low += 1;
      while (centroids[order[high] * 3 + axis] > pivot) high -= 1;
      if (low <= high) {
        swap(order, low, high);
        low += 1;
        high -= 1;
      }
    }
    if (target <= high) right = high;
    else if (target >= low) left = low;
    else return;
  }
}

function writeNodeBounds(node, start, count, order, triangleBounds, nodeMin, nodeMax, centroids) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  const centerMin = [Infinity, Infinity, Infinity];
  const centerMax = [-Infinity, -Infinity, -Infinity];
  for (let offset = start; offset < start + count; offset += 1) {
    const triangle = order[offset];
    const boundsOffset = triangle * 6;
    const centerOffset = triangle * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], triangleBounds[boundsOffset + axis]);
      maximum[axis] = Math.max(maximum[axis], triangleBounds[boundsOffset + 3 + axis]);
      centerMin[axis] = Math.min(centerMin[axis], centroids[centerOffset + axis]);
      centerMax[axis] = Math.max(centerMax[axis], centroids[centerOffset + axis]);
    }
  }
  const nodeOffset = node * 3;
  nodeMin.set(minimum, nodeOffset);
  nodeMax.set(maximum, nodeOffset);
  const extents = centerMin.map((entry, axis) => centerMax[axis] - entry);
  let axis = 0;
  if (extents[1] > extents[axis]) axis = 1;
  if (extents[2] > extents[axis]) axis = 2;
  return axis;
}

async function buildBvh(index, limits, yieldControl) {
  const triangles = index.triangleCount;
  const capacity = Math.max(1, triangles * 2);
  const nodeMin = new Float32Array(capacity * 3);
  const nodeMax = new Float32Array(capacity * 3);
  const nodeLeft = new Int32Array(capacity); nodeLeft.fill(-1);
  const nodeRight = new Int32Array(capacity); nodeRight.fill(-1);
  const nodeStart = new Uint32Array(capacity);
  const nodeCount = new Uint32Array(capacity);
  const stack = [{ node: 0, start: 0, count: triangles }];
  let nodeTotal = 1;
  let processed = 0;
  while (stack.length) {
    const task = stack.pop();
    const axis = writeNodeBounds(task.node, task.start, task.count, index.order, index.triangleBounds,
      nodeMin, nodeMax, index.centroids);
    if (task.count <= limits.leafSize) {
      nodeStart[task.node] = task.start;
      nodeCount[task.node] = task.count;
    } else {
      const middle = task.start + Math.floor(task.count / 2);
      quickSelect(index.order, index.centroids, task.start, task.start + task.count - 1, middle, axis);
      const leftCount = middle - task.start;
      const rightCount = task.count - leftCount;
      const left = nodeTotal++;
      const right = nodeTotal++;
      nodeLeft[task.node] = left;
      nodeRight[task.node] = right;
      stack.push({ node: right, start: middle, count: rightCount });
      stack.push({ node: left, start: task.start, count: leftCount });
    }
    processed += 1;
    if (processed % limits.yieldEveryNodes === 0) await yieldControl();
  }
  index.nodeMin = nodeMin.subarray(0, nodeTotal * 3);
  index.nodeMax = nodeMax.subarray(0, nodeTotal * 3);
  index.nodeLeft = nodeLeft.subarray(0, nodeTotal);
  index.nodeRight = nodeRight.subarray(0, nodeTotal);
  index.nodeStart = nodeStart.subarray(0, nodeTotal);
  index.nodeCount = nodeCount.subarray(0, nodeTotal);
  index.bvhNodeCount = nodeTotal;
}

export async function buildRiggingSurfaceIndex({ document, binaryChunk } = {}, options = {}) {
  if (!plainObject(document)) throw new TypeError("Surface index requires a parsed glTF document");
  const limits = normalizeLimits(options);
  const yieldControl = typeof options.yieldControl === "function" ? options.yieldControl : defaultYieldControl;
  const accessors = createAccessorReader(document, binaryChunk);
  const instances = activeNodeInstances(document, limits);
  const meshes = safeArray(document.meshes);
  let declaredTriangles = 0;
  let primitiveCount = 0;
  let skippedPrimitives = 0;
  const work = [];

  for (const instance of instances) {
    const mesh = meshes[instance.meshIndex];
    const primitives = safeArray(mesh.primitives);
    for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex += 1) {
      primitiveCount += 1;
      if (primitiveCount > limits.maximumPrimitives) {
        throw new RigSurfaceIndexError("rig/surface-primitive-limit", "GLB exceeds the bounded surface-index primitive limit", {
          maximumPrimitives: limits.maximumPrimitives,
        });
      }
      const primitive = plainObject(primitives[primitiveIndex]) ? primitives[primitiveIndex] : {};
      const mode = primitive.mode ?? 4;
      if (!TRIANGLE_MODES.has(mode) || primitive.extensions?.KHR_draco_mesh_compression) {
        skippedPrimitives += 1;
        continue;
      }
      const positionIndex = primitive.attributes?.POSITION;
      const position = accessors.descriptor(positionIndex);
      if (position.type !== "VEC3" || position.componentType !== 5126) {
        throw new RigSurfaceIndexError("rig/surface-position", "Surface POSITION accessors must be floating-point VEC3 values", {
          node: instance.nodeIndex,
          mesh: instance.meshIndex,
          primitive: primitiveIndex,
        });
      }
      const indices = primitive.indices === undefined ? null : accessors.descriptor(primitive.indices);
      if (indices && (indices.type !== "SCALAR" || ![5121, 5123, 5125].includes(indices.componentType))) {
        throw new RigSurfaceIndexError("rig/surface-indices", "Surface indices must be unsigned scalar accessors");
      }
      const elementCount = indices?.count ?? position.count;
      const triangles = triangleCountFor(mode, elementCount);
      declaredTriangles += triangles;
      if (declaredTriangles > limits.maximumTriangles) {
        throw new RigSurfaceIndexError("rig/surface-triangle-limit", "GLB exceeds the bounded surface-index triangle limit", {
          triangles: declaredTriangles,
          maximumTriangles: limits.maximumTriangles,
        });
      }
      work.push({ ...instance, primitiveIndex, primitive, mode, position, indices, triangles });
    }
  }
  if (!declaredTriangles) {
    throw new RigSurfaceIndexError("rig/surface-unavailable", "GLB has no locally readable triangle geometry", {
      primitives: primitiveCount,
      skippedPrimitives,
    });
  }
  const estimatedBytes = indexByteEstimate(declaredTriangles);
  if (estimatedBytes > limits.maximumBytes) {
    throw new RigSurfaceIndexError("rig/surface-byte-limit", "Surface index exceeds its bounded memory profile", {
      estimatedBytes,
      maximumBytes: limits.maximumBytes,
    });
  }

  const positions = new Float32Array(declaredTriangles * 9);
  const metadata = new Int32Array(declaredTriangles * 4);
  let triangleCount = 0;
  let degenerateTriangles = 0;
  let extractedSinceYield = 0;
  for (const item of work) {
    const readIndex = item.indices
      ? (element) => accessors.read(item.indices, element, 0)
      : (element) => element;
    for (let localTriangle = 0; localTriangle < item.triangles; localTriangle += 1) {
      const indices = triangleIndices(item.mode, localTriangle, readIndex);
      if (indices.some((entry) => !Number.isSafeInteger(entry) || entry < 0 || entry >= item.position.count)) {
        throw new RigSurfaceIndexError("rig/surface-index-range", "Triangle index references a vertex outside the POSITION accessor", {
          node: item.nodeIndex,
          mesh: item.meshIndex,
          primitive: item.primitiveIndex,
          triangle: localTriangle,
        });
      }
      const points = indices.map((index) => transformPoint(item.matrix, accessors.vector(item.position, index).slice(0, 3)));
      if (points.some((point) => !point.every(Number.isFinite))) {
        throw new RigSurfaceIndexError("rig/surface-non-finite", "Surface geometry contains a non-finite transformed vertex");
      }
      if (indices[0] === indices[1] || indices[1] === indices[2] || indices[2] === indices[0]
        || triangleAreaSquared(points[0], points[1], points[2]) <= EPSILON * EPSILON) {
        degenerateTriangles += 1;
        continue;
      }
      positions.set(points.flat(), triangleCount * 9);
      metadata.set([item.nodeIndex, item.meshIndex, item.primitiveIndex, localTriangle], triangleCount * 4);
      triangleCount += 1;
      extractedSinceYield += 1;
      if (extractedSinceYield >= limits.yieldEveryTriangles) {
        extractedSinceYield = 0;
        await yieldControl();
      }
    }
  }
  if (!triangleCount) throw new RigSurfaceIndexError("rig/surface-degenerate", "All locally readable triangles are degenerate");

  const index = {
    provider: { id: RIG_SURFACE_INDEX_PROVIDER_ID, version: RIG_SURFACE_INDEX_PROVIDER_VERSION },
    limits,
    positions: positions.subarray(0, triangleCount * 9),
    metadata: metadata.subarray(0, triangleCount * 4),
    triangleBounds: new Float32Array(triangleCount * 6),
    centroids: new Float32Array(triangleCount * 3),
    order: new Uint32Array(triangleCount),
    triangleCount,
    bvhNodeCount: 0,
    destroyed: false,
    evidence: null,
  };
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    index.order[triangle] = triangle;
    initializeTriangleBounds(index.positions, triangle, index.triangleBounds, index.centroids);
  }
  await buildBvh(index, limits, yieldControl);
  index.evidence = freezeEvidence({
    status: skippedPrimitives || degenerateTriangles ? "warn" : "ready",
    triangles: triangleCount,
    primitives: primitiveCount,
    instances: instances.length,
    skippedPrimitives,
    degenerateTriangles,
    bvhNodes: index.bvhNodeCount,
    byteLength: indexByteEstimate(triangleCount),
    limits: {
      maximumTriangles: limits.maximumTriangles,
      maximumBytes: limits.maximumBytes,
      maximumRayNodes: limits.maximumRayNodes,
      maximumRayTriangles: limits.maximumRayTriangles,
      leafSize: limits.leafSize,
    },
  });
  return index;
}

function normalizeRay(rayValue) {
  const origin = finiteVector(rayValue?.origin, 3);
  const directionValue = finiteVector(rayValue?.direction, 3);
  if (!origin || !directionValue) throw new TypeError("Surface ray requires finite origin and direction vectors");
  const length = Math.hypot(...directionValue);
  if (length <= EPSILON) throw new TypeError("Surface ray direction cannot be zero");
  return { origin, direction: directionValue.map((entry) => entry / length) };
}

function intersectAabb(origin, direction, minimum, maximum, maximumDistance) {
  let near = 0;
  let far = maximumDistance;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(direction[axis]) <= EPSILON) {
      if (origin[axis] < minimum[axis] || origin[axis] > maximum[axis]) return null;
      continue;
    }
    const inverse = 1 / direction[axis];
    let left = (minimum[axis] - origin[axis]) * inverse;
    let right = (maximum[axis] - origin[axis]) * inverse;
    if (left > right) [left, right] = [right, left];
    near = Math.max(near, left);
    far = Math.min(far, right);
    if (near > far) return null;
  }
  return near;
}

function intersectTriangle(origin, direction, positions, triangle, backface) {
  const offset = triangle * 9;
  const a = [positions[offset], positions[offset + 1], positions[offset + 2]];
  const b = [positions[offset + 3], positions[offset + 4], positions[offset + 5]];
  const c = [positions[offset + 6], positions[offset + 7], positions[offset + 8]];
  const edge1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const edge2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p = [
    direction[1] * edge2[2] - direction[2] * edge2[1],
    direction[2] * edge2[0] - direction[0] * edge2[2],
    direction[0] * edge2[1] - direction[1] * edge2[0],
  ];
  const determinant = edge1[0] * p[0] + edge1[1] * p[1] + edge1[2] * p[2];
  if (Math.abs(determinant) <= EPSILON) return null;
  const inverse = 1 / determinant;
  const t = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
  const u = (t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) * inverse;
  if (u < -EPSILON || u > 1 + EPSILON) return null;
  const q = [
    t[1] * edge1[2] - t[2] * edge1[1],
    t[2] * edge1[0] - t[0] * edge1[2],
    t[0] * edge1[1] - t[1] * edge1[0],
  ];
  const v = (direction[0] * q[0] + direction[1] * q[1] + direction[2] * q[2]) * inverse;
  if (v < -EPSILON || u + v > 1 + EPSILON) return null;
  const distance = (edge2[0] * q[0] + edge2[1] * q[1] + edge2[2] * q[2]) * inverse;
  if (distance < 0) return null;
  const normalValue = [
    edge1[1] * edge2[2] - edge1[2] * edge2[1],
    edge1[2] * edge2[0] - edge1[0] * edge2[2],
    edge1[0] * edge2[1] - edge1[1] * edge2[0],
  ];
  const normalLength = Math.hypot(...normalValue);
  if (normalLength <= EPSILON) return null;
  const geometricNormal = normalValue.map((entry) => entry / normalLength);
  const facing = geometricNormal[0] * direction[0] + geometricNormal[1] * direction[1] + geometricNormal[2] * direction[2];
  const backFacing = facing > 0;
  if (backface === "front" && backFacing) return null;
  if (backface === "back" && !backFacing) return null;
  const normal = backFacing ? geometricNormal.map((entry) => -entry) : geometricNormal;
  return { distance, normal, backFacing };
}

function boundedRayError(code, message, details) {
  return Object.freeze({ ok: false, hit: null, error: Object.freeze({ code, message, details: Object.freeze({ ...details }) }) });
}

export function raycastRiggingSurface(index, rayValue, options = {}) {
  if (!index || index.destroyed) throw new RigSurfaceIndexError("rig/surface-destroyed", "Surface index is unavailable or destroyed");
  const ray = normalizeRay(rayValue);
  const backface = ["double", "front", "back"].includes(options.backface) ? options.backface : "double";
  const maximumDistance = Number.isFinite(options.maximumDistance) && options.maximumDistance > 0 ? options.maximumDistance : Infinity;
  const maximumRayNodes = positiveInteger(options.maximumRayNodes, index.limits.maximumRayNodes, "maximumRayNodes");
  const maximumRayTriangles = positiveInteger(options.maximumRayTriangles, index.limits.maximumRayTriangles, "maximumRayTriangles");
  const offset = Number.isFinite(options.offset) ? options.offset : 0;
  const stack = [0];
  let nodeTests = 0;
  let triangleTests = 0;
  let best = null;
  while (stack.length) {
    const node = stack.pop();
    nodeTests += 1;
    if (nodeTests > maximumRayNodes) {
      return boundedRayError("rig/surface-ray-node-limit", "Surface raycast exceeded its bounded BVH node limit", {
        maximumRayNodes,
        triangleTests,
      });
    }
    const nodeOffset = node * 3;
    const near = intersectAabb(ray.origin, ray.direction,
      [index.nodeMin[nodeOffset], index.nodeMin[nodeOffset + 1], index.nodeMin[nodeOffset + 2]],
      [index.nodeMax[nodeOffset], index.nodeMax[nodeOffset + 1], index.nodeMax[nodeOffset + 2]],
      Math.min(maximumDistance, best?.distance ?? Infinity));
    if (near === null) continue;
    const count = index.nodeCount[node];
    if (count) {
      const start = index.nodeStart[node];
      for (let position = start; position < start + count; position += 1) {
        triangleTests += 1;
        if (triangleTests > maximumRayTriangles) {
          return boundedRayError("rig/surface-ray-triangle-limit", "Surface raycast exceeded its bounded triangle limit", {
            maximumRayTriangles,
            nodeTests,
          });
        }
        const triangle = index.order[position];
        const hit = intersectTriangle(ray.origin, ray.direction, index.positions, triangle, backface);
        if (!hit || hit.distance > maximumDistance || (best && hit.distance >= best.distance)) continue;
        best = { ...hit, triangle };
      }
      continue;
    }
    const left = index.nodeLeft[node];
    const right = index.nodeRight[node];
    if (left < 0 || right < 0) continue;
    const childNear = (child) => {
      const childOffset = child * 3;
      return intersectAabb(ray.origin, ray.direction,
        [index.nodeMin[childOffset], index.nodeMin[childOffset + 1], index.nodeMin[childOffset + 2]],
        [index.nodeMax[childOffset], index.nodeMax[childOffset + 1], index.nodeMax[childOffset + 2]],
        Math.min(maximumDistance, best?.distance ?? Infinity));
    };
    const leftNear = childNear(left);
    const rightNear = childNear(right);
    if (leftNear !== null && rightNear !== null) {
      if (leftNear <= rightNear) { stack.push(right); stack.push(left); }
      else { stack.push(left); stack.push(right); }
    } else if (leftNear !== null) stack.push(left);
    else if (rightNear !== null) stack.push(right);
  }
  if (!best) {
    return Object.freeze({
      ok: true,
      hit: null,
      stats: Object.freeze({ nodeTests, triangleTests }),
    });
  }
  const metadataOffset = best.triangle * 4;
  const point = ray.origin.map((entry, axis) => entry + ray.direction[axis] * best.distance);
  const adjusted = point.map((entry, axis) => entry + best.normal[axis] * offset);
  return Object.freeze({
    ok: true,
    hit: Object.freeze({
      point: Object.freeze(adjusted),
      normal: Object.freeze([...best.normal]),
      distance: best.distance,
      backFacing: best.backFacing,
      nodeIndex: index.metadata[metadataOffset],
      meshIndex: index.metadata[metadataOffset + 1],
      primitiveIndex: index.metadata[metadataOffset + 2],
      triangleIndex: index.metadata[metadataOffset + 3],
    }),
    stats: Object.freeze({ nodeTests, triangleTests }),
  });
}

export function surfaceIndexEvidence(index) {
  if (!index) return Object.freeze({
    provider: Object.freeze({ id: RIG_SURFACE_INDEX_PROVIDER_ID, version: RIG_SURFACE_INDEX_PROVIDER_VERSION }),
    status: "unprepared",
    triangles: 0,
    bvhNodes: 0,
  });
  if (index.destroyed) return Object.freeze({
    provider: Object.freeze({ id: RIG_SURFACE_INDEX_PROVIDER_ID, version: RIG_SURFACE_INDEX_PROVIDER_VERSION }),
    status: "destroyed",
    triangles: 0,
    bvhNodes: 0,
  });
  return index.evidence;
}

export function destroyRiggingSurfaceIndex(index) {
  if (!index || index.destroyed) return false;
  for (const key of ["positions", "metadata", "triangleBounds", "centroids", "order", "nodeMin", "nodeMax", "nodeLeft", "nodeRight", "nodeStart", "nodeCount"]) {
    index[key]?.fill?.(0);
  }
  index.destroyed = true;
  index.evidence = surfaceIndexEvidence(index);
  return true;
}
