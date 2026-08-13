import "./mixamo-animation-demo.css";
import { createHodosHost } from "@greenways/hodos-core";
import {
  hodosViewerDistribution,
  HODOS_DEFAULT_VIEWER_ADDON_ID,
} from "@greenways/hodos-viewer-defaults";
import {
  createMixamoAnimationDemoState,
  MIXAMO_ANIMATION_EDITABLE_JOINTS,
  reduceMixamoAnimationDemoState,
} from "./mixamo-animation-demo-model.js";

const root = document.querySelector("#hodos-animation-demo");
if (!root) throw new Error("Hodos Animation Lab requires #hodos-animation-demo");

const jointLabel = (joint) => joint
  .split("-")
  .map((word) => word[0].toUpperCase() + word.slice(1))
  .join(" ");

const formatDuration = (seconds) => Number.isFinite(seconds) && seconds > 0
  ? `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`
  : "—";

function button(document, label, action, className = "") {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.dataset.action = action;
  if (className) element.className = className;
  return element;
}

function renderFatal(error) {
  root.innerHTML = `
    <section class="animation-fatal" role="alert">
      <a href="./">← Hodos demos</a>
      <p>ANIMATION LAB</p>
      <h1>The animation workbench could not start.</h1>
      <pre></pre>
    </section>`;
  root.querySelector("pre").textContent = error instanceof Error ? error.message : String(error);
}

function shell() {
  root.innerHTML = `
    <section class="animation-lab" data-mobile-panel="library">
      <canvas class="animation-stage" aria-label="Interactive Hodos Mixamo animation preview"></canvas>
      <header class="animation-toolbar">
        <a href="./" class="animation-back" aria-label="Back to Hodos demos">← Hodos demos</a>
        <div class="animation-toolbar-title">
          <p>CHARACTER ANIMATION</p>
          <h1>Animation Lab</h1>
        </div>
        <div class="animation-character-summary">
          <span data-character-source>Opening mannequin…</span>
          <strong data-character-family>Mixamo-compatible</strong>
        </div>
        <button type="button" class="animation-toolbar-action" data-action="reset-mannequin">Reset mannequin</button>
      </header>

      <nav class="animation-mobile-tabs" aria-label="Animation tools">
        <button type="button" data-mobile-tab="library" aria-pressed="true">Library</button>
        <button type="button" data-mobile-tab="pose" aria-pressed="false">Pose</button>
        <button type="button" data-mobile-tab="sequence" aria-pressed="false">Sequence</button>
      </nav>

      <aside class="animation-panel animation-panel--library" data-panel="library" aria-label="Animation library">
        <header>
          <p>01 · ASSETS</p>
          <h2>Motion library</h2>
          <span>Start with the built-in Hodos motions or replace them with local GLB files.</span>
        </header>

        <label class="animation-file-control">
          <strong>Character GLB</strong>
          <span>Converted Mixamo character · stays on this device</span>
          <input type="file" accept=".glb,model/gltf-binary" data-character-file>
        </label>
        <label class="animation-file-control">
          <strong>Animation GLBs</strong>
          <span>Animation-only Mixamo files · multiple selection supported</span>
          <input type="file" accept=".glb,model/gltf-binary" multiple data-animation-files>
        </label>
        <label class="animation-field">
          <span>Imported root motion</span>
          <select data-root-motion>
            <option value="none">In place</option>
            <option value="apply">Apply hips translation</option>
          </select>
        </label>

        <div class="animation-playback-controls">
          <label>
            <span>Speed <output data-speed-output>1.00×</output></span>
            <input type="range" min="0.25" max="2" step="0.05" value="1" data-speed>
          </label>
          <label>
            <span>Blend <output data-blend-output>0.20s</output></span>
            <input type="range" min="0" max="1" step="0.05" value="0.2" data-blend>
          </label>
          <div>
            <button type="button" class="animation-primary" data-action="play-selected">Play selected</button>
            <button type="button" data-action="pause">Pause</button>
          </div>
        </div>

        <div class="animation-clip-list" data-clip-list aria-live="polite"></div>
      </aside>

      <aside class="animation-panel animation-panel--pose" data-panel="pose" aria-label="Pose authoring">
        <header>
          <p>02 · AUTHOR</p>
          <h2>Pose-to-pose</h2>
          <span>Correct a joint, capture timed poses, then bake them into a reusable clip.</span>
        </header>

        <label class="animation-field">
          <span>Joint</span>
          <select data-pose-joint>${MIXAMO_ANIMATION_EDITABLE_JOINTS.map((joint) => `<option value="${joint}">${jointLabel(joint)}</option>`).join("")}</select>
        </label>
        <div class="animation-rotation-grid">
          ${["X", "Y", "Z"].map((axis, index) => `
            <label>
              <span>${axis} <output data-rotation-output="${index}">0°</output></span>
              <input type="range" min="-180" max="180" step="1" value="0" data-rotation-axis="${index}">
            </label>`).join("")}
        </div>
        <label class="animation-field animation-time-field">
          <span>Key time <output data-key-time-output>0.00s</output></span>
          <input type="range" min="0" max="2" step="0.05" value="0" data-key-time>
        </label>
        <label class="animation-field">
          <span>Authored clip duration</span>
          <input type="number" min="0.25" max="30" step="0.25" value="2" data-pose-duration>
        </label>

        <div class="animation-button-grid">
          <button type="button" data-action="reset-pose">Reset pose</button>
          <button type="button" class="animation-primary" data-action="capture-pose">Capture key</button>
          <button type="button" data-action="clear-pose-keys">Clear keys</button>
          <button type="button" class="animation-primary" data-action="bake-pose">Bake clip</button>
        </div>
        <button type="button" class="animation-quick-author" data-action="quick-author">Create a quick browser wave</button>
        <ol class="animation-pose-keys" data-pose-keys aria-label="Captured pose keys"></ol>
      </aside>

      <section class="animation-sequence-tray" data-panel="sequence" aria-label="Animation sequence">
        <header>
          <div>
            <p>03 · CHOREOGRAPH</p>
            <h2>Sequence queue</h2>
          </div>
          <span data-sequence-status>Idle</span>
        </header>
        <div class="animation-sequence-actions">
          <button type="button" data-action="sequence-add">Add selected</button>
          <button type="button" class="animation-primary" data-action="sequence-play">Play sequence</button>
          <button type="button" data-action="sequence-stop">Stop</button>
          <button type="button" data-action="sequence-clear">Clear</button>
        </div>
        <ol class="animation-sequence-list" data-sequence-list></ol>
      </section>

      <div class="animation-notice" role="status" aria-live="polite" data-notice></div>
      <div class="animation-private-note">Local files never leave this browser · no Adobe assets are bundled</div>
    </section>`;
}

