import {
  diagnoseRigWeights,
  normalizeVertexInfluences,
} from "./rigging-weights.js";
import { normalizeRigDocument } from "./rigging-validation.js";

export const RIG_WEIGHT_EDIT_OPERATIONS = Object.freeze([
  "add",
  "subtract",
  "replace",
  "rigid",
  "smooth",
  "flood",
  "prune",
  "normalize",
]);

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

function nonNegativeInteger(value, fallback, label) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
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

function selectionVertices(value, vertexCount, maximumSelectedVertices) {
  if (!arrayLike(value) || value instanceof DataView) throw new TypeError("selectedVertices must be an array or typed array");
  if (!Number.isSafeInteger(value.length) || value.length > maximumSelectedVertices) {
    throw new RangeError(`Selection input exceeds the bounded limit of ${maximumSelectedVertices} vertices`);
  }
  const selected = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
    if (!Number.isSafeInteger(candidate) || candidate < 0 || candidate >= vertexCount) {
      throw new RangeError(`selectedVertices[${index}] is outside the vertex range`);
    }
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    selected.push(candidate);
    if (selected.length > maximumSelectedVertices) {
      throw new RangeError(`Selection exceeds the bounded limit of ${maximumSelectedVertices} vertices`);
    }
  }
  selected.sort((left, right) => left - right);
  return selected;
}

function influenceMap(jointIndices, weights, vertex, maxInfluences, tolerance = 1e-8) {
  const map = new Map();
  const offset = vertex * maxInfluences;
  for (let slot = 0; slot < maxInfluences; slot += 1) {
    const joint = jointIndices[offset + slot];
    const weight = weights[offset + slot];
    if (!Number.isFinite(weight) || weight <= tolerance) continue;
    map.set(joint, (map.get(joint) ?? 0) + weight);
  }
  return map;
}

function writeInfluences(jointIndices, weights, vertex, maxInfluences, influences, minimumWeight) {
  const offset = vertex * maxInfluences;
  jointIndices.fill(0, offset, offset + maxInfluences);
  weights.fill(0, offset, offset + maxInfluences);
  const normalized = normalizeVertexInfluences(
    [...influences.entries()].map(([joint, weight]) => ({ joint, weight: Math.max(0, weight) })),
    { maxInfluences, minimumWeight },
  );
  normalized.influences.forEach((influence, slot) => {
    jointIndices[offset + slot] = influence.joint;
    weights[offset + slot] = influence.weight;
  });
  return normalized.discardedMass;
}

function expandFloodSelection(selected, componentIds, vertexCount, maximumSelectedVertices) {
  if (!arrayLike(componentIds) || componentIds.length !== vertexCount) {
    throw new RangeError("Flood edits require one component id per vertex");
  }
  const components = new Set(selected.map((vertex) => componentIds[vertex]));
  const expanded = [];
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const component = componentIds[vertex];
    if (!Number.isSafeInteger(component) || component < 0) {
      throw new RangeError(`componentIds contains an invalid value at vertex ${vertex}`);
    }
    if (!components.has(component)) continue;
    expanded.push(vertex);
    if (expanded.length > maximumSelectedVertices) {
      throw new RangeError(`Flood selection exceeds the bounded limit of ${maximumSelectedVertices} vertices`);
    }
  }
  return expanded;
}

function validateAdjacency(adjacencyOffsets, adjacency, vertexCount) {
  if (!arrayLike(adjacencyOffsets) || adjacencyOffsets.length !== vertexCount + 1) {
    throw new RangeError("adjacencyOffsets must contain vertexCount + 1 entries");
  }
  if (!arrayLike(adjacency)) throw new TypeError("adjacency must be an array or typed array");
  if (adjacencyOffsets[0] !== 0 || adjacencyOffsets[vertexCount] !== adjacency.length) {
    throw new RangeError("adjacencyOffsets does not bound the adjacency array");
  }
  let previous = 0;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const start = adjacencyOffsets[vertex];
    const end = adjacencyOffsets[vertex + 1];
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < previous || end < start || end > adjacency.length) {
      throw new RangeError(`adjacencyOffsets contains an invalid range for vertex ${vertex}`);
    }
    if (start !== previous) throw new RangeError(`adjacencyOffsets is not contiguous at vertex ${vertex}`);
    previous = end;
    for (let offset = start; offset < end; offset += 1) {
      const neighbor = adjacency[offset];
      if (!Number.isSafeInteger(neighbor) || neighbor < 0 || neighbor >= vertexCount) {
        throw new RangeError(`adjacency contains an out-of-range neighbor at entry ${offset}`);
      }
    }
  }
}

