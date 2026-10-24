# Tool registry replay fixture

`cases.json` is a neutral replay description. The TypeScript registry executes
the cases and generates `expected.json`; the TypeScript test checks that this
checked-in transcript is fresh, and the Python pytest reads the same two files
and replays equivalent native handlers. The comparison keeps contract fields
exact and contains no host timestamps or runtime-specific identifiers.

Regenerate the transcript after a deliberate TypeScript contract change:

```sh
node --experimental-strip-types scripts/python-registry-conformance.ts \
  conformance/tool-registry/expected.json
```

The fixture intentionally covers only the shared unary/streaming surface:
sync and awaitable results, progress plus result events, input rejection,
handler errors, and missing tools. Duplex input, metrics, receipts, source
catalogs, and transport framing remain host-specific and are not represented as
cross-runtime claims. The replay also includes a malformed authorization
decision and an approval-required result with deterministic request metadata.
