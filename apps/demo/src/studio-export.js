const textEncoder = new TextEncoder();
const BUNDLE_FORMAT = "hodos-studio-bundle";
const BUNDLE_VERSION = "0.1.0";

const decibels = (value) => 10 ** (Number(value || 0) / 20);
const cleanSample = (value) => Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));

function cloneData(value) {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

let crcTable;

function crc32(bytes) {
  if (!crcTable) {
    crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      return value >>> 0;
    });
  }
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function concatenate(parts) {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function localHeader(name, data, checksum) {
  const output = new Uint8Array(30);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint32(14, checksum, true);
  view.setUint32(18, data.byteLength, true);
  view.setUint32(22, data.byteLength, true);
  view.setUint16(26, name.byteLength, true);
  return output;
}

function centralHeader(name, data, checksum, localOffset) {
  const output = new Uint8Array(46);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint32(16, checksum, true);
  view.setUint32(20, data.byteLength, true);
  view.setUint32(24, data.byteLength, true);
  view.setUint16(28, name.byteLength, true);
  view.setUint32(42, localOffset, true);
  return output;
}

export function createStoredZip(files) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  let entries = 0;

  for (const [path, value] of Object.entries(files)) {
    const name = textEncoder.encode(path);
    const data = value instanceof Uint8Array ? value : new Uint8Array(value);
    const checksum = crc32(data);
    const local = concatenate([localHeader(name, data, checksum), name, data]);
    const central = concatenate([centralHeader(name, data, checksum, localOffset), name]);
    localParts.push(local);
    centralParts.push(central);
    localOffset += local.byteLength;
    entries += 1;
  }

  const centralDirectory = concatenate(centralParts);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries, true);
  view.setUint16(10, entries, true);
  view.setUint32(12, centralDirectory.byteLength, true);
  view.setUint32(16, localOffset, true);
  return concatenate([...localParts, centralDirectory, end]);
}

export function safeFilename(value, fallback = "hodos-studio") {
  const output = String(value || "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return output || fallback;
}

export function encodeWav(audioBuffer) {
  if (!audioBuffer || !Number.isInteger(audioBuffer.numberOfChannels) || audioBuffer.numberOfChannels < 1) {
    throw new Error("WAV export requires an AudioBuffer-like value");
  }
  const channels = audioBuffer.numberOfChannels;
  const frames = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const bytesPerSample = 2;
  const dataBytes = frames * channels * bytesPerSample;
  const output = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(output);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);

  const channelData = Array.from({ length: channels }, (_, index) => audioBuffer.getChannelData(index));
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = cleanSample(channelData[channel][frame]);
      view.setInt16(offset, sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff), true);
      offset += bytesPerSample;
    }
  }
  return new Uint8Array(output);
}

export function clipsForTrack(track, project) {
  if (Array.isArray(track?.clips)) return track.clips;
  if (!track?.asset) return [];
  const asset = (project?.assets ?? []).find((entry) => entry.id === track.asset);
  return [{
    id: `legacy-${track.id || track.asset}`,
    asset: track.asset,
    startSeconds: Number(track.startSeconds || 0),
    sourceStartSeconds: 0,
    duration: Number(asset?.duration || 0),
  }];
}

export function normalizeProject(project) {
  const output = cloneData(project);
  output.assets = output.assets ?? [];
  output.tracks = (output.tracks ?? []).map((track) => {
    const clips = clipsForTrack(track, output).map((clip) => ({
      ...clip,
      startSeconds: Math.max(0, Number(clip.startSeconds || 0)),
      sourceStartSeconds: Math.max(0, Number(clip.sourceStartSeconds || 0)),
      duration: Math.max(0, Number(clip.duration || 0)),
    }));
    const next = { ...track, clips };
    delete next.asset;
    delete next.startSeconds;
    return next;
  });
  return output;
}

export async function renderProjectMix(project, buffers, {
  OfflineAudioContextClass = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext,
} = {}) {
  if (!OfflineAudioContextClass) throw new Error("This browser does not provide OfflineAudioContext");
  const active = [];
  for (const track of project?.tracks ?? []) {
    if (track.mute) continue;
    for (const clip of clipsForTrack(track, project)) {
      const buffer = buffers.get(clip.asset);
      if (buffer) active.push({ track, clip, buffer });
    }
  }
  if (!active.length) throw new Error("The project has no available unmuted audio to export");

  const sampleRate = Math.max(8000, ...active.map(({ buffer }) => buffer.sampleRate || 48000));
  const duration = Math.max(...active.map(({ clip }) => Number(clip.startSeconds || 0) + Number(clip.duration || 0)));
  const context = new OfflineAudioContextClass(2, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate);

  for (const { track, clip, buffer } of active) {
    const sourceStart = Math.max(0, Number(clip.sourceStartSeconds || 0));
    const available = Math.max(0, buffer.duration - sourceStart);
    const clipDuration = Math.min(available, Number(clip.duration || available));
    if (clipDuration <= 0) continue;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = decibels(track.gainDb);
    source.connect(gain);
    if (typeof context.createStereoPanner === "function") {
      const panner = context.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, Number(track.pan || 0)));
      gain.connect(panner).connect(context.destination);
    } else {
      gain.connect(context.destination);
    }
    source.start(Math.max(0, Number(clip.startSeconds || 0)), sourceStart, clipDuration);
  }
  return context.startRendering();
}

function bundleAssetPath(asset) {
  const name = safeFilename(asset.name, "audio.bin");
  const identity = safeFilename(String(asset.id).replace(/^sha256:/, "").slice(0, 20), "asset");
  return `audio/${identity}-${name}`;
}

export async function createProjectBundle({ project, readAsset, now = () => new Date().toISOString() } = {}) {
  if (!project?.id) throw new Error("Project bundle export requires a project");
  if (typeof readAsset !== "function") throw new Error("Project bundle export requires an asset reader");

  const portableProject = normalizeProject(project);
  const files = {};
  const manifestAssets = [];

  for (const asset of portableProject.assets ?? []) {
    const path = bundleAssetPath(asset);
    const value = await readAsset(asset);
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    files[path] = bytes;
    asset.storage = { type: "bundle", path };
    manifestAssets.push({
      id: asset.id,
      path,
      name: asset.name,
      mediaType: asset.mediaType,
      size: bytes.byteLength,
    });
  }

  const manifest = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: now(),
    project: "studio/project.json",
    assets: manifestAssets,
  };
  files["manifest.json"] = textEncoder.encode(JSON.stringify(manifest, null, 2));
  files["studio/project.json"] = textEncoder.encode(JSON.stringify(portableProject, null, 2));
  files["README.txt"] = textEncoder.encode(
    "Hodos Studio project bundle\n\nOpen manifest.json first. The Hara project state is in studio/project.json and immutable audio payloads are under audio/.\n",
  );
  return createStoredZip(files);
}

export async function saveBlob(blob, suggestedName, {
  host = globalThis,
  document = globalThis.document,
} = {}) {
  if (typeof host.showSaveFilePicker === "function") {
    try {
      const handle = await host.showSaveFilePicker({ suggestedName });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { method: "picker", name: suggestedName };
    } catch (error) {
      if (error?.name === "AbortError") return { method: "cancelled", name: suggestedName };
      if (error?.name !== "SecurityError" && error?.name !== "NotAllowedError") throw error;
    }
  }
  if (!document || typeof host.URL?.createObjectURL !== "function") {
    throw new Error("This host cannot save browser-generated files");
  }
  const url = host.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  host.setTimeout(() => host.URL.revokeObjectURL(url), 0);
  return { method: "download", name: suggestedName };
}
