# Safe Document DOM host Showcase

A complete Hara project for the `greenways/hodos-2d-ui` Document host.

The `document` Workspace surface supplies the same bounded model consumed by the
package's safe DOM adapter. Selection and text editing are enabled; structural
mutation and artefact activation remain disabled. The named Gallery state is
`../states/document-host-editable.edn`.

The Packages origin does not render package HTML. It embeds the capability-gated
Playground host and displays source and state as inert text.
