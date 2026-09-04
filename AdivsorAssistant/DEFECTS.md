# Advisor Assistant — code review findings

Review of `advisorAssistant` and its two live children, `advisorMeetingSummary` and
`advisorWealthPlan`. `wealthPlanHelper` was deliberately excluded — it is the superseded
original and is not referenced by any of the three.

Every finding below was verified against the source, not inferred. Nothing here has been
fixed: this pass added documentation comments only. Each site also carries an inline
`FIXME` pointing back to the item number here.

**Bottom line.** One latent runtime error waiting on a one-line change to trigger it, five
things that are silently wrong, and one structural problem — roughly 60% of
`advisorAssistant.js` is unreachable — that is the direct cause of most of the rest.

Nothing here breaks a working deployment today. The templates were run through the real LWC
compiler and all three parse cleanly, and `eslint` reports the same 230 pre-existing errors
before and after this pass. The findings are things that will bite on the next edit, not
things failing now — with one exception, #3, which is wrong on every wealth-plan save.

---

## Fixed

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

### 1. Stray `</div>` — `advisorAssistant.html:1166`

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

### 2. `this.inputAccountId` is never declared — all three components

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

### 3. Two uncontrolled `<textarea>`s — `advisorAssistant.html:545, 660`

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

**Fix:** bind `value={_freeText}` / `value={_regenInstructions}` on the element instead.

### 4. Unstable list key — `advisorAssistant.html:626`

```html
<template for:each={_sharedFiles} for:item="f" for:index="idx">
    <li key={f.name} ...>
```

Filenames are not unique. Uploading two files with the same name produces duplicate keys,
which LWC treats as an error condition and which corrupts the rendered list.

**Fix:** `key={f.documentId}` — already present on these objects and guaranteed unique.

### 5. No `error` branch on any `getPicklistValues` wire — all three components

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

### 6. `_uploadFeedbackTimer` not cleared on teardown — `advisorAssistant.js:697, 1542`

`disconnectedCallback` (2816-2845) clears `_eventsLoadingTimeoutId`, `_progressTimerId` and
both loading cycles, but not this 3-second timer. Closing the modal within 3 seconds of an
upload leaves it to fire into a torn-down component.

**Fix:** add `if (this._uploadFeedbackTimer) clearTimeout(this._uploadFeedbackTimer);` to
`disconnectedCallback`.

### 7. Permanently inert global key listener — `advisorAssistant.js:570, 5494`

`connectedCallback` registers `_handleKeyDown` on `document` on every mount. Its first line
is `if (this._step !== 'review') return;`, and `_step` is pinned to `'summary'` by
`connectedCallback` — no live path in this component ever sets `'review'`, because the grid
those shortcuts drive moved to `advisorWealthPlan`. The listener does nothing but run and
return on every keystroke in the page.

**Fix:** remove the registration here; the working copy lives in the child.

### 8. Unreachable editor seeding — `advisorAssistant.js:595, 603`

`renderedCallback` seeds `this.refs.summaryEditor.innerHTML` and
`this.refs.briefEditor.innerHTML`. Neither ref exists: `advisorAssistant.html` declares
exactly one, `lwc:ref="focusAbsorber"`. Both branches are dead. The live editors are in
`advisorMeetingSummary`.

### 9. `_msState` initialised with half its keys — `advisorAssistant.js:2983`

```js
@track _msState = { canPublish: false, canDelete: false, hasUnpublishedSummary: false, hasUnsavedChanges: false };
```

The child emits eight keys. `hasSummary`, `isPublished`, `isGenerating` and `isSaving` are
`undefined` until the child's first `msstatechange`. Benign today — the affected footer
buttons just stay hidden during that window — but any future `if (!this._msState.isSaving)`
would read `undefined` as false and act on a state that has not been reported yet.

**Fix:** initialise all eight keys to `false`.

### 10. Meta ↔ JS gaps — `advisorAssistant.js-meta.xml`

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

### 11. ~60% of `advisorAssistant.js` is unreachable

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

**Recommendation:** delete the dead JS, markup and CSS as a separate, dedicated change with
sandbox regression testing — not folded into feature work. Deleting it would have prevented
four of the findings in this report.

### 12. No tests

`sfdx-lwc-jest` is configured in `package.json` and wired into the `lint-staged` pre-commit
hook, but there is no `__tests__` directory anywhere in the repo. Every one of these
components is thousands of lines with substantial parsing, routing and state logic
(`_parseResult`, `_invokeWpSaveSubflow`, `_applyEventSelection`) that is straightforward to
unit test and currently is not covered at all.

### 13. The backend contract is undocumented and unversioned

`MeetingSummaryController` and every custom object (`MeetingNote__c`,
`MeetingNoteVersion__c`, `Meeting_Artifact__c`, `Household_Milestones__c`,
`Company_Ownership__c`, `SustainabilityPreferences__c`, `FF_Income__c`,
`FF_PersonalGreeting__c`) are org-resident and absent from this repo —
`force-app/main/default/classes/` and `objects/` are both empty, and there are no flows or
message channels. The nine `*FlowApiName` properties are admin-supplied strings resolved at
runtime.

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
