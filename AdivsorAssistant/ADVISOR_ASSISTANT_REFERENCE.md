# Advisor Assistant — Reference Documentation

A Salesforce Lightning Web Component suite that helps advisors turn meeting material
(documents, transcripts, notes) into a structured meeting summary, a wealth plan, and action
items — using Einstein prompt templates orchestrated through Flows.

---

## 1. What it does

The advisor opens the Advisor Assistant from an Event, selects supporting material, and generates:

| Output | Description |
|---|---|
| **Meeting Summary** | A client-facing narrative summary, editable, versioned, saved to `MeetingNote__c` |
| **Wealth Plan** | Structured records — goals, income, assets, milestones, ownership, sustainability, greeting |
| **To-Do's** | Action items extracted from the material, saved as `Task` records |
| **Internal Notes** | Advisor-private notes, stored separately from the client-facing summary |

Inputs to generation are: up to **two documents**, **one transcript** (`.txt`), the advisor's
**context notes**, their **personal AI instructions**, and optionally the existing meeting summary.

---

## 2. Architecture

```
Flow screen / App Builder page
   └── advisorAssistant                     ← parent: owns state, file pool, configuration
         ├── advisorMeetingSummary          ← Meeting Summary + To-Do's tabs
         ├── advisorWealthPlan              ← Wealth Plan tab
         ├── advisorInternalNotes           ← Internal Notes
         ├── advisorUserInstructions        ← per-user AI instructions
         └── advisorHtmlSanitizer           ← shared utility module
                    │
                    ▼  imperative Apex
         MeetingSummaryController · UserInstructionController
                    │
                    ▼  Flow.Interview.createInterview(flowApiName, inputs)
         Autolaunched Flows
                    │
                    ▼  generatePromptResponse
         Einstein Prompt Templates
```

### The parent is a broker

`advisorAssistant` owns the shared state — the selected Event, the file pool, the advisor's notes —
and passes it down. Children do **not** fetch their own data. The parent also hosts the
Configuration column, so the file selection UI belongs to the parent even though the children render
pickers over the same pool.

**Consequence:** every child `@api` property must be explicitly passed by the parent. There is no
mechanism enforcing this, and a missing attribute fails *silently* — the child simply sees an empty
value. See §11.

### All panels stay mounted

The tab panels use CSS visibility rather than `lwc:if`, so a background generation is not destroyed
by a tab switch and its result still arrives.

---

## 3. How generation works

Four layers, each with its own naming. **This is the most important section for anyone changing the
system.**

```
LWC               Apex parameter        Flow variable          Prompt template input
─────────────────────────────────────────────────────────────────────────────────────
documentId1   →   documentId1       →   ContentDocumentId1  →  Attachment / Document_1
documentId2   →   documentId2       →   ContentDocumentId2  →  Attachment_2 / Document_2
(the .txt)    →   transcriptDocumentId → Transcription      →  Transcription / TextFileInput
notes         →   notes             →   Notes               →  Notes / Additional_Context
userInstr.    →   instructions      →   Instructions         →  Instructions
summary HTML  →   meetingNoteText   →   MeetingNoteText     →  MeetingNoteText
```

### The transcript is extracted in Apex, not in the Flow

`MeetingSummaryController.extractTranscriptText()` reads the latest `ContentVersion` of the
`.txt` document and passes **plain text** as `Transcription`. The Flows do not read the file
themselves. This is deliberate: it keeps one implementation instead of two.

### Unknown keys are silently dropped

`Flow.Interview.createInterview()` **ignores any input key the Flow does not declare.** It does not
throw. This is why Apex can safely send the full canonical set to every Flow — and also why a
renamed variable causes *missing data* rather than an error.

> **This is the single most important behaviour to understand.** Nearly every defect in this
> system's history has been a name that stopped matching, failing silently.

### Canonical variable set

Apex sends these; each Flow declares the subset it uses.

```
EventId · AccountId
ContentDocumentId1 · ContentDocumentId2 · ContentDocumentId3
Notes             advisor context box
Instructions      per-user AI instructions
Transcription     transcript text, extracted server-side
MeetingNoteText   existing meeting summary
MeetingType · HasTodos · GenerateMode
```

---

## 4. Components

### Lightning Web Components

