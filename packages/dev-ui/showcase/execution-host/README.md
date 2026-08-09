# Inspect the Execution DOM host

This package story exercises the trusted, product-neutral Execution adapter with
checked-in serializable evidence for `(+ 1 (* 2 3)) → 7`.

The host owns only DOM rendering, listeners and semantic request dispatch. It
never compiles source, loads Hara or Wasm, stores a machine/session object, or
settles a promise. Repeated model updates replace owned DOM and listeners;
disposal aborts listeners and removes owned nodes.

Timeline selection emits `execution/select` and, for a source-bearing boundary,
an application-routed `editor/selection`. Desktop and compact demos use the same
host and shipped `execution.css` rules.
