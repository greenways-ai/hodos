import { GITHUB_ORIGINS, PublicGitHubClient, requestGitHubAccess, resolveWorldGraph } from "./github-worlds.js";
import { WorldRenderer } from "./world-renderer.js";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

export function createHodosViewer({ root, invoke, activatePackages, request = (...args) => globalThis.fetch(...args) } = {}) {
  if (!root) throw new Error("Hodos viewer requires a root element");
  if (!invoke) throw new Error("Hodos viewer requires a kernel dispatcher");
  let renderer;
  let state;

  const navigate = (next) => {
    const query = new URLSearchParams();
    if (next.repository) query.set("repo", next.repository);
    if (next.ref) query.set("ref", next.ref);
    if (next.mode === "strict") query.set("mode", "strict");
    location.assign(`${location.pathname}?${query}`);
  };

  const shell = (next) => {
    root.innerHTML = `<section class="world-shell">
      <div class="world-canvas"><canvas aria-label="Gaussian splat world"></canvas></div>
      <div class="world-overlay"><div class="world-status" role="status"><strong>Reading world…</strong><span>${escapeHtml(next.repository)}${next.ref ? ` @ ${escapeHtml(next.ref)}` : ""}</span></div>
      <nav class="world-controls" aria-label="World controls"><button data-action="reset">Reset view</button><button data-action="mode">${next.mode === "strict" ? "Dev mode" : "Strict mode"}</button><button data-action="change">Change world</button></nav></div>
      <div class="diagnostic-slot"></div></section>`;
    root.querySelector('[data-action="change"]').addEventListener("click", () => location.assign(location.pathname));
    root.querySelector('[data-action="mode"]').addEventListener("click", () => navigate({ ...next, mode: next.mode === "strict" ? "dev" : "strict" }));
    root.querySelector('[data-action="reset"]').addEventListener("click", () => renderer?.resetCamera());
    return { canvas: root.querySelector("canvas"), title: root.querySelector(".world-status strong"), detail: root.querySelector(".world-status span"), diagnostics: root.querySelector(".diagnostic-slot") };
  };

  const diagnostics = (slot, items) => {
    slot.innerHTML = items.length ? `<details class="world-diagnostics" open><summary>World incomplete — ${items.length} issue${items.length === 1 ? "" : "s"}</summary><ul>${items.map((item) => `<li>${escapeHtml(item.path || "render")}: ${escapeHtml(item.message)}</li>`).join("")}</ul></details>` : "";
  };

  const fatal = (error) => {
    renderer?.destroy();
    renderer = undefined;
    root.innerHTML = `<section class="world-fatal"><div class="world-card"><p class="eyebrow">World could not open</p><h1>Load failed</h1><code>${escapeHtml(error.message || error)}</code><form class="world-form"><button type="submit">Choose another world</button></form></div></section>`;
    root.querySelector("form").addEventListener("submit", (event) => { event.preventDefault(); location.assign(location.pathname); });
  };

  async function open(next) {
    state = { repository: next.repository, ref: next.ref || "", mode: next.mode === "strict" ? "strict" : "dev" };
    const view = shell(state);
    let stage = "HAL world/open";
    try {
      const opening = invoke("world/open", [state.repository, state.ref, state.mode]);
      const effect = opening.effects.find((entry) => entry.effect === "github" && entry.method === "resolve-world");
      if (!effect) throw new Error("HAL world/open did not request a repository graph");
      stage = "GitHub world graph resolution";
      const client = new PublicGitHubClient({ request, activatePackages });
      const graph = await resolveWorldGraph({ repository: effect.args[0], ref: effect.args[1], mode: effect.args[2], client });
      stage = "HAL world/render";
      const rendering = invoke("world/render", [graph]);
      if (!rendering.effects.some((entry) => entry.effect === "scene" && entry.method === "render-world")) throw new Error("HAL world/render did not produce a scene command");
      const issues = [...graph.diagnostics];
      let loaded = 0;
      renderer = new WorldRenderer(view.canvas, { background: graph.project.background, camera: graph.project.camera, onLayer: ({ layer, status, error }) => {
        if (status === "loaded") loaded += 1;
        else issues.push({ path: layer.id, message: error?.message || "Gaussian splat failed to load" });
        view.title.textContent = `${loaded}/${graph.layers.length} layers loaded${issues.length ? " — incomplete" : ""}`;
        diagnostics(view.diagnostics, issues);
      } });
      view.title.textContent = `Loading ${graph.layers.length} layer${graph.layers.length === 1 ? "" : "s"}…`;
      view.detail.textContent = `${graph.repository.owner}/${graph.repository.repo} @ ${graph.commit.slice(0, 12)} · ${state.mode}`;
      diagnostics(view.diagnostics, issues);
      stage = "Gaussian splat rendering";
      await renderer.loadLayers(graph.layers);
      view.title.textContent = `${loaded}/${graph.layers.length} layers loaded${issues.length ? " — incomplete" : ""}`;
      return graph;
    } catch (error) {
      const failure = new Error(`${stage}: ${error?.message || error}`, { cause: error });
      console.error(`Hodos world load failed during ${stage}`, failure, { ...state, originalError: error });
      fatal(failure);
      throw failure;
    }
  }

  return { open, resetCamera: () => renderer?.resetCamera(), destroy: () => renderer?.destroy(), requestGitHubAccess: () => requestGitHubAccess(), origins: GITHUB_ORIGINS };
}
