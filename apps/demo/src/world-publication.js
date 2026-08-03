import { safeFilename, saveBlob } from "./studio-export.js";
import { validateWorldDraft, worldDraftExport } from "./world-draft-storage.js";

export const REPOSITORY_PATCH_FORMAT = "hodos-repository-world-patch";
export const HESTIA_CONTRIBUTION_FORMAT = "hestia-room-contribution";
export const WORLD_PUBLICATION_VERSION = "0.1.0";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let defaultHestiaKeyStore;

function cloneData(value) {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function cryptoProvider(value = globalThis.crypto) {
  if (!value?.subtle) throw new Error("Web Crypto is required for world publication");
  return value;
}

function bytes(value) {
  if (typeof value === "string") return textEncoder.encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("Publication hashing requires text or bytes");
}

function hex(value) {
  return [...value].map((entry) => entry.toString(16).padStart(2, "0")).join("");
}

function base64url(value) {
  const data = bytes(value);
  let encoded;
  if (typeof globalThis.btoa === "function") {
    let binary = "";
    for (const entry of data) binary += String.fromCharCode(entry);
    encoded = globalThis.btoa(binary);
  } else if (globalThis.Buffer) {
    encoded = globalThis.Buffer.from(data).toString("base64");
  } else {
    throw new Error("Base64 encoding is not available");
  }
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64url(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  if (globalThis.Buffer) return new Uint8Array(globalThis.Buffer.from(padded, "base64"));
  throw new Error("Base64 decoding is not available");
}

export async function sha256(value, crypto = globalThis.crypto) {
  const digest = await cryptoProvider(crypto).subtle.digest("SHA-256", bytes(value));
  return `sha256:${hex(new Uint8Array(digest))}`;
}

function slug(value, fallback = "hodos-world") {
  return safeFilename(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function additionPatch(path, content) {
  const lines = String(content).replace(/\n$/, "").split("\n");
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

export async function createRepositoryPatch(identity, draft, {
  createdAt = new Date().toISOString(),
  crypto = globalThis.crypto,
} = {}) {
  const validated = validateWorldDraft(draft);
  const exportEnvelope = worldDraftExport(identity, validated, { exportedAt: createdAt });
  const document = {
    format: REPOSITORY_PATCH_FORMAT,
    version: WORLD_PUBLICATION_VERSION,
    createdAt,
    base: cloneData(identity),
    worldDraft: exportEnvelope,
  };
  const content = `${JSON.stringify(document, null, 2)}\n`;
  const digest = await sha256(content, crypto);
  const shortDigest = digest.slice("sha256:".length, "sha256:".length + 12);
  const project = slug(identity?.project?.id);
  const path = `world/drafts/${project}-r${validated.revision}-${shortDigest}.hodos-world.json`;
  const patch = additionPatch(path, content);
  return {
    target: "repository",
    format: REPOSITORY_PATCH_FORMAT,
    version: WORLD_PUBLICATION_VERSION,
    createdAt,
    digest,
    path,
    patch,
    filename: `${project}-r${validated.revision}-${shortDigest}.patch`,
  };
}

export async function saveRepositoryPatch(identity, draft, options = {}) {
  const artifact = await createRepositoryPatch(identity, draft, options);
  const save = await saveBlob(new Blob([artifact.patch], { type: "text/x-diff" }), artifact.filename);
  return { ...artifact, save };
}

async function generateKeyPair(crypto) {
  return cryptoProvider(crypto).subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
}

export class MemoryHestiaKeyStore {
  constructor({ crypto = globalThis.crypto } = {}) {
    this.crypto = cryptoProvider(crypto);
    this.keys = new Map();
  }

  async getOrCreate(id = "local/default") {
    if (!this.keys.has(id)) this.keys.set(id, await generateKeyPair(this.crypto));
    return this.keys.get(id);
  }
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

export class IndexedDbHestiaKeyStore {
  constructor({
    indexedDB = globalThis.indexedDB,
    crypto = globalThis.crypto,
    database = "hodos-identities",
  } = {}) {
    this.indexedDB = indexedDB;
    this.crypto = cryptoProvider(crypto);
    this.database = database;
    this.fallback = new MemoryHestiaKeyStore({ crypto: this.crypto });
    this.databasePromise = null;
  }

  async open() {
    if (!this.indexedDB) return null;
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = this.indexedDB.open(this.database, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("keys")) {
            request.result.createObjectStore("keys", { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Could not open the Hodos identity store"));
      });
    }
    return this.databasePromise;
  }

  async getOrCreate(id = "local/default") {
    const database = await this.open();
    if (!database) return this.fallback.getOrCreate(id);
    const read = database.transaction("keys", "readonly");
    const existing = await requestValue(read.objectStore("keys").get(id));
    if (existing?.privateKey && existing?.publicKey) {
      return { privateKey: existing.privateKey, publicKey: existing.publicKey };
    }

    const pair = await generateKeyPair(this.crypto);
    const write = database.transaction("keys", "readwrite");
    write.objectStore("keys").put({
      id,
      createdAt: new Date().toISOString(),
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
    });
    await transactionDone(write);
    return pair;
  }
}

export function createHestiaKeyStore(options = {}) {
  if (options.keyStore) return options.keyStore;
  if (!defaultHestiaKeyStore) defaultHestiaKeyStore = new IndexedDbHestiaKeyStore(options);
  return defaultHestiaKeyStore;
}

function roomId(value) {
  const room = String(value || "").trim();
  if (!room || room.length > 256 || /[\u0000-\u001f]/.test(room)) {
    throw new Error("A valid Hestia room identifier is required");
  }
  return room;
}

export async function createHestiaContribution(identity, draft, room, {
  createdAt = new Date().toISOString(),
  keyId = "local/default",
  keyStore = createHestiaKeyStore(),
  crypto = globalThis.crypto,
} = {}) {
  const provider = cryptoProvider(crypto);
  const validated = validateWorldDraft(draft);
  const unsigned = {
    format: HESTIA_CONTRIBUTION_FORMAT,
    version: WORLD_PUBLICATION_VERSION,
    room: roomId(room),
    kind: "hodos/world-draft",
    createdAt,
    subject: cloneData(identity),
    payload: worldDraftExport(identity, validated, { exportedAt: createdAt }),
  };
  const canonical = canonicalJson(unsigned);
  const payloadDigest = await sha256(canonical, provider);
  const pair = await keyStore.getOrCreate(keyId);
  const publicKeyJwk = await provider.subtle.exportKey("jwk", pair.publicKey);
  const publicDigest = await sha256(canonicalJson(publicKeyJwk), provider);
  const signature = await provider.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    textEncoder.encode(canonical),
  );
  return {
    ...unsigned,
    proof: {
      type: "HestiaDataIntegrityProof",
      cryptosuite: "ecdsa-p256-sha256",
      createdAt,
      verificationMethod: `hestia:key:${publicDigest.slice("sha256:".length)}`,
      publicKeyJwk,
      payloadDigest,
      signature: base64url(signature),
    },
  };
}

export async function verifyHestiaContribution(contribution, { crypto = globalThis.crypto } = {}) {
  const provider = cryptoProvider(crypto);
  if (contribution?.format !== HESTIA_CONTRIBUTION_FORMAT || contribution?.version !== WORLD_PUBLICATION_VERSION) {
    throw new Error("Hestia contribution uses an unsupported format or version");
  }
  const proof = contribution.proof;
  if (proof?.cryptosuite !== "ecdsa-p256-sha256" || !proof.publicKeyJwk || !proof.signature) {
    throw new Error("Hestia contribution proof is incomplete");
  }
  const { proof: _removed, ...unsigned } = contribution;
  const canonical = canonicalJson(unsigned);
  const digest = await sha256(canonical, provider);
  if (digest !== proof.payloadDigest) return false;
  const publicKey = await provider.subtle.importKey(
    "jwk",
    proof.publicKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return provider.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    fromBase64url(proof.signature),
    textEncoder.encode(canonical),
  );
}

export async function saveHestiaContribution(identity, draft, room, options = {}) {
  const contribution = await createHestiaContribution(identity, draft, room, options);
  const digest = await sha256(canonicalJson(contribution), options.crypto || globalThis.crypto);
  const project = slug(identity?.project?.id);
  const filename = `${project}-${slug(room, "hestia-room")}-${digest.slice("sha256:".length, "sha256:".length + 12)}.hestia-contribution.json`;
  const content = `${JSON.stringify(contribution, null, 2)}\n`;
  const save = await saveBlob(new Blob([content], { type: "application/json" }), filename);
  return {
    target: "hestia",
    format: HESTIA_CONTRIBUTION_FORMAT,
    version: WORLD_PUBLICATION_VERSION,
    createdAt: contribution.createdAt,
    room: contribution.room,
    digest,
    verificationMethod: contribution.proof.verificationMethod,
    filename,
    save,
  };
}

export function decodePublicationText(value) {
  return textDecoder.decode(bytes(value));
}
