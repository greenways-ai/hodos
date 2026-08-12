import "./world.css";
import { mountRiggingDemo } from "./rigging-demo.js";
import { RIGGING_DEMO_EXPERIENCE } from "./rigging-demo-model.js";
import { createHodosHost } from "@greenways/hodos-core";
import {
  hodosHaraDistribution,
  HODOS_HARA_RUNTIME_ADDON_ID,
} from "@greenways/hodos-runtime-hara";
import {
  hodosViewerDistribution,
  HODOS_DEFAULT_VIEWER_ADDON_ID,
} from "@greenways/hodos-viewer-defaults";
import {
  hodosWorldAuthoringUiAddon,
  HODOS_WORLD_AUTHORING_UI_ADDON_ID,
} from "@greenways/hodos-ui-world-authoring";
import {
  hodosWorldPublicationUiAddon,
  HODOS_WORLD_PUBLICATION_UI_ADDON_ID,
} from "@greenways/hodos-ui-world-publication";
import { FEATURED_WORLDS, featuredWorld } from "./featured-worlds.js";
import { handleHaraScriptEffect } from "./hara-script-host.js";
import { SpatialAudioRuntime } from "./spatial-audio.js";
import { withStudioBundleImport } from "./studio-bundle-import.js";
import { withStudioClipEditing } from "./studio-clip-edit.js";
import { withStudioHistory } from "./studio-history.js";
import { createStudioSurface } from "./studio-surface.js";
import { withStudioTrackManagement } from "./studio-track-management.js";
import { STUDIO_TOUCHPOINTS } from "./studio-world.js";
import { SHOWCASE_SURFACE_FACTORIES } from "./showcase-surfaces.js";
import {
  firstShowcaseGuideTouchpoint,
  SHOWCASE_EXPERIENCE,
  SHOWCASE_SURFACE_IDS,
  touchpointForSurface,
} from "./showcase-world.js";
import { readWorldDraftProposal } from "./world-draft-review.js";
import { createWorldDraftStore, saveWorldDraftFile } from "./world-draft-storage.js";
import { saveHestiaContribution, saveRepositoryPatch } from "./world-publication.js";

const host = createHodosHost({
  capabilities: [
    "publication.intent",
    "network.github",
    "runtime.hara",
    "workspace.authoring",
    "workspace.drafts",
    "world.render",
  ],
});
host.register(
  hodosHaraDistribution,
  hodosViewerDistribution,
  hodosWorldAuthoringUiAddon,
  hodosWorldPublicationUiAddon,
);
await host.activate([
  HODOS_HARA_RUNTIME_ADDON_ID,
  HODOS_WORLD_AUTHORING_UI_ADDON_ID,
  HODOS_WORLD_PUBLICATION_UI_ADDON_ID,
  HODOS_DEFAULT_VIEWER_ADDON_ID,
]);
const haraRuntime = host.getContribution("runtime", "hara");
const worldsViewer = host.getContribution("viewer", "worlds");
const invokeHodos = haraRuntime.invoke;
const activateLockedPackages = haraRuntime.activatePackages;
const createHodosViewer = worldsViewer.create;
const searchWorldRepositories = worldsViewer.searchRepositories;

const root = document.querySelector("#hodos-app");
const spatialAudio = new SpatialAudioRuntime();
const worldDrafts = createWorldDraftStore();
let riggingDemo = null;

function worldIdentity(state) {
  return {
    repository: state?.world?.repository,
    commit: state?.world?.commit,
    project: {
      id: state?.world?.project?.id,
      version: state?.world?.project?.version,
    },
  };
}

function compactReceipt(artifact) {
  const { patch: _patch, save: _save, ...receipt } = artifact;
  return receipt;
}

const viewer = createHodosViewer({
  root,
  invoke: invokeHodos,
  activatePackages: activateLockedPackages,
  onCameraChange: (camera) => spatialAudio.updateListener(camera),
  onDraftImport: (file, state) => readWorldDraftProposal(file, {
    expectedIdentity: worldIdentity(state),
    currentDraft: state?.world?.draft,
  }),
  onEffect: async (effect, state, context) => {
    if (await handleHaraScriptEffect(effect, state, context, haraRuntime.evaluateScript)) return;
    if (effect.effect === "audio" && effect.method === "sync-world-sources") {
      return spatialAudio.sync(effect.args[0] ?? [], effect.args[1]);
    }
    if (effect.effect === "storage" && effect.method === "save-world-draft") {
      const [identity, draft] = effect.args;
      await worldDrafts.save(identity, draft);
      context.dispatch({ "event/type": "world/draft-saved", revision: draft.revision });
      return;
    }
    if (effect.effect === "export" && effect.method === "world-draft") {
      return saveWorldDraftFile(effect.args[0], effect.args[1]);
    }
    if (effect.effect === "publication" && effect.method === "repository-patch") {
      try {
        const artifact = await saveRepositoryPatch(effect.args[0], effect.args[1]);
        if (artifact.save?.method === "cancelled") {
          context.dispatch({
            "event/type": "world/publication-failed",
            target: "repository",
            error: "Repository patch export was cancelled",
            createdAt: new Date().toISOString(),
          });
        } else {
          context.dispatch({
            "event/type": "world/publication-complete",
            receipt: compactReceipt(artifact),
          });
        }
      } catch (error) {
        context.dispatch({
          "event/type": "world/publication-failed",
          target: "repository",
          error: error.message,
          createdAt: new Date().toISOString(),
        });
        throw error;
      }
      return;
    }
    if (effect.effect === "publication" && effect.method === "hestia-contribution") {
      try {
        const artifact = await saveHestiaContribution(effect.args[0], effect.args[1], effect.args[2]);
        if (artifact.save?.method === "cancelled") {
          context.dispatch({
            "event/type": "world/publication-failed",
            target: "hestia",
            error: "Hestia contribution export was cancelled",
            createdAt: new Date().toISOString(),
          });
        } else {
          context.dispatch({
            "event/type": "world/publication-complete",
            receipt: compactReceipt(artifact),
          });
        }
      } catch (error) {
        context.dispatch({
          "event/type": "world/publication-failed",
          target: "hestia",
          error: error.message,
          createdAt: new Date().toISOString(),
        });
        throw error;
      }
    }
  },
  surfaces: {
    ...SHOWCASE_SURFACE_FACTORIES,
    "hodos/studio": withStudioBundleImport(
      withStudioClipEditing(
        withStudioTrackManagement(withStudioHistory(createStudioSurface)),
      ),
    ),
  },
});
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

