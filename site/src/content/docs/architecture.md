---
title: Architecture
description: Where Hodos sits between worlds, engines, Hara, and the standards-based host.
---

Hodos is an **open world ABI and specification**, not a single game engine
implementation.

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

## Above Hodos

Systems above Hodos interpret or extend the portable world contract:

- world applications and games;
- viewers, editors, launchers, studios, and marketplaces;
- 2D, 3D, splat, WebGPU, and XR renderers;
- physics, animation, avatar, AI, and simulation systems;
- multiplayer, collaboration, publication, and discovery;
- chain, account, wallet, and asset adapters.

A conforming world should remain meaningful when one implementation is replaced
by another implementation that supports the same profiles.

## Hodos itself

The normative centre contains six concerns:

1. common identifiers, values, envelopes, errors, and lifecycle;
2. a source-neutral world definition;
3. the serializable Browser–Hara Host ABI;
4. capability and permission negotiation;
5. semantic engagement;
6. profiles and conformance.

The [specification index](../spec/) links the current drafts.

## Below Hodos

Hodos relies on lower layers but does not redefine them:

- Hara compilation, packaging, scheduling, and execution;
- WebAssembly;
- browser event loops and permission UX;
- browser graphics, input, media, storage, network, crypto, identity, and
  device APIs;
- operating systems, hardware, networks, chains, and custody systems.

## Reference implementation

The existing packages remain a useful implementation laboratory. PlayCanvas,
GitHub, OPFS, Web Audio, Web Crypto, Hestia contribution flows, and the
browser-native editor prove the boundary, but they do not become required parts
of Hodos merely because the first-party demo uses them.
