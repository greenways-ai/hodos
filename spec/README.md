# Hodos specification

Hodos defines the portable boundary between a semantic world running in Hara
and a standards-based host such as a web browser.

The specification is intentionally smaller than a game engine. It standardizes
the information and messages that implementations exchange, not the internal
design of renderers, editors, physics engines, storage engines, wallets, network
services, voxel engines, or game rules.

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
- multiplayer, collaboration, publication, discovery, and wallet adapters;
- dense domain engines such as voxel, robotics, scientific, or digital-twin
  runtimes.

Hodos does not require one implementation of any of these systems.

A specialist engine may register trusted packaged components, consume portable
Hodos values, and emit declared semantic events. Its dense arrays, workers, GPU
resources, engine entities, caches, and per-frame state remain host-owned and do
not cross the Hodos ABI.

### Hodos

The normative boundary includes:

- a source-neutral world definition;
- a browser-to-Hara host ABI;
- capability and permission negotiation;
- session and world lifecycle;
- semantic engagement independent of input device;
- profiles and conformance tests.

A Hodos 3D implementation may additionally provide generic serializable spaces,
sparse scene entities, transforms, cameras, selection, affordances, and
replaceable projection contracts. It must not make one renderer or specialist
engine normative.

### Below Hodos

Hodos relies on, but does not redefine:

- the Hara compiler, package system, runtime, scheduler, and state model;
- WebAssembly and the browser event loop;
- browser graphics, input, media, storage, network, crypto, identity, and
  device APIs;
- operating-system drivers, hardware, networks, blockchains, and wallet
  custody systems.

## Specialist-engine dependency rule

The dependency direction is from a specialist engine to Hodos, never from Hodos
to a specialist engine:

```text
specialist engine → Hodos
Hodos             ✕ specialist engine
```

Alumbra is the first named consumer of this rule. Alumbra owns voxel chunks,
block state, terrain generation, meshing, collision, lighting, fluids, inventory,
crafting, creatures, and authoritative realm simulation. Hodos owns only the
generic projection, component, capability, and semantic engagement boundaries
used to host that engine.

Remote world or Workspace data may select an installed component or provider ID,
but it must not provide executable component factories or renderer code.

## Design invariants

1. **Meaning is serializable.** Hara receives values, events, identifiers,
   bounded byte sequences, and opaque handles—not host objects.
2. **Authority is explicit.** A world has no ambient device, storage, network,
   identity, signing, or transaction authority.
3. **Projection is replaceable.** The world model cannot require PlayCanvas,
   Three.js, WebGPU, a DOM framework, one asset store, or one specialist engine.
4. **Engagement is semantic.** Pointer, gaze, touch, voice, controller, agent,
   and accessibility inputs can express the same intent.
5. **Worlds are addressable and verifiable.** Resources can carry media types,
   integrity digests, versions, and immutable references.
6. **Extensions do not silently redefine Core.** Vendor and experimental
   fields use explicit namespaces and negotiated profiles.
7. **Hot state stays behind the host boundary.** Dense arrays, GPU buffers,
   workers, audio nodes, caches, and per-frame engine objects remain outside
   portable Hodos models.
8. **Generic contracts follow demonstrated consumers.** Provider hooks should
   be extracted from working integrations rather than speculative universal
   engine APIs.

## Repository relationship

The current `packages/` tree is a reference implementation. Existing authoring,
publication, source, renderer, viewer, and Studio functionality remains useful,
but it is not automatically normative merely because it is shipped by this
repository.

The first-party spatial demo and distribution is named **Hodos 3D Reference**.
It demonstrates the contracts; it does not define Hodos as a game engine.
