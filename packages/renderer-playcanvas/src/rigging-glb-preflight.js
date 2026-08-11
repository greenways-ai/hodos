import { createRiggingPreflight } from "@greenways/hodos-world-model/rigging";

export const GLB_MAGIC = 0x46546c67;
export const GLB_JSON_CHUNK = 0x4e4f534a;
export const GLB_BIN_CHUNK = 0x004e4942;
export const GLB_PREFLIGHT_PROVIDER_ID = "playcanvas/glb-preflight";
export const GLB_PREFLIGHT_PROVIDER_VERSION = "0-alpha.1";

const DEFAULT_LIMITS = Object.freeze({
  maximumBytes: 512 * 1024 * 1024,
  maximumJsonBytes: 16 * 1024 * 1024,
  maximumInventoryItems: 64,
  maximumIssues: 64,
  maximumPositionVertices: 5_000_000,
  maximumTopologyVertices: 300_000,
  maximumTopologyTriangles: 500_000,
  maximumTopologyEdges: 1_500_000,
  maximumSkinVertices: 500_000,
  minimumScale: 1e-4,
  maximumScale: 1e4,
});

const COMPONENT_TYPES = Object.freeze({
  5120: { bytes: 1, read: (view, offset) => view.getInt8(offset), min: -128, max: 127, signed: true },
  5121: { bytes: 1, read: (view, offset) => view.getUint8(offset), min: 0, max: 255, signed: false },
  5122: { bytes: 2, read: (view, offset) => view.getInt16(offset, true), min: -32768, max: 32767, signed: true },
  5123: { bytes: 2, read: (view, offset) => view.getUint16(offset, true), min: 0, max: 65535, signed: false },
  5125: { bytes: 4, read: (view, offset) => view.getUint32(offset, true), min: 0, max: 4294967295, signed: false },
  5126: { bytes: 4, read: (view, offset) => view.getFloat32(offset, true), min: null, max: null, signed: true },
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

const PRIMITIVE_MODES = Object.freeze({
  0: "POINTS",
  1: "LINES",
  2: "LINE_LOOP",
  3: "LINE_STRIP",
  4: "TRIANGLES",
  5: "TRIANGLE_STRIP",
  6: "TRIANGLE_FAN",
});

const EPSILON = 1e-6;

export class GlbPreflightError extends Error {
  constructor(code, message, { path = "$", details = null } = {}) {
    super(message);
    this.name = "GlbPreflightError";
    this.code = code;
    this.path = path;
    this.details = details;
  }
}

export function toUint8Array(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError("GLB input must be an ArrayBuffer or typed-array view");
}

export async function sha256ContentId(value) {
  const bytes = toUint8Array(value);
  if (!globalThis.crypto?.subtle) throw new GlbPreflightError("crypto/unavailable", "Web Crypto SHA-256 is unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((entry) => entry.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

function normalizeLimits(value = {}) {
  const result = {};
  for (const [key, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const candidate = value[key] ?? fallback;
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate <= 0) {
      throw new TypeError(`${key} must be a positive finite number`);
    }
    result[key] = candidate;
  }
  result.maximumInventoryItems = Math.max(1, Math.floor(result.maximumInventoryItems));
  result.maximumIssues = Math.max(1, Math.floor(result.maximumIssues));
  result.maximumBytes = Math.floor(result.maximumBytes);
  result.maximumJsonBytes = Math.floor(result.maximumJsonBytes);
  result.maximumPositionVertices = Math.floor(result.maximumPositionVertices);
  result.maximumTopologyVertices = Math.floor(result.maximumTopologyVertices);
  result.maximumTopologyTriangles = Math.floor(result.maximumTopologyTriangles);
  result.maximumTopologyEdges = Math.floor(result.maximumTopologyEdges);
  result.maximumSkinVertices = Math.floor(result.maximumSkinVertices);
  if (result.minimumScale >= result.maximumScale) throw new TypeError("minimumScale must be smaller than maximumScale");
  return Object.freeze(result);
}

function boundedText(value, fallback = "", maximumLength = 256) {
  const text = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return text.length > maximumLength ? `${text.slice(0, maximumLength - 1)}…` : text;
}

function plainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeIndex(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function createIssueCollector(maximumIssues) {
  const issues = [];
  const totals = { error: 0, warning: 0, info: 0 };
  const seen = new Set();
  return {
    add(code, severity, path, message, details = null, onceKey = null) {
      if (!Object.hasOwn(totals, severity)) throw new TypeError(`Unsupported issue severity: ${severity}`);
      if (onceKey && seen.has(onceKey)) return;
      if (onceKey) seen.add(onceKey);
      totals[severity] += 1;
      if (issues.length < maximumIssues) {
        const issue = { code, severity, path, message };
        if (details !== null) issue.details = details;
        issues.push(issue);
      }
    },
    finish() {
      return {
        issues,
        summary: {
          errors: totals.error,
          warnings: totals.warning,
          info: totals.info,
          omittedIssues: Math.max(0, totals.error + totals.warning + totals.info - issues.length),
        },
      };
    },
  };
}

export function parseGlbContainer(input, options = {}) {
  const limits = normalizeLimits(options);
  const bytes = toUint8Array(input);
  if (bytes.byteLength < 12) {
    throw new GlbPreflightError("glb/too-small", "GLB is shorter than its 12-byte header", {
      details: { byteLength: bytes.byteLength },
    });
  }
  if (bytes.byteLength > limits.maximumBytes) {
    throw new GlbPreflightError("glb/byte-limit", `GLB exceeds the bounded limit of ${limits.maximumBytes} bytes`, {
      details: { byteLength: bytes.byteLength, maximumBytes: limits.maximumBytes },
    });
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const declaredLength = view.getUint32(8, true);
  if (magic !== GLB_MAGIC) throw new GlbPreflightError("glb/magic", "Input does not contain a glTF binary header");
  if (version !== 2) throw new GlbPreflightError("glb/version", `Unsupported GLB version: ${version}`, { details: { version } });
  if (declaredLength !== bytes.byteLength) {
    throw new GlbPreflightError("glb/length", "GLB declared length does not match the local byte length", {
      details: { declaredLength, byteLength: bytes.byteLength },
    });
  }

  const chunks = [];
  let offset = 12;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new GlbPreflightError("glb/chunk-header", "GLB ends inside a chunk header", { details: { offset } });
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (length % 4 !== 0) {
      throw new GlbPreflightError("glb/chunk-alignment", "GLB chunk length must be aligned to four bytes", {
        details: { offset, length },
      });
    }
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.byteLength) {
      throw new GlbPreflightError("glb/chunk-length", "GLB chunk exceeds the declared container length", {
        details: { offset, length, remaining: bytes.byteLength - start },
      });
    }
    chunks.push({ type, length, start, end, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset + start, length) });
    offset = end;
  }

  const jsonChunks = chunks.filter(({ type }) => type === GLB_JSON_CHUNK);
  if (chunks[0]?.type !== GLB_JSON_CHUNK) {
    throw new GlbPreflightError("glb/json-order", "The GLB JSON chunk must be the first chunk");
  }
  if (jsonChunks.length !== 1) {
    throw new GlbPreflightError("glb/json-chunk", "GLB must contain exactly one JSON chunk", {
      details: { count: jsonChunks.length },
    });
  }
  const jsonChunk = jsonChunks[0];
  if (jsonChunk.length > limits.maximumJsonBytes) {
    throw new GlbPreflightError("glb/json-limit", `GLB JSON exceeds the bounded limit of ${limits.maximumJsonBytes} bytes`, {
      details: { byteLength: jsonChunk.length, maximumJsonBytes: limits.maximumJsonBytes },
    });
  }
  let document;
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(jsonChunk.bytes).replace(/[\u0000\u0020]+$/u, "");
    document = JSON.parse(source);
  } catch (error) {
    throw new GlbPreflightError("glb/json", `Unable to parse the GLB JSON chunk: ${error.message}`);
  }
  if (!plainObject(document)) throw new GlbPreflightError("gltf/document", "glTF JSON root must be an object");
  const binaryChunks = chunks.filter(({ type }) => type === GLB_BIN_CHUNK);
  return Object.freeze({
    bytes,
    version,
    declaredLength,
    document,
    jsonChunkBytes: jsonChunk.length,
    binaryChunk: binaryChunks[0]?.bytes ?? null,
    binaryChunkBytes: binaryChunks[0]?.length ?? 0,
    additionalBinaryChunks: Math.max(0, binaryChunks.length - 1),
    unknownChunks: chunks.filter(({ type }) => type !== GLB_JSON_CHUNK && type !== GLB_BIN_CHUNK)
      .map(({ type, length }) => ({ type, length })),
  });
}

function normalizedInteger(value, component) {
  if (component.min === 0) return value / component.max;
  return Math.max(value / component.max, -1);
}

function createAccessorContext(document, binaryChunk, collector) {
  const accessors = safeArray(document.accessors);
  const bufferViews = safeArray(document.bufferViews);
  const buffers = safeArray(document.buffers);
  const cache = new Map();
  const binaryView = binaryChunk
    ? new DataView(binaryChunk.buffer, binaryChunk.byteOffset, binaryChunk.byteLength)
    : null;

  function descriptor(index, path = `$.accessors[${index}]`) {
    if (cache.has(index)) return cache.get(index);
    if (!Number.isSafeInteger(index) || index < 0 || index >= accessors.length) {
      collector.add("accessor/index", "error", path, `Accessor index is out of range: ${index}`);
      return null;
    }
    const accessor = accessors[index];
    if (!plainObject(accessor)) {
      collector.add("accessor/object", "error", path, "Accessor must be an object");
      return null;
    }
    const component = COMPONENT_TYPES[accessor.componentType];
    const components = ACCESSOR_COMPONENTS[accessor.type];
    const count = safeIndex(accessor.count);
    if (!component) collector.add("accessor/component-type", "error", `${path}.componentType`, `Unsupported component type: ${accessor.componentType}`);
    if (!components) collector.add("accessor/type", "error", `${path}.type`, `Unsupported accessor type: ${accessor.type}`);
    if (count === null) collector.add("accessor/count", "error", `${path}.count`, "Accessor count must be a non-negative safe integer");
    if (!component || !components || count === null) return null;

    const elementBytes = component.bytes * components;
    const sparse = accessor.sparse !== undefined;
    if (sparse) {
      collector.add("accessor/sparse", "warning", `${path}.sparse`, "Sparse accessors are inventoried but not expanded during bounded preflight", null, `sparse:${index}`);
    }

    let zero = false;
    let readable = false;
    let offset = 0;
    let stride = elementBytes;
    let viewIndex = null;
    if (accessor.bufferView === undefined) {
      zero = true;
      readable = !sparse;
    } else {
      viewIndex = safeIndex(accessor.bufferView);
      if (viewIndex === null || viewIndex >= bufferViews.length || !plainObject(bufferViews[viewIndex])) {
        collector.add("accessor/buffer-view", "error", `${path}.bufferView`, "Accessor references an invalid buffer view");
      } else {
        const bufferView = bufferViews[viewIndex];
        const meshopt = bufferView.extensions?.EXT_meshopt_compression;
        if (meshopt) {
          collector.add("compression/meshopt", "error", `$.bufferViews[${viewIndex}].extensions.EXT_meshopt_compression`,
            "Meshopt-compressed buffer views require an installed decoder before geometry preflight", null, `meshopt:${viewIndex}`);
        }
        const bufferIndex = safeIndex(bufferView.buffer ?? 0);
        const buffer = bufferIndex === null ? null : buffers[bufferIndex];
        if (bufferIndex === null || !plainObject(buffer)) {
          collector.add("buffer-view/buffer", "error", `$.bufferViews[${viewIndex}].buffer`, "Buffer view references an invalid buffer");
        } else if (bufferIndex !== 0 || buffer.uri) {
          collector.add("buffer/external", "error", `$.buffers[${bufferIndex}]`, "Accessor data is not available in the local GLB binary chunk", {
            buffer: bufferIndex,
            uri: typeof buffer.uri === "string" ? boundedText(buffer.uri) : null,
          }, `external-buffer:${bufferIndex}`);
        } else if (!binaryView) {
          collector.add("glb/bin-missing", "error", "$", "GLB contains buffer views but no binary chunk", null, "missing-bin");
        } else {
          const viewOffset = safeIndex(bufferView.byteOffset ?? 0);
          const viewLength = safeIndex(bufferView.byteLength);
          const accessorOffset = safeIndex(accessor.byteOffset ?? 0);
          const candidateStride = safeIndex(bufferView.byteStride ?? elementBytes);
          if (viewOffset === null || viewLength === null || accessorOffset === null || candidateStride === null) {
            collector.add("accessor/offset", "error", path, "Accessor and buffer-view offsets must be non-negative safe integers");
          } else if (candidateStride < elementBytes || candidateStride % component.bytes !== 0) {
            collector.add("accessor/stride", "error", `$.bufferViews[${viewIndex}].byteStride`, "Buffer-view stride cannot contain the accessor element");
          } else {
            offset = viewOffset + accessorOffset;
            stride = candidateStride;
            const required = count === 0 ? 0 : accessorOffset + (count - 1) * stride + elementBytes;
            const bufferByteLength = safeIndex(buffer.byteLength);
            if (bufferByteLength === null) {
              collector.add("buffer/length", "error", `$.buffers[${bufferIndex}].byteLength`, "Buffer byteLength must be a non-negative safe integer");
            } else if (viewOffset + viewLength > bufferByteLength
              || required > viewLength
              || viewOffset + viewLength > binaryView.byteLength
              || offset + Math.max(0, required - accessorOffset) > binaryView.byteLength) {
              collector.add("accessor/range", "error", path, "Accessor exceeds its buffer-view or GLB binary range", {
                required,
                viewLength,
                binaryChunkBytes: binaryView.byteLength,
              });
            } else {
              readable = !sparse && !meshopt;
            }
          }
        }
      }
    }

    const result = Object.freeze({
      index,
      accessor,
      component,
      components,
      componentType: accessor.componentType,
      type: accessor.type,
      count,
      elementBytes,
      offset,
      stride,
      zero,
      sparse,
      readable,
      normalized: Boolean(accessor.normalized),
      min: Array.isArray(accessor.min) ? accessor.min : null,
      max: Array.isArray(accessor.max) ? accessor.max : null,
    });
    cache.set(index, result);
    return result;
  }

  function read(desc, elementIndex, componentIndex = 0, { normalized = desc?.normalized ?? false } = {}) {
    if (!desc || !desc.readable || elementIndex < 0 || elementIndex >= desc.count || componentIndex < 0 || componentIndex >= desc.components) return null;
    if (desc.zero) return 0;
    const byteOffset = desc.offset + elementIndex * desc.stride + componentIndex * desc.component.bytes;
    const value = desc.component.read(binaryView, byteOffset);
    return normalized && desc.componentType !== 5126 ? normalizedInteger(value, desc.component) : value;
  }

  function vector(desc, elementIndex, options) {
    if (!desc?.readable) return null;
    const result = [];
    for (let componentIndex = 0; componentIndex < desc.components; componentIndex += 1) {
      result.push(read(desc, elementIndex, componentIndex, options));
    }
    return result;
  }

  return Object.freeze({ descriptor, read, vector, accessorCount: accessors.length });
}

function identityMatrix() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiplyMatrices(left, right) {
  const result = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let inner = 0; inner < 4; inner += 1) {
        result[column * 4 + row] += left[inner * 4 + row] * right[column * 4 + inner];
      }
    }
  }
  return result;
}

