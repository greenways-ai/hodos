# @greenways/hodos-workspace-ui

Visible area hosting and responsive shell primitives for Hara Workspaces.

The package projects a serializable `workspace.edn` value into recursive area,
split, and empty layout nodes. Hara owns the Workspace state and semantic event
stream; Hodos owns visible layout mechanics, responsive surfaces, focus hand-off,
and deterministic component mounting.

## Install

```sh
hara package install greenways/hodos-workspace-ui
npm install @greenways/hodos-workspace-ui
```

Package coordinates:

```text
greenways/hodos-workspace-ui
@greenways/hodos-workspace-ui
```

## Area and shell hosts

```js
import {
  createWorkspaceAreaHost,
  createWorkspaceShellHost,
} from "@greenways/hodos-workspace-ui";
import "@greenways/hodos-workspace-ui/shell.css";

const area = createWorkspaceAreaHost({
  root: previewRoot,
  registry,
  dispatch,
});
area.open(previewAreaDescriptor);

const shell = createWorkspaceShellHost({
  root: workspaceRoot,
  registry,
  dispatch,
  resolveAreaRoot: (area) =>
    document.querySelector(`[data-area-id="${area.id}"]`),
  services: {
    workspaceShell: {
      readSplitRatio: ({ layoutId }) =>
        preferences.get(`split/${layoutId}`),
      writeSplitRatio: ({ layoutId, ratio }) =>
        preferences.set(`split/${layoutId}`, ratio),
      readSurface: () =>
        preferences.get("compact-surface"),
      writeSurface: ({ surfaceId }) =>
        preferences.set("compact-surface", surfaceId),
      activateSurface: ({ surface }) =>
        activateApplicationSurface(surface.mode),
      focusSurface: ({ surface }) =>
        focusApplicationSurface(surface.id),
    },
  },
});

shell.mount(workspaceView);
shell.update(nextWorkspaceView);
shell.destroy();
```

## Workspace authority

`workspace.edn` may select installed component IDs and descriptive presentation
tokens. It cannot install packages, provide executable component constructors,
or grant capabilities.

Split ratios and compact-surface choices are presentation preferences. An
application may persist them through the injected `workspaceShell` service
without moving those values into canonical Hara Workspace state.

## Responsive projection

The shell reads optional descriptive values from
`:workspace/customizations`:

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

Without explicit surfaces, the shell derives one compact surface from each area
and its `:area/presentation` metadata. Selecting a compact surface emits
`workspace/area-select`; the application remains responsible for applying
nested output or focus policy.

## Package Showcase

[`showcase.edn`](showcase.edn) publishes two responsive shell stories:

```text
showcase/desktop-shell
showcase/compact-shell
```

The stories use complete Hara projects and named data-only presentation states.
Their Canvas is a Hara-rendered semantic projection of the shell contract. The
Source panel links to the actual `src/shell.js` implementation and the Docs
panel links back to this README.

```sh
npm run check:showcases
```

Source-local Showcase paths are checked in this repository. Publication injects
the exact source commit and verifies the projects and surfaces again before the
Gallery can expose them.

## Boundary

```text
Hara
  Workspace evaluation
  serializable areas and layout
  canonical selection and semantic events

@greenways/hodos-workspace-ui
  recursive visible layout
  splitters and compact surface mechanics
  focus hand-off
  deterministic mount/update/destroy
```

Persistence, collaboration, signatures, and Hestia integration are outside this
package.
