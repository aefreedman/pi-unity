# Critical Pattern Template

Use this when adding an entry to `docs/solutions/patterns/critical-patterns.md`.

If the file does not exist yet, create it with this schema v2 frontmatter:

```yaml
---
schema_version: 2
doc_type: pattern
category: critical_patterns
failure_mode: workflow_friction
module: Cross-Cutting Unity Patterns
date: [YYYY-MM-DD]
component: tooling
symptoms:
  - "High-impact Unity pitfalls need a central required-reading index"
root_cause: missing_validation
resolution_type: documentation_update
severity: high
tags: [critical-patterns, required-reading, unity-docs]
---
```

## N. [Pattern Name]

**Rule:** [State the required practice in one sentence.]

**Applies when:** [Scope/context where this pattern matters.]

**Avoid:**

```csharp
// Minimal example of the risky approach.
```

**Use:**

```csharp
// Minimal example of the required approach.
```

**Reason:** [Why this prevents the failure.]

**Documented in:** `docs/solutions/[category-folder]/[filename].md`
