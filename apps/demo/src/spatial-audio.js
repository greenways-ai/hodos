import { normalizeProject, renderProjectMix } from "./studio-export.js";
import { createStudioStore } from "./studio-storage.js";

const decibels = (value) => 10 ** (Number(value || 0) / 20);

function cloneData(value) {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function clipTrack(project, clipId) {
  for (const track of project.tracks ?? []) {
    const clip = (track.clips ?? []).find((entry) => entry.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function projectForWorldSource(source, project) {
  const normalized = normalizeProject(project ?? { id: "local/current", assets: [], tracks: [] });
  let track;
  let clips;

  if (source?.kind === "studio/clip") {
    const found = clipTrack(normalized, source.clip);
    if (!found) throw new Error(`Spatial source references an unknown clip: ${source.clip}`);
    track = found.track;
    clips = [{ ...found.clip, startSeconds: 0 }];
  } else if (source?.kind === "studio/track") {
    track = (normalized.tracks ?? []).find((entry) => entry.id === source.track);
    if (!track) throw new Error(`Spatial source references an unknown track: ${source.track}`);
    const values = track.clips ?? [];
    if (!values.length) throw new Error(`Spatial source track has no clips: ${source.track}`);
    const first = Math.min(...values.map((clip) => Number(clip.startSeconds || 0)));
    clips = values.map((clip) => ({
      ...clip,
      startSeconds: Math.max(0, Number(clip.startSeconds || 0) - first),
    }));
  } else {
    throw new Error(`Unsupported spatial source kind: ${source?.kind}`);
  }

  const assetIds = new Set(clips.map((clip) => clip.asset));
  return {
    ...cloneData(normalized),
    id: `${normalized.id}/world/${source.id}`,
    title: source.label || track.name,
    assets: (normalized.assets ?? []).filter((asset) => assetIds.has(asset.id)),
    tracks: [{
      ...cloneData(track),
      id: `${track.id}/world/${source.id}`,
      gainDb: Number(track.gainDb || 0),
      pan: 0,
      mute: false,
      clips,
    }],
  };
}

function setParam(param, value, time = 0) {
  if (!param) return;
  if (typeof param.setValueAtTime === "function") param.setValueAtTime(value, time);
  else param.value = value;
}

function renderSignature(source, spatialProject) {
  return JSON.stringify({
    kind: source.kind,
    track: source.track,
    clip: source.clip,
    project: spatialProject,
  });
}

export class SpatialAudioRuntime {
  constructor({
    store = createStudioStore(),
    AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
    OfflineAudioContextClass = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext,
  } = {}) {
    this.store = store;
    this.AudioContextClass = AudioContextClass;
    this.OfflineAudioContextClass = OfflineAudioContextClass;
    this.context = null;
    this.buffers = new Map();
    this.sources = new Map();
    this.generation = 0;
  }

  audioContext() {
    if (!this.AudioContextClass) throw new Error("This browser does not provide Web Audio");
    if (!this.context) this.context = new this.AudioContextClass();
    return this.context;
  }

  async hydrateAsset(asset) {
    if (this.buffers.has(asset.id)) return this.buffers.get(asset.id);
    const bytes = await this.store.readAsset(asset);
    const buffer = await this.audioContext().decodeAudioData(bytes.slice(0));
    this.buffers.set(asset.id, buffer);
    return buffer;
  }

  async hydrateProject(project) {
    for (const asset of project.assets ?? []) await this.hydrateAsset(asset);
  }

  updateListener(camera) {
    if (!camera || !this.context) return;
    const listener = this.context.listener;
    const time = this.context.currentTime;
    const [x, y, z] = camera.position ?? [0, 0, 0];
    const [fx, fy, fz] = camera.forward ?? [0, 0, -1];
    const [ux, uy, uz] = camera.up ?? [0, 1, 0];
    if (listener.positionX) {
      setParam(listener.positionX, x, time);
      setParam(listener.positionY, y, time);
      setParam(listener.positionZ, z, time);
      setParam(listener.forwardX, fx, time);
      setParam(listener.forwardY, fy, time);
      setParam(listener.forwardZ, fz, time);
      setParam(listener.upX, ux, time);
      setParam(listener.upY, uy, time);
      setParam(listener.upZ, uz, time);
    } else {
      listener.setPosition?.(x, y, z);
      listener.setOrientation?.(fx, fy, fz, ux, uy, uz);
    }
  }

  setPannerPosition(panner, position) {
    const [x, y, z] = position ?? [0, 0, 0];
    const time = this.audioContext().currentTime;
    if (panner.positionX) {
      setParam(panner.positionX, x, time);
      setParam(panner.positionY, y, time);
      setParam(panner.positionZ, z, time);
    } else {
      panner.setPosition?.(x, y, z);
    }
  }

  configureEntry(entry, source) {
    const context = this.audioContext();
    const time = context.currentTime;
    entry.source = source;
    entry.node.loop = source.loop !== false;
    setParam(entry.gain.gain, decibels(source.gainDb), time);
    entry.panner.panningModel = "HRTF";
    entry.panner.distanceModel = "inverse";
    entry.panner.refDistance = Math.max(0.1, Number(source.refDistance || 1));
    entry.panner.maxDistance = Math.max(
      entry.panner.refDistance,
      Number(source.maxDistance || 30),
    );
    entry.panner.rolloffFactor = Math.max(0, Number(source.rolloffFactor ?? 1));
    this.setPannerPosition(entry.panner, source.position);
  }

  stopSource(id) {
    const entry = this.sources.get(id);
    if (!entry) return;
    try { entry.node.stop(); } catch { /* source already stopped */ }
    entry.node.disconnect();
    entry.gain.disconnect();
    entry.panner.disconnect();
    this.sources.delete(id);
  }

  async upsertSource(source, project, generation) {
    const spatialProject = projectForWorldSource(source, project);
    const signature = renderSignature(source, spatialProject);
    const current = this.sources.get(source.id);
    if (current?.signature === signature) {
      this.configureEntry(current, source);
      return;
    }

    await this.hydrateProject(spatialProject);
    const rendered = await renderProjectMix(spatialProject, this.buffers, {
      OfflineAudioContextClass: this.OfflineAudioContextClass,
    });
    if (generation !== this.generation) return;

    const context = this.audioContext();
    await context.resume?.().catch(() => {});
    this.stopSource(source.id);
    const entry = {
      source,
      node: context.createBufferSource(),
      gain: context.createGain(),
      panner: context.createPanner(),
      signature,
    };
    entry.node.buffer = rendered;
    this.configureEntry(entry, source);
    entry.node.connect(entry.gain).connect(entry.panner).connect(context.destination);
    entry.node.start();
    this.sources.set(source.id, entry);
  }

  async sync(sources = [], project) {
    const generation = ++this.generation;
    const active = new Set(sources.filter((source) => source.playing).map((source) => source.id));
    for (const id of [...this.sources.keys()]) {
      if (!active.has(id)) this.stopSource(id);
    }
    const results = await Promise.allSettled(
      sources.filter((source) => source.playing)
        .map((source) => this.upsertSource(source, project, generation)),
    );
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) {
      const error = new Error(`${failures.length} spatial audio source${failures.length === 1 ? "" : "s"} failed`);
      error.causes = failures.map((failure) => failure.reason);
      throw error;
    }
    return { active: this.sources.size };
  }

  destroy() {
    this.generation += 1;
    for (const id of [...this.sources.keys()]) this.stopSource(id);
    this.context?.close?.();
    this.context = null;
    this.buffers.clear();
  }
}
