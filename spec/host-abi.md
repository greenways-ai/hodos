# Browser–Hara Host ABI

The Host ABI is the central Hodos interoperability contract. It connects
semantic Hara execution to capabilities implemented by a web host or another
conforming environment.

## Processing cycle

```text
Host observation
      ↓
Hodos event
      ↓
Hara world logic
      ↓
Hodos effect request
      ↓
grant, scope, and quota check
      ↓
Host operation
      ↓
result, progress, cancellation, or error event
```

The host is responsible for scheduling, resource ownership, permission prompts,
and translating browser API behavior into stable Hodos messages.

## Events

Events are observations delivered to Hara:

```clojure
{:hodos/message :event
 :message/id "msg:input-91"
 :session/id "session:main"
 :message/body
 {:event/type :input/intent
  :actor/id "actor:guest"
  :intent/type :inspect
  :intent/target "affordance:archive-door"
  :intent/input {:kind :pointer :button :primary}}}
```

Raw device events MAY be exposed by an input profile, but world behavior SHOULD
prefer semantic intents.

## Effects

Effects are requests from Hara to the host:

```clojure
{:hodos/message :effect/request
 :message/id "msg:audio-12"
 :session/id "session:main"
 :message/body
 {:effect/capability :audio/output
  :effect/operation :audio/play
  :effect/arguments
  {:resource/id "resource:ambient-garden"
   :gain 0.75
   :space/id "main"
   :position [4.0 1.2 -3.0]}}}
```

The host replies using `:effect/result`, `:effect/progress`,
`:effect/cancelled`, or `:effect/error`, correlated through
`:message/reply-to`.

## Handles

A handle represents a host-owned resource:

```clojure
{:handle/id "handle:audio/91"
 :handle/type :audio/playback
 :handle/scope :session}
```

Handles are opaque. Hara MAY pass them back to operations defined for their
type, but MUST NOT infer implementation details from their text.

## Ordering and reentrancy

Each session has a monotonically increasing sequence. The host MUST preserve
event order within a session. Long-running effects MUST not block unrelated
events. An implementation MUST define whether effects can complete
reentrantly; the recommended web profile always posts completions through the
session queue.

## Cancellation

Effect requests MAY include a cancellation scope or deadline. Closing a world
automatically cancels unresolved world-scoped effects and releases its handles.

## Security boundary

The host MUST validate every effect against the current grant, scope, quota,
world identity, actor authority, and handle ownership. The Hara program is not
trusted merely because it was loaded successfully.
