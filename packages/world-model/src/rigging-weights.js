import { rigJointSegments } from "./rigging-document.js";
import { normalizeRigDocument } from "./rigging-validation.js";

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

export function normalizeVertexInfluences(influences, { maxInfluences = 4, minimumWeight = 1e-8 } = {}) {
  if (!Array.isArray(influences)) throw new TypeError("Influences must be an array");
  if (!Number.isSafeInteger(maxInfluences) || maxInfluences < 1 || maxInfluences > 4) {
    throw new TypeError("maxInfluences must be an integer from 1 to 4");
  }
  if (typeof minimumWeight !== "number" || !Number.isFinite(minimumWeight) || minimumWeight < 0) {
    throw new TypeError("minimumWeight must be a non-negative finite number");
  }
  const combined = new Map();
  for (const [index, influence] of influences.entries()) {
    const joint = Array.isArray(influence) ? influence[0] : influence?.joint;
    const weight = Array.isArray(influence) ? influence[1] : influence?.weight;
    if (!Number.isSafeInteger(joint) || joint < 0) throw new TypeError(`influences[${index}].joint must be a non-negative integer`);
    if (typeof weight !== "number" || !Number.isFinite(weight)) throw new TypeError(`influences[${index}].weight must be finite`);
    if (weight <= minimumWeight) continue;
    combined.set(joint, (combined.get(joint) ?? 0) + weight);
  }
  const ranked = [...combined.entries()]
    .map(([joint, weight]) => ({ joint, weight }))
    .sort((left, right) => right.weight - left.weight || left.joint - right.joint);
  const rawTotal = ranked.reduce((sum, entry) => sum + entry.weight, 0);
  const kept = ranked.slice(0, maxInfluences);
  const keptTotal = kept.reduce((sum, entry) => sum + entry.weight, 0);
  if (keptTotal <= minimumWeight) return { influences: [], discardedMass: rawTotal > 0 ? 1 : 0 };
  return {
    influences: kept.map((entry) => ({ joint: entry.joint, weight: entry.weight / keptTotal })),
    discardedMass: rawTotal > 0 ? Math.max(0, (rawTotal - keptTotal) / rawTotal) : 0,
  };
}

function arrayLikePositions(value) {
  return Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView));
}

export function diagnoseRigWeights({
  jointIndices,
  weights,
  vertexCount,
  maxInfluences,
  jointCount,
  tolerance = 1e-4,
} = {}) {
  if (!arrayLikePositions(jointIndices) || !arrayLikePositions(weights)) throw new TypeError("Joint and weight buffers must be arrays or typed arrays");
  if (!Number.isSafeInteger(vertexCount) || vertexCount < 0) throw new TypeError("vertexCount must be a non-negative integer");
  if (!Number.isSafeInteger(maxInfluences) || maxInfluences < 1 || maxInfluences > 4) throw new TypeError("maxInfluences must be an integer from 1 to 4");
  if (!Number.isSafeInteger(jointCount) || jointCount < 0) throw new TypeError("jointCount must be a non-negative integer");
  if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0) {
    throw new TypeError("tolerance must be a non-negative finite number");
  }
  if (jointIndices.length !== vertexCount * maxInfluences || weights.length !== vertexCount * maxInfluences) {
    throw new RangeError("Weight buffers do not match vertexCount × maxInfluences");
  }
  const diagnostics = {
    vertexCount,
    jointCount,
    maxInfluences,
    unweightedVertices: 0,
    nonNormalizedVertices: 0,
    nonFiniteVertices: 0,
    negativeWeightVertices: 0,
    outOfRangeJointVertices: 0,
    duplicateJointVertices: 0,
    maximumWeightSumError: 0,
  };
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    let sum = 0;
    let nonFinite = false;
    let negative = false;
    let outOfRange = false;
    let duplicate = false;
    const active = new Set();
    for (let slot = 0; slot < maxInfluences; slot += 1) {
      const offset = vertex * maxInfluences + slot;
      const joint = jointIndices[offset];
      const weight = weights[offset];
      if (typeof weight !== "number" || !Number.isFinite(weight)) {
        nonFinite = true;
        continue;
      }
      if (weight < 0) negative = true;
      if (weight <= tolerance) continue;
      sum += weight;
      if (!Number.isSafeInteger(joint) || joint < 0 || joint >= jointCount) outOfRange = true;
      if (active.has(joint)) duplicate = true;
      active.add(joint);
    }
    const error = Math.abs(1 - sum);
    diagnostics.maximumWeightSumError = Math.max(diagnostics.maximumWeightSumError, error);
    if (sum <= tolerance) diagnostics.unweightedVertices += 1;
    else if (error > tolerance) diagnostics.nonNormalizedVertices += 1;
    if (nonFinite) diagnostics.nonFiniteVertices += 1;
    if (negative) diagnostics.negativeWeightVertices += 1;
    if (outOfRange) diagnostics.outOfRangeJointVertices += 1;
    if (duplicate) diagnostics.duplicateJointVertices += 1;
  }
  return diagnostics;
}

