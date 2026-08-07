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
