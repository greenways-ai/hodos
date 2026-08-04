const identifier = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value;
};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const semver = (value, label) => {
  const match = identifier(value, label).match(SEMVER);
  if (!match) throw new TypeError(`${label} must be a semantic version`);
  return match.slice(1, 4).map(Number);
};
const compareSemver = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
};

export function satisfiesAddonVersion(version, range) {
  const actual = semver(version, "Add-on version");
  if (range === "*") return true;
  const operator = range[0];
  const requested = semver(operator === "^" || operator === "~" ? range.slice(1) : range, "Add-on dependency range");
  if (compareSemver(actual, requested) < 0) return false;
  if (operator === "~") return actual[0] === requested[0] && actual[1] === requested[1];
  if (operator === "^") {
    if (requested[0] > 0) return actual[0] === requested[0];
    if (requested[1] > 0) return actual[0] === 0 && actual[1] === requested[1];
    return actual[0] === 0 && actual[1] === 0 && actual[2] === requested[2];
  }
  return compareSemver(actual, requested) === 0;
}

function normalizeManifest(manifest = {}) {
  const id = identifier(manifest.id, "Add-on manifest id");
  const version = identifier(manifest.version, `Add-on ${id} version`);
  semver(version, `Add-on ${id} version`);
  const requires = Object.fromEntries(Object.entries(manifest.requires ?? {}).map(([dependency, range]) => [
    identifier(dependency, `Add-on ${id} dependency`),
    identifier(range, `Add-on ${id} dependency range`),
  ]));
  const capabilities = [...new Set(manifest.capabilities ?? [])].map((capability) => (
    identifier(capability, `Add-on ${id} capability`)
  ));
  return Object.freeze({ ...manifest, id, version, requires: Object.freeze(requires), capabilities: Object.freeze(capabilities) });
}

export function defineAddon(addon) {
  if (!addon || typeof addon !== "object") throw new TypeError("Hodos add-on must be an object");
  if (addon.activate !== undefined && typeof addon.activate !== "function") {
    throw new TypeError("Hodos add-on activate must be a function");
  }
  if (addon.deactivate !== undefined && typeof addon.deactivate !== "function") {
    throw new TypeError("Hodos add-on deactivate must be a function");
  }
  return Object.freeze({ ...addon, manifest: normalizeManifest(addon.manifest) });
}

const values = (value) => Array.isArray(value) ? value : [value];

export class HodosHost {
  #addons = new Map();
  #active = new Map();
  #capabilities;
  #contributions = new Map();
  #listeners = new Map();

  constructor({ capabilities = [] } = {}) {
    this.#capabilities = new Set(capabilities.map((capability) => identifier(capability, "Host capability")));
  }