export function normalizeRigWeightEdit(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Rig weight edit must be an object");
  }
  const operation = String(value.operation ?? value.type ?? "add");
  if (!RIG_WEIGHT_EDIT_OPERATIONS.includes(operation)) {
    throw new TypeError(`Unsupported rig weight edit operation: ${operation}`);
  }
  const needsJoint = ["add", "subtract", "replace", "rigid", "flood"].includes(operation);
  const jointIndex = value.jointIndex ?? null;
  if (needsJoint && (!Number.isSafeInteger(jointIndex) || jointIndex < 0)) {
    throw new TypeError(`${operation} edits require a non-negative jointIndex`);
  }
  const strengthDefault = operation === "replace" ? 1 : operation === "smooth" ? 0.5 : 0.1;
  return Object.freeze({
    operation,
    jointIndex: needsJoint ? jointIndex : null,
    strength: finiteRange(value.strength, strengthDefault, 0, 1, "strength"),
    threshold: finiteRange(value.threshold, 0.01, 0, 1, "threshold"),
    iterations: positiveInteger(value.iterations, 1, "iterations"),
    minimumWeight: finiteRange(value.minimumWeight, 1e-8, 0, 1, "minimumWeight"),
    abruptGradientThreshold: finiteRange(value.abruptGradientThreshold, 0.5, 0, 1, "abruptGradientThreshold"),
  });
}

function replaceJointWeight(map, jointIndex, target) {
  const others = [...map.entries()].filter(([joint, weight]) => joint !== jointIndex && weight > 0);
  const otherTotal = others.reduce((sum, [, weight]) => sum + weight, 0);
  const next = new Map();
  if (target > 0) next.set(jointIndex, target);
  if (target < 1 && otherTotal > 0) {
    const scale = (1 - target) / otherTotal;
    for (const [joint, weight] of others) next.set(joint, weight * scale);
  }
  return next;
}

function smoothSelection({
  jointIndices,
  weights,
  selected,
  maxInfluences,
  adjacencyOffsets,
  adjacency,
  strength,
  iterations,
  minimumWeight,
  maximumNeighborVisits,
}) {
  let neighborVisits = 0;
  let discardedTotal = 0;
  let discardedMax = 0;
  let discardedVertices = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sourceIndices = jointIndices.slice();
    const sourceWeights = weights.slice();
    try {
      for (const vertex of selected) {
      const start = adjacencyOffsets[vertex];
      const end = adjacencyOffsets[vertex + 1];
      const count = end - start;
      if (!count) continue;
      const average = new Map();
      for (let offset = start; offset < end; offset += 1) {
        neighborVisits += 1;
        if (neighborVisits > maximumNeighborVisits) {
          sourceIndices.fill(0);
          sourceWeights.fill(0);
          throw new RangeError(`Weight smoothing exceeds the bounded neighbor-visit limit of ${maximumNeighborVisits}`);
        }
        const neighbor = adjacency[offset];
        for (const [joint, weight] of influenceMap(sourceIndices, sourceWeights, neighbor, maxInfluences, minimumWeight)) {
          average.set(joint, (average.get(joint) ?? 0) + weight / count);
        }
      }
      const current = influenceMap(sourceIndices, sourceWeights, vertex, maxInfluences, minimumWeight);
      const blended = new Map();
      for (const joint of new Set([...current.keys(), ...average.keys()])) {
        blended.set(joint, (current.get(joint) ?? 0) * (1 - strength) + (average.get(joint) ?? 0) * strength);
      }
      const discarded = writeInfluences(jointIndices, weights, vertex, maxInfluences, blended, minimumWeight);
        if (discarded > minimumWeight) discardedVertices += 1;
        discardedTotal += discarded;
        discardedMax = Math.max(discardedMax, discarded);
      }
    } finally {
      sourceIndices.fill(0);
      sourceWeights.fill(0);
    }
  }
  return { neighborVisits, discardedTotal, discardedMax, discardedVertices };
}

function distributionDistance(leftIndices, leftWeights, rightIndices, rightWeights, leftVertex, rightVertex, maxInfluences, tolerance) {
  const left = influenceMap(leftIndices, leftWeights, leftVertex, maxInfluences, tolerance);
  const right = influenceMap(rightIndices, rightWeights, rightVertex, maxInfluences, tolerance);
  let difference = 0;
  for (const joint of new Set([...left.keys(), ...right.keys()])) {
    difference += Math.abs((left.get(joint) ?? 0) - (right.get(joint) ?? 0));
  }
  return Math.min(1, difference / 2);
}

