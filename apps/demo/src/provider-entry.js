import "./provider-world.css";
import {
  PublicGitHubClient,
  createWorldProviderLaunchIntent,
  requestGitHubAccess,
  resolveWorldGraph,
} from "@greenways/hodos-source-github";
import {
  createWorldProviderHost,
  createWorldProviderRegistry,
} from "@greenways/hodos-viewer/providers";
import {
  ALUMBRA_PROVIDER_ID,
  PEACOCK_BALLROOM_ACTIVITY_ID,
  PEACOCK_BALLROOM_DEFAULT_STATE,
  PEACOCK_BALLROOM_STATES,
  createAlumbraWorldProviderRegistration,
} from "./alumbra-provider.js";

const root = document.querySelector("#hodos-app");
const query = new URL(location.href).searchParams;
const requestedProvider = query.get("provider") ?? "";
const requestedWorld = query.get("world") ?? "";
const requestedRef = query.get("ref") ?? "";
const requestedState = query.get("state") ?? PEACOCK_BALLROOM_DEFAULT_STATE;
let activeHost = null;
let disposed = false;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function providerHref(state = PEACOCK_BALLROOM_DEFAULT_STATE) {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("provider", ALUMBRA_PROVIDER_ID);
  url.searchParams.set("world", "https://github.com/greenways-ai/alumbra");
  url.searchParams.set("state", PEACOCK_BALLROOM_STATES.includes(state) ? state : PEACOCK_BALLROOM_DEFAULT_STATE);
  return url.href;
}

function peacockCard(document = globalThis.document) {
  const article = document.createElement("article");
  article.className = "featured-world featured-world--provider";
  article.dataset.providerWorld = PEACOCK_BALLROOM_ACTIVITY_ID;
  article.innerHTML = `<span>Hara architectural world</span>
    <h2>Peacock Ballroom</h2>
    <p>Enter an ivory, teal-glass and gold ballroom generated in Hara and projected by the installed Alumbra world provider.</p>
    <ul class="featured-world-features"><li>48 canonical chunks</li><li>Sunlight and chandelier emission</li><li>Playable edits and undo</li></ul>
    <div><a class="provider-world-action" href="${providerHref()}">Open provider world</a><a href="https://github.com/greenways-ai/alumbra" target="_blank" rel="noreferrer">Source &amp; provider</a></div>`;
  return article;
}

function installPeacockCard() {
  const install = () => {
    const collection = root?.querySelector(".featured-worlds");
    if (!collection) return false;
    if (!collection.querySelector(`[data-provider-world="${PEACOCK_BALLROOM_ACTIVITY_ID}"]`)) {
      collection.prepend(peacockCard());
    }
    return true;
  };
  if (install() || !root) return;
  const observer = new MutationObserver(() => {
    if (install()) observer.disconnect();
  });
  observer.observe(root, {childList: true, subtree: true});
}

function renderProviderShell() {
  root.innerHTML = `<section class="provider-world-page">
    <nav class="provider-world-toolbar" aria-label="Provider world controls">
      <a href="./">← Hodos Worlds</a>
      <strong>Peacock Ballroom</strong>
      <span data-provider-world-status>Resolving the repository provider manifest…</span>
      ${PEACOCK_BALLROOM_STATES.map((state) => `<button type="button" data-provider-state="${state}" aria-pressed="${state === requestedState}">${state.split("/").at(-1).replaceAll("-", " ")}</button>`).join("")}
    </nav>
    <div class="provider-world-mount" data-provider-world-mount></div>
  </section>`;
  root.querySelectorAll("[data-provider-state]").forEach((button) => {
    button.addEventListener("click", () => location.assign(providerHref(button.dataset.providerState)));
  });
  return {
    mount: root.querySelector("[data-provider-world-mount]"),
    status: root.querySelector("[data-provider-world-status]"),
  };
}

async function waitForProviderReady(host) {
  for (let attempt = 0; attempt < 800; attempt += 1) {
    const snapshot = host.snapshot();
    if (snapshot.provider?.status === "ready") return snapshot;
    if (snapshot.status === "failed" || snapshot.provider?.status === "failed") {
      throw new Error("Installed provider failed before its surface became ready");
    }
    await sleep(25);
  }
  throw new Error("Installed provider surface did not become ready");
}

async function openProviderWorld() {
  if (!root) throw new Error("Hodos demo is missing its application root");
  if (requestedProvider !== ALUMBRA_PROVIDER_ID) {
    throw new Error(`Provider is not installed in this Hodos application: ${requestedProvider}`);
  }
  if (requestedWorld !== "https://github.com/greenways-ai/alumbra") {
    throw new Error("Peacock Ballroom must resolve from the installed greenways-ai/alumbra repository identity");
  }
  const surface = renderProviderShell();
  await requestGitHubAccess();
  const client = new PublicGitHubClient({
    request: (...args) => globalThis.fetch(...args),
    activatePackages: async () => Object.freeze({status: "provider-owned"}),
  });
  const graph = await resolveWorldGraph({
    repository: requestedWorld,
    ref: requestedRef,
    mode: "dev",
    client,
  });
  if (!graph.complete) {
    throw new Error(graph.diagnostics.map((diagnostic) => diagnostic.message).join("\n") || "Provider world graph is incomplete");
  }
  if (!graph.project.provider) throw new Error("Repository world does not declare an installed provider");
  if (graph.project.provider.id !== requestedProvider) {
    throw new Error(`Repository requested provider ${graph.project.provider.id}, not ${requestedProvider}`);
  }
  const launch = createWorldProviderLaunchIntent(graph.project.provider, {state: requestedState});
  const registry = createWorldProviderRegistry([
    createAlumbraWorldProviderRegistration(),
  ]);
  activeHost = createWorldProviderHost({root: surface.mount, registry});
  await activeHost.open(launch, {
    repository: graph.repository.url,
    commit: graph.commit,
    projectId: graph.project.id,
    projectVersion: graph.project.version,
  });
  const ready = await waitForProviderReady(activeHost);
  surface.status.textContent = `${launch.activityId} · ${launch.state} · ${graph.commit.slice(0, 8)}`;
  const data = document.documentElement.dataset;
  data.providerWorldReady = "true";
  data.providerWorldProvider = launch.providerId;
  data.providerWorldActivity = launch.activityId;
  data.providerWorldState = launch.state;
  data.providerWorldAllocations = String(ready.allocations);
  window.__HODOS_PROVIDER_WORLD__ = Object.freeze({
    graph: Object.freeze({
      repository: graph.repository.url,
      commit: graph.commit,
      projectId: graph.project.id,
      projectVersion: graph.project.version,
    }),
    launch,
    host: ready,
  });
}

function renderFailure(error) {
  if (!root) return;
  root.innerHTML = `<section class="provider-world-page"><div class="provider-world-error"><p>HODOS / PROVIDER WORLD</p><h1>Unable to open the installed world.</h1><code>${String(error?.message ?? error).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</code><p><a href="./">Return to Hodos Worlds</a></p></div></section>`;
  document.documentElement.dataset.providerWorldReady = "false";
  console.error("Hodos provider-backed world failed", error);
}

if (requestedProvider) {
  void openProviderWorld().catch(renderFailure);
} else {
  installPeacockCard();
}

async function destroy() {
  if (disposed) return;
  disposed = true;
  await activeHost?.destroy();
}
window.addEventListener("pagehide", () => { void destroy(); }, {once: true});
