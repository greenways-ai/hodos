# Inspectable document Showcase

A complete Hara project for the `greenways/hodos-2d` Document view.

The visible `document` surface is declared in `workspace.edn`. Its component
model contains stable document, block, text and artefact IDs plus a bounded set
of semantic events. The named Gallery state is
`../states/document-default.edn`.

The Package Gallery opens this directory at the exact publication commit. It
passes no source text, component constructor, state payload or capability grant
through the iframe protocol.
