# Hodos

Hodos is an open-world kernel and browser viewer. A repository describes a
world with `project.edn`; the Hara kernel resolves its bundle and locked
packages, and the viewer renders its Gaussian-splat scene.

The repository deliberately separates reusable technology from presentation:

- `packages/kernel` owns the `gw.hodos.*` HAL surface, bundling, persistent
  browser sessions, package plans, and scene commands.
- `packages/viewer` is an embeddable browser viewer with no featured-world or
  landing-page policy. It projects spatial touchpoints and world-owned audio
  sources into the scene and mounts only trusted, host-registered 2D
  application surfaces.
- `apps/demo` is the Hodos Worlds demonstration using public repositories from
  [greenways-worlds](https://github.com/greenways-worlds). Its first application
  surface is a browser-native multitrack music studio prototype.

## Touchpoints and classical interfaces

A touchpoint is a spatial interaction attached to a world position or bounded
region. Activating it sends a semantic event to the long-lived Hara session.
Hara decides which surface becomes active and emits a `ui/open-surface` effect;
the browser then mounts the matching trusted HTML application.

This keeps the boundary explicit:

- Hara carries world, surface, Studio project, track, clip, mixer, spatial
  source, transport, command-history, and revision state.
- PlayCanvas renders and picks the 3D scene and resolves world drop positions.
- HTML and Canvas render precise classical interfaces such as the Studio.
- Web Audio owns decoded buffers, offline rendering, HRTF panners, and the
  real-time audio clock.
- OPFS owns durable local media bytes and project snapshots.
- A world can request a registered surface by ID, but cannot inject arbitrary
  HTML or obtain direct DOM, audio-node, or filesystem access.

See [`docs/touchpoints-and-surfaces.md`](docs/touchpoints-and-surfaces.md) for
the interaction contract,
[`docs/studio-project-model.md`](docs/studio-project-model.md) for the Hara
track, clip, editing, and undo/redo graph,
[`docs/studio-storage-and-export.md`](docs/studio-storage-and-export.md) for the
persistence and portable bundle contract, and
[`docs/spatial-audio.md`](docs/spatial-audio.md) for Studio-to-world drag and
spatial playback.

## Development

```sh
npm install
npm test
npm run build
```

The current Studio slice supports opening a classical interface from a 3D
touchpoint, dragging local audio into the arrangement, storing content-addressed
media in origin-private browser storage, restoring the Hara project on a later
visit, creating tracks, moving clips horizontally or between tracks,
non-destructively trimming, splitting, duplicating and deleting clips, editing
track gain and mute, undoing and redoing committed edits through Hara, playing
through Web Audio, rendering a WAV mix, and exporting and reopening a verified
portable project bundle.

A complete track or individual clip can also be dragged from Studio into the
3D world. Hara creates and owns the spatial source; the browser renders its
marker, tracks the camera as the Web Audio listener, and projects the selected
clip graph through an HRTF `PannerNode`. Source play/pause and removal return to
Hara as semantic events.

Fades, automation, recording, generated stems, a musical tick/tempo timebase,
persistent published world placements, and model providers remain subsequent
slices.