| Component | Role |
|---|---|
| `advisorAssistant` | Parent. State, file pool, configuration, tab bar |
| `advisorMeetingSummary` | Meeting Summary and To-Do's tabs |
| `advisorWealthPlan` | Wealth Plan tab |
| `advisorInternalNotes` | Advisor-private notes |
| `advisorUserInstructions` | Per-user standing AI instructions |
| `advisorHtmlSanitizer` | Shared sanitising utility |
| `wealthPlanHelper` | **Legacy.** The monolith the others were forked from. Rendered by nothing |

### Apex

| Class | Role |
|---|---|
| `MeetingSummaryController` | All generation and save entry points (9 `@AuraEnabled` methods) |
| `UserInstructionController` | Fetch/save the current user's AI instructions |
| `MeetingSummaryControllerTest` | 20 tests |
| `UserInstructionControllerTest` | 4 tests |

> `MeetingSummaryController` handles wealth plans, to-do's, notes, files and versions too — the
> name is historical.

### Flows

| Flow | Purpose |
|---|---|
| `MeetingSummary_TRG_AI_Summary_Create` | Meeting summary **and** to-do generation (routed by `GenerateMode`) |
| `WealthPlan_AL_AI_Helper_Trigger` | Wealth plan generation |
| `WealthPlan_TRG_Helper_Data` | Up-front data fetch for the component |
| `AdvisorAssistant_SCR_AI_Helper` | Screen flow that hosts the component |
| `WealthPlan_AL_Meeting_Summary_Save_Update` | Saves `MeetingNote__c` and internal notes |
| `WealthPlan_AL_Meeting_Summary_Regenerate_Trigger` | Regenerate with instructions |
| `WealthPlan_AL_Meeting_Note_Create_Version` / `..._Get_Versions` | Version history |
| `MeetingSummary_TRG_AI_Meeting_To_Do_s` | Creates `Task` records |
| `WealthPlan_AL_WealthPlan_Create_and_Update_V2` | Wealth plan DML |

> **Naming note:** `_TRG_` does **not** mean trigger and `_AL_` does not reliably mean autolaunched.
> Both are historical. Every flow above except `AdvisorAssistant_SCR_AI_Helper` is autolaunched.

### Prompt templates

| Template | Used by |
|---|---|
| `Wealth_Plan_AI_Helper_2_6_Meeting_Summary` | meeting summary (3 actions) |
| `Wealth_Plan_AI_Helper_To_Do_s_v2` | to-do's (4 actions) |
| `WealthPlan_AI_Create_And_Edit_V4` | wealth plan (3 actions) |
| `Wealth_Plan_AI_Helper_2_3_Meeting_Summary_Rewrite` | regenerate |
| `Wealth_Plan_AI_Helper_2_0_Meeting_Summary` | legacy summary trigger |

---

## 5. Apex API reference

### `generateSummary`
```
flowApiName, eventId, accountId, documentId1, documentId2, documentId3,
additionalContext, notes, instructions, transcriptDocumentId, meetingNoteText,
meetingType, hasTodos, saveDoc1AsArtifact, saveDoc2AsArtifact
→ String (summary HTML)
```
`additionalContext` is a legacy alias for `notes`; whichever is non-blank is used.

### `generateMeetingTodos`
```
flowApiName, eventId, accountId, documentId1, documentId2,
meetingType, hasTodos, notes, instructions, transcriptDocumentId
→ String (JSON array of to-do objects)
```

### Others
| Method | Parameters | Returns |
|---|---|---|
| `regenerateMeetingSummary` | `flowApiName, currentSummary, instructions, documentId` | regenerated HTML |
| `saveMeetingNote` | `flowApiName, noteId, noteHtml, noteMarkdown, briefHtml, briefMarkdown, eventId, published, meetingType, deleteNote` | saved note Id |
| `saveInternalNotes` | `flowApiName, noteId, eventId, internalNotes` | saved note Id |
| `saveTodos` | `flowApiName, todosJson, eventId, whoId` | result string |
| `saveWealthPlan` | `flowApiName, recordsJson, accountId` | JSON result incl. per-section errors |
| `saveFileToEvent` | `flowApiName, contentDocumentId, eventId` | `'success'` |
| `getMeetingNoteVersions` | `flowApiName, eventId` | `List<MeetingNoteVersion__c>` |

### `UserInstructionController`
| Method | Notes |
|---|---|
| `getUserInstruction()` | `cacheable=true`; returns the current user's record or `null` |
| `saveUserInstruction(instructionText, isActive)` | Upserts; one record per user, enforced by querying `UserInfo.getUserId()` |

---

## 6. Flow reference

### `MeetingSummary_TRG_AI_Summary_Create`