export function diagnoseRigWeightAdjacency({
  jointIndices,
  weights,
  vertexCount,
  maxInfluences,
  adjacencyOffsets,
  adjacency,
  threshold = 0.5,
  tolerance = 1e-8,
  maximumEdges = 3_000_000,
  maximumRepresentatives = 32,
} = {}) {
  if (!arrayLike(jointIndices) || !arrayLike(weights)) throw new TypeError("Weight buffers must be arrays or typed arrays");
  if (!Number.isSafeInteger(vertexCount) || vertexCount < 0) throw new TypeError("vertexCount must be a non-negative safe integer");
  if (!Number.isSafeInteger(maxInfluences) || maxInfluences < 1 || maxInfluences > 4) {
    throw new TypeError("maxInfluences must be an integer from 1 to 4");
  }
  if (jointIndices.length !== vertexCount * maxInfluences || weights.length !== vertexCount * maxInfluences) {
    throw new RangeError("Weight buffers do not match vertexCount × maxInfluences");
  }
  const weightTolerance = finiteRange(tolerance, 1e-8, 0, 1, "tolerance");
  validateAdjacency(adjacencyOffsets, adjacency, vertexCount);
  const boundedEdges = positiveInteger(maximumEdges, 3_000_000, "maximumEdges");
  const representativesLimit = nonNegativeInteger(maximumRepresentatives, 32, "maximumRepresentatives");
  const abruptThreshold = finiteRange(threshold, 0.5, 0, 1, "threshold");
  let edges = 0;
  let abruptEdges = 0;
  let gradientTotal = 0;
  let maximumGradient = 0;
  const representatives = new Set();
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    for (let offset = adjacencyOffsets[vertex]; offset < adjacencyOffsets[vertex + 1]; offset += 1) {
      const neighbor = adjacency[offset];
      if (neighbor <= vertex) continue;
      edges += 1;
      if (edges > boundedEdges) throw new RangeError(`Adjacency diagnostics exceed the bounded edge limit of ${boundedEdges}`);
      const gradient = distributionDistance(
        jointIndices,
        weights,
        jointIndices,
        weights,
        vertex,
        neighbor,
        maxInfluences,
        weightTolerance,
      );
      gradientTotal += gradient;
      maximumGradient = Math.max(maximumGradient, gradient);
      if (gradient > abruptThreshold) {
        abruptEdges += 1;
        if (representatives.size < representativesLimit) {
          representatives.add(vertex);
          if (representatives.size < representativesLimit) representatives.add(neighbor);
        }
      }
    }
  }
  return {
    summary: Object.freeze({
      adjacencyEdges: edges,
      abruptGradientEdges: abruptEdges,
      abruptGradientThreshold: abruptThreshold,
      meanAdjacencyGradient: edges ? gradientTotal / edges : 0,
      maximumAdjacencyGradient: maximumGradient,
    }),
    representativeVertices: new Uint32Array([...representatives].sort((left, right) => left - right)),
  };
}

