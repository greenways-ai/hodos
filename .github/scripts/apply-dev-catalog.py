#!/usr/bin/env python3
from pathlib import Path
from textwrap import dedent

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(dedent(content).lstrip("\n"), encoding="utf-8")


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return source.replace(old, new, 1)


def update_dev_model() -> None:
    path = "packages/dev/src/index.js"
    source = read(path)

    anchor = '''const replEntryValue = (entry, index) => {'''
    helpers = r'''
const CATALOG_SURFACES = new Set(["all", "tools", "activity"]);
const CATALOG_RUN_STATUSES = new Set(["idle", "opening", "running", "passed", "failed"]);
const CATALOG_CHECK_STATUSES = new Set(["pending", "passed", "failed"]);

const catalogToolValue = (tool, index, toolsetId) => {
  const label = `Hodos Dev Catalog tool ${toolsetId}/${index}`;
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
    throw new TypeError(`${label} must be an object`);
  }
  const metadata = tool.metadata ?? {};
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError(`${label} metadata must be an object`);
  }
  return Object.freeze({
    id: nonEmptyString(tool.id, `${label} id`),
    label: nonEmptyString(tool.label, `${label} label`),
    description: nonEmptyString(tool.description, `${label} description`),
    detail: optionalString(tool.detail, `${label} detail`),
    metadata: serializableValue(metadata, `${label} metadata`),
  });
};

const catalogToolsetValue = (toolset, index) => {
  const label = `Hodos Dev Catalog toolset ${index}`;
  if (!toolset || typeof toolset !== "object" || Array.isArray(toolset)) {
    throw new TypeError(`${label} must be an object`);
  }
  if (!Array.isArray(toolset.tools)) throw new TypeError(`${label} tools must be an array`);
  const id = nonEmptyString(toolset.id, `${label} id`);
  const tools = Object.freeze(toolset.tools.map((tool, toolIndex) =>
    catalogToolValue(tool, toolIndex, id)));
  const toolIds = new Set();
  for (const tool of tools) {
    if (toolIds.has(tool.id)) throw new Error(`Duplicate Hodos Dev Catalog tool id in ${id}: ${tool.id}`);
    toolIds.add(tool.id);
  }
  const metadata = toolset.metadata ?? {};
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError(`${label} metadata must be an object`);
  }
  return Object.freeze({
    id,
    title: nonEmptyString(toolset.title, `${label} title`),
    shortTitle: optionalString(toolset.shortTitle, `${label} short title`),
    description: nonEmptyString(toolset.description, `${label} description`),
    tools,
    metadata: serializableValue(metadata, `${label} metadata`),
  });
};

const catalogActivityValue = (activity, index) => {
  const label = `Hodos Dev Catalog activity ${index}`;
  if (!activity || typeof activity !== "object" || Array.isArray(activity)) {
    throw new TypeError(`${label} must be an object`);
  }
  if (!Array.isArray(activity.instructions)) {
    throw new TypeError(`${label} instructions must be an array`);
  }
  const instructions = Object.freeze(activity.instructions.map((entry, instructionIndex) =>
    nonEmptyString(entry, `${label} instruction ${instructionIndex}`)));
  const checkCount = Number(activity.checkCount ?? 0);
  if (!Number.isSafeInteger(checkCount) || checkCount < 0) {
    throw new TypeError(`${label} checkCount must be a non-negative integer`);
  }
  const metadata = activity.metadata ?? {};
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError(`${label} metadata must be an object`);
  }
  return Object.freeze({
    id: nonEmptyString(activity.id, `${label} id`),
    toolsetId: nonEmptyString(activity.toolsetId, `${label} toolset id`),
    title: nonEmptyString(activity.title, `${label} title`),
    level: nonEmptyString(activity.level, `${label} level`),
    summary: nonEmptyString(activity.summary, `${label} summary`),
    instructions,
    path: activity.path == null
      ? null
      : workspacePathValue(activity.path, `${label} path`),
    checkCount,
    metadata: serializableValue(metadata, `${label} metadata`),
  });
};

const catalogCheckValue = (check, index) => {
  const label = `Hodos Dev Catalog run check ${index}`;
  if (!check || typeof check !== "object" || Array.isArray(check)) {
    throw new TypeError(`${label} must be an object`);
  }
  const status = nonEmptyString(check.status ?? "pending", `${label} status`);
  if (!CATALOG_CHECK_STATUSES.has(status)) {
    throw new Error(`${label} has unsupported status: ${status}`);
  }
  return Object.freeze({
    id: optionalString(check.id, `${label} id`) ?? `check/${index + 1}`,
    label: nonEmptyString(check.label, `${label} label`),
    status,
    actual: serializableValue(check.actual ?? null, `${label} actual`),
    expected: serializableValue(check.expected ?? null, `${label} expected`),
    error: optionalString(check.error, `${label} error`),
  });
};

const catalogRunValue = (value = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hodos Dev Catalog run must be an object");
  }
  const status = nonEmptyString(value.status ?? "idle", "Hodos Dev Catalog run status");
  if (!CATALOG_RUN_STATUSES.has(status)) {
    throw new Error(`Unsupported Hodos Dev Catalog run status: ${status}`);
  }
  if (!Array.isArray(value.checks ?? [])) {
    throw new TypeError("Hodos Dev Catalog run checks must be an array");
  }
  const checks = Object.freeze((value.checks ?? []).map(catalogCheckValue));
  const counts = { total: checks.length, pending: 0, passed: 0, failed: 0 };
  for (const check of checks) counts[check.status] += 1;
  return Object.freeze({
    status,
    message: typeof (value.message ?? "") === "string" ? value.message ?? "" : String(value.message),
    checks,
    counts: Object.freeze(counts),
  });
};

const catalogCapabilitiesValue = (value = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hodos Dev Catalog capabilities must be an object");
  }
  const output = {};
  for (const key of [
    "selectToolset",
    "selectActivity",
    "insertTool",
    "openActivity",
    "checkActivity",
    "resetActivity",
  ]) {
    const enabled = value[key] ?? false;
    if (typeof enabled !== "boolean") {
      throw new TypeError(`Hodos Dev Catalog capability ${key} must be boolean`);
    }
    output[key] = enabled;
  }
  return Object.freeze(output);
};

const catalogCountsValue = (toolsets, activities) => Object.freeze({
  toolsets: toolsets.length,
  tools: toolsets.reduce((total, toolset) => total + toolset.tools.length, 0),
  activities: activities.length,
});

'''
    source = replace_once(source, anchor, helpers + anchor, "Catalog model helpers")

    constants_anchor = '''export const HODOS_DEV_EDITOR_AREA_TYPE = "hodos.dev/editor";'''
    constants = r'''
export const HODOS_DEV_CATALOG_AREA_TYPE = "hodos.dev/catalog";
export const HODOS_DEV_CATALOG_COMPONENT_ID = "hodos.dev/catalog";
export const HODOS_DEV_CATALOG_EVENTS = Object.freeze([
  "catalog/select-toolset",
  "catalog/select-activity",
  "catalog/insert-tool",
  "catalog/open-activity",
  "catalog/check-activity",
  "catalog/reset-activity",
]);

'''
    source = replace_once(source, constants_anchor, constants + constants_anchor, "Catalog constants")

    factory = r'''

export function createCatalogArea({
  id = "catalog/main",
  title = "Catalog",
  catalogId = null,
  catalogTitle = "Developer Catalog",
  version = null,
  source = null,
  surface = "all",
  toolsets = [],
  activities = [],
  selectedToolsetId = null,
  selectedActivityId = null,
  selectedToolId = null,
  run = {},
  capabilities = {},
  metadata = {},
  events = HODOS_DEV_CATALOG_EVENTS,
} = {}) {
  id = nonEmptyString(id, "Hodos Dev Catalog area id");
  title = nonEmptyString(title, "Hodos Dev Catalog title");
  catalogTitle = nonEmptyString(catalogTitle, "Hodos Dev Catalog catalog title");
  surface = nonEmptyString(surface, "Hodos Dev Catalog surface");
  if (!CATALOG_SURFACES.has(surface)) throw new Error(`Unsupported Hodos Dev Catalog surface: ${surface}`);
  if (!Array.isArray(toolsets)) throw new TypeError("Hodos Dev Catalog toolsets must be an array");
  if (!Array.isArray(activities)) throw new TypeError("Hodos Dev Catalog activities must be an array");
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("Hodos Dev Catalog metadata must be an object");
  }

  const projectedToolsets = Object.freeze(toolsets.map(catalogToolsetValue));
  const toolsetsById = new Map();
  for (const toolset of projectedToolsets) {
    if (toolsetsById.has(toolset.id)) throw new Error(`Duplicate Hodos Dev Catalog toolset id: ${toolset.id}`);
    toolsetsById.set(toolset.id, toolset);
  }

  const projectedActivities = Object.freeze(activities.map(catalogActivityValue));
  const activitiesById = new Map();
  for (const activity of projectedActivities) {
    if (activitiesById.has(activity.id)) throw new Error(`Duplicate Hodos Dev Catalog activity id: ${activity.id}`);
    if (!toolsetsById.has(activity.toolsetId)) {
      throw new Error(`Hodos Dev Catalog activity references missing toolset: ${activity.toolsetId}`);
    }
    activitiesById.set(activity.id, activity);
  }

  const toolsetId = optionalString(selectedToolsetId, "Hodos Dev Catalog selected toolset id");
  if (toolsetId && !toolsetsById.has(toolsetId)) {
    throw new Error(`Hodos Dev Catalog selected toolset is not present: ${toolsetId}`);
  }
  const activityId = optionalString(selectedActivityId, "Hodos Dev Catalog selected activity id");
  if (activityId && !activitiesById.has(activityId)) {
    throw new Error(`Hodos Dev Catalog selected activity is not present: ${activityId}`);
  }
  if (toolsetId && activityId && activitiesById.get(activityId).toolsetId !== toolsetId) {
    throw new Error("Hodos Dev Catalog selected activity does not belong to selected toolset");
  }
  const toolId = optionalString(selectedToolId, "Hodos Dev Catalog selected tool id");
  if (toolId) {
    const toolset = toolsetsById.get(toolsetId);
    if (!toolset || !toolset.tools.some((tool) => tool.id === toolId)) {
      throw new Error(`Hodos Dev Catalog selected tool is not present in selected toolset: ${toolId}`);
    }
  }

  const model = Object.freeze({
    catalog: Object.freeze({
      id: optionalString(catalogId, "Hodos Dev Catalog catalog id"),
      title: catalogTitle,
      version: optionalString(version, "Hodos Dev Catalog version"),
      source: optionalString(source, "Hodos Dev Catalog source"),
    }),
    surface,
    toolsets: projectedToolsets,
    activities: projectedActivities,
    selection: Object.freeze({ toolsetId, activityId, toolId }),
    run: catalogRunValue(run),
    capabilities: catalogCapabilitiesValue(capabilities),
    counts: catalogCountsValue(projectedToolsets, projectedActivities),
    metadata: serializableValue(metadata, "Hodos Dev Catalog metadata"),
  });

  return Object.freeze({
    "area/id": id,
    "area/type": HODOS_DEV_CATALOG_AREA_TYPE,
    "area/title": title,
    "area/component": Object.freeze({
      "component/id": HODOS_DEV_CATALOG_COMPONENT_ID,
      "component/contract": WORKSPACE_COMPONENT_CONTRACT,
      "component/model": model,
      "component/events": Object.freeze([...events]),
    }),
  });
}
'''
    source = source.rstrip() + factory
    write(path, source + "\n")


