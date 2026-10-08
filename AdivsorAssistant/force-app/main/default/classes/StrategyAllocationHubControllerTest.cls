@IsTest
private class StrategyAllocationHubControllerTest {

    // Build a DriftRow for test injection without any DML or FSC objects.
    private static StrategyAllocationHubController.DriftRow row(
            String managementType, String assetClass, Decimal actualPct, Decimal targetPct,
            Decimal lowerBound, Decimal upperBound, Decimal totalPortfolio) {
        StrategyAllocationHubController.DriftRow r = new StrategyAllocationHubController.DriftRow();
        r.accountId         = '001000000000000AAA';
        r.customerName      = 'Test Customer';
        r.strategyId        = 'a0n000000000000AAA';
        r.strategyName      = 'IS-TEST';
        r.managementType    = managementType;
        r.assetClass        = assetClass;
        r.bucket            = assetClass;
        r.actualPct         = actualPct;
        r.targetPct         = targetPct;
        r.driftPct          = actualPct - targetPct;
        r.lowerBoundPct     = lowerBound;
        r.upperBoundPct     = upperBound;
        r.totalPortfolioNOK = totalPortfolio;
        r.actionAmount      = totalPortfolio * Math.abs(actualPct - targetPct);
        r.currencyCode      = 'NOK';
        return r;
    }

    private static StrategyAllocationHubController.FetchResult call(String assetGroup, String mgmtType) {
        StrategyAllocationHubController.FetchRequest req = new StrategyAllocationHubController.FetchRequest();
        req.assetGroup     = assetGroup;
        req.managementType = mgmtType;
        return StrategyAllocationHubController.fetchAllocationData(
            new List<StrategyAllocationHubController.FetchRequest>{ req }
        )[0];
    }

    // ── Strategy-level injection tests (testStrategies path) ─────────────────

    @IsTest
    static void emptyStrategyListReturnsEmptyArray() {
        StrategyAllocationHubController.testStrategies = new List<InvestmentStrategy__c>();
        Test.startTest();
        StrategyAllocationHubController.FetchResult res = call(null, null);
        Test.stopTest();
        Assert.areEqual('[]', res.portfolioDataStr, 'Empty strategy list must produce []');
    }

    @IsTest
    static void emptyRequestListUsesDefaults() {
        StrategyAllocationHubController.testStrategies = new List<InvestmentStrategy__c>();
        Test.startTest();
        List<StrategyAllocationHubController.FetchResult> results =
            StrategyAllocationHubController.fetchAllocationData(
                new List<StrategyAllocationHubController.FetchRequest>()
            );
        Test.stopTest();
        Assert.isNotNull(results);
        Assert.areEqual(1, results.size());
        Assert.areEqual('[]', results[0].portfolioDataStr);
    }

    // ── Row-level injection tests (testRows path) ─────────────────────────────

    @IsTest
    static void allPercentagesAreDecimalFractions() {
        StrategyAllocationHubController.testRows = new List<StrategyAllocationHubController.DriftRow>{
            row('PortfolioManagement', 'Stability',       0.14, 0.16, 0.10, 0.22, 5000000),
            row('PortfolioManagement', 'Market Growth',   0.50, 0.44, 0.35, 0.53, 5000000),
            row('PortfolioManagement', 'Alternative Growth', 0.36, 0.40, 0.30, 0.50, 5000000)
        };
        Test.startTest();
        StrategyAllocationHubController.FetchResult res = call(null, null);
        Test.stopTest();

        List<Object> rows = (List<Object>) JSON.deserializeUntyped(res.portfolioDataStr);
        Assert.areEqual(3, rows.size());
        for (Object rawRow : rows) {
            Map<String, Object> r = (Map<String, Object>) rawRow;
            Decimal actual = (Decimal) r.get('actualPct');
            Decimal target = (Decimal) r.get('targetPct');
            Decimal lower  = (Decimal) r.get('lowerBoundPct');
            Decimal upper  = (Decimal) r.get('upperBoundPct');
            Assert.isTrue(actual >= 0 && actual <= 1, 'actualPct must be in [0,1]; got ' + actual);
            Assert.isTrue(target >= 0 && target <= 1, 'targetPct must be in [0,1]; got ' + target);
            Assert.isTrue(lower  >= 0 && lower  <= 1, 'lowerBoundPct must be in [0,1]; got ' + lower);
            Assert.isTrue(upper  >= 0 && upper  <= 1, 'upperBoundPct must be in [0,1]; got ' + upper);
        }
    }

