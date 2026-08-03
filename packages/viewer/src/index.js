import "./viewer.css";
import { GITHUB_ORIGINS, PublicGitHubClient, requestGitHubAccess, resolveWorldGraph } from "./github-worlds.js";
import { SurfaceHost, SurfaceRegistry } from "./surface-host.js";
import { WorldRenderer } from "./world-renderer.js";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

const sessionId = () => `session-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
const TOUCHPOINT_PRESENTATIONS = new Set(["focus-overlay", "overlay", "panel", "modal"]);
const TOUCHPOINT_ANCHORS = new Set(["world", "scene-center"]);

function finiteVector3(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => !Number.isFinite(entry))) {
    throw new Error(`${label} must contain three finite numbers`);
  }
  return [...value];
}

function normalizeHostTouchpoint(value, index) {
  if (!value || typeof value !== "object") throw new Error(`Host touchpoint ${index} must be an object`);
  if (!value.id || !value.surface) throw new Error(`Host touchpoint ${index} requires id and surface`);
  const presentation = value.presentation || "focus-overlay";
  if (!TOUCHPOINT_PRESENTATIONS.has(presentation)) throw new Error(`Host touchpoint ${index} has an invalid presentation`);
  const anchor = value.anchor || "world";
  if (!TOUCHPOINT_ANCHORS.has(anchor)) throw new Error(`Host touchpoint ${index} has an invalid anchor`);
  const radius = value.radius === undefined ? 0.5 : value.radius;
  if (!Number.isFinite(radius) || radius <= 0) throw new Error(`Host touchpoint ${index} radius must be positive`);
  return {
    id: String(value.id),
    label: String(value.label || value.id),
    surface: String(value.surface),
    presentation,
    anchor,
    position: finiteVector3(value.position ?? [0, 0, 0], `Host touchpoint ${index} position`),
    radius,
    camera: value.camera || null,
    config: value.config || {},
    transformChain: Array.isArray(value.transformChain) ? value.transformChain : [],
    source: value.source || { host: true },
  };
}

export function createHodosViewer({
  root,
  invoke,
  activatePackages,
  request = (...args) => globalThis.fetch(...args),
  surfaces = {},
  id = sessionId(),
  onEffect,
} = {}) {
  if (!root) throw new Error("Hodos viewer requires a root element");
  if (!invoke) throw new Error("Hodos viewer requires a kernel dispatcher");
  const registry = surfaces instanceof SurfaceRegistry ? surfaces : new SurfaceRegistry(surfaces);
  let renderer;
  let state;
  let surfaceHost;
  let sessionOpened = false;

  const navigate = (next) => {
    const query = new URLSearchParams();
    if (next.repository) query.set("repo", next.repository);
    if (next.ref) query.set("ref", next.ref);
    if (next.mode === "strict") query.set("mode", "strict");
    if (next.experience) query.set("experience", next.experience);
    location.assign(`${location.pathname}?${query}`);
  };

  const shell = (next) => {
    root.innerHTML = `<section class="world-shell">
      <div class="world-canvas"><canvas aria-label="Gaussian splat world"></canvas></div>
      <div class="world-touchpoints" aria-label="World touchpoints"></div>
      <div class="world-overlay"><div class="world-status" role="status"><strong>Reading world…</strong><span>${escapeHtml(next.repository)}${next.ref ? ` @ ${escapeHtml(next.ref)}` : ""}</span></div>
      <nav class="world-controls" aria-label="World controls"><button data-action="reset">Reset view</button><button data-action="mode">${next.mode === "strict" ? "Dev mode" : "Strict mode"}</button><button data-action="change">Change world</button></nav></div>
      <div class="diagnostic-slot"></div>
      <div class="hodos-surface-layer" hidden></div>
    </section>`;
    root.querySelector('[data-action="change"]').addEventListener("click", () => location.assign(location.pathname));
    root.querySelector('[data-action="mode"]').addEventListener("click", () => navigate({ ...next, mode: next.mode === "strict" ? "dev" : "strict" }));
    root.querySelector('[data-action="reset"]').addEventListener("click", () => renderer?.resetCamera());
    surfaceHost = new SurfaceHost(root.querySelector(".hodos-surface-layer"), { registry });
    return {
      canvas: root.querySelector("canvas"),
      title: root.querySelector(".world-status strong"),
      detail: root.querySelector(".world-status span"),
      diagnostics: root.querySelector(".diagnostic-slot"),
      touchpoints: root.querySelector(".world-touchpoints"),
    };
  };

  const diagnostics = (slot, items) => {
    slot.innerHTML = items.length ? `<details class="world-diagnostics" open><summary>World incomplete — ${items.length} issue${items.length === 1 ? "" : "s"}</summary><ul>${items.map((item) => `<li>${escapeHtml(item.path || "render")}: ${escapeHtml(item.message)}</li>`).join("")}</ul></details>` : "";
  };

  const fatal = (error) => {
    surfaceHost?.destroy();
    renderer?.destroy();
    renderer = undefined;
    root.innerHTML = `<section class="world-fatal"><div class="world-card"><p class="eyebrow">World could not open</p><h1>Load failed</h1><code>${escapeHtml(error.message || error)}</code><form class="world-form"><button type="submit">Choose another world</button></form></div></section>`;
    root.querySelector("form").addEventListener("submit", (event) => { event.preventDefault(); location.assign(location.pathname); });
  };

  const applySessionResult = (result) => {
    for (const effect of result?.effects ?? []) {
      if (effect.effect === "ui" && effect.method === "open-surface") {
        const descriptor = effect.args[0];
        renderer?.focusCamera(descriptor.camera);
        surfaceHost.open(descriptor, { dispatch });
      } else if (effect.effect === "ui" && effect.method === "close-surface") {
        surfaceHost.close();
      } else if (effect.effect === "audio") {
        surfaceHost.handleEffect(effect);
      } else {
        onEffect?.(effect, result?.state);
      }
    }
    surfaceHost?.update(result?.state);
    return result;
  };

  const dispatch = (event) => {
    if (!sessionOpened) throw new Error("Hodos session is not open");
    return applySessionResult(invoke("session/event", [id, event]));
  };

  async function open(next) {
    state = {
      repository: next.repository,
      ref: next.ref || "",
      mode: next.mode === "strict" ? "strict" : "dev",
      experience: next.experience || "",
    };
    const view = shell(state);
    let stage = "HAL world/open";
    try {
      const opening = invoke("world/open", [state.repository, state.ref, state.mode]);
      const effect = opening.effects.find((entry) => entry.effect === "github" && entry.method === "resolve-world");
      if (!effect) throw new Error("HAL world/open did not request a repository graph");
      stage = "GitHub world graph resolution";
      const client = new PublicGitHubClient({ request, activatePackages });
      const graph = await resolveWorldGraph({ repository: effect.args[0], ref: effect.args[1], mode: effect.args[2], client });
      const touchpoints = [
        ...(graph.touchpoints ?? []),
        ...(next.touchpoints ?? []).map(normalizeHostTouchpoint),
      ];

      stage = "HAL session/open";
      const sessionWorld = {
        repository: graph.repository,
        commit: graph.commit,
        project: {
          id: graph.project.id,
          version: graph.project.version,
          title: graph.project.title,
          capabilities: graph.project.capabilities ?? [],
        },
        touchpoints,
      };
      sessionOpened = true;
      applySessionResult(invoke("session/open", [id, sessionWorld]));

      stage = "HAL world/render";
      const rendering = invoke("world/render", [graph]);
      if (!rendering.effects.some((entry) => entry.effect === "scene" && entry.method === "render-world")) throw new Error("HAL world/render did not produce a scene command");
      const issues = [...graph.diagnostics];
      let loaded = 0;
      renderer = new WorldRenderer(view.canvas, {
        background: graph.project.background,
        camera: graph.project.camera,
        touchpointRoot: view.touchpoints,
        onTouchpoint: (touchpoint) => dispatch({ "event/type": "touchpoint/activate", touchpoint }),
        onLayer: ({ layer, status, error }) => {
          if (status === "loaded") loaded += 1;
          else issues.push({ path: layer.id, message: error?.message || "Gaussian splat failed to load" });
          view.title.textContent = `${loaded}/${graph.layers.length} layers loaded${issues.length ? " — incomplete" : ""}`;
          diagnostics(view.diagnostics, issues);
        },
      });
      view.title.textContent = `Loading ${graph.layers.length} layer${graph.layers.length === 1 ? "" : "s"}…`;
      view.detail.textContent = `${graph.repository.owner}/${graph.repository.repo} @ ${graph.commit.slice(0, 12)} · ${state.mode}${touchpoints.length ? ` · ${touchpoints.length} touchpoint${touchpoints.length === 1 ? "" : "s"}` : ""}`;
      diagnostics(view.diagnostics, issues);
      stage = "Gaussian splat rendering";
      await renderer.loadLayers(graph.layers);
      renderer.loadTouchpoints(touchpoints);
      view.title.textContent = `${loaded}/${graph.layers.length} layers loaded${issues.length ? " — incomplete" : ""}`;
      return { ...graph, touchpoints };
    } catch (error) {
      if (sessionOpened) {
        try { invoke("session/close", [id]); } catch (closeError) { console.warn("Hodos session cleanup failed", closeError); }
        sessionOpened = false;
      }
      const failure = new Error(`${stage}: ${error?.message || error}`, { cause: error });
      console.error(`Hodos world load failed during ${stage}`, failure, { ...state, originalError: error });
      fatal(failure);
      throw failure;
    }
  }

  const destroy = () => {
    surfaceHost?.destroy();
    renderer?.destroy();
    if (sessionOpened) {
      try { invoke("session/close", [id]); } catch (error) { console.warn("Hodos session close failed", error); }
    }
    sessionOpened = false;
  };

  return {
    open,
    dispatch,
    sessionId: id,
    registerSurface: (surface, factory) => registry.register(surface, factory),
    resetCamera: () => renderer?.resetCamera(),
    destroy,
    requestGitHubAccess: () => requestGitHubAccess(),
    origins: GITHUB_ORIGINS,
  };
}

export { SurfaceHost, SurfaceRegistry } from "./surface-host.js";