def update_dev_ui() -> None:
    path = "packages/dev-ui/src/index.js"
    source = read(path)
    source = replace_once(
        source,
        '''  HODOS_DEV_EDITOR_COMPONENT_ID,
  HODOS_DEV_EXPLORER_COMPONENT_ID,''',
        '''  HODOS_DEV_CATALOG_COMPONENT_ID,
  HODOS_DEV_EDITOR_COMPONENT_ID,
  HODOS_DEV_EXPLORER_COMPONENT_ID,''',
        "Catalog component import",
    )
    source = replace_once(
        source,
        '''export const createEditorComponentFactory = (options = {}) =>
  statefulComponentFactory("Editor", "createEditorHost", "editor", options);''',
        '''export const createCatalogComponentFactory = (options = {}) =>
  statefulComponentFactory("Catalog", "createCatalogHost", "catalog", options);

export const createEditorComponentFactory = (options = {}) =>
  statefulComponentFactory("Editor", "createEditorHost", "editor", options);''',
        "Catalog component factory",
    )
    source = replace_once(
        source,
        '''export function registerHodosPreviewUi(registry, options = {}) {''',
        '''export function registerHodosCatalogUi(registry, options = {}) {
  return register(
    registry,
    HODOS_DEV_CATALOG_COMPONENT_ID,
    createCatalogComponentFactory(options),
    "registerHodosCatalogUi",
  );
}

export function registerHodosPreviewUi(registry, options = {}) {''',
        "Catalog registration",
    )
    source = replace_once(
        source,
        '''  try {
    disposers.push(registerHodosPreviewUi(registry, options));''',
        '''  try {
    disposers.push(registerHodosCatalogUi(registry, options));
    disposers.push(registerHodosPreviewUi(registry, options));''',
        "Catalog combined registration",
    )
    write(path, source)


