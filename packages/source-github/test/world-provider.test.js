import assert from "node:assert/strict";
import test from "node:test";
import {
  WORLD_PROVIDER_FORMAT,
  WORLD_PROVIDER_LAUNCH_FORMAT,
  createWorldProviderLaunchIntent,
  normalizeWorldProvider,
} from "../src/world-provider.js";

const peacockBallroom = Object.freeze({
  "provider/id": "alumbra/world",
  "provider/activity": "alumbra-hara/peacock-ballroom",
  "provider/package": "hara:greenways/alumbra-peacock-ballroom@0.1.0",
  "provider/default-state": "ballroom/day",
  "provider/states": [
    "ballroom/day",
    "ballroom/gallery-overlook",
    "ballroom/mosaic-floor",
  ],
});

test("normalizes a closed provider-backed world descriptor", () => {
  const provider = normalizeWorldProvider(peacockBallroom);
  assert.deepEqual(provider, {
    format: WORLD_PROVIDER_FORMAT,
    id: "alumbra/world",
    activity: "alumbra-hara/peacock-ballroom",
    package: "hara:greenways/alumbra-peacock-ballroom@0.1.0",
    defaultState: "ballroom/day",
    states: [
      "ballroom/day",
      "ballroom/gallery-overlook",
      "ballroom/mosaic-floor",
    ],
  });
  assert.ok(Object.isFrozen(provider));
  assert.ok(Object.isFrozen(provider.states));
});

test("creates default and selected semantic launch intents", () => {
  const provider = normalizeWorldProvider(peacockBallroom);
  assert.deepEqual(createWorldProviderLaunchIntent(provider), {
    format: WORLD_PROVIDER_LAUNCH_FORMAT,
    providerId: "alumbra/world",
    activityId: "alumbra-hara/peacock-ballroom",
    package: "hara:greenways/alumbra-peacock-ballroom@0.1.0",
    state: "ballroom/day",
  });
  assert.equal(
    createWorldProviderLaunchIntent(provider, { state: "ballroom/mosaic-floor" }).state,
    "ballroom/mosaic-floor",
  );
  assert.throws(
    () => createWorldProviderLaunchIntent(provider, { state: "ballroom/evening" }),
    /does not declare state/,
  );
});

test("rejects open, duplicate and internally inconsistent descriptors", () => {
  assert.throws(
    () => normalizeWorldProvider({ ...peacockBallroom, callback: "launch" }),
    /unknown field callback/,
  );
  assert.throws(
    () => normalizeWorldProvider({
      ...peacockBallroom,
      "provider/states": ["ballroom/day", "ballroom/day"],
    }),
    /unique identities/,
  );
  assert.throws(
    () => normalizeWorldProvider({
      ...peacockBallroom,
      "provider/default-state": "ballroom/evening",
    }),
    /must occur/,
  );
  assert.throws(
    () => normalizeWorldProvider({
      ...peacockBallroom,
      "provider/package": "https://example.test/world.js",
    }),
    /exact hara: or npm:/,
  );
});
