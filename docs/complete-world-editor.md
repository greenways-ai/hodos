# Complete Hodos World Editor

Hodos is a browser-native 3D world editor built around a long-lived Hara
kernel. Repository-defined Gaussian-splat worlds form an immutable visual base;
makers compose an editable scene document over that base using PlayCanvas,
classical browser panels, Web Audio and the embedded Hara runtime.

The editor intentionally separates meaning from projection:

- **Hara** carries the canonical document, editor session, history, animation
  definitions, script components, trace records and publication intent.
- **PlayCanvas** projects Gaussian splats, editable entities, lights, cameras,
  triggers, GLB instances, selection and transform controls.
- **HTML/CSS** supplies the Outliner, properties, assets, prefabs, collections,
  timeline, script editor and review panels.
- **OPFS** persists exact-world drafts and referenced local Studio media.
- **Web Audio** owns decoded buffers, spatial processing and the real-time audio
  clock.
- **Web Crypto** hashes repository artifacts and signs Hestia contribution
  envelopes. Keys never enter Hara state.

## Canonical authoring document

A persisted world draft contains six top-level authoring collections:

```json
{
  "format": "hodos-world-draft",
  "version": "0.1.0",
  "revision": 18,
  "entities": [],
  "audioSources": [],
  "collections": [],
  "assets": [],
  "prefabs": [],
  "animations": []
}
```

Editor-only values are stored in the live Hara session, not in portable draft
snapshots:

```json
{
  "mode": "edit",
  "tool": "translate",
  "space": "world",
  "pivot": "median",
  "cursor": [0, 0, 0],
  "snap": {
    "enabled": true,
    "translate": 0.25,
    "rotate": 5,
    "scale": 0.1
  },
  "isolation": null,
  "activeCollection": null,
  "selection": [
    { "type": "entity", "id": "chair" },
    { "type": "entity", "id": "lamp" }
  ],
  "active": { "type": "entity", "id": "lamp" },
  "timeline": {
    "animation": "main",
    "time": 1.5,
    "playing": false,
    "loop": true
  }
}
```

This prevents personal camera, selection and tool choices from polluting shared
world artifacts while preserving a programmable live editor.

## Selection and viewport tools

The viewport and Outliner share the same Hara selection set.

- Click replaces selection.
- Shift-click toggles an item.
- Command/Ctrl-click adds an item.
- `B` activates box selection.
- Command/Ctrl-`A` selects all editable entities and spatial sources.
- `Escape` clears selection.
- `.` or `F` frames the selected set.

Selection may contain ordinary entities and spatial-audio sources together.
Locked entities remain visible but cannot be transformed.

### Transform tools

| Shortcut | Tool |
|---|---|
| `Q` | Select |
| `B` | Box select |
| `W` | Translate |
| `E` | Rotate |
| `R` | Scale |
| `Tab` | Edit / Preview |

The editor provides X, Y and Z axis handles plus XY, XZ, YZ and uniform handles.
Dragging previews changes in PlayCanvas and sends one semantic Hara transform
transaction when released.

Orientation can be **World** or **Local**. Pivot choices are:

- **Median** — average of selected object positions.
- **Active** — the active object.
- **Individual** — each entity transforms around itself.
- **3D Cursor** — the explicit editor cursor.

Translation, rotation and scale snapping have independent editable increments.

## Origin and cursor operations

The editor exposes an explicit 3D cursor in session state. Current operations
include:

- move the selected group so its active object reaches the cursor;
- set selected entity origins relative to the cursor;
- use the cursor as a shared transform pivot.

Origins are persisted on entities. The cursor itself remains editor-session
state.

## Collections and isolation

Collections organize authoring objects independently of the transform
hierarchy. An entity can have both a parent and a collection.

Makers can:

- create collections;
- choose the active collection for new entities;
- move the selected objects into a collection;
- move objects back to the scene root;
- isolate one collection;
- isolate root objects;
- delete a collection without deleting its objects.

Collection changes participate in world undo/redo, OPFS persistence, semantic
review and publication.

## Assets and prefabs

### Built-in assets

The Assets dock can create:

- Empty
- Cube
- Sphere
- Plane
- Cylinder
- Cone
- Capsule
- Point Light
- Camera
- Trigger Volume

