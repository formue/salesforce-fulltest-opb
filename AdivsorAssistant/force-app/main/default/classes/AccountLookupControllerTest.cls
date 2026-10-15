/**
 * Covers AccountLookupController.
 *
 * The controller adds exactly one behaviour worth testing: translating exceptions for the
 * LWC. An AccountLookupException must reach the user with its own wording, and anything
 * else must be replaced with a generic message so nothing internal leaks into the UI.
 */
@IsTest
private class AccountLookupControllerTest {

    private static final String PERMISSION_SET = 'Account_Lookup_User';

    @TestSetup
    static void makeData() {
        User permitted;
        System.runAs(new User(Id = UserInfo.getUserId())) {
            Profile p = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
            String unique = 'alctl' + System.now().getTime() + Math.abs(Crypto.getRandomInteger());
            permitted = new User(
                Alias             = 'alctl',
                Email             = unique + '@example.com',
                Username          = unique + '@example.com.accountlookup',
                LastName          = 'Lookup Controller Test',
                ProfileId         = p.Id,
                EmailEncodingKey  = 'UTF-8',
                LanguageLocaleKey = 'en_US',
                LocaleSidKey      = 'en_US',
                TimeZoneSidKey    = 'Europe/Oslo'
            );
            insert permitted;

            // A second user, deliberately left without the permission set, so the blocked
            // paths are asserted against a known-unpermitted user rather than whoever
            // happens to be running the tests.
            User unpermitted = permitted.clone(false, true, false, false);
            unpermitted.Alias = 'alunp';
            unpermitted.Username = 'un' + unique + '@example.com.accountlookup';
            unpermitted.Email = 'un' + unique + '@example.com';
            insert unpermitted;

            PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = :PERMISSION_SET LIMIT 1];
            insert new PermissionSetAssignment(
                AssigneeId      = permitted.Id,
                PermissionSetId = ps.Id
            );
        }

