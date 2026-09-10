# Advisor Assistant — component documentation

**Status:** 2026-09-08 · Sandbox `fulltest` · Branch `AdvisorAssistant-01.09.26`

Advisor Assistant is a Lightning Web Component that turns a client meeting into structured
Salesforce records. An advisor picks a meeting Event, supplies notes and documents, and the
component uses prompt-template Flows to draft a meeting summary, a set of action items, and a
structured Wealth Plan — each reviewed and accepted by the advisor before anything is written.

It supersedes `wealthPlanHelper`, which remains in the org and is out of scope for this document.

---

## 1. Component inventory

| Bundle | Exposed | JS | HTML | CSS | Role |
|---|---|---|---|---|---|
| `advisorAssistant` | **Yes** | 6,081 | 1,409 | 5,377 | Parent shell. Owns the event picker, the Configuration column, the tab bar and the footer. Brokers state between tabs |
| `advisorMeetingSummary` | No | 5,762 | 1,255 | 4,305 | Mounted **twice** by the parent — once for Meeting Summary, once for To-Do's |
| `advisorWealthPlan` | No | 5,266 | 1,010 | 4,175 | The Wealth Plan review grid |
| `advisorInternalNotes` | No | 381 | 69 | 160 | Advisor-private notes. The reference implementation of the tab contract |
| `advisorHtmlSanitizer` | No | 137 | — | — | Shared utility module. Allowlist sanitiser for AI-authored rich text |

**Apex:** `MeetingSummaryController` (9 `@AuraEnabled` methods, `with sharing`) and
`MeetingSummaryControllerTest` (21 tests, 100% pass, 83% class coverage).

**Flows in the repo:** 11, listed in section 8.

---

## 2. Architecture

### The parent is a broker, not a container

`advisorAssistant` renders the chrome and passes context down. It holds no generated content of
its own; each tab's child owns its data and reports state upward.

```
advisorAssistant
├── Configuration column   event picker · category · notes · files · upload · regenerate
├── Tab bar                Meeting Summary │ Wealth Plan │ To-Do's │ Internal Notes
├── Tab panels
│   ├── c-advisor-meeting-summary  data-role="summary"
│   ├── c-advisor-wealth-plan
│   ├── c-advisor-meeting-summary  data-role="todos"     ← same component, second instance
│   └── c-advisor-internal-notes
└── Footer                 one primary CTA + contextual actions, all remote controls for a child
```

Because the same component serves two tabs, every imperative call must say which instance it
means — hence `_msChild(role)` in the parent. A bare `querySelector('c-advisor-meeting-summary')`
always returns the first.

### All panels stay mounted

Tabs are hidden with a CSS class, never `lwc:if`. This is deliberate: a generation started on one
tab keeps running when the advisor switches away, and the results are waiting on return. The
`_bgJobs` flags drive the banner and the per-tab dots that make that visible.

The cost is real — every child's wires and state exist all the time — and it is the reason
consolidating the duplicated `advisorMeetingSummary` mount is on the backlog.

### The tab contract

Every tab component implements the same shape. `advisorInternalNotes` is the smallest and clearest
example.

| Direction | Member | Purpose |
|---|---|---|
| In | `selectedEventId` | Id of the chosen Event, or null |
| In | `meetingNote` | The resolved `MeetingNote__c`, or null |
| In | `resolvedNoteId` | The note id the **parent** has brokered across all tabs |
| In | `saveFlowApiName` | API name of this tab's save Flow |
| Out | `tabstatechange` | `{ isDirty, isSaving, canSave, savedNoteId, statusLabel }` |
| Imperative | `save()` | Returns `Promise<boolean>` — true only if it really persisted |
| Imperative | `resetState()` | Clear everything on teardown |

Two rules, both learned from real regressions:

1. **Inputs must be reference-stable.** An `@api` setter re-runs whenever the incoming value's
   *identity* changes. A parent getter that rebuilds an array per access makes the setter fire on
   every parent re-render — that is what once blanked the Wealth Plan tab.
2. **`tabstatechange` must diff before dispatching.** It fires from `renderedCallback`, so an
   unconditional dispatch re-renders the parent, which re-renders the child, forever.

### Why `resolvedNoteId` exists

