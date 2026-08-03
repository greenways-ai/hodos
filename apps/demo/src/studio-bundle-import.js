import { readProjectBundle } from "./studio-bundle.js";
import { createStudioStore } from "./studio-storage.js";

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Id(bytes, crypto = globalThis.crypto) {
  if (!crypto?.subtle) return null;
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const data = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  return `sha256:${hex(await crypto.subtle.digest("SHA-256", data))}`;
}

function cloneData(value) {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export async function installProjectBundle(value, {
  store = createStudioStore(),
  currentProjectId,
  digest = sha256Id,
} = {}) {
  const imported = readProjectBundle(value);
  const project = cloneData(imported.project);
  const sourceProjectId = project.id;
  if (currentProjectId) project.id = currentProjectId;
  if (sourceProjectId !== project.id) {
    project.importedFrom = {
      projectId: sourceProjectId,
      exportedAt: imported.manifest.exportedAt ?? null,
    };
  }

  for (const entry of imported.assets) {
    const asset = project.assets.find((candidate) => candidate.id === entry.asset.id);
    if (!asset) throw new Error(`Imported project lost asset ${entry.asset.id}`);
    if (asset.id.startsWith("sha256:")) {
      const actual = await digest(entry.bytes);
      if (actual && actual !== asset.id) {
        throw new Error(`Imported audio ${asset.name || asset.id} does not match its SHA-256 identity`);
      }
    }
    asset.storage = await store.saveAsset(asset, entry.bytes);
  }
  await store.saveProject(project);
  return { ...imported, project };
}

function drawWaveform(canvas, buffer) {
  const ratio = globalThis.devicePixelRatio || 1;
  const width = Math.max(320, Math.floor((canvas.clientWidth || 640) * ratio));
  const height = Math.max(72, Math.floor((canvas.clientHeight || 82) * ratio));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
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
      const sample = channel[index];
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    context.moveTo(x, middle + min * middle * 0.86);
    context.lineTo(x, middle + max * middle * 0.86);
  }
  context.stroke();
}

async function decodeBundleAssets(imported, {
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
} = {}) {
  if (!AudioContextClass) return new Map();
  const context = new AudioContextClass();
  const buffers = new Map();
  try {
    for (const entry of imported.assets) {
      const bytes = entry.bytes;
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const buffer = await context.decodeAudioData(data);
      buffers.set(entry.asset.id, buffer);
      const asset = imported.project.assets.find((candidate) => candidate.id === entry.asset.id);
      if (asset) {
        asset.duration = buffer.duration;
        asset.channels = buffer.numberOfChannels;
        asset.sampleRate = buffer.sampleRate;
      }
    }
  } finally {
    await context.close?.();
  }
  return buffers;
}

function drawImportedProject(root, project, buffers) {
  const canvases = [...root.querySelectorAll(".studio-clip canvas")];
  let index = 0;
  for (const track of project.tracks ?? []) {
    for (const clip of track.clips ?? []) {
      const canvas = canvases[index];
      const buffer = buffers.get(clip.asset);
      if (canvas && buffer) drawWaveform(canvas, buffer);
      index += 1;
    }
  }
}

export function withStudioBundleImport(factory, {
  store = createStudioStore(),
  install = installProjectBundle,
  decode = decodeBundleAssets,
} = {}) {
  if (typeof factory !== "function") throw new Error("Studio bundle import requires a surface factory");
  return (context) => {
    const controller = factory(context) ?? {};
    const document = context.root.ownerDocument;
    const app = context.root.querySelector(".studio-app");
    const actions = context.root.querySelector("[data-actions]");
    const status = context.root.querySelector("[data-status]");
    if (!app || !actions || !status) throw new Error("Studio bundle import requires the studio application shell");
    let latestState = null;
    let importing = false;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".hodos-studio.zip,application/zip";
    input.hidden = true;
    input.setAttribute("aria-label", "Open Hodos Studio project");
    app.append(input);

    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "Open project";
    open.addEventListener("click", () => input.click());
    actions.append(open);

    const setStatus = (value) => { status.textContent = value; };

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file || importing) return;
      importing = true;
      open.disabled = true;
      try {
        const current = latestState?.studio?.project;
        if (current?.id) await store.saveProject(current);
        setStatus(`Checking ${file.name}…`);
        const value = await file.arrayBuffer();
        const imported = await install(value, {
          store,
          currentProjectId: current?.id || "local/current",
        });
        setStatus(`Decoding ${imported.assets.length} bundled audio asset${imported.assets.length === 1 ? "" : "s"}…`);
        const buffers = await decode(imported);
        await store.saveProject(imported.project);
        context.dispatch({ "event/type": "studio/transport", status: "stopped" });
        context.dispatch({ "event/type": "studio/restore", project: imported.project });
        drawImportedProject(context.root, imported.project, buffers);
        setStatus(`Opened ${imported.project.title || file.name} from a verified project bundle.`);
      } catch (error) {
        console.error("Studio project bundle import failed", error);
        setStatus(`Project import failed: ${error.message}`);
      } finally {
        importing = false;
        open.disabled = false;
      }
    });

    return {
      ...controller,
      update(state) {
        latestState = state;
        controller.update?.(state);
      },
      destroy() {
        controller.destroy?.();
      },
    };
  };
}