  register(...addons) {
    for (const candidate of addons.flat(Infinity)) {
      const addon = defineAddon(candidate);
      if (this.#addons.has(addon.manifest.id)) throw new Error(`Hodos add-on is already registered: ${addon.manifest.id}`);
      this.#addons.set(addon.manifest.id, addon);
    }
    return this;
  }

  registered() {
    return [...this.#addons.values()].map(({ manifest }) => manifest);
  }

  active() {
    return [...this.#active.keys()];
  }

  hasCapability(capability) {
    return this.#capabilities.has(capability);
  }

  getContribution(kind, id) {
    return this.#contributions.get(kind)?.get(id)?.value;
  }

  listContributions(kind) {
    const kinds = kind === undefined ? [...this.#contributions.keys()] : [kind];
    return kinds.flatMap((selected) => [...(this.#contributions.get(selected)?.values() ?? [])].map((entry) => ({ ...entry })));
  }

  on(event, listener) {
    identifier(event, "Hodos event");
    if (typeof listener !== "function") throw new TypeError("Hodos event listener must be a function");
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }

  emit(event, payload) {
    for (const listener of this.#listeners.get(event) ?? []) listener(payload);
  }

  async activate(ids = [...this.#addons.keys()]) {
    const visiting = new Set();
    const visited = new Set();
    const activateOne = async (id, ancestry = []) => {
      if (this.#active.has(id) || visited.has(id)) return;
      const addon = this.#addons.get(id);
      if (!addon) throw new Error(`Required Hodos add-on is not registered: ${id}`);
      if (visiting.has(id)) throw new Error(`Hodos add-on dependency cycle: ${[...ancestry, id].join(" -> ")}`);
      visiting.add(id);
      for (const dependency of Object.keys(addon.manifest.requires).sort()) {
        const installed = this.#addons.get(dependency);
        if (!installed) throw new Error(`Required Hodos add-on is not registered: ${dependency}`);
        const range = addon.manifest.requires[dependency];
        if (!satisfiesAddonVersion(installed.manifest.version, range)) {
          throw new Error(`Hodos add-on ${id} requires ${dependency} ${range}; registered ${installed.manifest.version}`);
        }
        await activateOne(dependency, [...ancestry, id]);
      }
      const missing = addon.manifest.capabilities.filter((capability) => !this.#capabilities.has(capability));
      if (missing.length) throw new Error(`Hodos add-on ${id} requires host capabilities: ${missing.join(", ")}`);

      const state = { addon, context: null, cleanup: null, disposers: [] };
      const context = this.#context(id, state);
      state.context = context;
      this.#active.set(id, state);
      try {
        const cleanup = await addon.activate?.(context);
        if (typeof cleanup === "function") state.cleanup = cleanup;
      } catch (error) {
        for (const dispose of [...state.disposers].reverse()) dispose();
        this.#active.delete(id);
        throw error;
      } finally {
        visiting.delete(id);
      }
      visited.add(id);
      this.emit("addon/activated", { id, manifest: addon.manifest });
    };
    for (const id of values(ids)) await activateOne(id);
    return this;
  }

  async deactivate(ids = [...this.#active.keys()].reverse(), { cascade = false } = {}) {
    const deactivateOne = async (id, seen = new Set()) => {
      if (seen.has(id) || !this.#active.has(id)) return;
      seen.add(id);
      const dependents = [...this.#active.values()]
        .filter(({ addon }) => Object.hasOwn(addon.manifest.requires, id))
        .map(({ addon }) => addon.manifest.id);
      if (dependents.length && !cascade) {
        throw new Error(`Cannot deactivate Hodos add-on ${id}; active dependents: ${dependents.join(", ")}`);
      }
      for (const dependent of dependents) await deactivateOne(dependent, seen);
      const state = this.#active.get(id);
      await state.cleanup?.();
      await state.addon.deactivate?.(state.context);
      for (const dispose of [...state.disposers].reverse()) dispose();
      this.#active.delete(id);
      this.emit("addon/deactivated", { id, manifest: state.addon.manifest });
    };
    for (const id of values(ids)) await deactivateOne(id);
    return this;
  }

  #context(owner, state) {
    const addon = this.#addons.get(owner);
    const declaredCapabilities = new Set(addon.manifest.capabilities);
    const hasScopedCapability = (capability) => (
      declaredCapabilities.has(capability) && this.#capabilities.has(capability)
    );
    return Object.freeze({
      addon: addon.manifest,
      capabilities: Object.freeze({
        has: hasScopedCapability,
        require: (capability) => {
          if (!declaredCapabilities.has(capability)) {
            throw new Error(`Hodos add-on ${owner} did not declare host capability: ${capability}`);
          }
          if (!this.#capabilities.has(capability)) throw new Error(`Host capability is not granted: ${capability}`);
          return true;
        },
        values: () => addon.manifest.capabilities.filter(hasScopedCapability),
      }),
      contribute: (kind, id, value) => {
        identifier(kind, "Contribution kind");
        identifier(id, "Contribution id");
        const entries = this.#contributions.get(kind) ?? new Map();
        if (entries.has(id)) throw new Error(`Hodos contribution is already registered: ${kind}/${id}`);
        const entry = Object.freeze({ kind, id, owner, value });
        entries.set(id, entry);
        this.#contributions.set(kind, entries);
        const dispose = () => {
          if (entries.get(id) === entry) entries.delete(id);
          if (!entries.size) this.#contributions.delete(kind);
        };
        state.disposers.push(dispose);
        return dispose;
      },
      getContribution: (kind, id) => this.getContribution(kind, id),
      listContributions: (kind) => this.listContributions(kind),
      emit: (event, payload) => this.emit(event, { owner, payload }),
      on: (event, listener) => {
        const dispose = this.on(event, listener);
        state.disposers.push(dispose);
        return dispose;
      },
    });
  }
}

export const createHodosHost = (options) => new HodosHost(options);

export const HODOS_CORE_ADDON_ID = "@greenways/hodos-core";

export const hodosCoreAddon = defineAddon({
  manifest: {
    id: HODOS_CORE_ADDON_ID,
    version: "0.1.0",
    requires: {},
    capabilities: [],
  },
  activate(context) {
    for (const namespace of [
      "gw.hodos.adaptor",
      "gw.hodos.bundle",
      "gw.hodos.package",
      "gw.hodos.scene",
      "gw.hodos.session",
    ]) context.contribute("hara.module", namespace, { namespace, package: "greenways/hodos-core" });
  },
});
