# Hodos

Hodos is an open-world kernel and browser-native 3D editor. A repository
describes an immutable base world with `project.edn`; the Hara kernel resolves
its bundle and locked packages, carries the editable scene document, and the
viewer projects both through PlayCanvas and classical web interfaces.

The repository is a package workspace. Hodos Core stays independent of any
runtime or projection, while first-party features activate through the same
add-on contract available to third parties:

- `packages/core` owns the dependency-free add-on host and the stable
  `gw.hodos` bundle, package, scene, and session primitives.
- `packages/addon-drafts` owns reversible world draft sessions.
- `packages/addon-publication` owns semantic review and publication intent.
- `packages/addon-authoring` composes drafts and publication into the complete
  semantic editor session.
- `packages/kernel` is the lazy Hara runtime adapter and compatibility kernel
  composition; it no longer owns the feature modules it loads.
- `packages/world-model` owns renderer-neutral entity, authoring, draft, and
  drag models.
- `packages/source-github` resolves immutable repository worlds.
- `packages/renderer-playcanvas` renders splats, entities, touchpoints, audio,
  and optional authoring overlays.
- `packages/ui-world-authoring` supplies the optional Outliner, properties,
  multi-selection, transforms, assets, prefabs, collections, animation, and
  scripting UI.
- `packages/ui-world-publication` supplies optional semantic review controls.
- `packages/viewer` is a thin browser shell with no featured-world,
  landing-page, source, renderer, or editor policy; it also mounts trusted
  host-registered 2D application surfaces.
- `packages/viewer-defaults` composes the GitHub source and PlayCanvas renderer
  into the first-party Worlds preset.
- `apps/demo` is the Hodos Worlds application using public repositories from
  [greenways-worlds](https://github.com/greenways-worlds). Its Splat Garden
  experience combines the editor, tour, live Hara inspector, command deck and
  browser-native multitrack Studio.

Each reusable directory is both an npm workspace package and a Hara HARP
package. See [`docs/packages-and-addons.md`](docs/packages-and-addons.md) for
the extension contract, package graph, validation, and release workflow.

## Complete world editor

The World Editor layers a reversible Hara scene document over an immutable
repository world. Its browser-native Object Mode now includes:

- shared viewport/Outliner multi-selection and drag-box selection;
- geometric X/Y/Z axis controls plus XY/XZ/YZ and uniform handles;
- world and local transform orientation;
- median, active, individual and 3D-cursor pivots;
- independent translation, rotation and scale snapping;
- origin-to-cursor, selection-to-cursor and group framing;
- Empty, Cube, Sphere, Plane, Cylinder, Cone, Capsule, Point Light, Camera,
  Trigger Volume and remote GLB asset instances;
- hierarchy, collections, active-collection placement and collection isolation;
- reusable prefab capture and hierarchy-preserving instantiation;
- exact transform, visibility, locking, material, light, camera, trigger,
  spatial-audio and Hara-script properties;
- keyframe animation tracks with timeline scrub, play, pause and loop;
- live Hara script attachment, event subscriptions and bounded execution traces;
- unified world undo/redo across entities, spatial audio, collections, assets,
  prefabs and animations;
- OPFS persistence, exact-world export, semantic import/review, repository
  patches and signed Hestia contributions.

See [`docs/complete-world-editor.md`](docs/complete-world-editor.md) for the full
authoring document, interaction model, asset/prefab workflow, animation model
and Hara scripting contract. The earlier
[`docs/world-editor.md`](docs/world-editor.md) describes the foundational Object
Mode architecture.

## Canonical boundaries

The editor keeps meaning and projection separate:

- Hara carries world identity, entities, collections, assets, prefabs,
  animations, hierarchy, transforms, components, editor selection/tool state,
  script traces, world drafts, proposals, publication receipts, Studio state,
  command history and revisions.
- PlayCanvas renders and picks the immutable and editable scene, resolves world
  drop positions, projects transform controls, loads GLB instances and previews
  animation.
- HTML and Canvas render precise interfaces such as the World Editor, Studio,
  timeline, script panel, semantic review, guided tour, Inspector and Command
  Deck.
- Web Audio owns decoded buffers, offline rendering, HRTF panners and the
  real-time audio clock.
- Web Crypto hashes repository artifacts and signs Hestia contribution
  envelopes; signing keys remain browser-owned.
- OPFS owns durable local media, Studio project snapshots and exact-world scene
  drafts.
- World Hara scripts receive only serializable event, entity and world values;
  they do not receive DOM nodes, PlayCanvas entities, AudioBuffers, CryptoKeys
  or arbitrary filesystem access.
- A world can request a registered surface by ID, but cannot inject arbitrary
  HTML or host JavaScript.

## Touchpoints and classical interfaces

A touchpoint is a spatial interaction attached to a world position or bounded
region. Activating it sends a semantic event to the long-lived Hara session.
Hara decides which surface becomes active and emits a `ui/open-surface` effect;
the browser mounts the matching trusted HTML application.

See [`docs/touchpoints-and-surfaces.md`](docs/touchpoints-and-surfaces.md) for
the interaction contract,
[`docs/guided-showcase.md`](docs/guided-showcase.md) for the demo journey,
[`docs/studio-project-model.md`](docs/studio-project-model.md) for Studio state,
[`docs/studio-storage-and-export.md`](docs/studio-storage-and-export.md) for
portable projects,
[`docs/spatial-audio.md`](docs/spatial-audio.md) for Studio-to-world sound,
[`docs/world-drafts.md`](docs/world-drafts.md) for exact-world persistence, and
[`docs/world-draft-review-and-publication.md`](docs/world-draft-review-and-publication.md)
for semantic acceptance, repository patches and signed Hestia contributions.

## Development

```sh
npm install
npm run check:packages
npm run pack:check
npm test
npm run build
```

The primary demo opens the composed `greenways-worlds/splat-garden` repository
as an authoring workspace. Apartment and Playbot remain immutable base layers;
objects, lights, cameras, triggers, GLB assets, animations, scripts and spatial
audio are created in the Hara-backed overlay. The guided tour, Inspector and
`M-x`-style Command Deck remain available through repository-authored
touchpoints.

The Studio supports local audio import, content-addressed OPFS media, tracks,
clips, non-destructive editing, mixer controls, undo/redo, Web Audio playback,
WAV export and verified portable bundles. A complete track or clip can be
dragged into the 3D world and edited alongside ordinary entities.

Portable world drafts cover the complete authoring graph. Makers can review
additions, removals and field changes for entities, spatial audio, collections,
assets, prefabs and animations; accept any subset as one undoable Hara
transaction; then produce a `git apply`-compatible patch or an independently
verifiable ECDSA-signed Hestia-room contribution.

Vertex/edge/face editing, UVs, sculpting, rigging, skeletal animation and shader
graphs remain specialist modelling packages rather than concerns of the shared
world document. Local asset-bundle packing, direct GitHub PR creation, Hestia
network submission, collaboration and full script breakpoints can build on the
contracts implemented here.
