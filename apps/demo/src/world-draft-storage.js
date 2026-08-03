import { safeFilename, saveBlob } from "./studio-export.js";
import { createStudioStore } from "./studio-storage.js";

const RECORD_FORMAT = "hodos-world-draft-record";
const EXPORT_FORMAT = "hodos-world-draft-export";
const VERSION = "0.1.0";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let defaultStore;

function cloneData(value) {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function repositoryIdentity(repository) {
  if (typeof repository === "string") return repository;
  if (repository?.url) return repository.url;
  if (repository?.owner && repository?.repo) return `${repository.owner}/${repository.repo}`;
  throw new Error("World draft requires a repository identity");
}

export function worldDraftKey(identity) {
  const repository = repositoryIdentity(identity?.repository);
  const commit = String(identity?.commit || "").trim();
  const project = String(identity?.project?.id || "").trim();
  if (!commit) throw new Error("World draft requires an immutable commit");
  if (!project) throw new Error("World draft requires a project id");
  return `${repository}@${commit}#${project}`;
}

export function validateWorldDraft(draft) {
  if (!draft || typeof draft !== "object") throw new Error("World draft must be an object");
  if (draft.format !== "hodos-world-draft" || draft.version !== VERSION) {
    throw new Error("World draft uses an unsupported format or version");
  }
  if (!Number.isInteger(draft.revision) || draft.revision < 0) {
    throw new Error("World draft revision must be a non-negative integer");
  }
  if (!Array.isArray(draft.audioSources)) throw new Error("World draft audioSources must be an array");
  for (const [index, source] of draft.audioSources.entries()) {
    if (!source?.id || !source?.kind || !Array.isArray(source.position) || source.position.length !== 3) {
      throw new Error(`World draft source ${index} is invalid`);
    }
    if (source.position.some((value) => !Number.isFinite(value))) {
      throw new Error(`World draft source ${index} position must be finite`);
    }
  }
  return cloneData(draft);
}

export class WorldDraftStore {
  constructor(backend = createStudioStore().backend) {
    if (!backend) throw new Error("WorldDraftStore requires a storage backend");
    this.backend = backend;
    this.kind = backend.kind;
    this.persistent = backend.persistent;
  }

  async prepare() {
    return this.backend.prepare();
  }

  path(identity) {
    return `world-drafts/${encodeURIComponent(worldDraftKey(identity))}.json`;
  }

  async save(identity, draft) {
    const key = worldDraftKey(identity);
    const record = {
      format: RECORD_FORMAT,
      version: VERSION,
      world: key,
      savedAt: new Date().toISOString(),
      identity: cloneData(identity),
      draft: validateWorldDraft(draft),
    };
    await this.backend.write(this.path(identity), textEncoder.encode(JSON.stringify(record)));
    return record;
  }

  async load(identity) {
    const key = worldDraftKey(identity);
    try {
      const bytes = await this.backend.read(this.path(identity));
      const record = JSON.parse(textDecoder.decode(bytes));
      if (record?.format !== RECORD_FORMAT || record?.version !== VERSION) {
        throw new Error("Stored world draft uses an unsupported record format");
      }
      if (record.world !== key) throw new Error("Stored world draft identity does not match its key");
      return validateWorldDraft(record.draft);
    } catch (error) {
      if (error?.name === "NotFoundError") return null;
      throw error;
    }
  }
}

export function createWorldDraftStore({ backend } = {}) {
  if (backend) return new WorldDraftStore(backend);
  if (!defaultStore) defaultStore = new WorldDraftStore();
  return defaultStore;
}

export function worldDraftExport(identity, draft, { exportedAt = new Date().toISOString() } = {}) {
  return {
    format: EXPORT_FORMAT,
    version: VERSION,
    exportedAt,
    identity: cloneData(identity),
    draft: validateWorldDraft(draft),
  };
}

export async function saveWorldDraftFile(identity, draft) {
  const envelope = worldDraftExport(identity, draft);
  const project = safeFilename(identity?.project?.id || "hodos-world");
  const commit = safeFilename(String(identity?.commit || "draft").slice(0, 12));
  const name = `${project}-${commit}.hodos-world.json`;
  const bytes = textEncoder.encode(`${JSON.stringify(envelope, null, 2)}\n`);
  return saveBlob(new Blob([bytes], { type: "application/json" }), name);
}
