export function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function clonePortable(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
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
      const output = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError("Portable arrays cannot contain holes");
        output.push(clonePortable(value[index], seen));
      }
      return output;
    }
    if (Object.getOwnPropertySymbols(value).length) {
      throw new TypeError("Portable objects cannot contain symbol keys");
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, clonePortable(entry, seen)]),
    );
  } finally {
    seen.delete(value);
  }
}

export function portableEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((entry, index) => portableEqual(entry, right[index]));
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && portableEqual(left[key], right[key]));
  }
  return false;
}

export function requiredString(value, path) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value.trim();
}

export function optionalString(value, path) {
  if (value === null || value === undefined || value === "") return null;
  return requiredString(value, path);
}

export function finiteNumber(value, fallback, path) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`);
  }
  return value;
}

export function safeInteger(value, fallback, path, minimum = 0) {
  const number = value === undefined || value === null ? fallback : value;
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new TypeError(`${path} must be a safe integer greater than or equal to ${minimum}`);
  }
  return number;
}

export function uniqueStrings(value = [], path) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  const output = [];
  const seen = new Set();
  value.forEach((entry, index) => {
    const normalized = requiredString(entry, `${path}[${index}]`);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      output.push(normalized);
    }
  });
  return output;
}

export function vector(value, fallback, length, path) {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value) || value.length !== length) {
    throw new TypeError(`${path} must contain ${length} finite numbers`);
  }
  return value.map((entry, index) => finiteNumber(entry, undefined, `${path}[${index}]`));
}

export function issue(code, path, message, severity = "error") {
  return Object.freeze({ code, path, message, severity });
}

export function validationResult(errors = [], warnings = [], limit = 32) {
  const combined = [...errors, ...warnings];
  const truncated = combined.length > limit;
  const retained = combined.slice(0, limit);
  return Object.freeze({
    valid: !retained.some(({ severity }) => severity !== "warning") && errors.length === 0,
    errors: Object.freeze(retained.filter(({ severity }) => severity !== "warning")),
    warnings: Object.freeze(retained.filter(({ severity }) => severity === "warning")),
    truncated,
  });
}
