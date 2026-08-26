# Documentation Agent Instructions

## Authority

Root `CONTEXT.md` is the shared vocabulary. `docs/adr/` records accepted architectural decisions, `docs/vfsl/` records the language specification, and `docs/phases/` describes delivery slices. Historical `wiki/raw/` artifacts are evidence, not normative contracts.

## Editing

- Use repository vocabulary exactly; update `CONTEXT.md` when introducing or changing a domain term.
- Record a durable architectural decision as an ADR. Amend or supersede prior decisions explicitly instead of silently contradicting them.
- Keep phase documents aligned with their ADR dependencies and distinguish current contract from planned work.
- Link to the authoritative source instead of copying its rules into multiple documents.
- When code behavior changes, update every normative document whose stated contract changed; documentation-only wording changes must not invent implementation behavior.

## Verification

Check links and referenced filenames, search for stale terminology and contradicted decisions, and run `git diff --check`. Run code checks only when generated examples or executable contracts changed.
