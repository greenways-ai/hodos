# Mixamo characters in Hodos

Hodos treats Mixamo as a recognizable humanoid animation family rather than as
a runtime file format.

```text
Mixamo character or animation download
  -> deterministic FBX-to-glTF/GLB conversion
  -> immutable asset identity
  -> portable Mixamo skeleton profile
  -> PlayCanvas character host
  -> Hodos character sequence
```

The browser host deliberately accepts `model/gltf-binary` and
`model/gltf+json`. Raw FBX or DAE conversion belongs in an import, build, or
publication workflow where the converter version and output identity can be
recorded. It is not hidden inside animation playback.

## Portable profile

`@greenways/hodos-world-model/mixamo` exports a renderer-neutral profile:

```js
import {
  inspectMixamoSkeleton,
  createMixamoRetargetPlan,
} from "@greenways/hodos-world-model/mixamo";

const profile = inspectMixamoSkeleton(nodes, {
  id: "character/guest/mixamo",
  assetId: "sha256:...",
  mediaType: "model/gltf-binary",
});
```

The profile:

- recognizes `mixamorig:` names, path-qualified names, and namespace-stripped
  glTF conversions;
- requires the core hips, spine, head, arm, hand, leg, and foot chains;
- records optional toe and finger chains without requiring them;
- rejects duplicate canonical joints and missing core joints;
- returns bounded warnings and errors rather than decoded mesh or animation
  arrays; and
- remains JSON-portable and independent of PlayCanvas entities.

`createMixamoRetargetPlan` creates a deterministic same-family path map between
two accepted profiles. This first contract copies local joint rotations, uses
the target rest scale, and restricts translation to hips when root motion is
enabled. It does not pretend to solve arbitrary humanoid rest-pose or proportion
retargeting.

## PlayCanvas host

`@greenways/hodos-renderer-playcanvas/mixamo` owns loaded entities,
`AnimComponent` instances, and `AnimTrack` values:

```js
import { createPlayCanvasMixamoCharacterHost } from
  "@greenways/hodos-renderer-playcanvas/mixamo";
import { createPlayCanvasSequenceHost } from
  "@greenways/hodos-renderer-playcanvas/sequence";

const mixamo = createPlayCanvasMixamoCharacterHost();

mixamo.register(characterEntity, {
  id: "guest",
  assetId: "sha256:character...",
  clips: {
    idle: { state: "Idle", duration: 2.1, loop: true },
    walk: { state: "Walk", duration: 0.9, loop: true },
  },
});

const sequence = createPlayCanvasSequenceHost({
  app,
  ...mixamo.sequenceOptions(),
});
```

An animation-only asset can be assigned after PlayCanvas has loaded its
`AnimTrack`:

```js
mixamo.assignClip("guest", "wave", waveTrack, {
  state: "Wave",
  resourceId: "sha256:wave...",
  loop: false,
});
```

The host supplies entity resolution and clip duration to the existing character
sequence executor. It does not introduce another timeline or playback loop.
Released host-owned clips are removed from the animation component, references
are discarded, and portable descriptors retain only identities and bounded
evidence.

## Recommended import workflow

A production import workflow should checkpoint these semantic boundaries:

```text
source download accepted
  -> converter selected
  -> GLB emitted
  -> GLB validated and reloaded
  -> Mixamo skeleton profile accepted
  -> clips inventoried and named
  -> previews rendered
  -> asset and profile published
```

The conversion step should capture at least:

- exact source identity;
- converter name and version;
- coordinate, scale, texture, and animation options;
- output GLB identity;
- retained or stripped Mixamo namespace policy; and
- validation and preview evidence.

This makes the same character usable by PlayCanvas, Alumbra, offline publishing
workers, and later Hodos retargeting tools without making Adobe FBX parsing part
of the Hodos runtime contract.
