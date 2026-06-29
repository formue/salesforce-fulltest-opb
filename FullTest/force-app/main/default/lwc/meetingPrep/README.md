# Meeting Prep

Advisor-facing briefing screen that surfaces a household's investment strategy, current portfolio, recent activity, open vs. completed tasks, the last meeting, and AI-generated topic suggestions — all in a single screen flow.

## At a glance

- **Type:** Lightning Web Component (`c:meetingPrep`)
- **Target:** `lightning__FlowScreen` (lives inside a screen flow)
- **Data layer:** Apex bridge → autolaunched subflows + the existing `PortfolioFlowService.getHoldingsFromFlow`
- **Multi-account aware:** primary household member + toggleable person and business accounts
- **Per-account filtering:** Tasks, Events, and Strategy each get a tab strip when more than one account is selected (`All` + one tab per selected account, with row counts)
- **Life-event radar:** compact "Upcoming" chip row surfaces person-account birthdays + household milestones in the next 12 months
- **AI integration:** optional — points at an admin-configurable topic-suggestion flow

## End-to-end architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Salesforce record page → user clicks "Meeting Prep" action              │
└──────────────────────────────────────────────────────────────────────────┘
                                   │ recordId (household Account Id)
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  MeetingPrep_SCR_View.flow                                               │
│  ┌─────────────────────────────────────┐                                 │
│  │ SUB_GetHousehold (autolaunched)     │                                 │
│  │  ACR chain → 3 Account outputs      │                                 │
│  └─────────────────────────────────────┘                                 │
│             │ primary, members[], businesses[]                           │
│             ▼                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ c:meetingPrep  (LWC)                                               │  │
│  │  - connectedCallback → _loadAll([primaryId])                       │  │
│  │  - Sources card (chips + Update button)                            │  │
│  │  - Strategy (tabbed per account)                                   │  │
│  │  - Stats row · Last meeting                                        │  │
│  │  - Tasks accordion · Events accordion · AI topics accordion        │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
                  │                       │                    │
                  ▼                       ▼                    ▼
   PortfolioFlowService          MeetingPrepController.cls    (lazy on
   getHoldingsFromFlow           ├─ getTasksForAccounts        accordion open)
   (existing — 1 call            ├─ getEventsForAccounts       generateTopicSuggestions
    per selected account)        └─ generateTopicSuggestions
                  │                       │                    │
                  ▼                       ▼                    ▼
   Portfolio_Level_AI_           MeetingPrep_SUB_GetTasks      <your AI flow>
   Generation (existing          MeetingPrep_SUB_GetEvents     accepts AccountId +
    org flow)                    (recordIds[] → SObject[])     ContextJson →
                                                               GeneratedTopics
```

## Process

### 1. Entry — the screen flow

[`MeetingPrep_SCR_View.flow-meta.xml`](../../flows/MeetingPrep_SCR_View.flow-meta.xml) is the only Screen Flow involved. It runs once on entry and does only two things:

```
start (recordId = household Account Id)
  ↓
SUB_GetHousehold       (loads primary + members[] + businesses[])
  ↓
S_MeetingPrepView      (renders c:meetingPrep with those inputs)
```

All further data work is reactive inside the LWC.

### 2. Household resolution

[`MeetingPrep_SUB_GetHousehold.flow-meta.xml`](../../flows/MeetingPrep_SUB_GetHousehold.flow-meta.xml) — autolaunched. Mirrors the `AccountContactRelation` traversal pattern from `WealthPlan_SCR_Print_Summary` but exposes three clean outputs.

```
recordId (household Account Id)
  ↓
GET_ACR_Members              (ACR WHERE AccountId = recordId
                              AND FinServ__PrimaryGroup__c = true AND IsActive = true)
  ↓
LOOP_ACR_Members  ──for-each──→ CHECK_IsPrimaryMember
                                  ├─ Is Primary →  SET_PrimaryAccountId  →  STORE_AccountAndContact_Ids
                                  └─ Not Primary →                          STORE_AccountAndContact_Ids
  ↓ (no more values)
GET_PrimaryMember          (Account WHERE Id = var_PrimaryAccountId)    →  outputPrimaryMember
  ↓
GET_PersonAccounts         (Account WHERE Id IN var_coll_Account_Ids)   →  outputHouseholdMembers
  ↓
GET_BusinessACR            (ACR WHERE ContactId IN var_coll_Contact_Ids)
  ↓
