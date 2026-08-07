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

const pathValue = (value = [], label = "Hodos Dev value path") => {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return Object.freeze(value.map((segment, index) => {
    if (typeof segment === "string") return segment;
    if (Number.isSafeInteger(segment) && segment >= 0) return segment;
    throw new TypeError(`${label} segment ${index} must be a string or non-negative integer`);
  }));
};

const serializableValue = (value, label, ancestors = new Set()) => {
  if (value == null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} numbers must be finite`);
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${label} must contain only serializable values`);
  }
  if (ancestors.has(value)) throw new TypeError(`${label} must not contain cycles`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((entry, index) =>
        serializableValue(entry, `${label}[${index}]`, ancestors)));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} objects must be plain`);
    }
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      Object.defineProperty(output, key, {
        value: serializableValue(entry, `${label}.${key}`, ancestors),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(output);
  } finally {
    ancestors.delete(value);
  }
};

const REPL_ENTRY_KINDS = new Set(["input", "result", "stdout", "error", "diagnostic"]);
const REPL_STATUSES = new Set(["idle", "ready", "busy", "error", "closed"]);
const VALUE_INSPECTOR_STATUSES = new Set(["idle", "loading", "ready", "error"]);


const PROBLEM_SEVERITIES = new Set(["error", "warning", "info", "hint"]);
const PROBLEM_STATUSES = new Set(["idle", "collecting", "ready", "error"]);

const problemPositionValue = (value = {}, label = "Hodos Dev Problems position") => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const line = Number(value.line ?? 0);
  const column = Number(value.column ?? 0);
  const offset = value.offset == null ? null : Number(value.offset);
  if (!Number.isSafeInteger(line) || line < 0 || !Number.isSafeInteger(column) || column < 0) {
    throw new TypeError(`${label} line and column must be non-negative integers`);
  }
  if (offset != null && (!Number.isSafeInteger(offset) || offset < 0)) {
    throw new TypeError(`${label} offset must be a non-negative integer`);
  }
  return Object.freeze({ line, column, offset });
};

const problemRangeValue = (value, label = "Hodos Dev Problems range") => {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const start = problemPositionValue(value.start ?? {}, `${label} start`);
  const end = problemPositionValue(value.end ?? value.start ?? {}, `${label} end`);
  const endBeforeStart = end.line < start.line
    || (end.line === start.line && end.column < start.column)
    || (start.offset != null && end.offset != null && end.offset < start.offset);
  if (endBeforeStart) throw new TypeError(`${label} end must not precede start`);
  return Object.freeze({ start, end });
};

const problemTagsValue = (value = [], label = "Hodos Dev Problems tags") => {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return Object.freeze([
    ...new Set(value.map((entry, index) => nonEmptyString(entry, `${label} ${index}`))),
  ]);
};

const problemEntryValue = (entry, index) => {
  const label = `Hodos Dev Problems entry ${index}`;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError(`${label} must be an object`);
  }
  const severity = nonEmptyString(entry.severity ?? "error", `${label} severity`);
  if (!PROBLEM_SEVERITIES.has(severity)) {
    throw new Error(`${label} has unsupported severity: ${severity}`);
  }
  const metadata = entry.metadata ?? {};
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError(`${label} metadata must be an object`);
  }
  return Object.freeze({
    id: nonEmptyString(entry.id, `${label} id`),
    severity,
    message: nonEmptyString(entry.message, `${label} message`),
    code: optionalString(entry.code, `${label} code`),
    source: optionalString(entry.source, `${label} source`),
    path: optionalString(entry.path, `${label} path`),
    namespace: optionalString(entry.namespace, `${label} namespace`),
    requestId: optionalString(entry.requestId, `${label} request id`),
    range: problemRangeValue(entry.range, `${label} range`),
    tags: problemTagsValue(entry.tags, `${label} tags`),
    metadata: serializableValue(metadata, `${label} metadata`),
  });
};

const problemFilterValue = (value = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hodos Dev Problems filter must be an object");
  }
  const severity = nonEmptyString(value.severity ?? "all", "Hodos Dev Problems filter severity");
  if (severity !== "all" && !PROBLEM_SEVERITIES.has(severity)) {
    throw new Error(`Unsupported Hodos Dev Problems filter severity: ${severity}`);
  }
  if (typeof (value.query ?? "") !== "string") {
    throw new TypeError("Hodos Dev Problems filter query must be a string");
  }
  return Object.freeze({ severity, query: value.query ?? "" });
};

const problemCountsValue = (problems) => {
  const counts = { total: problems.length, error: 0, warning: 0, info: 0, hint: 0 };
  for (const problem of problems) counts[problem.severity] += 1;
  return Object.freeze(counts);
};

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
    valueId: optionalString(entry.valueId, `Hodos Dev REPL entry ${index} value id`),
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
  "repl/inspect",
]);

export const HODOS_DEV_VALUE_INSPECTOR_AREA_TYPE = "hodos.dev/value-inspector";
export const HODOS_DEV_VALUE_INSPECTOR_COMPONENT_ID = "hodos.dev/value-inspector";
export const HODOS_DEV_VALUE_INSPECTOR_EVENTS = Object.freeze([
  "value/select",
  "value/toggle",
  "value/copy",
  "value/refresh",
  "value/close",
]);


export const HODOS_DEV_PROBLEMS_AREA_TYPE = "hodos.dev/problems";
export const HODOS_DEV_PROBLEMS_COMPONENT_ID = "hodos.dev/problems";
export const HODOS_DEV_PROBLEMS_EVENTS = Object.freeze([
  "problems/select",
  "problems/open-source",
  "problems/filter",
  "problems/clear",
  "problems/copy",
  "problems/close",
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

export function createValueInspectorArea({
  id = "value/main",
  title = "Value Inspector",
  valueId = null,
  requestId = null,
  status = valueId ? "ready" : "idle",
  display = "",
  value = null,
  valueType = null,
  namespace = null,
  source = null,
  path = [],
  expanded = [],
  metadata = {},
  error = null,
  events = HODOS_DEV_VALUE_INSPECTOR_EVENTS,
} = {}) {
  id = nonEmptyString(id, "Hodos Dev Value Inspector area id");
  title = nonEmptyString(title, "Hodos Dev Value Inspector title");
  status = nonEmptyString(status, "Hodos Dev Value Inspector status");
  if (!VALUE_INSPECTOR_STATUSES.has(status)) {
    throw new Error(`Unsupported Hodos Dev Value Inspector status: ${status}`);
  }
  if (typeof display !== "string") {
    throw new TypeError("Hodos Dev Value Inspector display must be a string");
  }
  if (!Array.isArray(expanded)) {
    throw new TypeError("Hodos Dev Value Inspector expanded paths must be an array");
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("Hodos Dev Value Inspector metadata must be an object");
  }

  const model = Object.freeze({
    value: Object.freeze({
      id: optionalString(valueId, "Hodos Dev Value Inspector value id"),
      requestId: optionalString(requestId, "Hodos Dev Value Inspector request id"),
      type: optionalString(valueType, "Hodos Dev Value Inspector value type"),
      display,
      data: serializableValue(value, "Hodos Dev Value Inspector value"),
    }),
    context: Object.freeze({
      namespace: optionalString(namespace, "Hodos Dev Value Inspector namespace"),
      source: optionalString(source, "Hodos Dev Value Inspector source"),
    }),
    status,
    path: pathValue(path),
    expanded: Object.freeze(expanded.map((entry, index) =>
      pathValue(entry, `Hodos Dev Value Inspector expanded path ${index}`))),
    metadata: serializableValue(metadata, "Hodos Dev Value Inspector metadata"),
    error: optionalString(error, "Hodos Dev Value Inspector error"),
  });

  return Object.freeze({
    "area/id": id,
    "area/type": HODOS_DEV_VALUE_INSPECTOR_AREA_TYPE,
    "area/title": title,
    "area/component": Object.freeze({
      "component/id": HODOS_DEV_VALUE_INSPECTOR_COMPONENT_ID,
      "component/contract": WORKSPACE_COMPONENT_CONTRACT,
      "component/model": model,
      "component/events": Object.freeze([...events]),
    }),
  });
}

export function createProblemsArea({
  id = "problems/main",
  title = "Problems",
  status = "idle",
  problems = [],
  selectedId = null,
  filter = {},
  canClear = problems.length > 0,
  metadata = {},
  events = HODOS_DEV_PROBLEMS_EVENTS,
} = {}) {
  id = nonEmptyString(id, "Hodos Dev Problems area id");
  title = nonEmptyString(title, "Hodos Dev Problems title");
  status = nonEmptyString(status, "Hodos Dev Problems status");
  if (!PROBLEM_STATUSES.has(status)) {
    throw new Error(`Unsupported Hodos Dev Problems status: ${status}`);
  }
  if (!Array.isArray(problems)) throw new TypeError("Hodos Dev Problems problems must be an array");
  if (typeof canClear !== "boolean") throw new TypeError("Hodos Dev Problems canClear must be boolean");
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("Hodos Dev Problems metadata must be an object");
  }

  const projected = Object.freeze(problems.map(problemEntryValue));
  const selected = optionalString(selectedId, "Hodos Dev Problems selected id");
  if (selected && !projected.some((problem) => problem.id === selected)) {
    throw new Error(`Hodos Dev Problems selected id is not present: ${selected}`);
  }

  const model = Object.freeze({
    status,
    problems: projected,
    selection: Object.freeze({ id: selected }),
    filter: problemFilterValue(filter),
    counts: problemCountsValue(projected),
    canClear,
    metadata: serializableValue(metadata, "Hodos Dev Problems metadata"),
  });

  return Object.freeze({
    "area/id": id,
    "area/type": HODOS_DEV_PROBLEMS_AREA_TYPE,
    "area/title": title,
    "area/component": Object.freeze({
      "component/id": HODOS_DEV_PROBLEMS_COMPONENT_ID,
      "component/contract": WORKSPACE_COMPONENT_CONTRACT,
      "component/model": model,
      "component/events": Object.freeze([...events]),
    }),
  });
}

