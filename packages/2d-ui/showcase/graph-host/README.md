# Safe Graph DOM/SVG host Showcase

A complete Hara project for the `greenways/hodos-2d-ui` Graph host.

The `graph` surface demonstrates stable graph identity and the selection/drag
boundary: selection is canonical, drag feedback is transient, and one semantic
move event is emitted on release. The named Gallery state is
`../states/graph-host-selected.edn`.

Connection creation, deletion, and commands remain disabled, so the story
cannot expand its own capabilities.
