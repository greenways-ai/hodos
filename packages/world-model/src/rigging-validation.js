import {
  AXES,
  DEFAULT_ROTATION,
  DEFAULT_SCALE,
  DEFAULT_TRANSLATION,
  HANDEDNESS,
  MAX_PORTABLE_ISSUES,
  RIG_SCHEMA,
  clonePortable,
  finiteNumber,
  isPlainObject,
  issue,
  normalizeQuaternion,
  optionalString,
  portableIssues,
  requiredString,
  safeInteger,
  vector,
} from "./rigging-values.js";

function normalizeLimits(value, path) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object`);
  const limits = {};
  if (value.swing !== undefined) {
    limits.swing = finiteNumber(value.swing, undefined, `${path}.swing`);
    if (limits.swing < 0) throw new TypeError(`${path}.swing cannot be negative`);
  }
  if (value.twist !== undefined) limits.twist = orderedPair(value.twist, `${path}.twist`);
  if (value.axes !== undefined) {
    if (!isPlainObject(value.axes)) throw new TypeError(`${path}.axes must be an object`);
    limits.axes = {};
    for (const axis of AXES) {
      if (value.axes[axis] !== undefined) limits.axes[axis] = orderedPair(value.axes[axis], `${path}.axes.${axis}`);
    }
  }
  return Object.keys(limits).length ? limits : null;
}

function orderedPair(value, path) {
  const pair = vector(value, [0, 0], 2, path);
  if (pair[0] > pair[1]) throw new TypeError(`${path} minimum cannot exceed its maximum`);
  return pair;
}

function normalizeRest(value = {}, path = "joint.rest") {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object`);
  const scale = vector(value.scale, DEFAULT_SCALE, 3, `${path}.scale`);
  if (scale.some((entry) => entry <= 0)) throw new TypeError(`${path}.scale entries must be positive`);
  return {
    translation: vector(value.translation, DEFAULT_TRANSLATION, 3, `${path}.translation`),
    rotation: normalizeQuaternion(value.rotation, `${path}.rotation`),
    scale,
  };
}

export function normalizeJoint(value, index = 0) {
  if (!isPlainObject(value)) throw new TypeError(`joints[${index}] must be an object`);
  return {
    id: requiredString(value.id, `joints[${index}].id`),
    parent: optionalString(value.parent, `joints[${index}].parent`),
    role: value.role === undefined || value.role === null || value.role === ""
      ? "joint"
      : requiredString(value.role, `joints[${index}].role`),
    rest: normalizeRest(value.rest ?? {}, `joints[${index}].rest`),
    limits: normalizeLimits(value.limits, `joints[${index}].limits`),
  };
}

function normalizeCoordinateSystem(value = {}) {
  if (!isPlainObject(value)) throw new TypeError("coordinateSystem must be an object");
  const up = value.up ?? "y";
  const handedness = value.handedness ?? "right";
  if (!AXES.includes(up)) throw new TypeError("coordinateSystem.up must be x, y, or z");
  if (!HANDEDNESS.includes(handedness)) throw new TypeError("coordinateSystem.handedness must be left or right");
  const unitScale = finiteNumber(value.unitScale, 1, "coordinateSystem.unitScale");
  if (unitScale <= 0) throw new TypeError("coordinateSystem.unitScale must be positive");
  return { up, handedness, unitScale };
}

export function normalizeSkin(value = {}) {
  if (!isPlainObject(value)) throw new TypeError("skin must be an object");
  const maxInfluences = safeInteger(value.maxInfluences, 4, "skin.maxInfluences", 1);
  if (maxInfluences > 4) throw new TypeError("skin.maxInfluences cannot exceed the glTF-compatible limit of 4");
  return {
    handleType: value.handleType === undefined
      ? "rig/weights"
      : requiredString(value.handleType, "skin.handleType"),
    weightSetId: optionalString(value.weightSetId, "skin.weightSetId"),
    maxInfluences,
  };
}