    @IsTest
    static void assetGroupFilterReturnsOnlyMatchingRows() {
        StrategyAllocationHubController.testRows = new List<StrategyAllocationHubController.DriftRow>{
            row('PortfolioManagement', 'Stability',       0.14, 0.16, 0.10, 0.22, 5000000),
            row('PortfolioManagement', 'Market Growth',   0.50, 0.44, 0.35, 0.53, 5000000),
            row('PortfolioManagement', 'Alternative Growth', 0.36, 0.40, 0.30, 0.50, 5000000)
        };
        Test.startTest();
        StrategyAllocationHubController.FetchResult res = call('Stability', null);
        Test.stopTest();

        List<Object> rows = (List<Object>) JSON.deserializeUntyped(res.portfolioDataStr);
        Assert.areEqual(1, rows.size(), 'Stability filter must return exactly 1 row');
        Map<String, Object> r = (Map<String, Object>) rows[0];
        Assert.areEqual('Stability', (String) r.get('assetClass'));
    }

    @IsTest
    static void managementTypeFilterExcludesNonMatchingRows() {
        StrategyAllocationHubController.testRows = new List<StrategyAllocationHubController.DriftRow>{
            row('PortfolioManagement', 'Market Growth', 0.50, 0.44, 0.35, 0.53, 5000000),
            row('Advisory',            'Market Growth', 0.42, 0.44, 0.35, 0.53, 2000000)
        };
        Test.startTest();
        StrategyAllocationHubController.FetchResult res = call(null, 'Advisory');
        Test.stopTest();

        List<Object> rows = (List<Object>) JSON.deserializeUntyped(res.portfolioDataStr);
        Assert.areEqual(1, rows.size(), 'Advisory filter must return exactly 1 row');
        Map<String, Object> r = (Map<String, Object>) rows[0];
        Assert.areEqual('Advisory', (String) r.get('managementType'));
    }

    @IsTest
    static void actionAmountIsNonNegative() {
        StrategyAllocationHubController.testRows = new List<StrategyAllocationHubController.DriftRow>{
            row('PortfolioManagement', 'Stability', 0.14, 0.16, 0.10, 0.22, 3000000)
        };
        Test.startTest();
        StrategyAllocationHubController.FetchResult res = call(null, null);
        Test.stopTest();

        List<Object> rows = (List<Object>) JSON.deserializeUntyped(res.portfolioDataStr);
        Map<String, Object> r = (Map<String, Object>) rows[0];
        Decimal actionAmt = (Decimal) r.get('actionAmount');
        Assert.isTrue(actionAmt >= 0, 'actionAmount must be non-negative; got ' + actionAmt);
    }

    @IsTest
    static void driftIsActualMinusTarget() {
        Decimal act = 0.50;
        Decimal tgt = 0.44;
        StrategyAllocationHubController.testRows = new List<StrategyAllocationHubController.DriftRow>{
            row('PortfolioManagement', 'Market Growth', act, tgt, 0.35, 0.53, 5000000)
        };
        Test.startTest();
        StrategyAllocationHubController.FetchResult res = call(null, null);
        Test.stopTest();

        List<Object> rows = (List<Object>) JSON.deserializeUntyped(res.portfolioDataStr);
        Map<String, Object> r = (Map<String, Object>) rows[0];
        Decimal drift = (Decimal) r.get('driftPct');
        // Allow for rounding
        Assert.isTrue(Math.abs(drift - (act - tgt)) < 0.001,
            'driftPct should equal actual - target; got ' + drift);
    }

    // ── Static helper tests ──────────────────────────────────────────────────

    @IsTest
    static void mapHoldingClassToGroupCoversKnownClasses() {
        Assert.areEqual('MarketGrowth',      StrategyAllocationHubController.mapHoldingClassToGroup('Equities'));
        Assert.areEqual('Stability',         StrategyAllocationHubController.mapHoldingClassToGroup('Bonds'));
        Assert.areEqual('Stability',         StrategyAllocationHubController.mapHoldingClassToGroup('Money market/cash'));
        Assert.areEqual('AlternativeGrowth', StrategyAllocationHubController.mapHoldingClassToGroup('PRIVATE EQUITY'));
        Assert.areEqual('AlternativeGrowth', StrategyAllocationHubController.mapHoldingClassToGroup('Real assets'));
        Assert.areEqual('AlternativeGrowth', StrategyAllocationHubController.mapHoldingClassToGroup('Hedge funds'));
        Assert.isNull(StrategyAllocationHubController.mapHoldingClassToGroup('Fees and Rebates'),
            'Unknown class should return null');
        Assert.isNull(StrategyAllocationHubController.mapHoldingClassToGroup(null));
    }

    @IsTest
    static void groupDisplayNameFormatsCorrectly() {
        Assert.areEqual('Market Growth',      StrategyAllocationHubController.groupDisplayName('MarketGrowth'));
        Assert.areEqual('Alternative Growth', StrategyAllocationHubController.groupDisplayName('AlternativeGrowth'));
        Assert.areEqual('Stability',          StrategyAllocationHubController.groupDisplayName('Stability'));
    }
}
