# Hodos Tahto source

This optional source stores and retrieves Hodos world values through a trusted
Greenways OS Tahto capability broker. It never receives a node origin, private
key, invitation, credential, or raw authorization header.

Reads require `tahto/read`. Preparing and submitting changes require
`tahto/write`; a prepared plan is inert and submission remains explicit.