function matrixFromTrs(node, path, collector) {
  const translation = Array.isArray(node.translation) && node.translation.length === 3 ? node.translation : [0, 0, 0];
  const rotation = Array.isArray(node.rotation) && node.rotation.length === 4 ? node.rotation : [0, 0, 0, 1];
  const scale = Array.isArray(node.scale) && node.scale.length === 3 ? node.scale : [1, 1, 1];
  const values = [...translation, ...rotation, ...scale];
  if (!values.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    collector.add("node/transform-non-finite", "error", path, "Node transform contains non-finite values");
    return { matrix: identityMatrix(), scale: [1, 1, 1], negative: false };
  }
  const length = Math.hypot(...rotation);
  if (length <= Number.EPSILON) {
    collector.add("node/quaternion", "error", `${path}.rotation`, "Node rotation quaternion cannot be zero");
    return { matrix: identityMatrix(), scale: [1, 1, 1], negative: false };
  }
  if (Math.abs(length - 1) > 1e-3) {
    collector.add("node/quaternion-normalization", "warning", `${path}.rotation`, "Node rotation quaternion is not normalized", { length });
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
  return {
    matrix: [
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
    ],
    scale: [...scale],
    negative: sx * sy * sz < 0,
  };
}

function scaleFromMatrix(matrix) {
  const scale = [
    Math.hypot(matrix[0], matrix[1], matrix[2]),
    Math.hypot(matrix[4], matrix[5], matrix[6]),
    Math.hypot(matrix[8], matrix[9], matrix[10]),
  ];
  const determinant =
    matrix[0] * (matrix[5] * matrix[10] - matrix[6] * matrix[9])
    - matrix[4] * (matrix[1] * matrix[10] - matrix[2] * matrix[9])
    + matrix[8] * (matrix[1] * matrix[6] - matrix[2] * matrix[5]);
  return { scale, negative: determinant < 0 };
}

function nodeLocalMatrix(node, index, collector) {
  const path = `$.nodes[${index}]`;
  if (Array.isArray(node.matrix)) {
    if (node.matrix.length !== 16 || !node.matrix.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
      collector.add("node/matrix", "error", `${path}.matrix`, "Node matrix must contain 16 finite numbers");
      return { matrix: identityMatrix(), scale: [1, 1, 1], negative: false, kind: "matrix" };
    }
    const matrix = [...node.matrix];
    return { matrix, ...scaleFromMatrix(matrix), kind: "matrix" };
  }
  return { ...matrixFromTrs(node, path, collector), kind: "trs" };
}

function isIdentityMatrix(matrix) {
  const identity = identityMatrix();
  return matrix.every((entry, index) => Math.abs(entry - identity[index]) <= EPSILON);
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

function createBounds() {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let points = 0;
  return {
    add(point) {
      if (!point.every(Number.isFinite)) return false;
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
      points += 1;
      return true;
    },
    addBounds(bounds, matrix = identityMatrix()) {
      if (!bounds) return;
      const { min: localMin, max: localMax } = bounds;
      for (const x of [localMin[0], localMax[0]]) {
        for (const y of [localMin[1], localMax[1]]) {
          for (const z of [localMin[2], localMax[2]]) this.add(transformPoint(matrix, [x, y, z]));
        }
      }
    },
    finish() {
      if (!points) return null;
      return {
        min: [...min],
        max: [...max],
        center: min.map((entry, axis) => (entry + max[axis]) / 2),
        size: min.map((entry, axis) => max[axis] - entry),
      };
    },
  };
}

function accessorDeclaredBounds(desc) {
  if (!desc || !Array.isArray(desc.min) || !Array.isArray(desc.max) || desc.min.length < 3 || desc.max.length < 3) return null;
  const min = desc.min.slice(0, 3);
  const max = desc.max.slice(0, 3);
  return min.every(Number.isFinite) && max.every(Number.isFinite) && min.every((entry, axis) => entry <= max[axis])
    ? { min, max }
    : null;
}

function scanPositionBounds(desc, path, accessors, collector, limits, { forceDeclared = false } = {}) {
  if (!desc) return null;
  if (desc.type !== "VEC3" || desc.componentType !== 5126) {
    collector.add("position/accessor", "error", path, "POSITION accessor must be a floating-point VEC3");
  }
  if (!desc.count) return null;
  if (forceDeclared || !desc.readable || desc.count > limits.maximumPositionVertices) {
    const declared = accessorDeclaredBounds(desc);
    if (declared) {
      if (forceDeclared) {
        collector.add("position/compressed-bounds", "warning", path, "Position bounds were taken from accessor metadata because compressed geometry was not decoded");
      } else if (desc.count > limits.maximumPositionVertices) {
        collector.add("position/scan-bounded", "warning", path, "Position scan used declared accessor bounds because the vertex count exceeded the bounded scan limit", {
          count: desc.count,
          maximumPositionVertices: limits.maximumPositionVertices,
        });
      }
      return declared;
    }
    collector.add("position/bounds-unavailable", "error", path, "Position data cannot be scanned and does not declare finite bounds");
    return null;
  }
  const bounds = createBounds();
  let nonFinite = 0;
  for (let index = 0; index < desc.count; index += 1) {
    const point = accessors.vector(desc, index, { normalized: false });
    if (!point || !point.slice(0, 3).every(Number.isFinite)) nonFinite += 1;
    else bounds.add(point.slice(0, 3));
  }
  if (nonFinite) collector.add("position/non-finite", "error", path, "Position accessor contains non-finite vertices", { count: nonFinite });
  return bounds.finish();
}

function primitiveElementCounts(mode, count) {
  switch (mode) {
    case 0: return { points: count, lines: 0, triangles: 0 };
    case 1: return { points: 0, lines: Math.floor(count / 2), triangles: 0 };
    case 2: return { points: 0, lines: count > 1 ? count : 0, triangles: 0 };
    case 3: return { points: 0, lines: Math.max(0, count - 1), triangles: 0 };
    case 4: return { points: 0, lines: 0, triangles: Math.floor(count / 3) };
    case 5:
    case 6: return { points: 0, lines: 0, triangles: Math.max(0, count - 2) };
    default: return { points: 0, lines: 0, triangles: 0 };
  }
}

function analyzeIndexedTopology({ indexDesc, vertexCount, path, accessors, collector, limits }) {
  if (!indexDesc || !indexDesc.readable || indexDesc.type !== "SCALAR" || ![5121, 5123, 5125].includes(indexDesc.componentType)) {
    collector.add("topology/index-accessor", "error", path, "Indexed triangle topology requires an unsigned scalar index accessor");
    return { checked: false, components: 0, nonManifoldEdges: 0, degenerateTriangles: 0 };
  }
  const triangleCount = Math.floor(indexDesc.count / 3);
  if (vertexCount > limits.maximumTopologyVertices || triangleCount > limits.maximumTopologyTriangles) {
    collector.add("topology/scan-bounded", "warning", path, "Topology scan was skipped because the mesh exceeded the bounded analysis profile", {
      vertexCount,
      triangleCount,
      maximumTopologyVertices: limits.maximumTopologyVertices,
      maximumTopologyTriangles: limits.maximumTopologyTriangles,
    });
    return { checked: false, components: 0, nonManifoldEdges: 0, degenerateTriangles: 0 };
  }

  const parent = new Uint32Array(vertexCount);
  const rank = new Uint8Array(vertexCount);
  const used = new Uint8Array(vertexCount);
  for (let index = 0; index < vertexCount; index += 1) parent[index] = index;
  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const union = (left, right) => {
    let rootLeft = find(left);
    let rootRight = find(right);
    if (rootLeft === rootRight) return;
    if (rank[rootLeft] < rank[rootRight]) [rootLeft, rootRight] = [rootRight, rootLeft];
    parent[rootRight] = rootLeft;
    if (rank[rootLeft] === rank[rootRight]) rank[rootLeft] += 1;
  };

  const edges = new Map();
  let invalidIndices = 0;
  let degenerateTriangles = 0;
  let edgeLimitReached = false;
  const addEdge = (left, right) => {
    if (edgeLimitReached) return;
    const minimum = Math.min(left, right);
    const maximum = Math.max(left, right);
    const key = `${minimum}:${maximum}`;
    if (!edges.has(key) && edges.size >= limits.maximumTopologyEdges) {
      edgeLimitReached = true;
      collector.add("topology/edge-limit", "warning", path, "Non-manifold edge counting stopped at the bounded edge limit", {
        maximumTopologyEdges: limits.maximumTopologyEdges,
      });
      return;
    }
    edges.set(key, (edges.get(key) ?? 0) + 1);
  };

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const indices = [0, 1, 2].map((component) => accessors.read(indexDesc, triangle * 3 + component, 0, { normalized: false }));
    if (indices.some((entry) => !Number.isSafeInteger(entry) || entry < 0 || entry >= vertexCount)) {
      invalidIndices += 1;
      continue;
    }
    const [a, b, c] = indices;
    used[a] = 1; used[b] = 1; used[c] = 1;
    if (a === b || b === c || c === a) degenerateTriangles += 1;
    union(a, b); union(b, c); union(c, a);
    addEdge(a, b); addEdge(b, c); addEdge(c, a);
  }
  if (invalidIndices) collector.add("topology/index-range", "error", path, "Triangle indices reference vertices outside the POSITION accessor", { triangles: invalidIndices });
  if (degenerateTriangles) collector.add("topology/degenerate", "warning", path, "Mesh contains degenerate indexed triangles", { triangles: degenerateTriangles });
  const roots = new Set();
  for (let index = 0; index < vertexCount; index += 1) if (used[index]) roots.add(find(index));
  const components = roots.size;
  const nonManifoldEdges = [...edges.values()].filter((count) => count > 2).length;
  if (components > 1) collector.add("mesh/disconnected-components", "warning", path, "Indexed primitive contains disconnected vertex components", { components });
  if (nonManifoldEdges) collector.add("mesh/non-manifold-hint", "warning", path, "Indexed triangle edges suggest non-manifold geometry", { edges: nonManifoldEdges });
  return { checked: true, components, nonManifoldEdges, degenerateTriangles };
}

function buildNodeState(document, collector, limits) {
  const nodes = safeArray(document.nodes);
  const parents = new Array(nodes.length).fill(null);
  const local = nodes.map((node, index) => {
    if (!plainObject(node)) collector.add("node/object", "error", `$.nodes[${index}]`, "Node must be an object");
    return nodeLocalMatrix(plainObject(node) ? node : {}, index, collector);
  });
  for (let index = 0; index < nodes.length; index += 1) {
    const node = plainObject(nodes[index]) ? nodes[index] : {};
    for (const child of safeArray(node.children)) {
      if (!Number.isSafeInteger(child) || child < 0 || child >= nodes.length) {
        collector.add("node/child", "error", `$.nodes[${index}].children`, `Node references an invalid child: ${child}`);
      } else if (parents[child] !== null && parents[child] !== index) {
        collector.add("node/multiple-parents", "error", `$.nodes[${child}]`, "glTF node is referenced by more than one parent", {
          firstParent: parents[child],
          secondParent: index,
        });
      } else {
        parents[child] = index;
      }
    }
  }

  const world = new Array(nodes.length);
  const visiting = new Set();
  const resolve = (index) => {
    if (world[index]) return world[index];
    if (visiting.has(index)) {
      collector.add("node/cycle", "error", `$.nodes[${index}]`, "Node hierarchy contains a cycle", null, `node-cycle:${index}`);
      return local[index].matrix;
    }
    visiting.add(index);
    const parent = parents[index];
    const result = parent === null ? local[index].matrix : multiplyMatrices(resolve(parent), local[index].matrix);
    visiting.delete(index);
    world[index] = result;
    return result;
  };
  for (let index = 0; index < nodes.length; index += 1) resolve(index);

  const summary = { matrixNodes: 0, trsNodes: 0, nonIdentityNodes: 0, negativeScaleNodes: 0, extremeScaleNodes: 0 };
  local.forEach((entry, index) => {
    summary[entry.kind === "matrix" ? "matrixNodes" : "trsNodes"] += 1;
    if (!isIdentityMatrix(entry.matrix)) summary.nonIdentityNodes += 1;
    if (entry.negative) summary.negativeScaleNodes += 1;
    if (entry.scale.some((scale) => Math.abs(scale) < limits.minimumScale || Math.abs(scale) > limits.maximumScale)) {
      summary.extremeScaleNodes += 1;
      collector.add("node/extreme-scale", "warning", `$.nodes[${index}]`, "Node scale is outside the default rigging range", {
        scale: entry.scale,
        minimumScale: limits.minimumScale,
        maximumScale: limits.maximumScale,
      });
    }
    if (entry.negative) collector.add("node/negative-scale", "warning", `$.nodes[${index}]`, "Node transform contains a reflected scale");
  });
  return { nodes, parents, local, world, summary };
}

function inspectExternalResources(document, collector) {
  let external = false;
  safeArray(document.buffers).forEach((buffer, index) => {
    if (plainObject(buffer) && typeof buffer.uri === "string" && buffer.uri) {
      external = true;
      const dataUri = buffer.uri.startsWith("data:");
      collector.add("buffer/external-uri", dataUri ? "warning" : "error", `$.buffers[${index}].uri`, dataUri
        ? "Data-URI buffer is outside the GLB binary chunk and is not expanded by preflight"
        : "External buffer URI cannot be resolved by a local-only GLB open", { uri: boundedText(buffer.uri) }, `buffer-uri:${index}`);
    }
  });
  safeArray(document.images).forEach((image, index) => {
    if (plainObject(image) && typeof image.uri === "string" && image.uri && !image.uri.startsWith("data:")) {
      external = true;
      collector.add("image/external-uri", "warning", `$.images[${index}].uri`, "External image URI will not be fetched by the local-only preflight", {
        uri: boundedText(image.uri),
      }, `image-uri:${index}`);
    }
  });
  return external;
}

function inspectSkins({ document, meshResults, nodeState, accessors, collector, limits }) {
  const skins = safeArray(document.skins);
  const items = [];
  let jointCount = 0;
  let malformedSkinPrimitives = 0;
  const maximumItems = limits.maximumInventoryItems;
  skins.forEach((skinValue, skinIndex) => {
    if (!plainObject(skinValue)) collector.add("skin/object", "error", `$.skins[${skinIndex}]`, "Skin must be an object");
    const skin = plainObject(skinValue) ? skinValue : {};
    const joints = safeArray(skin.joints);
    jointCount += joints.length;
    const seen = new Set();
    joints.forEach((joint, jointIndex) => {
      if (!Number.isSafeInteger(joint) || joint < 0 || joint >= nodeState.nodes.length) {
        collector.add("skin/joint", "error", `$.skins[${skinIndex}].joints[${jointIndex}]`, "Skin references an invalid joint node");
      } else if (seen.has(joint)) {
        collector.add("skin/duplicate-joint", "error", `$.skins[${skinIndex}].joints[${jointIndex}]`, "Skin contains the same joint more than once");
      } else seen.add(joint);
    });
    if (skin.skeleton !== undefined && (safeIndex(skin.skeleton) === null || skin.skeleton >= nodeState.nodes.length)) {
      collector.add("skin/skeleton", "error", `$.skins[${skinIndex}].skeleton`, "Skin skeleton root is invalid");
    }
    if (skin.inverseBindMatrices !== undefined) {
      const bind = accessors.descriptor(skin.inverseBindMatrices, `$.skins[${skinIndex}].inverseBindMatrices`);
      if (bind && (bind.type !== "MAT4" || bind.componentType !== 5126 || bind.count !== joints.length)) {
        collector.add("skin/inverse-bind-matrices", "error", `$.skins[${skinIndex}].inverseBindMatrices`, "Inverse bind matrices must be floating MAT4 values with one entry per joint", {
          count: bind.count,
          joints: joints.length,
          type: bind.type,
          componentType: bind.componentType,
        });
      }
    }
    if (items.length < maximumItems) {
      items.push({
        index: skinIndex,
        name: boundedText(skin.name, `Skin ${skinIndex + 1}`),
        joints: joints.length,
        skeleton: safeIndex(skin.skeleton),
        inverseBindMatrices: safeIndex(skin.inverseBindMatrices),
      });
    }
  });
  if (skins.length) collector.add("skin/existing", "info", "$.skins", "Asset already contains one or more skins; opening does not overwrite them", { count: skins.length }, "existing-skins");

  const checked = new Set();
  nodeState.nodes.forEach((nodeValue, nodeIndex) => {
    const node = plainObject(nodeValue) ? nodeValue : {};
    const skinIndex = safeIndex(node.skin);
    const meshIndex = safeIndex(node.mesh);
    if (skinIndex === null) return;
    if (skinIndex >= skins.length) {
      collector.add("node/skin", "error", `$.nodes[${nodeIndex}].skin`, "Node references an invalid skin");
      return;
    }
    if (meshIndex === null || meshIndex >= meshResults.length) {
      collector.add("node/skinned-mesh", "error", `$.nodes[${nodeIndex}]`, "Skinned node does not reference a valid mesh");
      return;
    }
    const key = `${meshIndex}:${skinIndex}`;
    if (checked.has(key)) return;
    checked.add(key);
    const skin = plainObject(skins[skinIndex]) ? skins[skinIndex] : {};
    const jointLimit = safeArray(skin.joints).length;
    const mesh = meshResults[meshIndex];
    mesh.primitives.forEach((primitiveResult, primitiveIndex) => {
      const primitive = primitiveResult.source;
      const path = `$.meshes[${meshIndex}].primitives[${primitiveIndex}]`;
      const attributes = plainObject(primitive.attributes) ? primitive.attributes : {};
      const jointsIndex = safeIndex(attributes.JOINTS_0);
      const weightsIndex = safeIndex(attributes.WEIGHTS_0);
      let malformed = false;
      if (jointsIndex === null || weightsIndex === null) {
        collector.add("skin/attributes-missing", "error", `${path}.attributes`, "Skinned primitive requires both JOINTS_0 and WEIGHTS_0 attributes");
        malformed = true;
      } else {
        const joints = accessors.descriptor(jointsIndex, `${path}.attributes.JOINTS_0`);
        const weights = accessors.descriptor(weightsIndex, `${path}.attributes.WEIGHTS_0`);
        const positionCount = primitiveResult.vertexCount;
        if (!joints || !weights
          || joints.type !== "VEC4"
          || ![5121, 5123].includes(joints.componentType)
          || weights.type !== "VEC4"
          || ![5121, 5123, 5126].includes(weights.componentType)
          || joints.count !== positionCount
          || weights.count !== positionCount) {
          collector.add("skin/attributes", "error", `${path}.attributes`, "Skin attributes must be matching VEC4 accessors with one entry per vertex", {
            vertices: positionCount,
            joints: joints ? { type: joints.type, componentType: joints.componentType, count: joints.count } : null,
            weights: weights ? { type: weights.type, componentType: weights.componentType, count: weights.count } : null,
          });
          malformed = true;
        } else {
          if (joints.normalized) {
            collector.add("skin/joints-normalized", "error", `${path}.attributes.JOINTS_0`, "JOINTS_0 accessor must not be normalized");
            malformed = true;
          }
          if (weights.componentType !== 5126 && !weights.normalized) {
            collector.add("skin/weights-normalized", "error", `${path}.attributes.WEIGHTS_0`,
              "Integer WEIGHTS_0 accessor must declare normalized=true");
            malformed = true;
          }
          if (joints.readable && weights.readable) {
            const count = Math.min(positionCount, limits.maximumSkinVertices);
          let nonNormalized = 0;
          let invalidJoint = 0;
          let invalidWeight = 0;
          for (let vertex = 0; vertex < count; vertex += 1) {
            const jointValues = accessors.vector(joints, vertex, { normalized: false });
            const weightValues = accessors.vector(weights, vertex, { normalized: weights.normalized || weights.componentType !== 5126 });
            if (!jointValues || !weightValues || weightValues.some((entry) => !Number.isFinite(entry) || entry < 0)) {
              invalidWeight += 1;
              continue;
            }
            const sum = weightValues.reduce((total, entry) => total + entry, 0);
            if (Math.abs(sum - 1) > 1e-3) nonNormalized += 1;
            if (jointValues.some((entry, influence) => weightValues[influence] > EPSILON
              && (!Number.isSafeInteger(entry) || entry < 0 || entry >= jointLimit))) invalidJoint += 1;
          }
          if (positionCount > limits.maximumSkinVertices) {
            collector.add("skin/scan-bounded", "warning", path, "Skin validation was bounded to a prefix of the vertex stream", {
              vertices: positionCount,
              checked: limits.maximumSkinVertices,
            });
          }
          if (invalidWeight) collector.add("skin/weight-values", "error", path, "Skin contains invalid or negative weight values", { vertices: invalidWeight });
          if (nonNormalized) collector.add("skin/non-normalized", "error", path, "Skin weights do not normalize to one", { vertices: nonNormalized });
            if (invalidJoint) collector.add("skin/joint-range", "error", path, "Skin contains joint indices outside the referenced skin", { vertices: invalidJoint });
            malformed ||= invalidWeight > 0 || nonNormalized > 0 || invalidJoint > 0;
          }
        }
      }
      if ((attributes.JOINTS_1 === undefined) !== (attributes.WEIGHTS_1 === undefined)) {
        collector.add("skin/secondary-attributes", "error", `${path}.attributes`, "JOINTS_1 and WEIGHTS_1 must occur together");
        malformed = true;
      } else if (attributes.JOINTS_1 !== undefined) {
        collector.add("skin/influence-overflow", "warning", `${path}.attributes`, "Primitive contains more than the four influences accepted by the first rigging export profile");
      }
      if (malformed) malformedSkinPrimitives += 1;
    });
  });
  return {
    inventory: { count: skins.length, joints: jointCount, items, omitted: Math.max(0, skins.length - items.length) },
    malformedSkinPrimitives,
  };
}

function inspectAnimations(document, nodeCount, collector, maximumItems) {
  const animations = safeArray(document.animations);
  let channels = 0;
  let samplers = 0;
  const items = [];
  animations.forEach((animationValue, animationIndex) => {
    if (!plainObject(animationValue)) collector.add("animation/object", "error", `$.animations[${animationIndex}]`, "Animation must be an object");
    const animation = plainObject(animationValue) ? animationValue : {};
    const animationChannels = safeArray(animation.channels);
    const animationSamplers = safeArray(animation.samplers);
    channels += animationChannels.length;
    samplers += animationSamplers.length;
    animationChannels.forEach((channelValue, channelIndex) => {
      const channel = plainObject(channelValue) ? channelValue : {};
      if (!Number.isSafeInteger(channel.sampler) || channel.sampler < 0 || channel.sampler >= animationSamplers.length) {
        collector.add("animation/sampler", "error", `$.animations[${animationIndex}].channels[${channelIndex}].sampler`, "Animation channel references an invalid sampler");
      }
      const targetNode = channel.target?.node;
      if (targetNode !== undefined && (!Number.isSafeInteger(targetNode) || targetNode < 0 || targetNode >= nodeCount)) {
        collector.add("animation/target", "error", `$.animations[${animationIndex}].channels[${channelIndex}].target.node`, "Animation channel references an invalid node");
      }
    });
    if (items.length < maximumItems) {
      items.push({
        index: animationIndex,
        name: boundedText(animation.name, `Animation ${animationIndex + 1}`),
        channels: animationChannels.length,
        samplers: animationSamplers.length,
      });
    }
  });
  return { count: animations.length, channels, samplers, items, omitted: Math.max(0, animations.length - items.length) };
}

function analyzeDocument(container, contentId, options) {
  const limits = normalizeLimits(options);
  const collector = createIssueCollector(limits.maximumIssues);
  const document = container.document;
  if (!plainObject(document.asset)) collector.add("gltf/asset", "error", "$.asset", "glTF document requires an asset object");
  const asset = plainObject(document.asset) ? document.asset : {};
  const version = typeof asset.version === "string" ? Number.parseInt(asset.version.split(".")[0], 10) : NaN;
  if (version !== 2) collector.add("gltf/version", "error", "$.asset.version", "glTF asset version must be 2.x", { version: asset.version ?? null });
  for (const key of ["scenes", "nodes", "meshes", "materials", "skins", "animations", "buffers", "bufferViews", "accessors", "images"]) {
    if (document[key] !== undefined && !Array.isArray(document[key])) {
      collector.add("gltf/array", "error", `$.${key}`, `${key} must be an array`);
    }
  }
  const extensionsUsed = safeArray(document.extensionsUsed).filter((entry) => typeof entry === "string");
  if (extensionsUsed.includes("KHR_draco_mesh_compression")) {
    collector.add("compression/draco-required", "error", "$.extensionsUsed",
      "Draco-compressed geometry requires an installed decoder for complete rigging preflight", null, "draco-required");
  }
  if (extensionsUsed.includes("EXT_meshopt_compression")) {
    collector.add("compression/meshopt-required", "error", "$.extensionsUsed",
      "Meshopt-compressed geometry requires an installed decoder for complete rigging preflight", null, "meshopt-required");
  }
  if (extensionsUsed.includes("KHR_mesh_quantization")) {
    collector.add("geometry/quantized", "info", "$.extensionsUsed",
      "Quantized geometry is recorded; unsupported POSITION component types remain visible as preflight issues", null, "quantized");
  }
  if (container.additionalBinaryChunks) collector.add("glb/multiple-bin", "warning", "$", "GLB contains additional binary chunks that are ignored", { count: container.additionalBinaryChunks });
  container.unknownChunks.forEach((chunk, index) => collector.add("glb/unknown-chunk", "info", `$.__chunks[${index}]`, "GLB contains an unknown extension chunk", chunk));

  const hasExternalResources = inspectExternalResources(document, collector);
  const accessors = createAccessorContext(document, container.binaryChunk, collector);
  const nodeState = buildNodeState(document, collector, limits);
  const meshes = safeArray(document.meshes);
  const materials = safeArray(document.materials);
  const materialReferences = new Set();
  const modeCounts = new Map();
  const geometry = {
    vertices: 0,
    indices: 0,
    triangles: 0,
    lines: 0,
    points: 0,
    connectedComponents: 0,
    disconnectedPrimitives: 0,
    topologyPrimitivesChecked: 0,
    topologyPrimitivesSkipped: 0,
    nonManifoldEdgeHints: 0,
    missingNormalPrimitives: 0,
    malformedSkinPrimitives: 0,
  };
  const features = {
    hasNormals: false,
    hasTangents: false,
    hasColors: false,
    hasTexcoords: false,
    hasMorphTargets: false,
    hasSkins: safeArray(document.skins).length > 0,
    hasAnimations: safeArray(document.animations).length > 0,
    hasExternalResources,
  };
  const meshResults = [];
  let primitiveCount = 0;

  meshes.forEach((meshValue, meshIndex) => {
    if (!plainObject(meshValue)) collector.add("mesh/object", "error", `$.meshes[${meshIndex}]`, "Mesh must be an object");
    const mesh = plainObject(meshValue) ? meshValue : {};
    const primitiveValues = safeArray(mesh.primitives);
    const localBounds = createBounds();
    const primitiveResults = [];
    let meshVertices = 0;
    let meshTriangles = 0;
    let meshComponents = 0;
    primitiveValues.forEach((primitiveValue, primitiveIndex) => {
      primitiveCount += 1;
      const primitive = plainObject(primitiveValue) ? primitiveValue : {};
      const path = `$.meshes[${meshIndex}].primitives[${primitiveIndex}]`;
      const attributes = plainObject(primitive.attributes) ? primitive.attributes : {};
      const draco = primitive.extensions?.KHR_draco_mesh_compression;
      if (draco) {
        collector.add("compression/draco", "error", `${path}.extensions.KHR_draco_mesh_compression`,
          "Draco-compressed primitive requires an installed decoder before topology and skin preflight", null, `draco:${meshIndex}:${primitiveIndex}`);
      }
      const positionIndex = safeIndex(attributes.POSITION);
      const position = positionIndex === null ? null : accessors.descriptor(positionIndex, `${path}.attributes.POSITION`);
      if (positionIndex === null) collector.add("primitive/position", "error", `${path}.attributes.POSITION`, "Mesh primitive does not declare a POSITION accessor");
      const vertexCount = position?.count ?? 0;
      meshVertices += vertexCount;
      geometry.vertices += vertexCount;
      if (!vertexCount) collector.add("primitive/empty", "error", path, "Mesh primitive contains no vertices");
      const bounds = scanPositionBounds(position, `${path}.attributes.POSITION`, accessors, collector, limits, { forceDeclared: Boolean(draco) });
      localBounds.addBounds(bounds);

      const mode = Number.isSafeInteger(primitive.mode) ? primitive.mode : 4;
      const modeLabel = PRIMITIVE_MODES[mode] ?? "UNKNOWN";
      modeCounts.set(mode, (modeCounts.get(mode) ?? 0) + 1);
      if (!(mode in PRIMITIVE_MODES)) collector.add("primitive/mode", "error", `${path}.mode`, `Unknown primitive mode: ${mode}`);
      else if (mode !== 4) collector.add("primitive/unsupported-mode", "warning", `${path}.mode`, `The first rigging profile expects TRIANGLES, found ${modeLabel}`);

      const indexAccessorIndex = safeIndex(primitive.indices);
      const indexDesc = indexAccessorIndex === null ? null : accessors.descriptor(indexAccessorIndex, `${path}.indices`);
      const elementCount = indexDesc?.count ?? vertexCount;
      if (indexAccessorIndex !== null) geometry.indices += indexDesc?.count ?? 0;
      const counts = primitiveElementCounts(mode, elementCount);
      geometry.points += counts.points;
      geometry.lines += counts.lines;
      geometry.triangles += counts.triangles;
      meshTriangles += counts.triangles;

      const hasNormals = attributes.NORMAL !== undefined;
      features.hasNormals ||= hasNormals;
      features.hasTangents ||= attributes.TANGENT !== undefined;
      features.hasColors ||= Object.keys(attributes).some((key) => key.startsWith("COLOR_"));
      features.hasTexcoords ||= Object.keys(attributes).some((key) => key.startsWith("TEXCOORD_"));
      features.hasMorphTargets ||= safeArray(primitive.targets).length > 0;
      if (!hasNormals) {
        geometry.missingNormalPrimitives += 1;
        collector.add("normal/missing", "warning", `${path}.attributes.NORMAL`, "Primitive has no vertex normals; deformation shading may be unreliable");
      }
      const materialIndex = safeIndex(primitive.material);
      if (materialIndex !== null) {
        if (materialIndex >= materials.length) collector.add("material/index", "error", `${path}.material`, "Primitive references an invalid material");
        else materialReferences.add(materialIndex);
      }

      let topology = { checked: false, components: 0, nonManifoldEdges: 0 };
      if (mode === 4 && indexDesc && position && !draco) {
        topology = analyzeIndexedTopology({ indexDesc, vertexCount, path, accessors, collector, limits });
      }
      if (topology.checked) {
        geometry.topologyPrimitivesChecked += 1;
        geometry.connectedComponents += topology.components;
        geometry.nonManifoldEdgeHints += topology.nonManifoldEdges;
        meshComponents += topology.components;
        if (topology.components > 1) geometry.disconnectedPrimitives += 1;
      } else {
        geometry.topologyPrimitivesSkipped += 1;
      }

      if ((attributes.JOINTS_0 === undefined) !== (attributes.WEIGHTS_0 === undefined)) {
        collector.add("skin/orphan-attributes", "error", `${path}.attributes`, "JOINTS_0 and WEIGHTS_0 must occur together");
        geometry.malformedSkinPrimitives += 1;
      }
      primitiveResults.push({ source: primitive, vertexCount, triangleCount: counts.triangles, components: topology.components, bounds });
    });
    meshResults.push({
      index: meshIndex,
      name: boundedText(mesh.name, `Mesh ${meshIndex + 1}`),
      source: mesh,
      primitives: primitiveResults,
      localBounds: localBounds.finish(),
      vertices: meshVertices,
      triangles: meshTriangles,
      components: meshComponents,
    });
  });

  const meshInstances = new Map();
  const worldBounds = createBounds();
  nodeState.nodes.forEach((nodeValue, nodeIndex) => {
    const node = plainObject(nodeValue) ? nodeValue : {};
    const meshIndex = safeIndex(node.mesh);
    if (meshIndex === null) return;
    if (meshIndex >= meshResults.length) {
      collector.add("node/mesh", "error", `$.nodes[${nodeIndex}].mesh`, "Node references an invalid mesh");
      return;
    }
    meshInstances.set(meshIndex, (meshInstances.get(meshIndex) ?? 0) + 1);
    worldBounds.addBounds(meshResults[meshIndex].localBounds, nodeState.world[nodeIndex]);
  });

  const skinResult = inspectSkins({ document, meshResults, nodeState, accessors, collector, limits });
  geometry.malformedSkinPrimitives += skinResult.malformedSkinPrimitives;
  const animations = inspectAnimations(document, nodeState.nodes.length, collector, limits.maximumInventoryItems);
  const scenes = safeArray(document.scenes);
  const sceneItems = scenes.slice(0, limits.maximumInventoryItems).map((sceneValue, index) => {
    const scene = plainObject(sceneValue) ? sceneValue : {};
    return {
      index,
      name: boundedText(scene.name, `Scene ${index + 1}`),
      roots: safeArray(scene.nodes).length,
      default: document.scene === index,
    };
  });
  safeArray(document.scenes).forEach((sceneValue, sceneIndex) => {
    const scene = plainObject(sceneValue) ? sceneValue : {};
    safeArray(scene.nodes).forEach((nodeIndex, rootIndex) => {
      if (!Number.isSafeInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodeState.nodes.length) {
        collector.add("scene/node", "error", `$.scenes[${sceneIndex}].nodes[${rootIndex}]`, "Scene references an invalid root node");
      }
    });
  });
  if (document.scene !== undefined && (!Number.isSafeInteger(document.scene) || document.scene < 0 || document.scene >= scenes.length)) {
    collector.add("scene/default", "error", "$.scene", "Default scene index is invalid");
  }

  const nodeItems = nodeState.nodes.slice(0, limits.maximumInventoryItems).map((nodeValue, index) => {
    const node = plainObject(nodeValue) ? nodeValue : {};
    return {
      index,
      name: boundedText(node.name, `Node ${index + 1}`),
      parent: nodeState.parents[index],
      children: safeArray(node.children).length,
      mesh: safeIndex(node.mesh),
      skin: safeIndex(node.skin),
      transform: node.matrix ? "matrix" : "trs",
    };
  });
  const meshItems = meshResults.slice(0, limits.maximumInventoryItems).map((mesh) => ({
    index: mesh.index,
    name: mesh.name,
    primitives: mesh.primitives.length,
    instances: meshInstances.get(mesh.index) ?? 0,
    vertices: mesh.vertices,
    triangles: mesh.triangles,
    connectedComponents: mesh.components,
  }));
  const materialItems = materials.slice(0, limits.maximumInventoryItems).map((materialValue, index) => {
    const material = plainObject(materialValue) ? materialValue : {};
    return { index, name: boundedText(material.name, `Material ${index + 1}`), referenced: materialReferences.has(index) };
  });
  const issueResult = collector.finish();

  return createRiggingPreflight({
    sourceId: contentId,
    sourceRevision: 0,
    provider: { id: GLB_PREFLIGHT_PROVIDER_ID, version: GLB_PREFLIGHT_PROVIDER_VERSION, profile: "default" },
    format: {
      container: "glb",
      version: container.version,
      byteLength: container.declaredLength,
      jsonChunkBytes: container.jsonChunkBytes,
      binaryChunkBytes: container.binaryChunkBytes,
      generator: typeof asset.generator === "string" ? asset.generator : null,
    },
    inventory: {
      scenes: { count: scenes.length, items: sceneItems, omitted: Math.max(0, scenes.length - sceneItems.length) },
      nodes: {
        count: nodeState.nodes.length,
        roots: nodeState.parents.filter((parent) => parent === null).length,
        items: nodeItems,
        omitted: Math.max(0, nodeState.nodes.length - nodeItems.length),
      },
      meshes: {
        count: meshResults.length,
        instances: [...meshInstances.values()].reduce((sum, count) => sum + count, 0),
        primitives: primitiveCount,
        items: meshItems,
        omitted: Math.max(0, meshResults.length - meshItems.length),
      },
      materials: {
        count: materials.length,
        referenced: materialReferences.size,
        items: materialItems,
        omitted: Math.max(0, materials.length - materialItems.length),
      },
      skins: skinResult.inventory,
      animations,
    },
    geometry: {
      ...geometry,
      bounds: worldBounds.finish(),
      primitiveModes: [...modeCounts.entries()].sort(([left], [right]) => left - right)
        .map(([mode, count]) => ({ mode, label: PRIMITIVE_MODES[mode] ?? "UNKNOWN", count })),
    },
    transforms: nodeState.summary,
    features,
    issues: issueResult.issues,
    summary: issueResult.summary,
  });
}

export async function analyzeLocalGlb(input, options = {}) {
  const bytes = toUint8Array(input);
  const contentId = await sha256ContentId(bytes);
  let container;
  try {
    container = parseGlbContainer(bytes, options);
  } catch (error) {
    if (error && typeof error === "object") error.sourceId = contentId;
    throw error;
  }
  const preflight = analyzeDocument(container, contentId, options);
  return Object.freeze({
    contentId,
    preflight,
    document: container.document,
    binaryChunk: container.binaryChunk,
    container,
  });
}

export async function preflightLocalGlb(input, options = {}) {
  return (await analyzeLocalGlb(input, options)).preflight;
}
