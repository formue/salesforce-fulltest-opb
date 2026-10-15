/**
 * Limited-view account search for an org where Account OWD is Private.
 *
 * WHY THIS CLASS IS `without sharing`
 * -----------------------------------
 * Users only have real access to accounts they own or are on the account team for, so
 * standard search, list views and Ask/AI cannot answer "does this account already exist?".
 * The business requires every permitted user to be able to find any account and see a
 * small, fixed set of fields -- and nothing else. Salesforce has no declarative way to
 * expose a few fields of a record a user cannot access, so this class deliberately runs
 * outside the sharing model and outside field-level security.
 *
 * WHAT KEEPS THAT SAFE
 * --------------------
 *   1. Every public entry point calls assertPermission() first. Without the
 *      Can_Search_All_Accounts custom permission nothing is returned, no matter how the
 *      method is reached -- UI, anonymous Apex or an agent action.
 *   2. Only AccountLookupResult is ever returned. No Account sObject and no untyped map
 *      built from one ever leaves this class.
 *   3. The field list is the hardcoded WHITELIST constant below. Adding a field is a code
 *      change and needs review; nothing about the response is driven by user input.
 *   4. The search term is length-limited and escaped before it reaches SOSL.
 *   5. Results are hard-capped at MAX_RESULTS.
 *
 * WHY EVERY QUERY PASSES AccessLevel.SYSTEM_MODE
 * ----------------------------------------------
 * This org runs Apex database operations in user mode by default, so `without sharing`
 * on its own is not enough: an inline SOQL here returns nothing for the very users this
 * tool exists for, while still looking correct to an admin. Both queries and the SOSL
 * therefore state AccessLevel.SYSTEM_MODE explicitly. That also makes the bypass visible
 * at the call site rather than implied by the class declaration -- if you remove it, the
 * feature silently stops working for non-admins instead of failing loudly.
 *
 * This class must contain nothing unrelated to account lookup. Changes to the whitelist,
 * the permission check, the cap or the sanitizer require review by a Salesforce architect
 * or security reviewer before release.
 *
 * HOW AUM IS EXPOSED
 * ------------------
 * AUM is the most sensitive thing on the limited view. The rule is:
 *   - a record the running user can already read  -> exact figure;
 *   - anything else                               -> a size band only.
 * The banding happens here, and the exact figure is never placed on the DTO for a
 * limited-view row. Banding in the client instead would leave the real number in the
 * network payload and defeat the control entirely. Preserve this in toResult().
 *
 * MOCK-UP SCOPE -- NOT PRODUCTION READY
 * -------------------------------------
 * Two controls from the approved design are deliberately not built yet and are blockers
 * for production use:
 *   - audit logging of every search, detail view and block to Account_Lookup_Log__c;
 *   - the per-user hourly rate limit, which counts those log rows.
 * Without them there is no trail of who looked up whom, and nothing stops a permitted user
 * enumerating the Account table MAX_RESULTS rows at a time. Settings are hardcoded
 * constants here; the approved design moves them to Account_Lookup_Setting__mdt.
 *
 * @see AccountLookupController  the with-sharing entry point used by the LWC
 */

