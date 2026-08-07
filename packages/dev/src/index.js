import { HODOS_COMPONENT_CONTRACT } from "@greenways/hodos-web";

const nonEmptyString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
};

export const HODOS_DEV_PREVIEW_AREA_TYPE = "hodos.dev/preview";
export const HODOS_DEV_PREVIEW_COMPONENT_ID = "hodos.dev/preview";
export const HODOS_DEV_PREVIEW_EVENTS = Object.freeze([
  "preview/open-source",
  "preview/retry",
]);

export function createPreviewArea({
  id = "preview/main",
  title = "Preview",
  output = null,
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
      "component/contract": HODOS_COMPONENT_CONTRACT,
      "component/model": Object.freeze({ output, theme, viewport }),
      "component/events": Object.freeze([...events]),
    }),
  });
}
