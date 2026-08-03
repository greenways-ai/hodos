# Hodos

Hodos is an open-world kernel and browser viewer. A repository describes a
world with `project.edn`; the Hara kernel resolves its bundle and locked
packages, and the viewer renders its Gaussian-splat scene.

The repository deliberately separates reusable technology from presentation:

- `packages/kernel` owns the `gw.hodos.*` HAL surface, bundling, persistent
  browser sessions, package plans, and scene commands.
- `packages/viewer` is an embeddable browser viewer with no featured-world or
  landing-page policy. It projects spatial touchpoints into the scene and
  mounts only trusted, host-registered 2D application surfaces.
- `apps/demo` is the Hodos Worlds demonstration using public repositories from
  [greenways-worlds](https://github.com/greenways-worlds). Its first application
  surface is a browser-native multitrack music studio prototype.

## Touchpoints and classical interfaces

A touchpoint is a spatial interaction attached to a world position or bounded
region. Activating it sends a semantic event to the long-lived Hara session.
Hara decides which surface becomes active and emits a `ui/open-surface` effect;
the browser then mounts the matching trusted HTML application.

This keeps the boundary explicit:

- Hara carries world, surface, studio project, clip, mixer, transport, command
  history, and revision state.
- PlayCanvas renders and picks the 3D scene.
- HTML and Canvas render precise classical interfaces such as the studio.
- Web Audio owns decoded buffers and the real-time audio clock.
- OPFS owns durable local media bytes and project snapshots.
- A world can request a registered surface by ID, but cannot inject arbitrary
  HTML or obtain direct DOM or filesystem access.

See [`docs/touchpoints-and-surfaces.md`](docs/touchpoints-and-surfaces.md) for
the interaction contract,
[`docs/studio-project-model.md`](docs/studio-project-model.md) for the Hara
track, clip, editing, and undo/redo graph, and
[`docs/studio-storage-and-export.md`](docs/studio-storage-and-export.md) for the
persistence and portable bundle contract.

## Development

```sh
npm install
npm test
npm run build
```

The current studio slice supports opening a surface from a 3D touchpoint,
dragging local audio into the arrangement, storing content-addressed media in
origin-private browser storage, restoring the Hara project on a later visit,
drawing waveforms, moving and non-destructively trimming clips, splitting,
duplicating and deleting clips, editing track gain and mute, undoing and
redoing committed edits through Hara, playing through Web Audio, rendering a
WAV mix, and exporting and reopening a verified portable project bundle
containing both Hara state and immutable audio.

Cross-track movement, fades, automation, recording, generated stems, spatial
track placement in the world, a musical tick/tempo timebase, and model providers
remain subsequent slices.
