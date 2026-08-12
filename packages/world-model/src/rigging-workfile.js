import {
  createRigAuthoringState,
  normalizeRigEditor,
} from "./rigging-editor.js";
import {
  normalizeRigDocument,
} from "./rigging-validation.js";
import {
  clonePortable,
  isPlainObject,
  optionalString,
  requiredString,
  safeInteger,
} from "./rigging-values.js";

export const RIG_WORKFILE_SCHEMA = "hodos.rig-workfile/0-alpha";
export const RIG_WORKFILE_RESULT_SCHEMA = "hodos.rig-workfile-result/0-alpha";
export const RIG_WORKFILE_MISMATCH_POLICIES = Object.freeze(["reject", "rebind"]);
export const DEFAULT_RIG_WORKFILE_MAX_BYTES = 2 * 1024 * 1024;
export const MAX_RIG_WORKFILE_MAX_BYTES = 16 * 1024 * 1024;

const encoder = new TextEncoder();

function utf8Length(value) {
  return encoder.encode(String(value)).byteLength;
}

function boundedBytes(value, maximumBytes, label) {
  const bytes = utf8Length(value);
  if (bytes > maximumBytes) throw new RangeError(`${label} exceeds the bounded limit of ${maximumBytes} bytes`);
  return bytes;
}

function normalizedMaximumBytes(value) {
  return Math.min(
    MAX_RIG_WORKFILE_MAX_BYTES,
    safeInteger(value, DEFAULT_RIG_WORKFILE_MAX_BYTES, "maximumBytes", 256),
  );
}

function canonicalPortable(value) {
  if (Array.isArray(value)) return value.map(canonicalPortable);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalPortable(value[key])]));
}

function normalizedMetadata(value = {}) {
  if (!isPlainObject(value)) throw new TypeError("workfile.metadata must be an object");
  const metadata = clonePortable(value);
  boundedBytes(JSON.stringify(metadata), 32 * 1024, "workfile.metadata");
  return canonicalPortable(metadata);
}

function normalizedSource(value, document) {
  if (!isPlainObject(value)) throw new TypeError("workfile.source must be an object");
  const contentId = requiredString(value.contentId, "workfile.source.contentId");
  if (contentId !== document.assetId) {
    throw new RangeError("Workfile source identity must match document.assetId");
  }
  return {
    contentId,
    fileName: optionalString(value.fileName, "workfile.source.fileName"),
    mediaType: optionalString(value.mediaType, "workfile.source.mediaType"),
  };
}

function normalizedHistory(value = {}) {
  if (!isPlainObject(value)) throw new TypeError("workfile.history must be an object");
  const limit = safeInteger(value.limit, 64, "workfile.history.limit", 1);
  if (limit > 256) throw new RangeError("workfile.history.limit cannot exceed 256");
  return { limit };
}

export function normalizeRigWorkfile(value, { maximumBytes = DEFAULT_RIG_WORKFILE_MAX_BYTES } = {}) {
  if (!isPlainObject(value)) throw new TypeError("Rig workfile must be an object");
  clonePortable(value);
  if (value.schema !== RIG_WORKFILE_SCHEMA) {
    throw new TypeError(`Rig workfile schema must be ${RIG_WORKFILE_SCHEMA}`);
  }
  const document = normalizeRigDocument(value.document);
  const source = normalizedSource(value.source, document);
  const editor = value.editor === null || value.editor === undefined
    ? null
    : normalizeRigEditor(value.editor, document);
  const workfile = {
    schema: RIG_WORKFILE_SCHEMA,
    source,
    document,
    editor,
    history: normalizedHistory(value.history),
    metadata: normalizedMetadata(value.metadata),
  };
  boundedBytes(JSON.stringify(workfile), normalizedMaximumBytes(maximumBytes), "Rig workfile");
  return workfile;
}

export function createRigWorkfile(stateValue, {
  includeEditor = true,
  metadata = {},
  maximumBytes = DEFAULT_RIG_WORKFILE_MAX_BYTES,
} = {}) {
  const state = createRigAuthoringState(stateValue);
  const activeSource = state.session?.active?.source ?? null;
  const sourceMatches = activeSource?.contentId === state.document.assetId;
  return normalizeRigWorkfile({
    schema: RIG_WORKFILE_SCHEMA,
    source: {
      contentId: state.document.assetId,
      fileName: sourceMatches ? activeSource.fileName ?? null : null,
      mediaType: sourceMatches ? activeSource.mediaType ?? null : null,
    },
    document: state.document,
    editor: includeEditor ? state.editor : null,
    history: { limit: state.history.limit },
    metadata,
  }, { maximumBytes });
}

export function serializeRigWorkfileJson(value, {
  space = 2,
  maximumBytes = DEFAULT_RIG_WORKFILE_MAX_BYTES,
} = {}) {
  const workfile = normalizeRigWorkfile(value, { maximumBytes });
  const text = `${JSON.stringify(canonicalPortable(workfile), null, Math.max(0, Math.min(8, Number(space) || 0)))}\n`;
  boundedBytes(text, normalizedMaximumBytes(maximumBytes), "Rig workfile JSON");
  return text;
}

