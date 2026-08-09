# Inspect deterministic Hara execution

This complete project is the Canvas for the `Execution` package story.

The source expression is:

```clojure
(+ 1 (* 2 3))
```

Its checked-in evidence ends with the result `7`. The story is deliberately
inert: it contains serializable metrics, compact events and bounded trace
snapshots, but it never instantiates Hara, Wasm, a machine, a session or a
promise. Start, Step, Run, Pause, Resume, Reset and Full trace remain semantic
requests for the embedding application.

Named states cover idle, running, paused, suspended, returned, failed,
bounded/omitted and compact presentations. Selecting a source-bearing boundary
must emit both `execution/select` and the application-routed
`editor/selection`; Hodos never edits the source directly.
