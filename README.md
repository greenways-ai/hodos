# Hodos

**Hodos is the open specification and projection boundary for web-native worlds.**

It defines how a world is described, loaded into the Hara kernel, connected to
standards-based browser capabilities, engaged by people and agents, persisted,
and transferred between conforming hosts.

Hodos is not a monolithic renderer, editor, physics engine, game engine, wallet,
or marketplace. Those are replaceable implementations above the specification.

## Repository map

| Path | Role | Status |
|---|---|---|
| [`spec/`](spec/) | Normative Hodos drafts: world format, host ABI, capabilities, engagement, conformance, and profiles | Canonical boundary |
| [`packages/`](packages/) | Reference SDK, Hara runtime bridge, Workspace components, spatial models, adapters, viewer, and optional authoring packages | Reference implementation |
| [`apps/demo/`](apps/demo/) | Browser-native **Hodos 3D Reference** viewer and editor | Reference distribution |
| [`site/`](site/) | Astro + Starlight specification and project site | Public surface |
| [`docs/`](docs/) | Detailed implementation and migration notes | Non-normative |
| [`src/`](src/) | Hara packaging and deployment entry points | Existing distribution |

The migration deliberately introduces clearer boundaries without moving all
working packages at once. Later changes can extract source-neutral protocol
packages and move renderer, source, storage, publication, and UI implementations
behind the contracts in `spec/` while retaining compatibility exports.

## Architectural position

```text
Products and specialist engines
Worlds · games · simulations · social spaces · Alumbra
Editors · launchers · collaboration · publication
Renderers · physics · media · XR · wallet adapters
──────────────── HODOS PROFILES ────────────────
───────────────── HODOS CORE ──────────────────
World format · Browser↔Hara ABI · capabilities
Lifecycle · engagement · conformance
────────────────────────────────────────────────
Hara kernel             Standards-based web host
WebAssembly             Browser APIs
Operating system · devices · networks
```

See [`spec/README.md`](spec/README.md) for the layer model and current
specification index.

## Hodos 3D and specialist engines

**Hodos 3D** is the generic sparse-scene and spatial Workspace component family.
It owns serializable spaces, entities, transforms, cameras, selection,
affordances, trusted component lifecycle, and replaceable renderer/provider
boundaries.

It does not own dense simulation domains. Specialist engines retain their own
formats, hot state, physics, streaming, rendering, and product rules. Alumbra is
the first explicit external consumer: it owns voxel chunks, block registries,
terrain generation, meshing, voxel collision, lighting, crafting, creatures,
and authoritative realm simulation.

The dependency direction is one-way:

```text
Alumbra → Hodos
Hodos   ✕ Alumbra
```

The current first-party viewer/editor distribution is named **Hodos 3D
Reference**. “Worlds” remains a product/category term rather than the name of a
Hodos game engine.

See [`docs/3d-and-specialist-engines.md`](docs/3d-and-specialist-engines.md) for
the implementation boundary and migration rules.

## Run Hodos 3D Reference

```sh
npm install
npm test
npm run build:demo
```

The build remains in `apps/demo/dist`. On the public site it is mounted at
`/hodos/demo/`.

## Run the specification site

```sh
npm run site:install
npm run site:dev
```

The site synchronizes the canonical Markdown drafts from `spec/` before Astro
starts. A production build uses:

```sh
npm run site:build
```

## Current reference implementation

The existing implementation remains intentionally featureful while Hodos is
reframed around the smaller interoperability boundary:

- Hara carries serializable world identity, state, entities, revisions,
  actions, and effect requests.
- The browser host owns DOM nodes, GPU objects, media nodes, device handles,
  filesystem handles, and cryptographic keys.
- PlayCanvas is the current generic 3D projection adapter.
- GitHub is the current immutable world-source adapter.
- OPFS, Web Audio, Web Crypto, and trusted DOM surfaces are current browser
  implementations.
- Drafting, authoring, review, publication, Studio, and the reference viewer are
  optional layers above the core specification.

Existing implementation documents remain under [`docs/`](docs/). Their
contracts will be reconciled with the normative drafts incrementally rather
than moved in one breaking change.

## Development

```sh
npm install
npm run audit:hal
npm run check:packages
npm run pack:check
npm test
npm run build:demo
npm run site:install
npm run site:build
```
