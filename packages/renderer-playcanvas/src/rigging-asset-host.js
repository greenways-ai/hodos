import {
  acceptRiggingSource,
  createRiggingSource,
  normalizeRiggingSession,
  recordRiggingOpenFailure,
} from "@greenways/hodos-world-model/rigging";
import {
  GLB_PREFLIGHT_PROVIDER_ID,
  GLB_PREFLIGHT_PROVIDER_VERSION,
  GlbPreflightError,
  analyzeLocalGlb,
  toUint8Array,
} from "./rigging-glb-preflight.js";

function boundedText(value, fallback, maximumLength) {
  const text = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (text.length > maximumLength) return `${text.slice(0, maximumLength - 1)}…`;
  return text;
}

function safeByteLength(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function positiveSafeInteger(value, fallback, label) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return candidate;
}

async function readLocalBytes(source) {
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) return toUint8Array(source);
  if (source && typeof source.arrayBuffer === "function") {
    const buffer = await source.arrayBuffer();
    return toUint8Array(buffer);
  }
  throw new TypeError("Local rigging source must be an ArrayBuffer, typed array, File, or Blob-like value");
}

function cloneDocument(value) {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function safeDetails(error) {
  const details = {};
  if (typeof error?.path === "string" && error.path) details.path = boundedText(error.path, "$", 512);
  if (error?.details && typeof error.details === "object") {
    try {
      const cloned = cloneDocument(error.details);
      const encoded = JSON.stringify(cloned);
      if (encoded.length <= 3072) details.context = cloned;
    } catch {
      // The portable error boundary deliberately omits non-cloneable host details.
    }
  }
  return Object.keys(details).length ? details : null;
}

function structuredOpenError(error) {
  const details = safeDetails(error);
  return {
    code: boundedText(error?.code, "rig/open-failed", 128),
    message: boundedText(error?.message, "Unable to open the local GLB", 1024),
    ...(details ? { details } : {}),
  };
}

export class LocalRiggingAssetHost {
  constructor({
    id = "playcanvas-local-rigging",
    preflight = {},
    maximumAssets = 8,
    maximumTotalBytes = 512 * 1024 * 1024,
  } = {}) {
    this.id = boundedText(id, "playcanvas-local-rigging", 128);
    this.preflightOptions = Object.freeze({ ...preflight });
    this.maximumAssets = positiveSafeInteger(maximumAssets, 8, "maximumAssets");
    this.maximumTotalBytes = positiveSafeInteger(maximumTotalBytes, 512 * 1024 * 1024, "maximumTotalBytes");
    this.records = new Map();
    this.nextHandle = 1;
    this.destroyed = false;
  }

  async open(sessionValue, sourceValue, options = {}) {
    this.assertActive();
    const session = normalizeRiggingSession(sessionValue);
    const fileName = boundedText(options.fileName ?? sourceValue?.name, "asset.glb", 512);
    const mediaType = boundedText(options.mediaType ?? sourceValue?.type, "model/gltf-binary", 128);
    let ownedBytes = null;
    let byteLength = safeByteLength(sourceValue?.size);
    try {
      const sourceBytes = await readLocalBytes(sourceValue);
      byteLength = sourceBytes.byteLength;
      if (this.records.size >= this.maximumAssets) {
        throw new GlbPreflightError("rig/asset-capacity", "Local rigging asset host reached its bounded asset limit", {
          details: { assets: this.records.size, maximumAssets: this.maximumAssets },
        });
      }
      const totalBytes = this.totalBytes();
      if (totalBytes + byteLength > this.maximumTotalBytes) {
        throw new GlbPreflightError("rig/asset-byte-capacity", "Local rigging asset host reached its bounded byte limit", {
          details: { totalBytes, byteLength, maximumTotalBytes: this.maximumTotalBytes },
        });
      }
      ownedBytes = new Uint8Array(byteLength);
      ownedBytes.set(sourceBytes);
      const analysis = await analyzeLocalGlb(ownedBytes, {
        ...this.preflightOptions,
        ...(options.preflight ?? {}),
      });
      const handle = `rig-asset:${this.id}:${this.nextHandle++}`;
      const source = createRiggingSource({
        contentId: analysis.contentId,
        revision: 0,
        fileName,
        mediaType,
        byteLength,
        handle: { type: "rig/source-asset", id: handle, scope: "session" },
      });
      const nextSession = acceptRiggingSource(session, { source, preflight: analysis.preflight });
      this.records.set(handle, {
        bytes: ownedBytes,
        document: analysis.document,
        binaryChunk: analysis.binaryChunk,
        source,
        preflight: analysis.preflight,
      });
      ownedBytes = null;
      return Object.freeze({
        ok: true,
        handle,
        session: nextSession,
        source,
        preflight: analysis.preflight,
      });
    } catch (error) {
      if (ownedBytes) ownedBytes.fill(0);
      const failure = structuredOpenError(error);
      return Object.freeze({
        ok: false,
        handle: null,
        session: recordRiggingOpenFailure(session, {
          fileName,
          byteLength,
          sourceId: typeof error?.sourceId === "string" ? error.sourceId : null,
          error: failure,
        }),
        source: null,
        preflight: null,
        error: Object.freeze(failure),
      });
    }
  }

  has(handle) {
    return !this.destroyed && this.records.has(handle);
  }

  describe(handle) {
    const record = this.record(handle);
    return Object.freeze({ source: record.source, preflight: record.preflight });
  }

  readBytes(handle) {
    const record = this.record(handle);
    return new Uint8Array(record.bytes);
  }

  readDocument(handle) {
    return cloneDocument(this.record(handle).document);
  }

  release(handle) {
    this.assertActive();
    const record = this.records.get(handle);
    if (!record) return false;
    record.bytes.fill(0);
    this.records.delete(handle);
    return true;
  }

  totalBytes() {
    let total = 0;
    for (const record of this.records.values()) total += record.bytes.byteLength;
    return total;
  }

  evidence() {
    return Object.freeze({
      provider: { id: GLB_PREFLIGHT_PROVIDER_ID, version: GLB_PREFLIGHT_PROVIDER_VERSION },
      hostId: this.id,
      assets: this.records.size,
      totalBytes: this.totalBytes(),
      maximumAssets: this.maximumAssets,
      maximumTotalBytes: this.maximumTotalBytes,
      destroyed: this.destroyed,
    });
  }

  destroy() {
    if (this.destroyed) return;
    for (const record of this.records.values()) record.bytes.fill(0);
    this.records.clear();
    this.destroyed = true;
  }

  record(handle) {
    this.assertActive();
    const record = this.records.get(handle);
    if (!record) throw new GlbPreflightError("rig/asset-handle", `Unknown local rigging asset handle: ${handle}`);
    return record;
  }

  assertActive() {
    if (this.destroyed) throw new GlbPreflightError("rig/asset-host-destroyed", "Local rigging asset host was destroyed");
  }
}

export function createLocalRiggingAssetHost(options) {
  return new LocalRiggingAssetHost(options);
}