def write_hal() -> None:
    write("packages/dev/src/gw/hodos/dev/catalog.hal", r'''
    (ns gw.hodos.dev.catalog)

    (def component-id "hodos.dev/catalog")
    (def component-contract "workspace.component/1")
    (def events
      #{"catalog/select-toolset"
        "catalog/select-activity"
        "catalog/insert-tool"
        "catalog/open-activity"
        "catalog/check-activity"
        "catalog/reset-activity"})

    (defn model
      ([catalog toolsets activities]
       (model catalog toolsets activities {}))
      ([catalog toolsets activities options]
       {:catalog catalog
        :surface (get options :surface "all")
        :toolsets toolsets
        :activities activities
        :selection (get options :selection {})
        :run (get options :run {:status "idle" :message "" :checks []})
        :capabilities (get options :capabilities {})
        :counts (get options :counts {})
        :metadata (get options :metadata {})}))

    (defn area
      ([id model]
       (area id "Catalog" model))
      ([id title model]
       {:area/id id
        :area/type :hodos.dev/catalog
        :area/title title
        :area/component
        {:component/id component-id
         :component/contract component-contract
         :component/model model
         :component/events events}}))
    ''')


def write_tests() -> None:
    write("packages/dev/test/catalog.test.js", r'''
    import assert from "node:assert/strict";
    import test from "node:test";
    import {
      HODOS_DEV_CATALOG_AREA_TYPE,
      HODOS_DEV_CATALOG_COMPONENT_ID,
      createCatalogArea,
    } from "../src/index.js";

    const toolsets = [{
      id: "values",
      title: "Value tools",
      shortTitle: "Values",
      description: "Build and inspect live values.",
      tools: [{
        id: "defn",
        label: "Function",
        description: "Insert a function template.",
        snippet: "(defn name [x] x)",
      }],
    }];

    const activities = [{
      id: "values/greeting",
      toolsetId: "values",
      title: "Shape a greeting",
      level: "Beginner",
      summary: "Change a value and evaluate it.",
      instructions: ["Open the activity", "Change the greeting", "Run checks"],
      path: "src/main.hal",
      source: "(def greeting \"hello\")",
      checks: [{ label: "Greeting exists", expr: "greeting", expected: ["hello"] }],
      checkCount: 1,
    }];

    test("Catalog area projects descriptive tools, activities and run evidence", () => {
      const area = createCatalogArea({
        catalogId: "catalog/playground",
        catalogTitle: "Hara Playground",
        version: "1",
        source: "playground",
        surface: "activity",
        toolsets,
        activities,
        selectedToolsetId: "values",
        selectedActivityId: "values/greeting",
        run: {
          status: "failed",
          message: "One check needs attention",
          checks: [{
            id: "check/1",
            label: "Greeting exists",
            status: "failed",
            actual: "goodbye",
            expected: ["hello", "Hello"],
            error: "Unexpected greeting",
            expr: "greeting",
          }],
        },
        capabilities: {
          selectToolset: true,
          selectActivity: true,
          insertTool: true,
          openActivity: true,
          checkActivity: true,
          resetActivity: true,
        },
      });
      const component = area["area/component"];
      const model = component["component/model"];

      assert.equal(area["area/type"], HODOS_DEV_CATALOG_AREA_TYPE);
      assert.equal(component["component/id"], HODOS_DEV_CATALOG_COMPONENT_ID);
      assert.equal(component["component/contract"], "workspace.component/1");
      assert.equal(model.selection.toolsetId, "values");
      assert.equal(model.selection.activityId, "values/greeting");
      assert.deepEqual(model.run.counts, { total: 1, pending: 0, passed: 0, failed: 1 });
      assert.deepEqual(model.counts, { toolsets: 1, tools: 1, activities: 1 });
      assert.equal(Object.hasOwn(model.toolsets[0].tools[0], "snippet"), false);
      assert.equal(Object.hasOwn(model.activities[0], "source"), false);
      assert.equal(Object.hasOwn(model.activities[0], "checks"), false);
      assert.equal(Object.hasOwn(model.run.checks[0], "expr"), false);
      assert.equal(JSON.parse(JSON.stringify(area))["area/id"], "catalog/main");
    });

    test("Catalog area validates identities, surfaces, references and run states", () => {
      assert.throws(() => createCatalogArea({ surface: "lesson" }), /Unsupported.*surface/);
      assert.throws(() => createCatalogArea({ toolsets: [{ ...toolsets[0], tools: [toolsets[0].tools[0], toolsets[0].tools[0]] }] }), /Duplicate.*tool id/);
      assert.throws(() => createCatalogArea({ toolsets, activities: [{ ...activities[0], toolsetId: "missing" }] }), /missing toolset/);
      assert.throws(() => createCatalogArea({ toolsets, activities, selectedToolsetId: "missing" }), /selected toolset is not present/);
      assert.throws(() => createCatalogArea({ toolsets, activities, selectedActivityId: "missing" }), /selected activity is not present/);
      assert.throws(() => createCatalogArea({
        toolsets: [...toolsets, { ...toolsets[0], id: "interfaces", tools: [] }],
        activities,
        selectedToolsetId: "interfaces",
        selectedActivityId: "values/greeting",
      }), /does not belong/);
      assert.throws(() => createCatalogArea({ toolsets, activities, selectedToolsetId: "values", selectedToolId: "missing" }), /selected tool is not present/);
      assert.throws(() => createCatalogArea({ run: { status: "complete" } }), /Unsupported.*run status/);
      assert.throws(() => createCatalogArea({ run: { checks: [{ label: "x", status: "unknown" }] } }), /unsupported status/);
      assert.throws(() => createCatalogArea({ capabilities: { insertTool: "yes" } }), /capability insertTool must be boolean/);
    });
    ''')

    write("packages/dev-ui/test/catalog-component.test.js", r'''
    import assert from "node:assert/strict";
    import test from "node:test";
    import { createCatalogArea } from "@greenways/hodos-dev";
    import { createHodosComponentRegistry } from "@greenways/hodos-web";
    import { createWorkspaceAreaHost } from "@greenways/hodos-workspace-ui";
    import { registerHodosCatalogUi } from "../src/index.js";

    test("Hodos Dev Catalog adapts injected hosts for multiple surfaces", async () => {
      const calls = [];
      let send;
      const registry = createHodosComponentRegistry();
      const unregister = registerHodosCatalogUi(registry, {
        createCatalogHost({ container, dispatch }) {
          calls.push(["create", container]);
          send = dispatch;
          return {
            update(model) {
              calls.push(["update", model.surface, model.selection.toolsetId, model.selection.activityId]);
            },
            dispose() {
              calls.push(["dispose"]);
            },
          };
        },
      });
      const root = { dataset: {} };
      const events = [];
      const host = createWorkspaceAreaHost({
        root,
        registry,
        dispatch: (event) => events.push(event),
      });

      host.open(createCatalogArea({ id: "catalog/tools", surface: "tools" }));
      await send({ "event/type": "catalog/select-toolset", toolsetId: "values" });
      host.update(createCatalogArea({
        id: "catalog/tools",
        surface: "tools",
        toolsets: [{ id: "values", title: "Values", description: "Values", tools: [] }],
        selectedToolsetId: "values",
      }));
      host.destroy();
      unregister();

      assert.deepEqual(calls, [
        ["create", root],
        ["update", "tools", null, null],
        ["update", "tools", "values", null],
        ["dispose"],
      ]);
      assert.deepEqual(events, [{
        "event/type": "catalog/select-toolset",
        toolsetId: "values",
        "component/id": "hodos.dev/catalog",
        "area/id": "catalog/tools",
      }]);
      assert.equal(registry.has("hodos.dev/catalog"), false);
    });

    test("Hodos Dev Catalog host must implement update", () => {
      const registry = createHodosComponentRegistry();
      registerHodosCatalogUi(registry, { createCatalogHost() { return {}; } });
      const host = createWorkspaceAreaHost({ root: { dataset: {} }, registry });
      assert.throws(() => host.open(createCatalogArea()), /must implement update/);
    });
    ''')


