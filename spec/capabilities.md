# Hodos capabilities

Capabilities describe semantic authority exposed by a host. They are not direct
aliases for JavaScript globals or browser API object graphs.

## Capability states

```text
unavailable
available → requested → granted
                    ↘ denied
granted → restricted → revoked
```

Availability does not imply permission. A host MAY support a capability while
requiring an explicit user gesture or permission prompt before granting it.

## Descriptor

```clojure
{:capability :storage/persistent
 :capability/version "0.1.0"
 :capability/state :granted
 :capability/scope
 {:world/id "world:greenways/splat-garden"
  :quota/bytes 268435456}
 :capability/lifetime :session}
```

A grant MUST define its owner, scope, and lifetime. Capabilities MUST be denied
by default when not declared or negotiated.

## Initial registry

| Domain | Capability families |
|---|---|
| Graphics | `:graphics/canvas-2d`, `:graphics/scene`, `:graphics/compute`, `:xr/session` |
| Input | `:input/pointer`, `:input/keyboard`, `:input/gamepad`, `:input/xr`, `:input/midi` |
| Devices | `:device/hid`, `:device/serial`, `:device/bluetooth`, `:device/sensors` |
| Audio | `:audio/output`, `:audio/spatial`, `:audio/capture`, `:audio/decode` |
| Video | `:video/output`, `:video/capture`, `:video/decode`, `:display/capture` |
| Storage | `:storage/session`, `:storage/key-value`, `:storage/blob`, `:storage/files`, `:storage/persistent` |
| Network | `:network/fetch`, `:network/socket`, `:network/datagram`, `:network/peer` |
| Trust | `:crypto/digest`, `:crypto/sign`, `:identity/credential` |
| Web3 | `:chain/read`, `:wallet/account`, `:wallet/sign`, `:wallet/transact` |

Profiles define operations, arguments, results, and scope fields for each
capability.

## Scope examples

```clojure
{:capability :network/fetch
 :scope {:origins #{"https://assets.greenways.ai"}
         :methods #{:get}
         :max-response-bytes 16777216}}
```

```clojure
{:capability :audio/capture
 :scope {:channels 1
         :sample-rate/max 48000}
 :lifetime :gesture}
```

```clojure
{:capability :wallet/sign
 :scope {:chains #{"eip155:1"}
         :methods #{:personal-sign}
         :account-use :explicit}}
```

## Change events

The host emits `:capability/changed` whenever availability, permission, scope,
quota, or lifetime changes. Hara world logic MUST tolerate revocation and MUST
release dependent handles when instructed.

## Delegation

A world MAY delegate a strict subset of one of its grants to an imported module
or embedded world. Delegation MUST NOT widen origins, methods, quotas, actors,
chains, devices, or lifetime.
