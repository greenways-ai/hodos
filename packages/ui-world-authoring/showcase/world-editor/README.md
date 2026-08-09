# Author a small Hodos world

This complete Hara project declares the `hodos.world/authoring` Workspace
component. The model is an ordinary world state value; the browser host supplies
the actual `WorldEditorWorkspace` and receives a closed set of semantic events.

The component does not gain renderer, storage, script-evaluation or publication
authority from its identifier. Those services remain explicitly injected by the
embedding host.