async function start() {
  shell();
  const document = root.ownerDocument;
  const host = createHodosHost({
    capabilities: [
      "character.animation",
      "network.github",
      "sequence.execute",
      "world.render",
    ],
  });
  host.register(hodosViewerDistribution);
  await host.activate([HODOS_DEFAULT_VIEWER_ADDON_ID]);

  const rendererProvider = host.getContribution("world.renderer", "playcanvas");
  const mixamoProvider = host.getContribution("character.host", "playcanvas-mixamo");
  if (!rendererProvider?.Renderer) throw new Error("The PlayCanvas world renderer is unavailable");
  if (!mixamoProvider?.createAnimationWorkbench) throw new Error("The Mixamo animation workbench is unavailable");

  const lab = root.querySelector(".animation-lab");
  const canvas = root.querySelector(".animation-stage");
  const renderer = new rendererProvider.Renderer(canvas, {
    background: "#07100d",
    camera: {
      position: [3.4, 2.1, 4.4],
      target: [0, 1, 0],
      fov: 48,
    },
  });

  let state = createMixamoAnimationDemoState();
  let cueCounter = 1;
  let workbench = null;
  let disposed = false;

  const elements = {
    characterSource: root.querySelector("[data-character-source]"),
    characterFamily: root.querySelector("[data-character-family]"),
    clipList: root.querySelector("[data-clip-list]"),
    notice: root.querySelector("[data-notice]"),
    poseKeys: root.querySelector("[data-pose-keys]"),
    sequenceList: root.querySelector("[data-sequence-list]"),
    sequenceStatus: root.querySelector("[data-sequence-status]"),
    speed: root.querySelector("[data-speed]"),
    speedOutput: root.querySelector("[data-speed-output]"),
    blend: root.querySelector("[data-blend]"),
    blendOutput: root.querySelector("[data-blend-output]"),
    poseJoint: root.querySelector("[data-pose-joint]"),
    rotations: [...root.querySelectorAll("[data-rotation-axis]")],
    rotationOutputs: [...root.querySelectorAll("[data-rotation-output]")],
    keyTime: root.querySelector("[data-key-time]"),
    keyTimeOutput: root.querySelector("[data-key-time-output]"),
    poseDuration: root.querySelector("[data-pose-duration]"),
  };

  function dispatch(event) {
    state = reduceMixamoAnimationDemoState(state, event);
    render();
    return state;
  }

  function workbenchEvent(event) {
    switch (event.type) {
      case "animation/character-ready":
        dispatch({ ...event, type: "animation/character-ready" });
        break;
      case "animation/clips-added":
        dispatch({
          type: "animation/clips-add",
          clips: event.clips,
          selectedClip: event.clips?.[0]?.id,
          message: event.message,
        });
        break;
      case "animation/clip-authored":
        dispatch({
          type: "animation/clips-add",
          clips: [event.clip],
          selectedClip: event.clip.id,
          message: `Baked ${event.clip.id} from ${event.poseKeyCount} pose keys`,
        });
        break;
      case "animation/playback":
        dispatch({ type: "animation/playback", playback: event.playback });
        break;
      case "animation/pose-captured":
        dispatch({ type: "animation/pose-captured", key: event.key });
        break;
      case "animation/pose-cleared":
        dispatch({ type: "animation/pose-clear" });
        break;
      case "animation/pose-reset":
        dispatch({ type: "animation/pose-reset" });
        break;
      case "animation/sequence-started":
        dispatch({ type: "animation/sequence-status", status: "playing", message: "Sequence started" });
        break;
      case "animation/sequence-cue":
        dispatch({
          type: "animation/sequence-status",
          status: "playing",
          current: event.cue.clipId,
          message: `Playing ${event.cue.clipId}`,
        });
        break;
      case "animation/sequence-complete":
        dispatch({ type: "animation/sequence-status", status: "complete", current: null, message: "Sequence complete" });
        break;
      case "animation/sequence-stopped":
        dispatch({ type: "animation/sequence-status", status: "idle", current: null, message: event.message });
        break;
      default:
        break;
    }
  }

  function clipElement(clip) {
    const item = document.createElement("article");
    item.className = "animation-clip";
    item.dataset.selected = clip.id === state.selectedClip ? "true" : "false";
    if (clip.id === state.playback.current && state.playback.status === "playing") item.dataset.playing = "true";
    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = clip.label;
    const meta = document.createElement("span");
    meta.textContent = `${clip.source} · ${formatDuration(clip.duration)}${clip.loop ? " · loop" : ""}`;
    details.append(title, meta);
    const actions = document.createElement("div");
    const select = button(document, clip.id === state.selectedClip ? "Selected" : "Select", "select-clip");
    select.dataset.clipId = clip.id;
    const play = button(document, "Play", "play-clip", "animation-primary");
    play.dataset.clipId = clip.id;
    actions.append(select, play);
    item.append(details, actions);
    return item;
  }

  function renderClips() {
    elements.clipList.replaceChildren();
    if (!state.clips.length) {
      const empty = document.createElement("p");
      empty.className = "animation-empty";
      empty.textContent = "This character has no clips yet. Add an animation GLB or create one in the Pose panel.";
      elements.clipList.append(empty);
      return;
    }
    elements.clipList.append(...state.clips.map(clipElement));
  }

  function renderPoseKeys() {
    elements.poseKeys.replaceChildren();
    if (!state.poseKeys.length) {
      const empty = document.createElement("li");
      empty.className = "animation-empty";
      empty.textContent = "No keys captured. Capture the rest pose, change a joint, then capture another time.";
      elements.poseKeys.append(empty);
      return;
    }
    for (const key of state.poseKeys) {
      const item = document.createElement("li");
      const time = document.createElement("strong");
      time.textContent = `${key.at.toFixed(2)}s`;
      const joints = document.createElement("span");
      joints.textContent = `${Object.keys(key.joints).length} joints`;
      item.append(time, joints);
      elements.poseKeys.append(item);
    }
  }

  function renderSequence() {
    elements.sequenceList.replaceChildren();
    if (!state.sequence.length) {
      const empty = document.createElement("li");
      empty.className = "animation-empty";
      empty.textContent = "Add clips to create a short choreography.";
      elements.sequenceList.append(empty);
    } else {
      state.sequence.forEach((cue, index) => {
        const item = document.createElement("li");
        item.dataset.current = cue.clipId === state.sequenceCurrent ? "true" : "false";
        const order = document.createElement("span");
        order.textContent = String(index + 1).padStart(2, "0");
        const title = document.createElement("strong");
        title.textContent = state.clips.find((clip) => clip.id === cue.clipId)?.label ?? cue.clipId;
        const meta = document.createElement("small");
        meta.textContent = `${cue.speed.toFixed(2)}× · ${cue.blend.toFixed(2)}s blend`;
        const remove = button(document, "×", "sequence-remove");
        remove.dataset.cueId = cue.id;
        remove.setAttribute("aria-label", `Remove ${cue.clipId} from sequence`);
        item.append(order, title, meta, remove);
        elements.sequenceList.append(item);
      });
    }
    elements.sequenceStatus.textContent = state.sequenceStatus === "playing"
      ? `Playing${state.sequenceCurrent ? ` · ${state.sequenceCurrent}` : ""}`
      : state.sequenceStatus === "complete"
        ? "Complete"
        : "Idle";
  }

  function render() {
    if (disposed) return;
    lab.dataset.busy = state.busy ? "true" : "false";
    elements.characterSource.textContent = state.character?.source?.fileName
      ?? state.character?.id
      ?? "No character";
    elements.characterFamily.textContent = state.character?.profile?.family
      ?? "Mixamo-compatible";
    elements.notice.textContent = state.error ?? state.message ?? "";
    elements.notice.dataset.error = state.error ? "true" : "false";
    elements.notice.hidden = !(state.error || state.message);
    elements.speed.value = String(state.playback.speed);
    elements.speedOutput.textContent = `${state.playback.speed.toFixed(2)}×`;
    elements.blend.value = String(state.playback.blend);
    elements.blendOutput.textContent = `${state.playback.blend.toFixed(2)}s`;
    elements.poseJoint.value = state.pose.joint;
    elements.rotations.forEach((input, index) => { input.value = String(state.pose.rotation[index]); });
    elements.rotationOutputs.forEach((output, index) => { output.textContent = `${Math.round(state.pose.rotation[index])}°`; });
    elements.keyTime.max = String(state.pose.duration);
    elements.keyTime.value = String(Math.min(state.pose.at, state.pose.duration));
    elements.keyTimeOutput.textContent = `${Math.min(state.pose.at, state.pose.duration).toFixed(2)}s`;
    elements.poseDuration.value = String(state.pose.duration);
    for (const control of root.querySelectorAll("button, input, select")) {
      if (control.matches("[data-mobile-tab]")) continue;
      control.disabled = state.busy;
    }
    renderClips();
    renderPoseKeys();
    renderSequence();
  }

  async function task(message, operation) {
    if (state.busy) return;
    dispatch({ type: "animation/busy", busy: true, message });
    try {
      await operation();
      dispatch({ type: "animation/busy", busy: false });
    } catch (error) {
      console.error("Hodos Animation Lab operation failed", error);
      dispatch({ type: "animation/error", error });
    }
  }

  workbench = mixamoProvider.createAnimationWorkbench({
    app: renderer.app,
    onEvent: workbenchEvent,
  });
  await workbench.open();

  for (const [index, clipId] of ["idle", "wave", "bow"].entries()) {
    if (!state.clips.some((clip) => clip.id === clipId)) continue;
    dispatch({
      type: "animation/sequence-add",
      item: { id: `demo-cue:${index + 1}`, clipId, blend: 0.2, speed: 1 },
    });
  }

  root.addEventListener("click", (event) => {
    const mobile = event.target.closest("[data-mobile-tab]");
    if (mobile) {
      lab.dataset.mobilePanel = mobile.dataset.mobileTab;
      root.querySelectorAll("[data-mobile-tab]").forEach((tab) => {
        tab.setAttribute("aria-pressed", String(tab === mobile));
      });
      return;
    }
    const target = event.target.closest("[data-action]");
    if (!target || state.busy) return;
    const { action } = target.dataset;
    if (action === "select-clip") {
      dispatch({ type: "animation/select-clip", clipId: target.dataset.clipId });
    } else if (action === "play-clip") {
      const clipId = target.dataset.clipId;
      dispatch({ type: "animation/select-clip", clipId });
      workbench.play(clipId, { speed: state.playback.speed, blend: state.playback.blend });
    } else if (action === "play-selected" && state.selectedClip) {
      workbench.play(state.selectedClip, { speed: state.playback.speed, blend: state.playback.blend });
    } else if (action === "pause") {
      workbench.pause();
    } else if (action === "reset-mannequin") {
      task("Restoring the built-in mannequin…", () => workbench.useProceduralCharacter());
    } else if (action === "reset-pose") {
      workbench.resetPose();
    } else if (action === "capture-pose") {
      workbench.capturePoseKey(state.pose.at);
    } else if (action === "clear-pose-keys") {
      workbench.clearPoseKeys();
    } else if (action === "bake-pose") {
      task("Baking the authored pose clip…", async () => {
        const clip = workbench.bakePoseClip({
          id: `authored-${Date.now().toString(36)}`,
          label: "Browser-authored pose",
          duration: state.pose.duration,
        });
        workbench.play(clip.id, { speed: state.playback.speed, blend: state.playback.blend });
      });
    } else if (action === "quick-author") {
      task("Creating a three-key browser wave…", async () => {
        const duration = state.pose.duration;
        workbench.clearPoseKeys();
        workbench.resetPose();
        workbench.capturePoseKey(0);
        workbench.setJointRotation("right-arm", [0, 0, 76]);
        workbench.setJointRotation("right-forearm", [28, 0, 58]);
        workbench.capturePoseKey(duration / 2);
        workbench.resetPose();
        workbench.capturePoseKey(duration);
        const clip = workbench.bakePoseClip({
          id: `browser-wave-${Date.now().toString(36)}`,
          label: "Browser wave",
          duration,
        });
        workbench.play(clip.id, { speed: state.playback.speed, blend: state.playback.blend });
      });
    } else if (action === "sequence-add") {
      dispatch({
        type: "animation/sequence-add",
        item: {
          id: `cue:${cueCounter++}`,
          clipId: state.selectedClip,
          speed: state.playback.speed,
          blend: state.playback.blend,
        },
      });
    } else if (action === "sequence-remove") {
      dispatch({ type: "animation/sequence-remove", id: target.dataset.cueId });
    } else if (action === "sequence-play") {
      task("Starting the sequence…", async () => {
        workbench.playSequence(state.sequence, {
          speed: state.playback.speed,
          blend: state.playback.blend,
        });
      });
    } else if (action === "sequence-stop") {
      workbench.stopSequence();
      workbench.pause();
    } else if (action === "sequence-clear") {
      workbench.stopSequence({ message: "Sequence cleared" });
      dispatch({ type: "animation/sequence-clear" });
    }
  });

  root.querySelector("[data-character-file]").addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    task(`Loading ${file.name} locally…`, () => workbench.loadCharacter(file, {
      id: "local-character",
      assetId: `local:${file.name}:${file.size}:${file.lastModified}`,
    }));
  });

  root.querySelector("[data-animation-files]").addEventListener("change", (event) => {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    if (!files.length) return;
    task(`Importing ${files.length} animation file${files.length === 1 ? "" : "s"}…`, async () => {
      for (const file of files) {
        await workbench.loadAnimation(file, {
          id: file.name.replace(/\.[^.]+$/, ""),
          rootMotion: root.querySelector("[data-root-motion]").value,
        });
      }
    });
  });

  elements.speed.addEventListener("input", () => {
    dispatch({
      type: "animation/playback",
      playback: { speed: Number(elements.speed.value) },
    });
  });
  elements.blend.addEventListener("input", () => {
    dispatch({
      type: "animation/playback",
      playback: { blend: Number(elements.blend.value) },
    });
  });
  elements.poseJoint.addEventListener("change", () => {
    dispatch({ type: "animation/pose-joint", joint: elements.poseJoint.value });
    workbench.setJointRotation(state.pose.joint, state.pose.rotation);
  });
  elements.rotations.forEach((input, axis) => input.addEventListener("input", () => {
    dispatch({ type: "animation/pose-rotation", axis, value: Number(input.value) });
    workbench.setJointRotation(state.pose.joint, state.pose.rotation);
  }));
  elements.keyTime.addEventListener("input", () => {
    dispatch({ type: "animation/pose-time", at: Number(elements.keyTime.value) });
  });
  elements.poseDuration.addEventListener("change", () => {
    dispatch({ type: "animation/pose-duration", duration: Number(elements.poseDuration.value) });
  });

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    try { workbench?.destroy?.(); } catch (error) { console.error("Animation workbench cleanup failed", error); }
    try { renderer?.destroy?.(); } catch (error) { console.error("Animation renderer cleanup failed", error); }
    try { host?.destroy?.(); } catch (error) { console.error("Animation Hodos host cleanup failed", error); }
  };
  window.addEventListener("beforeunload", cleanup, { once: true });
  render();
}

start().catch((error) => {
  console.error("Hodos Animation Lab failed", error);
  renderFatal(error);
});
