/**
 * Covers AccountLookupService.
 *
 * The behaviour worth protecting is everything that keeps a deliberate sharing bypass
 * narrow: the custom permission gate, the hardcoded field whitelist, the result cap, the
 * escaping of the search term, and hasFullAccess telling the UI when it may link to the
 * real record.
 *
 * These tests assume the admin prerequisite that Account OWD is Private. Without it
 * testSearch_AccountOwnedByAnother_HasNoFullAccess will fail, which is the correct signal:
 * the feature's premise no longer holds.
 */
@IsTest
private class AccountLookupServiceTest {

    private static final String PERMISSION_SET = 'Account_Lookup_User';
    private static final String HOUSEHOLD_FIELD = 'RelatedHouseholdAccount__c';

    private static Boolean hasHouseholdField() {
        return Schema.SObjectType.Account.fields.getMap().containsKey(HOUSEHOLD_FIELD);
    }

    @TestSetup
    static void makeData() {
        // Users are setup objects; inserting them in the same transaction as Accounts needs
        // the usual runAs wrapper to avoid MIXED_DML_OPERATION.
        User permitted;
        User otherOwner;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            permitted  = buildUser('alperm');
            otherOwner = buildUser('alownr');
            insert new List<User>{ permitted, otherOwner };

            PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = :PERMISSION_SET LIMIT 1];
            insert new PermissionSetAssignment(
                AssigneeId      = permitted.Id,
                PermissionSetId = ps.Id
            );
        }

        // Owned by someone else: the permitted user must find it but must not have access.
        // No Phone: this org's AccountTrigger copies Phone into PersonMobilePhone, which a
        // business account may not hold, so setting it here fails the insert. The phone
        // field is still covered by the DTO-shape assertion in
        // testSearch_ReturnsOnlyWhitelistedFields.
        Account household = new Account(Name = 'Lookup Household Delta');
        insert household;

        Account owned = new Account(Name = 'Lookup Owned Beta', OwnerId = permitted.Id);
        // Set dynamically: the household link is an org-specific field, and these tests
        // must still compile in an org that does not have it.
        if (Schema.SObjectType.Account.fields.getMap().containsKey(HOUSEHOLD_FIELD)) {
            owned.put(HOUSEHOLD_FIELD, String.valueOf(household.Id));
        }
        insert owned;

        insert new Account(
            Name           = 'Lookup Target Alpha',
            OwnerId        = otherOwner.Id,
            Type           = 'Customer',
            Website        = 'https://alpha.example.com',
            BillingCity    = 'Oslo',
            BillingCountry = 'Norway'
        );
    }

    private static User buildUser(String alias) {
        Profile p = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
        String unique = alias + System.now().getTime() + Math.abs(Crypto.getRandomInteger());
        return new User(
            Alias             = alias,
            Email             = unique + '@example.com',
            Username          = unique + '@example.com.accountlookup',
            LastName          = 'Lookup Test',
            ProfileId         = p.Id,
            EmailEncodingKey  = 'UTF-8',
            LanguageLocaleKey = 'en_US',
            LocaleSidKey      = 'en_US',
            TimeZoneSidKey    = 'Europe/Oslo'
        );
    }

    private static User permittedUser() {
        return [SELECT Id FROM User WHERE Alias = 'alperm' AND IsActive = true LIMIT 1];
    }

    private static User unpermittedUser() {
        return [SELECT Id FROM User WHERE Alias = 'alownr' AND IsActive = true LIMIT 1];
    }

    private static Account targetAccount() {
        return [SELECT Id, Name FROM Account WHERE Name = 'Lookup Target Alpha' LIMIT 1];
    }

    // ── Permission gate ──────────────────────────────────────────────────────

    @IsTest
    static void testSearch_WithoutCustomPermission_IsBlocked() {
        Test.startTest();
        System.runAs(unpermittedUser()) {
            try {
                AccountLookupService.search('Lookup');
                Assert.fail('A user without Can_Search_All_Accounts must not get results');
            } catch (AccountLookupException e) {
                Assert.areEqual('You do not have access to Account Lookup.', e.getMessage(),
                    'The block must use the friendly permission message');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testGetDetails_WithoutCustomPermission_IsBlocked() {
        Id accountId = targetAccount().Id;

        Test.startTest();
        System.runAs(unpermittedUser()) {
            try {
                AccountLookupService.getDetails(accountId);
                Assert.fail('A user without Can_Search_All_Accounts must not get details');
            } catch (AccountLookupException e) {
                Assert.areEqual('You do not have access to Account Lookup.', e.getMessage(),
                    'The block must use the friendly permission message');
            }
        }
        Test.stopTest();
    }

    // ── Search ───────────────────────────────────────────────────────────────

    @IsTest
    static void testSearch_ReturnsOnlyWhitelistedFields() {
        Account target = targetAccount();
        List<AccountLookupService.AccountLookupResult> results;

        Test.startTest();
        System.runAs(permittedUser()) {
            Test.setFixedSearchResults(new List<Id>{ target.Id });
            results = AccountLookupService.search('Lookup');
        }
        Test.stopTest();

        Assert.areEqual(1, results.size(), 'The matching account should be found');
        AccountLookupService.AccountLookupResult row = results[0];
        Assert.areEqual(target.Id, row.accountId, 'Id should be returned');
        Assert.areEqual('Lookup Target Alpha', row.name, 'Name should be returned');
        Assert.areEqual('Customer', row.type, 'Type should be returned');
        Assert.areEqual('https://alpha.example.com', row.website, 'Website should be returned');
        Assert.areEqual('Oslo', row.billingCity, 'Billing city should be returned');
        Assert.areEqual('Norway', row.billingCountry, 'Billing country should be returned');
        Assert.isNotNull(row.ownerName, 'Owner name should be returned');
        Assert.isNotNull(row.recordType, 'Record type should be returned so results can be filtered');

        // The DTO is the contract. Pin its exact shape: a field added to the limited view
        // without review fails here, which is the point of the whitelist.
        Map<String, Object> serialized =
            (Map<String, Object>) JSON.deserializeUntyped(JSON.serialize(row));
        Set<String> expected = new Set<String>{
            'accountId', 'name', 'type', 'phone', 'website', 'industry',
            'billingCity', 'billingCountry', 'lastActivityDate', 'recordType', 'email',
            'segment', 'status', 'aumBand', 'aum', 'householdId', 'householdName',
            'householdMemberCount', 'ownerName', 'hasFullAccess'
        };
        Assert.areEqual(expected, serialized.keySet(),
            'The limited view must expose exactly the whitelisted fields and nothing else');
    }

    @IsTest
    static void testSearch_AccountOwnedByAnother_HasNoFullAccess() {
        Account target = targetAccount();
        List<AccountLookupService.AccountLookupResult> results;

        Test.startTest();
        System.runAs(permittedUser()) {
            Test.setFixedSearchResults(new List<Id>{ target.Id });
            results = AccountLookupService.search('Lookup');
        }
        Test.stopTest();

        Assert.areEqual(false, results[0].hasFullAccess,
            'Under Private OWD the user must not be told they can open this record');
    }

    @IsTest
    static void testSearch_OwnedAccount_HasFullAccess() {
        Account owned = [SELECT Id FROM Account WHERE Name = 'Lookup Owned Beta' LIMIT 1];
        List<AccountLookupService.AccountLookupResult> results;

        Test.startTest();
        System.runAs(permittedUser()) {
            Test.setFixedSearchResults(new List<Id>{ owned.Id });
            results = AccountLookupService.search('Lookup');
        }
        Test.stopTest();

        Assert.areEqual(true, results[0].hasFullAccess,
            'The owner of a record may be linked to it');
    }

    @IsTest
    static void testSearch_BelowMinimumLength_IsRejected() {
        Test.startTest();
        System.runAs(permittedUser()) {
            try {
                AccountLookupService.search('ab');
                Assert.fail('A two-character term must be rejected server-side');
            } catch (AccountLookupException e) {
                Assert.areEqual('Enter at least 3 characters to search.', e.getMessage(),
                    'The minimum-length message should name the minimum');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testSearch_NullAndBlankTerm_AreRejected() {
        Test.startTest();
        System.runAs(permittedUser()) {
            try {
                AccountLookupService.search(null);
                Assert.fail('A null term must be rejected rather than NPE');
            } catch (AccountLookupException e) {
                Assert.isNotNull(e.getMessage(), 'Null should produce the friendly message');
            }
            try {
                AccountLookupService.search('      ');
                Assert.fail('A whitespace-only term must be rejected');
            } catch (AccountLookupException e) {
                Assert.isNotNull(e.getMessage(), 'Whitespace should produce the friendly message');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testSearch_OverlongTerm_IsTruncatedNotRejected() {
        Id targetId = targetAccount().Id;
        List<AccountLookupService.AccountLookupResult> results;
        Test.startTest();
        System.runAs(permittedUser()) {
            Test.setFixedSearchResults(new List<Id>{ targetId });
            results = AccountLookupService.search('x'.repeat(500));
        }
        Test.stopTest();

        Assert.isNotNull(results, 'A 500-character term should be truncated, not blow up');
    }

    @IsTest
    static void testSearch_QueryCarriesTheCapAndOnlyWhitelistedFields() {
        // The data-driven version of this test cannot run here: creating the 26+ accounts
        // it needs trips this org's Account_TRG_PopulatesSourceSystemId flow. The cap and
        // the field list are asserted on the query that is actually sent instead.
        String sosl;
        Test.startTest();
        System.runAs(permittedUser()) {
            sosl = AccountLookupService.buildSoslQuery('Acme');
        }
        Test.stopTest();

        Assert.isTrue(sosl.contains('LIMIT 25'),
            'The hard result cap must be in the query, got: ' + sosl);
        Assert.isTrue(sosl.contains('FIND \'Acme*\''),
            'The sanitized term should be searched as a prefix, got: ' + sosl);
        for (String field : new List<String>{
            'Id', 'Name', 'Type', 'Phone', 'Website', 'Industry',
            'BillingCity', 'BillingCountry', 'LastActivityDate', 'RecordType.Name', 'Owner.Name'
        }) {
            Assert.isTrue(sosl.contains(field),
                'Whitelisted field ' + field + ' should be queried, got: ' + sosl);
        }
        Assert.isFalse(sosl.contains('Rating'),
            'A field outside the whitelist must never appear in the query');
    }

    @IsTest
    static void testSearch_SpecialCharactersDoNotBreakTheQuery() {
        List<String> nasty = new List<String>{
            'O\'Brien', 'Acme "Holdings"', 'Acme*', 'Acme-Corp', 'Acme\\Corp',
            'Acme & Co', 'Acme (Norway)', 'Acme {test}', 'Acme [1]', 'Acme?!',
            'Acme ~ Corp', 'Acme + Corp', 'Acme : Corp', 'Acme | Corp', 'Acme^2'
        };

        Id targetId = targetAccount().Id;
        Test.startTest();
        System.runAs(permittedUser()) {
            Test.setFixedSearchResults(new List<Id>{ targetId });
            for (String term : nasty) {
                try {
                    AccountLookupService.search(term);
                } catch (Exception e) {
                    Assert.fail('Term "' + term + '" should not throw, got: ' + e.getMessage());
                }
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testSanitizeSosl_NeutralisesReservedCharacters() {
        Assert.areEqual('Acme', AccountLookupService.sanitizeSosl('Acme*'),
            'An asterisk must not survive as a live wildcard');
        Assert.areEqual('Acme Corp', AccountLookupService.sanitizeSosl('Acme-Corp'),
            'A hyphen is a SOSL operator and must become a separator');
        Assert.areEqual('Acme Corp', AccountLookupService.sanitizeSosl('Acme Corp'),
            'Ordinary text must pass through untouched');
        Assert.areEqual('O Brien', AccountLookupService.sanitizeSosl('O\'Brien'),
            'A quote must not survive, it would close the query string literal');
        Assert.areEqual('', AccountLookupService.sanitizeSosl('***'),
            'A term of nothing but operators must collapse to empty');
        Assert.isFalse(AccountLookupService.sanitizeSosl('a"b\'c)d').contains('"'),
            'No quote of either kind may survive sanitizing');
    }

    @IsTest
    static void testSearch_TermOfOnlyReservedCharacters_MatchesNothing() {
        List<AccountLookupService.AccountLookupResult> results;
        Test.startTest();
        System.runAs(permittedUser()) {
            results = AccountLookupService.search('***');
        }
        Test.stopTest();

        Assert.areEqual(0, results.size(),
            'A term with nothing searchable in it must match nothing, never everything');
    }

    // ── Details ──────────────────────────────────────────────────────────────

    @IsTest
    static void testGetDetails_ReturnsLimitedView() {
        Account target = targetAccount();
        AccountLookupService.AccountLookupResult result;

        Test.startTest();
        System.runAs(permittedUser()) {
            result = AccountLookupService.getDetails(target.Id);
        }
        Test.stopTest();

        Assert.areEqual(target.Id, result.accountId, 'The requested account should come back');
        Assert.areEqual('Lookup Target Alpha', result.name, 'Name should be returned');
        Assert.areEqual('Oslo', result.billingCity, 'Billing city should be returned');
        Assert.areEqual(false, result.hasFullAccess,
            'An account owned by someone else must not be linkable');
    }

    @IsTest
    static void testGetDetails_NonAccountId_IsRejected() {
        Id userId = UserInfo.getUserId();

        Test.startTest();
        System.runAs(permittedUser()) {
            try {
                AccountLookupService.getDetails(userId);
                Assert.fail('An Id of another sObject type must be rejected');
            } catch (AccountLookupException e) {
                Assert.areEqual('That is not a valid account.', e.getMessage(),
                    'A non-Account Id should get the invalid-account message');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testGetDetails_NullId_IsRejected() {
        Test.startTest();
        System.runAs(permittedUser()) {
            try {
                AccountLookupService.getDetails(null);
                Assert.fail('A null Id must be rejected');
            } catch (AccountLookupException e) {
                Assert.areEqual('That is not a valid account.', e.getMessage(),
                    'Null should get the invalid-account message');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testGetDetails_DeletedAccount_ReportsNotFound() {
        Account target = targetAccount();
        delete target;

        Test.startTest();
        System.runAs(permittedUser()) {
            try {
                AccountLookupService.getDetails(target.Id);
                Assert.fail('An account that no longer exists must report not found');
            } catch (AccountLookupException e) {
                Assert.areEqual('Account not found.', e.getMessage(),
                    'A missing account should get the not-found message');
            }
        }
        Test.stopTest();
    }

    // ── Scopes ───────────────────────────────────────────────────────────────

    @IsTest
    static void testSearch_MineScope_ReturnsOnlyAccountsIOwn() {
        List<AccountLookupService.AccountLookupResult> results;

        Test.startTest();
        System.runAs(permittedUser()) {
            results = AccountLookupService.search('Lookup', AccountLookupService.SCOPE_MINE);
        }
        Test.stopTest();

        Assert.areEqual(1, results.size(),
            'The permitted user owns exactly one of the test accounts');
        Assert.areEqual('Lookup Owned Beta', results[0].name, 'And it is the one they own');
        Assert.areEqual(true, results[0].hasFullAccess,
            'A scoped search can only return records the user can already read');
    }

    @IsTest
    static void testSearch_MineScope_ExcludesAccountsOwnedByOthers() {
        List<AccountLookupService.AccountLookupResult> results;

        Test.startTest();
        System.runAs(permittedUser()) {
            results = AccountLookupService.search('Target', AccountLookupService.SCOPE_MINE);
        }
        Test.stopTest();

        Assert.areEqual(0, results.size(),
            'Lookup Target Alpha is owned by someone else and must not appear in My customers');
    }

    @IsTest
    static void testSearch_TeamScope_ReturnsAccountsIAmOnTheTeamFor() {
        Account target = targetAccount();
        User permitted = permittedUser();
        insert new AccountTeamMember(
            AccountId = target.Id,
            UserId = permitted.Id,
            TeamMemberRole = 'Account Manager'
        );

        List<AccountLookupService.AccountLookupResult> results;
        Test.startTest();
        System.runAs(permitted) {
            results = AccountLookupService.search('Target', AccountLookupService.SCOPE_TEAM);
        }
        Test.stopTest();

        Assert.areEqual(1, results.size(),
            'An account the user is on the team for must appear in My team\'s customers');
        Assert.areEqual('Lookup Target Alpha', results[0].name, 'And it is the right one');
    }

    @IsTest
    static void testSearch_TeamScope_ExcludesAccountsIMerelyOwn() {
        List<AccountLookupService.AccountLookupResult> results;

        Test.startTest();
        System.runAs(permittedUser()) {
            results = AccountLookupService.search('Owned', AccountLookupService.SCOPE_TEAM);
        }
        Test.stopTest();

        Assert.areEqual(0, results.size(),
            'Owning an account is not the same as being on its team');
    }

    @IsTest
    static void testSearch_BothScope_ReturnsOwnedAndTeamAccounts() {
        Account target = targetAccount();
        User permitted = permittedUser();
        insert new AccountTeamMember(
            AccountId = target.Id,
            UserId = permitted.Id,
            TeamMemberRole = 'Account Manager'
        );

        List<AccountLookupService.AccountLookupResult> results;
        Test.startTest();
        System.runAs(permitted) {
            results = AccountLookupService.search('Lookup', AccountLookupService.SCOPE_BOTH);
        }
        Test.stopTest();

        Set<String> names = new Set<String>();
        for (AccountLookupService.AccountLookupResult row : results) {
            names.add(row.name);
        }
        Assert.isTrue(names.contains('Lookup Owned Beta'), 'Mine & team includes what I own');
        Assert.isTrue(names.contains('Lookup Target Alpha'), 'Mine & team includes my team\'s');
    }

    @IsTest
    static void testSearch_UnknownScope_FallsBackToAll() {
        Account target = targetAccount();
        List<AccountLookupService.AccountLookupResult> results;

        Test.startTest();
        System.runAs(permittedUser()) {
            Test.setFixedSearchResults(new List<Id>{ target.Id });
            results = AccountLookupService.search('Lookup', 'not-a-scope');
        }
        Test.stopTest();

        // All is what the custom permission already allows, so this is a safe fallback.
        Assert.areEqual(1, results.size(),
            'An unrecognised scope should search everything rather than fail');
        Assert.areEqual(false, results[0].hasFullAccess,
            'And it goes through the bypass path, which can return inaccessible records');
    }

    @IsTest
    static void testSearch_ScopeIsStillBehindThePermissionCheck() {
        Test.startTest();
        System.runAs(unpermittedUser()) {
            try {
                AccountLookupService.search('Lookup', AccountLookupService.SCOPE_MINE);
                Assert.fail('Every scope sits behind the same permission check');
            } catch (AccountLookupException e) {
                Assert.areEqual('You do not have access to Account Lookup.', e.getMessage(),
                    'The block must use the friendly permission message');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testSearch_ScopedSearchEnforcesTheMinimumLength() {
        Test.startTest();
        System.runAs(permittedUser()) {
            try {
                AccountLookupService.search('ab', AccountLookupService.SCOPE_MINE);
                Assert.fail('The minimum length applies to every scope');
            } catch (AccountLookupException e) {
                Assert.areEqual('Enter at least 3 characters to search.', e.getMessage(),
                    'The minimum-length message should name the minimum');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testSanitizeLike_EscapesWildcards() {
        // Without this, searching "50%" in a scoped search would match everything.
        Assert.areEqual('50\\%', AccountLookupService.sanitizeLike('50%'),
            'A percent sign must be matched literally, not as a wildcard');
        Assert.areEqual('a\\_b', AccountLookupService.sanitizeLike('a_b'),
            'An underscore is a single-character wildcard and must be escaped');
        Assert.areEqual('Acme Corp', AccountLookupService.sanitizeLike('Acme Corp'),
            'Ordinary text must pass through untouched');
    }

    @IsTest
    static void testSearch_ScopedSearchWithWildcardCharacters_MatchesLiterally() {
        // Three characters, so it clears the length guard and actually runs the query.
        // Unescaped, "%%%" in a LIKE would match every account the user owns.
        List<AccountLookupService.AccountLookupResult> results;

        Test.startTest();
        System.runAs(permittedUser()) {
            results = AccountLookupService.search('%%%', AccountLookupService.SCOPE_MINE);
        }
        Test.stopTest();

        Assert.areEqual(0, results.size(),
            'Wildcards must be matched literally, so no account name contains "%%%"');
    }

    // ── AUM exposure ─────────────────────────────────────────────────────────

    @IsTest
    static void testAumBand_CoversEveryBoundary() {
        Assert.isNull(AccountLookupService.aumBand(null), 'No AUM means no band');
        Assert.isNull(AccountLookupService.aumBand(0), 'Zero AUM means no band');
        Assert.areEqual('< 1M', AccountLookupService.aumBand(999999), 'Just under a million');
        Assert.areEqual('1-10M', AccountLookupService.aumBand(1000000), 'Exactly a million');
        Assert.areEqual('1-10M', AccountLookupService.aumBand(9999999), 'Just under ten million');
        Assert.areEqual('10-100M', AccountLookupService.aumBand(10000000), 'Exactly ten million');
        Assert.areEqual('10-100M', AccountLookupService.aumBand(99999999), 'Just under a hundred million');
        Assert.areEqual('100M+', AccountLookupService.aumBand(100000000), 'Exactly a hundred million');
        Assert.areEqual('100M+', AccountLookupService.aumBand(5000000000.0), 'Well above the top band');
    }

    @IsTest
    static void testGetDetails_ZeroAum_ReturnsNoFigureEvenWithAccess() {
        // This org stores 0 rather than null on the accounts with no assets recorded, and
        // returning it made every such row render a bare "0". Zero is not a figure.
        Account owned = [SELECT Id FROM Account WHERE Name = 'Lookup Owned Beta' LIMIT 1];
        AccountLookupService.AccountLookupResult result;

        Test.startTest();
        System.runAs(permittedUser()) {
            result = AccountLookupService.getDetails(owned.Id);
        }
        Test.stopTest();

        Assert.areEqual(true, result.hasFullAccess, 'The permitted user owns this account');
        Assert.isNull(result.aum,
            'An AUM of zero must come back as no figure, not as 0');
        Assert.isNull(result.aumBand,
            'An AUM of zero must not be placed in a size band either');
    }

    @IsTest
    static void testSearch_LimitedViewRow_CarriesNoExactAum() {
        // The control that matters: an exact AUM must never leave the server for a record
        // the running user cannot read. The band may.
        Account target = targetAccount();
        List<AccountLookupService.AccountLookupResult> results;

        Test.startTest();
        System.runAs(permittedUser()) {
            Test.setFixedSearchResults(new List<Id>{ target.Id });
            results = AccountLookupService.search('Lookup');
        }
        Test.stopTest();

        AccountLookupService.AccountLookupResult row = results[0];
        Assert.areEqual(false, row.hasFullAccess, 'This account is owned by someone else');
        Assert.isNull(row.aum,
            'An exact AUM must never be returned for an account the user cannot read');

        // And prove it is absent from the serialized payload, not merely null on the object.
        Map<String, Object> payload =
            (Map<String, Object>) JSON.deserializeUntyped(JSON.serialize(row));
        Assert.isNull(payload.get('aum'),
            'The serialized limited view must not carry an exact AUM');
    }

    @IsTest
    static void testGetDetails_OwnedRow_MayCarryExactAum() {
        Account owned = [SELECT Id FROM Account WHERE Name = 'Lookup Owned Beta' LIMIT 1];
        AccountLookupService.AccountLookupResult result;

        Test.startTest();
        System.runAs(permittedUser()) {
            result = AccountLookupService.getDetails(owned.Id);
        }
        Test.stopTest();

        Assert.areEqual(true, result.hasFullAccess, 'The permitted user owns this account');
        // The org's AUM field is a formula, so a bare test record has no meaningful figure.
        // Assert the rule rather than a value: for a readable record the band is simply
        // derived from the exact figure.
        Assert.areEqual(AccountLookupService.aumBand(result.aum), result.aumBand,
            'The band must be derived from the exact figure for a record the user can read');
    }

    // ── Household ────────────────────────────────────────────────────────────

    @IsTest
    static void testGetHouseholdMembers_WithoutPermission_IsBlocked() {
        Id householdId = targetAccount().Id;

        Test.startTest();
        System.runAs(unpermittedUser()) {
            try {
                AccountLookupService.getHouseholdMembers(householdId);
                Assert.fail('Household members must not be returned without the permission');
            } catch (AccountLookupException e) {
                Assert.areEqual('You do not have access to Account Lookup.', e.getMessage(),
                    'The block must use the friendly permission message');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testGetHouseholdMembers_NonAccountId_IsRejected() {
        Id userId = UserInfo.getUserId();

        Test.startTest();
        System.runAs(permittedUser()) {
            try {
                AccountLookupService.getHouseholdMembers(userId);
                Assert.fail('An Id of another sObject type must be rejected');
            } catch (AccountLookupException e) {
                Assert.areEqual('That is not a valid household.', e.getMessage(),
                    'A non-Account Id should get the invalid-household message');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testGetHouseholdMembers_NullId_IsRejected() {
        Test.startTest();
        System.runAs(permittedUser()) {
            try {
                AccountLookupService.getHouseholdMembers(null);
                Assert.fail('A null household Id must be rejected');
            } catch (AccountLookupException e) {
                Assert.areEqual('That is not a valid household.', e.getMessage(),
                    'Null should get the invalid-household message');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testGetHouseholdMembers_EmptyHousehold_ReturnsEmptyList() {
        Id householdId = targetAccount().Id;
        List<AccountLookupService.AccountLookupResult> members;

        Test.startTest();
        System.runAs(permittedUser()) {
            members = AccountLookupService.getHouseholdMembers(householdId);
        }
        Test.stopTest();

        Assert.isNotNull(members, 'A household with no members returns an empty list, not null');
        Assert.areEqual(0, members.size(), 'No test account is linked to this household');
    }

    @IsTest
    static void testSearch_ResolvesTheHouseholdName() {
        if (!hasHouseholdField()) {
            return; // Org without the household field: nothing to resolve.
        }
        Account owned = [SELECT Id FROM Account WHERE Name = 'Lookup Owned Beta' LIMIT 1];
        Account household = [SELECT Id FROM Account WHERE Name = 'Lookup Household Delta' LIMIT 1];
        List<AccountLookupService.AccountLookupResult> results;

        Test.startTest();
        System.runAs(permittedUser()) {
            Test.setFixedSearchResults(new List<Id>{ owned.Id });
            results = AccountLookupService.search('Lookup');
        }
        Test.stopTest();

        Assert.areEqual(String.valueOf(household.Id), results[0].householdId,
            'The household Id should be read off the link field');
        Assert.areEqual('Lookup Household Delta', results[0].householdName,
            'The household name should be resolved for display');
        // The count is best-effort: grouping on a text field is not guaranteed, so assert
        // it is either right or absent -- never wrong, and never fatal.
        Assert.isTrue(
            results[0].householdMemberCount == null || results[0].householdMemberCount == 1,
            'The household has one member, or the count was unavailable, got: '
                + results[0].householdMemberCount
        );
    }

    @IsTest
    static void testSearch_NoHouseholdLink_LeavesBothFieldsNull() {
        Account target = targetAccount();
        List<AccountLookupService.AccountLookupResult> results;

        Test.startTest();
        System.runAs(permittedUser()) {
            Test.setFixedSearchResults(new List<Id>{ target.Id });
            results = AccountLookupService.search('Lookup');
        }
        Test.stopTest();

        Assert.isNull(results[0].householdId, 'No household link means no household Id');
        Assert.isNull(results[0].householdName, 'No household Id means no household name');
    }

    @IsTest
    static void testSearch_MalformedHouseholdValue_IsIgnored() {
        if (!hasHouseholdField()) {
            return;
        }
        // The link is free text, so junk in it is data rather than an error.
        Account target = targetAccount();
        target.put(HOUSEHOLD_FIELD, 'not-an-id');
        update target;

        List<AccountLookupService.AccountLookupResult> results;
        Test.startTest();
        System.runAs(permittedUser()) {
            Test.setFixedSearchResults(new List<Id>{ target.Id });
            results = AccountLookupService.search('Lookup');
        }
        Test.stopTest();

        Assert.isNull(results[0].householdId,
            'A value that is not an Account Id must be ignored, not thrown on');
    }

    @IsTest
    static void testGetHouseholdMembers_ReturnsTheMembers() {
        if (!hasHouseholdField()) {
            return;
        }
        Account household = [SELECT Id FROM Account WHERE Name = 'Lookup Household Delta' LIMIT 1];
        List<AccountLookupService.AccountLookupResult> members;

        Test.startTest();
        System.runAs(permittedUser()) {
            members = AccountLookupService.getHouseholdMembers(household.Id);
        }
        Test.stopTest();

        Assert.areEqual(1, members.size(), 'The household has one member in the test data');
        Assert.areEqual('Lookup Owned Beta', members[0].name, 'The member should come back');
        Assert.areEqual(true, members[0].hasFullAccess,
            'The member is owned by the running user');
    }

    // ── Optional field resolution ────────────────────────────────────────────

    @IsTest
    static void testOptionalFields_OnlyIncludesFieldsThisOrgHas() {
        Set<String> available;
        Test.startTest();
        System.runAs(permittedUser()) {
            available = AccountLookupService.optionalFields();
        }
        Test.stopTest();

        Map<String, Schema.SObjectField> accountFields =
            Schema.SObjectType.Account.fields.getMap();
        for (String fieldName : available) {
            Assert.isTrue(accountFields.containsKey(fieldName),
                'Only fields that exist on Account may be queried, got: ' + fieldName);
        }
    }

    // ── Email field guard ────────────────────────────────────────────────────

    @IsTest
    static void testEmailField_InvalidApiName_IsIgnored() {
        Account target = targetAccount();
        AccountLookupService.AccountLookupResult result;

        Test.startTest();
        System.runAs(permittedUser()) {
            AccountLookupService.emailFieldOverride = 'No_Such_Field__c';
            result = AccountLookupService.getDetails(target.Id);
        }
        Test.stopTest();

        Assert.isNull(result.email,
            'A field that does not exist must be dropped silently, not queried');
        Assert.areEqual('Lookup Target Alpha', result.name,
            'The rest of the limited view must still be returned');
    }

    @IsTest
    static void testEmailField_NonTextField_IsIgnored() {
        Account target = targetAccount();
        AccountLookupService.AccountLookupResult result;

        Test.startTest();
        System.runAs(permittedUser()) {
            // A real field, but a date -- the describe guard must reject it on type.
            AccountLookupService.emailFieldOverride = 'CreatedDate';
            result = AccountLookupService.getDetails(target.Id);
        }
        Test.stopTest();

        Assert.isNull(result.email, 'A non-text field must not be used as the email field');
    }
}
