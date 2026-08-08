# Desktop Workspace shell Showcase

A complete Hara project for the desktop `greenways/hodos-workspace-ui` story.

`workspace.edn` declares a recursive Files → Code → Preview split and the same
responsive surface identities consumed by the package shell. The named Gallery
state is `../states/desktop.edn`.

The Canvas presents the semantic layout as a Hara value. The Package Gallery
does not mount package JavaScript in its own origin; the Source panel points to
the actual shell implementation.