Two components can create the `MeetingNote__c`: `advisorInternalNotes` (notes taken before any
summary exists) and `advisorMeetingSummary`. The parent's `inputMeetingNotes` is a snapshot queried
at load, so it goes stale the moment either side creates one. The parent therefore brokers: each
tab reports the id it knows via `savedNoteId`, the parent merges them into `resolvedNoteId`, and
hands that back down. **Sending a blank id when a record already exists is what produces
duplicates**, so always save against `resolvedNoteId`, never a local guess.

---

## 3. The four tabs

### Meeting Summary

- The AI note, rendered with full typography — headings, lists, bold, tables, quotes
- **Brief Summary** ("At a Glance") in a bordered block above it
- **Edit Summary** / **Edit Brief** open a full-screen editor with a formatting toolbar
  (bold, italic, underline, H2/H3, both list types, indent, link, clear)
- **Regenerate with instructions** from inside the summary editor — the result replaces the editor
  content, so it is reviewed before committing. Cancel discards it; only **Apply & Save** persists
- The brief is **hand-edited only** — no regeneration
- Select any text in the summary → **Add as Action Item**, which sends it to the To-Do's tab
- Version history: earlier saved versions, previewable read-only
- Save paths: **Save & Review** (keep editing), **Save & Publish** (lock and share),
  **Save & Exit**, **Delete Note**

### Wealth Plan

Eight sections — Financial Goals, Income Streams, Assets & Liabilities, Household Milestones,
Company Ownership, Sustainability Preferences, Personal Greeting, and Action Items (the last shown
on the To-Do's tab instead).

- One **status band**: completion ring, "N of M suggestions accepted", progress bar, error and
  section counts, and on the right Expand All / Collapse All / Undo / Redo and the existing-data
  toggle
- Per section: **Accept all** (confirms every valid row, skipping errored ones) or **Accept
  section** (once no individual rows are left) — the two never appear together — plus Add,
  Delete all and Regenerate section
- Per row: Accept, Edit, Delete, a `Duplicate?` flag, and a diff view on existing records
- **Analysis Notes** — the model's prose commentary around the structured output
- **Save to Wealth Plan** shows a confirmation with creates / updates / deletions and the financial
  impact before anything is written. Only accepted records are saved

### To-Do's

- Generate action items from the summary, or **Add to-do** by hand
- Edit subject, description, priority, due date and public/internal
- Accept the ones you want, then **Save to-do's** creates the Tasks
- Sorted by priority then due date; a past date is flagged **Overdue**
- The High / Normal / Low count chips filter the list. **Accept All** is scoped to the visible set
  and its label counts only rows that will actually change

### Internal Notes

- Rich-text notes stored on `MeetingNote__c.Internal_Notes__c`
- **Never** shared with the client and never included in the meeting summary — enforced by a
  dedicated Apex method and a separate Flow branch (`saveMode = 'internalNotes'`), which is why the
  tab is amber throughout
- **Autosaves** ~3 seconds after typing stops, with a visible countdown. A manual save cancels a
  pending one
- Warns before the field's **32,768** character limit (see section 5 — the counter measures HTML,
  not visible text)

---

## 4. Configuration — for admins

`advisorAssistant` targets three surfaces:

| Target | Properties available |
|---|---|
| `lightning__FlowScreen` | 79 |
| `lightning__RecordPage` | 24 |
| `lightning__AppPage` | 24 |

103 properties are declared in total, grouped in `js-meta.xml` as Identity & appearance (30),
Record context (19), Meeting content (5), Household & accounts (10), Feature toggles (16) and the
Wealth Plan output collections (23).

### Required: the nine Flow API names

Nothing generates or saves until these are set. In the current sandbox they are configured on the
**`AdvisorAssistant_SCR_AI_Helper`** Flow screen — note they are **not** set on the Advisor
Assistant Flexipage.

| Property | Purpose |
|---|---|
| `meetingSummaryFlowApiName` | Generate a meeting summary |
| `regenerateSummaryFlowApiName` | Regenerate a summary with advisor instructions |
| `saveSummaryFlowApiName` | Background save of the summary |
| `saveInternalNotesFlowApiName` | Save internal notes |
| `saveTodosFlowApiName` | Create Tasks from accepted action items |
| `flowApiName` | Wealth Plan structuring |
| `wealthPlanSaveFlowApiName` | Wealth Plan save |
| `saveFileToEventFlowApiName` | Attach an uploaded file to the Event |
| `versionHistoryFlowApiName` / `createVersionFlowApiName` | Read and create note versions |

