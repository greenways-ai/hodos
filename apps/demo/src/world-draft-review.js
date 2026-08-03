import { validateWorldDraft, worldDraftKey } from "./world-draft-storage.js";

export const WORLD_DRAFT_IMPORT_FORMAT = "hodos-world-draft-export";
export const WORLD_DRAFT_IMPORT_VERSION = "0.1.0";
export const WORLD_DRAFT_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

const textEncoder = new TextEncoder();

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

export function stableJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function uniqueSourceMap(sources, label) {
  const map = new Map();
  for (const source of sources ?? []) {
    if (map.has(source.id)) throw new Error(`${label} contains duplicate source id: ${source.id}`);
    map.set(source.id, source);
  }
  return map;
}

function fieldChanges(before, after) {
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  keys.delete("id");
  return [...keys].sort().flatMap((field) => {
    const left = before?.[field];
    const right = after?.[field];
    return stableJson(left) === stableJson(right)
      ? []
      : [{ field, before: cloneData(left), after: cloneData(right) }];
  });
}

export function diffWorldDrafts(currentDraft, candidateDraft) {
  const current = validateWorldDraft(currentDraft);
  const candidate = validateWorldDraft(candidateDraft);
  const before = uniqueSourceMap(current.audioSources, "Current draft");
  const after = uniqueSourceMap(candidate.audioSources, "Imported draft");
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes = [];

  for (const id of ids) {
    const previous = before.get(id);
    const next = after.get(id);
    if (!previous) {
      changes.push({
        id: `source:${id}`,
        op: "add",
        source: id,
        label: next.label || id,
        before: null,
        after: cloneData(next),
        fields: fieldChanges(null, next),
      });
    } else if (!next) {
      changes.push({
        id: `source:${id}`,
        op: "remove",
        source: id,
        label: previous.label || id,
        before: cloneData(previous),
        after: null,
        fields: fieldChanges(previous, null),
      });
    } else if (stableJson(previous) !== stableJson(next)) {
      changes.push({
        id: `source:${id}`,
        op: "replace",
        source: id,
        label: next.label || previous.label || id,
        before: cloneData(previous),
        after: cloneData(next),
        fields: fieldChanges(previous, next),
      });
    }
  }

  return {
    changes,
    summary: {
      add: changes.filter(({ op }) => op === "add").length,
      remove: changes.filter(({ op }) => op === "remove").length,
      replace: changes.filter(({ op }) => op === "replace").length,
      unchanged: ids.length - changes.length,
    },
  };
}

function proposalId() {
  return `proposal-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

export function parseWorldDraftProposal(source, {
  expectedIdentity,
  currentDraft,
  id = proposalId(),
} = {}) {
  const text = String(source);
  if (textEncoder.encode(text).byteLength > WORLD_DRAFT_IMPORT_MAX_BYTES) {
    throw new Error(`World draft import exceeds ${WORLD_DRAFT_IMPORT_MAX_BYTES} bytes`);
  }

  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch (error) {
    throw new Error(`World draft import is not valid JSON: ${error.message}`);
  }
  if (envelope?.format !== WORLD_DRAFT_IMPORT_FORMAT || envelope?.version !== WORLD_DRAFT_IMPORT_VERSION) {
    throw new Error("World draft import uses an unsupported format or version");
  }
  if (!envelope.identity) throw new Error("World draft import is missing its world identity");
  if (!expectedIdentity) throw new Error("World draft import requires the active world identity");
  if (worldDraftKey(envelope.identity) !== worldDraftKey(expectedIdentity)) {
    throw new Error("World draft import targets a different repository commit or project");
  }

  const candidate = validateWorldDraft(envelope.draft);
  const current = validateWorldDraft(currentDraft);
  const { changes, summary } = diffWorldDrafts(current, candidate);
  if (!changes.length) throw new Error("World draft import contains no semantic changes");

  return {
    format: "hodos-world-draft-proposal",
    version: "0.1.0",
    id,
    importedAt: new Date().toISOString(),
    exportedAt: envelope.exportedAt || null,
    identity: cloneData(envelope.identity),
    baseRevision: current.revision,
    candidate,
    changes,
    selected: changes.map((change) => change.id),
    summary,
  };
}

export async function readWorldDraftProposal(file, options = {}) {
  if (!file || typeof file.text !== "function") throw new Error("Choose a .hodos-world.json file to import");
  if (Number.isFinite(file.size) && file.size > WORLD_DRAFT_IMPORT_MAX_BYTES) {
    throw new Error(`World draft import exceeds ${WORLD_DRAFT_IMPORT_MAX_BYTES} bytes`);
  }
  return parseWorldDraftProposal(await file.text(), options);
}