| | |
|---|---|
| **Inputs** | `AccountId`, `ContentDocumentId`, `ContentDocumentId1`, `ContentDocumentId2`, `EventId`, `GenerateMode`, `Instructions`, `Notes`, `OutputLanguage`, `Transcription`, `recordId` |
| **Outputs** | `GeneratedSummary`, `GeneratedTodos`, `ErrorMessage`, `DebugLog` |
| **Routing** | `DEC_Which_Mode_is_Triggered` on `GenerateMode`: `summary` → summary branch, `todos` → to-do branch |

### `WealthPlan_AL_AI_Helper_Trigger`

| | |
|---|---|
| **Inputs** | `ContentDocumentId1`, `ContentDocumentId2`, `ContentDocumentId3`, `Instructions`, `MeetingNoteText`, `Notes`, `Transcription` |
| **Outputs** | `GeneratedSummary`, `ErrorMessage`, `DebugLog` |
| **Routing** | Counts **non-text** documents, then routes to a No-Docs / One-Doc / Two-Docs prompt action |

### Error handling and diagnostics

Both generation flows implement the same pattern:

- **Fault connectors** on every action call and record lookup → `Assign_Fault`, which sets
  `ErrorMessage = {!$Flow.FaultMessage}` → `END_FAULT`.
- **`ErrorMessage`** is read by `MeetingSummaryController.readFlowResult()` and thrown as an
  `AuraHandledException`, so the advisor sees the real cause instead of a generic failure.
- **`DebugLog`** is set at a checkpoint before the prompt branch is chosen and records: document
  count, transcript length, notes length, and the document ids. It is written to `System.debug` on
  every run and appended to error messages.
- **No silent dead ends.** Unexpected document counts or an unknown `GenerateMode` set a specific
  `ErrorMessage` rather than ending the interview with empty outputs.

> `FlowTransform` elements do not support fault connectors in API 66.0, so `Get_DocumentId_s` is the
> one element without one.

---

## 7. Configuration

Set on the Flow screen or App Builder page. **These values are not in source control** — they must
be re-entered in every org.

| Property | Points at |
|---|---|
| `flowApiName` | `WealthPlan_AL_AI_Helper_Trigger` |
| `meetingSummaryFlowApiName` | `MeetingSummary_TRG_AI_Summary_Create` |
| `regenerateSummaryFlowApiName` | `WealthPlan_AL_Meeting_Summary_Regenerate_Trigger` |
| `saveSummaryFlowApiName` | `WealthPlan_AL_Meeting_Summary_Save_Update` |
| `versionHistoryFlowApiName` | `WealthPlan_AL_Meeting_Note_Get_Versions` |
| `createVersionFlowApiName` | `WealthPlan_AL_Meeting_Note_Create_Version` |
| `saveTodosFlowApiName` | `MeetingSummary_TRG_AI_Meeting_To_Do_s` |
| `saveInternalNotesFlowApiName` | `WealthPlan_AL_Meeting_Summary_Save_Update` |
| `saveFileToEventFlowApiName` | `WealthPlan_TRG_Save_File_To_Event` |
| `wealthPlanSaveFlowApiName` | `WealthPlan_AL_WealthPlan_Create_and_Update_V2` |

Appearance options: `componentTitle`, `componentSubtitle`, `backgroundColor`, `modalMode`,
`hideBetaBadge`, and several `show*` toggles.

> `briefEnabled` / `briefOpenByDefault` are **deprecated and inert** — the Brief Summary feature was
> removed.

### Setup checklist for a new org

1. Deploy objects → Apex → Flows → LWC.
2. Confirm all five prompt templates exist and are **Active**, with matching input names.
3. Activate the Flows; **delete any lingering Draft versions** (see §11).
4. Set the ten `*FlowApiName` properties on the page.
5. Grant object and field permissions for `UserAIInstruction__c`.
6. Add `Prospect Meeting` / `Working Meeting` to `Event.MeetingType__c` if using those categories.

---

## 8. Data model

| Object | Purpose |
|---|---|
| `MeetingNote__c` | The meeting summary; `Note__c`, `NoteMarkdown__c`, `Internal_Notes__c`, `Published__c` |
| `MeetingNoteVersion__c` | Published version history |
| `UserAIInstruction__c` | Per-user AI instructions — `InstructionText__c`, `IsActive__c`, `User__c` |
| `Meeting_Artifact__c` | Links documents to an Event |
| `FinServ__FinancialGoal__c`, `FinServ__AssetsAndLiabilities__c`, `FF_Income__c`, `Household_Milestones__c`, `Company_Ownership__c`, `SustainabilityPreferences__c`, `FF_PersonalGreeting__c` | Wealth plan records |

