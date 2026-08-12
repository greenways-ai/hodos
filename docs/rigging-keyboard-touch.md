# Rigging keyboard and touch authoring

The Hodos skeleton workbench treats keyboard, numeric and touch movement as
transient editing transactions. Canonical rig state changes only at a visible
commit boundary.

## Keyboard movement

With a joint selected:

```text
Arrow Left / Right   X axis
Arrow Up / Down      Y axis
Page Up / Down       Z axis
Alt + movement       fine step (one tenth)
Shift + movement     coarse step (ten times)
Shift + A / Insert   create a child joint
Escape               cancel the current preview
```

A held or repeated key sequence updates one renderer-local preview. Releasing
the final movement key commits one revision-checked `rig/joint-update` intent,
so undo shows one user-visible move rather than one entry per repeat event.

## Numeric movement

Position fields preview while their values are edited. `Enter` or the **Apply**
button commits one semantic move. `Escape` restores the canonical position.
Blur never commits implicitly.

## Touch movement

When the Move tool is active, the selected joint receives X, Y and Z projected
axis handles. Each handle has a 44 CSS-pixel minimum target, expands on coarse
pointer devices, captures its own pointer, and prevents the canvas orbit gesture
from starting. Pointer motion remains renderer-local; pointer release emits one
move intent and pointer cancellation restores canonical state.

## Accessibility

Selection, movement, cancellation, undo/redo restoration and rejected
operations are announced through a polite live region. Undo and redo restore the
portable editor focus and return DOM focus to the current hierarchy row.
Reduced-motion and forced-colour modes remove decorative movement and retain
visible handle and selection boundaries.