LOOP_BusinessACR  ──for-each──→ STORE_Business_Ids
  ↓ (no more values)
GET_BusinessAccounts       (Account WHERE Id IN var_coll_Business_Ids
                              AND Id NOT IN var_coll_Account_Ids)        →  outputBusinessAccounts
```

### 3. LWC initial render + reactive loop

```
connectedCallback()
  ↓ _selectedAccountIds = [primaryId]
  ↓ _loadAll(_selectedAccountIds)

User toggles chip → handleTogglePerson / handleToggleBusiness
  → _selectedPersonIds / _selectedBusinessIds mutated
  → selectedAccountIds getter recomputes
  → pendingChanges getter flips true
  → "Update data" button enables

User clicks "Update data" → handleUpdateData()
  → _loadAll(selectedAccountIds)
  → parallel refresh of _strategyByAccount, _tasks, _events
  → _loadedAccountIds = new Set(ids)
  → button disables again
```

### 4. `_loadAll(ids)` fanout

The heart of the data layer. Three Apex round-trips, regardless of how many accounts are picked (portfolio is per-account because the existing service is single-account):

```
_loadAll(ids)
  ├─ ids.map(id => getHoldingsFromFlow({ flowApiName: portfolioFlowApiName, accountId: id }))
  │     └─ each result → _strategyByAccount[id] = { weights, values, total }
  │
  ├─ getTasksForAccounts({ flowApiName: taskFlowApiName,  accountIds: ids })   → _tasks
  │
  └─ getEventsForAccounts({ flowApiName: eventFlowApiName, accountIds: ids })  → _events

await Promise.all(...) → _loadedAccountIds = new Set(ids)
```

## Components

| Layer | File | Role |
|---|---|---|
| Screen flow | [`MeetingPrep_SCR_View.flow-meta.xml`](../../flows/MeetingPrep_SCR_View.flow-meta.xml) | Hosts the LWC, runs `SUB_GetHousehold` once on entry |
| Household subflow | [`MeetingPrep_SUB_GetHousehold.flow-meta.xml`](../../flows/MeetingPrep_SUB_GetHousehold.flow-meta.xml) | ACR chain → primary, persons[], businesses[] |
| Tasks subflow | [`MeetingPrep_SUB_GetTasks.flow-meta.xml`](../../flows/MeetingPrep_SUB_GetTasks.flow-meta.xml) | `recordIds[]` → Tasks WHERE `WhatId IN recordIds` |
| Events subflow | [`MeetingPrep_SUB_GetEvents.flow-meta.xml`](../../flows/MeetingPrep_SUB_GetEvents.flow-meta.xml) | `recordIds[]` → Events WHERE `WhatId IN recordIds` |
| Milestones subflow | [`MeetingPrep_SUB_GetMilestones.flow-meta.xml`](../../flows/MeetingPrep_SUB_GetMilestones.flow-meta.xml) | `recordIds[]` (household Ids) → `Household_Milestones__c` WHERE `RelatedHousehold__c IN recordIds` |
| Apex bridge | [`MeetingPrepController.cls`](../../classes/MeetingPrepController.cls) | Invokes subflows + topic suggestion flow via `Flow.Interview.createInterview` |
| Portfolio service | `PortfolioFlowService.getHoldingsFromFlow` (existing) | Returns `{ strategies[], strategyProducts[], holdings[] }` per account |
| LWC | [`meetingPrep.js`](./meetingPrep.js) / [`.html`](./meetingPrep.html) / [`.css`](./meetingPrep.css) / [`.js-meta.xml`](./meetingPrep.js-meta.xml) | Renders the UI, owns selection + load state |
| Reference component | [`portfolioRebalancingTool2`](../portfolioRebalancingTool2/) | Shares the portfolio fetch contract |
| Stat tile | [`wealthPlanStatCard`](../wealthPlanStatCard/) | Reused for the four header stat tiles |

## `@api` inputs

Configured in the screen flow's screen field:

| Property | Type | Purpose |
|---|---|---|
| `recordId` | String | Household Account Id (flow context) |
| `inputPrimaryMember` | `Account` | Primary household member — always pre-selected and locked |
| `inputHouseholdMembers` | `Account[]` | Other person accounts in the household (toggleable chips) |
| `inputBusinessAccounts` | `Account[]` | Business accounts linked via ACR (toggleable chips) |
| `portfolioFlowApiName` | String | Default `Portfolio_Level_AI_Generation` — same contract as `portfolioRebalancingTool2` |
| `taskFlowApiName` | String | Default `MeetingPrep_SUB_GetTasks` |
| `eventFlowApiName` | String | Default `MeetingPrep_SUB_GetEvents` |
| `milestoneFlowApiName` | String | Default `MeetingPrep_SUB_GetMilestones` |
| `topicSuggestionFlowApiName` | String | Your AI flow (optional — accordion shows empty state when unset) |
| `customerName` | String | Optional subtitle override |
| `backgroundColor` | String | Classic-theme background tint |

Deprecated stubs (kept so older deployed flow versions still validate): `inputStrategy`, `inputPortfolio`, `inputTasks`, `inputEvents`. Not read by the component.

## Apex contract

```apex
// MeetingPrepController.cls

