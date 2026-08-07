import { WORKSPACE_COMPONENT_CONTRACT } from "@greenways/hodos-web";

const nonEmptyString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
};

const optionalString = (value, label) => {
  if (value == null) return null;
  return nonEmptyString(value, label);
};

const selectionValue = (value = {}) => {
  const start = Number(value.start ?? 0);
  const end = Number(value.end ?? start);
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end < start) {
    throw new TypeError("Hodos Dev Editor selection must contain non-negative start/end offsets");
  }
  return Object.freeze({ start, end });
};

const REPL_ENTRY_KINDS = new Set(["input", "result", "stdout", "error", "diagnostic"]);
const REPL_STATUSES = new Set(["idle", "ready", "busy", "error", "closed"]);

const replEntryValue = (entry, index) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError(`Hodos Dev REPL entry ${index} must be an object`);
  }
  const kind = nonEmptyString(entry.kind, `Hodos Dev REPL entry ${index} kind`);
  if (!REPL_ENTRY_KINDS.has(kind)) {
    throw new Error(`Hodos Dev REPL entry ${index} has unsupported kind: ${kind}`);
  }
  if (typeof entry.text !== "string") {
    throw new TypeError(`Hodos Dev REPL entry ${index} text must be a string`);
  }
  return Object.freeze({
    id: optionalString(entry.id, `Hodos Dev REPL entry ${index} id`),
    kind,
    text: entry.text,
    namespace: optionalString(entry.namespace, `Hodos Dev REPL entry ${index} namespace`),
    requestId: optionalString(entry.requestId, `Hodos Dev REPL entry ${index} request id`),
  });
};

export const HODOS_DEV_PREVIEW_AREA_TYPE = "hodos.dev/preview";
export const HODOS_DEV_PREVIEW_COMPONENT_ID = "hodos.dev/preview";
export const HODOS_DEV_PREVIEW_EVENTS = Object.freeze([
  "preview/open-source",
  "preview/retry",
]);

export const HODOS_DEV_EDITOR_AREA_TYPE = "hodos.dev/editor";
export const HODOS_DEV_EDITOR_COMPONENT_ID = "hodos.dev/editor";
export const HODOS_DEV_EDITOR_EVENTS = Object.freeze([
  "editor/change",
  "editor/selection",
  "editor/eval",
  "editor/complete",
  "editor/command",
]);

export const HODOS_DEV_REPL_AREA_TYPE = "hodos.dev/repl";
export const HODOS_DEV_REPL_COMPONENT_ID = "hodos.dev/repl";
export const HODOS_DEV_REPL_EVENTS = Object.freeze([
  "repl/input",
  "repl/submit",
  "repl/clear",
  "repl/history",
  "repl/cancel",
]);

export function createPreviewArea({
  id = "preview/main",
  title = "Preview",
  output = null,
  document = null,
  theme = "system",
  viewport = null,
  events = HODOS_DEV_PREVIEW_EVENTS,
} = {}) {
  id = nonEmptyString(id, "Hodos Dev Preview area id");
  title = nonEmptyString(title, "Hodos Dev Preview title");
  return Object.freeze({
    "area/id": id,
    "area/type": HODOS_DEV_PREVIEW_AREA_TYPE,
    "area/title": title,
    "area/component": Object.freeze({
      "component/id": HODOS_DEV_PREVIEW_COMPONENT_ID,
      "component/contract": WORKSPACE_COMPONENT_CONTRACT,
      "component/model": Object.freeze({ output, document, theme, viewport }),
      "component/events": Object.freeze([...events]),
    }),
  });
}

export function createEditorArea({
  id = "editor/main",
  title = "Editor",
  documentId = null,
  path = null,
  source = "",
  version = 0,
  language = "hara",
  namespace = "user",
  readOnly = false,
  selection = { start: 0, end: 0 },
  diagnostics = [],
  completion = null,
  settings = {},
  events = HODOS_DEV_EDITOR_EVENTS,
} = {}) {
  id = nonEmptyString(id, "Hodos Dev Editor area id");
  title = nonEmptyString(title, "Hodos Dev Editor title");
  if (typeof source !== "string") throw new TypeError("Hodos Dev Editor source must be a string");
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new TypeError("Hodos Dev Editor version must be a non-negative integer");
  }
  if (typeof readOnly !== "boolean") throw new TypeError("Hodos Dev Editor readOnly must be boolean");
  if (!Array.isArray(diagnostics)) throw new TypeError("Hodos Dev Editor diagnostics must be an array");
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new TypeError("Hodos Dev Editor settings must be an object");
  }
  const model = Object.freeze({
    document: Object.freeze({
      id: optionalString(documentId, "Hodos Dev Editor document id"),
      path: optionalString(path, "Hodos Dev Editor path"),
      version,
      language: nonEmptyString(language, "Hodos Dev Editor language"),
      namespace: nonEmptyString(namespace, "Hodos Dev Editor namespace"),
    }),
    source,
    readOnly,
    selection: selectionValue(selection),
    diagnostics: Object.freeze([...diagnostics]),
    completion,
    settings: Object.freeze({ ...settings }),
  });
  return Object.freeze({
    "area/id": id,
    "area/type": HODOS_DEV_EDITOR_AREA_TYPE,
    "area/title": title,
    "area/component": Object.freeze({
      "component/id": HODOS_DEV_EDITOR_COMPONENT_ID,
      "component/contract": WORKSPACE_COMPONENT_CONTRACT,
      "component/model": model,
      "component/events": Object.freeze([...events]),
    }),
  });
}

export function createReplArea({
  id = "repl/main",
  title = "REPL",
  sessionId = null,
  namespace = "user",
  status = "idle",
  entries = [],
  input = "",
  history = [],
  historyIndex = history.length,
  canSubmit = status === "ready",
  events = HODOS_DEV_REPL_EVENTS,
} = {}) {
  id = nonEmptyString(id, "Hodos Dev REPL area id");
  title = nonEmptyString(title, "Hodos Dev REPL title");
  namespace = nonEmptyString(namespace, "Hodos Dev REPL namespace");
  status = nonEmptyString(status, "Hodos Dev REPL status");
  if (!REPL_STATUSES.has(status)) throw new Error(`Unsupported Hodos Dev REPL status: ${status}`);
  if (!Array.isArray(entries)) throw new TypeError("Hodos Dev REPL entries must be an array");
  if (typeof input !== "string") throw new TypeError("Hodos Dev REPL input must be a string");
  if (!Array.isArray(history) || history.some((value) => typeof value !== "string")) {
    throw new TypeError("Hodos Dev REPL history must be an array of strings");
  }
  if (!Number.isSafeInteger(historyIndex) || historyIndex < 0 || historyIndex > history.length) {
    throw new TypeError("Hodos Dev REPL historyIndex must address the history array");
  }
  if (typeof canSubmit !== "boolean") throw new TypeError("Hodos Dev REPL canSubmit must be boolean");
  const model = Object.freeze({
    session: Object.freeze({
      id: optionalString(sessionId, "Hodos Dev REPL session id"),
      status,
    }),
    namespace,
    entries: Object.freeze(entries.map(replEntryValue)),
    input,
    history: Object.freeze([...history]),
    historyIndex,
    canSubmit,
  });
  return Object.freeze({
    "area/id": id,
    "area/type": HODOS_DEV_REPL_AREA_TYPE,
    "area/title": title,
    "area/component": Object.freeze({
      "component/id": HODOS_DEV_REPL_COMPONENT_ID,
      "component/contract": WORKSPACE_COMPONENT_CONTRACT,
      "component/model": model,
      "component/events": Object.freeze([...events]),
    }),
  });
}
