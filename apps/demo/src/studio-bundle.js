import { normalizeProject } from "./studio-export.js";

const BUNDLE_FORMAT = "hodos-studio-bundle";
const BUNDLE_VERSION = "0.1.0";
const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_HEADER = 0x06054b50;
const MAX_ENTRIES = 4096;
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

let crcTable;

function crc32(bytes) {
  if (!crcTable) {
    crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      return value >>> 0;
    });
  }
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("Studio project import requires ZIP bytes");
}

function safeBundlePath(value, label = "bundle path") {
  const path = String(value || "");
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new Error(`${label} must be a relative UTF-8 path`);
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} contains an unsafe path segment`);
  }
  return path;
}

function requireRange(bytes, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new Error(`${label} exceeds the ZIP file bounds`);
  }
}

function findEndRecord(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const earliest = Math.max(0, bytes.byteLength - 65557);
  for (let offset = bytes.byteLength - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) !== END_HEADER) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === bytes.byteLength) return offset;
  }
  throw new Error("Studio project ZIP is missing its end record");
}

export function readStoredZip(value, {
  maxEntries = MAX_ENTRIES,
  maxBytes = MAX_BUNDLE_BYTES,
} = {}) {
  const bytes = bytesOf(value);
  if (bytes.byteLength > maxBytes) throw new Error(`Studio project ZIP exceeds ${maxBytes} bytes`);
  if (bytes.byteLength < 22) throw new Error("Studio project ZIP is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndRecord(bytes);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (entryCount > maxEntries) throw new Error(`Studio project ZIP exceeds ${maxEntries} entries`);
  requireRange(bytes, centralOffset, centralSize, "ZIP central directory");
  if (centralOffset + centralSize > endOffset) throw new Error("Studio project ZIP central directory overlaps its end record");

  const files = new Map();
  let offset = 0;
  while (offset < centralOffset) {
    requireRange(bytes, offset, 30, "ZIP local header");
    const signature = view.getUint32(offset, true);
    if (signature === CENTRAL_HEADER) break;
    if (signature !== LOCAL_HEADER) throw new Error(`Studio project ZIP has an invalid local header at byte ${offset}`);
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const checksum = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if (flags & 0x0001) throw new Error("Encrypted studio project ZIP entries are not supported");
    if (flags & 0x0008) throw new Error("Streaming ZIP data descriptors are not supported");
    if (method !== 0) throw new Error("Studio project ZIP entries must use the stored method");
    if (compressedSize !== uncompressedSize) throw new Error("Stored studio project ZIP entry sizes do not match");
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    requireRange(bytes, nameStart, nameLength, "ZIP entry name");
    requireRange(bytes, dataStart, compressedSize, "ZIP entry data");
    let name;
    try {
      name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    } catch {
      throw new Error("Studio project ZIP contains an invalid UTF-8 entry name");
    }
    const path = safeBundlePath(name, "ZIP entry name");
    if (files.has(path)) throw new Error(`Studio project ZIP contains duplicate entry ${path}`);
    const data = bytes.slice(dataStart, dataStart + compressedSize);
    if (crc32(data) !== checksum) throw new Error(`Studio project ZIP entry ${path} failed its CRC check`);
    files.set(path, data);
    if (files.size > maxEntries) throw new Error(`Studio project ZIP exceeds ${maxEntries} entries`);
    offset = dataStart + compressedSize;
  }
  if (offset !== centralOffset) throw new Error("Studio project ZIP local entries do not align with its central directory");
  if (files.size !== entryCount) throw new Error("Studio project ZIP entry count does not match its directory");
  return files;
}

function jsonFile(files, path, label) {
  const bytes = files.get(path);
  if (!bytes) throw new Error(`Studio project bundle is missing ${path}`);
  if (bytes.byteLength > MAX_JSON_BYTES) throw new Error(`${label} exceeds ${MAX_JSON_BYTES} bytes`);
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON: ${error.message}`);
  }
}

function projectAssetMap(project) {
  const output = new Map();
  for (const asset of project.assets ?? []) {
    if (!asset?.id || typeof asset.id !== "string") throw new Error("Studio project asset requires a string id");
    if (output.has(asset.id)) throw new Error(`Studio project repeats asset ${asset.id}`);
    output.set(asset.id, asset);
  }
  return output;
}

export function readProjectBundle(value) {
  const files = readStoredZip(value);
  const manifest = jsonFile(files, "manifest.json", "Studio project manifest");
  if (manifest?.format !== BUNDLE_FORMAT || manifest?.version !== BUNDLE_VERSION) {
    throw new Error("Studio project bundle uses an unsupported format or version");
  }
  const projectPath = safeBundlePath(manifest.project, "Studio project manifest path");
  const project = normalizeProject(jsonFile(files, projectPath, "Studio project document"));
  if (!project?.id || typeof project.id !== "string") throw new Error("Studio project document requires an id");
  const assets = projectAssetMap(project);
  const manifestAssets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const entries = [];
  const seenIds = new Set();
  const seenPaths = new Set();

  for (const entry of manifestAssets) {
    if (!entry?.id || typeof entry.id !== "string") throw new Error("Studio project manifest asset requires an id");
    if (seenIds.has(entry.id)) throw new Error(`Studio project manifest repeats asset ${entry.id}`);
    const path = safeBundlePath(entry.path, `Studio project asset ${entry.id} path`);
    if (seenPaths.has(path)) throw new Error(`Studio project manifest repeats path ${path}`);
    const asset = assets.get(entry.id);
    if (!asset) throw new Error(`Studio project manifest references unknown asset ${entry.id}`);
    const bytes = files.get(path);
    if (!bytes) throw new Error(`Studio project bundle is missing audio payload ${path}`);
    if (entry.size !== undefined && Number(entry.size) !== bytes.byteLength) {
      throw new Error(`Studio project asset ${entry.id} size does not match its payload`);
    }
    asset.storage = { type: "bundle", path };
    entries.push({ asset, bytes });
    seenIds.add(entry.id);
    seenPaths.add(path);
  }
  for (const assetId of assets.keys()) {
    if (!seenIds.has(assetId)) throw new Error(`Studio project asset ${assetId} has no bundle payload`);
  }
  return { manifest, project, assets: entries, files };
}