export function seedRigWeightsByDistance({
  document: documentValue,
  positions,
  maxInfluences,
  falloff = 2,
  epsilon = 1e-4,
  maximumVertices = 1_000_000,
  maximumDistanceEvaluations = 5_000_000,
} = {}) {
  const document = normalizeRigDocument(documentValue);
  if (!arrayLikePositions(positions) || positions.length % 3 !== 0) {
    throw new TypeError("positions must be an array or typed array containing xyz triples");
  }
  const vertexCount = positions.length / 3;
  if (!Number.isSafeInteger(maximumVertices) || maximumVertices < 0) {
    throw new TypeError("maximumVertices must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(maximumDistanceEvaluations) || maximumDistanceEvaluations < 0) {
    throw new TypeError("maximumDistanceEvaluations must be a non-negative safe integer");
  }
  if (vertexCount > maximumVertices) throw new RangeError(`Vertex count exceeds the bounded limit of ${maximumVertices}`);
  const influenceLimit = maxInfluences ?? document.skin.maxInfluences;
  if (!Number.isSafeInteger(influenceLimit) || influenceLimit < 1 || influenceLimit > 4) {
    throw new TypeError("maxInfluences must be an integer from 1 to 4");
  }
  if (typeof falloff !== "number" || !Number.isFinite(falloff) || falloff <= 0) throw new TypeError("falloff must be positive and finite");
  if (typeof epsilon !== "number" || !Number.isFinite(epsilon) || epsilon <= 0) throw new TypeError("epsilon must be positive and finite");
  if (document.joints.length === 0) throw new RangeError("Cannot seed weights without joints");
  const distanceEvaluations = vertexCount * document.joints.length;
  if (!Number.isSafeInteger(distanceEvaluations) || distanceEvaluations > maximumDistanceEvaluations) {
    throw new RangeError(`Distance evaluation count exceeds the bounded limit of ${maximumDistanceEvaluations}`);
  }
  const segments = rigJointSegments(document);
  const jointIndices = new Uint16Array(vertexCount * influenceLimit);
  const weights = new Float32Array(vertexCount * influenceLimit);
  let verticesWithDiscardedInfluence = 0;
  let discardedInfluenceMassTotal = 0;
  let discardedInfluenceMassMax = 0;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
    if (point.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
      throw new TypeError(`positions contains a non-finite value at vertex ${vertex}`);
    }
    const candidates = segments.map((segment) => {
      const distance = Math.sqrt(distanceToSegmentSquared(point, segment.start, segment.end));
      return { joint: segment.jointIndex, weight: 1 / Math.pow(Math.max(distance, epsilon), falloff) };
    });
    const normalized = normalizeVertexInfluences(candidates, { maxInfluences: influenceLimit });
    if (normalized.discardedMass > 1e-8) verticesWithDiscardedInfluence += 1;
    discardedInfluenceMassTotal += normalized.discardedMass;
    discardedInfluenceMassMax = Math.max(discardedInfluenceMassMax, normalized.discardedMass);
    normalized.influences.forEach((influence, slot) => {
      const offset = vertex * influenceLimit + slot;
      jointIndices[offset] = influence.joint;
      weights[offset] = influence.weight;
    });
  }
  const diagnostics = diagnoseRigWeights({
    jointIndices,
    weights,
    vertexCount,
    maxInfluences: influenceLimit,
    jointCount: document.joints.length,
  });
  return {
    strategy: "nearest-segment",
    jointIndices,
    weights,
    summary: {
      ...diagnostics,
      verticesWithDiscardedInfluence,
      discardedInfluenceMassMean: vertexCount ? discardedInfluenceMassTotal / vertexCount : 0,
      discardedInfluenceMassMax,
      falloff,
      epsilon,
      distanceEvaluations,
    },
  };
}
