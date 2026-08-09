# Inspect a nested retained value

This complete project mounts `hodos.dev/value-inspector` over bounded
serializable data. The selected path and expansion state are explicit values;
copy, refresh, close and navigation remain semantic requests.

The inspector never owns the retained runtime value. Namespace, source and
request identity remain application-provided context.
