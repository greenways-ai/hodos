import assert from "node:assert/strict";
import test from "node:test";
import { createProjectBundle, encodeWav, renderProjectMix } from "../src/studio-export.js";

function readStoredZip(bytes) {
  const files = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const compressed = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    files[name] = bytes.slice(dataStart, dataStart + compressed);
    offset = dataStart + compressed;
  }
  return files;
}

test("WAV export writes a valid interleaved PCM header", () => {
  const left = Float32Array.from([-1, 0, 1]);
  const right = Float32Array.from([1, 0, -1]);
  const wav = encodeWav({
    numberOfChannels: 2,
    length: 3,
    sampleRate: 8000,
    getChannelData: (index) => index === 0 ? left : right,
  });
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.equal(new TextDecoder().decode(wav.subarray(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(wav.subarray(8, 12)), "WAVE");
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 8000);
  assert.equal(view.getUint32(40, true), 12);
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(46, true), 32767);
});

test("project bundle contains portable Hara state and immutable audio", async () => {
  const project = {
    id: "local/current",
    title: "Garden Song",
    assets: [{ id: "sha256:abc", name: "garden.wav", mediaType: "audio/wav", storage: { type: "opfs" } }],
    tracks: [{ id: "track-1", asset: "sha256:abc" }],
  };
  const bundle = await createProjectBundle({
    project,
    readAsset: async () => Uint8Array.from([82, 73, 70, 70]),
    now: () => "2026-08-04T00:00:00.000Z",
  });
  const files = readStoredZip(bundle);
  const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
  const portable = JSON.parse(new TextDecoder().decode(files["studio/project.json"]));
  assert.equal(manifest.format, "hodos-studio-bundle");
  assert.equal(manifest.assets.length, 1);
  assert.ok(files[manifest.assets[0].path]);
  assert.deepEqual(portable.assets[0].storage, { type: "bundle", path: manifest.assets[0].path });
  assert.equal(portable.tracks[0].clips[0].asset, "sha256:abc");
  assert.equal("asset" in portable.tracks[0], false);
  assert.equal(new DataView(bundle.buffer, bundle.byteOffset + bundle.byteLength - 22, 22).getUint32(0, true), 0x06054b50);
});

test("offline mix schedules first-class clips at project and source offsets", async () => {
  const starts = [];
  class FakeOfflineAudioContext {
    constructor(channels, length, sampleRate) {
      this.channels = channels;
      this.length = length;
      this.sampleRate = sampleRate;
      this.destination = {};
    }
    createBufferSource() {
      return {
        connect() {},
        start: (...args) => starts.push(args),
      };
    }
    createGain() {
      return { gain: { value: 1 }, connect() { return this; } };
    }
    createStereoPanner() {
      return { pan: { value: 0 }, connect() { return this; } };
    }
    async startRendering() {
      return { numberOfChannels: 2, length: this.length, sampleRate: this.sampleRate };
    }
  }
  const buffer = { duration: 8, sampleRate: 48000 };
  await renderProjectMix({
    tracks: [{
      id: "track-1",
      gainDb: -3,
      pan: 0.25,
      mute: false,
      clips: [{ id: "clip-1", asset: "asset-1", startSeconds: 2, sourceStartSeconds: 0.5, duration: 1.5 }],
    }],
  }, new Map([["asset-1", buffer]]), { OfflineAudioContextClass: FakeOfflineAudioContext });
  assert.deepEqual(starts, [[2, 0.5, 1.5]]);
});
