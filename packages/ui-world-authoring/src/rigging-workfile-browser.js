import {
  createRigWorkfile,
  parseRigWorkfileJson,
  serializeRigWorkfileJson,
} from "@greenways/hodos-world-model/rigging";

export const DEFAULT_RIG_AUTOSAVE_DELAY = 750;
export const DEFAULT_RIG_AUTOSAVE_PREFIX = "hodos:rig-workfile:";

function requiredProvider(provider) {
  if (!provider || typeof provider.get !== "function" || typeof provider.set !== "function" || typeof provider.delete !== "function") {
    throw new TypeError("Rig workfile storage provider requires get, set, and delete functions");
  }
  return provider;
}

function sourceId(state) {
  const active = state?.session?.active?.source?.contentId ?? null;
  return active && active === state?.document?.assetId ? active : null;
}

export function rigWorkfileStorageKey(contentId, prefix = DEFAULT_RIG_AUTOSAVE_PREFIX) {
  if (typeof contentId !== "string" || !contentId.trim()) throw new TypeError("contentId must be a non-empty string");
  return `${prefix}${contentId.trim()}`;
}

export function createWebStorageRigWorkfileProvider(storage) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") {
    throw new TypeError("Web Storage provider requires getItem, setItem, and removeItem");
  }
  return {
    async get(key) { return storage.getItem(key); },
    async set(key, value) { storage.setItem(key, value); },
    async delete(key) { storage.removeItem(key); },
  };
}

export function createMemoryRigWorkfileProvider(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    async get(key) { return values.has(key) ? values.get(key) : null; },
    async set(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
    entries() { return [...values.entries()]; },
  };
}

export class RigWorkfileAutosave {
  constructor({
    provider,
    prefix = DEFAULT_RIG_AUTOSAVE_PREFIX,
    delay = DEFAULT_RIG_AUTOSAVE_DELAY,
    maximumBytes,
    timers = globalThis,
  } = {}) {
    this.provider = requiredProvider(provider);
    this.prefix = String(prefix);
    this.delay = Math.max(0, Number(delay) || 0);
    this.maximumBytes = maximumBytes;
    this.timers = timers;
    this.timer = null;
    this.pending = null;
    this.destroyed = false;
  }

  key(contentId) {
    return rigWorkfileStorageKey(contentId, this.prefix);
  }

  schedule(state, options = {}) {
    if (this.destroyed) return false;
    const contentId = sourceId(state);
    if (!contentId) return false;
    const workfile = createRigWorkfile(state, {
      includeEditor: options.includeEditor !== false,
      metadata: options.metadata ?? {},
      maximumBytes: this.maximumBytes,
    });
    this.pending = { contentId, workfile };
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => {});
    }, this.delay);
    return true;
  }

  async flush(state = null, options = {}) {
    if (this.destroyed) return { saved: false, reason: "destroyed" };
    if (state) {
      const contentId = sourceId(state);
      if (!contentId) return { saved: false, reason: "source-unavailable" };
      this.pending = {
        contentId,
        workfile: createRigWorkfile(state, {
          includeEditor: options.includeEditor !== false,
          metadata: options.metadata ?? {},
          maximumBytes: this.maximumBytes,
        }),
      };
    }
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    const pending = this.pending;
    if (!pending) return { saved: false, reason: "nothing-pending" };
    const text = serializeRigWorkfileJson(pending.workfile, { maximumBytes: this.maximumBytes });
    await this.provider.set(this.key(pending.contentId), text);
    this.pending = null;
    return { saved: true, contentId: pending.contentId, bytes: new TextEncoder().encode(text).byteLength };
  }

  async load(contentId) {
    if (this.destroyed) return null;
    const text = await this.provider.get(this.key(contentId));
    if (text === null || text === undefined || text === "") return null;
    return parseRigWorkfileJson(String(text), { maximumBytes: this.maximumBytes });
  }

  async remove(contentId) {
    if (this.destroyed) return false;
    await this.provider.delete(this.key(contentId));
    if (this.pending?.contentId === contentId) this.pending = null;
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }
}

export function createRigWorkfileAutosave(options = {}) {
  return new RigWorkfileAutosave(options);
}
