import assert from "node:assert/strict";
import test from "node:test";
import {
  activateShowcaseSurface,
  firstShowcaseGuideTouchpoint,
  showcaseProgress,
  showcaseStats,
  SHOWCASE_SURFACE_IDS,
  touchpointForSurface,
} from "../src/showcase-world.js";

const worldState = (overrides = {}) => ({
  id: "session-showcase",
  revision: 8,
  world: {
    repository: { owner: "greenways-worlds", repo: "splat-garden" },
    commit: "a".repeat(40),
    project: {
      id: "greenways-worlds/splat-garden",
      version: "1.1.0",
      capabilities: ["canvas/webgl2", "input/pointer", "ui/dom-surface"],
    },
    touchpoints: [
      { id: "guide", label: "Guide", surface: SHOWCASE_SURFACE_IDS.guide },
      { id: "studio", label: "Studio", surface: SHOWCASE_SURFACE_IDS.studio },
    ],
    draft: {
      revision: 3,
      audioSources: [{ id: "source-1" }],
      history: { undo: [[], [{ id: "source-1" }]] },
    },
    publications: [{ target: "repository", digest: "sha256:test" }],
  },
  studio: {
    project: {
      assets: [{ id: "asset-1" }],
      tracks: [{ id: "track-1", clips: [{ id: "clip-1" }] }],
    },
  },
  ...overrides,
});

test("guided showcase progress is derived from Hara session state", () => {
  const progress = showcaseProgress(worldState());
  assert.deepEqual(progress.map(({ id, complete }) => [id, complete]), [
    ["enter", true],
    ["create", true],
    ["place", true],
    ["edit", true],
    ["publish", true],
  ]);
  assert.deepEqual(showcaseStats(worldState()), {
    touchpoints: 2,
    tracks: 1,
    assets: 1,
    sources: 1,
    draftRevision: 3,
    publications: 1,
  });
});

test("showcase surfaces prefer repository-authored touchpoints and fall back safely", () => {
  const state = worldState();
  assert.equal(touchpointForSurface(state, SHOWCASE_SURFACE_IDS.studio).id, "studio");
  assert.equal(firstShowcaseGuideTouchpoint(state.world.touchpoints).id, "guide");
  assert.equal(
    touchpointForSurface({ world: { touchpoints: [] } }, SHOWCASE_SURFACE_IDS.commands).surface,
    SHOWCASE_SURFACE_IDS.commands,
  );
});

test("surface activation remains a semantic Hara event", () => {
  const events = [];
  activateShowcaseSurface((event) => events.push(event), worldState(), SHOWCASE_SURFACE_IDS.studio);
  assert.deepEqual(events, [{
    "event/type": "touchpoint/activate",
    touchpoint: { id: "studio", label: "Studio", surface: SHOWCASE_SURFACE_IDS.studio },
  }]);
});