### Optional appearance and behaviour

- `componentTitle` / `componentSubtitle` — the header text, default "Advisor Assistant"
- **Event range collections** — `inputEvents` plus `inputEventsLast3Months`,
  `inputEventsLast6Months`, `inputEventsLast12Months`, `inputEventsAll`. A range only appears in
  the picker if its collection is populated, so supplying just `inputEvents` gives no selector
- `briefOpenByDefault` — whether the At a Glance block starts expanded
- Feature toggles (16) — `showEditTracking`, `showExpandCollapseAll`, `showDetailedStats`,
  `showDiscardSection`, `showRegenerateSection`, `showScrollToError` and others. A Flow passing the
  string `'false'` is treated as off

### Setup checklist

1. Create `MeetingNote__c.Internal_Notes__c` as a Rich Text Area — **already present, 32,768 chars**
2. Include `Internal_Notes__c` in the Get Records that populates the Meeting Notes collection,
   or the notes tab loads empty
3. Point both **Save Summary** and **Save Internal Notes** Flow API Name at
   `WealthPlan_AL_Meeting_Summary_Save_Update` — one Flow serves both, branching on `saveMode`
4. Populate the event collections for whichever ranges you want offered
5. Set the remaining Flow API names

---

## 5. Data model

### `MeetingNote__c`

| Field | Type | Length | Written by |
|---|---|---|---|
| `Note__c` | Rich text | 131,072 | Meeting Summary |
| `NoteMarkdown__c` | Long text | 131,072 | Meeting Summary (mirror) |
| `Brief_Summary__c` | Rich text | 130,768 | Brief Summary |
| `Brief_Summary_Markdown__c` | Long text | 130,768 | Brief Summary (mirror) |
| `Internal_Notes__c` | Rich text | **32,768** | Internal Notes |
| `Published__c` | Checkbox | — | Save & Publish |

> **`Internal_Notes__c` is a quarter the size of `Note__c`.** Rich text counts the *markup*, so a
> formatted note reaches the ceiling well before the visible text suggests. Exceeding it fails the
> save with a raw `STRING_TOO_LONG`, which is why the component enforces the limit client-side.

Also used: `MeetingNoteVersion__c` (version history), `Meeting_Artifact__c` (meeting files),
`Task` (action items, with `Related_Event__c`, `WhoId`, `WhatId`, `IsPublic__c`), `Event`, and the
Wealth Plan objects `Household_Milestones__c`, `Company_Ownership__c`,
`SustainabilityPreferences__c`, `FF_Income__c`, `FF_PersonalGreeting__c`.

> **None of these objects are in version control.** `force-app/main/default/objects/` is empty, so
> field definitions and limits are org-resident and nothing fails at build time if one changes.

---

## 6. Apex API reference

`MeetingSummaryController`, `public with sharing`. Every method takes the Flow's API name as its
first parameter and invokes it via `Flow.Interview`, so the component is not bound to any specific
Flow. Errors are wrapped in `AuraHandledException`.

| Method | Parameters | Returns |
|---|---|---|
| `generateSummary` | `flowApiName, eventId, accountId, documentId1..3, additionalContext, meetingNoteText, meetingType, hasTodos, saveDoc1..3AsArtifact, currentSummary` | `String` — summary HTML, or JSON `{summary, brief}` |
| `regenerateMeetingSummary` | `flowApiName, currentSummary, instructions, documentId` | `String` |
| `generateMeetingTodos` | `flowApiName, eventId, accountId, documentId1..3, meetingType, hasTodos, additionalContext` | `String` — JSON array |
| `saveMeetingNote` | `flowApiName, noteId, noteHtml, noteMarkdown, briefHtml, briefMarkdown, eventId, published, meetingType, deleteNote` | `String` — saved note Id |
| `saveInternalNotes` | `flowApiName, noteId, eventId, internalNotes` | `String` — saved note Id |
| `saveTodos` | `flowApiName, todosJson, eventId, whoId` | `String` |
| `saveWealthPlan` | `flowApiName, recordsJson, accountId` | `String` — JSON `{errors, successSections}` |
| `saveFileToEvent` | `flowApiName, contentDocumentId, eventId` | `String` |
| `getMeetingNoteVersions` | `flowApiName, eventId` | `List<MeetingNoteVersion__c>` |

