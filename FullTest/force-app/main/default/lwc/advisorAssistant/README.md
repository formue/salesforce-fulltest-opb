# Advisor Assistant — Architecture Decomposition

## Context

`advisorAssistant` is a **brand-new component family** created alongside the existing `wealthPlanHelper`. The goal is to break the monolith into a scalable, multi-child architecture. `wealthPlanHelper` continues to run in production untouched; `advisorAssistant` will replace it when ready.

Both components share the same Apex class (`MeetingSummaryController`) and Flow API names, so no backend changes are needed. The same `@api` property names are used on `advisorAssistant` as on `wealthPlanHelper`, making it a drop-in replacement for existing Flows.

---

## Component Structure

```
advisorAssistant          ← thin orchestrator (currently still ~4600 JS lines — see Phase 1 Step 1.3)
├── c-advisor-meeting-summary   ← meeting notes domain
└── c-advisor-wealth-plan       ← wealth plan domain
```

### Component Roles

| Component | Folder | Purpose |
|---|---|---|
| `advisorAssistant` | `lwc/advisorAssistant/` | Main orchestrator — owns @api Flow inputs/outputs, event selection, shared tab state, shared file pool, modal overlay, theme |
| `advisorMeetingSummary` | `lwc/advisorMeetingSummary/` | Summary generation, note save/publish/delete/version, brief section, action items/todos, meeting type, summary editor modal, regeneration |
| `advisorWealthPlan` | `lwc/advisorWealthPlan/` | WP generation, section review grid, row editing/lock/delete, undo/redo, diff view, duplicate detection, picklist wire calls, save preview/confirm |

### Data Flow

- **Down (orchestrator → children)**: `@api` properties — `selectedEventId`, `sharedFiles`, `inputExisting*`, flow API names, feature toggle booleans, etc.
- **Up (children → orchestrator)**: Custom events — `summarychange`, `notesave`, `notepublish`, `todoschange`, `sectionsave`, `tabswitch`, `sharedfileschange`, `artifactfileidschange`

---

## Current State (Phase 1 complete)

### What was done

Phase 1 of the architecture decomposition is complete:

- `advisorAssistant.html` — orchestrator shell: header, user guide, event selector bar, loading step, tour prompt. The `isSummaryTab` block renders `<c-advisor-meeting-summary ...>` and the `isWealthPlanTab` block renders `<c-advisor-wealth-plan ...>` with all required @api bindings and event listeners wired.
- `advisorMeetingSummary.html` — inner content of the summary tab (lines 802–1861 of wealthPlanHelper.html), starting with `<div class={summaryLayoutClass}>`.
- `advisorWealthPlan.html` — inner content of the WP tab (lines 1863–end of WP section from wealthPlanHelper.html), starting with `<div class={wpLayoutClass}>`.
- All three `.js` files are currently **copies of `wealthPlanHelper.js`** with the class name changed (`AdvisorAssistant`, `AdvisorMeetingSummary`, `AdvisorWealthPlan`). The orchestrator also has 9 child event handler methods added.
- All three `.css` files are copies of `wealthPlanHelper.css`.

### What this means in practice

The scaffold is deployable but not yet lean:
- `advisorAssistant.js` carries the full ~4600-line codebase — the delegation to children is wired in HTML but the JS has not been slimmed yet.
- Each child JS file also carries the full codebase — child-specific extraction happens in Steps 1.3 and beyond.
- No duplication has been eliminated yet; the value is the structural foundation and clear domain boundaries.

### What is NOT done yet

#### Step 1.3 — Slim the orchestrator
Remove from `advisorAssistant.js` all methods/state that only belong in the children:
- Meeting summary methods → only in `advisorMeetingSummary.js`
- Wealth plan methods → only in `advisorWealthPlan.js`
- Orchestrator target: ~600–800 lines

#### Phase 2 — JS utility modules within each child
Extract pure `.js` utility files inside each component folder:
- `advisorMeetingSummary/htmlUtils.js` — `htmlToMd`, `stripHtmlToText`, `stripStyleBlocks`
- `advisorWealthPlan/constants.js` — `SECTIONS`, `FIELD_ALIASES`, `OWNER_FIELD_APIS`
- `advisorWealthPlan/sectionParser.js` — `parseResult`, `detectSectionFromRecord`, `buildEmptySections`
- `advisorWealthPlan/undoRedo.js` — `UndoRedoEngine` class

#### Phase 3 — Shared component library
- `advisorConfirmModal` — generic confirmation dialog (replaces inline modal divs)
- `advisorEditModal` — contenteditable rich-text editor modal (reusable across children)

---

## New Feature Protocol (once Step 1.3 is done)

1. **Meeting-note related** → goes into `advisorMeetingSummary`
2. **Wealth plan data related** → goes into `advisorWealthPlan`
3. **New major domain** (risk profiling, document archive, etc.) → new `advisorXxx` peer component
4. **`advisorAssistant` never grows** — it only wires data between children

---

## Migration from `wealthPlanHelper`

When ready to switch:
1. Point a Flow screen element to `<c-advisor-assistant>` instead of `<c-wealth-plan-helper>`
2. All `@api` property names are identical — no Flow changes required
3. `wealthPlanHelper` can stay deployed in parallel; decommission when all Flows are migrated

---

## Editor fix (wealthPlanHelper — from previous session)

These functional fixes were applied to `wealthPlanHelper` (not yet replicated to the new components):
- Replaced `lightning-input-rich-text` with `contenteditable` div — fixes drag-resize bug in native shadow
- Added `class="cke_editable"` — prevents Salesforce's `E` keyboard shortcut from intercepting
- Added focus absorber div — suppresses the shortcut when the outer modal opens
- Added `handleEditorInput`, `handleBriefEditorInput`, `handleEditorKeyDown`, `handleEditorPaste`
- `renderedCallback` handles editor `innerHTML` init (with `_editorNeedsInit` / `_briefEditorNeedsInit` flags)

These changes are already present in the `advisorMeetingSummary` JS/HTML since its files were copied from the updated `wealthPlanHelper`.
