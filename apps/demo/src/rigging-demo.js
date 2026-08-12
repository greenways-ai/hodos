import "./rigging-demo.css";
import {
  createHodosComponentHost,
  createHodosComponentRegistry,
} from "@greenways/hodos-web";
import {
  HODOS_RIGGING_AUTHORING_COMPONENT_ID,
  HODOS_RIGGING_AUTHORING_EVENTS,
  registerHodosRiggingAuthoringUi,
} from "@greenways/hodos-ui-world-authoring";
import {
  createRiggingDemoState,
  reduceRiggingDemoState,
  RIGGING_DEMO_FIXTURE,
  riggingDemoSummary,
} from "./rigging-demo-model.js";

const randomId = (prefix) => (
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`
);

function requireContribution(host, kind, name) {
  const value = host.getContribution(kind, name);
  if (!value) throw new Error(`Hodos rigging demo requires ${kind}/${name}`);
  return value;
}

function descriptor(state) {
  return {
    "component/id": HODOS_RIGGING_AUTHORING_COMPONENT_ID,
    "component/model": { state },
    "component/events": HODOS_RIGGING_AUTHORING_EVENTS,
  };
}

function shortIdentity(value) {
  if (!value) return "Not opened";
  return value.length > 30 ? `${value.slice(0, 18)}…${value.slice(-8)}` : value;
}

export async function mountRiggingDemo({
  root,
  hodosHost,
  fetchImpl = (...args) => globalThis.fetch(...args),
  fixtureUrl = RIGGING_DEMO_FIXTURE,
} = {}) {
  if (!root) throw new TypeError("Hodos rigging demo requires a root");
  if (!hodosHost) throw new TypeError("Hodos rigging demo requires the activated Hodos host");

  root.dataset.experience = "rigging";
  root.innerHTML = `
    <section class="rigging-demo-shell">
      <header class="rigging-demo-header">
        <a class="rigging-demo-back" href="./" aria-label="Back to Hodos demos">← Hodos demos</a>
        <div>
          <p>CLIENT-SIDE AUTHORING</p>
          <h1>Rig a local 3D model</h1>
        </div>
        <span class="rigging-demo-private">Device only · no upload</span>
        <button type="button" data-rig-demo-example>Load example GLB</button>
      </header>
      <section class="rigging-demo-evidence" aria-label="Rigging session evidence">
        <span><small>Source</small><strong data-rig-demo-source>Not opened</strong></span>
        <span><small>Revision</small><strong data-rig-demo-revision>0</strong></span>
        <span><small>Joints</small><strong data-rig-demo-joints>0</strong></span>
        <span><small>Last operation</small><strong data-rig-demo-outcome>Ready</strong></span>
      </section>
      <div class="rigging-demo-component" data-rig-demo-component></div>
      <div class="rigging-demo-live" role="status" aria-live="polite" data-rig-demo-live></div>
    </section>`;

  const componentRoot = root.querySelector("[data-rig-demo-component]");
  const exampleButton = root.querySelector("[data-rig-demo-example]");
  const sourceNode = root.querySelector("[data-rig-demo-source]");
  const revisionNode = root.querySelector("[data-rig-demo-revision]");
  const jointsNode = root.querySelector("[data-rig-demo-joints]");
  const outcomeNode = root.querySelector("[data-rig-demo-outcome]");
  const liveNode = root.querySelector("[data-rig-demo-live]");

  const riggingUi = requireContribution(hodosHost, "rig.ui", "authoring");
  const riggingRenderer = requireContribution(hodosHost, "rig.renderer", "playcanvas");
  const riggingAssets = requireContribution(hodosHost, "rig.asset-host", "playcanvas-local");
  const assetHost = riggingAssets.create({
    id: randomId("hodos-demo-rigging"),
    maximumAssets: 4,
    maximumTotalBytes: 256 * 1024 * 1024,
  });
  const createRenderer = (canvas, options) => new riggingRenderer.AuthoringRenderer(canvas, options);
  const createRiggingAuthoringHost = riggingUi.createHost({
    assetHost,
    createRenderer,
  });

  const registry = createHodosComponentRegistry();
  const unregister = registerHodosRiggingAuthoringUi(registry, {
    createRiggingAuthoringHost,
  });
  let state = createRiggingDemoState({
    sessionId: randomId("rig-session"),
    historyLimit: 64,
  });
  let componentHost = null;
  let destroyed = false;

  const renderEvidence = (event = null) => {
    const summary = riggingDemoSummary(state);
    sourceNode.textContent = shortIdentity(summary.contentId);
    sourceNode.title = summary.contentId ?? "";
    revisionNode.textContent = String(summary.revision);
    jointsNode.textContent = String(summary.joints);
    outcomeNode.textContent = summary.outcome === "rejected" ? "Rejected" : "Ready";
    outcomeNode.dataset.tone = summary.outcome;
    if (summary.message) liveNode.textContent = summary.message;
    else if (event?.["event/type"] === "rig/source-opened" && summary.contentId) {
      liveNode.textContent = `${summary.fileName} opened locally`;
    }
  };

  const dispatch = async (event) => {
    if (destroyed) return state;
    state = reduceRiggingDemoState(state, event);
    componentHost?.update(descriptor(state), { experience: "rigging" });
    renderEvidence(event);
    return state;
  };

  componentHost = createHodosComponentHost({
    root: componentRoot,
    registry,
    dispatch,
    services: Object.freeze({
      rigging: Object.freeze({
        assetHost,
        createRenderer,
        createAuthoringHost: createRiggingAuthoringHost,
      }),
    }),
  });
  componentHost.mount(descriptor(state), { experience: "rigging" });
  renderEvidence();

  const openFixture = async () => {
    if (destroyed) return null;
    exampleButton.disabled = true;
    exampleButton.textContent = "Opening example…";
    liveNode.textContent = "Opening the packaged example through the local asset boundary";
    delete liveNode.dataset.tone;
    try {
      const response = await fetchImpl(fixtureUrl, { cache: "force-cache" });
      if (!response.ok) throw new Error(`Unable to load the example GLB (${response.status})`);
      const fixture = await response.blob();
      const result = await assetHost.open(state.session, fixture, {
        fileName: "hodos-stylized-unrigged.glb",
        mediaType: "model/gltf-binary",
      });
      const event = {
        "event/type": "rig/source-opened",
        session: result.session,
        preserveDocument: false,
      };
      if (result.source) event.rigId = `rig:${result.source.contentId.slice(7, 19)}`;
      await dispatch(event);
      if (!result.ok) throw new Error(result.error?.message ?? "Unable to open the example GLB");
      return result;
    } catch (error) {
      liveNode.textContent = error.message || String(error);
      liveNode.dataset.tone = "error";
      return null;
    } finally {
      exampleButton.disabled = false;
      exampleButton.textContent = "Load example GLB";
    }
  };

  exampleButton.addEventListener("click", openFixture);

  return Object.freeze({
    getState: () => state,
    openFixture,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      exampleButton.removeEventListener("click", openFixture);
      componentHost.destroy();
      unregister();
      assetHost.destroy();
      root.replaceChildren();
      delete root.dataset.experience;
    },
  });
}
