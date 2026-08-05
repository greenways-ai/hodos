# Hodos Core

Hodos Core defines the common vocabulary used by every other Hodos
specification and profile.

## Scope

Core standardizes:

- versioned document and message envelopes;
- world, actor, session, resource, message, action, and handle identifiers;
- canonical serializable values;
- timestamps, sequence numbers, correlation, and causality;
- extension namespaces;
- error and cancellation envelopes;
- the minimum world-session lifecycle.

Core does not standardize rendering, physics, asset formats, transport
protocols, wallets, or user interfaces.

## Canonical values

A Core value MUST be representable without retaining a host-language object.
The portable value set consists of:

- null;
- booleans;
- finite numbers;
- UTF-8 strings;
- keywords and symbols with a canonical string representation;
- ordered vectors;
- maps with canonical string or keyword keys;
- sets with a deterministic canonical ordering for hashing;
- bounded byte sequences where a profile permits them;
- typed identifiers and opaque handles represented as strings.

DOM nodes, functions, promises, GPU resources, audio nodes, media streams,
filesystem handles, cryptographic keys, wallet providers, and engine entities
MUST NOT cross the ABI.

## Envelope

Every cross-boundary message has a common envelope:

```clojure
{:hodos/message :effect/request
 :hodos/version "0.1.0"
 :message/id "msg:01J..."
 :message/time "2026-08-05T00:00:00Z"
 :session/id "session:01J..."
 :world/id "world:greenways/splat-garden"
 :message/sequence 42
 :message/reply-to nil
 :message/body {...}}
```

A conforming implementation MUST reject an unsupported major version. It MAY
accept a newer minor version when all unknown fields are namespaced extensions
and can be ignored safely.

## Identifiers

Identifiers are opaque to consumers even when their textual form is readable.
Recommended prefixes include:

```text
world:
session:
actor:
resource:
handle:
message:
action:
receipt:
portal:
```

Identity equivalence is exact string equality unless a profile explicitly
defines canonicalization.

## Lifecycle

The minimum lifecycle is:

```text
discovered → resolving → ready → entering → active
                                      ↓
                         suspended → resuming
                                      ↓
                                  leaving → closed
```

A fatal error transitions the session to `failed`, after which the host MUST
release all world-scoped handles and grants.

## Errors

Errors are values, not thrown host objects:

```clojure
{:error/code :capability/denied
 :error/message "Persistent storage was not granted"
 :error/retryable false
 :error/details {:capability :storage/persistent}}
```

Core reserves the `:hodos/*`, `:world/*`, `:session/*`, `:actor/*`,
`:message/*`, `:resource/*`, `:effect/*`, `:action/*`, `:capability/*`,
`:affordance/*`, and `:error/*` namespaces.

## Extensions

An extension MUST use an owned namespace, for example
`:org.example.weather/pressure`. Required extensions MUST be declared during
profile negotiation. Optional unknown extensions MUST be ignored without
changing the meaning of known fields.
