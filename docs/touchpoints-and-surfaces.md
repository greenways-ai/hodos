# Hodos touchpoints and surfaces

Touchpoints connect spatial objects to classical web interfaces. They are data,
not executable HTML.

## World declaration

A repository world can declare touchpoints in `project.edn` after requesting
`:ui/dom-surface`:

```clojure
{:project/capabilities
 [:canvas/webgl2 :input/pointer :ui/dom-surface]

 :project/world
 {:world/version "1.0.0"
  :world/layers [...]
  :world/imports []

  :world/touchpoints
  [{:touchpoint/id mixing-desk
    :touchpoint/label "Open Studio"
    :touchpoint/position [1.4 0.9 -2.1]
    :touchpoint/radius 0.7
    :touchpoint/surface hodos/studio
    :touchpoint/presentation :focus-overlay
    :touchpoint/config {:project "local/current"}}]}}
```

Supported anchors are `:world` and `:scene-center`. `:scene-center` is useful for
host-injected development touchpoints; repository worlds should normally use an
explicit world position. Imported touchpoints inherit the import transform
chain.

The viewer presents a projected button and also tests the declared sphere
against a canvas click ray. This lets a Gaussian-splat region behave like an
interactive object even though SOG does not expose a semantic object tree.

## Hara session event

Activation is sent to the kernel as data:

```clojure
{"event/type" "touchpoint/activate"
 "touchpoint"
 {"id" "mixing-desk"
  "surface" "hodos/studio"
  "presentation" "focus-overlay"
  "config" {"project" "local/current"}}}
```

The persistent Hara session records the active surface and returns:

```clojure
{"state" {...}
 "effects"
 [{"effect" "ui"
   "method" "open-surface"
   "args"
   [{"id" "hodos/studio"
     "title" "Open Studio"
     "presentation" "focus-overlay"
     "touchpoint" "mixing-desk"
     "config" {"project" "local/current"}}]}]}
```

Closing the interface is another event, `surface/close`, rather than a direct
DOM mutation. The resulting `ui/close-surface` effect unmounts the host surface.

## Trusted surface registry

The viewer host registers application factories explicitly:

```js
const viewer = createHodosViewer({
  root,
  invoke: invokeHodos,
  surfaces: {
    "hodos/studio": createStudioSurface,
  },
});
```

An unregistered surface ID fails closed. World repositories cannot provide a
factory, script tag, or arbitrary HTML body.

A surface receives:

```js
{
  root,          // DOM node owned by the host
  descriptor,    // Hara-approved surface descriptor
  dispatch,      // semantic event -> Hara session
  requestClose,  // dispatches surface/close
}
```

It may return a controller with `update(state)`, `handleEffect(effect)`, and
`destroy()` methods. Decorators can add capabilities such as bundle import,
command history, clip editing, track creation, or world placement without
changing the generic viewer.

## Dragging surface values into the world

Trusted surfaces can write a bounded JSON envelope to the generic
`application/x-hodos-world-payload` drag type. During the drag the surface
narrows so the world canvas can receive the drop. The renderer resolves a world
position and dispatches:

```clojure
{"event/type" "world/drop"
 "payload" typed-surface-value
 "position" [x y z]}
```

The viewer does not interpret application-specific payload fields. Hara decides
whether the type is supported, validates references, updates world state, and
emits scene/audio effects. Studio track and clip placement are documented in
[`spatial-audio.md`](spatial-audio.md).

This preserves the same trust boundary as touchpoints:

```text
3D or 2D gesture
    ↓
serializable semantic event
    ↓
Hara state transition
    ↓
capability-scoped host effects
```

## State boundary

Hara stores serializable logical state:

- active world and touchpoint;
- active surface;
- Studio project, assets, tracks, clips, transport, selection, history and
  revision;
- world spatial-source identity, position and play state.

The host stores non-serializable runtime objects:

- PlayCanvas entities and projected DOM markers;
- `File`, `ArrayBuffer`, `AudioBuffer`, `AudioNode`, `PannerNode`, and GPU
  objects;
- OPFS handles, decoded waveform data, and the sample-accurate audio clock.

Imported audio bytes are content-addressed in OPFS and the serializable project
is restored into Hara. The world can request installed applications and receive
typed drag values, but cannot directly read browser storage, create Web Audio
nodes, or mutate the DOM.
