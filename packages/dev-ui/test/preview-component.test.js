import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewArea } from "@greenways/hodos-dev";
import { createHodosComponentRegistry } from "@greenways/hodos-web";
import { createWorkspaceAreaHost } from "@greenways/hodos-workspace-ui";
import { registerHodosDevUi } from "../src/index.js";

test("Hodos Dev Preview adapts an injected Hara preview host", () => {
  const calls = [];
  const registry = createHodosComponentRegistry();
  registerHodosDevUi(registry, {
    createPreviewHost(options) {
      calls.push(["create", options.container]);
      return {
        setTheme(value) { calls.push(["theme", value]); },
        setViewport(value) { calls.push(["viewport", value]); },
        render(value) { calls.push(["render", value]); },
        dispose() { calls.push(["dispose"]); },
      };
    },
  });
  const root = { dataset: {} };
  const host = createWorkspaceAreaHost({ root, registry });
  host.open(createPreviewArea({ output: { type: "html", html: "<main>One</main>" }, theme: "dark" }));
  host.update(createPreviewArea({ output: { type: "html", html: "<main>Two</main>" }, theme: "light" }));
  host.destroy();
  assert.deepEqual(calls, [
    ["create", root],
    ["theme", "dark"],
    ["render", { type: "html", html: "<main>One</main>" }],
    ["theme", "light"],
    ["render", { type: "html", html: "<main>Two</main>" }],
    ["dispose"],
  ]);
});
