# Advisor Assistant — findings and changelog

Review of `advisorAssistant` and its three live children — `advisorMeetingSummary`,
`advisorWealthPlan` and `advisorInternalNotes` — plus the shared `advisorHtmlSanitizer` module.
`wealthPlanHelper` is deliberately excluded: it is the superseded original.

**How to read this file.** The table below is the current truth for every numbered finding. The
detailed write-ups that follow keep their original numbering and now carry a status in the
heading. Everything from `## Changelog` down is history, newest last — do not read it for current
state.

**Status: 2026-09-08.** Of the 13 original findings: **4 fixed or resolved** (1, 4, 9, 10),
**2 partly fixed** (3, 13), **1 withdrawn** because its premise was false (7), and **6 open**
(2, 5, 6, 8, 11, 12). The original preamble's "nothing here has been fixed" and "#3 is wrong on
every wealth-plan save" no longer hold.

### Status at a glance

| # | Finding | Status |
|---|---|---|
| — | `WealthPlanHelper` is not defined | **Fixed** — zero-risk pass |
| 1 | Stray `</div>` in `advisorAssistant.html` | **Fixed** 2026-09-08. Verified with a comment-aware scanner: 0 extra closes, 0 unclosed. Prettier could not parse the file before; it can now |
| 2 | `this.inputAccountId` is never declared | **Open.** Used once in each of the three components, declared in none |
| 3 | Uncontrolled `<textarea>`s | **Partly fixed** 2026-09-08. The regen boxes are fixed via `_syncTextarea`; the `_freeText` ones are latent, not live — their only programmatic writers (`handleWpTemplate`, `handleMsTemplate`, `handleToggleMicrophone`) are referenced in neither template |
| 4 | Unstable list key | **Resolved.** All four `key=` values are now record properties (`f.name`, `r.key`, `ev.id`, `af.id`). Caveat: `key={f.name}` is used twice and a file name is not guaranteed unique |
| 5 | No `error` branch on any `getPicklistValues` wire | **Open.** Handlers destructure `{ data }` only, so a picklist failure is silent |
| 6 | `_uploadFeedbackTimer` not cleared on teardown | **Open.** Still fires into a torn-down component |
| 7 | "Permanently inert" global key listener | **Withdrawn — the premise was false.** `_step = 'review'` *is* assigned, at `advisorAssistant.js:2044` in the existing-data tab path. The listener is not provably dead and stays registered |
| 8 | Unreachable editor seeding in the parent | **Open.** `summaryEditor` / `briefEditor` refs live in the child, not the parent |
| 9 | `_msState` initialised with half its keys | **Fixed.** 9 keys, matching what the child emits |
| 10 | Meta ↔ JS gaps | **Fixed.** 79 `@api` properties, 79 `<property>` entries, 0 gaps |
| 11 | Large unreachable surface | **Open, and re-measured** — see the entry for the real numbers |
| 12 | No tests | **Open, and sharper** — see the entry |
| 13 | Backend contract undocumented and unversioned | **Partly fixed.** The Apex now carries 27 contract blocks documenting Flow inputs and outputs. Still unversioned |

### Open findings from later sessions

| Finding | Detail |
|---|---|
| Copy summary is built and unreachable | `handleCopySummary`, `_summaryCopied`, `summaryCopyClass`, `summaryCopyLabel` and five `.wph-summary-copy-btn` rules all exist; no template has ever referenced them. Wiring it up needs the source repointed from `_meetingSummaryResult` (only set on a fresh generation) to `summaryDisplayHtml`. *Raised, not selected.* |
| No search in the event picker | No filter of any kind, and "All" is now a range option, so the list can be a long scroll. *Raised, not selected.* |
| Blank-subject to-do's | `handleAcceptAllTodos` accepts any row and `saveTodos` passes `Subject: ''` through, so a Task with no subject can be created. *Raised twice, not selected.* |
| Keyboard access | Six controls cannot be reached by keyboard: `handleArtifactFileSelect`, `handleToggleSection`, `handleTaskToggle`, `handleSharedFileIncludeToggle`, `handleToggleMeetingSummary`, `handleScrollToError`. Modal backdrops are fine — Escape closes them and a backdrop should not be focusable |
| Apex hygiene | 12 `System.debug` calls, all in `saveTodos`, one logging the entire to-do JSON. 9 `AuraHandledException`s concatenate raw `e.getMessage()`, so Flow internals reach the advisor's toast verbatim |
| `saveMode` is untested | It is the flag that stops an internal-notes save blanking `Note__c`, and no test asserts it. 17 of the 21 Apex tests only assert that an exception is thrown |
| Org-wide Apex coverage is 42% | **Not this project's code.** `MeetingSummaryController` is at 83% and effectively maxed — its uncovered lines are all after `Flow.Interview.start()`. The 42% is 25+ pre-existing Formue classes at 0%. Deploy Apex with `RunSpecifiedTests` naming `MeetingSummaryControllerTest`, which checks each class individually |

---

## Fixed in the zero-risk pass

Findings 1, 4, 9 and 10 were also fixed later — they are marked in place under their original headings below, so the detail stays with the finding.

### ✅ `WealthPlanHelper` is not defined (was #2) — fixed

Five getters in `advisorAssistant.js` referenced `WealthPlanHelper`, an identifier that did
not exist in the module. It was the class name in the `wealthPlanHelper` fork this file was
copied from; here the class is `AdvisorAssistant`. Reading any of the five threw
`ReferenceError` and would have killed the render. They survived only because nothing bound
them — a landmine that would arm itself the moment someone wired one into the template.

Deleted, along with the four statics that only they used:

```
static _TAB_ACTIVE_STYLE / _TAB_INACTIVE_STYLE
static _SUBTAB_ACTIVE    / _SUBTAB_INACTIVE
get summaryTabStyle / wealthPlanTabStyle / existingTabStyle
get meetingSubtabClass / todosSubtabClass
```