export function normalizeBind(value = {}) {
  if (!isPlainObject(value)) throw new TypeError("bind must be an object");
  return { inverseMatricesId: optionalString(value.inverseMatricesId, "bind.inverseMatricesId") };
}

export class RigValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = "RigValidationError";
    this.errors = errors.map((entry) => ({ ...entry }));
  }
}

export function validateRigDocument(value, { maxJoints = 1024 } = {}) {
  const errors = portableIssues(value).filter((entry) => entry.severity === "error");
  const warnings = [];
  if (!isPlainObject(value)) {
    errors.push(issue("rig/not-object", "$", "Rig document must be a plain object"));
    return validationResult(errors, warnings);
  }

  if (value.schema !== RIG_SCHEMA) errors.push(issue("rig/schema", "$.schema", `Expected ${RIG_SCHEMA}`));
  if (typeof value.id !== "string" || !value.id.trim()) errors.push(issue("rig/id", "$.id", "Rig id is required"));
  if (typeof value.assetId !== "string" || !value.assetId.trim()) {
    errors.push(issue("rig/asset-id", "$.assetId", "Source asset identity is required"));
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    errors.push(issue("rig/revision", "$.revision", "Revision must be a non-negative safe integer"));
  }

  validateCoordinateSystem(value.coordinateSystem, errors);
  validateSkin(value.skin, errors);
  validateBind(value.bind, errors);

  if (!Array.isArray(value.joints)) {
    errors.push(issue("rig/joints", "$.joints", "Joints must be an array"));
    return validationResult(errors, warnings);
  }
  if (value.joints.length > maxJoints) {
    errors.push(issue("rig/joint-limit", "$.joints", `Joint count exceeds the bounded limit of ${maxJoints}`));
  }

  const jointById = new Map();
  value.joints.forEach((joint, index) => {
    const path = `$.joints[${index}]`;
    if (!isPlainObject(joint)) {
      errors.push(issue("joint/not-object", path, "Joint must be a plain object"));
      return;
    }
    if (typeof joint.id !== "string" || !joint.id.trim()) {
      errors.push(issue("joint/id", `${path}.id`, "Joint id is required"));
    } else if (jointById.has(joint.id)) {
      errors.push(issue("joint/duplicate-id", `${path}.id`, `Duplicate joint id: ${joint.id}`));
    } else {
      jointById.set(joint.id, joint);
    }
    if (joint.parent !== null && (typeof joint.parent !== "string" || !joint.parent.trim())) {
      errors.push(issue("joint/parent", `${path}.parent`, "Joint parent must be null or a non-empty string"));
    }
    if (typeof joint.role !== "string" || !joint.role.trim()) {
      errors.push(issue("joint/role", `${path}.role`, "Joint role must be a non-empty string"));
    }
    validateRest(joint.rest, `${path}.rest`, errors);
    validateLimits(joint.limits, `${path}.limits`, errors);
  });

  for (const [jointId, joint] of jointById) {
    if (joint.parent === jointId) {
      errors.push(issue("joint/self-parent", `$.joints.${jointId}.parent`, "Joint cannot parent itself"));
    } else if (joint.parent !== null && !jointById.has(joint.parent)) {
      errors.push(issue("joint/missing-parent", `$.joints.${jointId}.parent`, `Missing parent joint: ${joint.parent}`));
    }
  }

  const cycle = findJointCycle(jointById);
  if (cycle) errors.push(issue("joint/cycle", "$.joints", `Joint hierarchy contains a cycle: ${cycle.join(" -> ")}`));

  const roots = [...jointById.values()].filter((joint) => joint.parent === null);
  if (jointById.size > 0 && roots.length === 0) {
    errors.push(issue("joint/no-root", "$.joints", "A non-empty rig requires at least one root joint"));
  } else if (roots.length > 1) {
    warnings.push(issue("joint/multiple-roots", "$.joints", `Rig has ${roots.length} root joints`, "warning"));
  }

  return validationResult(errors, warnings);
}

