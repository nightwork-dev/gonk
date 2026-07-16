# @gonk/context

Authorized, deterministic context compilation for Gonk hosts.

`@gonk/context` accepts a compile request, asks registered in-process
contributors for serializable candidate descriptors, authorizes discovery
before resolving hidden content, authorizes use against the authoritative
resolved resource, deduplicates and budgets deterministically, and returns a
compiled artifact plus a content-free domain receipt.

Phase 0 is a pure library. It does not install host hooks, mutate prompts,
search retrieval stores, manage skills, or implement a template language.

## Install

```sh
npm i @gonk/context @gonk/auth
```

## Example

```ts
import type { AuthContext } from "@gonk/auth";
import {
  ContextCompiler,
  ContextContributorRegistry,
} from "@gonk/context";

const registry = new ContextContributorRegistry();

registry.register({
  id: "project-notes",
  discover: () => [{
    candidateId: "architecture",
    contributorId: "project-notes",
    resourceKey: "note:architecture",
    revisionHint: "7",
    necessity: "required",
    priority: 100,
    estimatedTokens: 80,
    estimateQuality: "fallback",
  }],
  resolve: ({ candidate }) => ({
    candidateId: candidate.candidateId,
    contributorId: candidate.contributorId,
    resourceKey: candidate.resourceKey,
    revision: "8",
    necessity: candidate.necessity,
    priority: candidate.priority,
    audience: "model",
    content: "Use the shared authorization substrate.",
    resource: {
      kind: "application:project-note",
      target: candidate.resourceKey,
      scope: "project",
    },
  }),
});

const auth: AuthContext = {
  principal,
  authorize: ({ action, resource }) => policy.decide(action, resource),
};

const compiler = new ContextCompiler({ registry });
const result = await compiler.compile({
  requestId: "turn-42",
  auth,
  audience: "model",
  model: "provider/model-id",
  maxTokens: 500,
});

if (result.status === "blocked") {
  // Never send a partial artifact from a blocked compile.
  throw new Error("Required context could not be included");
}

sendToModel(result.content);
```

## Security boundary

Compilation uses the request's canonical `AuthContext` twice:

1. `context.discover` runs against a redacted `context-candidate` resource
   containing the candidate's canonical `resourceKey`. Denied candidates are
   never resolved.
2. The contributor's resolved value is validated as untrusted input, then
   `context.use` runs against its authoritative `AuthzResource` before content
   reaches token accounting or the compiled artifact.

Optional discovery denials are absent from caller-visible receipts, so adding a
hidden corpus cannot change visible ordering, budget allocation, counts, or
receipt bytes. A denied or failed required/pinned candidate returns `blocked`.

## Determinism

Contributor selection, candidate validation, authorization, canonical-resource
deduplication, ordering, and budget selection use stable lexical and numeric
tie-breaks. Registration order and contributor result order do not affect the
result.

Canonical `resourceKey` identity, not candidate ID or content equality, drives
deduplication. Selection order is pinned, required, then optional; within those
groups, higher priority wins before lexical contributor and candidate IDs.

## Token accounting

Inject a `ContextTokenCounter` for provider/model-aware or exact accounting.
The optional opaque `model` from the compile request is forwarded only to that
counter. The built-in fallback estimates `ceil(content.length / 4)` and marks
its quality as `fallback`.

The compiler counts both content and the rendered segment, including the
canonical two-newline separator. It separately recounts the full combined
artifact for the authoritative budget total.

## Runtime schemas

Every public request/result boundary exports a Standard Schema validator:

- `contextCompileRequestSchema`
- `contextCandidateSchema`
- `resolvedContextCandidateSchema`
- `contextDiscoveryRequestSchema`
- `contextResolutionRequestSchema`
- `contextTokenCountSchema`
- `compiledContextBlockSchema`
- `contextCompilationReceiptSchema`
- `contextCompileResultSchema`

Protocol discriminants are closed. Boundary validators reject unknown top-level
fields, including free-form filter or policy bags.

## Receipts

`ContextCompilationReceipt` is a context-domain receipt, not a generic receipt
or an extension of `SecurityReceiptBase`. It records request/config/compiler
identity, selected resource keys and authoritative revisions, token counts and
quality, structured drops, blockers, and outcome. It contains no candidate
content, authorization metadata, or security-context keys. Authorization audit
remains the auth substrate's separate responsibility.

## Deferred beyond Phase 0

- template/Jinja rendering;
- remote contributor registration;
- tool, MCP, or HTTP projection;
- prompt mutation and host lifecycle hooks;
- persona/knowledge parity migration;
- retrieval and skill contributor adapters;
- generic registry or receipt packages.

## License

Apache-2.0.
