---
name: api-client composite project reference
description: Why edits to a referenced composite lib don't show up in dependent artifacts until rebuilt
---

Artifacts that consume an internal lib via a TS `references` entry type-check against
the lib's **built declarations**, not its source.

**Why:** After adding an export to a referenced composite lib's barrel, a dependent
artifact kept failing `TS2305 has no exported member` until the lib was rebuilt.

**How to apply:** After editing the source of any composite lib that artifacts
reference (the api client, the db lib, etc.), rebuild it with `tsc -b <lib>` before
trusting (or debugging) a dependent artifact's typecheck.
