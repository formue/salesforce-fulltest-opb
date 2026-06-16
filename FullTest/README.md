# Advisor Assistant — wealthPlanHelper LWC

AI-powered Lightning Web Component for meeting summaries, wealth plan structuring, and meeting note versioning.

---

## Overview

`wealthPlanHelper` is a screen-flow and record-page component that lets advisors:

- Generate and edit AI meeting summaries
- Publish meeting notes and lock them for record-keeping
- Create new versions of published notes (with full version history)
- Structure wealth plans (goals, assets, incomes, milestones, ownerships, sustainability, greetings)
- Extract and save action items (to-dos) as Salesforce Tasks

---

## Component Configuration Properties

### Flow API Names

| Property | Required | Description |
|---|---|---|
| `flowApiName` | ✅ | Autolaunched Flow that returns structured wealth plan JSON |
| `meetingSummaryFlowApiName` | | Generates the initial meeting summary (returns HTML/text) |
| `regenerateSummaryFlowApiName` | | Regenerates summary with instructions. Inputs: `currentSummary`, `instructions`. Output: `generatedResponse` |
| `saveSummaryFlowApiName` | | Saves/updates/deletes `MeetingNote__c`. See contract below |
| `versionHistoryFlowApiName` | | Loads version history when an event is selected. See contract below |
| `createVersionFlowApiName` | | Creates a `MeetingNoteVersion__c` snapshot when saving a new version of a published note. See contract below |
| `saveTodosFlowApiName` | | Creates Task records from accepted action items |
| `saveFileToEventFlowApiName` | | Links an uploaded file to the Event record |
| `wealthPlanSaveFlowApiName` | | Handles all Wealth Plan DML via typed SObject collections (alternative to parent-flow Create/Update/Delete elements) |

### Input Data (Screen Flow)

| Property | Type | Description |
|---|---|---|
| `recordId` | String | Record ID context |
| `inputEvents` | `Event[]` | Meeting events to display as selectable context |
| `inputMeetingNotes` | `MeetingNote__c[]` | Notes matched to events via `Event.MeetingNote__c` |
| `inputTasks` | `Task[]` | Tasks for context selection |
| `inputArtifacts` | `Meeting_Artifact__c[]` | Artifacts linked to events |
| `inputContentDocumentLinks` | `ContentDocumentLink[]` | CDL records for artifact files |
| `inputContentDocuments` | `ContentDocument[]` | Document metadata |
| `inputHouseholdMembers` | `Account[]` | For owner dropdowns in wealth plan |
| `inputPrimaryMember` | `Account` | Primary member (single record) |
| `inputCompanies` | `Account[]` | Company accounts for Company Owned dropdown |
| `inputPersons` | `Account[]` | Person accounts for Company Owner dropdown |
| `inputWhoId` | String | Contact/Lead ID to link to saved Tasks |
| `inputExistingGoals` | `FinServ__FinancialGoal__c[]` | Existing goals for comparison |
| `inputExistingIncomes` | `FF_Income__c[]` | Existing incomes |
| `inputExistingAssets` | `FinServ__AssetsAndLiabilities__c[]` | Existing assets |
| `inputExistingMilestones` | `Household_Milestones__c[]` | Existing milestones |
| `inputExistingOwnerships` | `Company_Ownership__c[]` | Existing ownerships |
| `inputExistingSustainability` | `SustainabilityPreferences__c[]` | Existing sustainability preferences |
| `inputExistingGreetings` | `FF_PersonalGreeting__c[]` | Existing greetings |

### Feature Toggles

| Property | Default | Description |
|---|---|---|
| `modalMode` | `false` | Opens component as full-screen overlay from a compact launcher card |
| `hideBetaBadge` | `false` | Hides the beta badge |
| `showEditTracking` | `true` | Shows "AI Edited" badge |
| `showExpandCollapseAll` | `true` | Shows Expand/Collapse All button |
| `showDetailedStats` | `true` | Shows detailed stats panel |
| `showDiscardSection` | `true` | Shows discard section |
| `showRegenerateSection` | `true` | Shows regeneration section |
| `showScrollToError` | `true` | Scrolls to validation errors |
| `briefEnabled` | `false` | Shows "Brief Summary" section when flow returns a brief or the saved note has `Brief_Summary__c` populated |
| `briefOpenByDefault` | `false` | Starts the Brief Summary section expanded |
| `backgroundColor` | `#f0f9ff` | Background color of the component |

---

## Flow Contracts

### `saveSummaryFlowApiName` — Save / Update / Delete Note

Called for all normal note operations (new draft, save, publish, delete).

**Inputs:**

| Variable | Type | Notes |
|---|---|---|
| `noteId` | Text | Existing `MeetingNote__c` Id, or blank to create a new note |
| `noteHtml` | Text | Note content as HTML |
| `noteMarkdown` | Text | Note content as Markdown |
| `briefHtml` | Text | Brief summary HTML |
| `briefMarkdown` | Text | Brief summary Markdown |
| `eventId` | Text | Related Event Id |
| `published` | Boolean | `true` = publish and lock the note |
| `meetingType` | Text | e.g. `annual`, `whiteboard`, `status` |
| `deleteNote` | Boolean | `true` = delete the note |

**Output:** `savedNoteId` (Text) — the `MeetingNote__c` Id

> **Provided flow:** `WealthPlan_AL_Meeting_Summary_Save_Update`

---

### `versionHistoryFlowApiName` — Load Version History

Called automatically when an event is selected. Returns all `MeetingNoteVersion__c` records for that event's note.

**Input:** `EventId` (Text)

