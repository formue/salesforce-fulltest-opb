# Strategy Wizard

A working mockup of the whole Create Strategy journey on a single Flow screen, built so the shape
of the journey can be reviewed before any of it is wired to real data.

**It does not write anything.** No `InvestmentStrategy__c` record is created or updated.

## The two components

| Component                                                    | What it is                            | Data                                              |
| ------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------- |
| [custodianMenu](force-app/main/default/lwc/custodianMenu/)   | Custodian + account type selection    | **Live** — two custom metadata types over GraphQL |
| [strategyWizard](force-app/main/default/lwc/strategyWizard/) | The five-step shell hosting all steps | Steps 1, 2 and 4 are **mocked**                   |

`custodianMenu` stays usable on its own. It has two modes:

- **standalone** (default) — draws its own card and Continue button, reports to Flow with
  `FlowAttributeChangeEvent`. Used by `Strategy_Custodian_Selection`.
- **embedded** (`embedded` = true) — no card, no footer, and every change is also emitted as a
  `selectionchange` CustomEvent. Used by `strategyWizard`.

A nested LWC cannot reach the Flow runtime, so only the flow-screen-level parent raises flow
events. The child speaks in plain CustomEvents and the parent re-publishes. Same parent/child
bridge as `advisorAssistant`.

## The five steps

| #   | Step               | State    | Notes                                             |
| --- | ------------------ | -------- | ------------------------------------------------- |
| 1   | Select Account     | mock     | Strategy type tiles, then the account             |
| 2   | Strategy Details   | mock     | Name, amount, management type, risk & lock-in bar |
| 3   | **Custodian**      | **live** | Delegates to `c-custodian-menu`                   |
| 4   | Investment Profile | mock     | Profile tiles, then editable weights per bucket   |
| 5   | Review and Create  | derived  | Every choice, with Edit links back to each step   |

Custodian sits at step 3 deliberately: the account type sets the portfolio type that the strategy
engine filters templates and sleeves on (OEP-13), so it has to be chosen before the investment
profile.

## Two visual treatments

`strategyWizard` renders in one of two styles, chosen by the `uiStyle` flow input:

| Style               | Premise                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `classic` (default) | Paged wizard matching today's Create Strategy screens: chevron path, one step per screen, running recap in a side rail                                                                    |
| `cockpit`           | One dark canvas: all five steps in a vertical rail, and a live panel showing the amount as a hero figure, the risk split as a composition bar, and the registration facts as they resolve |

Set `showStyleToggle` to true (the mockup flow does) for an in-screen switch so both can be
compared in a single run. Turn it off for anything real.

`c-custodian-menu` takes a matching `theme` property. A parent cannot style across the shadow
boundary, so the child has to be told which palette to use.

**The three bucket colours are shared by both styles on purpose.** The trio
`#2563eb` / `#0d9488` / `#d97706` was validated against both the light and the dark chart surface
and passes all six checks on each. The previous trio (two blues and an amber) failed the
normal-vision separation floor at ΔE 14.9 — two of the three buckets were hard to tell apart even
with full colour vision.

## Where the mock data lives

All of it is in the `MOCK_*` constants at the top of
[strategyWizard.js](force-app/main/default/lwc/strategyWizard/strategyWizard.js) —
`MOCK_ACCOUNTS`, `MOCK_STRATEGY_TYPES`, `MOCK_MANAGEMENT_TYPES`, `MOCK_RISK_LEVEL`,
`MOCK_PROFILES`, `MOCK_ALLOCATION`. Each carries a comment naming the real source it stands in for.

**Replacing a mocked step** means swapping its constant for a real data source and its
`<template if:true={isStep*}>` block for the real child component. Nothing else depends on it.

**Removing a step** means dropping its entry from `STEPS`, its `isStep*` getter, and its rules from
`REQUIRED`. Steps are data, not markup — nothing references step order directly.

## State and outputs

`_wip` holds every answer and is `@track`, so the summary rail and the review recompute as the
advisor moves. Flow outputs are `@api` getters over `_wip` — the repo's lint rules forbid
reassigning an `@api` field, so values are published with `FlowAttributeChangeEvent` from
`publish()` instead.

The mocked steps still expose real flow attributes (labelled `(mock)` in Flow Builder) so a calling
flow can be wired up now, even though nothing writes to the object yet.

## Flows

| Flow                            | Hosts                        | Status |
| ------------------------------- | ---------------------------- | ------ |
| `Strategy_Custodian_Selection`  | `c:custodianMenu` standalone | Active |
| `Strategy_Create_Wizard_Mockup` | `c:strategyWizard`           | Active |

Both set `showFooter` false because the component owns navigation. Two flow-metadata details are
load-bearing — break either and the flow becomes an `InvalidDraft` that cannot be activated:

- the `ComponentInstance` field needs `<storeOutputAutomatically>true</storeOutputAutomatically>`
  for `<componentName>.<property>` references to resolve;
- a property read back as an output must be `role="outputOnly"` and must **not** also be passed in
  as an input parameter.

Changing a property's `role` is blocked while any flow version still references it — delete the
flow versions first, then deploy the component, then the flow.

## Known gaps

- **The real wizard is not this.** The production journey lives in org components (`wizard`,
  `wealthPlanRiskAndLockinFormue`, `wealthPlanInvestmentPrefs`) whose source is not in any local
  repo and which the Tooling API returns as `(hidden)`. This mockup does not replace them.
- **`AccountType__c` collides.** `InvestmentStrategy__c.AccountType__c` already exists as a
  picklist on 3,538 records feeding the APX/Tradex/Genesis integrations, with a taxonomy that
  barely overlaps `Custodian_Account_Type__mdt`. Unresolved — see
  [metadata-seed/README.md](metadata-seed/README.md).
- **There is already a `Strategy_SCR_AccountTypePS` flow** (v9, Active) in the org. Worth checking
  against before adding another account-type step to the real process.
- **No `Custodian__c` field** exists on `InvestmentStrategy__c`, so the custodian cannot be
  persisted yet.
- Only 6 of 9 account types are seeded.

## Running it

```
npm run lint
npm run test:unit
sf project deploy start -d force-app/main/default/lwc/custodianMenu -d force-app/main/default/lwc/strategyWizard
sf project deploy start -d force-app/main/default/flows/Strategy_Create_Wizard_Mockup.flow-meta.xml
```

Deploy the components and the flow in separate steps — the flow is validated against the component
definition already in the org. Then open `Strategy - SCR - Create Wizard (mockup)` in Flow Builder
and debug with `countryCode` = NO, SE or DK.
