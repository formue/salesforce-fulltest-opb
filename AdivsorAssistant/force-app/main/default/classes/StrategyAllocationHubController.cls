/**
 * Invocable fetch layer for the Strategy Allocation Hub LWC.
 *
 * DATA CONTRACT: all percentage fields in the returned JSON are decimal fractions —
 * 0.06 means 6 %. This matches lightning-datatable type:"percent" and the LWC's
 * threshold comparison (slider value ÷ 100).
 *
 * DATA SOURCES
 * ─────────────
 * Targets  : InvestmentStrategyAssetClass__c.FormueTarget__c / FormueTargetLower__c /
 *            FormueTargetHigher__c  (aggregated per AssetGroup__c per strategy)
 * Actuals  : FinServ__FinancialHolding__c.FinServ__MarketValue__c grouped by the
 *            financial accounts linked through InvestmentStrategyAccount__c
 * Mapping  : FSC holding asset class (Equities / Bonds / …) → AssetGroup__c
 *            (MarketGrowth / Stability / AlternativeGrowth).
 *            Hard-coded below; the authoritative source is AssetClass__mdt.
 *
 * QUERY PATTERN (4 SOQL calls, all WITH USER_MODE)
 * ──────────────────────────────────────────────────
 * 1. InvestmentStrategy__c  (up to 200 strategies)
 * 2. InvestmentStrategyAccount__c  (links strategies → FinancialAccount)
 * 3. InvestmentStrategyAssetClass__c aggregate (GROUP BY strategy + group → targets)
 * 4. FinServ__FinancialHolding__c aggregate (GROUP BY FA + asset class → actual MV)
 */