### Flow variable contracts

| Method | Flow inputs | Flow outputs |
|---|---|---|
| `generateSummary` | `EventId`, `AccountId`, `ContentDocumentId1..3`, `AdditionalContext`, `MeetingNoteText`, `MeetingType`, `MeetingContext`, `HasTodos`, `GenerateMode`, `CurrentSummary`, `SaveDoc1..3AsArtifact` | `GeneratedSummary`, `MeetingBrief` |
| `regenerateMeetingSummary` | `currentSummary`, `instructions`, `documentId` | `generatedResponse` |
| `generateMeetingTodos` | `EventId`, `AccountId`, `ContentDocumentId1..3`, `AdditionalContext`, `MeetingType`, `HasTodos`, `GenerateMode` | `GeneratedTodos` |
| `saveMeetingNote` | `noteId`, `noteHtml`, `noteMarkdown`, `briefHtml`, `briefMarkdown`, `eventId`, `published`, `meetingType`, `deleteNote`, **`saveMode = 'summary'`** | `savedNoteId` |
| `saveInternalNotes` | `noteId`, `eventId`, `internalNotes`, **`saveMode = 'internalNotes'`** | `savedNoteId` |
| `saveTodos` | `EventId`, `WhoId`, `WhatId`, `TaskRecords` (built as `Task` sObjects in Apex) | `SaveResult` |
| `saveFileToEvent` | `ContentDocumentId`, `EventId` | — |
| `getMeetingNoteVersions` | — | `MeetingNoteVersions` |

**`saveMode` is load-bearing.** One Flow serves both save paths and branches on it. It exists
because Flow's `ISBLANK` cannot distinguish "internal notes not supplied" from "internal notes
cleared to empty" — a blank check alone would fall through to the summary branch and wipe the
client-facing `Note__c`.

**Blank inputs are omitted, not passed as empty strings.** Every optional input is guarded with
`String.isNotBlank`, so an unset value never reaches the Flow. The Wealth Plan tab's pre-flight
"nothing to generate from" check depends on exactly this.

**`saveWealthPlan` is the exception — it does DML in Apex, not through a Flow.** It deserialises
the payload and saves **section by section**, each inside its own `Database.setSavepoint()` with
rollback on failure, then returns which sections succeeded and which errored. A partial save is
therefore possible and intentional: one bad section does not lose the rest.

---

## 7. Security

- **`with sharing`** on the controller; record access follows the running user
- **`advisorHtmlSanitizer`** scrubs all AI-authored HTML before it is injected. The input is not
  trustworthy: it comes back from a prompt template that reads client documents, so a crafted
  document could put markup in the model's mouth. It is an **allowlist**, so anything unanticipated
  fails closed:
  - `script`, `style`, `iframe`, `object`, `embed`, `svg`, `form`, `input` and similar are dropped
    **with their content**
  - unknown tags are unwrapped, keeping their text
  - all attributes are stripped except `a[href|title]` and `th|td[colspan|rowspan]` — no `style`,
    no `class`, no `on*`, no `id`
  - `href` must be `http(s):`, `mailto:`, `tel:`, `#` or `/`; links get `target="_blank"` and
    `rel="noopener noreferrer"`
  - covered by 38 assertions including `img onerror`, `svg onload`, mixed-case and space-padded
    `javascript:`, `data:` hrefs and unclosed-script markup
- **Internal notes never leak.** A dedicated Apex method, a separate Flow branch and a distinct
  output field. Nothing in the summary, brief, Markdown mirrors or Flow outputs carries them

---

## 8. Flows

| Flow | Used for |
|---|---|
| `AdvisorAssistant_SCR_AI_Helper` | The screen Flow that hosts the component and holds its configuration |
| `WealthPlan_AL_Meeting_Summary_Trigger` | Generate a meeting summary |
| `WealthPlan_AL_Meeting_Summary_Regenerate_Trigger` | Regenerate with instructions. Calls the prompt template `Wealth_Plan_AI_Helper_2_3_Meeting_Summary_Rewrite` |
| `WealthPlan_AL_Meeting_Summary_Save_Update` | Save summary **and** internal notes, branching on `saveMode` |
| `MeetingSummary_TRG_AI_Summary_Create` | Summary creation |
| `MeetingSummary_TRG_AI_Meeting_To_Do_s` | Generate action items |
| `WealthPlan_AL_AI_Helper_Trigger` | Wealth Plan structuring |
| `WealthPlan_AL_WealthPlan_Create_and_Update` / `_V2` | Wealth Plan persistence |
| `WealthPlan_AL_Meeting_Note_Get_Versions` | Read version history |
| `WealthPlan_AL_Meeting_Note_Create_Version` | Create a note version |

