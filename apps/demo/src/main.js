import "./world.css";
import { FEATURED_WORLDS, featuredWorld } from "./featured-worlds.js";
import { createStudioSurface } from "./studio-surface.js";
import { STUDIO_TOUCHPOINTS } from "./studio-world.js";
import { createHodosViewer } from "../../../packages/viewer/src/index.js";
import { searchWorldRepositories } from "../../../packages/viewer/src/github-worlds.js";
import { activateLockedPackages, invokeHodos } from "../../../packages/kernel/runtime/hodos-runtime.js";

const root = document.querySelector("#hodos-app");
const viewer = createHodosViewer({
  root,
  invoke: invokeHodos,
  activatePackages: activateLockedPackages,
  surfaces: { "hodos/studio": createStudioSurface },
});
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

const ouroboros = () => `<svg class="hodos-sigil" viewBox="0 0 64 64" role="img" aria-label="Hodos ouroboros sigil"><circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="6" stroke-dasharray="116 22" stroke-linecap="square"/><path d="M48 13 61 18 51 29 48 22 40 20Z" fill="currentColor"/><circle cx="53" cy="19" r="1.5" fill="var(--canvas)"/><path d="M14 45c5 8 13 12 22 11" fill="none" stroke="var(--gold)" stroke-width="2"/></svg>`;

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
  root.innerHTML = `<section class="world-welcome"><div class="welcome-frame"><header class="welcome-header"><a href="./" class="welcome-brand">${ouroboros()}<span>Hodos <em>Worlds</em></span></a><button class="welcome-theme" type="button" data-theme-toggle>Appearance</button></header>
  <div class="world-card welcome-card"><section class="welcome-hero"><div class="welcome-hero-art" role="img" aria-label="A curious young teenager entering a Hodos mosaic world"></div><div class="welcome-hero-veil"></div><div class="welcome-hero-copy"><p class="eyebrow">OPEN WORLDS · HARA IN THE BROWSER</p><h1>Enter a<br><i>living world.</i></h1><p>Hodos bundles repository-defined places through a live Hara kernel, then opens their Gaussian-splat scenes and trusted application surfaces in the browser.</p><a class="hero-action" href="#world-collection">Discover the collection ↓</a></div></section>
  <section class="world-browser" id="world-collection"><div class="section-intro"><p class="eyebrow">THE DEMO</p><h2>World objects.<br>Classical interfaces.</h2></div>${error ? `<p role="alert"><code>${escapeHtml(error)}</code></p>` : ""}<section class="featured-worlds" aria-label="Featured worlds">${FEATURED_WORLDS.map((world) => `<article class="featured-world"><span>${escapeHtml(world.format)}</span><h2>${escapeHtml(world.title)}</h2><p>${escapeHtml(world.description)}</p><div><button type="button" data-featured-world="${escapeHtml(world.id)}">Open world</button><a href="${escapeHtml(world.attribution)}" target="_blank" rel="noreferrer">Source & attribution</a></div></article>`).join("")}</section>
  <p class="world-divider"><span>Find another place</span></p><form class="catalog-form" role="search"><label>Search greenways-worlds<input name="query" type="search" placeholder="garden, apartment, gaussian splat"></label><button type="submit">Search worlds</button></form><div class="catalog-results" aria-live="polite"></div>
  <form class="world-form"><label>GitHub repository<input name="repo" type="url" required placeholder="https://github.com/owner/world" value="${escapeHtml(state.repository)}"></label><label>Ref (optional)<input name="ref" placeholder="main, tag, or commit SHA" value="${escapeHtml(state.ref)}"></label><label class="mode-control"><input name="strict" type="checkbox" ${state.mode === "strict" ? "checked" : ""}> Strict commits</label><button type="submit">Open with Hodos</button></form></section></div><footer class="welcome-footer"><span>HODOS / WORLDS</span><span>Kernel-bundled places · open repositories</span></footer></div></section>`;

  root.querySelector("[data-theme-toggle]").addEventListener("click", () => {
    const current = document.documentElement.dataset.themePreference || "auto";
    applyTheme(current === "auto" ? "light" : current === "light" ? "dark" : "auto");
  });
  root.querySelector(".catalog-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const results = root.querySelector(".catalog-results");
    results.innerHTML = "<p>Searching…</p>";
    try {
      await viewer.requestGitHubAccess();
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
      await viewer.requestGitHubAccess();
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
      await viewer.requestGitHubAccess();
      navigate({
        repository: world.repository,
        ref: "",
        mode: "dev",
        experience: world.experience || "",
      });
    } catch (requestError) {
      renderDemo(requestError.message);
    }
  }));
}

const initial = queryState();
if (initial.repository) {
  viewer.open({
    ...initial,
    touchpoints: initial.experience === "studio" ? STUDIO_TOUCHPOINTS : [],
  }).catch(() => {});
} else {
  renderDemo();
}
window.addEventListener("beforeunload", () => viewer.destroy(), { once: true });
