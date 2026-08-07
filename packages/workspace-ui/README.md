# @greenways/hodos-workspace-ui

Visible area-hosting and responsive shell primitives for Hara Workspaces.

The package now provides two related boundaries:

- `createWorkspaceAreaHost(...)` mounts one trusted Hodos component into one Workspace area and preserves area identity on semantic events.
- `createWorkspaceShellHost(...)` projects a complete HAL-shaped Workspace layout using recursive `area`, `split` and `empty` nodes, local splitter geometry and compact responsive surfaces.

```js
import {
  createWorkspaceAreaHost,
  createWorkspaceShellHost,
} from "@greenways/hodos-workspace-ui";
import "@greenways/hodos-workspace-ui/shell.css";

const area = createWorkspaceAreaHost({ root: previewRoot, registry, dispatch });
area.open(previewAreaDescriptor);

const shell = createWorkspaceShellHost({
  root: workspaceRoot,
  registry,
  dispatch,
  // Existing application panels may be adopted during incremental migration.
  resolveAreaRoot: (area) => document.querySelector(`[data-area-id="${area.id}"]`),
  services: {
    workspaceShell: {
      readSplitRatio: ({ layoutId }) => preferences.get(`split/${layoutId}`),
      writeSplitRatio: ({ layoutId, ratio }) => preferences.set(`split/${layoutId}`, ratio),
      readSurface: () => preferences.get("compact-surface"),
      writeSurface: ({ surfaceId }) => preferences.set("compact-surface", surfaceId),
      activateSurface: ({ surface }) => activateApplicationSurface(surface.mode),
      focusSurface: ({ surface }) => focusApplicationSurface(surface.id),
    },
  },
});

shell.mount(workspaceView);
shell.update(nextWorkspaceView);
shell.destroy();
```

## Authority boundary

Hara owns `workspace.edn` evaluation, serializable Workspace state, area selection, semantic events and component models. Hodos owns visible recursive layout, splitter and compact-dock mechanics, focus hand-off and deterministic mounting/disposal.

`workspace.edn` may select installed component IDs and descriptive presentation tokens. It cannot install packages or provide executable component code. Split ratios and compact surface choice are UI presentation preferences; applications may persist them through the injected `workspaceShell` service without moving them into Hara Workspace state.

## Responsive projection

The shell reads optional descriptive values from `:workspace/customizations`:

```clojure
{:responsive/breakpoint 1000
 :responsive/default-surface "code"
 :responsive/surfaces
 [{:surface/id "files"
   :surface/area "area/project"
   :surface/label "Files"
   :surface/icon :folder
   :surface/mode :files}
  {:surface/id "code"
   :surface/area "area/editor"
   :surface/label "Code"}
  {:surface/id "preview"
   :surface/area "area/output"
   :surface/label "Preview"
   :surface/mode :preview}]}
```

When no explicit surfaces are present, one compact surface is derived from each area and its optional `:area/presentation` metadata. Compact selection emits `workspace/area-select` with both `:area/id` and the descriptive `:surface/id`; the host application remains responsible for applying any nested output-tab or focus policy.