`UserAIInstruction__c` is a separate object rather than a field on `User` because writing a custom
field on `User` requires the advisor to have edit rights on their own User record, which standard
profiles usually lack.

---

## 9. File handling

The prompt accepts **two documents plus one transcript**. The UI enforces this per *kind*, not as a
flat count:

```
MAX_ATTACHMENTS = 2   (PDF, images, Word — anything non-text)
MAX_TRANSCRIPTS = 1   (.txt)
```

A flat "3 documents" cap previously allowed three attachments to crowd out the transcript, which
then never reached the prompt. `_fileKind()` normalises `ContentDocument.FileType` — note that
`FileType` is **not** the extension (`.txt` is `TEXT`, `.docx` is `WORD_X`).

The Flows select documents **by kind**, not by slot: a lookup filters `FileType != TEXT` and a loop
assigns the first two to `varContentDoc1` / `varContentDoc2`. A transcript therefore never occupies
an attachment slot regardless of selection order.

---

## 10. Known limitations

| Limitation | Detail |
|---|---|
| **Generation with zero documents fails** | The prompt templates ground attachments unconditionally via `RecordSnapshot`. With none passed, `getDataForGrounding` receives an all-null list and throws *"Incorrect input parameters, all elements are null"*. Fix: a template variant without document grounding |
| `Working Meeting` stores `Other` | `Event.MeetingType__c` is a restricted picklist lacking `Prospect Meeting` / `Working Meeting` |
| Instructions are summary-only | Per-user AI instructions reach the meeting summary prompt, not the to-do or wealth plan prompts |
| `wealthPlanHelper` is dead | 4,800 lines, rendered by nothing, but still `isExposed` |

---

## 11. Troubleshooting

### Start with the Apex debug log

Almost every failure in this system is a **silent name mismatch**, and the log is the fastest way to
find it:

```
sf apex list log
sf apex get log -i <id>
```

Look for:

| Log line | Tells you |
|---|---|
| `VARIABLE_ASSIGNMENT [n] <param>` | what the LWC actually sent to Apex |
| `FLOW_VALUE_ASSIGNMENT ... <Variable>` | what actually arrived in the Flow |
| `FLOW_CREATE_INTERVIEW_BEGIN ... <versionId>` | **which Flow version really ran** |
| `FLOW_ACTIONCALL_DETAIL ... <template>` | which template was called and whether it errored |

### A Draft Flow version runs in preference to the Active one

For the flow's author, `createInterview` executes the **newest** version, including Drafts. A fix
deployed to the Active version will appear not to work while a Draft exists. Always check the
version id in `FLOW_CREATE_INTERVIEW_BEGIN`, and do not leave Drafts lying around.

### "Incorrect input parameters, all elements are null"

Thrown by `getDataForGrounding`, **not** by the Flow. It means the prompt template tried to ground a
document and every recordId it received was null — i.e. no documents were passed. One populated
document is enough; it only fails when *all* are null.

### "We can't find the \<name\> action"

The Flow binds a prompt template by name and that template does not exist in this org, or is not
Active.

### "Enter a value for the \<Input\> parameter"

A deploy-time error: the template marks that input **required** and the Flow action does not supply
it. Either make the input optional, or point that action at a template whose contract it can meet.

### Data arrives empty with no error

The classic symptom of a renamed variable. `createInterview` silently drops keys the Flow does not
declare, so check that the Apex key, the Flow input variable, and the template input name all still
agree.

### Generation works with documents but not without

Expected — see §10.

---

## 12. Deployment notes

- **Deploy order:** prompt templates → Flows → Apex → LWC. Flows validate against templates, so a
  missing or mismatched template fails the Flow deploy.
- **Change sets do not resolve dependencies.** Every component must be added by hand. A new LWC that
  a parent references must be added, or the parent fails with `No MODULE named ...`.
- **Not carried by a metadata deploy:** prompt templates in some orgs, object and field permissions,
  picklist values, and the ten `*FlowApiName` page properties.
- **Production runs all local tests** and any failure anywhere in the org fails the deploy.
- Renaming a Flow is **high risk**: the `*FlowApiName` properties live in page configuration outside
  source control, so a rename passes every validation and silently breaks production.
