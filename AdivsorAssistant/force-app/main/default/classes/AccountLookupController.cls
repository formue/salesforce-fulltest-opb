/**
 * The entry point the accountLookup LWC calls. Thin on purpose: it holds no query logic,
 * no field list and no permission logic of its own, so everything security-relevant lives
 * in one reviewable place -- AccountLookupService.
 *
 * The class runs `with sharing`; the deliberate sharing bypass is confined to the service.
 *
 * Neither method is cacheable. The approved design logs every search and detail view, which
 * is DML and therefore not allowed in a cacheable method, so the LWC calls both imperatively
 * and will not need reworking when logging is added.
 */
public with sharing class AccountLookupController {

    /**
     * Searches accounts by name and returns the limited view of each match.
     *
     * @param searchTerm  What the user typed.
     * @param scope       Which accounts to search: all, mine, team or both. Anything
     *                    unrecognised is treated as all.
     * @return Up to the service's cap of limited-view results. Never null.
     */
    @AuraEnabled
    public static List<AccountLookupService.AccountLookupResult> searchAccounts(
        String searchTerm,
        String scope
    ) {
        try {
            return AccountLookupService.search(searchTerm, scope);
        } catch (AccountLookupException e) {
            throw friendly(e.getMessage());
        } catch (Exception e) {
            // Anything unexpected stays in the log; the user sees nothing internal.
            System.debug(LoggingLevel.ERROR, 'AccountLookupController.searchAccounts: ' + e);
            throw friendly('Something went wrong. Please try again.');
        }
    }

    /**
     * Returns the limited view of one account.
     *
     * @param accountId  The account to show. Validated as an Account Id by the service.
     * @return The limited view of that account.
     */
    @AuraEnabled
    public static AccountLookupService.AccountLookupResult getAccountDetails(Id accountId) {
        try {
            return AccountLookupService.getDetails(accountId);
        } catch (AccountLookupException e) {
            throw friendly(e.getMessage());
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'AccountLookupController.getAccountDetails: ' + e);
            throw friendly('Something went wrong. Please try again.');
        }
    }

    /**
     * Returns the limited view of every account linked to one household, so the UI can
     * pivot from a result into the rest of that household.
     *
     * @param householdId  The household account's Id.
     * @return The household's members, largest AUM first. Never null.
     */
    @AuraEnabled
    public static List<AccountLookupService.AccountLookupResult> getHouseholdMembers(Id householdId) {
        try {
            return AccountLookupService.getHouseholdMembers(householdId);
        } catch (AccountLookupException e) {
            throw friendly(e.getMessage());
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'AccountLookupController.getHouseholdMembers: ' + e);
            throw friendly('Something went wrong. Please try again.');
        }
    }

    /**
     * Builds an AuraHandledException whose message actually reaches the LWC.
     * The constructor argument alone is not what the client reads -- setMessage() is.
     */
    private static AuraHandledException friendly(String message) {
        AuraHandledException e = new AuraHandledException(message);
        e.setMessage(message);
        return e;
    }
}