export function applyRigWeightEdit({
  document: documentValue,
  jointIndices: jointIndicesValue,
  weights: weightsValue,
  selectedVertices: selectedValue,
  adjacencyOffsets = null,
  adjacency = null,
  componentIds = null,
  edit: editValue = {},
  maximumSelectedVertices = 250_000,
  maximumNeighborVisits = 6_000_000,
  maximumDiagnosticEdges = 3_000_000,
  maximumProblemVertices = 32,
} = {}) {
  const document = normalizeRigDocument(documentValue);
  const vertexCount = Number(jointIndicesValue?.length) / document.skin.maxInfluences;
  const maxInfluences = document.skin.maxInfluences;
  if (!Number.isSafeInteger(vertexCount) || vertexCount < 0
    || !arrayLike(weightsValue) || weightsValue.length !== jointIndicesValue.length) {
    throw new RangeError("Weight buffers do not match the rig influence shape");
  }
  const initial = diagnoseRigWeights({
    jointIndices: jointIndicesValue,
    weights: weightsValue,
    vertexCount,
    maxInfluences,
    jointCount: document.joints.length,
  });
  if (initial.nonFiniteVertices || initial.negativeWeightVertices || initial.outOfRangeJointVertices || initial.duplicateJointVertices) {
    throw new RangeError("Base weight artifact contains invalid influences");
  }
  const edit = normalizeRigWeightEdit(editValue);
  if (edit.jointIndex !== null && edit.jointIndex >= document.joints.length) {
    throw new RangeError(`Edit jointIndex ${edit.jointIndex} is outside the rig joint range`);
  }
  const boundedSelected = positiveInteger(maximumSelectedVertices, 250_000, "maximumSelectedVertices");
  let selected = selectionVertices(selectedValue, vertexCount, boundedSelected);
  if (edit.operation === "flood") selected = expandFloodSelection(selected, componentIds, vertexCount, boundedSelected);
  const jointIndices = new Uint16Array(jointIndicesValue);
  const weights = new Float32Array(weightsValue);
  let neighborVisits = 0;
  let discardedTotal = 0;
  let discardedMax = 0;
  let discardedVertices = 0;

  if (edit.operation === "smooth") {
    validateAdjacency(adjacencyOffsets, adjacency, vertexCount);
    const smoothed = smoothSelection({
      jointIndices,
      weights,
      selected,
      maxInfluences,
      adjacencyOffsets,
      adjacency,
      strength: edit.strength,
      iterations: edit.iterations,
      minimumWeight: edit.minimumWeight,
      maximumNeighborVisits: positiveInteger(maximumNeighborVisits, 6_000_000, "maximumNeighborVisits"),
    });
    ({ neighborVisits, discardedTotal, discardedMax, discardedVertices } = smoothed);
  } else {
    for (const vertex of selected) {
      const current = influenceMap(jointIndices, weights, vertex, maxInfluences, edit.minimumWeight);
      let next = current;
      switch (edit.operation) {
        case "add":
          next = new Map(current);
          next.set(edit.jointIndex, (next.get(edit.jointIndex) ?? 0) + edit.strength);
          break;
        case "subtract":
          next = new Map(current);
          next.set(edit.jointIndex, Math.max(0, (next.get(edit.jointIndex) ?? 0) - edit.strength));
          break;
        case "replace":
          next = replaceJointWeight(current, edit.jointIndex, edit.strength);
          break;
        case "rigid":
        case "flood":
          next = new Map([[edit.jointIndex, 1]]);
          break;
        case "prune":
          next = new Map([...current].filter(([, weight]) => weight >= edit.threshold));
          break;
        case "normalize":
          next = current;
          break;
        default:
          throw new TypeError(`Unsupported rig weight edit operation: ${edit.operation}`);
      }
      const discarded = writeInfluences(jointIndices, weights, vertex, maxInfluences, next, edit.minimumWeight);
      if (discarded > edit.minimumWeight) discardedVertices += 1;
      discardedTotal += discarded;
      discardedMax = Math.max(discardedMax, discarded);
    }
  }

  const diagnostics = diagnoseRigWeights({
    jointIndices,
    weights,
    vertexCount,
    maxInfluences,
    jointCount: document.joints.length,
  });
  let adjacencyDiagnostics = {
    summary: Object.freeze({
      adjacencyEdges: 0,
      abruptGradientEdges: 0,
      abruptGradientThreshold: edit.abruptGradientThreshold,
      meanAdjacencyGradient: 0,
      maximumAdjacencyGradient: 0,
    }),
    representativeVertices: new Uint32Array(),
  };
  if (adjacencyOffsets && adjacency) {
    adjacencyDiagnostics = diagnoseRigWeightAdjacency({
      jointIndices,
      weights,
      vertexCount,
      maxInfluences,
      adjacencyOffsets,
      adjacency,
      threshold: edit.abruptGradientThreshold,
      maximumEdges: maximumDiagnosticEdges,
      maximumRepresentatives: maximumProblemVertices,
    });
  }
  return {
    operation: edit.operation,
    edit,
    selectedVertices: new Uint32Array(selected),
    jointIndices,
    weights,
    problemVertices: adjacencyDiagnostics.representativeVertices,
    summary: Object.freeze({
      ...diagnostics,
      ...adjacencyDiagnostics.summary,
      operation: edit.operation,
      affectedVertices: selected.length,
      neighborVisits,
      verticesWithDiscardedInfluence: discardedVertices,
      discardedInfluenceMassMean: selected.length ? discardedTotal / selected.length : 0,
      discardedInfluenceMassMax: discardedMax,
      intentionallyUnweighted: diagnostics.unweightedVertices > 0 && (
        ["subtract", "prune"].includes(edit.operation)
        || diagnostics.unweightedVertices <= initial.unweightedVertices
      ),
    }),
  };
}

export function buildRigWeightAttachmentIntent(documentValue, artifactValue = {}) {
  const document = normalizeRigDocument(documentValue);
  if (!artifactValue?.skin?.weightSetId || !artifactValue?.bind?.inverseMatricesId) {
    throw new TypeError("Weight artifact attachment requires skin and bind artifact identities");
  }
  return Object.freeze({
    type: "rig/skin-attach",
    expectedRevision: document.revision,
    skin: Object.freeze({
      handleType: "rig/weights",
      weightSetId: String(artifactValue.skin.weightSetId),
      maxInfluences: artifactValue.skin.maxInfluences ?? document.skin.maxInfluences,
    }),
    bind: Object.freeze({ inverseMatricesId: String(artifactValue.bind.inverseMatricesId) }),
  });
}
