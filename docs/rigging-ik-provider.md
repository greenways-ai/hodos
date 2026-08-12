# Bounded rigging IK provider

Hodos keeps inverse kinematics behind a host capability. Portable values describe
what should be solved, the sparse pose proposal returned by a provider, and
compact convergence evidence. Solver iterations, temporary position arrays,
renderer transforms and cancellation machinery remain operational host state.

The first reference provider is exported from:

```text
@greenways/hodos-renderer-playcanvas/rigging-ik
```

It is a separate add-on from the normal PlayCanvas renderer and declares:

```text
rig.ik
```

A host can therefore render Hodos worlds without granting inverse-kinematics
authority.

## Portable contracts

The world-model rigging export defines four alpha contracts:

```text
hodos.rig-ik-request/0-alpha
hodos.rig-ik-proposal/0-alpha
hodos.rig-ik-evidence/0-alpha
hodos.rig-ik-acceptance/0-alpha
```

### Request

A request binds the solve to exact identities and revisions:

```js
{
  schema: "hodos.rig-ik-request/0-alpha",
  id: "ik:wing-tip",
  method: "fabrik",
  rigId: "rig:moth",
  rigRevision: 12,
  poseId: "pose:rest",
  poseRevision: 4,
  suiteId: "suite:moth",
  chainId: "left-wing",
  target: [1.4, 2.1, 0.3],
  pole: null,
  limitPolicy: "clamp",
  tolerance: 0.0001,
  maximumChainLength: 32,
  maximumIterations: 24,
  maximumTemporaryBytes: 524288,
  maximumEvidenceJoints: 32
}
```

The named chain is resolved from an accepted
`hodos.rig-pose-suite/0-alpha` document. Joint names and topology are arbitrary;
no humanoid roles or naming conventions are assumed.

### Proposal

A successful provider returns only sparse local rotation deltas:

```js
{
  schema: "hodos.rig-ik-proposal/0-alpha",
  requestId: "ik:wing-tip",
  providerId: "playcanvas/rigging-ik",
  providerVersion: "0-alpha.1",
  method: "fabrik",
  status: "converged",
  rigId: "rig:moth",
  rigRevision: 12,
  poseId: "pose:rest",
  basePoseRevision: 4,
  suiteId: "suite:moth",
  chainId: "left-wing",
  target: [1.4, 2.1, 0.3],
  joints: [
    { jointId: "wing-pin", rotation: [0, 0, 0.18, 0.9837] },
    { jointId: "wing-mid", rotation: [0.02, 0.08, 0.11, 0.9905] }
  ]
}
```

`applyRigIkProposal` checks the rig, pose identity and both revisions again. An
accepted proposal becomes one new pose revision. Rejection returns the previous
normalized pose unchanged.

### Evidence

Evidence is deliberately compact. It contains provider identity, classification,
iteration and distance counts, the effective resource bounds, bounded joint IDs,
limit diagnostics, and a structured error when the solve does not produce a
proposal. It never contains per-iteration arrays or renderer values.

Proposal and evidence envelopes must agree on request, provider, method, rig,
pose, suite, chain and status. A successful result must have a proposal and no
error; a failed result must have no proposal and a structured error.

## Provider algorithms

### Analytic two-bone

`analytic-two-bone` requires exactly three contiguous joints. It supports:

- unequal bone lengths;
- explicit pole targets;
- deterministic bend fallback based on the rig handedness;
- minimum- and maximum-reach clamping; and
- singular-chain classification for zero-length bones or an ambiguous root
  target.

A target outside the reachable annulus can still produce a clamped proposal.
The evidence classification is `unreachable`, rather than pretending that the
target was reached.

### General chains

`fabrik` supports arbitrary contiguous chains with two or more joints. The
provider uses a bounded forward/backward pass and preserves the accepted segment
lengths. It yields at configured iteration boundaries so cancellation can win
before a late proposal is published.

Iteration exhaustion is a classified failure. The provider does not return the
last incomplete working buffer as a portable proposal.

## Joint limits

The request selects one of three policies:

- `clamp`: clamp local rotation deltas against authored per-axis, swing and twist
  limits, then re-evaluate the accepted proposal;
- `reject`: classify any proposed violation as `limit-rejected`; or
- `ignore`: report limit evidence without changing the proposal.

Clamping is post-solve and deterministic. If the clamped pose still violates an
authored limit, the provider rejects it instead of publishing misleading
success evidence.

## Bounds

The portable contract has absolute alpha limits:

| Resource | Absolute limit |
| --- | ---: |
| Chain joints | 64 |
| Iterations | 64 |
| Temporary-byte budget | 4 MiB |
| Evidence joint IDs | 64 |
| Proposal joints | 64 |

The reference provider defaults are lower: 32 joints, 24 iterations, 512 KiB
and 32 evidence IDs. A solve uses the lower value from the request and provider
configuration.

The temporary-byte check is performed before working position arrays are
constructed. Resource-limit evidence may report the required chain length or
byte estimate above the effective provider bound, but it remains inside the
absolute portable envelope.

## Failure classifications

The reference provider distinguishes:

```text
reachable
unreachable
singular
iteration-exhausted
cancelled
stale
invalid-chain
limit-clamped
limit-rejected
resource-limit
provider-error
```

`cancelled`, `stale`, `invalid-chain`, `limit-rejected`, `resource-limit`,
`singular`, `iteration-exhausted` and `provider-error` return no proposal. The
previous accepted pose is not mutated.

## Host integration

```js
import { createHodosHost, hodosCoreAddon } from "@greenways/hodos-core";
import { hodosWorldModelAddon } from "@greenways/hodos-world-model";
import { hodosPlayCanvasRiggingIkAddon } from
  "@greenways/hodos-renderer-playcanvas/rigging-ik";

const host = createHodosHost({ capabilities: ["rig.ik"] });
host.register(
  hodosCoreAddon,
  hodosWorldModelAddon,
  hodosPlayCanvasRiggingIkAddon,
);
await host.activate(hodosPlayCanvasRiggingIkAddon.manifest.id);

const provider = host.getContribution("rig.ik", "playcanvas-local").create();
const result = await provider.solve({ document, pose, suite, request, signal });
```

Destroying a provider aborts its active solves and prevents new ones. An
`AbortSignal` can also cancel one request. Cancellation is checked before work,
on each bounded iteration, and immediately after host yielding.

## Authority boundary

Portable Hodos state may contain:

- exact rig, pose, suite and request identities and revisions;
- a named chain reference and target/pole vectors;
- explicit limits and resource bounds;
- sparse normalized rotation deltas;
- compact convergence, reach and limit evidence; and
- one semantic acceptance outcome.

The host retains:

- FABRIK and analytic working positions;
- segment-length and quaternion working arrays;
- iteration state and yielding promises;
- abort controllers;
- PlayCanvas entities and transforms;
- animation mixers, deformation buffers and GPU resources; and
- any frame-hot preview state.
