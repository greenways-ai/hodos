# Hodos

Hodos is an open-world kernel and browser-native 3D editor. A repository
describes an immutable base world with `project.edn`; the Hara kernel resolves
its bundle and locked packages, carries the editable scene document, and the
viewer projects both through PlayCanvas and classical web interfaces.

The repository deliberately separates reusable technology from presentation:

- `packages/kernel` owns the `gw.hodos.*` HAL surface, bundling, persistent
  browser sessions, package plans, scene commands, generic scene entities,
  editable world drafts, semantic review, and publication intent.
- `packages/viewer` is an embeddable browser editor with no featured-world or
  landing-page policy. It renders Gaussian splats and editable PlayCanvas
  entities, provides an outliner, properties inspector, transform tools,
  viewport selection, draft/review controls, and mounts only trusted,
  host-registered 2D application surfaces.
- `apps/demo` is the Hodos Worlds application using public repositories from
  [greenways-worlds](https://github.com/greenways-worlds). Its Splat Garden
  experience combines the editor, tour, live Hara inspector, command deck and
  browser-native multitrack Studio.

## World editor

The World Editor layers a reversible Hara scene document over an immutable
repository world. The initial Blender-like authoring loop includes:

- scene outliner with base layers, touchpoints, draft hierarchy and spatial
  audio;
- viewport selection and framing;
- edit and preview modes;
- `Q/W/E/R` select, move, rotate and scale tools;
- axis transform controls with preview and one semantic commit on release;
- Empty, Cube, Sphere, Plane, Cylinder, Cone, Capsule and Point Light creation;
- exact transform, parenting, visibility and locking properties;
- primitive colour/opacity and point-light properties;
- duplicate, delete, undo and redo;
- OPFS persistence, portable scene export, semantic import/review, repository
  patches and signed Hestia contributions.

See [`docs/world-editor.md`](docs/world-editor.md) for the scene schema,
interaction model, command surface and follow-up editor layers.

## Touchpoints and classical interfaces

A touchpoint is a spatial interaction attached to a world position or bounded
region. Activating it sends a semantic event to the long-lived Hara session.
Hara decides which surface becomes active and emits a `ui/open-surface` effect;
the browser then mounts the matching trusted HTML application.

This keeps the boundary explicit:

- Hara carries world identity, generic entities, hierarchy, transforms,
  components, editor selection/tool state, world draft, proposal,
  publication-receipt, surface, Studio project, track, clip, mixer,
  spatial-source, transport, command-history, and revision state.
- PlayCanvas renders and picks the immutable and editable 3D scene, resolves
  world drop positions, projects transform controls, and renders lights and
  primitive materials.
- HTML and Canvas render precise classical interfaces such as the World Editor,
  Studio, semantic review, guided tour, Inspector and Command Deck.
- Web Audio owns decoded buffers, offline rendering, HRTF panners, and the
  real-time audio clock.
- Web Crypto hashes repository artifacts and signs Hestia contribution
  envelopes; signing keys remain browser-owned.
- OPFS owns durable local media, Studio project snapshots, and exact-world scene
  drafts.
- A world can request a registered surface by ID, but cannot inject arbitrary
  HTML or obtain direct DOM, audio-node, signing-key, or filesystem access.

See [`docs/touchpoints-and-surfaces.md`](docs/touchpoints-and-surfaces.md) for
the interaction contract,
[`docs/guided-showcase.md`](docs/guided-showcase.md) for the complete demo
journey,
[`docs/studio-project-model.md`](docs/studio-project-model.md) for the Hara
track, clip, editing, and undo/redo graph,
[`docs/studio-storage-and-export.md`](docs/studio-storage-and-export.md) for the
persistence and portable bundle contract,
[`docs/spatial-audio.md`](docs/spatial-audio.md) for Studio-to-world drag and
spatial playback,
[`docs/world-drafts.md`](docs/world-drafts.md) for editable, persistent local
world state, and
[`docs/world-draft-review-and-publication.md`](docs/world-draft-review-and-publication.md)
for exact-world imports, semantic acceptance, repository patches, and signed
Hestia contributions.

## Development

```sh
npm install
npm test
npm run build
```

The primary demo opens the composed `greenways-worlds/splat-garden` repository
as an authoring workspace. Apartment and Playbot remain immutable base layers;
primitives, lights and spatial audio are created in the Hara-backed overlay.
The guided tour, Inspector and `M-x`-style Command Deck remain available through
repository-authored touchpoints.

The Studio supports opening a classical interface from a spatial touchpoint,
dragging local audio into the arrangement, storing content-addressed media in
origin-private browser storage, restoring the Hara project, creating tracks,
moving clips horizontally or between tracks, non-destructive trim, split,
duplicate and delete, mixer controls, undo/redo, Web Audio playback, WAV export
and verified portable project bundles.

A complete track or individual clip can be dragged from Studio into the 3D
world. It becomes a first-class editable spatial-audio object in the same
outliner and world draft as primitives and lights. Hara owns its position,
playback, gain, audible range, looping and history; Web Audio projects the
current state through an HRTF `PannerNode`.

Portable world drafts include generic entities and audio sources. Makers can
review entity/source additions, removals, hierarchy, components and field-level
changes, accept any subset as one undoable Hara transaction, then produce a
`git apply`-compatible repository patch or independently verifiable,
ECDSA-signed Hestia-room contribution.

Mesh edit mode, UVs, rigging, animation curves, shader graphs, multi-selection,
asset/prefab libraries, direct GitHub PR creation, Hestia network submission,
collaboration and model providers remain subsequent layers.
