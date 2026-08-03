import "./studio.css";
import {
  createProjectBundle,
  encodeWav,
  renderProjectMix,
  safeFilename,
  saveBlob,
} from "./studio-export.js";
import { createStudioStore } from "./studio-storage.js";

const AUDIO_EXTENSIONS = /\.(?:wav|mp3|m4a|aac|ogg|flac|webm)$/i;
const decibels = (value) => 10 ** (Number(value || 0) / 20);
const randomId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

function basename(value) {
  return String(value).replace(/\.[^.]+$/, "") || "Audio track";
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function contentId(buffer) {
  if (globalThis.crypto?.subtle) {
    return `sha256:${hex(await globalThis.crypto.subtle.digest("SHA-256", buffer))}`;
  }
  return randomId("asset");
}

export class StudioAudioRuntime {
  constructor(store) {
    this.store = store;
    this.context = null;
    this.buffers = new Map();
    this.sources = [];
  }

  audioContext() {
    if (!this.context) {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new Error("This browser does not provide Web Audio");
      this.context = new Context();
    }
    return this.context;
  }

  async decode(bytes) {
    return this.audioContext().decodeAudioData(bytes.slice(0));
  }

  async importFile(file) {
    const bytes = await file.arrayBuffer();
    const id = await contentId(bytes);
    let buffer = this.buffers.get(id);
    if (!buffer) {
      buffer = await this.decode(bytes);
      this.buffers.set(id, buffer);
    }
    const asset = {
      id,
      name: file.name,
      mediaType: file.type || "application/octet-stream",
      size: file.size,
      duration: buffer.duration,
      channels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
    };
    asset.storage = await this.store.saveAsset(asset, bytes);
    return { asset, buffer };
  }

  async hydrateAsset(asset) {
    if (this.buffers.has(asset.id)) return this.buffers.get(asset.id);
    const bytes = await this.store.readAsset(asset);
    const buffer = await this.decode(bytes);
    this.buffers.set(asset.id, buffer);
    return buffer;
  }

  async hydrateProject(project, onAsset = () => {}) {
    const missing = [];
    for (const asset of project?.assets ?? []) {
      if (this.buffers.has(asset.id)) continue;
      try {
        onAsset(asset);
        await this.hydrateAsset(asset);
      } catch (error) {
        missing.push({ asset, error });
      }
    }
    return missing;
  }

  async play(project) {
    const context = this.audioContext();
    await context.resume();
    await this.hydrateProject(project);
    this.stop();
    const when = context.currentTime + 0.03;
    for (const track of project?.tracks ?? []) {
      if (track.mute) continue;
      const buffer = this.buffers.get(track.asset);
      if (!buffer) continue;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = decibels(track.gainDb);
      source.connect(gain).connect(context.destination);
      source.start(when + Number(track.startSeconds || 0));
      this.sources.push(source);
    }
  }

  async renderMix(project) {
    const missing = await this.hydrateProject(project);
    if (missing.length) throw new Error(`${missing.length} project asset${missing.length === 1 ? " is" : "s are"} unavailable locally`);
    return renderProjectMix(project, this.buffers);
  }

  stop() {
    for (const source of this.sources) {
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    this.sources = [];
  }
}

const store = createStudioStore();
const audio = new StudioAudioRuntime(store);

function button(document, label, action, className = "") {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  if (className) element.className = className;
  element.addEventListener("click", action);
  return element;
}

function drawWaveform(canvas, buffer) {
  const ratio = globalThis.devicePixelRatio || 1;
  const width = Math.max(640, Math.floor((canvas.clientWidth || 640) * ratio));
  const height = Math.max(92, Math.floor((canvas.clientHeight || 92) * ratio));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#d6ba70";
  context.lineWidth = Math.max(1, ratio);
  context.beginPath();
  const channel = buffer.getChannelData(0);
  const bucket = Math.max(1, Math.floor(channel.length / width));
  const middle = height / 2;
  for (let x = 0; x < width; x += 1) {
    let min = 1;
    let max = -1;
    const start = x * bucket;
    const end = Math.min(start + bucket, channel.length);
    for (let index = start; index < end; index += 1) {
      const value = channel[index];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    context.moveTo(x, middle + min * middle * 0.86);
    context.lineTo(x, middle + max * middle * 0.86);
  }
  context.stroke();
}

function currentProject(session) {
  return session?.studio?.project ?? null;
}

export function createStudioSurface({ root, dispatch }) {
  const document = root.ownerDocument;
  let session = null;
  let importing = false;
  let persistenceReady = false;
  let saveTimer = null;
  let lastQueuedRevision = -1;
  let destroyed = false;

  root.innerHTML = `<div class="studio-app">
    <div class="studio-toolbar">
      <div class="studio-transport" data-transport></div>
      <div class="studio-project-title"><span>PROJECT</span><strong>Untitled project</strong></div>
      <div class="studio-toolbar-actions" data-actions></div>
    </div>
    <div class="studio-body">
      <aside class="studio-library">
        <p class="studio-kicker">LIBRARY</p>
        <h2>Local audio</h2>
        <p>Drop recordings, stems, loops or complete tracks. Hodos stores imported bytes in origin-private browser storage when available.</p>
        <label class="studio-import-label">Import audio<input data-file-input type="file" accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.webm" multiple></label>
        <div class="studio-assets" data-assets></div>
      </aside>
      <main class="studio-arrangement">
        <div class="studio-ruler"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span></div>
        <div class="studio-tracks" data-tracks></div>
        <div class="studio-empty" data-empty><strong>Drop audio into the arrangement</strong><span>Your project is restored when this world is opened again on this browser.</span></div>
      </main>
      <aside class="studio-generation">
        <p class="studio-kicker">GENERATE</p>
        <h2>Describe the next part</h2>
        <textarea aria-label="Generation prompt" placeholder="Warm analogue synths, restrained live drums…"></textarea>
        <div class="studio-generation-scope"><span>Selection</span><strong>Whole project</strong></div>
        <button type="button" disabled>Generation provider not connected</button>
        <p>This is the future model adapter. Arrangement and durable project state already remain under the Hara session.</p>
      </aside>
    </div>
    <footer class="studio-status" data-status>Opening local project…</footer>
  </div>`;

  const app = root.querySelector(".studio-app");
  const tracksRoot = root.querySelector("[data-tracks]");
  const assetsRoot = root.querySelector("[data-assets]");
  const empty = root.querySelector("[data-empty]");
  const status = root.querySelector("[data-status]");
  const fileInput = root.querySelector("[data-file-input]");
  const transport = root.querySelector("[data-transport]");
  const actions = root.querySelector("[data-actions]");

  const setStatus = (value) => { if (!destroyed) status.textContent = value; };

  async function saveNow(project = currentProject(session)) {
    if (!persistenceReady || !project) return;
    await store.saveProject(project);
  }

  function queueSave(next) {
    if (!persistenceReady || !next || next.revision === lastQueuedRevision) return;
    lastQueuedRevision = next.revision;
    globalThis.clearTimeout(saveTimer);
    saveTimer = globalThis.setTimeout(() => {
      saveNow(currentProject(session)).catch((error) => {
        console.error("Studio project save failed", error);
        setStatus(`Local save failed: ${error.message}`);
      });
    }, 200);
  }

  async function exportMix() {
    const project = currentProject(session);
    if (!project?.tracks?.length) return setStatus("Import audio before exporting a mix.");
    try {
      setStatus("Rendering the current Hara project…");
      const rendered = await audio.renderMix(project);
      const wav = encodeWav(rendered);
      const name = `${safeFilename(project.title, "hodos-mix")}.wav`;
      const result = await saveBlob(new Blob([wav], { type: "audio/wav" }), name);
      setStatus(result.method === "cancelled" ? "Mix export cancelled." : `Exported ${name}.`);
    } catch (error) {
      console.error("Studio mix export failed", error);
      setStatus(`Mix export failed: ${error.message}`);
    }
  }

  async function exportProject() {
    const project = currentProject(session);
    if (!project) return;
    try {
      setStatus("Packing project state and local audio…");
      await saveNow(project);
      const bundle = await createProjectBundle({
        project,
        readAsset: (asset) => store.readAsset(asset),
      });
      const name = `${safeFilename(project.title, "hodos-project")}.hodos-studio.zip`;
      const result = await saveBlob(new Blob([bundle], { type: "application/zip" }), name);
      setStatus(result.method === "cancelled" ? "Project export cancelled." : `Exported ${name}.`);
    } catch (error) {
      console.error("Studio project export failed", error);
      setStatus(`Project export failed: ${error.message}`);
    }
  }

  transport.append(
    button(document, "Play", () => dispatch({ "event/type": "studio/transport", status: "playing" }), "studio-primary"),
    button(document, "Stop", () => dispatch({ "event/type": "studio/transport", status: "stopped" })),
  );
  actions.append(
    button(document, "Import", () => fileInput.click()),
    button(document, "Export mix", exportMix),
    button(document, "Export project", exportProject),
  );

  async function importFiles(files) {
    if (importing) return;
    const audioFiles = [...files].filter((file) => file.type.startsWith("audio/") || AUDIO_EXTENSIONS.test(file.name));
    if (!audioFiles.length) {
      setStatus("No supported audio files were dropped.");
      return;
    }
    importing = true;
    app.dataset.importing = "true";
    try {
      for (const file of audioFiles) {
        setStatus(`Importing and storing ${file.name}…`);
        const { asset } = await audio.importFile(file);
        const track = {
          id: randomId("track"),
          name: basename(file.name),
          asset: asset.id,
          gainDb: 0,
          pan: 0,
          mute: false,
          startSeconds: 0,
        };
        dispatch({ "event/type": "studio/import", asset, track });
      }
      await saveNow();
      setStatus(`${audioFiles.length} audio file${audioFiles.length === 1 ? "" : "s"} stored and added to Hara state.`);
    } catch (error) {
      console.error("Studio audio import failed", error);
      setStatus(`Import failed: ${error.message}`);
    } finally {
      importing = false;
      delete app.dataset.importing;
    }
  }

  fileInput.addEventListener("change", () => {
    importFiles(fileInput.files);
    fileInput.value = "";
  });
  app.addEventListener("dragenter", (event) => {
    event.preventDefault();
    app.dataset.dragging = "true";
  });
  app.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  app.addEventListener("dragleave", (event) => {
    if (!app.contains(event.relatedTarget)) delete app.dataset.dragging;
  });
  app.addEventListener("drop", (event) => {
    event.preventDefault();
    delete app.dataset.dragging;
    importFiles(event.dataTransfer.files);
  });

  function render(next) {
    session = next;
    const project = currentProject(next) ?? { title: "Untitled project", assets: [], tracks: [] };
    root.querySelector(".studio-project-title strong").textContent = project.title;
    tracksRoot.replaceChildren();
    assetsRoot.replaceChildren();
    empty.hidden = Boolean(project.tracks.length);

    for (const asset of project.assets ?? []) {
      const item = document.createElement("article");
      item.innerHTML = `<strong></strong><span></span>`;
      item.querySelector("strong").textContent = asset.name;
      const duration = Number.isFinite(asset.duration) ? `${asset.duration.toFixed(1)}s` : "duration unknown";
      const channels = Number.isFinite(asset.channels) ? `${asset.channels}ch` : "channels unknown";
      const rate = Number.isFinite(asset.sampleRate) ? `${Math.round(asset.sampleRate / 1000)}kHz` : "rate unknown";
      item.querySelector("span").textContent = `${duration} · ${channels} · ${rate} · ${asset.storage?.type || "local"}`;
      assetsRoot.append(item);
    }

    for (const [index, track] of (project.tracks ?? []).entries()) {
      const row = document.createElement("article");
      row.className = "studio-track";
      row.innerHTML = `<header><span></span><strong></strong><small></small></header><div class="studio-clip"><canvas aria-label="Waveform"></canvas><span></span></div>`;
      row.querySelector("header span").textContent = String(index + 1).padStart(2, "0");
      row.querySelector("header strong").textContent = track.name;
      row.querySelector("header small").textContent = `${track.gainDb} dB`;
      row.querySelector(".studio-clip span").textContent = track.name;
      tracksRoot.append(row);
      const buffer = audio.buffers.get(track.asset);
      if (buffer) drawWaveform(row.querySelector("canvas"), buffer);
    }
    queueSave(next);
  }

  async function initializePersistence() {
    try {
      const details = await store.prepare();
      await Promise.resolve();
      const active = currentProject(session);
      const saved = await store.loadProject(active?.id || "local/current");
      const latest = currentProject(session);
      const hasActiveWork = Boolean((latest?.assets?.length ?? 0) || (latest?.tracks?.length ?? 0));
      const project = hasActiveWork ? latest : saved;
      let missing = [];
      if (project) {
        missing = await audio.hydrateProject(project, (asset) => setStatus(`Restoring ${asset.name}…`));
      }
      persistenceReady = true;
      if (!hasActiveWork && saved) {
        dispatch({ "event/type": "studio/restore", project: saved });
      } else if (project) {
        render(session);
      }
      if (missing.length) {
        setStatus(`Project restored, but ${missing.length} audio asset${missing.length === 1 ? " is" : "s are"} unavailable.`);
      } else if (saved && !hasActiveWork) {
        setStatus(`Restored ${saved.tracks.length} track${saved.tracks.length === 1 ? "" : "s"} from local storage.`);
      } else {
        setStatus(details.kind === "opfs"
          ? `Ready — project storage is ${details.retained ? "persistent" : "origin-private"}.`
          : "Ready — durable browser storage is unavailable, so this page is using memory.");
      }
    } catch (error) {
      persistenceReady = true;
      console.error("Studio persistence initialization failed", error);
      setStatus(`Local project storage is unavailable: ${error.message}`);
    }
  }

  initializePersistence();

  return {
    update: render,
    handleEffect(effect) {
      if (effect.effect !== "audio" || effect.method !== "apply-transport") return;
      const [nextTransport, project] = effect.args;
      if (nextTransport.status === "playing") {
        audio.play(project).then(() => { setStatus("Playing from the Hara project state."); })
          .catch((error) => { setStatus(`Playback failed: ${error.message}`); });
      } else {
        audio.stop();
        setStatus("Stopped.");
      }
    },
    destroy() {
      destroyed = true;
      globalThis.clearTimeout(saveTimer);
      const project = currentProject(session);
      if (persistenceReady && project) store.saveProject(project).catch(() => {});
      audio.stop();
      session = null;
    },
  };
}