@AuraEnabled
public static List<Task> getTasksForAccounts(String flowApiName, List<String> accountIds)

@AuraEnabled
public static List<Event> getEventsForAccounts(String flowApiName, List<String> accountIds)

@AuraEnabled
public static List<Household_Milestones__c> getMilestones(String flowApiName, List<String> recordIds)

@AuraEnabled
public static String generateTopicSuggestions(String flowApiName, String accountId, String contextJson)
```

The Apex methods are pure plumbing — none of the SOQL lives in code. Each method calls `Flow.Interview.createInterview(flowApiName, inputs).start()` and reads back a named output variable. Admins can change query logic in Flow Builder without touching Apex.

## Subflow contracts

### Tasks / Events subflows

| Direction | Variable name | Type | Notes |
|---|---|---|---|
| Input | `recordIds` | Text **collection** | Account Ids; subflow filters `WhatId IN :recordIds` |
| Output | `outputTasks` / `outputEvents` | Task[] / Event[] | Sorted desc by ActivityDate / ActivityDateTime |

### Milestones subflow

| Direction | Variable name | Type | Notes |
|---|---|---|---|
| Input | `recordIds` | Text **collection** | Household Account Id(s); subflow filters `RelatedHousehold__c IN :recordIds` |
| Output | `outputMilestones` | `Household_Milestones__c[]` | Includes `Milestone_Year__c`, `Name`, `FF_AppDescription__c` |

### Household subflow

| Direction | Variable name | Type |
|---|---|---|
| Input | `recordId` | Text (single) — household Account Id |
| Output | `outputPrimaryMember` | Account (single) |
| Output | `outputHouseholdMembers` | Account[] (all household person accounts) |
| Output | `outputBusinessAccounts` | Account[] (linked businesses, excluding household persons) |

### AI topic-suggestion flow (you build this)

| Direction | Variable name | Type |
|---|---|---|
| Input | `AccountId` | Text — the screen flow's recordId |
| Input | `ContextJson` | Text — see payload shape below |
| Output | `GeneratedTopics` | Text — JSON array string `[{"title":"...","rationale":"..."}, ...]` |

## `ContextJson` payload sent to the AI flow

Built by `_loadTopicSuggestions()` in [`meetingPrep.js`](./meetingPrep.js). Lazy — only assembled when the user opens the AI accordion:

```json
{
  "household": {
    "primary": "Øyvind Borgersen",
    "selectedAccounts": [
      { "name": "Øyvind Borgersen", "isPrimary": true },
      { "name": "Acme Holdings AS", "isPrimary": false }
    ]
  },
  "touchpoints12mo": 14,
  "tasksOpen": 3,
  "tasksCompleted": 7,
  "daysSinceLastMeeting": "94",
  "lastMeetingSubject": "Annual review 2026",
  "lifeEvents": [
    {
      "type": "birthday",
      "label": "Øyvind Borgersen's birthday",
      "dateDisplay": "12. mar. 2027",
      "daysUntil": 32,
      "owner": "Øyvind Borgersen"
    },
    {
      "type": "milestone",
      "label": "Datteren fyller 18",
      "dateDisplay": "2027",
      "daysUntil": 280,
      "owner": "Borgersen Household"
    }
  ],
  "strategyByAccount": [
    {
      "accountName": "Øyvind Borgersen",
      "isPrimary": true,
      "drift": [
        { "label": "Money Market",  "drift": "+1,2 %" },
        { "label": "Bonds",         "drift": "-0,8 %" },
        { "label": "Equities",      "drift": "+3,1 %" },
        { "label": "Hedgefund",     "drift": "—" },
        { "label": "Real Assets",   "drift": "—" },
        { "label": "Private Equity","drift": "—" }
      ]
    }
  ],
  "tasks": [
    {
      "subject": "ESG screening update",
      "description": "Customer asked for an updated ESG screen on equities…",
      "status": "Open",
      "priority": "High",
      "activityDate": "2026-03-12",
      "owner": "Øyvind Borgersen"
    }
  ],
  "events": [
    {
      "subject": "Annual review 2026",
      "description": "Discussed retirement timeline, agreed to rebalance equities…",
      "location": "Oslo office",
      "startDateTime": "2026-03-22T09:00:00.000Z",
      "type": "Annual Review",
      "owner": "Øyvind Borgersen"
    }
  ]
}
```

Descriptions are truncated to 500 characters with `…` to keep the prompt budget reasonable.

## Rendering map — what each section reads

| Section | Data source |
|---|---|
| Sources card | `inputPrimaryMember`, `otherPersonAccounts`, `safeBusinessAccounts` + `_selectedPersonIds` / `_selectedBusinessIds` for chip state |
| Upcoming life events card | `lifeEvents` getter — merges person-account birthdays (from `Birthdate` / `PersonBirthdate`) + `_milestones`; window 365 days; sorted by `daysUntil` asc; capped at 5 chips |
| Stats row | `_tasks` (counts), `_events` (lastMeeting + touchpoints) — always household-wide (not affected by activity tabs) |
| Strategy card | `_strategyByAccount[_activeStrategyTab]`; tab strip shown when >1 account selected |
| Last meeting card | Derived from `_events` (most recent past) — household-wide; owner badge from `accountDictionary` |
| Tasks accordion | Tab strip (`All` + per-account, with counts) when >1 account selected; body reads `filteredTasks` → split by `Status`, top 5 per pane, each row tagged via `_ownerInfo(WhatId)` |
| Events accordion | Tab strip (`All` + per-account, with counts) when >1 account selected; body reads `filteredEvents`, sorted desc, each row tagged via `_ownerInfo(WhatId)` + `Who.Name` / `Owner.Name` participants line |
| AI topics accordion | Lazy: assembles `ContextJson` from current state (full household, not filtered), calls `generateTopicSuggestions` |

### Activity tabs (Tasks + Events)

```
Selected accounts: [Primary]                  → no tab strip; full list rendered

