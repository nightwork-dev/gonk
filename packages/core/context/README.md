# @gonk/context

Build the context you send to a model from many sources, with authorization
and a token budget. Sources register as contributors. For each request, the
compiler asks every contributor what it could add, checks which items the
caller may see and use, removes duplicates, fits the result into the budget,
and returns the compiled text with a receipt of what it included and why.

The result is deterministic: the same inputs always give the same output, in
the same order. Authorization uses an `AuthContext` from
[`@gonk/auth`](https://www.npmjs.com/package/@gonk/auth).
[`@gonk/skills`](https://www.npmjs.com/package/@gonk/skills) provides a
contributor for activated skills.

## Install

```sh
npm install @gonk/context @gonk/auth
```

## Quick start

```ts
import { ownerPrincipal } from "@gonk/auth";
import { ContextCompiler, ContextContributorRegistry } from "@gonk/context";

const registry = new ContextContributorRegistry();

registry.register({
  id: "project-notes",
  // Step 1: describe what you could add, without the content.
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
  // Step 2: load the content of a candidate that passed discovery.
  resolve: ({ candidate }) => ({
    candidateId: candidate.candidateId,
    contributorId: candidate.contributorId,
    resourceKey: candidate.resourceKey,
    revision: "8",
    necessity: candidate.necessity,
    priority: candidate.priority,
    audience: "model",
    content: "Services talk to each other only through the message queue.",
    resource: {
      kind: "application:project-note",
      target: candidate.resourceKey,
      scope: "project",
    },
  }),
});

const compiler = new ContextCompiler({ registry });
const result = await compiler.compile({
  requestId: "turn-42",
  auth: ownerPrincipal(process.env), // a real host builds this from its own login and policy
  audience: "model",
  maxTokens: 500,
});

if (result.status === "blocked") {
  // A blocked compile has no sendable content. Never send a partial result.
  throw new Error("Required context could not be included");
}

console.log(result.content);
// → "Services talk to each other only through the message queue."
```

## How a compile works

1. The compiler captures and freezes the request and its `AuthContext` before
   it calls any contributor.
2. Each contributor returns candidate descriptions. For each candidate, the
   compiler checks for an explicit exclusion and authorizes `context.discover`.
   A denied candidate is never resolved.
3. The compiler resolves each allowed candidate, validates the result as
   untrusted input, and authorizes `context.use` against the resolved
   resource.
4. It removes duplicates by `resourceKey`, orders the candidates, and selects
   them within `maxTokens`.

Candidates are ordered pinned first, then required, then optional. Inside each
group, higher `priority` comes first, then contributor and candidate IDs in
lexical order. Registration order does not change the result.

If a required or pinned candidate is excluded, denied or fails, the result is
`blocked` and carries no content. Optional candidates that the caller may not
discover do not appear in the receipt, so a hidden source cannot change what
the caller sees, including counts and order.

## Token counting

Pass a `ContextTokenCounter` to count tokens exactly for your model. The
optional `model` in the compile request goes only to that counter. Without a
counter, the compiler estimates `ceil(content.length / 4)` tokens and marks the
count as `fallback`. The budget includes the two newlines that separate
blocks.

## Receipts

Every result has a `ContextCompilationReceipt`. It records the request and
compiler versions, the selected resource keys and revisions, token counts,
what was dropped and why, any blockers, and the outcome. It contains no
content and no authorization details.

## Runtime schemas

Every request and result type has a [Standard Schema](https://standardschema.dev)
validator, for example `contextCompileRequestSchema`,
`contextCandidateSchema`, `resolvedContextCandidateSchema` and
`contextCompileResultSchema`. The validators reject unknown fields.

## Entry points

| Import | Contents |
| --- | --- |
| `@gonk/context` | `ContextCompiler`, `ContextContributorRegistry`, schemas and types. |
| `@gonk/context/contracts` | Receipt types only, safe for browser code. |

## License

Apache-2.0
