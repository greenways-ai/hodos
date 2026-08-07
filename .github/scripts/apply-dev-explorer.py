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
const EXPLORER_ENTRY_KINDS = new Set(["file", "directory"]);
const EXPLORER_ENTRY_STATUSES = new Set([
  "clean",
  "modified",
  "added",
  "deleted",
  "conflict",
  "unknown",
]);

const workspacePathValue = (value, label, { allowEmpty = false } = {}) => {
  if (allowEmpty && value === "") return "";
  const path = nonEmptyString(value, label);
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new TypeError(`${label} must be a canonical relative workspace path`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new TypeError(`${label} must not contain empty, current or parent segments`);
  }
  return segments.join("/");
};

const explorerEntryValue = (entry, index) => {
  const label = `Hodos Dev Explorer entry ${index}`;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError(`${label} must be an object`);
  }
  const path = workspacePathValue(entry.path, `${label} path`);
  const kind = nonEmptyString(entry.kind ?? "file", `${label} kind`);
  if (!EXPLORER_ENTRY_KINDS.has(kind)) {
    throw new Error(`${label} has unsupported kind: ${kind}`);
  }
  const status = nonEmptyString(entry.status ?? "clean", `${label} status`);
  if (!EXPLORER_ENTRY_STATUSES.has(status)) {
    throw new Error(`${label} has unsupported status: ${status}`);
  }
  if (typeof (entry.readOnly ?? false) !== "boolean") {
    throw new TypeError(`${label} readOnly must be boolean`);
  }
  const size = entry.size == null ? null : Number(entry.size);
  if (size != null && (!Number.isSafeInteger(size) || size < 0)) {
    throw new TypeError(`${label} size must be a non-negative integer`);
  }
  const metadata = entry.metadata ?? {};
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError(`${label} metadata must be an object`);
  }
  return Object.freeze({
    id: optionalString(entry.id, `${label} id`) ?? `${kind}:${path}`,
    path,
    name: optionalString(entry.name, `${label} name`) ?? path.split("/").at(-1),
    kind,
    language: optionalString(entry.language, `${label} language`),
    status,
    readOnly: entry.readOnly ?? false,
    size,
    metadata: serializableValue(metadata, `${label} metadata`),
  });
};

const explorerCapabilitiesValue = (value = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hodos Dev Explorer capabilities must be an object");
  }
  const result = {};
  for (const key of ["createFile", "createDirectory", "rename", "delete", "refresh"]) {
    const enabled = value[key] ?? false;
    if (typeof enabled !== "boolean") {
      throw new TypeError(`Hodos Dev Explorer capability ${key} must be boolean`);
    }
    result[key] = enabled;
  }
  return Object.freeze(result);
};

const explorerCountsValue = (entries) => Object.freeze({
  total: entries.length,
  files: entries.filter((entry) => entry.kind === "file").length,
  directories: entries.filter((entry) => entry.kind === "directory").length,
  changed: entries.filter((entry) => entry.status !== "clean").length,
});

'''
    source = replace_once(source, anchor, helpers + anchor, "Explorer model helpers")

    constants_anchor = '''export const HODOS_DEV_EDITOR_AREA_TYPE = "hodos.dev/editor";'''
    constants = r'''
export const HODOS_DEV_EXPLORER_AREA_TYPE = "hodos.dev/explorer";
export const HODOS_DEV_EXPLORER_COMPONENT_ID = "hodos.dev/explorer";
export const HODOS_DEV_EXPLORER_EVENTS = Object.freeze([
  "explorer/select",
  "explorer/toggle",
  "explorer/create",
  "explorer/rename",
  "explorer/delete",
  "explorer/refresh",
  "explorer/filter",
]);

'''
    source = replace_once(source, constants_anchor, constants + constants_anchor, "Explorer constants")

    factory = r'''