**Output:** `MeetingNoteVersions` (SObject Collection — `MeetingNoteVersion__c`)

> **Provided flow:** `WealthPlan_AL_Meeting_Note_Get_Versions`
>
> Queries versions via the Event → `MeetingNote__c` → `MeetingNoteVersion__c` relationship. Results sorted by `DateActive__c` descending.

---

### `createVersionFlowApiName` — Create Version of Published Note

Called **only** when an advisor clicks "Create New Version" on a published note and then saves or publishes the new draft. Snapshots the existing note content into a `MeetingNoteVersion__c` record, then overwrites `MeetingNote__c` with the new content.

**Inputs:** Same as `saveSummaryFlowApiName` (see above). `deleteNote` is always `false` for this flow.

**Output:** `savedNoteId` (Text) — the existing `MeetingNote__c` Id

> **Provided flow:** `WealthPlan_AL_Meeting_Note_Create_Version`
>
> Flow logic:
> 1. GET existing `MeetingNote__c` — snapshot its current content
> 2. CREATE `MeetingNoteVersion__c` with the **old** content (`Status__c = Active`, `DateActive__c = today`)
> 3. UPDATE `MeetingNote__c` with the **new** content
> 4. If meeting type changed, UPDATE Event.`MeetingType__c`

---

### `saveTodosFlowApiName` — Save Action Items

**Inputs:** `TodosJson` (Text — JSON array), `EventId` (Text), `WhoId` (Text)

**Output:** `SaveResult` (Text, optional)

---

### `saveFileToEventFlowApiName` — Attach File to Event

**Inputs:** `ContentDocumentId` (Text), `EventId` (Text)

---

### `wealthPlanSaveFlowApiName` — Save Wealth Plan Records

Receives typed SObject record collections for all create/update/delete operations. When set, the component delegates all Wealth Plan DML to this flow instead of returning output collections to the parent screen flow.

---

## MeetingNoteVersion__c Object

Stores versioned snapshots of `MeetingNote__c`. Created by `WealthPlan_AL_Meeting_Note_Create_Version` each time a new version of a published note is saved.

| Field | Type | Description |
|---|---|---|
| `Name` | AutoNumber | Format: `MNV-{0000000}` |
| `Note__c` | HTML | Full note content at time of snapshot |
| `NoteMarkdown__c` | Long Text | Markdown version of the note |
| `BriefSummary__c` | HTML | Brief summary at time of snapshot |
| `BriefSummaryMarkdown__c` | Long Text | Markdown version of the brief |
| `MeetingNote__c` | Lookup | Parent `MeetingNote__c` record |
| `EventId__c` | Text(18) | Related Event Id (fallback reference) |
| `Published__c` | Checkbox | Whether this version was published |
| `Status__c` | Picklist | `Active` (default) / `Inactive` |
| `DateActive__c` | Date | Date this version became active |
| `DateInactive__c` | Date | Date this version was superseded |

---

## Version History UI

When an event is selected, the component automatically calls `versionHistoryFlowApiName` and shows a **Version History** bar at the top of the Meeting Summary panel if any versions exist.

- **Expand the bar** to see all versions (name, status, date)
- **Click "View"** on any version to preview its content in read-only mode
- **Exit Preview** returns to the current live note
- The **"Published" floating bar** at the bottom shows when the current note is published and locked — click **"Create New Version"** to start a new editable draft

### Version workflow

```
Published note exists
    → Advisor clicks "Create New Version"
    → Edits draft content
    → Clicks Save or Publish
    → createVersionFlowApiName fires:
        1. Snapshots current published content → MeetingNoteVersion__c
        2. Overwrites MeetingNote__c with new draft/published content
    → Version History bar refreshes with the new entry
```

All saves that do **not** involve "Create New Version" continue to use `saveSummaryFlowApiName` as normal — no version record is created.

---

## Brief Summary

When `briefEnabled` is `true`, the component shows a collapsible **Brief Summary** section above the main note content.

- The brief is populated automatically when the summary flow returns embedded brief content, or restored from `MeetingNote__c.Brief_Summary__c` when an event is selected.
- **Expand the section** by clicking the "Brief Summary" row. When `briefOpenByDefault` is `true` the section starts expanded.
- **Edit the brief** by clicking the **Edit** button inside the expanded section. This opens a `lightning-input-rich-text` editor — the same pattern as the main note editor.
- Click **Apply** to confirm edits, or **Cancel** to discard. The updated brief is included in every subsequent save (`briefHtml` / `briefMarkdown` inputs to the save flow).

---

## Apex Controller

`MeetingSummaryController` — all methods are `@AuraEnabled`. Key methods:

| Method | Description |
|---|---|
| `generateSummary(...)` | Invokes the meeting summary flow |
| `regenerateMeetingSummary(...)` | Invokes the regeneration flow |
| `saveMeetingNote(...)` | Invokes save/version flows |
| `saveTodos(...)` | Invokes the todos save flow |
| `saveWealthPlan(...)` | Invokes the wealth plan save flow |
| `saveFileToEvent(...)` | Invokes the file-to-event flow |
| `getMeetingNoteVersions(...)` | Invokes the version history flow, returns `List<MeetingNoteVersion__c>` |

---

## Deployment Checklist

1. Deploy metadata: LWC, Apex classes, flows, custom object (`MeetingNoteVersion__c`)
2. Configure the component on the screen flow or record page with the required flow API names
3. Ensure the Salesforce org has the `MeetingNoteVersion__c` object and all its fields
4. Grant FLS on `MeetingNoteVersion__c` fields to all relevant profiles/permission sets
5. Activate all three flows in the org before use
