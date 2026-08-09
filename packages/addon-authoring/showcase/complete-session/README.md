# Author a world as one semantic session

This complete Hara project presents the full portable authoring sequence:

1. commit a normalized authoring document;
2. select two entities;
3. transform both in one transaction;
4. undo and redo the transaction as one history boundary;
5. update pivot, snapping, isolation and timeline state;
6. emit one bounded Hara script request.

The Showcase does not select a renderer, evaluate the script or persist the
candidate draft. Those remain explicit host capabilities.
