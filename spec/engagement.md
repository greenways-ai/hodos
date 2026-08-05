# Hodos engagement

Engagement defines how people, agents, and devices participate in a world
without tying world behavior to one renderer or input method.

## Semantic sequence

```text
Actor
  perceives an affordance
  expresses an intent
  the world authorizes an action
  the host performs effects
  the actor receives feedback
  and optionally a receipt
```

## Actors

An actor is a participant with a session-scoped identity and declared roles. An
actor MAY represent:

- a person;
- a guest browser session;
- an authenticated account;
- an autonomous or supervised agent;
- a device;
- a group or delegated role.

Identity proof and account systems are profiles. Core engagement requires only
an opaque actor identifier and the authority attached to it.

## Affordances

An affordance advertises possible engagement:

```clojure
{:affordance/id "affordance:garden/open-studio"
 :affordance/intents #{:open}
 :affordance/target "entity:studio-console"
 :affordance/bounds
 {:shape :sphere
  :space/id "main"
  :position [2 1 -4]
  :radius 0.5}
 :affordance/presentations
 #{:world/marker :ui/label :audio/cue}
 :affordance/action :studio/open}
```

Bounds and presentations are optional projections. The semantic action remains
available to non-visual clients when policy permits.

## Intents

An intent describes what an actor asks to do: enter, leave, inspect, open,
close, activate, take, place, move, speak, follow, invite, publish, sign,
purchase, or another namespaced operation.

Pointer clicks, touch, gaze, keyboard, voice, controller input, accessibility
switches, and agent commands can all emit the same intent.

## Actions

An action is a world-authorized state transition. Hara evaluates the intent
against world state, actor authority, rules, and required capabilities. An
action can emit zero or more effects and semantic events.

## Feedback

Feedback is the actor-facing consequence of an action. It MAY be spatial,
visual, audible, haptic, textual, or programmatic. A conforming world SHOULD
provide a non-spatial fallback for essential actions.

## Portals

A portal is a typed transition to another world, space, application surface, or
session. A portal descriptor states the target, transition intent, identity
continuity, state handoff, and capability renegotiation policy. Authority never
crosses a portal implicitly.

## Receipts

A receipt records an action when auditability matters:

```clojure
{:receipt/id "receipt:01J..."
 :receipt/action "action:publish-4"
 :receipt/actor "actor:alice"
 :receipt/world "world:greenways/splat-garden"
 :receipt/time "2026-08-05T00:00:00Z"
 :receipt/digest "sha256-..."
 :receipt/signatures []}
```

Signing and chain anchoring are optional profiles. Unsigned local receipts are
still useful for deterministic replay and debugging.
