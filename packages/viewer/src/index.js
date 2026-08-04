import "./viewer.css";
import { defineAddon, HODOS_CORE_ADDON_ID } from "@greenways/hodos-core";
import { SurfaceHost, SurfaceRegistry } from "./surface-host.js";

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
  onCameraChange,
  onDraftImport,
  source,
  Renderer,
  EditorWorkspace,
  ReviewPanel,
} = {}) {
  if (!root) throw new Error("Hodos viewer requires a root element");
  if (!invoke) throw new Error("Hodos viewer requires a kernel dispatcher");
  if (!source?.Client || typeof source.resolve !== "function") throw new Error("Hodos viewer requires a world source adapter");
  if (typeof Renderer !== "function") throw new Error("Hodos viewer requires a world renderer adapter");
  const registry = surfaces instanceof SurfaceRegistry ? surfaces : new SurfaceRegistry(surfaces);
  let renderer;
  let state;
  let lastSessionState;
  let surfaceHost;
  let worldEditor;
  let draftReviewPanel;
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
      <div class="world-canvas"><canvas aria-label="Gaussian splat world and editable scene"></canvas></div>
      <div class="world-touchpoints" aria-label="World touchpoints"></div>
      <div class="world-audio-sources" aria-label="Spatial audio sources"></div>
      <div class="world-entity-overlays" aria-label="World entity transform controls"></div>
      <div class="world-editor-root"></div>
      <aside class="world-draft-review-root" aria-label="World draft review and publication"></aside>
      <div class="world-overlay"><div class="world-status" role="status"><strong>Reading world…</strong><span>${escapeHtml(next.repository)}${next.ref ? ` @ ${escapeHtml(next.ref)}` : ""}</span></div>
      <nav class="world-controls" aria-label="World controls"><button data-action="reset">Reset view</button><button data-action="mode">${next.mode === "strict" ? "Dev mode" : "Strict mode"}</button><button data-action="change">Change world</button></nav></div>
      <div class="diagnostic-slot"></div>
      <div class="hodos-surface-layer" hidden></div>
    </section>`;
    root.querySelector('[data-action="change"]').addEventListener("click", () => location.assign(location.pathname));
    root.querySelector('[data-action="mode"]').addEventListener("click", () => navigate({ ...next, mode: next.mode === "strict" ? "dev" : "strict" }));
    root.querySelector('[data-action="reset"]').addEventListener("click", () => renderer?.resetCamera());
    surfaceHost = new SurfaceHost(root.querySelector(".hodos-surface-layer"), { registry });
    if (EditorWorkspace) {
      worldEditor = new EditorWorkspace(root.querySelector(".world-editor-root"), {
        dispatch,
        getRenderer: () => renderer,
      });
    }
    if (ReviewPanel) {
      draftReviewPanel = new ReviewPanel(root.querySelector(".world-draft-review-root"), {
        dispatch,
        importDraft: onDraftImport,
      });
    }
    return {
      canvas: root.querySelector("canvas"),
      title: root.querySelector(".world-status strong"),
      detail: root.querySelector(".world-status span"),
      diagnostics: root.querySelector(".diagnostic-slot"),
      touchpoints: root.querySelector(".world-touchpoints"),
      audioSources: root.querySelector(".world-audio-sources"),
      entityOverlays: root.querySelector(".world-entity-overlays"),
    };
  };

  const diagnostics = (slot, items) => {
    slot.innerHTML = items.length ? `<details class="world-diagnostics" open><summary>World incomplete — ${items.length} issue${items.length === 1 ? "" : "s"}</summary><ul>${items.map((item) => `<li>${escapeHtml(item.path || "render")}: ${escapeHtml(item.message)}</li>`).join("")}</ul></details>` : "";
  };

  const fatal = (error) => {
    draftReviewPanel?.destroy();
    worldEditor?.destroy();
    surfaceHost?.destroy();
    renderer?.destroy();
    renderer = undefined;
    root.innerHTML = `<section class="world-fatal"><div class="world-card"><p class="eyebrow">World could not open</p><h1>Load failed</h1><code>${escapeHtml(error.message || error)}</code><form class="world-form"><button type="submit">Choose another world</button></form></div></section>`;
    root.querySelector("form").addEventListener("submit", (event) => { event.preventDefault(); location.assign(location.pathname); });
  };

  const forwardEffect = (effect, sessionState) => {
    if (!onEffect) return;
    try {
      Promise.resolve(onEffect(effect, sessionState, { renderer, dispatch })).catch((error) => {
        console.error(`Hodos host effect failed: ${effect.effect}/${effect.method}`, error, { effect });
      });
    } catch (error) {
      console.error(`Hodos host effect failed: ${effect.effect}/${effect.method}`, error, { effect });
    }
  };

  const applySessionResult = (result) => {
    lastSessionState = result?.state ?? lastSessionState;
    for (const effect of result?.effects ?? []) {
      if (effect.effect === "ui" && effect.method === "open-surface") {
        const descriptor = effect.args[0];
        renderer?.focusCamera(descriptor.camera);
        surfaceHost.open(descriptor, { dispatch });
      } else if (effect.effect === "ui" && effect.method === "close-surface") {
        surfaceHost.close();
      } else if (effect.effect === "scene" && effect.method === "sync-world-entities") {
        renderer?.syncWorldEntities(effect.args[0] ?? [], effect.args[1] ?? lastSessionState?.world?.editor);
      } else if (effect.effect === "scene" && effect.method === "sync-editor-document") {
        renderer?.syncEditorDocument(effect.args[0] ?? lastSessionState?.world?.draft, effect.args[1] ?? lastSessionState?.world?.editor);
      } else if (effect.effect === "scene" && effect.method === "sync-audio-sources") {
        renderer?.syncAudioSources(effect.args[0] ?? []);
      } else if (effect.effect === "audio") {
        surfaceHost.handleEffect(effect);
        forwardEffect(effect, result?.state);
      } else {
        forwardEffect(effect, result?.state);
      }
    }
    renderer?.syncEditorDocument(lastSessionState?.world?.draft ?? {}, lastSessionState?.world?.editor ?? {});
    surfaceHost?.update(result?.state);
    worldEditor?.update(result?.state);
    draftReviewPanel?.update(result?.state);
    return result;
  };

  function dispatch(event) {
    if (!sessionOpened) throw new Error("Hodos session is not open");
    return applySessionResult(invoke("session/event", [id, event]));
  }

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
      const sourceEffect = source.effect ?? { effect: "github", method: "resolve-world" };
      const effect = opening.effects.find((entry) => entry.effect === sourceEffect.effect && entry.method === sourceEffect.method);
      if (!effect) throw new Error(`HAL world/open did not request ${source.id || "the configured world source"}`);
      stage = `${source.label || source.id || "World source"} graph resolution`;
      const client = new source.Client({ request, activatePackages });
      const graph = await source.resolve({ repository: effect.args[0], ref: effect.args[1], mode: effect.args[2], client });
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
        layers: graph.layers.map((layer) => ({
          id: layer.id,
          asset: layer.asset,
          source: layer.source,
        })),
        touchpoints,
      };
      sessionOpened = true;
      applySessionResult(invoke("session/open", [id, sessionWorld]));

      stage = "HAL world/render";
      const rendering = invoke("world/render", [graph]);
      if (!rendering.effects.some((entry) => entry.effect === "scene" && entry.method === "render-world")) throw new Error("HAL world/render did not produce a scene command");
      const issues = [...graph.diagnostics];
      let loaded = 0;
      renderer = new Renderer(view.canvas, {
        background: graph.project.background,
        camera: graph.project.camera,
        touchpointRoot: view.touchpoints,
        audioSourceRoot: view.audioSources,
        entityOverlayRoot: view.entityOverlays,
        onCameraChange,
        onWorldDrop: ({ payload, position }) => dispatch({
          "event/type": "world/drop",
          payload,
          position,
        }),
        onWorldEntity: ({ action, target, targets, mode, entity, transform, source, position, items, time, playing }) => {
          if (action === "select") return dispatch({
            "event/type": "world/editor-select",
            target,
            targets,
            mode: mode || "replace",
          });
          if (action === "box-select") return dispatch({
            "event/type": "world/editor-select",
            targets: targets ?? [],
            mode: mode || "replace",
          });
          if (action === "transform-selection") return dispatch({
            "event/type": "world/editor-transform-selection",
            items: items ?? [],
          });
          if (action === "transform") return dispatch({
            "event/type": "world/entity-transform",
            entity,
            transform,
          });
          if (action === "audio-transform") return dispatch({
            "event/type": "world/audio-move",
            source,
            position,
          });
          if (action === "timeline") return dispatch({
            "event/type": "world/editor-settings",
            patch: { timeline: { ...(lastSessionState?.world?.editor?.timeline ?? {}), time, playing } },
          });
          return null;
        },
        onAudioSource: ({ action, source }) => dispatch({
          "event/type": action === "remove" ? "world/audio-remove" : "world/audio-toggle",
          source: source.id,
        }),
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
      renderer.syncEditorDocument(
        lastSessionState?.world?.draft ?? {},
        lastSessionState?.world?.editor ?? lastSessionState?.world?.draft?.editor,
      );
      view.title.textContent = `${loaded}/${graph.layers.length} layers loaded${issues.length ? " — incomplete" : ""}`;
      worldEditor?.update(lastSessionState);
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
    draftReviewPanel?.destroy();
    worldEditor?.destroy();
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
    focusSelection: () => renderer?.focusEditorSelection(),
    destroy,
    requestSourceAccess: () => source.requestAccess?.(),
    origins: source.origins,
  };
}

export { SurfaceHost, SurfaceRegistry } from "./surface-host.js";

export const HODOS_VIEWER_ADDON_ID = "@greenways/hodos-viewer";

function onlyContribution(context, kind) {
  const entries = context.listContributions(kind);
  if (entries.length === 1) return entries[0].value;
  if (!entries.length) throw new Error(`Hodos viewer requires one ${kind} contribution`);
  throw new Error(`Hodos viewer found multiple ${kind} contributions; activate only the selected adapter`);
}

export const hodosViewerAddon = defineAddon({
  manifest: {
    id: HODOS_VIEWER_ADDON_ID,
    version: "0.1.0",
    requires: { [HODOS_CORE_ADDON_ID]: "^0.1.0" },
    capabilities: [],
  },
  activate(context) {
    const source = onlyContribution(context, "world.source");
    const renderer = onlyContribution(context, "world.renderer");
    context.contribute("viewer", "worlds", Object.freeze({
      create: (options = {}) => createHodosViewer({
        ...options,
        source,
        Renderer: renderer.Renderer,
        EditorWorkspace: context.getContribution("world.ui", "authoring")?.Workspace,
        ReviewPanel: context.getContribution("world.ui", "publication")?.ReviewPanel,
      }),
      searchRepositories: source.searchRepositories,
    }));
  },
});
