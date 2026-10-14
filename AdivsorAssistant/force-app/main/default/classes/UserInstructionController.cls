/**
 * Handles fetch and save of UserAIInstruction__c records for the current user.
 * Called imperatively from the advisorUserInstructions LWC.
 *
 * One record per user is enforced by the upsert logic in saveUserInstruction:
 * a query checks for an existing record before deciding to insert or update.
 * The class runs `with sharing` so users can only ever reach their own record.
 */
public with sharing class UserInstructionController {

    /**
     * Returns the current user's UserAIInstruction__c record, or null if none exists.
     * Marked cacheable so the LWC can use @wire for the initial fetch.
     */
    @AuraEnabled(cacheable=true)
    public static UserAIInstruction__c getUserInstruction() {
        List<UserAIInstruction__c> records = [
            SELECT Id, InstructionText__c, IsActive__c
            FROM   UserAIInstruction__c
            WHERE  User__c = :UserInfo.getUserId()
            LIMIT 1
        ];
        return records.isEmpty() ? null : records[0];
    }

    /**
     * Creates or updates the current user's UserAIInstruction__c record.
     *
     * @param instructionText  The instruction text to store.
     * @param isActive         Whether the instruction should be marked active.
     * @return The Id of the saved record.
     */
    @AuraEnabled
    public static String saveUserInstruction(String instructionText, Boolean isActive) {
        try {
            List<UserAIInstruction__c> existing = [
                SELECT Id
                FROM   UserAIInstruction__c
                WHERE  User__c = :UserInfo.getUserId()
                LIMIT 1
            ];

            UserAIInstruction__c record;
            if (!existing.isEmpty()) {
                record = existing[0];
            } else {
                record = new UserAIInstruction__c(User__c = UserInfo.getUserId());
            }

            record.InstructionText__c = instructionText != null ? instructionText : '';
            record.IsActive__c        = isActive != null ? isActive : true;

            upsert record;
            return record.Id;

        } catch (Exception e) {
            throw new AuraHandledException('Error saving user instruction: ' + e.getMessage());
        }
    }
}