public without sharing class AccountLookupService {

    /**
     * Fields a permitted user may see for an account they cannot otherwise access.
     * Present on every Salesforce org, so always queried.
     */
    private static final List<String> WHITELIST = new List<String>{
        'Id',
        'Name',
        'Type',
        'Phone',
        'Website',
        'Industry',
        'BillingCity',
        'BillingCountry',
        'LastActivityDate',
        'RecordType.Name',
        'Owner.Name'
    };

    // Org-specific fields. Each is still a hardcoded constant -- nothing here is reachable
    // from user input -- but each is queried only when describe confirms it exists on
    // Account and holds the expected type, so an org without Financial Services Cloud (or
    // without person accounts) degrades to "no value" instead of a runtime error.
    private static final String EMAIL_FIELD     = 'PersonEmail';
    private static final String SEGMENT_FIELD   = 'Segment__c';
    private static final String STATUS_FIELD    = 'FinServ__Status__c';
    private static final String AUM_FIELD       = 'FinServ__AUM__c';
    private static final String HOUSEHOLD_FIELD = 'RelatedHouseholdAccount__c';

    /**
     * Search scopes. ALL is the sharing bypass this class exists for; the other three
     * return only records the running user can already reach, limited by an explicit
     * owner/account-team predicate rather than by sharing.
     */
    public static final String SCOPE_ALL = 'all';
    public static final String SCOPE_MINE = 'mine';
    public static final String SCOPE_TEAM = 'team';
    public static final String SCOPE_BOTH = 'both';

    private static final String CUSTOM_PERMISSION = 'Can_Search_All_Accounts';
    private static final Integer MIN_SEARCH_LENGTH = 3;
    private static final Integer MAX_SEARCH_LENGTH = 100;
    private static final Integer MAX_RESULTS = 25;

    /** Lets tests drive the describe guard with a field that does not exist. */
    @TestVisible
    private static String emailFieldOverride;

    /** Memoised result of optionalFields() for the life of the transaction. */
    private static Set<String> resolvedOptionalFields;

    /**
     * The limited view of an account. This is the only shape this class returns.
     * Adding a property here without adding the matching field to the whitelist does
     * nothing; adding one to the whitelist without review is what the class comment forbids.
     */
    public class AccountLookupResult {
        @AuraEnabled public Id accountId;
        @AuraEnabled public String name;
        @AuraEnabled public String type;
        @AuraEnabled public String phone;
        @AuraEnabled public String website;
        @AuraEnabled public String industry;
        @AuraEnabled public String billingCity;
        @AuraEnabled public String billingCountry;
        /** Record type name -- Person Account, Business, Household and so on. */
        @AuraEnabled public String recordType;
        @AuraEnabled public String email;
        @AuraEnabled public String segment;
        /** Client status, Active or Inactive. */
        @AuraEnabled public String status;
        /** Size band -- always safe to show. See "HOW AUM IS EXPOSED" above. */
        @AuraEnabled public String aumBand;
        /** Exact AUM. Null unless hasFullAccess is true. Never relax this. */
        @AuraEnabled public Decimal aum;
        @AuraEnabled public String householdId;
        @AuraEnabled public String householdName;
        /** How many accounts share this household. Null when it could not be counted. */
        @AuraEnabled public Integer householdMemberCount;
        /** Last logged activity. A date only -- never what the activity was. */
        @AuraEnabled public Date lastActivityDate;
        @AuraEnabled public String ownerName;
        /** True when the running user can read the real record and may be linked to it. */
        @AuraEnabled public Boolean hasFullAccess;
    }

    /**
     * Searches every account, which is the sharing bypass this class exists for.
     *
     * @param searchTerm  What the user typed.
     * @return Up to MAX_RESULTS results, ordered by name. Never null.
     */
    public static List<AccountLookupResult> search(String searchTerm) {
        return search(searchTerm, SCOPE_ALL);
    }

    /**
     * Searches Account by name within one scope and returns the limited view of every match.
     *
     * SCOPE_ALL searches everything and is the only path that relies on the sharing bypass.
     * The other scopes add an explicit owner or account-team predicate, so they can only
     * ever return records the running user already has access to -- which also means every
     * row comes back with hasFullAccess true and an exact AUM figure.
     *
     * @param searchTerm  What the user typed. Trimmed, length-checked and sanitized before use.
     * @param scope       One of SCOPE_ALL, SCOPE_MINE, SCOPE_TEAM, SCOPE_BOTH. Anything
     *                    unrecognised falls back to SCOPE_ALL, which the permission already allows.
     * @return Up to MAX_RESULTS results, ordered by name. Never null.
     * @throws AccountLookupException if the user lacks the custom permission or the term is too short.
     */
    public static List<AccountLookupResult> search(String searchTerm, String scope) {
        assertPermission();

        String term = searchTerm == null ? '' : searchTerm.trim();
        if (term.length() < MIN_SEARCH_LENGTH) {
            throw new AccountLookupException(
                'Enter at least ' + MIN_SEARCH_LENGTH + ' characters to search.'
            );
        }
        if (term.length() > MAX_SEARCH_LENGTH) {
            term = term.substring(0, MAX_SEARCH_LENGTH);
        }

        String safeScope = normalizeScope(scope);
        if (safeScope != SCOPE_ALL) {
            return searchWithinScope(term, safeScope);
        }

        String safeTerm = sanitizeSosl(term);
        if (String.isBlank(safeTerm)) {
            // Nothing searchable survived sanitizing, so there is nothing to match on.
            // Returning early beats sending a query that would match everything.
            return new List<AccountLookupResult>();
        }

        List<List<SObject>> found = Search.query(
            buildSoslQuery(safeTerm), AccessLevel.SYSTEM_MODE
        );
        return buildResults(found.isEmpty() ? new List<SObject>() : found[0]);
    }

    /**
     * Returns the limited view of a single account.
     *
     * @param accountId  Must be the Id of an Account. Any other sObject type is rejected.
     * @return The limited view of that account.
     * @throws AccountLookupException if the user lacks the permission, the Id is not an
     *         Account Id, or no such account exists.
     */
    public static AccountLookupResult getDetails(Id accountId) {
        assertPermission();

        if (accountId == null || accountId.getSObjectType() != Account.SObjectType) {
            throw new AccountLookupException('That is not a valid account.');
        }

        String soql =
            'SELECT ' + String.join(buildFieldList(), ', ') +
            ' FROM Account WHERE Id = :accountId LIMIT 1';
        List<SObject> rows = Database.query(soql, AccessLevel.SYSTEM_MODE);
        if (rows.isEmpty()) {
            throw new AccountLookupException('Account not found.');
        }

        return buildResults(rows)[0];
    }

    /**
     * Returns the limited view of every account linked to one household.
     *
     * The household link is a text field holding an Account Id, so this matches on both
     * the 15- and 18-character forms of the Id.
     *
     * @param householdId  The household account's Id.
     * @return Up to MAX_RESULTS members, largest AUM first. Empty when the org has no
     *         household field or the household has no members. Never null.
     * @throws AccountLookupException if the user lacks the permission or the Id is not an
     *         Account Id.
     */
    public static List<AccountLookupResult> getHouseholdMembers(Id householdId) {
        assertPermission();

        if (householdId == null || householdId.getSObjectType() != Account.SObjectType) {
            throw new AccountLookupException('That is not a valid household.');
        }
        if (!optionalFields().contains(HOUSEHOLD_FIELD)) {
            return new List<AccountLookupResult>();
        }

        // Both Id forms, because the link is stored as free text rather than a lookup.
        Set<String> keys = new Set<String>{
            String.valueOf(householdId),
            String.valueOf(householdId).left(15)
        };
        String ordering = optionalFields().contains(AUM_FIELD)
            ? AUM_FIELD + ' DESC NULLS LAST, Name'
            : 'Name';
        String soql =
            'SELECT ' + String.join(buildFieldList(), ', ') +
            ' FROM Account WHERE ' + HOUSEHOLD_FIELD + ' IN :keys' +
            ' ORDER BY ' + ordering +
            ' LIMIT ' + MAX_RESULTS;

        return buildResults(Database.query(soql, AccessLevel.SYSTEM_MODE));
    }

    // -- Private ---------------------------------------------------------------

    /** Unrecognised scopes fall back to ALL, which the custom permission already allows. */
    private static String normalizeScope(String scope) {
        String candidate = scope == null ? '' : scope.trim().toLowerCase();
        if (candidate == SCOPE_MINE || candidate == SCOPE_TEAM || candidate == SCOPE_BOTH) {
            return candidate;
        }
        return SCOPE_ALL;
    }

    /**
     * Searches within the running user's own accounts, their account-team accounts, or both.
     *
     * SOQL rather than SOSL because SOSL cannot express the account-team semi-join. The
     * owner/team predicate is what limits these results -- not sharing -- so the query is
     * safe to run in system mode alongside the rest of this class.
     *
     * @param term   Already trimmed and length-checked.
     * @param scope  SCOPE_MINE, SCOPE_TEAM or SCOPE_BOTH.
     */
    private static List<AccountLookupResult> searchWithinScope(String term, String scope) {
        String pattern = '%' + sanitizeLike(term) + '%';
        Id runningUserId = UserInfo.getUserId();

        Set<Id> teamAccountIds = new Set<Id>();
        String predicate;
        if (scope == SCOPE_MINE) {
            predicate = 'OwnerId = :runningUserId';
        } else if (scope == SCOPE_TEAM) {
            // A semi-join is only legal as a top-level WHERE expression, which this is.
            predicate = 'Id IN (SELECT AccountId FROM AccountTeamMember WHERE UserId = :runningUserId)';
        } else {
            // "Mine & team" needs OR, and the platform rejects a semi-join nested inside
            // one, so the team's account Ids are collected first and bound as a set.
            teamAccountIds = teamAccountIdsFor(runningUserId);
            predicate = teamAccountIds.isEmpty()
                ? 'OwnerId = :runningUserId'
                : '(OwnerId = :runningUserId OR Id IN :teamAccountIds)';
        }

        String soql =
            'SELECT ' + String.join(buildFieldList(), ', ') +
            ' FROM Account WHERE Name LIKE :pattern AND ' + predicate +
            ' ORDER BY Name LIMIT ' + MAX_RESULTS;

        return buildResults(Database.query(soql, AccessLevel.SYSTEM_MODE));
    }

    /**
     * The accounts the user sits on the team for. Only needed for the combined scope,
     * where a semi-join cannot be used. Bounded by the usual query row limit; a user on
     * more teams than that would see a truncated "Mine & team", which is why the two
     * narrower scopes exist alongside it.
     */
    private static Set<Id> teamAccountIdsFor(Id userId) {
        Set<Id> accountIds = new Set<Id>();
        for (AccountTeamMember member : [
            SELECT AccountId FROM AccountTeamMember WHERE UserId = :userId
        ]) {
            accountIds.add(member.AccountId);
        }
        return accountIds;
    }

    /**
     * Escapes the characters LIKE treats as wildcards, so a term containing % or _ matches
     * them literally. The term itself is bound, never concatenated, so this is about
     * matching correctly rather than about injection.
     */
    @TestVisible
    private static String sanitizeLike(String term) {
        return term
            .replace('\\', '\\\\')
            .replace('%', '\\%')
            .replace('_', '\\_');
    }

    /**
     * The single gate on this class. Checked in Apex on every entry point rather than in
     * the UI, so hiding the component is never what keeps data in.
     */
    private static void assertPermission() {
        if (!FeatureManagement.checkPermission(CUSTOM_PERMISSION)) {
            throw new AccountLookupException('You do not have access to Account Lookup.');
        }
    }

    /** The optional fields this org actually has, keyed to the types each may hold. */
    private static Map<String, Set<Schema.DisplayType>> expectedOptionalTypes() {
        String emailField = emailFieldOverride != null ? emailFieldOverride : EMAIL_FIELD;
        Map<String, Set<Schema.DisplayType>> expected =
            new Map<String, Set<Schema.DisplayType>>();
        if (String.isNotBlank(emailField)) {
            expected.put(emailField, new Set<Schema.DisplayType>{
                Schema.DisplayType.EMAIL, Schema.DisplayType.STRING
            });
        }
        expected.put(SEGMENT_FIELD, new Set<Schema.DisplayType>{
            Schema.DisplayType.PICKLIST, Schema.DisplayType.STRING
        });
        expected.put(STATUS_FIELD, new Set<Schema.DisplayType>{
            Schema.DisplayType.PICKLIST, Schema.DisplayType.STRING
        });
        expected.put(AUM_FIELD, new Set<Schema.DisplayType>{
            Schema.DisplayType.CURRENCY, Schema.DisplayType.DOUBLE
        });
        expected.put(HOUSEHOLD_FIELD, new Set<Schema.DisplayType>{
            Schema.DisplayType.STRING, Schema.DisplayType.REFERENCE
        });
        return expected;
    }

    /**
     * Names of the optional fields present on Account in this org, with the expected type.
     * Memoised per transaction -- describe calls are not free.
     */
    @TestVisible
    private static Set<String> optionalFields() {
        if (resolvedOptionalFields != null) {
            return resolvedOptionalFields;
        }
        resolvedOptionalFields = new Set<String>();

        Map<String, Schema.SObjectField> accountFields = Schema.SObjectType.Account.fields.getMap();
        for (String fieldName : expectedOptionalTypes().keySet()) {
            Schema.SObjectField field = accountFields.get(fieldName);
            if (field == null) {
                continue;
            }
            if (expectedOptionalTypes().get(fieldName).contains(field.getDescribe().getType())) {
                resolvedOptionalFields.add(fieldName);
            }
        }
        return resolvedOptionalFields;
    }

    /** The email field for this org, or null when it has none we can use. */
    private static String emailField() {
        String fieldName = emailFieldOverride != null ? emailFieldOverride : EMAIL_FIELD;
        return optionalFields().contains(fieldName) ? fieldName : null;
    }

    /** WHITELIST plus whichever optional fields this org has. The only source of query fields. */
    private static List<String> buildFieldList() {
        List<String> fields = new List<String>(WHITELIST);
        fields.addAll(new List<String>(optionalFields()));
        return fields;
    }

    /** Reads an optional field off a row, or null when the org does not have it. */
    private static Object readOptional(SObject row, String fieldName) {
        return optionalFields().contains(fieldName) ? row.get(fieldName) : null;
    }

    /**
     * Builds the SOSL. The only dynamic parts are the sanitized term and the
     * returning-field list, which is WHITELIST plus the validated optional fields.
     *
     * @param safeTerm  Must already have been through sanitizeSosl().
     */
    @TestVisible
    private static String buildSoslQuery(String safeTerm) {
        return 'FIND \'' + safeTerm + '*\' IN NAME FIELDS RETURNING Account(' +
            String.join(buildFieldList(), ', ') +
            ' ORDER BY Name LIMIT ' + MAX_RESULTS + ')';
    }

    /**
     * Makes a user's search term safe to place in a SOSL FIND clause.
     *
     * Every character SOSL treats as an operator -- ? & | ! { } [ ] ( ) ^ ~ * : " ' + - \
     * -- is replaced with a space rather than escaped. Escaping is not an option here: a
     * SOSL string literal rejects the \* sequence outright, and Search.queryWithBinds is
     * not available in this API version, so the term has to be literal text that cannot
     * close the quote or add an operator.
     *
     * Matching barely suffers, because SOSL tokenises on punctuation anyway: "Acme-Corp"
     * becomes "Acme Corp" and still finds Acme-Corp. A term made up entirely of operators
     * collapses to an empty string, which the caller treats as "no match" rather than
     * sending a query that would match everything.
     */
    @TestVisible
    private static String sanitizeSosl(String term) {
        String cleaned = term.replaceAll('[\\\\?&|!{}\\[\\]()\\^~*:"\'+\\-]', ' ');
        return cleaned.replaceAll('\\s+', ' ').trim();
    }

    /**
     * Turns queried rows into DTOs: one access query and one household-name query for the
     * whole page, never one per row.
     */
    private static List<AccountLookupResult> buildResults(List<SObject> rows) {
        Set<Id> ids = new Set<Id>();
        for (SObject row : rows) {
            ids.add((Id) row.get('Id'));
        }
        Map<Id, Boolean> accessById = loadAccessMap(ids);

        List<AccountLookupResult> results = new List<AccountLookupResult>();
        for (SObject row : rows) {
            results.add(toResult(row, accessById));
        }
        attachHouseholdInfo(results);
        return results;
    }

    /**
     * One query for the whole result set -- never one per row.
     *
     * @return HasReadAccess by record Id. Ids missing from UserRecordAccess count as no access.
     */
    private static Map<Id, Boolean> loadAccessMap(Set<Id> recordIds) {
        Map<Id, Boolean> accessById = new Map<Id, Boolean>();
        if (recordIds.isEmpty()) {
            return accessById;
        }
        Id runningUserId = UserInfo.getUserId();
        List<UserRecordAccess> rows = Database.query(
            'SELECT RecordId, HasReadAccess FROM UserRecordAccess' +
            ' WHERE UserId = :runningUserId AND RecordId IN :recordIds',
            AccessLevel.SYSTEM_MODE
        );
        for (UserRecordAccess access : rows) {
            accessById.put(access.RecordId, access.HasReadAccess);
        }
        return accessById;
    }

    /** Resolves household names and member counts. Only the name and a count are read. */
    private static void attachHouseholdInfo(List<AccountLookupResult> results) {
        Set<Id> householdIds = new Set<Id>();
        for (AccountLookupResult result : results) {
            if (result.householdId != null) {
                householdIds.add((Id) result.householdId);
            }
        }
        if (householdIds.isEmpty()) {
            return;
        }

        Map<Id, String> nameById = new Map<Id, String>();
        List<Account> households = Database.query(
            'SELECT Id, Name FROM Account WHERE Id IN :householdIds',
            AccessLevel.SYSTEM_MODE
        );
        for (Account household : households) {
            nameById.put(household.Id, household.Name);
        }
        Map<String, Integer> countByKey = countHouseholdMembers(householdIds);
        for (AccountLookupResult result : results) {
            if (result.householdId != null) {
                result.householdName = nameById.get((Id) result.householdId);
                result.householdMemberCount = countByKey.get(result.householdId);
            }
        }
    }

    /**
     * Counts how many accounts sit in each household, in one grouped query for the page.
     *
     * The link is a text field rather than a lookup, so this groups on text and matches
     * both the 15- and 18-character Id forms. If the platform refuses to group on that
     * field the counts are simply dropped -- a missing count must never fail a search.
     *
     * @return Member count keyed by 18-character household Id. Empty when unavailable.
     */
    private static Map<String, Integer> countHouseholdMembers(Set<Id> householdIds) {
        Map<String, Integer> countByKey = new Map<String, Integer>();
        if (householdIds.isEmpty() || !optionalFields().contains(HOUSEHOLD_FIELD)) {
            return countByKey;
        }

        Set<String> keys = new Set<String>();
        Map<String, String> canonicalByKey = new Map<String, String>();
        for (Id householdId : householdIds) {
            String full = String.valueOf(householdId);
            keys.add(full);
            keys.add(full.left(15));
            canonicalByKey.put(full, full);
            canonicalByKey.put(full.left(15), full);
        }

        try {
            List<AggregateResult> grouped = Database.query(
                'SELECT ' + HOUSEHOLD_FIELD + ' link, COUNT(Id) total FROM Account' +
                ' WHERE ' + HOUSEHOLD_FIELD + ' IN :keys GROUP BY ' + HOUSEHOLD_FIELD,
                AccessLevel.SYSTEM_MODE
            );
            for (AggregateResult row : grouped) {
                String canonical = canonicalByKey.get((String) row.get('link'));
                if (canonical == null) {
                    continue;
                }
                Integer running = countByKey.containsKey(canonical) ? countByKey.get(canonical) : 0;
                countByKey.put(canonical, running + (Integer) row.get('total'));
            }
        } catch (Exception e) {
            // Grouping on a text field is not guaranteed. Degrade to no counts.
            System.debug(LoggingLevel.WARN, 'Household member counts unavailable: ' + e.getMessage());
            return new Map<String, Integer>();
        }
        return countByKey;
    }

    /**
     * The household link is a free-text field, so a value that is not an Account Id is
     * data rather than an error: it is ignored and the row simply has no household.
     */
    private static Id toAccountId(String value) {
        if (String.isBlank(value)) {
            return null;
        }
        try {
            Id parsed = Id.valueOf(value.trim());
            return parsed.getSObjectType() == Account.SObjectType ? parsed : null;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Size band for an AUM figure. Safe to show for any account, because it says roughly
     * how large a client is without publishing what they are worth.
     */
    @TestVisible
    private static String aumBand(Decimal aum) {
        if (aum == null || aum <= 0) {
            return null;
        }
        if (aum < 1000000)   return '< 1M';
        if (aum < 10000000)  return '1-10M';
        if (aum < 100000000) return '10-100M';
        return '100M+';
    }

    /** Copies only whitelisted fields off the row. The sObject itself never leaves this class. */
    private static AccountLookupResult toResult(SObject row, Map<Id, Boolean> accessById) {
        AccountLookupResult result = new AccountLookupResult();
        result.accountId      = (Id) row.get('Id');
        result.name           = (String) row.get('Name');
        result.type           = (String) row.get('Type');
        result.phone          = (String) row.get('Phone');
        result.website        = (String) row.get('Website');
        result.industry       = (String) row.get('Industry');
        result.billingCity    = (String) row.get('BillingCity');
        result.billingCountry = (String) row.get('BillingCountry');

        String emailFieldName = emailField();
        if (emailFieldName != null) {
            result.email = (String) row.get(emailFieldName);
        }

        result.segment     = (String) readOptional(row, SEGMENT_FIELD);
        result.status      = (String) readOptional(row, STATUS_FIELD);
        result.householdId = toAccountId((String) readOptional(row, HOUSEHOLD_FIELD));

        result.lastActivityDate = (Date) row.get('LastActivityDate');

        SObject recordTypeRow = row.getSObject('RecordType');
        result.recordType = recordTypeRow == null ? null : (String) recordTypeRow.get('Name');

        SObject owner = row.getSObject('Owner');
        result.ownerName = owner == null ? null : (String) owner.get('Name');

        Boolean hasAccess = accessById.get(result.accountId);
        result.hasFullAccess = hasAccess == true;

        // The exact figure only ever leaves the server for a record the user can already
        // read. Everyone else gets the band. See "HOW AUM IS EXPOSED" in the class header.
        //
        // Zero is not a figure: this org stores 0 rather than null on the ~90% of accounts
        // with no assets recorded, and returning it made every such row display a bare "0".
        Decimal aumValue = (Decimal) readOptional(row, AUM_FIELD);
        Boolean hasAum = aumValue != null && aumValue > 0;
        result.aumBand = aumBand(aumValue);
        result.aum = (result.hasFullAccess && hasAum) ? aumValue : null;

        return result;
    }
}
