---
name: feature-list-manager
description: Create and maintain project feature inventory documents such as `features.md` or repo-specific files like `docs/FEATURES.md`. Use when Codex needs to add a new feature entry, update a feature to match the current code or session changes, rewrite stale requirements, group related features together, attach real implementation links or paths, merge duplicate entries, or mark a feature as removed.
---

# Adams Feature List Manager

## Overview

Keep the project's main feature document as the single readable source of truth for what features exist, what problem they solve, what requirements define them, and where the implementation lives.

Prefer updating the existing feature doc instead of creating side notes. If the expected file does not exist yet, create it at the canonical repo path.

## Choose The Operation

Use this skill for four main actions:

- Create a new feature entry.
- Append new requirements or code links to an existing feature.
- Rewrite an existing feature so it matches the current product and code.
- Mark a feature as removed.

If the user does not name a feature and asks to "update feature doc" or "update feature to match what we have done in this session," inspect the files changed in the current task and update only the affected entries.

If required details are missing and you cannot infer them safely, ask a short follow-up question before editing.

## Gather Context Before Editing

1. Find the canonical feature doc file.
   - Use the user-provided path when given.
   - Otherwise check local repo instructions first, especially `AGENTS.md`, `agents.md`, `CLAUDE.md`, and `codex.md`, for an explicit feature doc path and use it.
   - If the repo root directory is `ai-keyboard`, prefer `docs/FEATURES.md`.
   - If no explicit rule exists, fall back to `features.md` in the current project root.
2. Read the whole file before editing so you preserve its current grouping style.
3. Inspect the code, recent diffs, and changed files before writing. Do not invent implementation paths.
4. Reuse existing group headings when they fit. Create a new group only when the feature clearly belongs elsewhere.
5. Keep one canonical entry per feature. If duplicates exist, merge them into the best group and remove the duplicate entries.

## Prefer Stable Grouping

Group features by product area, user flow, or domain. Avoid grouping by random file names or temporary tasks.

Good grouping examples:

- Authentication
- Editor
- AI Assistance
- Billing
- Settings

If the file already has a clear grouping system, keep it.

## Use This Default File Shape For New Documents

```md
# Feature List

## <Group Name>

### <Feature Name>
- Summary: <short description>
- Solves: <what problem this feature solves>
- Requirements:
  - <behavior or rule>
  - <behavior or rule>
- Status: planned | in-progress | done | removed
- Links/Paths:
  - `path/to/file`
  - `path/to/file`
```

Keep the shape simple. Do not add extra sections unless the project already uses them or the user asks for them.

## Write Each Field Like This

- `Summary`: Explain the feature in 1-2 short sentences.
- `Solves`: State the user problem or product need.
- `Requirements`: List the concrete rules, behavior, edge cases, and limits that define the feature.
- `Status`: Use `planned`, `in-progress`, `done`, or `removed` unless the project already has its own status words.
- `Links/Paths`: Add the most useful code locations that help future AI find the implementation quickly.

## Choose Good Links And Paths

Add only the paths that matter most. Prefer 1-5 paths.

Good candidates:

- Main entry points
- Core service or logic files
- UI components directly tied to the feature
- Schema or config files that define the feature
- Tests that show expected behavior

Do not dump every related file. Use the paths that make the feature easiest to trace.

If the feature is not implemented yet, write:

- `Status: planned`
- `Links/Paths:`
  - `Not implemented yet`

## Update Rules

When creating:

- Add the feature to the best matching group.
- Create a new group only if no existing group fits.
- Avoid creating a second entry for the same feature.

When appending:

- Add missing requirements or paths without rewriting correct content.
- Keep the same feature name unless it is clearly wrong or outdated.

When rewriting:

- Replace stale text so the entry matches the real behavior in code.
- Remove guessed requirements that are not supported by the code or user request.

When marking removed:

- Keep the feature entry in place.
- Set `Status: removed`.
- Shorten the entry if needed, but keep enough text and paths to show what was removed.
- Do not keep a change log inside `features.md`. Git already tracks history.

## Keep The Document Useful For Future AI

Optimize for fast understanding, not long prose.

- Use short names and short summaries.
- Keep related features near each other.
- Write requirements as concrete bullets.
- Update code paths whenever implementation moves.
- Prefer rewriting one stale entry over adding a second partial entry.

## Handle Common User Requests

For `update feature doc`:

- Inspect `features.md`, changed files, and the current task.
- Update only the affected groups and features.

For `update feature to match what we have done in this session`:

- Read the files changed in the session first.
- Rewrite the touched feature entries so they match the shipped behavior.

For `let's create new feature` or `let's add new feature`:

- Find the right group.
- Create a new entry with all required fields.
- Add real code paths if implementation exists. Otherwise mark it as planned.