const sigil = () => `<img class="hodos-sigil" src="./sigil.svg" alt="Hodos sigil">`;

const queryState = () => {
  const query = new URLSearchParams(location.search);
  return {
    repository: query.get("repo") || "",
    ref: query.get("ref") || "",
    mode: query.get("mode") === "strict" ? "strict" : "dev",
    experience: query.get("experience") || "",
  };
};

const navigate = (state) => {
  const query = new URLSearchParams();
  if (state.repository) query.set("repo", state.repository);
  if (state.ref) query.set("ref", state.ref);
  if (state.mode === "strict") query.set("mode", "strict");
  if (state.experience) query.set("experience", state.experience);
  location.assign(`${location.pathname}?${query}`);
};

function applyTheme(preference) {
  const theme = preference === "auto"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : preference;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("hodos-theme", preference);
}

function renderDemo(error = "") {
  const state = queryState();
  root.innerHTML = `<section class="world-welcome"><div class="welcome-frame"><header class="welcome-header"><a href="./" class="welcome-brand">${sigil()}<span>Hodos <em>Worlds</em></span></a><button class="welcome-theme" type="button" data-theme-toggle>Appearance</button></header>
  <div class="world-card welcome-card"><section class="welcome-hero"><div class="welcome-hero-art" role="img" aria-label="A curious young teenager entering a Hodos mosaic world"></div><div class="welcome-hero-veil"></div><div class="welcome-hero-copy"><p class="eyebrow">OPEN WORLDS · HARA IN THE BROWSER</p><h1>Enter a<br><i>living world.</i></h1><p>Hodos bundles repository-defined places through a live Hara kernel, then opens their Gaussian-splat scenes and trusted application surfaces in the browser.</p><a class="hero-action" href="#world-collection">Discover the collection ↓</a></div></section>
  <section class="world-browser" id="world-collection"><div class="section-intro"><p class="eyebrow">THE DEMO</p><h2>World objects.<br>Classical interfaces.</h2></div>${error ? `<p role="alert"><code>${escapeHtml(error)}</code></p>` : ""}<section class="featured-worlds" aria-label="Featured worlds">${FEATURED_WORLDS.map((world) => `<article class="featured-world${world.primary ? " featured-world--primary" : ""}"><span>${escapeHtml(world.format)}</span><h2>${escapeHtml(world.title)}</h2><p>${escapeHtml(world.description)}</p><ul class="featured-world-features">${(world.features ?? []).map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul><div><button type="button" data-featured-world="${escapeHtml(world.id)}">${escapeHtml(world.action || "Open world")}</button><a href="${escapeHtml(world.attribution)}" target="_blank" rel="noreferrer">Source & attribution</a></div></article>`).join("")}</section>
  <section class="showcase-landing"><header><p>ONE COMPOSED JOURNEY</p><h3>Try the whole platform, not only the renderer.</h3><span>The guided Splat Garden connects repository composition, Hara state, precise browser tools, spatial sound, editable world drafts and accountable publication.</span></header><div class="showcase-landing-grid"><article><span>01</span><strong>Explore</strong><p>Resolve a composed world and activate spatial application touchpoints.</p></article><article><span>02</span><strong>Create</strong><p>Import, arrange, edit, persist and export local audio in Studio.</p></article><article><span>03</span><strong>Program</strong><p>Inspect the live Hara state and invoke discoverable commands from M-x.</p></article><article><span>04</span><strong>Publish</strong><p>Review semantic changes, create Git patches and sign Hestia contributions.</p></article></div></section>
  <section class="rigging-landing" aria-labelledby="rigging-demo-title"><article><div><p class="eyebrow">LOCAL 3D AUTHORING</p><h3 id="rigging-demo-title">Rig the models an auto-rigger cannot.</h3><span>Open a GLB on this device, place an arbitrary skeleton, repair its hierarchy, and keep every committed operation reversible. The model is never uploaded.</span></div><button type="button" data-rigging-workbench>Open rigging workbench</button></article></section>
  <p class="world-divider"><span>Find another place</span></p><form class="catalog-form" role="search"><label>Search greenways-worlds<input name="query" type="search" placeholder="garden, apartment, gaussian splat"></label><button type="submit">Search worlds</button></form><div class="catalog-results" aria-live="polite"></div>
  <form class="world-form"><label>GitHub repository<input name="repo" type="url" required placeholder="https://github.com/owner/world" value="${escapeHtml(state.repository)}"></label><label>Ref (optional)<input name="ref" placeholder="main, tag, or commit SHA" value="${escapeHtml(state.ref)}"></label><label class="mode-control"><input name="strict" type="checkbox" ${state.mode === "strict" ? "checked" : ""}> Strict commits</label><button type="submit">Open with Hodos</button></form></section></div><footer class="welcome-footer"><span>HODOS / WORLDS</span><span>Kernel-bundled places · embedded Hara</span></footer></div></section>`;

  root.querySelector("[data-theme-toggle]").addEventListener("click", () => {
    const current = document.documentElement.dataset.themePreference || "auto";
    applyTheme(current === "auto" ? "light" : current === "light" ? "dark" : "auto");
  });
  root.querySelector(".catalog-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const results = root.querySelector(".catalog-results");
    results.innerHTML = "<p>Searching…</p>";
    try {
      await viewer.requestSourceAccess();
      const matches = await searchWorldRepositories(
        new FormData(event.currentTarget).get("query"),
        (...args) => globalThis.fetch(...args),
        invokeHodos,
      );
      results.innerHTML = matches.length
        ? matches.map((repository) => `<article><div><strong>${escapeHtml(repository.name)}</strong><span>${escapeHtml(repository.description || "Gaussian splat world")}</span></div><button type="button" data-catalog-repo="${escapeHtml(repository.html_url)}">Open</button></article>`).join("")
        : "<p>No matching worlds.</p>";
      results.querySelectorAll("[data-catalog-repo]").forEach((button) => button.addEventListener("click", () => navigate({
        repository: button.dataset.catalogRepo,
        ref: "",
        mode: "dev",
        experience: "",
      })));
    } catch (searchError) {
      console.error("Hodos world search failed", searchError);
      results.innerHTML = `<p role="alert">${escapeHtml(searchError.message)}</p>`;
    }
  });
  root.querySelector(".world-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await viewer.requestSourceAccess();
      navigate({
        repository: data.get("repo"),
        ref: data.get("ref"),
        mode: data.has("strict") ? "strict" : "dev",
        experience: "",
      });
    } catch (requestError) {
      renderDemo(requestError.message);
    }
  });
  root.querySelectorAll("[data-featured-world]").forEach((button) => button.addEventListener("click", async () => {
    const world = featuredWorld(button.dataset.featuredWorld);
    if (!world) return;
    try {
      await viewer.requestSourceAccess();
      navigate({
        repository: world.repository,
        ref: world.ref || "",
        mode: "dev",
        experience: world.experience || "",
      });
    } catch (requestError) {
      renderDemo(requestError.message);
    }
  }));
  root.querySelector("[data-rigging-workbench]")?.addEventListener("click", () => navigate({
    repository: "",
    ref: "",
    mode: "dev",
    experience: RIGGING_DEMO_EXPERIENCE,
  }));
}