function ednValue(value) {
  if (value === null) return "nil";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(ednValue).join(" ")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)} ${ednValue(value[key])}`).join(" ")}}`;
  }
  throw new TypeError(`Unsupported EDN-compatible value: ${typeof value}`);
}

export function serializeRigWorkfileEdn(value, {
  maximumBytes = DEFAULT_RIG_WORKFILE_MAX_BYTES,
} = {}) {
  const workfile = normalizeRigWorkfile(value, { maximumBytes });
  const text = `${ednValue(canonicalPortable(workfile))}\n`;
  boundedBytes(text, normalizedMaximumBytes(maximumBytes), "Rig workfile EDN");
  return text;
}

export function parseRigWorkfileJson(textValue, {
  maximumBytes = DEFAULT_RIG_WORKFILE_MAX_BYTES,
} = {}) {
  if (typeof textValue !== "string") throw new TypeError("Rig workfile JSON must be text");
  boundedBytes(textValue, normalizedMaximumBytes(maximumBytes), "Rig workfile JSON");
  let value;
  try {
    value = JSON.parse(textValue);
  } catch (error) {
    throw new SyntaxError(`Invalid rig workfile JSON: ${error.message}`);
  }
  return normalizeRigWorkfile(value, { maximumBytes });
}

function failure(state, code, message, details = {}) {
  return {
    schema: RIG_WORKFILE_RESULT_SCHEMA,
    ok: false,
    state,
    event: null,
    error: { code, message, details: clonePortable(details) },
    warnings: [],
  };
}

function activeSourceId(state, explicitValue) {
  return optionalString(explicitValue, "activeSourceId")
    ?? optionalString(state.session?.active?.source?.contentId, "state.session.active.source.contentId");
}

function rebindDocument(documentValue, nextAssetId) {
  const document = normalizeRigDocument(documentValue);
  if (document.revision === Number.MAX_SAFE_INTEGER) throw new RangeError("Rig revision cannot be advanced for source rebinding");
  return normalizeRigDocument({
    ...document,
    assetId: nextAssetId,
    revision: document.revision + 1,
    skin: { ...document.skin, weightSetId: null },
    bind: { ...document.bind, inverseMatricesId: null },
  });
}

export function prepareRigWorkfileRestore(stateValue, workfileValue, {
  activeSourceId: explicitSourceId = null,
  mismatchPolicy = "reject",
  maximumBytes = DEFAULT_RIG_WORKFILE_MAX_BYTES,
} = {}) {
  const state = createRigAuthoringState(stateValue);
  if (!RIG_WORKFILE_MISMATCH_POLICIES.includes(mismatchPolicy)) {
    return failure(state, "rig/workfile-policy", `Unsupported workfile mismatch policy: ${mismatchPolicy}`);
  }
  let workfile;
  try {
    workfile = typeof workfileValue === "string"
      ? parseRigWorkfileJson(workfileValue, { maximumBytes })
      : normalizeRigWorkfile(workfileValue, { maximumBytes });
  } catch (error) {
    return failure(state, "rig/workfile-invalid", error.message || String(error));
  }
  const activeId = activeSourceId(state, explicitSourceId);
  if (!activeId) {
    return failure(state, "rig/workfile-source-required", "Open the source GLB before restoring its rig workfile", {
      savedSourceId: workfile.source.contentId,
    });
  }
  const savedId = workfile.source.contentId;
  const mismatched = savedId !== activeId;
  if (mismatched && mismatchPolicy === "reject") {
    return failure(state, "rig/workfile-source-mismatch", "The rig workfile belongs to a different source asset", {
      savedSourceId: savedId,
      activeSourceId: activeId,
    });
  }
  let document = workfile.document;
  const warnings = [];
  if (mismatched) {
    try {
      document = rebindDocument(document, activeId);
    } catch (error) {
      return failure(state, "rig/workfile-rebind-failed", error.message || String(error), {
        savedSourceId: savedId,
        activeSourceId: activeId,
      });
    }
    warnings.push({
      code: "rig/workfile-source-rebound",
      message: "The skeleton was rebound to the active source; accepted skin and inverse-bind artifacts were cleared",
    });
  }
  const editor = normalizeRigEditor(workfile.editor ?? {}, document);
  const event = {
    "event/type": "rig/authoring-replace",
    reason: "rig/workfile-restore",
    sourceContentId: activeId,
    sourcePolicy: mismatched ? "rebind" : "match",
    document,
    editor,
    history: { limit: workfile.history.limit },
  };
  return {
    schema: RIG_WORKFILE_RESULT_SCHEMA,
    ok: true,
    state,
    event,
    workfile,
    source: {
      savedSourceId: savedId,
      activeSourceId: activeId,
      rebound: mismatched,
    },
    warnings,
    error: null,
  };
}