public with sharing class StrategyAllocationHubController {

    // Inject complete rows in tests to bypass all SOQL.
    @TestVisible static List<DriftRow> testRows;
    // Inject strategies in tests to check filter/empty-list logic independently.
    @TestVisible static List<InvestmentStrategy__c> testStrategies;

    // -------------------------------------------------------------------------
    // Invocable entry point
    // -------------------------------------------------------------------------

    public class FetchRequest {
        @InvocableVariable(label='Asset Group Filter'
                           description='Return only rows for this AssetGroup__c value (Stability / MarketGrowth / AlternativeGrowth); blank = all')
        public String assetGroup;

        @InvocableVariable(label='Management Type Filter'
                           description='Return only rows for this ManagementType__c value; blank = all')
        public String managementType;
    }

    public class FetchResult {
        @InvocableVariable(label='Portfolio Data JSON'
                           description='JSON array of drift rows consumed by strategyAllocationHub LWC')
        public String portfolioDataStr;
    }

    @InvocableMethod(
        label='Fetch Allocation Hub Data'
        description='Builds a JSON array of per-group drift rows for the Strategy Allocation Hub LWC, sourced from live FSC holdings and InvestmentStrategyAssetClass__c targets'
    )
    public static List<FetchResult> fetchAllocationData(List<FetchRequest> requests) {
        FetchRequest req = requests.isEmpty() ? new FetchRequest() : requests[0];
        String grpFilter  = String.isNotBlank(req.assetGroup)     ? req.assetGroup.trim()     : null;
        String mgmtFilter = String.isNotBlank(req.managementType) ? req.managementType.trim() : null;

        List<DriftRow> rows;
        if (Test.isRunningTest() && testRows != null) {
            rows = applyFilters(testRows, grpFilter, mgmtFilter);
        } else {
            rows = buildRowsFromLiveData(grpFilter, mgmtFilter);
        }

        FetchResult res = new FetchResult();
        res.portfolioDataStr = JSON.serialize(rows);
        return new List<FetchResult>{ res };
    }

    // -------------------------------------------------------------------------
    // Live data computation (4 queries)
    // -------------------------------------------------------------------------

    static List<DriftRow> buildRowsFromLiveData(String grpFilter, String mgmtFilter) {

        // ── 1. Strategies ─────────────────────────────────────────────────────
        List<InvestmentStrategy__c> strategies =
            testStrategies != null ? testStrategies : loadStrategies();

        Map<Id, InvestmentStrategy__c> stratMap = new Map<Id, InvestmentStrategy__c>(strategies);
        Set<Id> stratIds = stratMap.keySet();
        if (stratIds.isEmpty()) return new List<DriftRow>();

        // ── 2. Strategy → FinancialAccount links (account name + owner info) ──
        Map<Id, Set<Id>>  stratToFAs         = new Map<Id, Set<Id>>();
        Map<Id, Id>       stratToAccountId   = new Map<Id, Id>();
        Map<Id, String>   stratToAccountName = new Map<Id, String>();
        Map<Id, String>   stratToOwnerId     = new Map<Id, String>();
        Map<Id, String>   stratToOwnerName   = new Map<Id, String>();
        Map<Id, String>   stratToDept        = new Map<Id, String>();
        Set<Id> allFAIds = new Set<Id>();
        for (InvestmentStrategyAccount__c isa : [
            SELECT InvestmentStrategy__c, FinancialAccount__c,
                   Account__c, Account__r.Name,
                   Account__r.OwnerId, Account__r.Owner.Name, Account__r.Owner.Department
            FROM   InvestmentStrategyAccount__c
            WHERE  InvestmentStrategy__c IN :stratIds
            AND    FinancialAccount__c != null
            WITH   USER_MODE
        ]) {
            if (!stratToFAs.containsKey(isa.InvestmentStrategy__c)) {
                stratToFAs.put(isa.InvestmentStrategy__c, new Set<Id>());
            }
            stratToFAs.get(isa.InvestmentStrategy__c).add(isa.FinancialAccount__c);
            allFAIds.add(isa.FinancialAccount__c);
            if (!stratToAccountId.containsKey(isa.InvestmentStrategy__c) && isa.Account__c != null) {
                stratToAccountId.put(isa.InvestmentStrategy__c, isa.Account__c);
                stratToAccountName.put(isa.InvestmentStrategy__c,
                    isa.Account__r != null ? isa.Account__r.Name : null);
                if (isa.Account__r != null) {
                    stratToOwnerId.put(isa.InvestmentStrategy__c, isa.Account__r.OwnerId);
                    stratToOwnerName.put(isa.InvestmentStrategy__c,
                        isa.Account__r.Owner != null ? isa.Account__r.Owner.Name : null);
                    stratToDept.put(isa.InvestmentStrategy__c,
                        isa.Account__r.Owner != null ? isa.Account__r.Owner.Department : null);
                }
            }
        }
        if (allFAIds.isEmpty()) return new List<DriftRow>();

        // ── 2b. Account team members (Advisor / Assistant roles) ─────────────────
        Set<Id> allAccountIds = new Set<Id>(stratToAccountId.values());
        // Key: accountId → comma-separated "Name (Role)" strings
        Map<Id, List<String>> accountTeamMap = new Map<Id, List<String>>();
        if (!allAccountIds.isEmpty()) {
            for (AccountTeamMember atm : [
                SELECT AccountId, User.Name, TeamMemberRole
                FROM   AccountTeamMember
                WHERE  AccountId IN :allAccountIds
                AND    TeamMemberRole IN ('Advisor', 'Assistant')
                WITH   USER_MODE
            ]) {
                if (!accountTeamMap.containsKey(atm.AccountId)) {
                    accountTeamMap.put(atm.AccountId, new List<String>());
                }
                accountTeamMap.get(atm.AccountId).add(atm.User.Name + ' (' + atm.TeamMemberRole + ')');
            }
        }

        // ── 3. Target allocations per strategy per asset group ────────────────
        // Chunked to keep each GROUP BY result ≤ 2000 rows (aggregate queries
        // cannot use queryMore(); 300 strategies × 6 groups = 1800 rows max).
        Map<Id, Map<String, GroupTarget>> targetMap = new Map<Id, Map<String, GroupTarget>>();
        for (List<Id> chunk : chunkIds(stratIds, 300)) {
            for (AggregateResult ar : [
                SELECT RelatedStrategyInvestment__c stratId,
                       AssetGroup__c               grp,
                       SUM(FormueTarget__c)         tgt,
                       SUM(FormueTargetLower__c)    lo,
                       SUM(FormueTargetHigher__c)   hi
                FROM   InvestmentStrategyAssetClass__c
                WHERE  RelatedStrategyInvestment__c IN :chunk
                GROUP BY RelatedStrategyInvestment__c, AssetGroup__c
                LIMIT 2000
            ]) {
                Id     sid = (Id)     ar.get('stratId');
                String grp = (String) ar.get('grp');
                if (!targetMap.containsKey(sid)) targetMap.put(sid, new Map<String, GroupTarget>());
                GroupTarget t = new GroupTarget();
                t.targetPct = nullSafe(ar, 'tgt');
                t.lowerPct  = nullSafe(ar, 'lo');
                t.higherPct = nullSafe(ar, 'hi');
                targetMap.get(sid).put(grp, t);
            }
        }

        // ── 4. Actual holdings per financial account per asset group ──────────
        // Chunked: 200 FAs × ~8 asset classes = ≤ 1600 rows per chunk.
        Map<Id, Map<String, Decimal>> faActualMV  = new Map<Id, Map<String, Decimal>>();
        Map<Id, Decimal>              faTotalMV   = new Map<Id, Decimal>();
        for (List<Id> chunk : chunkIds(allFAIds, 200)) {
            for (AggregateResult ar : [
                SELECT FinServ__FinancialAccount__c faId,
                       FinServ__AssetClass__c       ac,
                       SUM(FinServ__MarketValue__c) mv
                FROM   FinServ__FinancialHolding__c
                WHERE  FinServ__FinancialAccount__c IN :chunk
                GROUP BY FinServ__FinancialAccount__c, FinServ__AssetClass__c
                LIMIT 2000
            ]) {
                Id      faId = (Id)     ar.get('faId');
                String  ac   = (String) ar.get('ac');
                Decimal mv   = nullSafe(ar, 'mv');
                if (mv == null || mv < 0) continue;

                String grp = mapHoldingClassToGroup(ac);
                if (grp == null) continue;

                if (!faActualMV.containsKey(faId)) faActualMV.put(faId, new Map<String, Decimal>());
                Decimal prev = faActualMV.get(faId).containsKey(grp) ? faActualMV.get(faId).get(grp) : 0;
                faActualMV.get(faId).put(grp, prev + mv);

                Decimal tot = faTotalMV.containsKey(faId) ? faTotalMV.get(faId) : 0;
                faTotalMV.put(faId, tot + mv);
            }
        }

        // ── 5. Build drift rows ───────────────────────────────────────────────
        // Holdings are NOT fetched here; they are lazy-loaded per-row via
        // getHoldingsForStrategy() when the advisor expands a row.
        String currentUserId = UserInfo.getUserId();
        List<DriftRow> rows = new List<DriftRow>();
        for (InvestmentStrategy__c strat : strategies) {
            if (mgmtFilter != null && strat.ManagementType__c != mgmtFilter) continue;

            Map<String, GroupTarget> targets = targetMap.get(strat.Id);
            if (targets == null || targets.isEmpty()) continue;

            Set<Id> faIds = stratToFAs.get(strat.Id);
            if (faIds == null || faIds.isEmpty()) continue;

            // Aggregate actual MV across all linked financial accounts
            Map<String, Decimal> combinedMV = new Map<String, Decimal>();
            Decimal              combinedTotal = 0;
            for (Id faId : faIds) {
                if (faActualMV.containsKey(faId)) {
                    for (String grp : faActualMV.get(faId).keySet()) {
                        Decimal prev = combinedMV.containsKey(grp) ? combinedMV.get(grp) : 0;
                        combinedMV.put(grp, prev + faActualMV.get(faId).get(grp));
                    }
                    combinedTotal += faTotalMV.containsKey(faId) ? faTotalMV.get(faId) : 0;
                }
            }
            if (combinedTotal == 0) continue;

            String accountName = stratToAccountName.get(strat.Id);
            String customerName = String.isNotBlank(accountName) ? accountName : strat.Name;

            for (String grp : targets.keySet()) {
                if (grpFilter != null && grp != grpFilter) continue;

                GroupTarget tgt     = targets.get(grp);
                Decimal     actMV   = combinedMV.containsKey(grp) ? combinedMV.get(grp) : 0;
                Decimal     actPct  = (actMV / combinedTotal) * 100; // whole-number percent
                Decimal     tgtPct  = tgt.targetPct != null ? tgt.targetPct : 0;
                Decimal     driftPct = actPct - tgtPct;

                DriftRow r              = new DriftRow();
                r.accountId             = stratToAccountId.get(strat.Id);
                r.customerName          = customerName;
                r.strategyId            = strat.Id;
                r.strategyName          = strat.Name;
                r.managementType        = strat.ManagementType__c;
                r.assetClass            = groupDisplayName(grp);
                r.bucket                = groupDisplayName(grp);
                r.actualPct             = (actPct  / 100).setScale(4, System.RoundingMode.HALF_UP);
                r.targetPct             = (tgtPct  / 100).setScale(4, System.RoundingMode.HALF_UP);
                r.driftPct              = (driftPct / 100).setScale(4, System.RoundingMode.HALF_UP);
                r.lowerBoundPct         = ((tgt.lowerPct  != null ? tgt.lowerPct  : 0) / 100).setScale(4, System.RoundingMode.HALF_UP);
                r.upperBoundPct         = ((tgt.higherPct != null ? tgt.higherPct : 0) / 100).setScale(4, System.RoundingMode.HALF_UP);
                r.totalPortfolioNOK     = combinedTotal.setScale(0, System.RoundingMode.HALF_UP);
                r.actionAmount          = (combinedTotal * Math.abs(driftPct / 100)).setScale(0, System.RoundingMode.HALF_UP);
                r.currencyCode          = 'NOK';
                r.ownerName             = stratToOwnerName.get(strat.Id);
                r.ownerId               = stratToOwnerId.get(strat.Id);
                r.department            = stratToDept.get(strat.Id);
                r.currentUserIsOwner    = currentUserId != null && currentUserId.equals(r.ownerId);
                Id acctId = stratToAccountId.get(strat.Id);
                r.teamAdvisorNames = acctId != null && accountTeamMap.containsKey(acctId)
                    ? String.join(accountTeamMap.get(acctId), ', ')
                    : '';
                rows.add(r);
            }
        }
        return rows;
    }

    // -------------------------------------------------------------------------
    // Filters applied when testRows are injected
    // -------------------------------------------------------------------------

    @TestVisible
    static List<DriftRow> applyFilters(List<DriftRow> source, String grpFilter, String mgmtFilter) {
        if (grpFilter == null && mgmtFilter == null) return source;
        List<DriftRow> out = new List<DriftRow>();
        for (DriftRow r : source) {
            if (grpFilter  != null && r.assetClass != groupDisplayName(grpFilter))  continue;
            if (mgmtFilter != null && r.managementType != mgmtFilter)               continue;
            out.add(r);
        }
        return out;
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    static List<InvestmentStrategy__c> loadStrategies() {
        return [
            SELECT Id, Name, ManagementType__c, InvestmentProfile__c, TotalPortfolio__c, Status__c
            FROM   InvestmentStrategy__c
            WHERE  Status__c IN ('Active', 'Selected', 'PendingSignature', 'Signed',
                                  'PendingTransfer', 'SentToAPX')
            WITH   USER_MODE
            LIMIT  2000
        ];
    }

    // -------------------------------------------------------------------------
    // On-demand holdings loader (called by LWC when a row is expanded)
    // -------------------------------------------------------------------------

    @AuraEnabled
    public static String getHoldingsForStrategy(String strategyId, String assetGroupDisplay) {
        if (String.isBlank(strategyId)) return '[]';

        // Resolve display name back to API group name
        String grpApi = null;
        if ('Market Growth'.equals(assetGroupDisplay))           grpApi = 'MarketGrowth';
        else if ('Alternative Growth'.equals(assetGroupDisplay)) grpApi = 'AlternativeGrowth';
        else if ('Stability'.equals(assetGroupDisplay))          grpApi = 'Stability';

        // Financial accounts for this strategy
        Set<Id> faIds = new Set<Id>();
        for (InvestmentStrategyAccount__c isa : [
            SELECT FinancialAccount__c
            FROM   InvestmentStrategyAccount__c
            WHERE  InvestmentStrategy__c = :strategyId
            AND    FinancialAccount__c   != null
            WITH   USER_MODE
            LIMIT  100
        ]) {
            faIds.add(isa.FinancialAccount__c);
        }
        if (faIds.isEmpty()) return '[]';

        List<HoldingRow> rows = new List<HoldingRow>();
        for (FinServ__FinancialHolding__c h : [
            SELECT Id, Name, FinServ__AssetClass__c, FinServ__MarketValue__c
            FROM   FinServ__FinancialHolding__c
            WHERE  FinServ__FinancialAccount__c IN :faIds
            AND    FinServ__MarketValue__c       > 0
            WITH   USER_MODE
            ORDER BY FinServ__MarketValue__c DESC
            LIMIT  200
        ]) {
            if (grpApi != null && !grpApi.equals(mapHoldingClassToGroup(h.FinServ__AssetClass__c))) continue;
            HoldingRow hr   = new HoldingRow();
            hr.holdingId    = h.Id;
            hr.productName  = h.Name;
            hr.assetClass   = h.FinServ__AssetClass__c;
            hr.marketValue  = h.FinServ__MarketValue__c.setScale(0, System.RoundingMode.HALF_UP);
            hr.currencyCode = 'NOK';
            rows.add(hr);
        }
        return JSON.serialize(rows);
    }

    // Splits a Set<Id> into a List of sub-lists each of at most chunkSize elements.
    static List<List<Id>> chunkIds(Set<Id> ids, Integer chunkSize) {
        List<Id> all = new List<Id>(ids);
        List<List<Id>> result = new List<List<Id>>();
        for (Integer i = 0; i < all.size(); i += chunkSize) {
            List<Id> chunk = new List<Id>();
            Integer endIdx = Math.min(i + chunkSize, all.size());
            for (Integer j = i; j < endIdx; j++) {
                chunk.add(all[j]);
            }
            result.add(chunk);
        }
        return result;
    }

    /**
     * Maps an FSC FinancialHolding asset class value to the InvestmentStrategy
     * AssetGroup__c used in InvestmentStrategyAssetClass__c records.
     *
     * TODO: Replace with a live query on AssetClass__mdt (which has AssetGroup__c
     *       and AssetClass__c columns) once the mdt field mapping is confirmed.
     */
    @TestVisible
    static String mapHoldingClassToGroup(String holdingClass) {
        if (holdingClass == null) return null;
        String lc = holdingClass.toLowerCase();
        if (lc.contains('equit'))         return 'MarketGrowth';
        if (lc.contains('bond'))          return 'Stability';
        if (lc.contains('money market') || lc.contains('cash')) return 'Stability';
        if (lc.contains('private equity')) return 'AlternativeGrowth';
        if (lc.contains('real asset'))     return 'AlternativeGrowth';
        if (lc.contains('hedge'))          return 'AlternativeGrowth';
        return null; // unknown — skip (e.g., "Fees and Rebates")
    }

    @TestVisible
    static String groupDisplayName(String grpApi) {
        if ('MarketGrowth'.equals(grpApi))      return 'Market Growth';
        if ('AlternativeGrowth'.equals(grpApi)) return 'Alternative Growth';
        return grpApi; // 'Stability' is already display-ready
    }

    static Decimal nullSafe(AggregateResult ar, String field) {
        Object val = ar.get(field);
        return val != null ? (Decimal) val : 0;
    }

    // -------------------------------------------------------------------------
    // Inner types — serialised by JSON.serialize into the LWC JSON contract
    // -------------------------------------------------------------------------

    @TestVisible
    class DriftRow {
        public String  accountId;
        public String  customerName;
        public String  strategyId;
        public String  strategyName;
        public String  managementType;
        public String  assetClass;
        public String  bucket;
        public Decimal actualPct;
        public Decimal targetPct;
        public Decimal driftPct;
        public Decimal lowerBoundPct;    // FormueTargetLower__c / 100
        public Decimal upperBoundPct;    // FormueTargetHigher__c / 100
        public Decimal totalPortfolioNOK;
        public Decimal actionAmount;
        public String  currencyCode;
        // Advisor / department (from Account.Owner)
        public String  ownerName;
        public String  ownerId;
        public String  department;
        public Boolean currentUserIsOwner;
        public String  teamAdvisorNames;  // comma-sep "Name (Role)" from AccountTeamMember
    }

    @TestVisible
    class HoldingRow {
        public String  holdingId;
        public String  productName;
        public String  assetClass;
        public Decimal marketValue;
        public String  currencyCode;
    }

    @TestVisible
    class GroupTarget {
        public Decimal targetPct;
        public Decimal lowerPct;
        public Decimal higherPct;
    }
}
