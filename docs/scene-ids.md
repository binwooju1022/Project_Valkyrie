# Scene IDs and bookmarks

Every bookmarkable `story` or `reportSections` item has a permanent `sceneId`.
Keep it when editing text or moving that item. Displayed scene numbers still follow
array order. Resume cursors and seen ranges retain their existing index format.

For a new scene, omit the ID and run `node scripts/scene-ids.mjs --assign`.
The command fills only missing IDs with UUID-based IDs. Never copy an existing ID
onto a different scene or renumber IDs. Run `node scripts/scene-ids.mjs` to check.

`js/data/bookmark-legacy.js` freezes the v24 scene counts and the initial numbered
ID convention. Do not change its counts when inserting, moving or deleting scenes.
Older saves first use their existing layout migration, then this frozen mapping.
New bookmarks identify a scene by `recordId` and `sceneId`; saved `index` and `text`
are derived compatibility/display fields, not identity checks.

For a split, retain the ID on the scene that best preserves the original bookmark
destination and give new IDs to the other pieces. For a merge or deliberate move
to a new ID, add `"old-scene-id": "destination-scene-id"` to `redirects`. A redirect
must point to an existing scene, must not cycle, and must not replace a live ID.
Use `null` to explicitly retire an ID. Deleted or unknown scenes remain visible
as unavailable bookmarks; they must never silently jump by a saved index.

The October 21 narration merges also migrate numeric resume/seen positions via
`js/core/scene-layout.js`. `narrationLayoutVersion: 1` marks the current layout in
saves, history entries and change journals. Historical index maps remain frozen;
apply this final migration after them. Keep scene artwork and SFX indices aligned
when changing the story array. Do not reuse this migration flag for a later edit.

Checks: `node --test tests/bookmarks.test.mjs tests/progress-store.test.mjs`.
Browser coverage: `tests/browser/bookmark-ids.mjs`, `progress-import.mjs`.
