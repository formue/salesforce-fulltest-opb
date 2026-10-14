/**
 * Covers UserInstructionController.
 *
 * The behaviour worth protecting is the one-record-per-user rule: saveUserInstruction
 * upserts against a query on the running user, so calling it twice must update the
 * existing record rather than create a second one.
 */
@IsTest
private class UserInstructionControllerTest {

    @IsTest
    static void testGetUserInstruction_NoRecord_ReturnsNull() {
        Test.startTest();
        UserAIInstruction__c result = UserInstructionController.getUserInstruction();
        Test.stopTest();
        Assert.isNull(result, 'Expected null when the user has no instruction record');
    }

    @IsTest
    static void testSaveUserInstruction_CreatesThenReturnsRecord() {
        Test.startTest();
        String recordId = UserInstructionController.saveUserInstruction('Always answer in Norwegian.', true);
        Test.stopTest();

        Assert.isNotNull(recordId, 'Save should return the record Id');

        UserAIInstruction__c stored = UserInstructionController.getUserInstruction();
        Assert.isNotNull(stored, 'The saved record should be retrievable');
        Assert.areEqual('Always answer in Norwegian.', stored.InstructionText__c, 'Text should round-trip');
        Assert.areEqual(true, stored.IsActive__c, 'IsActive should round-trip');
        Assert.areEqual(UserInfo.getUserId(), [
            SELECT User__c FROM UserAIInstruction__c WHERE Id = :recordId
        ].User__c, 'Record must belong to the running user');
    }

    @IsTest
    static void testSaveUserInstruction_SecondSaveUpdatesRatherThanDuplicates() {
        String firstId = UserInstructionController.saveUserInstruction('First version.', true);

        Test.startTest();
        String secondId = UserInstructionController.saveUserInstruction('Second version.', false);
        Test.stopTest();

        Assert.areEqual(firstId, secondId, 'Second save must reuse the same record');
        Assert.areEqual(1, [
            SELECT COUNT() FROM UserAIInstruction__c WHERE User__c = :UserInfo.getUserId()
        ], 'There must never be more than one record per user');

        UserAIInstruction__c stored = UserInstructionController.getUserInstruction();
        Assert.areEqual('Second version.', stored.InstructionText__c, 'Text should be updated');
        Assert.areEqual(false, stored.IsActive__c, 'IsActive should be updated');
    }

    @IsTest
    static void testSaveUserInstruction_NullsAreDefaulted() {
        Test.startTest();
        UserInstructionController.saveUserInstruction(null, null);
        Test.stopTest();

        UserAIInstruction__c stored = UserInstructionController.getUserInstruction();
        // The controller coalesces null to '', but Salesforce stores an empty text field as
        // null -- so assert "blank" rather than a specific empty representation.
        Assert.isTrue(String.isBlank(stored.InstructionText__c),
            'Null text should be stored as blank, got: ' + stored.InstructionText__c);
        Assert.areEqual(true, stored.IsActive__c, 'Null isActive should default to true');
    }
}
