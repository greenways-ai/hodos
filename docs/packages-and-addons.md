# Hodos packages and add-ons

Hodos Core has one responsibility: register add-ons, grant narrowly scoped
capabilities, activate dependencies in order, and own contribution lifecycles.
It has no dependency on the Hara VM, PlayCanvas, GitHub, OPFS, Hestia, or the
DOM. Hara remains Hodos's native semantic format, but Core never loads or owns
the runtime that evaluates it.

An add-on declares its contract and contributes implementations only while it
is active:

```js
import { defineAddon } from "@greenways/hodos-core";

export default defineAddon({
  manifest: {
    id: "example/hodos-addon",
    version: "1.0.0",
    requires: { "@greenways/hodos-core": "^0.1.0" },
    capabilities: ["workspace.write"],
  },
  activate(context) {
    return context.contribute("command", "example/run", () => "done");
  },
});
```

The host resolves dependencies before activation, refuses ungranted
capabilities, detects dependency cycles, assigns every contribution to its
owner, and removes contributions during deactivation.

## First-party graph

| Package | Depends on | Contribution |
|---|---|---|
| `@greenways/hodos-core` | nothing | host contract and core Hara modules |
| `@greenways/hodos-addon-drafts` | core | `gw.hodos.session-draft` |
| `@greenways/hodos-addon-publication` | core, drafts | `gw.hodos.session-publication` |
| `@greenways/hodos-addon-authoring` | core, drafts, publication | `gw.hodos.session-authoring` |
| `@greenways/hodos-runtime-hara` | semantic add-ons | lazy Hara runtime |
| `@greenways/hodos-world-model` | core | runtime-neutral world models |
| `@greenways/hodos-source-github` | core | `world.source/github` |
| `@greenways/hodos-renderer-playcanvas` | core, world model | `world.renderer/playcanvas` |
| `@greenways/hodos-ui-world-authoring` | world model, renderer | optional `world.ui/authoring` |
| `@greenways/hodos-ui-world-publication` | core | optional `world.ui/publication` |
| `@greenways/hodos-viewer` | core | adapter-neutral `viewer/worlds` shell |
| `@greenways/hodos-viewer-defaults` | viewer, source, renderer | GitHub + PlayCanvas preset |
| `greenways/hodos` | runtime, viewer and optional UI | curated distribution |

The base viewer is read-only. Authoring and publication panels appear only when
their add-ons are activated before a viewer instance is created. GitHub and
PlayCanvas are selected by `@greenways/hodos-viewer-defaults` rather than Core
assumptions; another source or projection can implement the same contribution
kinds and activate the shell directly.

### Composing Hodos Worlds

Curated distributions are ordinary add-on arrays and may share the same Core
instance. A complete authoring host composes them explicitly:

```js
import { createHodosHost } from "@greenways/hodos-core";
import { hodosHaraDistribution, HODOS_HARA_RUNTIME_ADDON_ID } from "@greenways/hodos-runtime-hara";
import { hodosViewerDistribution, HODOS_DEFAULT_VIEWER_ADDON_ID } from "@greenways/hodos-viewer-defaults";
import { hodosWorldAuthoringUiAddon, HODOS_WORLD_AUTHORING_UI_ADDON_ID } from "@greenways/hodos-ui-world-authoring";
import { hodosWorldPublicationUiAddon, HODOS_WORLD_PUBLICATION_UI_ADDON_ID } from "@greenways/hodos-ui-world-publication";

const host = createHodosHost({
  capabilities: [
    "network.github",
    "publication.intent",
    "runtime.hara",
    "workspace.authoring",
    "workspace.drafts",
    "world.render",
  ],
});
host.register(
  hodosHaraDistribution,
  hodosViewerDistribution,
  hodosWorldAuthoringUiAddon,
  hodosWorldPublicationUiAddon,
);
await host.activate([
  HODOS_HARA_RUNTIME_ADDON_ID,
  HODOS_WORLD_AUTHORING_UI_ADDON_ID,
  HODOS_WORLD_PUBLICATION_UI_ADDON_ID,
  HODOS_DEFAULT_VIEWER_ADDON_ID,
]);
```

Omit either UI add-on and its authority grant to produce a smaller viewer. The
source and renderer packages can likewise be replaced by add-ons contributing
the same `world.source` and `world.renderer` contracts.

## npm packages

All reusable workspaces are public, carry explicit exports and release files,
and use exact in-workspace versions. Validation also requires every internal
npm dependency to have a matching Hara package dependency. Check manifests and
tarball contents without publishing:

```sh
npm ci
npm run check:packages
npm run pack:check
```

After versioning and release approval, npm can publish the public workspaces in
dependency order. The demo and monorepo root remain private.

## Hara packages

Every reusable workspace also has a typed `project.edn`, lockfile, and
shell-free `hara.recipe.edn`. The Hara CLI remains authoritative for checking,
building deterministic HARP archives, installing them, and requesting signed
publication:

```sh
hara package check packages/core
hara package build packages/core
hara package install packages/core
hara package publish --tap hara --dry-run packages/core
```

The repository distribution exposes `gw.hodos.deploy`, built on Hara's
`code.deploy` and `std.lib.task` APIs. From a project-aware Hara REPL:

```clojure
(require '[gw.hodos.deploy :as hodos.deploy])
(hodos.deploy/check)
(hodos.deploy/package)
(hodos.deploy/install 'greenways/hodos-core)
(hodos.deploy/publish :all {:tap :hara :dry-run true})
```

The catalog records dependency edges, so bulk tasks process Core before Drafts,
Publication, Authoring, the Hara runtime, Viewer, and finally the curated Hodos
distribution. Actual archive and signing behavior is not duplicated in HAL;
each task invokes the capability-gated `hara package` CLI with an argv vector,
never a shell string.