        insert new Account(Name = 'Controller Target Gamma', Type = 'Prospect', BillingCity = 'Bergen');
    }

    private static User unpermittedUser() {
        return [SELECT Id FROM User WHERE Alias = 'alunp' AND IsActive = true LIMIT 1];
    }

    private static User permittedUser() {
        return [SELECT Id FROM User WHERE Alias = 'alctl' AND IsActive = true LIMIT 1];
    }

    @IsTest
    static void testSearchAccounts_ReturnsLimitedView() {
        Account target = [SELECT Id FROM Account WHERE Name = 'Controller Target Gamma' LIMIT 1];
        List<AccountLookupService.AccountLookupResult> results;

        Test.startTest();
        System.runAs(permittedUser()) {
            Test.setFixedSearchResults(new List<Id>{ target.Id });
            results = AccountLookupController.searchAccounts('Controller', AccountLookupService.SCOPE_ALL);
        }
        Test.stopTest();

        Assert.areEqual(1, results.size(), 'The controller should pass the service result through');
        Assert.areEqual('Controller Target Gamma', results[0].name, 'Name should survive the hop');
    }

    @IsTest
    static void testSearchAccounts_WithoutPermission_ShowsFriendlyMessage() {
        Test.startTest();
        System.runAs(unpermittedUser()) {
            try {
                AccountLookupController.searchAccounts('Controller', AccountLookupService.SCOPE_ALL);
                Assert.fail('The controller must not return data without the custom permission');
            } catch (AuraHandledException e) {
                Assert.areEqual('You do not have access to Account Lookup.', e.getMessage(),
                    'The service message must reach the LWC rather than a generic one');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testSearchAccounts_ShortTerm_ShowsFriendlyMessage() {
        Test.startTest();
        System.runAs(permittedUser()) {
            try {
                AccountLookupController.searchAccounts('ab', AccountLookupService.SCOPE_ALL);
                Assert.fail('A short term must be rejected');
            } catch (AuraHandledException e) {
                Assert.areEqual('Enter at least 3 characters to search.', e.getMessage(),
                    'The minimum-length wording must reach the user');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testSearchAccounts_UnexpectedFailure_ShowsGenericMessage() {
        Test.startTest();
        System.runAs(permittedUser()) {
            // A valid text field, but one already in the whitelist: the query then selects
            // Name twice and the platform rejects it. Any failure that is not an
            // AccountLookupException must reach the user as the generic message, with
            // nothing internal in it.
            AccountLookupService.emailFieldOverride = 'Name';
            try {
                AccountLookupController.searchAccounts('Controller', AccountLookupService.SCOPE_ALL);
                Assert.fail('A malformed query must not return results');
            } catch (AuraHandledException e) {
                Assert.areEqual('Something went wrong. Please try again.', e.getMessage(),
                    'An unexpected failure must not leak query or class details');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testGetAccountDetails_UnexpectedFailure_ShowsGenericMessage() {
        Account target = [SELECT Id FROM Account WHERE Name = 'Controller Target Gamma' LIMIT 1];

        Test.startTest();
        System.runAs(permittedUser()) {
            AccountLookupService.emailFieldOverride = 'Name';
            try {
                AccountLookupController.getAccountDetails(target.Id);
                Assert.fail('A malformed query must not return details');
            } catch (AuraHandledException e) {
                Assert.areEqual('Something went wrong. Please try again.', e.getMessage(),
                    'An unexpected failure must not leak query or class details');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testSearchAccounts_PassesTheScopeThrough() {
        List<AccountLookupService.AccountLookupResult> results;

        Test.startTest();
        System.runAs(permittedUser()) {
            // Nothing is owned by this user, so a scoped search must come back empty
            // rather than falling through to every account.
            results = AccountLookupController.searchAccounts(
                'Controller', AccountLookupService.SCOPE_MINE
            );
        }
        Test.stopTest();

        Assert.areEqual(0, results.size(),
            'My customers must not return an account owned by someone else');
    }

    @IsTest
    static void testGetAccountDetails_ReturnsLimitedView() {
        Account target = [SELECT Id FROM Account WHERE Name = 'Controller Target Gamma' LIMIT 1];
        AccountLookupService.AccountLookupResult result;

        Test.startTest();
        System.runAs(permittedUser()) {
            result = AccountLookupController.getAccountDetails(target.Id);
        }
        Test.stopTest();

        Assert.areEqual('Controller Target Gamma', result.name, 'The limited view should come back');
        Assert.areEqual('Bergen', result.billingCity, 'Billing city should come back');
    }

    @IsTest
    static void testGetHouseholdMembers_ReturnsListForTheHousehold() {
        Account target = [SELECT Id FROM Account WHERE Name = 'Controller Target Gamma' LIMIT 1];
        List<AccountLookupService.AccountLookupResult> members;

        Test.startTest();
        System.runAs(permittedUser()) {
            members = AccountLookupController.getHouseholdMembers(target.Id);
        }
        Test.stopTest();

        Assert.isNotNull(members, 'The controller must return a list, never null');
    }

    @IsTest
    static void testGetHouseholdMembers_WithoutPermission_ShowsFriendlyMessage() {
        Account target = [SELECT Id FROM Account WHERE Name = 'Controller Target Gamma' LIMIT 1];

        Test.startTest();
        System.runAs(unpermittedUser()) {
            try {
                AccountLookupController.getHouseholdMembers(target.Id);
                Assert.fail('Household members must not be returned without the permission');
            } catch (AuraHandledException e) {
                Assert.areEqual('You do not have access to Account Lookup.', e.getMessage(),
                    'The permission message must reach the user');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testGetHouseholdMembers_NonAccountId_ShowsFriendlyMessage() {
        Id userId = UserInfo.getUserId();

        Test.startTest();
        System.runAs(permittedUser()) {
            try {
                AccountLookupController.getHouseholdMembers(userId);
                Assert.fail('An Id of the wrong type must be rejected');
            } catch (AuraHandledException e) {
                Assert.areEqual('That is not a valid household.', e.getMessage(),
                    'The invalid-household wording must reach the user');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testGetHouseholdMembers_UnexpectedFailure_ShowsGenericMessage() {
        Account target = [SELECT Id FROM Account WHERE Name = 'Controller Target Gamma' LIMIT 1];

        Test.startTest();
        System.runAs(permittedUser()) {
            AccountLookupService.emailFieldOverride = 'Name';
            try {
                AccountLookupController.getHouseholdMembers(target.Id);
                Assert.fail('A malformed query must not return results');
            } catch (AuraHandledException e) {
                Assert.areEqual('Something went wrong. Please try again.', e.getMessage(),
                    'An unexpected failure must not leak query or class details');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testGetAccountDetails_NonAccountId_ShowsFriendlyMessage() {
        Id userId = UserInfo.getUserId();

        Test.startTest();
        System.runAs(permittedUser()) {
            try {
                AccountLookupController.getAccountDetails(userId);
                Assert.fail('An Id of the wrong type must be rejected');
            } catch (AuraHandledException e) {
                Assert.areEqual('That is not a valid account.', e.getMessage(),
                    'The invalid-account wording must reach the user');
            }
        }
        Test.stopTest();
    }

    @IsTest
    static void testGetAccountDetails_WithoutPermission_ShowsFriendlyMessage() {
        Account target = [SELECT Id FROM Account WHERE Name = 'Controller Target Gamma' LIMIT 1];

        Test.startTest();
        System.runAs(unpermittedUser()) {
            try {
                AccountLookupController.getAccountDetails(target.Id);
                Assert.fail('Details must not be returned without the custom permission');
            } catch (AuraHandledException e) {
                Assert.areEqual('You do not have access to Account Lookup.', e.getMessage(),
                    'The permission message must reach the user');
            }
        }
        Test.stopTest();
    }
}
