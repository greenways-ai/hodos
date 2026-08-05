# Hodos Web3 profile

The Web3 profile standardizes chain-aware identity and actions without making a
blockchain, token, wallet, or economic system mandatory for a Hodos world.

## Scope

The profile defines:

- chain identifiers;
- account identifiers;
- wallet/provider session discovery;
- explicit account access;
- typed signing requests;
- transaction requests and lifecycle events;
- asset references;
- verifiable receipts.

Private keys, seed phrases, unrestricted wallet providers, and custody objects
MUST NOT cross the Host ABI.

## Identifiers

Implementations SHOULD use chain-agnostic identifiers where available:

```text
chain:   eip155:1
account: eip155:1:0x...
```

The exact standards adopted by a stable profile revision will be listed in its
normative references. Adapters MAY support Ethereum, other chains, or non-chain
signing systems while presenting the same Hodos capability boundary.

## Capabilities

### Chain read

`:chain/read` permits bounded read-only queries on declared chains and methods.

### Account access

`:wallet/account` requests one or more explicit accounts. A grant MUST identify
the selected accounts and chains and MUST be revocable.

### Signing

`:wallet/sign` requests a typed or explicitly labelled payload:

```clojure
{:effect/capability :wallet/sign
 :effect/operation :wallet/sign
 :effect/arguments
 {:chain/id "eip155:1"
  :account/id "eip155:1:0x..."
  :sign/method :personal-sign
  :sign/payload "0x..."
  :sign/purpose "Publish a Hodos world receipt"}}
```

The host MUST present enough context for meaningful user consent. Generic
opaque signing SHOULD be disabled unless an adapter profile explicitly permits
it.

### Transactions

`:wallet/transact` requests construction, review, submission, and tracking of a
transaction. Submission is a separate user-authorized step from preparation.
The world receives transaction identifiers and state changes, never signing
material.

## Receipts

A Web3 receipt can attach signatures or immutable chain references to the Core
receipt format. Chain anchoring proves inclusion or ordering according to the
selected chain; it does not by itself prove that the underlying world action was
correct, fair, or authorized.

## Non-goals

The profile does not define token economics, marketplaces, NFTs, governance,
asset custody, legal ownership, or a universal reputation system. Those systems
can be built above the profile as world-specific applications.
