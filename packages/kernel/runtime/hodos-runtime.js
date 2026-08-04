import { parseEDNString } from "edn-data";
import { start } from "./hara-vm.mjs";
import adaptorSource from "@greenways/hodos-core/hara/adaptor";
import bundleSource from "@greenways/hodos-core/hara/bundle";
import packageSource from "@greenways/hodos-core/hara/package";
import sceneSource from "@greenways/hodos-core/hara/scene";
import sessionSource from "@greenways/hodos-core/hara/session";
import sessionDraftSource from "@greenways/hodos-addon-drafts/hara";
import sessionPublicationSource from "@greenways/hodos-addon-publication/hara";
import sessionAuthoringSource from "@greenways/hodos-addon-authoring/hara";
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

if (typeof globalThis !== "undefined") {
  globalThis.HodosScriptRuntime = Object.freeze({ evaluate: evaluateHodosScript });
}

export const hodosCapabilities = () => invokeHodos("app/capabilities");
export const activateLockedPackages = (lockSource, request) =>
  installLockedPackages(runtime, lockSource, { fetch: request });
