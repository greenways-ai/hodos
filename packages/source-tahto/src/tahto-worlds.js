const IDENTIFIER = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value) || value.length > 120) {
    throw new Error(`${label} must be a bounded lowercase identifier`);
  }
  return value;
}

function portable(value, label, depth = 0) {
  if (depth > 16) throw new Error(`${label} exceeds the maximum depth`);
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map((entry, index) => portable(entry, `${label}[${index}]`, depth + 1)));
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${label} must contain portable data only`);
  }
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:__proto__|constructor|prototype|script|source|module|privateKey|token|authorization)$/i.test(key)) {
      throw new Error(`${label} contains forbidden field ${key}`);
    }
    output[key] = portable(child, `${label}.${key}`, depth + 1);
  }
  return Object.freeze(output);
}

export class TahtoWorldSource {
  constructor({ broker, application = "greenways.hodos", namespace = "worlds", collection = "world" }) {
    if (!broker || typeof broker.read !== "function" || typeof broker.prepare !== "function" || typeof broker.submit !== "function") {
      throw new Error("Hodos Tahto source requires the Greenways OS capability broker");
    }
    this.broker = broker;
    this.coordinate = Object.freeze({
      application: identifier(application, "Tahto application"),
      namespace: identifier(namespace, "Tahto namespace"),
      collection: identifier(collection, "Tahto collection"),
    });
  }

  async readWorld(stableId) {
    const result = await this.broker.read(this.coordinate, { stableId: identifier(stableId, "World stable id") });
    return portable(result, "Tahto world read result");
  }

  async prepareWorld(stableId, value, { expectedRoot = null } = {}) {
    if (expectedRoot !== null && (typeof expectedRoot !== "string" || !DIGEST.test(expectedRoot))) {
      throw new Error("Expected Tahto root must be a canonical SHA-256 digest");
    }
    const result = await this.broker.prepare(this.coordinate, {
      stableId: identifier(stableId, "World stable id"),
      expectedRoot,
      value: portable(value, "Hodos world value"),
    });
    return portable(result, "Tahto world prepare result");
  }

  async submitWorld(plan) {
    const value = portable(plan, "Tahto semantic plan");
    if (typeof value.planDigest !== "string" || !DIGEST.test(value.planDigest)) {
      throw new Error("Tahto semantic plan requires a canonical plan digest");
    }
    return portable(await this.broker.submit(this.coordinate, value), "Tahto world submit result");
  }
}
