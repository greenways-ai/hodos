# Mixamo characters in Hodos

Hodos treats Mixamo as a recognizable humanoid animation family rather than as
a runtime file format.

```text
Mixamo character or animation download
  -> deterministic FBX-to-glTF/GLB conversion
  -> immutable asset identity
  -> portable Mixamo skeleton profile
  -> PlayCanvas character loader and host
  -> Hodos character sequence
```

The browser host accepts `model/gltf-binary` and `model/gltf+json`. Raw FBX or
DAE conversion belongs in an import, build, or publication workflow where the
converter version and output identity can be recorded. It is not hidden inside
animation playback.

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

## Load a converted character

`@greenways/hodos-renderer-playcanvas/mixamo` can now load and own a converted
character directly. Construct the host with the running PlayCanvas application:

```js
import { createPlayCanvasMixamoCharacterHost } from
  "@greenways/hodos-renderer-playcanvas/mixamo";
import { createPlayCanvasSequenceHost } from
  "@greenways/hodos-renderer-playcanvas/sequence";

const mixamo = createPlayCanvasMixamoCharacterHost({ app });

const character = await mixamo.load(
  "https://cdn.example/characters/guest.glb",
  {
    id: "guest",
    assetId: "sha256:character...",
    renderOptions: {
      castShadows: true,
      receiveShadows: true,
    },
    autoplay: true,
  },
);

const sequence = createPlayCanvasSequenceHost({
  app,
  ...mixamo.sequenceOptions(),
});
```

The URL must be readable by the browser, including the required CORS headers
when it is hosted on another origin. Query strings may be used for the actual
request, but the portable character descriptor records only the query-free URL
so signed tokens are not retained as evidence.

The loader:

1. loads the source as a PlayCanvas `container` asset;
2. instantiates the container with `instantiateRenderEntity()`;
3. attaches the resulting hierarchy to `app.root` or a supplied parent;
4. validates the hierarchy as Mixamo-compatible;
5. creates an `AnimComponent` when the character does not already have one;
6. assigns embedded `AnimTrack` values using stable, URL-safe clip identifiers;
7. optionally starts a selected clip; and
8. returns the same portable character descriptor used by manually registered
   characters.

Embedded names such as `Idle`, `Walk Cycle`, and `Wave.Hand` become clip IDs
such as `idle`, `walk-cycle`, and `wave-hand`. Duplicate names receive stable
numeric suffixes within the loaded container.

## Load a local GLB

Local files never need to leave the device:

```js
const input = document.querySelector("input[type=file]");

input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file) return;

  const character = await mixamo.loadFile(file, {
    id: "local-guest",
    assetId: "sha256:...",
  });

  console.log(character.profile.status);
});
```

The same boundary accepts a `Blob`, `ArrayBuffer`, or typed-array view. Local
sources must be self-contained GLB files because a detached local `.gltf` file
cannot reliably resolve its external buffers and textures. The default local
source limit is 256 MiB and can be reduced with `maximumSourceBytes` when the
host is constructed. Temporary object URLs are always revoked after the
PlayCanvas load completes or fails.

## Use an existing PlayCanvas container asset

Applications that already manage their own PlayCanvas assets can pass a loaded
or loadable `container` asset:

```js
const character = await mixamo.load(containerAsset, {
  id: "managed-guest",
  attach: false,
});

sceneCharacterRoot.addChild(mixamo.resolveEntity(character.handle));
```

The instantiated entity belongs to the Mixamo host and is destroyed on
`release()`. The supplied container asset remains caller-owned and is not
removed from the PlayCanvas registry.

For URL and local-file loads, the host owns both the instantiated hierarchy and
the container asset. Releasing the character destroys the hierarchy and removes
the container asset, which unloads its renderer resources and embedded
animation assets:

```js
mixamo.release("guest");
```

A failed skeleton check, animation assignment, or autoplay request rolls back
both resources before the error is returned.

## Attach animation-only tracks

A converted character without embedded animation still receives an
`AnimComponent`, so animation-only Mixamo assets can be attached later:

```js
mixamo.assignClip("guest", "wave", waveTrack, {
  state: "Wave",
  resourceId: "sha256:wave...",
  loop: false,
});

mixamo.play("guest", "wave", { blend: 0.2 });
```

`loadUrl()` and `loadFile()` are convenience aliases for `load()`. The existing
`register()` method remains available when another part of the application has
already instantiated the entity hierarchy.

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
