# Hodos specification

Hodos defines the portable boundary between a semantic world running in Hara
and a standards-based host such as a web browser.

The specification is intentionally smaller than a game engine. It standardizes
the information and messages that implementations exchange, not the internal
design of renderers, editors, physics engines, storage engines, wallets, or
network services.

## Normative drafts

| Draft | Defines |
|---|---|
| [Core](core.md) | Common values, identifiers, versions, messages, errors, extensions, and lifecycle |
| [World](world.md) | Portable world identity, resources, spaces, modules, state, and entry points |
| [Host ABI](host-abi.md) | The serializable event/effect boundary between Hara and the host |
| [Capabilities](capabilities.md) | Discovery, request, grant, scope, quota, revocation, and denial |
| [Engagement](engagement.md) | Actors, affordances, intents, actions, effects, feedback, portals, and receipts |
| [Conformance](conformance.md) | Conformance levels, profiles, negotiation, fixtures, and test expectations |
| [Web3 profile](profiles/web3.md) | Chain/account identifiers, wallet sessions, signatures, transactions, and receipts |

These documents are early `0.x` drafts. Normative key words such as **MUST**,
**SHOULD**, and **MAY** indicate the intended direction, but compatibility is
not promised until a draft is explicitly marked stable.

## Layer model

### Above Hodos

Applications and specialist engines consume Hodos contracts:

- worlds, games, simulations, social spaces, and spatial applications;
- viewers, editors, studios, launchers, marketplaces, and portals;
- renderers, animation systems, physics engines, avatars, AI systems, and XR;
- multiplayer, collaboration, publication, discovery, and wallet adapters.

Hodos does not require one implementation of any of these systems.

### Hodos

The normative boundary includes:

- a source-neutral world definition;
- a browser-to-Hara host ABI;
- capability and permission negotiation;
- session and world lifecycle;
- semantic engagement independent of input device;
- profiles and conformance tests.

### Below Hodos

Hodos relies on, but does not redefine:

- the Hara compiler, package system, runtime, scheduler, and state model;
- WebAssembly and the browser event loop;
- browser graphics, input, media, storage, network, crypto, identity, and
  device APIs;
- operating-system drivers, hardware, networks, blockchains, and wallet
  custody systems.

## Design invariants

1. **Meaning is serializable.** Hara receives values, events, identifiers,
   bounded byte sequences, and opaque handles—not host objects.
2. **Authority is explicit.** A world has no ambient device, storage, network,
   identity, signing, or transaction authority.
3. **Projection is replaceable.** The world model cannot require PlayCanvas,
   Three.js, WebGPU, a DOM framework, or one asset store.
4. **Engagement is semantic.** Pointer, gaze, touch, voice, controller, agent,
   and accessibility inputs can express the same intent.
5. **Worlds are addressable and verifiable.** Resources can carry media types,
   integrity digests, versions, and immutable references.
6. **Extensions do not silently redefine Core.** Vendor and experimental
   fields use explicit namespaces and negotiated profiles.

## Repository relationship

The current `packages/` tree is a reference implementation. Existing authoring,
publication, source, renderer, viewer, and Studio functionality remains useful,
but it is not automatically normative merely because it is shipped by this
repository.
