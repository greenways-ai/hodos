# Hodos

**Hodos is the open specification boundary for web-native worlds.**

It defines how a world is described, loaded into the Hara kernel, connected to
standards-based browser capabilities, engaged by people and agents, persisted,
and transferred between conforming hosts.

Hodos is not a monolithic renderer, editor, physics engine, wallet, or
marketplace. Those are replaceable implementations above the specification.

## Repository map

| Path | Role | Status |
|---|---|---|
| [`spec/`](spec/) | Normative Hodos drafts: world format, host ABI, capabilities, engagement, conformance, and profiles | New canonical boundary |
| [`packages/`](packages/) | Reference SDK, Hara runtime bridge, world models, adapters, viewer, and optional authoring packages | Existing implementation |
| [`apps/demo/`](apps/demo/) | Full browser-native reference world and editor | Preserved unchanged |
| [`site/`](site/) | Astro + Starlight specification and project site | New |
| [`docs/`](docs/) | Detailed implementation notes for the current reference stack | Non-normative |
| [`src/`](src/) | Hara packaging and deployment entry points | Existing distribution |

The first migration deliberately introduces these boundaries without moving the
working packages. Later changes can extract source-neutral protocol packages and
move renderer, source, storage, publication, and UI implementations behind the
contracts in `spec/`.

## Architectural position

```text
Worlds · games · simulations · social spaces
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

## Run the reference demo

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
- PlayCanvas is the current 3D projection adapter.
- GitHub is the current immutable world-source adapter.
- OPFS, Web Audio, Web Crypto, and trusted DOM surfaces are current browser
  implementations.
- Drafting, authoring, review, publication, Studio, and the viewer are optional
  reference layers above the core specification.

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
