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

**Flows in the repo:** 11, listed in section 9.

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

## 3. The left panel

Shared by every tab: event picker, meeting category, context notes, **Meeting Files** (files
already attached to the event) and **Document Upload**.

### Why the column scrolls instead of squashing

`.aa-config-body` is a flex column with `overflow-y: auto`, and every ancestor
(`.aa-body`, `.aa-left-col`, `.aa-config`) carries `min-height: 0` — the usual flexbox-scroll
gotcha, already handled. That was never enough on its own:

```css
.aa-config-body > * { flex-shrink: 0; }
```

Without it the cards default to `flex-shrink: 1`, so on a short screen the browser **compressed
them to fit** rather than letting the column overflow. Content never exceeded the container, so
`overflow-y: auto` had nothing to scroll, and `.aa-card { overflow: hidden }` clipped the
remainder — choices disappeared rather than merely looking cramped.

It only showed up at low resolution because the panel is height-capped
(`.aa-root { height: 780px; max-height: 90vh }`): at a 768px viewport the column has roughly
450px for an eyebrow plus four cards.

Two supporting pieces:

- The scrollbar is styled to be **visible but quiet** (`scrollbar-width: thin`, an 8px
  `#cbd5e1` thumb), plus `scrollbar-gutter: stable` so cards do not shift sideways when it
  appears. Note `.aa-range-track` nearby deliberately *hides* its scrollbar — opposite case,
  do not copy it.
- A `@media (max-height: 820px)` block trims padding in the column. It is the only
  **height**-based breakpoint in the file; every other one is width-based. That is deliberate —
  `max-height: 90vh` means viewport height is what squeezes this column.

`max-height: 90vh` is intentionally left alone: it keeps the panel inside the window and the
footer CTA on screen.

### Meeting category — "Prospect Meeting" is a display name only

The whiteboard category is shown to advisors as **Prospect Meeting**, but Salesforce still stores
`Whiteboard Meeting`. That split is deliberate and load-bearing:

`Event.MeetingType__c` is a **restricted** picklist. It contains `Whiteboard Meeting` and does not
contain `Prospect Meeting`, and the chosen label is written straight into it by the save Flow —
so renaming the label alone would fail every save of that category with
`INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST`.

Three module constants carry this, in each of the three components:

| Constant | Purpose |
|---|---|
| `MEETING_TYPE_LABELS` | what the advisor sees |
| `MEETING_TYPE_STORED` | what Salesforce stores — a valid picklist value |
| `MEETING_TYPE_ALIASES` | stored value → internal key, accepting every spelling |

Order shown to advisors: **Prospect Meeting · Working Meeting · Status Meeting · Annual Review**.

| Category | Advisor sees | Salesforce stores | Note |
|---|---|---|---|
| `whiteboard` | Prospect Meeting | `Whiteboard Meeting` | legacy value, still valid |
| `working` | Working Meeting | **`Other`** | ⚠️ no matching picklist value exists |
| `status` | Status Meeting | `Status Meeting` | |
| `annual` | Annual Review | `Annual Review` | |

⚠️ **Working Meeting stores `Other`.** Unlike the prospect category there is no legacy value to
fall back on, so `Other` is the interim that lets the save succeed — at the cost of the Event not
naming the category. `MEETING_TYPE_ALIASES` deliberately does **not** map `Other` back to
`working`: `Other` is a real category in its own right that predates this component, and claiming
those events were working meetings would be false. The visible consequence is that a saved working
meeting does not preselect its radio on reopen. Adding `Working Meeting` to the picklist fixes
both.

`meetingTypeLabel` is display; `meetingTypeStoredValue` is what goes into the save payload. The AI
prompt gets the display label, since that is prose for the model rather than a picklist value.

**To finish this properly:** add `Prospect Meeting` and `Working Meeting` to the picklist, migrate
the existing records (3 `Whiteboard Meeting` at time of writing), then change those two lines in
`MEETING_TYPE_STORED`. Nothing else moves — `MEETING_TYPE_ALIASES` already reads the new spellings,
so old records keep preselecting correctly.

### Regenerate with Instructions lives only in the editor

There is **no regenerate card in the Configuration column**. Regeneration happens inside the
**Edit Summary** modal (`handleModalRegenerate` in `advisorMeetingSummary`), where the advisor can
see the result replace the editor content before committing — Cancel discards it, only
**Apply & Save** keeps it.

The column card was briefly parked behind a `REGENERATE_WIP` flag with a "coming soon" banner;
that was removed rather than shipped, along with the child's `regenerateSummaryWithInstructions`
API, whose only caller it was. `.aa-wip-pill` survives as a general "coming soon" primitive for
tab labels and rows.

### Header attendees come from `Event.WhoId`

The "Selected event" bar lists the people actually on the event. It previously listed the whole
household — primary member plus every `inputHouseholdMembers` entry — regardless of who attended,
so a two-person household showed two names on a meeting only one of them was in.