---

## 9. Gotchas for the next developer

These are all real defects that have already cost time. They are non-obvious and easy to
reintroduce.

**`@api` properties are set in template attribute order.** In `advisorAssistant.html`
`selected-event-id` is attribute 3 while `input-events` is 24 and `input-meeting-notes` is 25. Any
child logic that reads *derived* data at event-selection time will see nulls. This produced empty
Wealth Plans for weeks: `_includeMeetingSummary` latched `false` because `selectedEventNote` had
not resolved yet, so the summary was silently withheld from the prompt. The fix is to re-derive
from every setter that can change the answer, guarded by a "user has overridden this" flag.

**A parent getter that rebuilds an array re-fires the child's setter.** Passing a freshly built
array on every access makes the child think the input changed on every parent render. Memoise on
source identity — see `allKnownEvents`.

**LWC does not reflect `value` on a native `<textarea>`.** The value is written as child text and
applied on the first render only, so assigning the backing field in JS never reaches the DOM. Use
`lwc:ref` and write the element — see `_syncTextarea`.

**CSS cannot reach into another component's shadow DOM.** The style compiler scopes every compound
selector, so `.wph-summary-html-body h2` becomes `.wph-summary-html-body[token] h2[token]`. Content
rendered by `lightning-formatted-rich-text` never receives our token, which is why the summary is
painted into a div carrying `lwc:dom="manual"` instead — that directive is what makes the engine stamp
tokens onto injected nodes.

**Repainting `innerHTML` destroys the text selection.** `renderedCallback` runs constantly, so
`_paintProse` writes only when the HTML *or the element* changed. Without that guard the
"Add as Action Item" popup breaks.

**`querySelector` on a class with several matches picks the first in document order.** The tour's
Generate step highlighted the wrong button for exactly this reason — `.aa-primary-cta` matches five
elements. Scope the selector.

**The tour silently skips steps whose target is missing.** A stale selector shrinks the tour with
no error at all. There is a check for this in the verification suite.

**Do not prune the CSS casually.** A dead-code and CSS prune on 2026-09-01 made the event buttons
unclickable and had to be reverted wholesale. Around 1,450 class selectors *look* unreferenced, but
classes are assembled from template-literal fragments and applied from sibling bundles, so static
detection over-reports. Every candidate needs individual verification.

---

## 10. Testing and verification

**Apex:** 21 tests, 100% pass, **83%** coverage on `MeetingSummaryController`. The uncovered lines
are all after `Flow.Interview.start()` and cannot be reached without the org's Flows, so that is
effectively the ceiling.

> **Org-wide coverage is 42%, and production requires 75%.** This is *not* this project's code —
> it is 25+ pre-existing classes at 0%. Deploy Apex with `RunSpecifiedTests` naming
> `MeetingSummaryControllerTest`, which checks each deployed class individually and which this
> class clears comfortably. A default-level production deploy would be blocked by other teams'
> coverage.

**LWC:** `@salesforce/sfdx-lwc-jest` is installed and configured, and there are currently **no
committed tests**. 230 assertions exist but live outside the repo. Committing them is the top item
on the improvement backlog, because it is what makes the larger cleanups safe.

**Gates run before every deploy:** the LWC template compiler and style compiler, a binding
resolution and CSS class-coverage check (currently **zero** classes without a rule across all
bundles), ESLint against fixed baselines (77 / 68 / 70 / 0 / 0), a comment-aware div-balance check,
`sf project deploy start --dry-run`, and a metadata snapshot of the org taken first.

---

## 11. Related documents

- `DEFECTS.md` — current findings with status, plus the full changelog
- The improvement backlog, tiered by risk, covering the committed-tests gap, the `saveMode`
  assertions, keyboard access, Apex hygiene and the CSS prune
