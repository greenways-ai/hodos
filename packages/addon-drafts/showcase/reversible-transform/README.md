# Transform and undo a world draft

This complete Hara project makes the draft transition visible as a graph:

1. an exact world identity opens revision 0;
2. one two-object transform produces revision 1;
3. scene and storage effects remain closed values for the host;
4. one undo restores the prior entity content at revision 2.

The Showcase does not write storage. It inspects the candidate state and the
effect plan that a trusted host may choose to execute.
