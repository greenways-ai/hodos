# Isolated preview host

This story exercises the Playground's injected Preview host.

The UI adapter receives a bounded preview model and manages the host lifecycle.
The product supplies the renderer, iframe or sandbox and remains responsible
for CSP, resources, execution and navigation policy.