Flow cannot traverse `Who.Name`, so the name is resolved locally: household members are person
accounts and their `PersonContactId` is the Contact id `WhoId` points at. Both collections come
from lookups using `storeOutputAutomatically`, so the field is present without a Flow change.

`EventRelation` — the real multi-attendee list — was considered and rejected: the org has 118k of
those rows but **none on the events this component works with**, so it would have emptied the chip
rather than enriching it. If invitee data starts being written, that is the place to revisit.

A `WhoId` outside the household (or a Lead) resolves to no name and the chip hides rather than
guessing.

### Summary language pill

The AI drifts between Norwegian and English, so the language is stated outright in the prompt
rather than inferred. A pill row above the **Meeting Notes & Context** textarea offers **Norsk /
English / Svenska / Dansk**, and the pick is written into that textarea as its **first line** —
**in the selected language**, not in English about that language:

| Pill | Sentence written into the notes |
|---|---|
| Norsk | `Skriv hele møtereferatet på norsk (bokmål), inkludert alle overskrifter, punktlister og gjøremål.` |
| English | `Write the entire meeting summary in English, including all headings, bullet points and to-dos.` |
| Svenska | `Skriv hela mötessammanfattningen på svenska, inklusive alla rubriker, punktlistor och uppgifter.` |
| Dansk | `Skriv hele mødereferatet på dansk, inklusive alle overskrifter, punktopstillinger og opgaver.` |

Each names its own language explicitly and calls out headings, bullets and to-dos, because those
are where output drifts back to English.

Keeping the line visible in the notes box is the whole point — the advisor can see, and edit,
exactly what the model is being told. Because it lives in `_freeText`, it travels into
`additionalContext` with everything else the advisor typed.

**Default comes from `Account.ShippingCountry`** on the household's primary member, which already
reaches the component: `GET_Primary_Member` in the subflow uses `storeOutputAutomatically`, so
every Account field is on `inputPrimaryMember` — no Flow change was needed.

| `ShippingCountry` | Pill |
|---|---|
| `Norway` | Norsk |
| `Sweden` | Svenska |
| `Denmark` | Dansk |
| anything else, or blank | English |

The org stores **English country names**, not ISO codes, across 31 distinct values — including
free text like `Något land` and `Utvandret`. `COUNTRY_LANGUAGE` is therefore a three-entry
allowlist with English as the catch-all, never a lookup that assumes clean data. There is no
language field anywhere in the org (`FinServ__LanguagesSpoken__pc` exists but is free text and
empty on every Account), which is why country is the proxy.

A hint under the pills says *"Default from Norway"* until the advisor picks for themselves — a
defaulted value nobody can trace reads as a bug. A manual pick sets `_languageTouched` and then
wins permanently for the session, including when the Flow re-pushes the household record.

`_upsertLanguageSentence` is the piece with teeth. Each language carries its own `prefix`, and
`_isLanguageLine` matches **any** of the four — which is what makes switching work at all, since
the line being replaced is written in the language you are switching *away from*. If the first
non-empty line is one of ours it is swapped, otherwise the sentence is prepended. It is
**idempotent**, never duplicates, never drops the advisor's text, and leaves alone a line that
merely *mentions* a language.

The English prefix is unchanged from the feature's first version, so notes still holding the
old English-only instruction are recognised and upgraded rather than left behind.

The pill labels and the "Default from …" hint stay in English, matching the rest of the UI
chrome; only the instruction itself is localised, because only it is read by the model.

Two implementation notes worth keeping:

- The textarea is uncontrolled (DEFECTS #3), so assigning `_freeText` changes what the Flow
  receives but not what the advisor sees. It now carries `lwc:ref="notesTextarea"` and writes go
  through `_syncTextarea`.
- That sync is guarded by `_hasRendered`. The default is seeded from the `inputPrimaryMember`
  setter, which runs **before** first render — and touching `this.refs` that early is an LWC
  error, not merely a no-op. Before first render nothing needs pushing anyway, since the textarea
  renders `_freeText` as its child text.

### Transcript retention countdown

An org-side retention process deletes meeting transcripts 7 days after they are created. Any file
that is a text file (see the `FileType` note below) **and** whose title contains "transcript"
(case-insensitive) therefore carries a chip in both file lists saying **when it will be deleted**:

| State | Label | Chip |
|---|---|---|
| 2+ days out | `Deletes 28. sep. · 6 days left` | amber |
| Tomorrow | `Deletes 23. sep. · tomorrow` | light red |
| Later today | `Deletes 22. sep. · today` | light red |
| Past due | `Overdue 7 days · 14. sep.` | solid red |

The chip **leads with the date** because that is the question it exists to answer; the day count
is secondary, for urgency at a glance. Hovering shows both timestamps —
`Uploaded 21. sep. 2026, 22:17 · scheduled for deletion 28. sep. 2026, 22:17`. The upload date
matters: without it the day count cannot be checked against anything, which is how a correct
number still managed to look wrong.

Past the deadline the wording is **"Overdue", never "Deleted"**: the list is built from live
`ContentDocumentLink` records, so a file that is on screen has not actually been removed —
overdue means the retention job has not caught it yet.

**The count is in calendar days, not elapsed time** (`_calendarDaysBetween`). This is what keeps
the two halves of the label agreeing: at 22 Sep 23:00 a deadline of 28 Sep 20:17 is 5.9 days away,
so an elapsed-time count would render `Deletes 28. sep. · 5 days left` when 28 − 22 is plainly 6.
Both ends are normalised to local midnight and differenced with `Math.round` — **not `Math.floor`**,
because Norway observes DST and two days a year are 23 or 25 hours long.

Note the consequence: a file whose deadline was 14 Sep reads `Overdue 8 days` on 22 Sep, even
though only 7 days and some hours of wall-clock time have passed. That is deliberate — the count
always matches the date printed beside it.

`_now` is repainted by a 60-second interval that writes **only when the local calendar day
changes** (`_localDayKey`), so a tab left open overnight stays correct at a cost of one re-render
per day, and none at all on an event with no transcript (`_hasTickingTranscript`). `_now` is local
state, so children never re-render from it. Teardown is in the single `disconnectedCallback`.

The countdown is driven by `ContentDocument.CreatedDate`, which **the Flow must query** — see the
`inputContentDocuments` property. If that field is absent no chip renders at all, so the component
degrades cleanly rather than showing a wrong date. Nothing here performs the deletion; the chip
only reports the policy.

#### `ContentDocument.FileType` is not the file extension

This is the trap that stopped the countdown from ever firing on a real file. `FileType` uses
Salesforce's own vocabulary, not the extension:

| Extension | `FileType` |
|---|---|
| `.txt` | **`TEXT`** |
| `.docx` | **`WORD_X`** |
| `.doc` | **`WORD`** |
| `.xlsx` | **`EXCEL_X`** |
| `.pdf` `.png` `.jpg` `.jpeg` `.gif` | same as the extension |

Files also reach the components from two sources with two spellings — Flow-supplied rows carry
`ContentDocument.FileType`, session-uploaded rows carry the raw filename extension. All three
components therefore normalise through a local `_fileKind()` helper returning
`'txt' | 'pdf' | 'doc' | 'img' | 'generic'`. **Never compare `FileType` to an extension directly**;
route it through `_fileKind()`.

---

## 4. The four tabs

### Meeting Summary

- The AI note, rendered with full typography — headings, lists, bold, tables, quotes
- **Edit Summary** opens a full-screen editor with a formatting toolbar
  (bold, italic, underline, H2/H3, both list types, indent, link, clear)
- **Regenerate with instructions** from inside the summary editor — the result replaces the editor
  content, so it is reviewed before committing. Cancel discards it; only **Apply & Save** persists
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
- Warns before the field's **32,768** character limit (see section 6 — the counter measures HTML,
  not visible text)

---

### Reading the wealth plan's JSON

The plan comes back as JSON inside a text response, and reading it is the single biggest source
of *"No wealth plan data was returned"* — **the data is there, the parse fails**. Two rules:

**1. Try the least destructive repair first.** The previous version normalised smart quotes up
front, which corrupts valid JSON whenever the model writes curly quotes inside a string value:

```
{"note":"Kunden sa “vi vil spare mer”"}     parses
{"note":"Kunden sa "vi vil spare mer""}     ← after the "fix", broken
```

Because the model only *sometimes* writes curly quotes, the same input worked one run and failed
the next. `_parseAiJson` now tiers the repairs — `as-is` → `trailing-comma` → `smart-quotes` →
`truncation` — each tried only once the cheaper one has failed, so a response that would have
parsed is never mangled.

**2. Match brackets, don't `lastIndexOf`.** `_extractJson` walks the text tracking string state
and escapes, so prose written after the JSON is excluded even when it contains a brace, and a
response cut off by a token limit is *reported* as truncated rather than silently mis-sliced.
`_repairTruncated` then discards only the incomplete tail, so a half-written record costs that
record instead of the whole plan.

Failure is no longer one message. `_noStructuredDataReason` is `no-json` / `truncated` /
`unparseable`, and the banner says which. This matters: the old copy always read *"too little to
work from"* and told the advisor to add **more** input — wrong when the content was there and
failed to parse, and actively counterproductive after a truncation, where more input makes a
repeat likelier. The "add a document / add context" suggestions now appear only for `no-json`.

`advisorWealthPlan/__tests__/wealthPlanParsing.test.js` drives the real component with a mocked
Apex response and covers every payload shape that used to fail.

---

## 5. Configuration — for admins

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
- `briefEnabled` / `briefOpenByDefault` — **deprecated and inert.** The Brief Summary feature was
  removed; both properties remain declared only because the screen Flow still binds them
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

## 6. Data model

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

## 7. Apex API reference

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

## 8. Security

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

## 9. Flows

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

## 10. Gotchas for the next developer

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

## 11. Testing and verification

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

## 12. Related documents

- `DEFECTS.md` — current findings with status, plus the full changelog
- The improvement backlog, tiered by risk, covering the committed-tests gap, the `saveMode`
  assertions, keyboard access, Apex hygiene and the CSS prune