Selected accounts: [Primary, Spouse, Acme AS] → tab strip rendered above each list:

   ┌───────────────────────────────────────────────────────────┐
   │  All (12)   ★ Øyvind (6)   Spouse (3)   Acme AS (3)       │
   └───────────────────────────────────────────────────────────┘
```

- The `All` tab is the default after every `_loadAll`.
- Counts come from `_tasks` / `_events` filtered by `trim15(record.WhatId) === account.id`.
- After "Update data" — if the previously-active tab is no longer in the selection, it auto-resets to `All`.
- The accordion *header* stays household-wide (e.g. `3 open · 7 completed`) so the summary remains stable across tab switches.

## Owner tagging

```
_ownerInfo(whatId)
  ↓ accountDictionary[trim15(whatId)]
  → { name, badgeClass }   (primary uses amber badge, others use neutral grey)
```

`accountDictionary` is built from `inputPrimaryMember + inputHouseholdMembers + inputBusinessAccounts`, so every Account loaded by the screen flow is name-resolvable.

## Customizing

- **Add a new asset class** → extend the `ASSETS` constant in [`meetingPrep.js`](./meetingPrep.js) and the `_mapStrategyToTargets` / `_mapHoldingsToValues` switches.
- **Change drift thresholds** → constants `BOUNDARY_LIMIT` (±2% warn) and `DRIFT_ALERT` (±5% red) at the top of [`meetingPrep.js`](./meetingPrep.js).
- **Change task/event filters or sort** → edit the SOQL in [`MeetingPrep_SUB_GetTasks`](../../flows/MeetingPrep_SUB_GetTasks.flow-meta.xml) / [`MeetingPrep_SUB_GetEvents`](../../flows/MeetingPrep_SUB_GetEvents.flow-meta.xml) directly in Flow Builder. No Apex changes.
- **Per-account activity filtering** → behaviour lives in `_buildActivityTabs` / `filteredTasks` / `filteredEvents` in [`meetingPrep.js`](./meetingPrep.js). Match key is `WhatId` (15-char). Change the `__all__` sentinel or the auto-reset rule there if you want different defaults.
- **Add another life-event source** → extend the `lifeEvents` getter in [`meetingPrep.js`](./meetingPrep.js). Anything that can produce `{ key, type, label, daysUntil, dateDisplay, ownerName, ownerBadgeClass, iconPath }` slots into the same chip render. Tune `LIFE_EVENT_LIMIT` (5) and `LIFE_EVENT_WINDOW_DAYS` (365) constants at the top of the file.
- **Birthdate field name** → defaults to `PersonBirthdate` (Person Account field). If your org uses Contact-based households, swap the queriedField in [`MeetingPrep_SUB_GetHousehold.flow-meta.xml`](../../flows/MeetingPrep_SUB_GetHousehold.flow-meta.xml) to `Birthdate` and update the getter's fallback line.
- **Theme** → CSS variables in `:host` at the top of [`meetingPrep.css`](./meetingPrep.css). Classic/Corporate toggle in the header.
- **AI flow** → see "Subflow contracts" above. The prompt template can read `ContextJson` natively — a starter prompt is documented separately.

## Deploy notes

1. All subflows ship at `<status>Draft</status>` — **activate each in Flow Builder** before running the screen flow (`MeetingPrep_SUB_GetHousehold`, `_GetTasks`, `_GetEvents`, `_GetMilestones`).
2. The household subflow assumes the Financial Services Cloud data model — specifically `FinServ__PrimaryGroup__c` and `FinServ__Primary__c` on `AccountContactRelation`. If your sandbox lacks those fields, the subflow won't deploy and you'll need to swap in an alternate household-detection mechanism.
3. Birthdays use `PersonBirthdate` (Person Account field). If your org uses Contact-based households instead, change the queriedField in the household subflow to `Birthdate` and update the corresponding fallback in `meetingPrep.js`'s `lifeEvents` getter.
4. Milestones require the `Household_Milestones__c` custom object with `RelatedHousehold__c` and `Milestone_Year__c` fields — same shape used by `WealthPlan_SCR_Print_Summary`.
5. Deploy the four subflows + screen flow + Apex + LWC together. Order doesn't matter to the platform, but the screen flow needs the subflows to exist before activation.
6. The deprecated `@api` stubs (`inputStrategy`, `inputPortfolio`, `inputTasks`, `inputEvents`) are intentional — they let the previously-deployed `MeetingPrep - SCR - View-1` flow version keep validating. Safe to delete once the old version is replaced.

## Quick verification path

1. Run the screen flow from a household Account that has multiple members.
2. Sources card shows the primary locked-on, other persons/businesses as toggleable chips.
3. Initial render: primary selected, strategy untabbed, no activity tab strip; tasks/events badged with primary's name.
4. Toggle a household member → "Update data" enables → click → strategy gains a tab strip; both the Tasks and Events accordion bodies gain their own tab strip (`All` + per-account, with counts); tasks/events lists grow with rows badged to the second account.
5. Click a per-account tab inside Tasks → list filters to only that account's tasks (Completed/Open split still applies); count pill on the active tab matches the visible rows. Switch back to `All` to see everything.
6. Same for Events — click a per-account tab, the event rows filter; the accordion header counts (open · completed) stay household-wide.
7. Toggle a business → its name appears as a strategy tab AND as a third activity tab; rows get a green-tinted owner badge.
8. After unchecking a previously-tabbed account and clicking Update → the activity tabs reset to `All` automatically.
9. **Upcoming life events** — on a household with at least one upcoming birthday within 90 days and/or a milestone for the current or next year, confirm a small "Upcoming" card appears between Sources and Stats with chips like `🎂 Øyvind's birthday · in 32 d` and milestone chips with a different hue. Empty case (no events in window): the card is hidden cleanly.
10. **Selection-aware life events** — deselect the household member with the nearest birthday → click Update → that chip drops off the list.
11. Expand "Suggested topics" (with an AI flow configured) → spinner → list of topic cards. Without an AI flow it shows a clean empty state. Inspect the `contextJson` payload — confirm `lifeEvents` is populated with the same entries shown in the UI.

## Files in this bundle

```
meetingPrep/
  README.md            (this file)
  meetingPrep.js              — orchestration, selection state, Apex calls, mappers
  meetingPrep.html            — layout: header, Sources, Strategy (tabbed), Stats, Last meeting, Tasks, Events, AI topics
  meetingPrep.css             — brand tokens + Classic/Corporate theme + Sources/Tabs/Badges styles
  meetingPrep.js-meta.xml     — exposed for lightning__FlowScreen with @api property declarations
```
