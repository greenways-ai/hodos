const PROJECT_FORMAT = "hodos-studio-project";
const PROJECT_VERSION = "0.1.0";
const APP_DIRECTORY = "hodos-studio";
const ACTIVE_PROJECT_PATH = "state/active-project.txt";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function copyBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  throw new TypeError("Studio storage requires an ArrayBuffer or typed array");
}

function cloneData(value) {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function notFound(path) {
  const error = new Error(`Studio storage entry not found: ${path}`);
  error.name = "NotFoundError";
  return error;
}

function encoded(value) {
  return encodeURIComponent(String(value));
}

export class MemoryStudioBackend {
  constructor() {
    this.kind = "memory";
    this.persistent = false;
    this.files = new Map();
  }

  async prepare() {
    return { kind: this.kind, persistent: false, retained: false };
  }

  async write(path, value) {
    this.files.set(path, copyBytes(value));
  }

  async read(path) {
    const value = this.files.get(path);
    if (!value) throw notFound(path);
    return value.slice().buffer;
  }

  async remove(path) {
    this.files.delete(path);
  }
}

export class OpfsStudioBackend {
  constructor(storage = globalThis.navigator?.storage) {
    if (!storage?.getDirectory) throw new Error("Origin-private file storage is not available");
    this.kind = "opfs";
    this.persistent = true;
    this.storage = storage;
    this.rootPromise = null;
  }

  async prepare() {
    await this.root();
    let retained = null;
    if (typeof this.storage.persisted === "function") retained = await this.storage.persisted();
    if (!retained && typeof this.storage.persist === "function") retained = await this.storage.persist();
    return { kind: this.kind, persistent: true, retained: Boolean(retained) };
  }

  async root() {
    if (!this.rootPromise) {
      this.rootPromise = this.storage.getDirectory()
        .then((origin) => origin.getDirectoryHandle(APP_DIRECTORY, { create: true }));
    }
    return this.rootPromise;
  }

  async file(path, { create = false } = {}) {
    const parts = String(path).split("/").filter(Boolean);
    if (!parts.length) throw new Error("Studio storage path cannot be empty");
    let directory = await this.root();
    for (const part of parts.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(part, { create });
    }
    return directory.getFileHandle(parts.at(-1), { create });
  }

  async write(path, value) {
    const handle = await this.file(path, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(copyBytes(value));
    } finally {
      await writable.close();
    }
  }

  async read(path) {
    const handle = await this.file(path);
    return (await handle.getFile()).arrayBuffer();
  }

  async remove(path) {
    const parts = String(path).split("/").filter(Boolean);
    let directory = await this.root();
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
    await directory.removeEntry(parts.at(-1));
  }
}

export class StudioStore {
  constructor(backend) {
    if (!backend) throw new Error("StudioStore requires a storage backend");
    this.backend = backend;
    this.kind = backend.kind;
    this.persistent = backend.persistent;
  }

  async prepare() {
    return this.backend.prepare();
  }

  assetPath(id) {
    return `assets/${encoded(id)}.bin`;
  }

  projectPath(id) {
    return `projects/${encoded(id)}.json`;
  }

  async saveAsset(asset, value) {
    if (!asset?.id) throw new Error("Studio asset requires an id");
    const key = this.assetPath(asset.id);
    await this.backend.write(key, value);
    return { type: this.kind, key };
  }

  async readAsset(assetOrId) {
    const asset = typeof assetOrId === "object" ? assetOrId : null;
    const id = asset?.id ?? assetOrId;
    if (!id) throw new Error("Studio asset id is required");
    const key = asset?.storage?.key || this.assetPath(id);
    return this.backend.read(key);
  }

  async setActiveProject(id) {
    if (!id) throw new Error("Active studio project requires an id");
    await this.backend.write(ACTIVE_PROJECT_PATH, textEncoder.encode(String(id)));
  }

  async activeProjectId() {
    try {
      const value = textDecoder.decode(await this.backend.read(ACTIVE_PROJECT_PATH)).trim();
      return value || null;
    } catch (error) {
      if (error?.name === "NotFoundError") return null;
      throw error;
    }
  }

  async saveProject(project) {
    if (!project?.id) throw new Error("Studio project requires an id");
    const record = {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      savedAt: new Date().toISOString(),
      project: cloneData(project),
    };
    await this.backend.write(this.projectPath(project.id), textEncoder.encode(JSON.stringify(record)));
    await this.setActiveProject(project.id);
    return record;
  }

  async loadProject(id) {
    try {
      const bytes = await this.backend.read(this.projectPath(id));
      const record = JSON.parse(textDecoder.decode(bytes));
      if (record?.format !== PROJECT_FORMAT || record?.version !== PROJECT_VERSION) {
        throw new Error("Stored studio project uses an unsupported format");
      }
      if (!record.project || record.project.id !== id) {
        throw new Error("Stored studio project identity does not match its storage key");
      }
      return cloneData(record.project);
    } catch (error) {
      if (error?.name === "NotFoundError") return null;
      throw error;
    }
  }

  async loadActiveProject(fallbackId = "local/current") {
    const id = await this.activeProjectId();
    return this.loadProject(id || fallbackId);
  }
}

export function createStudioStore({ backend, storage = globalThis.navigator?.storage } = {}) {
  if (backend) return new StudioStore(backend);
  if (storage?.getDirectory) return new StudioStore(new OpfsStudioBackend(storage));
  return new StudioStore(new MemoryStudioBackend());
}