function validationResult(errors, warnings) {
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors.slice(0, MAX_PORTABLE_ISSUES).map((entry) => ({ ...entry }))),
    warnings: Object.freeze(warnings.slice(0, MAX_PORTABLE_ISSUES).map((entry) => ({ ...entry }))),
    truncated: errors.length > MAX_PORTABLE_ISSUES || warnings.length > MAX_PORTABLE_ISSUES,
  });
}

function validateCoordinateSystem(value, errors) {
  if (!isPlainObject(value)) {
    errors.push(issue("rig/coordinate-system", "$.coordinateSystem", "Coordinate system must be an object"));
    return;
  }
  if (!AXES.includes(value.up)) errors.push(issue("rig/up-axis", "$.coordinateSystem.up", "Up axis must be x, y, or z"));
  if (!HANDEDNESS.includes(value.handedness)) {
    errors.push(issue("rig/handedness", "$.coordinateSystem.handedness", "Handedness must be left or right"));
  }
  if (typeof value.unitScale !== "number" || !Number.isFinite(value.unitScale) || value.unitScale <= 0) {
    errors.push(issue("rig/unit-scale", "$.coordinateSystem.unitScale", "Unit scale must be a positive finite number"));
  }
}

function validateSkin(value, errors) {
  if (!isPlainObject(value)) {
    errors.push(issue("rig/skin", "$.skin", "Skin metadata must be an object"));
    return;
  }
  if (typeof value.handleType !== "string" || !value.handleType.trim()) {
    errors.push(issue("rig/skin-handle", "$.skin.handleType", "Skin handle type is required"));
  }
  if (value.weightSetId !== null && (typeof value.weightSetId !== "string" || !value.weightSetId.trim())) {
    errors.push(issue("rig/weight-set-id", "$.skin.weightSetId", "Weight set id must be null or a non-empty string"));
  }
  if (!Number.isSafeInteger(value.maxInfluences) || value.maxInfluences < 1 || value.maxInfluences > 4) {
    errors.push(issue("rig/max-influences", "$.skin.maxInfluences", "Max influences must be an integer from 1 to 4"));
  }
}

function validateBind(value, errors) {
  if (!isPlainObject(value)) {
    errors.push(issue("rig/bind", "$.bind", "Bind metadata must be an object"));
    return;
  }
  if (value.inverseMatricesId !== null
      && (typeof value.inverseMatricesId !== "string" || !value.inverseMatricesId.trim())) {
    errors.push(issue("rig/inverse-bind-id", "$.bind.inverseMatricesId", "Inverse-matrix id must be null or a non-empty string"));
  }
}

function validateRest(value, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(issue("joint/rest", path, "Joint rest transform must be an object"));
    return;
  }
  validateNumericVector(value.translation, 3, `${path}.translation`, errors);
  validateNumericVector(value.rotation, 4, `${path}.rotation`, errors);
  validateNumericVector(value.scale, 3, `${path}.scale`, errors);
  if (Array.isArray(value.rotation) && value.rotation.length === 4
      && value.rotation.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    const rotationLength = Math.hypot(...value.rotation);
    if (rotationLength <= Number.EPSILON) {
      errors.push(issue("joint/zero-rotation", `${path}.rotation`, "Rest rotation cannot be a zero quaternion"));
    } else if (Math.abs(1 - rotationLength) > 1e-5) {
      errors.push(issue("joint/non-unit-rotation", `${path}.rotation`, "Rest rotation must be a normalized quaternion"));
    }
  }
  if (Array.isArray(value.scale) && value.scale.some((entry) => typeof entry !== "number" || !Number.isFinite(entry) || entry <= 0)) {
    errors.push(issue("joint/scale", `${path}.scale`, "Rest scale entries must be positive finite numbers"));
  }
}

