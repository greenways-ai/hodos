# Hodos conformance

Conformance makes a world portable across implementations without requiring
every host to implement every profile.

## Conformance classes

### World document

A conforming world document:

- validates against a declared Hodos version;
- uses canonical identifiers and serializable values;
- declares required and optional capabilities;
- does not depend on undeclared extensions;
- provides integrity metadata where immutable resources are required.

### Hara runtime endpoint

A conforming runtime endpoint:

- accepts Core envelopes;
- preserves per-session ordering;
- emits only serializable events and effects;
- does not retain host objects in world state;
- handles cancellation, revocation, suspension, and closure.

### Host

A conforming host:

- negotiates required profiles before entry;
- denies undeclared authority;
- validates effect scope and handle ownership;
- releases resources at the end of their lifetime;
- returns stable errors instead of leaking host exceptions.

### Adapter

A conforming adapter implements one named contribution—such as source,
renderer, storage, audio, device, or wallet—without changing Core semantics.

## Levels

| Level | Requirement |
|---|---|
| Core | Core envelopes, lifecycle, errors, and serialization |
| World | Core plus World manifest resolution and entry |
| Interactive | World plus Engagement and at least one input and feedback profile |
| Persistent | Interactive plus one persistence profile and recovery fixtures |
| Networked | Interactive plus a negotiated network/session profile |
| Web3 | World plus the Web3 profile capabilities claimed by the implementation |

An implementation advertises exact profiles and versions in addition to its
level.

## Negotiation

Before `:world/enter`, the host and world resolve:

- Hodos Core version;
- required and optional profiles;
- capability availability;
- permission and user-gesture requirements;
- quotas and limits;
- unsupported required extensions.

Failure to satisfy a required profile prevents entry and produces a structured
conformance error.

## Test suite direction

The conformance package will contain:

- canonical encoding fixtures;
- valid and invalid world manifests;
- event/effect transcript fixtures;
- lifecycle and cancellation traces;
- capability revocation tests;
- handle ownership tests;
- engagement tests across different input projections;
- profile-specific tests.

Reference packages in this repository SHOULD run the same public fixtures used
by third-party implementations.