async function openWorld(initial) {
  const graph = await viewer.open({
    ...initial,
    touchpoints: initial.experience === "studio" ? STUDIO_TOUCHPOINTS : [],
  });
  try {
    await worldDrafts.prepare();
    const identity = {
      repository: graph.repository,
      commit: graph.commit,
      project: { id: graph.project.id, version: graph.project.version },
    };
    const draft = await worldDrafts.load(identity);
    if (draft) viewer.dispatch({ "event/type": "world/draft-restore", draft });
  } catch (error) {
    console.error("Hodos world draft restoration failed", error);
  }

  if (initial.experience === SHOWCASE_EXPERIENCE) {
    const guide = firstShowcaseGuideTouchpoint(graph.touchpoints)
      ?? touchpointForSurface({ world: { touchpoints: graph.touchpoints } }, SHOWCASE_SURFACE_IDS.guide);
    if (guide) viewer.dispatch({ "event/type": "touchpoint/activate", touchpoint: guide });
  }
}

const initial = queryState();
if (initial.experience === RIGGING_DEMO_EXPERIENCE) {
  mountRiggingDemo({ root, hodosHost: host })
    .then((controller) => { riggingDemo = controller; })
    .catch((error) => {
      console.error("Hodos rigging demo failed", error);
      renderDemo(error.message);
    });
} else if (initial.repository) {
  openWorld(initial).catch(() => {});
} else {
  renderDemo();
}
window.addEventListener("beforeunload", () => {
  riggingDemo?.destroy?.();
  spatialAudio.destroy();
  viewer.destroy();
}, { once: true });
