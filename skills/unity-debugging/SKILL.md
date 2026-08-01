---
name: unity-debugging
description: Diagnose Unity Editor, runtime, package, asset, lifecycle, callback, and feature-activation problems. Use when Unity behavior is missing, stale, inconsistent, or unexplained. Check exact-version documentation, user-facing prerequisites, and observable activation signals before escalating to project code, reflection, assembly searches, or Unity internals.
---

# Unity Debugging

Use the narrowest observable explanation first. Preserve the exact Unity project copy and establish the Unity and relevant package versions before relying on documentation or implementation details.

## Feature activation debugging

When a Unity feature does not activate:

1. Search the exact-version Unity or package documentation for the feature's enablement, menu, preference, and prerequisites.
2. Check the documented user-facing setting before inspecting project code or Unity internals.
3. Identify an observable activation signal and distinguish activation failure from callback failure:
   - If the expected event, callback, refresh, or version signal never changes, investigate feature enablement first.
   - If the signal changes but behavior is wrong, investigate project lifecycle, callback logic, and state handling.
4. Inspect project code only after documented prerequisites and feature gates have been ruled out.
5. Use reflection, assembly searches, decompilation, or implementation internals only after documented settings and project behavior have been checked.
6. Stop as soon as one confirmed prerequisite explains the observation. Do not broaden the investigation merely to find additional possible causes.

Follow this order:

**exact-version documentation → feature gate → observable activation signal → project code and lifecycle → internals**

## UI Toolkit Live Reload

Before diagnosing UI Toolkit Live Reload callbacks, confirm **Game View → More (⋮) → Live Reload** is enabled for the detected Unity version. The setting applies to all Game Views and can persist as an Editor preference. If the exact-version documentation or Editor UI differs, use the documented location for that version rather than assuming the menu path is universal.

## Scope and escalation

Treat feature activation as one debugging pattern, not the boundary of this skill. Apply the same evidence-first approach to Editor, runtime, package, asset, serialization, lifecycle, and callback problems: verify documented prerequisites and a minimal observable signal before widening into implementation internals.

Keep this skill concise. If a debugging topic needs substantial detail, load only its relevant skill-local reference under `references/`; use a package-level reference only when multiple independent package consumers need the same guidance.
