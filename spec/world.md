# Hodos World

The World specification defines a source-neutral, renderer-neutral world
manifest and its relationship to Hara packages.

## Separation from project packaging

Hara project metadata and world metadata have different responsibilities:

```text
project.edn       build, package, source paths, dependencies, recipes
world.edn         world identity, entry point, resources, spaces, state, capabilities
project.lock.edn  exact package and resource resolution
```

A repository MAY contain all three files. A bundle or network source MAY expose
the same information through another container, provided the resolved
`world.edn` value is equivalent.

## Minimal world

```clojure
{:hodos/type :world
 :hodos/version "0.1.0"

 :world/id "greenways-worlds/splat-garden"
 :world/version "1.2.0"
 :world/title "Splat Garden"

 :world/entry
 {:hara/module "world.main"
  :hara/function "start"}

 :world/capabilities
 {:required #{:input/pointer :graphics/scene}
  :optional #{:audio/output :storage/persistent}}

 :world/resources
 {"garden"
  {:resource/uri "assets/garden.sog"
   :resource/media-type "model/vnd.hodos.sog"
   :resource/integrity "sha256-..."}}

 :world/spaces
 {"main"
  {:space/units :metre
   :space/up-axis :y
   :space/handedness :right}}

 :world/state
 {:state/schema "state/schema.edn"
  :state/initial "state/initial.edn"
  :state/persistence :world-local}}
```

## Resources

Core does not prescribe model, image, audio, video, script, or scene formats.
A resource descriptor SHOULD include:

- a URI or bundle-relative path;
- a media type;
- an integrity digest for immutable use;
- an optional byte length;
- variants and dependencies;
- a cache and retention policy;
- an optional human-readable label.

A source adapter resolves bytes. A renderer or media adapter interprets them.
World logic refers to the stable resource identifier.

## Spaces and coordinates

A spatial profile defines coordinate systems explicitly. A space declaration
SHOULD specify units, handedness, up axis, origin, and parent space. Portals and
imports MUST include the transform between spaces rather than assuming one
engine's defaults.

## Modules and entry points

The canonical world entry point is a Hara module/function pair. Entering a
world creates or attaches to a long-lived Hara session and sends a
`:world/enter` event containing the actor, negotiated profile, initial space,
and granted capabilities.

World modules MUST use the Host ABI for effects. They do not receive ambient
browser or engine access.

## State

The manifest distinguishes:

- immutable definition state;
- mutable shared world state;
- actor-local state;
- device-local preferences;
- editor or tool state;
- ephemeral projection state.

A persistence policy names the class of storage required, not a particular
browser database or cloud vendor.

## Composition

A world MAY import another world, scene, package, or resource graph by immutable
reference. Composition MUST preserve world identity and MUST NOT merge
capabilities implicitly. Imported content receives only the authority granted
to its declared scope.
