import { parseEDNString } from "edn-data";
import { start } from "./hara-vm.mjs";
import adaptorSource from "../src/gw/hodos/adaptor.hal";
import bundleSource from "../src/gw/hodos/bundle.hal";
import packageSource from "../src/gw/hodos/package.hal";
import sceneSource from "../src/gw/hodos/scene.hal";
import sessionSource from "../src/gw/hodos/session.hal";
import sessionDraftSource from "../src/gw/hodos/session_draft.hal";
import sessionPublicationSource from "../src/gw/hodos/session_publication.hal";
import sessionAuthoringSource from "../src/gw/hodos/session_authoring.hal";
import kernelSource from "../src/gw/hodos/kernel.hal";
import { installLockedPackages } from "./hara-packages.js";
import { encodeHalValue } from "./hal-transport.js";

const runtime = await start({ resources: {
  "gw.hodos.adaptor": adaptorSource,
  "gw.hodos.bundle": bundleSource,
  "gw.hodos.package": packageSource,
  "gw.hodos.scene": sceneSource,
  "gw.hodos.session": sessionSource,
  "gw.hodos.session-draft": sessionDraftSource,
  "gw.hodos.session-publication": sessionPublicationSource,
  "gw.hodos.session-authoring": sessionAuthoringSource,
  "gw.hodos.kernel": kernelSource,
} });
runtime.require("gw.hodos.kernel");

const decode = (value) => parseEDNString(value, {
  mapAs: "object", setAs: "array", listAs: "array",
  keywordAs: "string", charAs: "string", objectKeysAs: "string",
});

export function invokeHodos(method, args = []) {
  return decode(runtime.eval(`(gw.hodos.kernel/dispatch ${encodeHalValue(method)} ${encodeHalValue(args)})`));
}

export function evaluateHodosScript({ source, event = {}, entity = {}, world = {} } = {}) {
  const form = String(source || "").trim();
  if (!form) throw new Error("Hara script source is empty");
  if (new TextEncoder().encode(form).byteLength > 64 * 1024) {
    throw new Error("Hara script source exceeds 64 KiB");
  }
  return decode(runtime.eval(
    `(${form} ${encodeHalValue(event)} ${encodeHalValue(entity)} ${encodeHalValue(world)})`,
  ));
}

export const hodosCapabilities = () => invokeHodos("app/capabilities");
export const activateLockedPackages = (lockSource, request) =>
  installLockedPackages(runtime, lockSource, { fetch: request });