export function createExplorerArea({
  id = "explorer/main",
  title = "Files",
  workspaceId = null,
  workspaceTitle = "Workspace",
  root = "",
  source = null,
  revision = null,
  entries = [],
  selectedPath = null,
  expandedPaths = [],
  query = "",
  capabilities = {},
  metadata = {},
  events = HODOS_DEV_EXPLORER_EVENTS,
} = {}) {
  id = nonEmptyString(id, "Hodos Dev Explorer area id");
  title = nonEmptyString(title, "Hodos Dev Explorer title");
  workspaceTitle = nonEmptyString(workspaceTitle, "Hodos Dev Explorer workspace title");
  root = workspacePathValue(root, "Hodos Dev Explorer root", { allowEmpty: true });
  if (!Array.isArray(entries)) throw new TypeError("Hodos Dev Explorer entries must be an array");
  if (!Array.isArray(expandedPaths)) {
    throw new TypeError("Hodos Dev Explorer expandedPaths must be an array");
  }
  if (typeof query !== "string") throw new TypeError("Hodos Dev Explorer query must be a string");
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("Hodos Dev Explorer metadata must be an object");
  }

  const projected = Object.freeze(entries.map(explorerEntryValue));
  const byPath = new Map();
  for (const entry of projected) {
    if (byPath.has(entry.path)) throw new Error(`Duplicate Hodos Dev Explorer path: ${entry.path}`);
    byPath.set(entry.path, entry);
  }

  const selected = selectedPath == null
    ? null
    : workspacePathValue(selectedPath, "Hodos Dev Explorer selected path");
  if (selected && !byPath.has(selected)) {
    throw new Error(`Hodos Dev Explorer selected path is not present: ${selected}`);
  }

  const expanded = Object.freeze([
    ...new Set(expandedPaths.map((entry, index) =>
      workspacePathValue(entry, `Hodos Dev Explorer expanded path ${index}`))),
  ]);
  for (const path of expanded) {
    const entry = byPath.get(path);
    if (!entry || entry.kind !== "directory") {
      throw new Error(`Hodos Dev Explorer expanded path is not a directory: ${path}`);
    }
  }

  const model = Object.freeze({
    workspace: Object.freeze({
      id: optionalString(workspaceId, "Hodos Dev Explorer workspace id"),
      title: workspaceTitle,
      root,
      source: optionalString(source, "Hodos Dev Explorer workspace source"),
      revision: optionalString(revision, "Hodos Dev Explorer workspace revision"),
    }),
    entries: projected,
    selection: Object.freeze({ path: selected }),
    expanded,
    filter: Object.freeze({ query }),
    capabilities: explorerCapabilitiesValue(capabilities),
    counts: explorerCountsValue(projected),
    metadata: serializableValue(metadata, "Hodos Dev Explorer metadata"),
  });

  return Object.freeze({
    "area/id": id,
    "area/type": HODOS_DEV_EXPLORER_AREA_TYPE,
    "area/title": title,
    "area/component": Object.freeze({
      "component/id": HODOS_DEV_EXPLORER_COMPONENT_ID,
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
  HODOS_DEV_PREVIEW_COMPONENT_ID,''',
        '''  HODOS_DEV_EDITOR_COMPONENT_ID,
  HODOS_DEV_EXPLORER_COMPONENT_ID,
  HODOS_DEV_PREVIEW_COMPONENT_ID,''',
        "Explorer component import",
    )
    source = replace_once(
        source,
        '''export const createEditorComponentFactory = (options = {}) =>
  statefulComponentFactory("Editor", "createEditorHost", "editor", options);

export const createReplComponentFactory''',
        '''export const createEditorComponentFactory = (options = {}) =>
  statefulComponentFactory("Editor", "createEditorHost", "editor", options);

export const createExplorerComponentFactory = (options = {}) =>
  statefulComponentFactory("Explorer", "createExplorerHost", "explorer", options);

export const createReplComponentFactory''',
        "Explorer component factory",
    )
    source = replace_once(
        source,
        '''export function registerHodosEditorUi(registry, options = {}) {
  return register(
    registry,
    HODOS_DEV_EDITOR_COMPONENT_ID,
    createEditorComponentFactory(options),
    "registerHodosEditorUi",
  );
}

export function registerHodosReplUi''',
        '''export function registerHodosEditorUi(registry, options = {}) {
  return register(
    registry,
    HODOS_DEV_EDITOR_COMPONENT_ID,
    createEditorComponentFactory(options),
    "registerHodosEditorUi",
  );
}

export function registerHodosExplorerUi(registry, options = {}) {
  return register(
    registry,
    HODOS_DEV_EXPLORER_COMPONENT_ID,
    createExplorerComponentFactory(options),
    "registerHodosExplorerUi",
  );
}

export function registerHodosReplUi''',
        "Explorer registration",
    )
    source = replace_once(
        source,
        '''    disposers.push(registerHodosPreviewUi(registry, options));
    disposers.push(registerHodosEditorUi(registry, options));
    disposers.push(registerHodosReplUi(registry, options));''',
        '''    disposers.push(registerHodosPreviewUi(registry, options));
    disposers.push(registerHodosEditorUi(registry, options));
    disposers.push(registerHodosExplorerUi(registry, options));
    disposers.push(registerHodosReplUi(registry, options));''',
        "Explorer combined registration",
    )
    write(path, source)


def write_hal() -> None:
    write("packages/dev/src/gw/hodos/dev/explorer.hal", r'''
    (ns gw.hodos.dev.explorer)

    (def component-id "hodos.dev/explorer")
    (def component-contract "workspace.component/1")
    (def events
      #{"explorer/select"
        "explorer/toggle"
        "explorer/create"
        "explorer/rename"
        "explorer/delete"
        "explorer/refresh"
        "explorer/filter"})

    (defn model
      ([workspace entries]
       (model workspace entries {}))
      ([workspace entries options]
       {:workspace workspace
        :entries entries
        :selection {:path (get options :selectedPath nil)}
        :expanded (get options :expandedPaths [])
        :filter {:query (get options :query "")}
        :capabilities (get options :capabilities {})
        :counts (get options :counts {})
        :metadata (get options :metadata {})}))

    (defn area
      ([id model]
       (area id "Files" model))
      ([id title model]
       {:area/id id
        :area/type :hodos.dev/explorer
        :area/title title
        :area/component
        {:component/id component-id
         :component/contract component-contract
         :component/model model
         :component/events events}}))
    ''')


def write_tests() -> None:
    write("packages/dev/test/explorer.test.js", r'''
    import assert from "node:assert/strict";
    import test from "node:test";
    import {
      HODOS_DEV_EXPLORER_AREA_TYPE,
      HODOS_DEV_EXPLORER_COMPONENT_ID,
      createExplorerArea,
    } from "../src/index.js";

    const entries = [
      { path: "src", kind: "directory" },
      { path: "src/app", kind: "directory" },
      { path: "src/app/main.hal", kind: "file", language: "hara", size: 82 },
      { path: "project.edn", kind: "file", status: "modified" },
    ];

    test("Explorer area projects workspace identity, entries, selection and capabilities", () => {
      const area = createExplorerArea({
        workspaceId: "workspace/local",
        workspaceTitle: "Local project",
        source: "browser",
        revision: "rev-4",
        entries,
        selectedPath: "src/app/main.hal",
        expandedPaths: ["src", "src/app"],
        query: "main",
        capabilities: {
          createFile: true,
          createDirectory: true,
          rename: true,
          delete: true,
          refresh: true,
        },
        metadata: { persistent: true },
      });
      const component = area["area/component"];
      const model = component["component/model"];

      assert.equal(area["area/type"], HODOS_DEV_EXPLORER_AREA_TYPE);
      assert.equal(component["component/id"], HODOS_DEV_EXPLORER_COMPONENT_ID);
      assert.equal(component["component/contract"], "workspace.component/1");
      assert.equal(model.workspace.id, "workspace/local");
      assert.equal(model.selection.path, "src/app/main.hal");
      assert.deepEqual(model.expanded, ["src", "src/app"]);
      assert.deepEqual(model.counts, { total: 4, files: 2, directories: 2, changed: 1 });
      assert.equal(model.capabilities.delete, true);
      assert.equal(JSON.parse(JSON.stringify(area))["area/id"], "explorer/main");
    });

    test("Explorer area validates canonical paths, identity and directory expansion", () => {
      assert.throws(() => createExplorerArea({ entries: [{ path: "/src/main.hal", kind: "file" }] }), /canonical relative/);
      assert.throws(() => createExplorerArea({ entries: [{ path: "src/../main.hal", kind: "file" }] }), /parent segments/);
      assert.throws(() => createExplorerArea({ entries: [{ path: "src\\main.hal", kind: "file" }] }), /canonical relative/);
      assert.throws(() => createExplorerArea({ entries: [
        { path: "src", kind: "directory" },
        { path: "src", kind: "file" },
      ] }), /Duplicate.*path/);
      assert.throws(() => createExplorerArea({ entries, selectedPath: "missing.hal" }), /selected path is not present/);
      assert.throws(() => createExplorerArea({ entries, expandedPaths: ["project.edn"] }), /not a directory/);
      assert.throws(() => createExplorerArea({ entries, capabilities: { delete: "yes" } }), /capability delete must be boolean/);
      assert.throws(() => createExplorerArea({ entries: [{ path: "src", kind: "device" }] }), /unsupported kind/);
    });
    ''')

    write("packages/dev-ui/test/explorer-component.test.js", r'''
    import assert from "node:assert/strict";
    import test from "node:test";
    import { createExplorerArea } from "@greenways/hodos-dev";
    import { createHodosComponentRegistry } from "@greenways/hodos-web";
    import { createWorkspaceAreaHost } from "@greenways/hodos-workspace-ui";
    import { registerHodosExplorerUi } from "../src/index.js";

    test("Hodos Dev Explorer adapts an injected host and routes semantic events", async () => {
      const calls = [];
      let send;
      const registry = createHodosComponentRegistry();
      const unregister = registerHodosExplorerUi(registry, {
        createExplorerHost({ container, dispatch }) {
          calls.push(["create", container]);
          send = dispatch;
          return {
            update(model) {
              calls.push(["update", model.entries.length, model.selection.path]);
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

      host.open(createExplorerArea({
        entries: [{ path: "src/main.hal", kind: "file" }],
      }));
      await send({ "event/type": "explorer/select", path: "src/main.hal" });
      host.update(createExplorerArea({
        entries: [{ path: "src/main.hal", kind: "file" }],
        selectedPath: "src/main.hal",
      }));
      host.destroy();
      unregister();

      assert.deepEqual(calls, [
        ["create", root],
        ["update", 1, null],
        ["update", 1, "src/main.hal"],
        ["dispose"],
      ]);
      assert.deepEqual(events, [{
        "event/type": "explorer/select",
        path: "src/main.hal",
        "component/id": "hodos.dev/explorer",
        "area/id": "explorer/main",
      }]);
      assert.equal(registry.has("hodos.dev/explorer"), false);
    });

    test("Hodos Dev Explorer host must implement update", () => {
      const registry = createHodosComponentRegistry();
      registerHodosExplorerUi(registry, { createExplorerHost() { return {}; } });
      const host = createWorkspaceAreaHost({ root: { dataset: {} }, registry });
      assert.throws(() => host.open(createExplorerArea()), /must implement update/);
    });
    ''')


def update_readmes() -> None:
    dev = read("packages/dev/README.md")
    dev = replace_once(
        dev,
        "The package currently defines serializable Preview, Editor, REPL, Problems\nand Value Inspector areas",
        "The package currently defines serializable Preview, Editor, Explorer, REPL,\nProblems and Value Inspector areas",
        "Explorer dev README list",
    )
    dev = replace_once(
        dev,
        "      createEditorArea,\n      createPreviewArea,",
        "      createEditorArea,\n      createExplorerArea,\n      createPreviewArea,",
        "Explorer dev README import",
    )
    example_anchor = "    const preview = createPreviewArea({"
    example = r'''
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

    '''
    dev = replace_once(dev, example_anchor, example + example_anchor, "Explorer dev README example")
    dev = replace_once(
        dev,
        "    HAL owns document, session, diagnostic and retained-value identity, source",
        "    HAL owns document, session, workspace-entry, diagnostic and retained-value identity, source",
        "Explorer dev README authority",
    )
    write("packages/dev/README.md", dev)

    ui = read("packages/dev-ui/README.md")
    ui = replace_once(
        ui,
        "The package currently registers Preview, Editor, REPL, Problems and Value",
        "The package currently registers Preview, Editor, Explorer, REPL, Problems and Value",
        "Explorer UI README list",
    )
    ui = replace_once(
        ui,
        "    - Editor adapts an injected trusted editor host;\n    - REPL adapts",
        "    - Editor adapts an injected trusted editor host;\n    - Explorer adapts an injected workspace-entry host;\n    - REPL adapts",
        "Explorer UI README bullet",
    )
    ui = replace_once(
        ui,
        "      createEditorHost: ({ container, dispatch }) => createEditorHost(container, dispatch),\n      createReplHost:",
        "      createEditorHost: ({ container, dispatch }) => createEditorHost(container, dispatch),\n      createExplorerHost: ({ container, dispatch }) => createExplorerHost(container, dispatch),\n      createReplHost:",
        "Explorer UI README example",
    )
    write("packages/dev-ui/README.md", ui)


def clean_staging_files() -> None:
    for relative in (
        ".github/scripts/apply-dev-explorer.py",
        ".github/workflows/apply-dev-explorer.yml",
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