function validateNumericVector(value, length, path, errors) {
  if (!Array.isArray(value) || value.length !== length) {
    errors.push(issue("joint/vector", path, `Expected ${length} numeric entries`));
    return;
  }
  if (value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
    errors.push(issue("joint/non-finite-vector", path, "Vector entries must be finite numbers"));
  }
}

function validateLimits(value, path, errors) {
  if (value === null) return;
  if (!isPlainObject(value)) {
    errors.push(issue("joint/limits", path, "Joint limits must be null or an object"));
    return;
  }
  if (value.swing !== undefined && (typeof value.swing !== "number" || !Number.isFinite(value.swing) || value.swing < 0)) {
    errors.push(issue("joint/swing-limit", `${path}.swing`, "Swing limit must be a non-negative finite number"));
  }
  if (value.twist !== undefined) validateLimitPair(value.twist, `${path}.twist`, errors);
  if (value.axes !== undefined) {
    if (!isPlainObject(value.axes)) errors.push(issue("joint/axis-limits", `${path}.axes`, "Axis limits must be an object"));
    else for (const axis of AXES) if (value.axes[axis] !== undefined) validateLimitPair(value.axes[axis], `${path}.axes.${axis}`, errors);
  }
}

function validateLimitPair(value, path, errors) {
  if (!Array.isArray(value) || value.length !== 2 || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
    errors.push(issue("joint/limit-pair", path, "Limit must contain two finite numbers"));
  } else if (value[0] > value[1]) {
    errors.push(issue("joint/limit-order", path, "Limit minimum cannot exceed its maximum"));
  }
}

function findJointCycle(jointById) {
  const visited = new Set();
  const visiting = new Set();
  const stack = [];
  function visit(id) {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }
    if (visited.has(id)) return null;
    visiting.add(id);
    stack.push(id);
    const parent = jointById.get(id)?.parent;
    const cycle = parent && jointById.has(parent) ? visit(parent) : null;
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return cycle;
  }
  for (const id of jointById.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

export function normalizeRigDocument(value = {}) {
  const rawPortableIssues = portableIssues(value);
  if (rawPortableIssues.length) throw new RigValidationError("Rig document contains non-portable values", rawPortableIssues);
  if (!isPlainObject(value)) throw new RigValidationError("Rig document must be a plain object", [issue("rig/not-object", "$", "Rig document must be a plain object")]);
  let document;
  try {
    document = {
      schema: value.schema ?? RIG_SCHEMA,
      id: requiredString(value.id, "id"),
      assetId: requiredString(value.assetId, "assetId"),
      revision: safeInteger(value.revision, 0, "revision", 0),
      coordinateSystem: normalizeCoordinateSystem(value.coordinateSystem ?? {}),
      joints: (value.joints ?? []).map(normalizeJoint),
      skin: normalizeSkin(value.skin ?? {}),
      bind: normalizeBind(value.bind ?? {}),
    };
  } catch (error) {
    throw new RigValidationError(error.message, [issue("rig/normalization", "$", error.message)]);
  }
  const validation = validateRigDocument(document);
  if (!validation.valid) {
    const detail = validation.errors[0]?.message ? `: ${validation.errors[0].message}` : "";
    throw new RigValidationError(`Rig document is invalid${detail}`, validation.errors);
  }
  return document;
}

export function createRigDocument({ id, assetId, coordinateSystem, joints = [], skin, bind } = {}) {
  const value = {
    schema: RIG_SCHEMA,
    revision: 0,
    joints,
  };
  if (id !== undefined) value.id = id;
  if (assetId !== undefined) value.assetId = assetId;
  if (coordinateSystem !== undefined) value.coordinateSystem = coordinateSystem;
  if (skin !== undefined) value.skin = skin;
  if (bind !== undefined) value.bind = bind;
  return normalizeRigDocument(value);
}
