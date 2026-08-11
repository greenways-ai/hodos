export const RIG_SCHEMA = "hodos.rig/0-alpha";
export const RIG_INTENT_SCHEMA = "hodos.rig-intent/0-alpha";
export const RIG_OUTCOME_SCHEMA = "hodos.rig-outcome/0-alpha";
export const RIG_EVIDENCE_SCHEMA = "hodos.rig-evidence/0-alpha";

export const RIG_INTENT_TYPES = Object.freeze([
  "rig/joint-create",
  "rig/joint-update",
  "rig/joint-rename",
  "rig/joint-reparent",
  "rig/joint-delete",
  "rig/joint-mirror",
  "rig/skin-attach",
]);

export const DEFAULT_TRANSLATION = Object.freeze([0, 0, 0]);
export const DEFAULT_ROTATION = Object.freeze([0, 0, 0, 1]);
export const DEFAULT_SCALE = Object.freeze([1, 1, 1]);
export const AXES = Object.freeze(["x", "y", "z"]);
export const HANDEDNESS = Object.freeze(["left", "right"]);
export const MAX_PORTABLE_ISSUES = 16;
export const MAX_OPERATION_ID_LENGTH = 256;

export function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function clonePortable(value, seen = new Set()) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Portable numbers must be finite");
    return value;
  }
  if (["undefined", "function", "symbol", "bigint"].includes(typeof value)) {
    throw new TypeError(`Portable values cannot contain ${typeof value}`);
  }
  if (typeof value !== "object") throw new TypeError(`Unsupported portable value: ${typeof value}`);
  if (seen.has(value)) throw new TypeError("Portable values cannot contain reference cycles");
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new TypeError("Portable values may contain only plain objects and arrays");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const cloned = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError("Portable arrays cannot contain holes");
        cloned.push(clonePortable(value[index], seen));
      }
      return cloned;
    }
    if (Object.getOwnPropertySymbols(value).length) {
      throw new TypeError("Portable objects cannot contain symbol keys");
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clonePortable(entry, seen)]));
  } finally {
    seen.delete(value);
  }
}

export function portableIssues(value, path = "$", seen = new Set(), issues = []) {
  if (issues.length >= MAX_PORTABLE_ISSUES + 1) return issues;
  if (value === null || ["string", "boolean"].includes(typeof value)) return issues;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issues.push(issue("portable/non-finite", path, "Portable numbers must be finite"));
    return issues;
  }
  if (["undefined", "function", "symbol", "bigint"].includes(typeof value)) {
    issues.push(issue("portable/unsupported-type", path, `Portable values cannot contain ${typeof value}`));
    return issues;
  }
  if (typeof value !== "object") {
    issues.push(issue("portable/unsupported-type", path, `Unsupported portable value: ${typeof value}`));
    return issues;
  }
  if (seen.has(value)) {
    issues.push(issue("portable/cycle", path, "Portable values cannot contain reference cycles"));
    return issues;
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    issues.push(issue("portable/non-plain-object", path, "Portable values may contain only plain objects and arrays"));
    return issues;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) issues.push(issue("portable/sparse-array", `${path}[${index}]`, "Portable arrays cannot contain holes"));
      else portableIssues(value[index], `${path}[${index}]`, seen, issues);
    }
  } else {
    if (Object.getOwnPropertySymbols(value).length) {
      issues.push(issue("portable/symbol-key", path, "Portable objects cannot contain symbol keys"));
    }
    for (const [key, entry] of Object.entries(value)) {
      portableIssues(entry, `${path}.${key}`, seen, issues);
    }
  }
  seen.delete(value);
  return issues;
}

export function issue(code, path, message, severity = "error") {
  return Object.freeze({ code, path, message, severity });
}

export function requiredString(value, path) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${path} must be a non-empty string`);
  return value.trim();
}

export function optionalString(value, path) {
  if (value === null || value === undefined || value === "") return null;
  return requiredString(value, path);
}

export function finiteNumber(value, fallback, path) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${path} must be a finite number`);
  return value;
}

export function safeInteger(value, fallback, path, minimum = 0) {
  const number = value === undefined || value === null ? fallback : value;
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new TypeError(`${path} must be a safe integer greater than or equal to ${minimum}`);
  }
  return number;
}

export function vector(value, fallback, length, path) {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value) || value.length !== length) throw new TypeError(`${path} must contain ${length} numbers`);
  return value.map((entry, index) => finiteNumber(entry, undefined, `${path}[${index}]`));
}

export function normalizeQuaternion(value, path) {
  const quaternion = vector(value, DEFAULT_ROTATION, 4, path);
  const length = Math.hypot(...quaternion);
  if (length <= Number.EPSILON) throw new TypeError(`${path} cannot be a zero quaternion`);
  return quaternion.map((entry) => entry / length);
}
