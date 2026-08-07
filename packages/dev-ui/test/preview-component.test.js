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
        renderDocument(value) { calls.push(["document", value]); },
        dispose() { calls.push(["dispose"]); },
      };
    },
  });
  const root = { dataset: {} };
  const host = createWorkspaceAreaHost({ root, registry });
  host.open(createPreviewArea({ output: { type: "html", html: "<main>One</main>" }, theme: "dark" }));
  host.update(createPreviewArea({ document: "<!doctype html><main>Two</main>", theme: "light" }));
  host.destroy();
  assert.deepEqual(calls, [
    ["create", root],
    ["theme", "dark"],
    ["render", { type: "html", html: "<main>One</main>" }],
    ["theme", "light"],
    ["document", "<!doctype html><main>Two</main>"],
    ["dispose"],
  ]);
});

test("Hodos Dev Preview rejects prepared documents when the injected host cannot render them", () => {
  const registry = createHodosComponentRegistry();
  registerHodosDevUi(registry, {
    createPreviewHost() {
      return { render() {}, dispose() {} };
    },
  });
  const host = createWorkspaceAreaHost({ root: { dataset: {} }, registry });
  assert.throws(
    () => host.open(createPreviewArea({ document: "<!doctype html><main>Ready</main>" })),
    /cannot render a prepared document/,
  );
});
