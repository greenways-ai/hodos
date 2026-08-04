# @greenways/hodos-source-github

GitHub-backed world discovery and immutable repository graph resolution for
Hodos. It validates `project.edn`, resolves recursive world imports, and emits
asset URLs pinned to commit identities.

The add-on requires the host capability `network.github` and contributes
`world.source/github`.
