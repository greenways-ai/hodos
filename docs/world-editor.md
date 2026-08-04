# Hodos World Editor

The Hodos World Editor turns a repository-defined 3D world into a live,
reversible authoring environment. The immutable repository graph remains the
base scene. A Hara world draft carries the editable scene layered over it.
PlayCanvas, HTML, OPFS, Web Audio and browser file APIs project that state into
an interactive host.

## Editor layout

The first editor shell follows familiar 3D-authoring conventions:

- a top toolbar for edit/preview mode, transform tools, object creation and
  document history;
- a left outliner showing immutable base layers, touchpoints, editable draft
  entities and spatial-audio sources;
- the central PlayCanvas viewport;
- a right properties inspector;
- a bottom status and shortcut strip;
- a collapsed semantic-review and publication panel.

The current keyboard map is:

| Key | Command |
| --- | --- |
| `Q` | Select |
| `W` | Translate |
| `E` | Rotate |
| `R` | Scale |
| `Tab` | Toggle edit/preview mode |
| `Shift-D` | Duplicate active draft entity |
| `Delete` / `Backspace` | Delete active editable item |
| `F` | Frame active item |
| `Escape` | Clear selection |
| `Cmd/Ctrl-Z` | Undo world command |
| `Shift-Cmd/Ctrl-Z` or `Ctrl-Y` | Redo world command |

## Scene document

The persisted draft now contains both spatial audio and generic entities:

```json
{
  "format": "hodos-world-draft",
  "version": "0.1.0",
  "revision": 12,
  "entities": [
    {
      "id": "entity-cube",
      "name": "Cube",
      "kind": "box",
      "parent": null,
      "visible": true,
      "locked": false,
      "transform": {
        "position": [0, 0.5, 0],
        "rotation": [0, 45, 0],
        "scale": [1, 1, 1]
      },
      "components": {
        "primitive": {
          "shape": "box",
          "color": "#c8ad73",
          "opacity": 1
        }
      }
    }
  ],
  "audioSources": []
}
```

Editor mode, current tool, selection and active item are session state. They do
not enter exported or published draft snapshots.

## Supported objects

The first slice can create:

- Empty
- Cube
- Sphere
- Plane
- Cylinder
- Cone
- Capsule
- Point Light

Primitives expose colour and opacity. Point lights expose colour, intensity,
range and shadow intent. Spatial-audio sources remain first-class outliner and
inspector objects with position, gain, range, loop and playback controls.

This is a scene-composition editor, not yet a mesh modeller. Mesh editing,
vertices, UVs, rigs, sculpting, shader graphs and animation curves require
separate component and tool layers.

## Hara command surface

The browser never treats the DOM or PlayCanvas graph as authoritative. Editor
operations are semantic session events:

```text
world/editor-select
world/editor-tool
world/editor-mode

world/entity-create
world/entity-update
world/entity-transform
world/entity-duplicate
world/entity-delete

world/history-undo
world/history-redo
```

A viewport gizmo previews a transform in PlayCanvas while the pointer moves.
On release it sends one `world/entity-transform` event. Hara records the
previous complete scene content as one undo step, updates the canonical draft,
and emits projection and persistence effects.

## Host projection

`scene/sync-world-entities` carries serialisable entity records plus editor
selection/tool state to the viewer. The renderer creates or updates PlayCanvas
entities, hierarchy, materials and point lights. It also projects selection and
axis controls.

The immutable Gaussian-splat layers remain read-only base-world entries in the
outliner. Draft entities and spatial audio form the editable overlay. This
allows an artist to author interactions and composition around scanned or
repository-owned geometry without mutating its binary payload.

## Persistence and publication

Entities are stored in the same exact-world OPFS draft record as spatial audio.
Validation rejects malformed transforms, duplicate identities, missing parents
and invalid persisted hierarchy graphs.

Portable draft import computes semantic additions, removals and replacements
for both `entities` and `audioSources`. Accepted subsets become one reversible
Hara transaction. Repository patches and signed Hestia contributions include
the full accepted scene document.

## Next editor layers

The most useful follow-up work is:

1. multi-selection, box selection and grouped transforms;
2. geometric axis and plane handles with grid, angle and scale snapping;
3. collections, hide/isolate, local coordinate space and pivot controls;
4. asset and prefab libraries, including drag into the viewport;
5. cameras, area/directional lights, trigger volumes and interaction components;
6. script attachment, event tracing and live Hara REPL integration;
7. animation timeline and keyframes;
8. semantic collision/picking for meshes and Gaussian splats;
9. collaborative drafts, leases and signed contribution review;
10. mesh/curve editing as a specialised authoring package rather than kernel
    state embedded in the renderer.