def update_readmes() -> None:
    write("packages/dev/README.md", r'''
    # @greenways/hodos-dev

    HAL-first developer Workspace models for Hodos.

    The package currently defines serializable Catalog, Editor, Explorer, Preview,
    Problems, REPL and Value Inspector areas without introducing a second
    Workspace model:

    ```js
    import {
      createCatalogArea,
      createEditorArea,
      createExplorerArea,
      createPreviewArea,
      createProblemsArea,
      createReplArea,
      createValueInspectorArea,
    } from "@greenways/hodos-dev";

    const catalog = createCatalogArea({
      surface: "tools",
      toolsets: [{
        id: "values",
        title: "Value tools",
        description: "Build and inspect live values.",
        tools: [{ id: "defn", label: "Function", description: "Insert a function template." }],
      }],
      selectedToolsetId: "values",
    });

    const explorer = createExplorerArea({
      workspaceId: "workspace/project",
      workspaceTitle: "Project",
      entries: [
        { path: "src", kind: "directory" },
        { path: "src/main.hal", kind: "file", language: "hara" },
      ],
      selectedPath: "src/main.hal",
      expandedPaths: ["src"],
    });

    const editor = createEditorArea({
      documentId: "document/main",
      path: "src/main.hal",
      source: "(ns app.core)",
      namespace: "app.core",
    });

    const preview = createPreviewArea({
      output: { type: "render", tree: ["main", "Ready"] },
      theme: "dark",
    });

    const repl = createReplArea({
      sessionId: "session/project",
      namespace: "app.core",
      status: "ready",
      entries: [{ kind: "result", text: "3", valueId: "value-1" }],
    });

    const problems = createProblemsArea({
      status: "ready",
      problems: [{
        id: "problem/runtime-1",
        severity: "warning",
        message: "Canonical runtime fallback active",
        source: "runtime",
      }],
    });

    const value = createValueInspectorArea({
      valueId: "value-1",
      status: "ready",
      display: "{:answer 42}",
      value: { answer: 42 },
      namespace: "app.core",
    });
    ```

    HAL owns catalog, document, session, workspace-entry, diagnostic and
    retained-value identity, source versions, selections, REPL history and
    entries, problem filters and counts, inspector paths, completion models,
    commands and semantic events. Visible developer mechanics are supplied by
    `@greenways/hodos-dev-ui` through injected, trusted hosts.

    Catalog models carry descriptive toolset, tool, activity and check-result
    projections. Executable snippets, starter source and check expressions remain
    host policy and are not admitted into the Hodos model.

    Problems models accept text-only runtime diagnostics and optional source,
    path, namespace, request, code, range, tag and metadata projections. Runtime
    diagnostic production and source-opening policy remain injected Hara and host
    responsibilities.

    Value Inspector models carry only serializable projected data. Runtime value
    retention, evaluation and inspection requests remain injected Hara service
    responsibilities.
    ''')

    write("packages/dev-ui/README.md", r'''
    # @greenways/hodos-dev-ui

    Visible Hodos developer components driven by HAL-shaped Workspace models.

    The package currently registers Catalog, Editor, Explorer, Preview, Problems,
    REPL and Value Inspector components:

    - Catalog adapts injected tool/activity surfaces;
    - Editor adapts an injected trusted editor host;
    - Explorer adapts an injected workspace-entry host;
    - Preview adapts an injected Hara sandbox/iframe service;
    - Problems adapts an injected diagnostic-list host;
    - REPL adapts an injected session-console host;
    - Value Inspector adapts an injected structured-value host;
    - every component routes only declared semantic events back to HAL.

    ```js
    import { registerHodosDevUi } from "@greenways/hodos-dev-ui";

    const unregister = registerHodosDevUi(registry, {
      createCatalogHost: ({ container, dispatch }) => createCatalogHost(container, dispatch),
      createEditorHost: ({ container, dispatch }) => createEditorHost(container, dispatch),
      createExplorerHost: ({ container, dispatch }) => createExplorerHost(container, dispatch),
      createPreviewHost: (options) => haraPreviewService.create(options),
      createProblemsHost: ({ container, dispatch }) => createProblemsHost(container, dispatch),
      createReplHost: ({ container, dispatch }) => createReplHost(container, dispatch),
      createValueInspectorHost: ({ container, dispatch }) =>
        createValueInspectorHost(container, dispatch),
    });
    ```

    Hodos owns visible Workspace components and semantic-event boundaries. Hara
    browser services and host applications continue to own runtime transport,
    executable catalog content, diagnostic production, retained values, low-level
    editor transforms, preview isolation, storage and privileged resource policy.
    ''')


def clean_staging_files() -> None:
    for relative in (
        ".github/scripts/apply-dev-catalog.py",
        ".github/workflows/apply-dev-catalog.yml",
    ):
        target = ROOT / relative
        if target.exists():
            target.unlink()


def main() -> None:
    update_dev_model()
    update_dev_ui()
    write_hal()
    write_tests()
    update_readmes()
    clean_staging_files()


if __name__ == "__main__":
    main()
