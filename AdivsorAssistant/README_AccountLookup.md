# Account Lookup — limited-view search for private Accounts

Account OWD is Private, so standard search, list views and Ask/AI only surface accounts a user
owns or is on the account team for. This tool lets a permitted user find **any** account and see
a small, fixed set of fields — and nothing else.

Salesforce has no declarative way to expose a few fields of a record a user cannot access, so
this is a custom search tool built on an Apex class that deliberately runs outside the sharing
model.

> **This is a mock-up.** Two controls from the approved design are not built yet and are
> blockers for production use. See [Before production](#before-production).

## What it does

- `accountLookup` LWC — search box, results table, detail modal. Place it in the utility bar,
  on an app page, a home page or a tab.
- `AccountLookupService` (`without sharing`) — searches Account and returns only whitelisted
  fields, as a DTO. Never an `Account` sObject.
- `AccountLookupController` (`with sharing`) — thin `@AuraEnabled` wrapper for the LWC.

For an account the user **cannot** access, the UI shows the limited view and never links to the
record page. For an account the user **can** access, an "Open record" button appears.

The tool does not widen access. Pasting an inaccessible Account's URL in the browser still gives
"insufficient privileges".

## Fields exposed

Always queried — the `WHITELIST` constant in `AccountLookupService`:

`Name, Type, Phone, Website, Industry, Billing City, Billing Country, Last Activity Date,
Record Type, Owner Name`

`LastActivityDate` is a date only — never what the activity was. It drives the "3mo ago"
column, the best available signal for whether anyone is actually working a relationship.

Queried only when `describe` confirms the org has the field, with the expected type:

| Field | Shows as |
|---|---|
| `PersonEmail` | Email |
| `Segment__c` | Segment — Core, Family Office, Institutions… |
| `FinServ__Status__c` | Status dot — green Active, grey Inactive |
| `FinServ__AUM__c` | AUM — **see the policy below** |
| `RelatedHouseholdAccount__c` | Household name, member count, and the pivot into its members |

An org missing any of these — no Financial Services Cloud, no person accounts — simply gets no
value for it. No error, no failed query.

**Adding a field is a code change and needs review.** Nothing about the response is driven by
user input, and the DTO-shape test in `AccountLookupServiceTest` pins the exact key set, so a
whitelist change cannot land unnoticed.

## How AUM is exposed

AUM is the most sensitive thing on the limited view, so the rule is deliberate:

- **An account the user can already read** → the exact figure.
- **Anything else** → a size band only: `< 1M`, `1-10M`, `10-100M`, `100M+`.
- **Zero** → nothing at all. This org stores `0` rather than null on 132,223 of 146,522
  accounts, so treating zero as a figure put a bare `0` on every accessible row. Zero means
  "no AUM recorded".

**The banding happens in Apex**, and the exact figure is never placed on the DTO for a
limited-view row. Banding in the browser instead would leave the real number in the network
payload and defeat the control entirely. If you touch `toResult`, preserve this —
`testSearch_LimitedViewRow_CarriesNoExactAum` asserts it against the serialized payload, not
just the object.

Summary totals follow the same logic: a total is only summed over rows whose exact figure is
known, and is labelled "across accounts you can open". Band midpoints are never summed, because
that would invent a number.

## The main filter: which customers to search

A segmented control sits directly under the search box:

| Scope | What it searches | Uses the sharing bypass? |
|---|---|---|
| **All customers** | Every account in Salesforce, as a limited view | **Yes** — this is what the tool exists for |
| **My customers** | Accounts you own | No |
| **My team's customers** | Accounts you are on the account team for | No |
| **Mine & team** | Either of the above | No |

It opens on **All customers**, so nothing changes for anyone already using it, and the
narrower scopes are there when you want your own book.

The three personal scopes add an explicit `OwnerId` or `AccountTeamMember` predicate in SOQL,
so they can only ever return records you already have access to. A useful consequence: every
row in those scopes comes back with full access, which means **exact AUM figures rather than
bands**.

Two implementation notes for whoever touches `searchWithinScope`:

- Salesforce rejects a semi-join nested inside an `OR`, so "Mine & team" collects the team's
  account Ids first and binds them as a set. The other two scopes need no such workaround.
- Scoped searches use SOQL `LIKE` (substring) rather than SOSL (prefix-token), because SOSL
  cannot express the account-team join. `%` and `_` in the search term are escaped so they
  match literally — otherwise searching `50%` would return your whole book.

An unrecognised scope falls back to All customers, which the custom permission already allows.

## What the search UI does

- **Scope-aware empty state.** When a narrowed scope finds nothing, it says so and offers to
  search all customers instead rather than leaving you guessing.
- **Keyboard-first.** `Ctrl`/`Cmd`+`K` focuses the box (while the page or utility panel has
  focus — an LWC cannot claim a shortcut across the whole Lightning shell), arrow keys move
  through results, `Enter` opens one, `Escape` clears.
- **Matched text highlighted** in each account name. Segments are rendered through `for:each`,
  never `innerHTML`, so an account name cannot inject markup.
- **Access at a glance.** Every row carries a *Full access* or *Limited view* pill, and the
  insight line reads "25 results · 6 you can open · 19 limited view".
- **Possible duplicates flagged.** Rows whose names match once case, punctuation and company
  suffixes (`AS`, `ASA`, `Ltd`…) are stripped get a marker. Advisory only — nothing is hidden
  or merged. This is the "does this account already exist?" answer the tool was built for.
- **Record-type buttons** — Person Account, Business, Household, and whatever else the org
  uses. Built from the results rather than hardcoded, so they always match the org.
- **Facet chips** for type, industry, city and status, with counts.
- **Household pivot** — click the household chip on a row to see every member of that household;
  "Back to results" restores the previous list with no new query. This is the thing standard
  search cannot do at all.
- **Sort and density** — re-sort the returned rows by name, AUM or household, and switch
  between comfortable and compact. Density is remembered per browser.
- **Adaptive layout.** At 720px and wider the list becomes aligned columns under a header —
  Name, Household, Location, Owner, Activity, AUM, actions. Narrower than that it falls back to
  the stacked card. The breakpoint is measured from **the component**, via `ResizeObserver`, not
  from the window: the utility panel is 480px wide on a 2560px monitor, so a CSS media query
  would wrongly put it in column mode. Where `ResizeObserver` is unavailable it stays stacked.
- **Grouped filters.** One `Filters` button with the active count; options inside are grouped
  under their field — Record type, Type, Segment, Status, City — so a chip reading `Other (6)`
  is no longer a mystery. Active filters show as removable pills, and several fields can be
  combined at once.
- **Row actions** — call, email, and open-record straight from the row. The open-record button
  appears only where `hasFullAccess` is true, and is guarded again in the handler.
- **Recently viewed accounts** — the last five opened through the tool, beside recent searches
  when the box is empty. This writes account **names** into the user's own browser storage,
  where the recent search terms already live. Nothing leaves the browser.
- **Recent searches** remembered per browser in `localStorage`, and a shimmer skeleton while
  loading.
- **In the modal:** a completeness meter ("11 of 14 details available"), last activity with how
  long ago it was, `tel:` / `mailto:` / external links, and copy-to-clipboard on each value.

Two limitations worth knowing:

1. **Filters and sort work on the results already returned, not the whole org.** The server
   returns at most 25 rows ordered alphabetically, so searching a common surname gives you the
   first 25 alphabetically — not the 25 largest. Sorting by AUM re-orders those 25 only.
   Ranking by AUM server-side would fix it and was deliberately not done this round; narrow the
   search term instead.
2. **The data is sparse.** In fulltest, AUM is above zero on ~10% of accounts, status is set on
   29%, a household link on 41%, billing city on 18%, last activity on 47%. Segment is the
   best-populated at 80%. Rows collapse around whatever is missing rather than leaving gaps.
3. **Household member counts are best-effort.** They come from one grouped query on a text
   field, which the platform does not guarantee it can group on. If it refuses, the count is
   dropped and the chip just shows the name — a missing count never fails a search.

## Deploy

```bash
# from the AdivsorAssistant folder
sf project deploy start \
  -d force-app/main/default/classes \
  -d force-app/main/default/customPermissions \
  -d force-app/main/default/permissionsets \
  -d force-app/main/default/lwc/accountLookup \
  -d force-app/main/default/lwc/accountLookupDetail
```

Then run the tests:

```bash
sf apex run test -n AccountLookupServiceTest -n AccountLookupControllerTest -r human -w 10 -c
```

The tests assume Account OWD is **Private**. If it is not,
`testSearch_AccountOwnedByAnother_HasNoFullAccess` fails — which is the correct signal, because
the feature's premise no longer holds.

## Assign access

Nobody can use the tool until they hold the `Account_Lookup_User` permission set. It grants the
`Can_Search_All_Accounts` custom permission and access to the two Apex classes, and nothing else.

```bash
sf org assign permset -n Account_Lookup_User -o <username>
```

Or in Setup: **Permission Sets → Account Lookup User → Manage Assignments**.

## Place the component

**Utility bar** — Setup → App Manager → edit the app → Utility Items → Add → *Account Lookup*.
Set Panel Width `480`, Panel Height `520`. (Panel size is a property of the utility item, not of
the component, so it is set here rather than in metadata.)

**App page / home page / tab** — Lightning App Builder, drag *Account Lookup* onto the page.

## Checking it works

As a non-admin user holding the permission set:

1. Search 3+ characters of an account owned by someone else → the limited view appears, the
   record button reads "Limited view" and is disabled.
2. Open the row → the modal shows "You have a limited view of this account." and no open button.
3. Search an account the user owns → "Open record" appears and navigates.
4. Paste an inaccessible Account's URL into the browser → still "insufficient privileges".

As a user **without** the permission set, confirm the Apex refuses directly, not just the UI:

```apex
AccountLookupController.searchAccounts('test');  // anonymous Apex, as that user
```

It must throw "You do not have access to Account Lookup."

## Two org behaviours this code depends on

Both were found by deploying to fulltest, and both are easy to undo by accident:

1. **This org runs Apex database operations in user mode by default.** `without sharing` alone
   is not enough — an inline SOQL returns nothing for exactly the users this tool exists for,
   while still looking correct to an admin. Every query and the SOSL therefore state
   `AccessLevel.SYSTEM_MODE` explicitly. Remove that and the feature silently stops working
   for non-admins instead of failing loudly.
2. **SOSL string literals reject escape sequences** such as `\*`, and `Search.queryWithBinds`
   does not exist at this API version. So the search term has its operator characters replaced
   with spaces rather than escaped. Do not "fix" this by adding `String.escapeSingleQuotes()` —
   see the comment on `sanitizeSosl`.

Org automation also constrains the tests: `AccountTrigger` copies `Phone` into
`PersonMobilePhone` (which a business account may not hold), and
`Account_TRG_PopulatesSourceSystemId` rejects bulk account creation. Both are worked around in
the test setup and commented there.

## Before production

Not built in this round. The first two are blockers:

| Missing | Why it matters |
|---|---|
| `Account_Lookup_Log__c` audit object | There is no record of who looked up whom through a sharing bypass. |
| Per-user hourly rate limit | Counts those log rows. Without it, a permitted user can enumerate the whole Account table 25 rows at a time. |
| `Account_Lookup_Setting__mdt` | Minimum length (3), result cap (25), AUM band thresholds and the optional field names are hardcoded constants; changing one means a deploy. |
| Phase 2 — request access, pre-check mode | Not started. |
| Phase 3 — `@InvocableMethod` for AI agents | Not started. |

Also required before release, per the approved design:

- A Salesforce architect or security reviewer signs off `AccountLookupService` — the field
  whitelist, the permission check, the cap and the SOSL sanitizer are the only controls.
- The data protection contact confirms that phone, email, segment, client status, **AUM band**
  and household membership are appropriate to show to every permitted user for accounts they
  cannot otherwise access. Banding reduces the AUM exposure; it does not remove it.

## Files

```
force-app/main/default/
  classes/   AccountLookupService.cls, AccountLookupController.cls,
             AccountLookupException.cls, and their two test classes
  lwc/       accountLookup/, accountLookupDetail/
  customPermissions/  Can_Search_All_Accounts.customPermission-meta.xml
  permissionsets/     Account_Lookup_User.permissionset-meta.xml
```

Nothing changes Account OWD, sharing rules, account teams or duplicate rules, and no code here
performs DML on Account.
