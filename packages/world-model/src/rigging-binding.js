import {
  rigJointSegments,
  rigRestWorldTransforms,
} from "./rigging-document.js";
import { diagnoseRigWeights } from "./rigging-weights.js";
import { normalizeRigDocument } from "./rigging-validation.js";

function arrayLike(value) {
  return Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView));
}

function positiveInteger(value, fallback, label) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return candidate;
}

function distanceToSegmentSquared(point, start, end) {
  const ab = end.map((entry, axis) => entry - start[axis]);
  const ap = point.map((entry, axis) => entry - start[axis]);
  const denominator = ab.reduce((sum, entry) => sum + entry * entry, 0);
  const projection = denominator <= Number.EPSILON
    ? 0
    : Math.max(0, Math.min(1, ap.reduce((sum, entry, axis) => sum + entry * ab[axis], 0) / denominator));
  return point.reduce((sum, entry, axis) => {
    const difference = entry - (start[axis] + ab[axis] * projection);
    return sum + difference * difference;
  }, 0);
}

function matrixFromTransform(transform) {
  const [x, y, z, w] = transform.rotation;
  const [sx, sy, sz] = transform.scale;
  const [tx, ty, tz] = transform.translation;
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
    tx, ty, tz, 1,
  ];
}

function invertMatrix4(matrix, label) {
  const out = new Array(16);
  const a00 = matrix[0]; const a01 = matrix[1]; const a02 = matrix[2]; const a03 = matrix[3];
  const a10 = matrix[4]; const a11 = matrix[5]; const a12 = matrix[6]; const a13 = matrix[7];
  const a20 = matrix[8]; const a21 = matrix[9]; const a22 = matrix[10]; const a23 = matrix[11];
  const a30 = matrix[12]; const a31 = matrix[13]; const a32 = matrix[14]; const a33 = matrix[15];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-12) {
    throw new RangeError(`${label} is singular and cannot produce an inverse bind matrix`);
  }
  const inverse = 1 / determinant;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inverse;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inverse;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inverse;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inverse;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inverse;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inverse;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inverse;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inverse;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inverse;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inverse;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inverse;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inverse;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inverse;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inverse;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inverse;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inverse;
  if (!out.every(Number.isFinite)) throw new RangeError(`${label} produced a non-finite inverse bind matrix`);
  return out;
}

export function rigInverseBindMatrices(documentValue) {
  const document = normalizeRigDocument(documentValue);
  const transforms = rigRestWorldTransforms(document);
  const matrices = new Float32Array(transforms.length * 16);
  transforms.forEach((transform, index) => {
    matrices.set(invertMatrix4(matrixFromTransform(transform), `joint ${transform.id}`), index * 16);
  });
  return matrices;
}

export function seedRigWeightsByComponents({
  document: documentValue,
  positions,
  componentIds,
  componentCount: componentCountValue = null,
  maxInfluences: maxInfluencesValue = null,
  maximumVertices = 1_000_000,
  maximumComponents = 100_000,
  maximumDistanceEvaluations = 5_000_000,
} = {}) {
  const document = normalizeRigDocument(documentValue);
  if (!document.joints.length) throw new RangeError("Cannot seed component weights without joints");
  if (!arrayLike(positions) || positions.length % 3 !== 0) {
    throw new TypeError("positions must contain xyz triples");
  }
  const vertexCount = positions.length / 3;
  if (!arrayLike(componentIds) || componentIds.length !== vertexCount) {
    throw new RangeError("componentIds must contain one component per vertex");
  }
  const boundedVertices = positiveInteger(maximumVertices, 1_000_000, "maximumVertices");
  if (vertexCount > boundedVertices) throw new RangeError(`Vertex count exceeds the bounded limit of ${boundedVertices}`);
  const inferredComponentCount = vertexCount
    ? Math.max(...componentIds) + 1
    : 0;
  const componentCount = componentCountValue ?? inferredComponentCount;
  if (!Number.isSafeInteger(componentCount) || componentCount < 0) {
    throw new TypeError("componentCount must be a non-negative safe integer");
  }
  const boundedComponents = positiveInteger(maximumComponents, 100_000, "maximumComponents");
  if (componentCount > boundedComponents) {
    throw new RangeError(`Component count exceeds the bounded limit of ${boundedComponents}`);
  }
  const maxInfluences = maxInfluencesValue ?? document.skin.maxInfluences;
  if (!Number.isSafeInteger(maxInfluences) || maxInfluences < 1 || maxInfluences > 4) {
    throw new TypeError("maxInfluences must be an integer from 1 to 4");
  }
  const sums = new Float64Array(componentCount * 3);
  const counts = new Uint32Array(componentCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const component = componentIds[vertex];
    if (!Number.isSafeInteger(component) || component < 0 || component >= componentCount) {
      throw new RangeError(`componentIds contains an out-of-range component at vertex ${vertex}`);
    }
    const offset = vertex * 3;
    const point = [positions[offset], positions[offset + 1], positions[offset + 2]];
    if (!point.every(Number.isFinite)) throw new TypeError(`positions contains a non-finite value at vertex ${vertex}`);
    sums[component * 3] += point[0];
    sums[component * 3 + 1] += point[1];
    sums[component * 3 + 2] += point[2];
    counts[component] += 1;
  }
  const evaluations = componentCount * document.joints.length;
  const boundedEvaluations = positiveInteger(maximumDistanceEvaluations, 5_000_000, "maximumDistanceEvaluations");
  if (!Number.isSafeInteger(evaluations) || evaluations > boundedEvaluations) {
    throw new RangeError(`Distance evaluation count exceeds the bounded limit of ${boundedEvaluations}`);
  }
  const segments = rigJointSegments(document);
  const assignments = new Uint16Array(componentCount);
  for (let component = 0; component < componentCount; component += 1) {
    if (!counts[component]) throw new RangeError(`Component ${component} has no vertices`);
    const centroid = [
      sums[component * 3] / counts[component],
      sums[component * 3 + 1] / counts[component],
      sums[component * 3 + 2] / counts[component],
    ];
    let bestJoint = 0;
    let bestDistance = Infinity;
    for (const segment of segments) {
      const distance = distanceToSegmentSquared(centroid, segment.start, segment.end);
      if (distance < bestDistance || (distance === bestDistance && segment.jointIndex < bestJoint)) {
        bestDistance = distance;
        bestJoint = segment.jointIndex;
      }
    }
    assignments[component] = bestJoint;
  }
  const jointIndices = new Uint16Array(vertexCount * maxInfluences);
  const weights = new Float32Array(vertexCount * maxInfluences);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * maxInfluences;
    jointIndices[offset] = assignments[componentIds[vertex]];
    weights[offset] = 1;
  }
  return {
    strategy: "rigid-component",
    jointIndices,
    weights,
    componentAssignments: assignments,
    summary: {
      ...diagnoseRigWeights({
        jointIndices,
        weights,
        vertexCount,
        maxInfluences,
        jointCount: document.joints.length,
      }),
      componentCount,
      distanceEvaluations: evaluations,
    },
  };
}
