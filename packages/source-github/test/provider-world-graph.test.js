import assert from "node:assert/strict";
import test from "node:test";
import { parseGitHubRepository, resolveWorldGraph } from "../src/github-worlds.js";
import { normalizeWorldProvider } from "../src/world-provider.js";

const rootRepository = parseGitHubRepository("https://github.com/greenways/peacock-ballroom");
const rootCommit = "c".repeat(40);

const provider = normalizeWorldProvider({
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

test("retains a provider descriptor in an immutable resolved world graph", async () => {
  const project = {
    id: "greenways/peacock-ballroom",
    version: "0.1.0",
    title: "Peacock Ballroom",
    layers: [],
    imports: [],
    touchpoints: [],
    camera: null,
    background: "#102018",
    capabilities: ["canvas/webgl2", "input/pointer"],
    sourcePaths: ["src"],
    testPaths: ["test"],
    extensionPaths: [],
    dependencies: {},
    provider,
  };
  const client = {
    request: async () => { throw new Error("not used"); },
    resolveCommit: async () => rootCommit,
    project: async () => project,
  };
  const graph = await resolveWorldGraph({
    repository: rootRepository,
    ref: rootCommit,
    mode: "strict",
    client,
  });
  assert.equal(graph.complete, true);
  assert.deepEqual(graph.layers, []);
  assert.deepEqual(graph.touchpoints, []);
  assert.equal(graph.project.provider, provider);
  assert.equal(graph.project.provider.activity, "alumbra-hara/peacock-ballroom");
});