### Remote GLB assets

A remote GLB may be registered with a stable asset ID, name and URL. Asset
records remain serializable in Hara. PlayCanvas owns the loaded container asset
and instantiated render entity.

```json
{
  "id": "chair",
  "name": "Chair",
  "kind": "gltf",
  "url": "https://assets.example/chair.glb",
  "metadata": {}
}
```

An asset instance references that record through its component data.

### Prefabs

A prefab captures the selected entity hierarchy as a reusable subworld:

```json
{
  "id": "desk-set",
  "name": "Desk Set",
  "rootIds": ["desk"],
  "entities": []
}
```

Instantiation generates new stable IDs, preserves internal parent links, adds a
world-space offset to prefab roots and optionally places the result in the
active collection.

## Cameras and triggers

Camera entities carry browser-independent settings:

```json
{
  "camera": {
    "fov": 60,
    "nearClip": 0.05,
    "farClip": 1000,
    "active": false
  }
}
```

Trigger volumes carry a semantic event contract:

```json
{
  "trigger": {
    "shape": "box",
    "size": [1, 2, 1],
    "event": "world/trigger-enter",
    "once": false
  }
}
```

The first implementation projects trigger bounds and persists their contract.
Physics-backed trigger dispatch can use the same component without changing the
world document.

## Animation timeline

Animations contain tracks and typed keyframes:

```json
{
  "id": "main",
  "name": "Main",
  "duration": 10,
  "fps": 30,
  "tracks": [
    {
      "id": "track-door-position",
      "entity": "door",
      "property": "position",
      "enabled": true,
      "keyframes": [
        { "id": "closed", "time": 0, "value": [0, 0, 0], "easing": "linear" },
        { "id": "open", "time": 2, "value": [1, 0, 0], "easing": "ease-out" }
      ]
    }
  ]
}
```

Current track properties are:

- position
- rotation
- scale
- visibility
- point-light intensity

The browser interpolates previews against the animation clock. Keyframes and
tracks remain canonical Hara data. Scrubbing or playback does not overwrite the
authored base transform.

## Live Hara scripts

An entity may attach a Hara script component:

```json
{
  "script": {
    "language": "hara",
    "enabled": true,
    "events": ["world/start", "world/entity-transform"],
    "source": "(fn [event entity world] {\"entity\" entity})"
  }
}
```

The source must evaluate to a function accepting:

```clojure
[event entity world]
```

The return value is ordinary serializable Hara data. Returning an `"entity"`
record requests a canonical entity replacement through the authoring reducer.
Other values are retained in the trace.

Execution follows this boundary:

```text
Hara session
    emits script/evaluate
        ↓
Browser host calls the shared embedded Hara VM
        ↓
Browser sends world/script-result
        ↓
Hara stores completed or failed trace
```

Scripts do not receive DOM nodes, PlayCanvas entities, files, AudioBuffers,
CryptoKeys or arbitrary network access. Source is bounded to 64 KiB.

Automatic subscriptions currently cover:

- `world/start`
- `world/entity-create`
- `world/entity-update`
- `world/entity-transform`

The script dock can also invoke `world/editor-run` manually and inspect recent
traces.

## Undo, persistence and publication

All authoring collections share one world history. A multi-object transform,
prefab instantiation, collection move, keyframe insertion or accepted semantic
proposal is one reversible transaction.

The complete document is:

1. persisted in OPFS against repository + immutable commit + project ID;
2. exportable as `.hodos-world.json`;
3. importable as an exact-world semantic proposal;
4. reviewable collection by collection;
5. publishable as a Git patch or signed Hestia contribution.

Semantic review covers additions, removals and field changes for entities,
spatial audio, collections, assets, prefabs and animations.

## Current boundary

This release completes the requested world-authoring layers. It is not a mesh
modelling package. Vertex/edge/face editing, UVs, sculpting, rigging, skeletal
animation and shader graphs should remain specialist packages built on the same
Hara document and command substrate.

Remote GLB registration currently uses URLs; local asset bundles, dependency
packing and generated thumbnails are the next asset-pipeline layer. The script
trace contract supports a future step debugger and breakpoints, but the current
surface provides run, result, failure and bounded trace history.
