import {
  HODOS_2D_DOCUMENT_PROFILE,
  createDocumentArea,
  normalizeRichDocument,
} from "../index.js";

export const LEGACY_HARA_DOCUMENT_PROFILE = "greenways.rich-text/0-alpha";
export const LEGACY_HARA_DOCUMENT_PROFILES = Object.freeze([
  LEGACY_HARA_DOCUMENT_PROFILE,
]);

const plainObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
};

const nonEmptyString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
};

/**
 * Projects the original Hara UI document profile into the Hodos 2D document
 * profile without admitting editor instances, callbacks, transport or
 * executable host policy.
 */
export function projectLegacyHaraDocument(value, label = "Legacy Hara document") {
  const input = plainObject(value, label);
  const profile = nonEmptyString(input.profile, `${label} profile`);

  if (profile !== LEGACY_HARA_DOCUMENT_PROFILE && profile !== HODOS_2D_DOCUMENT_PROFILE) {
    throw new Error(`${label} has unsupported profile: ${profile}`);
  }

  return normalizeRichDocument({
    profile: HODOS_2D_DOCUMENT_PROFILE,
    id: input.id,
    title: input.title,
    revision: input.revision,
    metadata: input.metadata ?? {},
    children: input.children,
  }, label);
}

export function createLegacyHaraDocumentArea(options = {}) {
  const input = plainObject(options, "Legacy Hara Document area options");
  return createDocumentArea({
    ...input,
    document: projectLegacyHaraDocument(input.document),
  });
}