Safe by construction: zero bindings in the LWC compiler's template AST, zero references in
any of the three `.js` files, none `@api`, and absent from all four dynamic-access name
lists. Live tab styling was and remains `aaTabSummaryClass` / `aaTabWealthPlanClass` /
`aaTabTodosClass`. The two sibling components have the same getters with the correct
receiver, so they were untouched — they are merely unused (see #11).

Two smaller items went with it:

- The unused `interimTranscript` accumulator in all three `onresult` handlers — declared and
  appended to, never read. Only `finalTranscript` is committed.
- The three `console.error('[WealthPlanHelper] JSON.parse failed:')` tags, which sent anyone
  debugging malformed AI JSON to a component that is not running. Each now names its own
  component.

**Verified:** ESLint 230 → 217 errors, with `no-undef` eliminated entirely (10 → 0) and
`no-unused-vars` down by exactly 3; every other rule's count unchanged. All three templates
still compile clean. AST reachability re-run confirms the live-member set is identical
(407 / 416 / 438) with only the nine deleted names gone.

---

## Misplaced markup

### 1. ✅ FIXED (2026-09-08) — Stray `</div>` — `advisorAssistant.html:1166`

The template is not well-formed: 162 `<div>` opens against 163 closes.

Walking the tag stack (comments stripped, void and self-closing tags excluded):

| line | tag | closes |
|---|---|---|
| 1090 | `</div>` | `containerClass`, opened line 88 |
| 1147 | `</div>` | `wph-overlay-panel-wrap`, opened line 80 |
| 1148 | `</div>` | `rootWrapperClass`, opened line 69 |
| **1166** | **`</div>`** | **nothing — the open element is `<template lwc:if={showMainContent}>` from line 68** |

**This does not block deployment.** Verified by running the real LWC template compiler
(`@lwc/template-compiler` 8.28.2, the version this project resolves) over the file: it
parses with zero warnings and zero errors. Its parse5 backend silently discards the
unmatched end tag.

The effect is structural instead. Inspecting the resulting AST, the save-before-generate
modal (line 1098) and the guided-tour overlay (line 1130) both come out as children of
`wph-overlay-panel-wrap`, i.e. **siblings of `containerClass` rather than descendants of
it**:

```
Root
└ <template lwc:if={showMainContent}>        line 68
  └ <div class={rootWrapperClass}>           line 69
    └ <div class="wph-overlay-panel-wrap">   line 80
      ├ <div class={containerClass}>         line 88   ← everything else lives here
      ├ _showSaveBeforeGenerate modal        line 1098 ← should be inside containerClass
      └ _tourActive overlay                  line 1130 ← should be inside containerClass
```

Both are fixed/absolutely positioned overlays, which is why this has gone unnoticed — they
look right today. But they no longer inherit `containerClass`'s stacking context or scroll
container, so any future change to that element's `position`, `overflow`, `transform` or
`z-index` will move or clip them in a way that looks unrelated to the change that caused it.

**Prettier does reject the file**, unlike the LWC compiler:

```
SyntaxError: Unexpected closing tag "div". It may happen when the tag has already
been closed by another tag. (1166:9)
```

So `npm run prettier:verify` fails, and the `lint-staged` pre-commit hook cannot format
this file — which is very likely why the whole repo is currently unformatted. Fixing this
one line unblocks formatting for the bundle.

The three closing comments in that area were also off by one level; they have been corrected
as part of this documentation pass.

**Fix:** delete line 1166. Low risk, but re-check the two overlays visually afterwards —
moving them inside `containerClass` is the point of the fix, and it will change their
containing block.

## Silently wrong

### 2. ⚠️ OPEN — `this.inputAccountId` is never declared — all three components

| file | line | reached at runtime? |
|---|---|---|
| `advisorWealthPlan.js` | 4469 | **yes** — every wealth-plan save |
| `advisorMeetingSummary.js` | 4572 | no (inherited dead code) |
| `advisorAssistant.js` | 5038 | no (inherited dead code) |

```js
const resultStr = await saveWealthPlan({
    flowApiName: this.wealthPlanSaveFlowApiName,
    recordsJson: JSON.stringify(payload),
    accountId:   this.inputAccountId || ''      // always ''
});
```

No `inputAccountId` property is declared anywhere in any of the three classes — not as
`@api`, not as a field, not in any meta XML. It is always `undefined`, so Apex always
receives `accountId: ''`.

Whether this has visible impact depends on whether the save Flow actually uses the
parameter — worth checking in the org. The intended value is almost certainly
`_resolvedPrimaryMemberId`, which every one of these classes does define.

**Fix:** `accountId: this._resolvedPrimaryMemberId || ''`, after confirming what the Flow
expects.

### 3. ◐ PARTLY FIXED (2026-09-08) — Uncontrolled `<textarea>`s

```html
oninput={handleParentNotesTextarea}>{_freeText}</textarea>
oninput={handleRegenInstructionsInput}>{_regenInstructions}</textarea>
```

Writing the value as textarea **child text** seeds it on the first render only; LWC does
not re-apply it. The handlers keep the JS state correct, but assigning the property in JS
does not update what the user sees.

Concrete symptom: `handleRunRegenerateInstructions` (`advisorAssistant.js:2876`) sets
`this._regenInstructions = ''` after sending the instructions, expecting the box to clear.
It does not — the text stays on screen, so it looks as though the instructions were never
submitted.

**What was actually done (2026-09-08).** Binding `value={...}` does **not** work — LWC does not
reflect `value` on a native `<textarea>`, which is the defect itself. Instead each affected
textarea got an `lwc:ref`, and a `_syncTextarea(refName, value)` helper writes the element
directly wherever the backing field is set programmatically. Applied at the one live site in
`advisorAssistant` (`handleRunRegenerateInstructions`) and all three in `advisorMeetingSummary`
(`resetState`, `_applyEventSelection`, `handleRegenerateSummary`).

**Still latent, not live: the `_freeText` boxes.** Both their handlers read *from* the DOM, and
their only programmatic writers — `handleWpTemplate`, `handleMsTemplate`,
`handleToggleMicrophone` — are referenced in neither template. If one is ever wired up it must
call `_syncTextarea`. The inline comment says so.

The two `_modalInstructions` textareas need nothing: their modals sit inside `lwc:if`, so the
element is destroyed and recreated around every clear.

### 4. ✅ RESOLVED — Unstable list key

```html
<template for:each={_sharedFiles} for:item="f" for:index="idx">
    <li key={f.name} ...>
```

Filenames are not unique. Uploading two files with the same name produces duplicate keys,
which LWC treats as an error condition and which corrupts the rendered list.

**Fix:** `key={f.documentId}` — already present on these objects and guaranteed unique.

### 5. ⚠️ OPEN — No `error` branch on any `getPicklistValues` wire — all three components

Twelve wires in `advisorAssistant.js` (`887-947`), eleven in each child. Every one:

```js
wiredGoalValues({ data }) {
    if (data) { this._goalPicklistOptions = data.values.map(...); }
}
```

A failure — field-level security, a renamed field, a wrong record type — is silent. The
option list simply stays empty, and `_isValidOption` reads an empty list as "not loaded
yet, skip validation":

```js
if (!opts || opts.length <= 1) return true;   // picklist not loaded yet, skip validation
```

So a metadata failure does not surface as an error; it silently **disables validation** for
that field, and invalid values pass through to the save. The leniency itself is correct —
without it every row would flash red during the wire round-trip — but a genuine error is
currently indistinguishable from a slow load.

This matters most in `advisorWealthPlan`, whose wires actually feed the rendered grid. In
the other two the wires only feed dead code (finding #11), though they still run.

**Fix:** destructure `{ data, error }`, and track a per-picklist `loaded` / `failed` flag so
`_isValidOption` can distinguish "still loading" from "could not load".

---

## Resource and correctness hygiene

### 6. ⚠️ OPEN — `_uploadFeedbackTimer` not cleared on teardown

`disconnectedCallback` (2816-2845) clears `_eventsLoadingTimeoutId`, `_progressTimerId` and
both loading cycles, but not this 3-second timer. Closing the modal within 3 seconds of an
upload leaves it to fire into a torn-down component.

**Fix:** add `if (this._uploadFeedbackTimer) clearTimeout(this._uploadFeedbackTimer);` to
`disconnectedCallback`.

### 7. ❌ WITHDRAWN — the premise was false. `_step = 'review'` is assigned at `advisorAssistant.js:2044`, so the listener is NOT inert and stays registered

`connectedCallback` registers `_handleKeyDown` on `document` on every mount. Its first line
is `if (this._step !== 'review') return;`, and `_step` is pinned to `'summary'` by
`connectedCallback` — no live path in this component ever sets `'review'`, because the grid
those shortcuts drive moved to `advisorWealthPlan`. The listener does nothing but run and
return on every keystroke in the page.

**Fix:** remove the registration here; the working copy lives in the child.

### 8. ⚠️ OPEN — Unreachable editor seeding in the parent

`renderedCallback` seeds `this.refs.summaryEditor.innerHTML` and
`this.refs.briefEditor.innerHTML`. Neither ref exists: `advisorAssistant.html` declares
exactly one, `lwc:ref="focusAbsorber"`. Both branches are dead. The live editors are in
`advisorMeetingSummary`.

### 9. ✅ FIXED — `_msState` initialised with half its keys

```js
@track _msState = { canPublish: false, canDelete: false, hasUnpublishedSummary: false, hasUnsavedChanges: false };
```

The child emits eight keys. `hasSummary`, `isPublished`, `isGenerating` and `isSaving` are
`undefined` until the child's first `msstatechange`. Benign today — the affected footer
buttons just stay hidden during that window — but any future `if (!this._msState.isSaving)`
would read `undefined` as false and act on a state that has not been reported yet.

**Fix:** initialise all eight keys to `false`.

### 10. ✅ FIXED — Meta ↔ JS gaps (79 properties, 79 meta entries, 0 gaps)

Four `@api` properties exist in JS with no `<property>` entry, so a Flow cannot bind them:

| property | direction |
|---|---|
| `outputNoteMarkdown` | output |
| `outputMeetingType` | output |
| `outputHasTodos` | output |
| `inputWealthPlanId` | input |

`outputNoteMarkdown` is the notable one: it carries the Markdown mirror of the note that
the client-facing web app is meant to consume, and no Flow can currently read it.

Separately, the `lightning__RecordPage,lightning__AppPage` target exposes 21 properties,
**none** of which are the `input*` record collections. On a record page every collection is
empty by construction, so only the modal/launcher and child-driven generation paths do
anything there. If that is intended, it is worth stating in the component description; if
not, the collections need exposing or the record-page target dropping.

---

## Structural

### 11. ⚠️ OPEN — a large unreachable surface (re-measured below)

306 of 601 class members are referenced by neither `advisorAssistant.html` nor anywhere else
in the JS. Roughly 3,400 lines. It is the pre-split monolith, copied rather than moved when
the component was broken into a parent and two children, and now duplicated inside
`advisorMeetingSummary.js` and `advisorWealthPlan.js`.

Large orphaned regions (marked with `LEGACY (unreachable)` banners in the source):

| region | live replacement |
|---|---|
| summary regenerate / editor / save / publish / delete / versions | `advisorMeetingSummary` |
| task picker, file upload, dictation, step gauge | parent's Configuration cards + child |
| to-do accept / edit / save (`saveTodos` Apex) | `advisorMeetingSummary` |
| `handleGenerate`, `_parseResult`, `reviewSections`, merge/diff/undo/keyboard, `saveWealthPlan` | `advisorWealthPlan` |

The same pattern holds in CSS: about 723 `.wph-*` rules against roughly 162 live `.aa-*`
rules, with the children each carrying their own copies of the `.wph-*` ones.

This is the single largest maintenance risk in the codebase, and it is the direct cause of
findings #2, #6, #7 and #8 — each is a copy-paste artefact that survived because nothing
exercises the code it lives in. It also makes the file actively misleading: a reader cannot
tell which `handleSaveSummary` matters without cross-referencing the template.

**Re-measured 2026-09-08.** Across the three big bundles, **~1,450** class selectors have no
reference I can find statically — 568 in `advisorAssistant`, 456 in `advisorMeetingSummary`,
429 in `advisorWealthPlan`, out of ~2,445 declared.

**That count is not trustworthy, and the reason matters.** Classes are assembled from fragments
in template literals — `` `wph-chevron${...}` ``, `'wph-left-tab' +`, at least eight such
patterns — and some are applied from a sibling bundle's JS. A spot-check found `wph-row-locked`
and `segment-active` flagged as orphans while both appear in JS. So the true figure is lower and
every candidate needs individual verification.

**This is the change that already broke the component.** On 2026-09-01 a dead-code and CSS prune
made the event buttons unclickable and had to be reverted wholesale; the CSS prune was the prime
suspect and the root cause was never confirmed. See the changelog entry below.

**Recommendation:** do not attempt this until finding #12 is closed. Then: per-class
verification, batches of about 20, the class-coverage gate plus a visual pass after each batch,
each batch deployed separately. Nothing an advisor sees changes, so there is no reason to rush
it.

### 12. ⚠️ OPEN — No committed tests

The toolchain is fully installed and completely unused:

```
@salesforce/sfdx-lwc-jest ^7.0.2      jest.config.js        npm test -> sfdx-lwc-jest
eslint-plugin-jest ^28.14.0           husky + lint-staged pre-commit

$ npx sfdx-lwc-jest
  No tests found, exiting with code 0
```

**And 230 assertions already exist — in a scratchpad, not the repo.** Written across the
2026-09-07/08 sessions and re-run before every deploy: 38 for the HTML sanitiser (XSS payloads),
42 for the to-do display model, 57 for internal-notes autosave and the length guard, 19 for the
textarea sync, 32 for the edit modals, 42 for the tour selectors. That scratchpad has been wiped
twice, and the verification gates (`tc.js`, `css-compile.js`, `gate.js`) have had to be rebuilt
from scratch each time.

**This is the highest-value open item**, because it is what makes finding #11 — and every other
medium or high-risk change — safe to attempt. Nothing at runtime changes:

- `advisorHtmlSanitizer` ports directly; it is a plain module and the security-relevant code
- `advisorInternalNotes` mounts with `createElement` + `jest.useFakeTimers()`; `@salesforce/apex/*`
  and `lightning/*` imports are auto-stubbed by sfdx-lwc-jest
- the three large components keep the source-extraction approach (Babel-parse the class, install
  named methods onto a stub), labelled as such since it tests method bodies rather than wiring
- the gates become `scripts/verify-lwc.js` + `npm run verify`

### 13. ◐ PARTLY FIXED — the Apex contract is documented; still unversioned

**Partly addressed.** `MeetingSummaryController.cls` and `MeetingSummaryControllerTest.cls` are
now in the repo, along with **11** flows, and the controller carries **27** contract blocks
documenting each method's Flow inputs and outputs. The `*FlowApiName` properties are still
admin-supplied strings resolved at runtime — configured on the `AdvisorAssistant_SCR_AI_Helper`
Flow screen, not on the Advisor Assistant Flexipage, which has none of them set.

**Still open.** `force-app/main/default/objects/` is empty, so every custom object
(`MeetingNote__c`, `MeetingNoteVersion__c`, `Meeting_Artifact__c`, `Household_Milestones__c`,
`Company_Ownership__c`, `SustainabilityPreferences__c`, `FF_Income__c`,
`FF_PersonalGreeting__c`) remains org-resident and invisible to version control — including
`Internal_Notes__c`, whose **32,768** character limit the client now has to know about and
enforce locally. And the contract is still unversioned: nothing fails at build time if a Flow's
inputs change underneath the component.

The consequence is that nothing in version control can tell you whether an Apex signature
changed, and nothing fails at build time if it did. The contract as inferred from the call
sites:

| method | parameters | returns |
|---|---|---|
| `generateSummary` | called with **three different subsets** — full generation (`flowApiName, eventId, accountId, documentId1..3, additionalContext, meetingType, hasTodos, saveDoc1..3AsArtifact`), brief (`flowApiName, eventId, accountId, currentSummary`), wealth plan (`flowApiName, documentId1..3, additionalContext, meetingNoteText`) | `String` — summary HTML, or JSON `{summary, brief}` from the older combined Flow |
| `generateMeetingTodos` | `flowApiName, eventId, accountId, documentId1..3, meetingType, hasTodos, additionalContext` | `String` — JSON array, possibly ```-fenced |
| `regenerateMeetingSummary` | `flowApiName, currentSummary, instructions, documentId` | `String` |
| `saveMeetingNote` | `flowApiName, noteId, noteHtml, noteMarkdown, briefHtml, briefMarkdown, eventId, published, meetingType, deleteNote` | `String` — saved note Id |
| `saveTodos` | `flowApiName, todosJson, eventId, whoId` | `String` |
| `saveFileToEvent` | `flowApiName, contentDocumentId, eventId` | void / `String` |
| `saveWealthPlan` | `flowApiName, recordsJson, accountId` | `'Saved'`, or JSON `{errors: [...], successSections: [...]}` |
| `getMeetingNoteVersions` | `flowApiName, eventId` | `List<MeetingNoteVersion__c>` with at least `Id, Name, Status__c, DateActive__c, Note__c, BriefSummary__c` |

Because `generateSummary` is invoked with three different parameter subsets, every one of
its parameters must be individually optional on the Apex side — a comment at
`advisorMeetingSummary.js:2913` confirms Apex guards with `isNotBlank` / `!= null` before
injecting values into the Flow.

**Recommendation:** pull the Apex class and the custom objects into this repo so the
contract is versioned alongside its only consumer.

---

## What was checked and found correct

Worth recording, so the same ground is not re-covered:

- All 211 distinct `{binding}` names in `advisorAssistant.html` resolve to a real `@api`,
  `@track`, getter or handler. No missing members.
- Only three static CSS class names appear in the markup without a matching rule
  (`aa-event-info-participants`, `aa-event-list-item`, `cke_editable`) — the last one
  deliberately, to keep Salesforce's inline-edit `E` shortcut from firing.
- Every `await` on Apex is wrapped in `try/catch/finally` with a toast and a busy-flag
  reset. `_loadVersionHistory` is the one deliberate exception (swallows and returns `[]`).
- Every generation path emits its completion event (`summarychange` / `todoschange` /
  `wpgenerated`) on the error and missing-configuration paths as well as on success — which
  is what stops the parent's loaders from spinning forever.
- The apparent `@api showEditTracking = false` vs `default="true"` mismatch in the meta XML
  is deliberate and correct: an `@api` Boolean cannot default to true, and Flow passes
  booleans as strings, so `_on()` resolves "enabled unless the string 'false' arrived".
- Teardown in all three `disconnectedCallback`s is otherwise complete — both key listeners
  removed, `document.body.style.overflow` reset, intervals cleared.

---

---

# Changelog

Newest last. **Not current state** — use the tables at the top of this file for that.

## Note — 2026-09-01: dead-code removal attempted and reverted

A full removal of the unreachable code (~19,300 lines across the three bundles) was built
and passed every static gate: AST reachability closure, the real `@lwc/template-compiler`
and `@lwc/style-compiler`, ESLint (217 → 85 with no new rule), the parent↔child contract
check, and `sf project deploy --dry-run`.

It still broke the UI in the `fulltest` sandbox — **the event buttons stopped being
clickable** — and was reverted. The org and the working tree are back to the state
described by the findings below.

The lesson for the retry: reachability is not behaviour. Nothing in that toolchain can
catch a pruned CSS rule that leaves an invisible element capturing clicks, or a removed
class that changes stacking or `pointer-events`. The prime suspect is the CSS pruning —
the JS deletions were proven unreachable, whereas the stylesheet pass removed ~9,600 lines
on a heuristic that only checked whether a class name appeared in the template or in a JS
string literal.

Retry in small, individually deployed and smoke-tested slices, JS before HTML, and treat
CSS pruning as its own separate high-risk step.

## Fixed — wealth plan generated nothing (2026-09-07)

**Symptom.** Generating a wealth plan sometimes produced 0 sections and rendered the model's
own prose as the meeting summary: *"This is an empty JSON object. The user did not provide any
text from which to extract information."*

**Cause.** `_includeMeetingSummary` was latched in `_applyEventSelection` from
`selectedEventNote`. LWC assigns `@api` properties in template attribute order, and in
`advisorAssistant.html` `selected-event-id` is attribute 3 while `input-events` (24) and
`input-meeting-notes` (25) arrive later — so on mount `selectedEventNote` was still null and the
flag froze `false`. `meetingNoteText` was then suppressed even when a summary existed. Changing
the event while the component was already open resolved correctly, which is why it read as
intermittent. 4 of the 6 setter orders lost; the real template order was one of the losing ones.

**Fix.** `_syncIncludeMeetingSummary()` re-derives the default from every setter that can change
the answer (`selectedEventId`, `inputEvents`, `inputMeetingNotes`), and stops once
`_includeMeetingSummaryTouched` records that the advisor chose for themselves. Applied to both
`advisorWealthPlan` and `advisorMeetingSummary`.

**Also.** `_parseResult`'s catch now sets `_noStructuredData` and renders an explicit error state
instead of presenting a failed generation as a successful one, and `handleGenerate` refuses
up-front when there is no document, no context and no meeting-note text to send.

**Not the cause.** The children's resets of parent-owned `_selectedArtifactFileIds` /
`_sharedFiles` / `_currentNoteHtml` were suspected first. Simulating all 24 setter orders showed
none of them produces an empty document payload — the parent re-selects on a microtask after the
child clears. Still redundant, still worth removing, but a separate low-risk item.

## Changed — regenerate & edit UX on the Meeting Summary tab (2026-09-08)

- Wealth Plan regenerate-with-instructions removed again; the footer CTA reads "Generate Wealth
  Plan" as before. Only the generation bug fix above remains from that turn.
- The Configuration card's regenerate CTA now reads "Regenerate Meeting Summary with
  Instructions", is amber rather than the navy of the primary Generate action, and is rendered
  only when `canRegenerateInstructions` — previously it was always on screen and merely
  disabled, offering an action that could not do anything.
- Both edit modals gained a `document.execCommand` formatting toolbar (bold/italic/underline,
  H2/H3/paragraph, both list types, indent/outdent, link/unlink, clear). `handleToolbarMouseDown`
  preventDefault is load-bearing: without it the button takes focus and the caret selection is
  lost, so every command becomes a silent no-op. `lightning-input-rich-text` was rejected because
  it sanitises to its own tag set and would drop structure from client-facing summaries.
- Both modals gained an in-editor regenerate strip. The result fills the editor only — it never
  writes `_currentNoteHtml` and never dispatches `summarychange`, so Cancel discards it and only
  Apply & Save persists. `currentSummary` is the live editor value, so hand edits are carried in.
  Busy state is `_modalRegenerating`, kept separate from `_summaryGenerating` so the panel behind
  the modal and the parent's footer do not react.
- New optional `regenerateBriefFlowApiName`, falling back to `regenerateSummaryFlowApiName`.
  The fallback rewrites summary-shaped, because the only rewrite prompt template on the org is
  `Wealth_Plan_AI_Helper_2_3_Meeting_Summary_Rewrite`. Harmless: the output only reaches the
  editor, so a bad shape is discarded with Cancel.
- Edit Brief moved from inside the Brief Summary accordion onto the summary header row beside
  Edit Summary, via `showBriefEditButton` — so the brief is editable without expanding it.
  `.wph-brief-edit-row` removed as orphaned.

### Still open, pre-existing
- `.wph-textarea--regen` and `.wph-brief-loading-badge` are referenced in
  `advisorMeetingSummary.html` with no CSS rule. Both are in the child's own left panel, which
  `embeddedLayout` hides inside advisorAssistant, so neither is visible today.

## Changed — Wealth Plan review de-duplicated (2026-09-08)

The review stacked nine horizontal bands before the first suggestion. Now five.

- **Three bands merged into one** `.wph-review-status`: the stats bar, the review toolbar and the
  validation dashboard. They rendered `totalRecordCount`, `lockedRecordCount` and `totalErrors`
  twice each in different words ("9 locked" directly above "9 accepted") and the completion
  percentage three times. `validationLabel` already states the counts as a sentence, so the
  duplicate chips are gone; the section count and existing-data toggle moved in. All getters
  reused unchanged.
- **The Meeting Summary band was deleted** — it could never render. `hasMeetingSummary` reads
  `_meetingSummaryResult`, which only fills from the `r.kind === 'summary'` branch of
  `handleGenerate`; that task is queued only when `_modeMeetingSummary` is true, and
  `handleGenerate` (the sole generate entry point — `regenerate()` aliases it) sets it false on
  its second line. `handleModeToggle` / `data-mode` are no longer in the template at all.
  Template deletion only: the JS members and CSS behind it are deliberately left in place.
- **The second summary card retitled** "Meeting Summary" → "Analysis Notes". `_summary` is the
  model's prose around the wealth-plan JSON, not the meeting summary, which has its own tab.
- **"Accept all" and "Accept section" made mutually exclusive** (`lwc:elseif`). Both were
  reachable at once and read identically, though they differ — bulk accept confirms first and
  skips errored rows, section accept seals the section in one flag. The section-level one now
  appears only when no individual rows remain, which keeps both handlers, the `Accepted` badge
  and `Undo accept` reachable.
- **One word for one concept.** Visible text standardised on Accept: `Locked` → `Accepted`,
  `Unlock` → `Undo accept` (section and row), `Lock All Valid` → `Accept All Valid`, `To Lock` →
  `To accept`, `Already Locked` → `Already accepted`, `Lock Suggestions` → `Accept Suggestions`,
  the row state title, `N selected` → `N accepted`, and the save toast. `_lockedRows`,
  `_lockedSections` and the undo action types are untouched.
- **The "Save To-dos" bar no longer shows when embedded.** `filteredReviewSections` skips
  `key === 'todos'`, so it was offering to save a section the Wealth Plan tab does not display;
  in Advisor Assistant To-Do's are a separate tab rendered by advisorMeetingSummary.

### Still open, created by the above
- `.wph-val-dashboard`, `.wph-review-stats-bar`, `.wph-review-stats`, `.wph-stat-chip*`,
  `.wph-vc-ok` and `.aa-review-toolbar` are now unreferenced, as are the JS members behind the
  deleted Meeting Summary band (`_meetingSummaryResult`, `hasMeetingSummary`, `summaryTabClass`,
  `summaryChevronClass`, `summaryEditBtnLabel`, `summaryCopyLabel`, `summaryCopyClass`,
  `isSummaryEdited`, `handleToggleSummaryTab`, `handleToggleSummaryEdit`, `handleCopySummary`,
  `handleSummaryInput`). Left in deliberately — CSS pruning and member stripping is what broke
  this bundle before. Separate slice.
- Row and section controls were left as they are: up to 5 buttons per section header and 3-4
  labelled buttons per row. Restructuring them (icon buttons, overflow menu) was considered and
  deferred.

## Changed — the summary and brief now have typography (2026-09-08)

**Root cause of "doesn't look professional": no typography rule in this bundle could reach the
rendered summary.** The LWC style compiler scopes every compound selector —
`.wph-summary-html-body h2` compiles to `.wph-summary-html-body[token] h2[token]` — and the
summary was rendered by `lightning-formatted-rich-text`, whose content lives in that component's
own shadow root and never receives our token. So:

- `.wph-summary-html-body` carried only `padding` and `min-height`; there was no rule anywhere for
  `h1`-`h3`, `p`, `ul`/`ol`/`li`, `strong`, `table` or `blockquote` in the read view.
- The `.wph-rte-editable h1/h2/h3/...` rules for the edit modal were **inert** for the same
  reason: `innerHTML` nodes get no token without `lwc:dom="manual"`, which that div did not declare.
- `_stripStyleBlocks` discards the `<style>` blocks the prompt template emits, and nothing
  replaced them.

**Fix.** All four read views (published summary, historical version, draft summary, brief) and both
editors are now `<div lwc:dom="manual">` painted by `_paintProse`, so the engine stamps scope
tokens onto injected nodes and one shared `.wph-prose` scale applies to reading AND editing.

- `_paintProse(refName, html)` writes only when the html **or the element** changed. The element
  check matters because a ref is destroyed and recreated on branch remount; the html check exists
  because rewriting `innerHTML` on every render collapses the document selection and would break
  `handleSummaryMouseUp` / the "Add as Action Item" popup.
- `.wph-prose--measured` caps the summary at `74ch` and centres it. Embedded,
  `.wph-layout-right` is `width:100%; max-width:none`, so body text ran the full ~1000px+ column.
- New `lwc/advisorHtmlSanitizer` — taking over rendering means taking over the sanitising
  `lightning-formatted-rich-text` did for us, and the HTML comes back from a Flow prompt template
  that reads client documents. Allowlist, not denylist: unknown tags unwrap (text kept),
  `script`/`iframe`/`svg`/`form`/`style` etc. drop with their subtree, all attributes except
  `a[href|title]` and `th|td[colspan|rowspan]` are stripped, and `href` must be
  `http(s):`/`mailto:`/`tel:`/`#`/`/`. Links get `target=_blank` + `rel=noopener noreferrer`.
  38 assertions pass against the real module under jsdom, including `img onerror`, `svg onload`,
  mixed-case and space-padded `javascript:`, `data:` hrefs, unclosed-script markup, and
  "unwrap must not skip siblings".
- The editors' innerHTML seeds go through the sanitiser too — same untrusted source. Net effect on
  lint: `advisorMeetingSummary` **70 -> 68** errors, since those two pre-existing `no-inner-html`
  violations now carry justified disables.
- **The brief is the document's lede, not a warning.** It was `#fffbeb` inside a `#fde68a` border
  under an 11.5px bold amber header — the same amber that now means internal notes and the
  regenerate CTA. Now: no border of its own, a quiet small-caps "AT A GLANCE" label, a navy accent
  rule, `.wph-prose--lede` type. Still a `<button>`, so `briefOpenByDefault` and
  `handleToggleBrief` keep working.
- The summary header's `linear-gradient(135deg, #f0f4f9, #f6f8fa)` is flat `--bg-subtle`, and the
  "Edited" badge moved off amber to neutral.
- `.wph-brief-loading-badge` had **no CSS rule at all** and inherited the toggle's uppercase
  letter-spacing. Given rule.

### Still open
- `advisorInternalNotes` read view should adopt `sanitizeRichText` + `.wph-prose` next.
- `.wph-textarea--regen` still has no CSS rule (child's own left panel, hidden when embedded).
- Print / PDF styling for the summary.

## Changed — To-Do's and Internal Notes (2026-09-08)

### To-Do's
- **You can now add a to-do by hand.** There was no `handleAddTodo` at all, so anything the model
  missed was unrecoverable — while the Wealth Plan has "+ Add" per section. The new row opens
  straight into the existing edit form, so `handleSaveTodoEdit` needed no changes. It carries the
  `_priorityIs*` flags itself, because those are normally computed by `handleEditTodo` on entry
  and a manual row skips that handler. `_key` is `manual-N`, not `todo-N`: a regeneration
  renumbers from `todo-0` and a colliding key would make two rows answer one click.
  Buttons in the save bar and in the `No to-do's yet` empty state.
- **`displayTodos`** — one decorating getter over `_meetingTodos`, which stays the data. Adds
  `_dueLabel` (`no-NO`, was the raw `2026-09-15`), `_isOverdue` (past date on an unsaved row —
  the model readily lifts stale dates out of documents), and `_dueChipClass`. Orders High →
  Normal → Low → unset then earliest due with undated last, pinning any row being edited so it
  cannot move out from under the cursor. Not memoised: LWC diffs the attribute value rather than
  object identity, so fresh row objects cannot stomp the uncontrolled `<input value={todo.Subject}>`
  mid-typing.
- **The priority count chips are filters now** — they were decorative `<span>`s.
- **Accept All is scoped to the visible set.** It used to accept every row in `_meetingTodos`, so
  with a filter on it would silently accept — and then save as Tasks — rows the advisor could not
  see. The label also counts *actionable* rows, not visible ones: the first version said
  "Accept 2 shown" where one of the two was already saved. Disabled when nothing is actionable.
- `Undo` → `Undo accept`, matching the Wealth Plan.
- 42 assertions pass against the real methods, extracted from source rather than retyped.

### Internal Notes
- **Debounced autosave (3s).** Typed notes previously lived only in the in-memory `_cache` until
  the advisor pressed Save, so a reload, a session timeout or a crash lost them — the meeting
  summary has had background autosave all along. `save()` takes an optional `{ silent }` so
  autosave does not toast on success; **failures still toast**. The `@api` signature stays
  backward compatible, so the parent's footer button is unaffected. Conditions are re-checked
  when the timer FIRES, not when it is armed, and the timer is cancelled in `_applyEventChange`
  and `disconnectedCallback` — a pending save must never land against the wrong event or a
  torn-down component. `autosaveDelayMs = 0` disables it.
- **Length guard.** `Internal_Notes__c` is a Rich Text Area of **32768** — a quarter of
  `Note__c`'s 131072 — and rich text counts the markup, so a formatted note runs closer to the
  ceiling than the visible text suggests. Crossing it surfaced as a raw `STRING_TOO_LONG` from
  Apex. Now `maxNoteLength` (overridable, org config), a counter that appears above 75% and names
  formatting as part of the count, `overBy` to say how much has to go, and `isOverLength` blocking
  both the button and autosave.
- `statusLabel` gained `Saving…` and `Too long to save`, so autosave is visible rather than
  mysterious.
- 34 assertions pass against the real methods under a virtual clock.

### Still open
- **Blank-subject to-do's.** `handleAcceptAllTodos` accepts any row and `saveTodos` passes
  `Subject: ''` straight through, so a Task with no subject can be created. Raised and not
  selected for this round.
- Assignee on a to-do — needs `OwnerId` through `saveTodos` and the Flow.
- Click-through to created Tasks — `saveTodos` returns a `SaveResult` string, not ids.
- 15 `System.debug` calls in `MeetingSummaryController.saveTodos`.

## Changed — component-wide quick fixes (2026-09-08)

A sweep across all five bundles. Most candidates turned out to be already handled: the tab bar has
`role="tablist"` with `aria-selected`, `aria-live` regions cover async completion, the event picker
is a keyboard-navigable `<ul>` of `<button>`s, and Escape closes the modals.

- **#3 FIXED on the regen textareas.** LWC writes a `<textarea>`'s value as child text, applied
  only on the first render, so clearing the backing field in JS never reached the DOM. The old
  instructions sat there looking pending and a second press silently re-sent them. Added
  `_syncTextarea(refName, value)` to both components and called it at the one live site in
  `advisorAssistant` (`handleRunRegenerateInstructions`) and all three in `advisorMeetingSummary`
  (`resetState`, `_applyEventSelection`, `handleRegenerateSummary`).
- **#1 FIXED.** The stray `</div>` is gone. Verified with a comment-aware single-pass scanner:
  exactly one spurious close, zero after, no unclosed opens either way. The LWC compiler dropped
  it silently, but Prettier could not parse the file at all — it now parses, in line with every
  other template in the repo (all of which have style diffs and no parse errors).
- **Internal Notes tab now has a status pill.** It was the only tab without one, so from another
  tab there was no way to tell notes were unsaved. Amber for unsaved, pulsing blue while saving,
  with a `title` because a coloured dot says nothing on its own. Driven by the `isDirty`/`isSaving`
  the child already reported through `tabstatechange`.
- **Three modifier classes carrying no rules removed** — `aa-event-list-item` (the `<ul>` already
  sets `list-style: none`), `aa-event-info-participants` (the span already has
  `.aa-event-info-item`) and `wph-textarea--regen` (`.wph-textarea` already styles it). No visual
  change. With `cke_editable` allowlisted in the gate as the deliberate external CKEditor hook it
  is, **all four bundles now report zero classes without a CSS rule** for the first time.
- 19 assertions pass against the real extracted methods, including one asserting the DOM *would*
  go stale without the sync, so a regression is catchable.

### Corrections to this file
- **#7 was wrong and is withdrawn.** It claimed the `document` keydown listener can never run
  because nothing sets `_step = 'review'`. It is assigned at `advisorAssistant.js:2044` in the
  existing-data tab path, so the listener is not provably dead. It stays registered.
- **#3's scope was overstated for the `_freeText` textareas.** Those are a latent hazard, not a
  live bug: both handlers read *from* the DOM, and the only programmatic writers
  (`handleWpTemplate`, `handleMsTemplate`, `handleToggleMicrophone`) are referenced in neither
  template. The inline comment now says so, and points at `_syncTextarea` for whoever wires one up.
- The two `_modalInstructions` textareas need no sync: their modals sit inside `lwc:if`, so the
  element is recreated around every clear. Commented, so nobody "fixes" them.

### Still open
- **Copy summary is built and unreachable.** `handleCopySummary`, `_summaryCopied`,
  `summaryCopyClass`, `summaryCopyLabel` and five `.wph-summary-copy-btn` CSS rules all exist, and
  no template has ever referenced them (checked against the git baseline). Wiring it up needs one
  fix: the handler reads `_meetingSummaryResult`, which is only set on a fresh generation, so it
  would copy nothing for a summary loaded from the record — it should read `summaryDisplayHtml`.
  Raised and not selected.
- **No search or filter in the event picker.** Now that "All" is a range option the modal can be a
  long scroll. Raised and not selected.
- 22 clickable `div`/`span`/`li` across the three big bundles have no `role` or `tabindex` — a real
  keyboard-access gap, too large for a quick fix.
- Unreferenced CSS/JS from the earlier slices; blank-subject to-do's; `System.debug` in `saveTodos`.

## Changed — autosave countdown, summary width (2026-09-08)

- **Autosave now counts down.** `statusLabel` shows `Saving in 3 s…` ticking to 1, in a blue
  "pending" pill rather than the amber of "unsaved changes" — nothing is wrong, a save is simply
  about to happen. A 1s `setInterval` drives it, cancelled everywhere `_cancelAutosave` already
  ran (event change, teardown) and now also at the top of `save()`: a manual save used to leave
  the counter ticking toward a save `canSave` would correctly refuse, which looked stuck.
  Typing restarts it at 3.
- **The summary was too narrow.** `.wph-prose--measured` was `74ch` **centred**, which at the
  panel's real width produced a ~560px column with ~230px of dead space on both sides — and it
  read as broken next to the full-width brief above it. Now `120ch` (~900px) and left-aligned, so
  at normal widths the rule is inert and the summary fills the card like the brief does; it only
  engages on a very wide monitor or console. The brief box's margin moved from 20px to 24px to
  match `.wph-summary-html-body`'s padding, so the two blocks share one left edge.
- The autosave suite grew to 57 assertions and now drives the **real** `save()` — the Apex import
  and `ShowToastEvent` are supplied as globals, since `new Function` bodies resolve free variables
  at call time. That is what caught the manual-save case: the earlier version stubbed `save()`, so
  the cancellation inside it was never exercised.

## Changed — guide audit + tour extended to all four tabs (2026-09-08)

### The audit found more than wording drift
- **Quick Reference contradicted the UI.** Today's rename to *Accept* never reached it, so it
  taught five instructions matching no button: "Green — Locked", "not yet locked", "**Lock** a
  row", "Use **Lock All Valid** or **Lock Section**", "only locked records are saved". All
  corrected, and it now notes that Accept all and Accept section never appear together.
- **All Features was missing seven real features**, none documented anywhere: the event date-range
  selector, file preview, background generation across tabs, version history, select-text → Add as
  Action Item, the Save-to-Wealth-Plan confirmation with its financial-impact delta, and the
  duplicate flag / diff view. Added as a new "Finding & Context" group plus two items in
  "Review & Editing".
- **What's New carried a line that had stopped being true.** "Long summaries also stop running the
  full width of a wide screen" was written for the 74ch measure; after widening to 120ch on
  feedback it only holds on a very wide screen. Reworded. Also added three omissions: Internal
  Notes as a new tab (only its autosave was mentioned), the Pre-Meeting tab being removed, and the
  event date-range selector. v2026.09 now has 12 entries.

### The tour
- **8 steps → 11**, adding Meeting Summary, To-Do's and Internal Notes. Reordered so Generate comes
  before the tab steps (context → generate → where results land), and the tab steps follow the tab
  bar left to right.
- **The Generate step was pointing at the wrong button.** `.aa-primary-cta` matches five elements
  and `querySelector` takes the first in document order, so the step highlighted a different
  Generate button while its text described the footer's persistent CTA. Now scoped to
  `.aa-footer-left .aa-primary-cta`.
- The tour deliberately does **not** switch tabs as it advances: no side effects, and it avoids
  leaving the advisor parked on Internal Notes at the end.
- `_tourDefs` now carries a header explaining that `_positionTour` **silently skips** steps whose
  target is missing (so a stale selector shrinks the tour with no error), that the bubble is placed
  against a fixed `BH = 180` so text must stay under ~170 characters, and that
  `this.template.querySelector` cannot reach the `data-tour` anchors inside advisorMeetingSummary —
  those belong to that component's own separate tour.
- 42 assertions, in jsdom against the real `_tourDefs` and the real template: every selector
  resolves, the Generate step lands inside `.aa-footer-left`, all four tabs are covered in visual
  order, every step is well-formed, and no text exceeds the bubble budget.

## Changed — Brief Summary regeneration removed (2026-09-08)

The brief is adjusted by hand, so its edit modal no longer offers regeneration. The Meeting Summary
editor keeps its own instructions box unchanged.

- Removed from the brief modal: the `wph-modal-regen` strip, the `wph-rte-busy` overlay that
  covered the editor during that regeneration, and `disabled={_modalRegenerating}` on its
  Apply & Save. The `.wph-modal-regen*` / `.wph-rte-busy*` CSS stays — the summary modal uses it.
- `handleModalRegenerate` collapsed to the summary path: no more `isBrief` branching, no brief
  instruction prefix, no flow-name fallback. An explicit `if (this._briefEditMode) return;` states
  the invariant, since the button no longer exists in that modal.
- **`regenerateBriefFlowApiName` removed entirely** — child `@api`, parent `@api`, both child
  mounts in the template, and both `<property>` blocks in `js-meta.xml` (105 → 103 properties).
  It existed only to serve this strip; leaving a configurable *Regenerate Brief Flow API Name* in
  the admin properties that did nothing would have been misleading.
- **Verified no configuration was lost before deploying.** The live *Advisor Assistant* Flexipage
  had **no** `regenerate*` property set at all, so nothing an admin had filled in was dropped. The
  Flow API names are configured on the `AdvisorAssistant_SCR_AI_Helper` Flow screen instead, where
  `regenerateSummaryFlowApiName` is present — so the summary regeneration that stays is wired up.
- What's New said *"Both editors have an instructions box"*. Corrected to name Edit Summary and
  state that the brief is adjusted by hand.
- `modal-sim` rewritten: the five assertions covering brief routing and the flow-name fallback are
  replaced by seven proving the brief path is unreachable (nothing sent, editor and record
  untouched, no busy state left behind) while the summary path still regenerates through the
  summary Flow with the raw instructions. 32 assertions, all passing.

## Investigated — "Wealth Plan generation is slower than wealthPlanHelper" (2026-09-08)

**Not a regression. Advisor Assistant had been skipping work, and the fix restored it.**

Measured directly against `WealthPlan_AL_AI_Helper_Trigger` in `fulltest`, varying only
`MeetingNoteText`:

| Run | Input | Time | Output |
|---|---|---|---|
| A | context only | **4.7 s** | 164 chars |
| B | context + 4,884-char summary | **7.8 s** | 2,130 chars |

The 3.1 s difference is the cost of the summary actually reaching the prompt. Run A is what
"fast" looked like: 164 characters, i.e. the empty-wealth-plan bug.

**Mechanism.** `_includeMeetingSummary` latched `false` because of template attribute order —
`selected-event-id` is attribute 3 while `input-events` is 24 and `input-meeting-notes` is 25 — so
`selectedEventNote` was still null when the child decided. `wealthPlanHelper` was never exposed to
this: it has **no** `@api selectedEventId` and **no** `_applyEventSelection`, because it owns the
event picker internally, so its data has always loaded before the user picks an event. It has
always sent the summary and always paid the ~7.8 s.

**Ruled out, by comparison rather than assumption:**

- Same Apex method and byte-identical arguments — the two `handleGenerate` bodies differ only in
  client-side bookkeeping (the `wpgenerated` event, the pre-flight check, the `_flowOut` helper)
- Same Flow — both host Flow screens configure `flowApiName = WealthPlan_AL_AI_Helper_Trigger`
- Same documents — `artifactFiles` derives identically in both (`selectedEventArtifact` →
  `_inputContentDocumentLinks` → `_inputContentDocuments`), and both `slice(0, 3)`
- Same progress cycle — identical 2,800 ms interval

**Expect parity now**, not an improvement. If advisors still report a difference with identical
inputs, the next step is a browser performance profile — code comparison is exhausted.

**The real lever is documents, not the summary.** The Flow runs `ConvertBlobToString` *per
document* and feeds the full text to the prompt template. Deselecting irrelevant documents saves
more than anything else available. Per-document cost was not measured.

**Client-side weight is a separate matter.** Advisor Assistant mounts four children to
`wealthPlanHelper`'s one, 72 wires against 18. That affects page load and responsiveness, not the
generation round trip.
