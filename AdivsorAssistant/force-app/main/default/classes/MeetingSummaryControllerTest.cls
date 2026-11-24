@IsTest
private class MeetingSummaryControllerTest {

    static final String INVALID_FLOW = 'NonExistent_Flow_XYZ_123';

    // ── generateSummary ──────────────────────────────────────────────────────

    @IsTest
    static void testGenerateSummary_InvalidFlow_ThrowsException() {
        Test.startTest();
        try {
            MeetingSummaryController.generateSummary(
                INVALID_FLOW,      // flowApiName
                null, null,        // eventId, accountId
                null, null, null,  // documentId1..3
                null,              // additionalContext (legacy alias for notes)
                null,              // notes
                null,              // instructions
                null,              // transcriptDocumentId
                null,              // meetingNoteText
                'annual',          // meetingType
                false,             // hasTodos
                false, false       // saveDoc1AsArtifact, saveDoc2AsArtifact
            );
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for invalid flow');
        }
        Test.stopTest();
    }

    // ── regenerateMeetingSummary ─────────────────────────────────────────────

    @IsTest
    static void testRegenerateMeetingSummary_InvalidFlow_ThrowsException() {
        Test.startTest();
        try {
            MeetingSummaryController.regenerateMeetingSummary(
                INVALID_FLOW, 'current summary', 'make it shorter', null
            );
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for invalid flow');
        }
        Test.stopTest();
    }

    // ── generateMeetingTodos ─────────────────────────────────────────────────

    @IsTest
    static void testGenerateMeetingTodos_InvalidFlow_ThrowsException() {
        Test.startTest();
        try {
            MeetingSummaryController.generateMeetingTodos(
                INVALID_FLOW,      // flowApiName
                null, null,        // eventId, accountId
                null, null,        // documentId1, documentId2
                'annual',          // meetingType
                false,             // hasTodos
                null,              // notes
                null,              // instructions
                null               // transcriptDocumentId
            );
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for invalid flow');
        }
        Test.stopTest();
    }

    // ── saveMeetingNote ──────────────────────────────────────────────────────

    @IsTest
    static void testSaveMeetingNote_InvalidFlow_ThrowsException() {
        Test.startTest();
        try {
            MeetingSummaryController.saveMeetingNote(
                INVALID_FLOW, null, '<p>Note</p>', '<p>Brief</p>', null, false, 'annual', false
            );
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for invalid flow');
        }
        Test.stopTest();
    }

    // ── saveInternalNotes ────────────────────────────────────────────────────

    @IsTest
    static void testSaveInternalNotes_InvalidFlow_ThrowsException() {
        // Updating internal notes on an existing MeetingNote__c.
        Test.startTest();
        try {
            MeetingSummaryController.saveInternalNotes(
                INVALID_FLOW, 'a01000000000001AAA', '00U000000000001AAA',
                '<p>Client is <b>nervous</b> about equity exposure.</p>'
            );
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for invalid flow');
        }
        Test.stopTest();
    }

    @IsTest
    static void testSaveInternalNotes_NoExistingNote_InvalidFlow_ThrowsException() {
        // Blank noteId is the create path: an advisor capturing internal notes before any
        // summary exists. The flow is expected to create the note and return its Id.
        Test.startTest();
        try {
            MeetingSummaryController.saveInternalNotes(
                INVALID_FLOW, null, '00U000000000001AAA', '<p>Pre-meeting thoughts</p>'
            );
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for invalid flow');
        }
        Test.stopTest();
    }

    @IsTest
    static void testSaveInternalNotes_NullsAreCoalesced_InvalidFlow_ThrowsException() {
        // Every input is null-coalesced before reaching the flow, so all-null must still
        // reach the interview rather than failing earlier.
        Test.startTest();
        try {
            MeetingSummaryController.saveInternalNotes(INVALID_FLOW, null, null, null);
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for invalid flow');
        }
        Test.stopTest();
    }

    @IsTest
    static void testSaveMeetingNote_Published_InvalidFlow_ThrowsException() {
        // Exercises the published = true branch in flowInputs
        Test.startTest();
        try {
            MeetingSummaryController.saveMeetingNote(
                INVALID_FLOW, '001000000000001AAA', '<p>Published</p>',
                '<p>Brief</p>', null, true, 'whiteboard', false
            );
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for invalid flow');
        }
        Test.stopTest();
    }

    // ── saveTodos ────────────────────────────────────────────────────────────

    @IsTest
    static void testSaveTodos_ValidJson_InvalidFlow_ThrowsException() {
        Event evt = new Event(
            Subject           = 'Test Meeting',
            StartDateTime     = System.now(),
            EndDateTime       = System.now().addHours(1),
            DurationInMinutes = 60
        );
        insert evt;

        String todosJson = JSON.serialize(new List<Map<String, Object>>{
            new Map<String, Object>{
                'Subject'      => 'Follow up',
                'Description'  => 'Send email',
                'Priority'     => 'High',
                'Type'         => 'Email',
                'ActivityDate' => '2025-12-31',
                'IsPublic__c'  => false
            }
        });

        Test.startTest();
        try {
            MeetingSummaryController.saveTodos(INVALID_FLOW, todosJson, evt.Id, null);
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for invalid flow');
        }
        Test.stopTest();
    }

    @IsTest
    static void testSaveTodos_EmptyJson_InvalidFlow_ThrowsException() {
        Test.startTest();
        try {
            MeetingSummaryController.saveTodos(INVALID_FLOW, '[]', null, null);
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for invalid flow');
        }
        Test.stopTest();
    }

    @IsTest
    static void testSaveTodos_MalformedJson_ThrowsException() {
        // Malformed JSON should be caught and re-thrown as AuraHandledException
        Test.startTest();
        try {
            MeetingSummaryController.saveTodos(INVALID_FLOW, 'not valid json {{ }}', null, null);
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for malformed JSON');
        }
        Test.stopTest();
    }

    @IsTest
    static void testSaveTodos_IsPublicTrue_InvalidFlow_ThrowsException() {
        // Exercises the IsPublic__c = true branch in task construction
        String todosJson = JSON.serialize(new List<Map<String, Object>>{
            new Map<String, Object>{
                'Subject'     => 'Client update',
                'Priority'    => 'Normal',
                'IsPublic__c' => true
            }
        });
        Test.startTest();
        try {
            MeetingSummaryController.saveTodos(INVALID_FLOW, todosJson, null, null);
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for invalid flow');
        }
        Test.stopTest();
    }

    // ── saveWealthPlan ───────────────────────────────────────────────────────

    @IsTest
    static void testSaveWealthPlan_EmptyPayload_ReturnsSaved() {
        // '{}' — no sections at all, every trySaveSection sees empty lists and
        // immediately adds to successSections; no DML, no errors → 'Saved'
        Test.startTest();
        String result = MeetingSummaryController.saveWealthPlan('unused', '{}', null);
        Test.stopTest();
        Assert.areEqual('Saved', result, 'Empty payload should return Saved');
    }

    @IsTest
    static void testSaveWealthPlan_AllEmptySections_ReturnsSaved() {
        // All 8 sections present with empty create/update/delete lists →
        // trySaveSection short-circuits for each, no DML → 'Saved'
        Map<String, Object> emptySection = new Map<String, Object>{
            'create' => new List<Object>(),
            'update' => new List<Object>(),
            'delete' => new List<Object>()
        };
        String recordsJson = JSON.serialize(new Map<String, Object>{
            'goals'          => emptySection,
            'income'         => emptySection,
            'assets'         => emptySection,
            'milestones'     => emptySection,
            'ownership'      => emptySection,
            'sustainability' => emptySection,
            'greetings'      => emptySection,
            'todos'          => emptySection
        });
        Test.startTest();
        String result = MeetingSummaryController.saveWealthPlan('unused', recordsJson, null);
        Test.stopTest();
        Assert.areEqual('Saved', result, 'All empty sections should return Saved');
    }

    @IsTest
    static void testSaveWealthPlan_NullJson_ThrowsException() {
        // Null recordsJson causes JSON.deserializeUntyped(null) to throw,
        // which is caught and rethrown as AuraHandledException
        Test.startTest();
        try {
            MeetingSummaryController.saveWealthPlan('unused', null, null);
            Assert.fail('Expected AuraHandledException for null JSON');
        } catch (AuraHandledException e) {
            // AuraHandledException.getMessage() always returns 'Script-thrown exception' in test context;
            // catching the right type is sufficient to prove the error path fired
            Assert.isNotNull(e, 'AuraHandledException should be thrown for null JSON');
        }
        Test.stopTest();
    }

    @IsTest
    static void testSaveWealthPlan_MalformedJson_ThrowsException() {
        // Malformed JSON is caught by JSON.deserializeUntyped and rethrown as AuraHandledException
        Test.startTest();
        try {
            MeetingSummaryController.saveWealthPlan('unused', '{ not : valid }', null);
            Assert.fail('Expected AuraHandledException for malformed JSON');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for malformed JSON');
        }
        Test.stopTest();
    }

    @IsTest
    static void testSaveWealthPlan_TodoCreate_InsertsTasksAndReturnsSaved() {
        // todos.create with two Tasks → DML succeeds → 'Saved', both Tasks in DB
        String recordsJson = JSON.serialize(new Map<String, Object>{
            'todos' => new Map<String, Object>{
                'create' => new List<Object>{
                    new Map<String, Object>{
                        'Subject'  => 'Task Alpha',
                        'Priority' => 'High',
                        'Type'     => 'Other'
                    },
                    new Map<String, Object>{
                        'Subject'  => 'Task Beta',
                        'Priority' => 'Normal',
                        'Type'     => 'Email'
                    }
                },
                'update' => new List<Object>(),
                'delete' => new List<Object>()
            }
        });
        Test.startTest();
        String result = MeetingSummaryController.saveWealthPlan('unused', recordsJson, null);
        Test.stopTest();
        Assert.areEqual('Saved', result, 'Todo create should return Saved on success');
        Integer taskCount = [SELECT COUNT() FROM Task WHERE Subject IN ('Task Alpha', 'Task Beta')];
        Assert.areEqual(2, taskCount, 'Both Tasks should have been inserted into the database');
    }

    @IsTest
    static void testSaveWealthPlan_SectionDmlFailure_ReturnsPartialErrorResponse() {
        // goals.update with a non-existent Id → DML fails → error logged, goals rolled back
        // todos.create with one valid Task → DML succeeds → Task committed, todos in successSections
        // Response is JSON with 'errors' and 'successSections' keys
        String fakeGoalId = FinServ__FinancialGoal__c.getSObjectType()
            .getDescribe().getKeyPrefix() + '000000000000AAA';

        String recordsJson = JSON.serialize(new Map<String, Object>{
            'goals' => new Map<String, Object>{
                'create' => new List<Object>(),
                'update' => new List<Object>{
                    new Map<String, Object>{ 'Id' => fakeGoalId, 'Name' => 'Ghost Goal' }
                },
                'delete' => new List<Object>()
            },
            'todos' => new Map<String, Object>{
                'create' => new List<Object>{
                    new Map<String, Object>{
                        'Subject'  => 'Partial Success Task',
                        'Priority' => 'Normal',
                        'Type'     => 'Other'
                    }
                },
                'update' => new List<Object>(),
                'delete' => new List<Object>()
            }
        });

        Test.startTest();
        String result = MeetingSummaryController.saveWealthPlan('unused', recordsJson, null);
        Test.stopTest();

        Assert.isTrue(result != 'Saved', 'Partial failure should not return the plain Saved string');
        Map<String, Object> response = (Map<String, Object>) JSON.deserializeUntyped(result);
        Assert.isTrue(response.containsKey('errors'),          'Response should contain errors key');
        Assert.isTrue(response.containsKey('successSections'), 'Response should contain successSections key');
        List<Object> successes = (List<Object>) response.get('successSections');
        Boolean todosInSuccesses = false;
        for (Object s : successes) {
            if (s == 'todos') { todosInSuccesses = true; break; }
        }
        Assert.isTrue(todosInSuccesses, 'todos should appear in successSections');
        Integer taskCount = [SELECT COUNT() FROM Task WHERE Subject = 'Partial Success Task'];
        Assert.areEqual(1, taskCount, 'The Task from the successful todos section should be in the database');
    }

    // ── saveFileToEvent ──────────────────────────────────────────────────────

    @IsTest
    static void testSaveFileToEvent_InvalidFlow_ThrowsException() {
        Test.startTest();
        try {
            MeetingSummaryController.saveFileToEvent(INVALID_FLOW, 'someDocumentId', 'someEventId');
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for invalid flow');
        }
        Test.stopTest();
    }

    // ── Insufficient access → support message ────────────────────────────────

    @IsTest
    static void testIsAccessError_RecognisesAccessCodes() {
        Assert.isTrue(MeetingSummaryController.isAccessError(
            'This error occurred: INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY: insufficient access rights on object id'),
            'Cross-reference access error should be recognised');
        Assert.isTrue(MeetingSummaryController.isAccessError('INSUFFICIENT_ACCESS_OR_READONLY'),
            'Read-only access error should be recognised');
        Assert.isFalse(MeetingSummaryController.isAccessError('FIELD_CUSTOM_VALIDATION_EXCEPTION'),
            'Other errors must keep their own message');
        Assert.isFalse(MeetingSummaryController.isAccessError(null), 'Null is not an access error');
    }

    @IsTest
    static void testToAuraException_AccessErrorGetsSupportMessage() {
        AuraHandledException ex = MeetingSummaryController.toAuraException(
            'Error executing save note flow: ',
            new DmlException('INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY: insufficient access rights on object id'));
        Assert.areEqual(System.Label.AA_Save_InsufficientAccess, ex.getMessage(),
            'An access failure should tell the advisor to contact the Support Center');
    }

    @IsTest
    static void testToAuraException_OtherErrorKeepsTechnicalMessage() {
        AuraHandledException ex = MeetingSummaryController.toAuraException(
            'Error executing save note flow: ', new DmlException('Something else'));
        Assert.areEqual('Error executing save note flow: Something else', ex.getMessage(),
            'Non-access errors keep the prefix and the cause');
    }

    @IsTest
    static void testSaveInternalNotes_UserWithoutEventAccess_GetsSupportMessage() {
        // The Event belongs to the running admin; a user outside the role hierarchy cannot edit
        // it, so creating and linking a note must be refused up front with the support message.
        Event evt = new Event(
            Subject           = 'Access Test Meeting',
            StartDateTime     = System.now(),
            EndDateTime       = System.now().addHours(1),
            DurationInMinutes = 60
        );
        insert evt;
        User noAccess = createUserWithoutViewAll();

        String message;
        Test.startTest();
        System.runAs(noAccess) {
            try {
                MeetingSummaryController.saveInternalNotes(INVALID_FLOW, null, evt.Id, '<p>x</p>');
                Assert.fail('Expected AuraHandledException');
            } catch (AuraHandledException e) {
                message = e.getMessage();
            }
        }
        Test.stopTest();

        Assert.areEqual(System.Label.AA_Save_InsufficientAccess, message,
            'A user without access should be told to contact the Support Center');
        Assert.areEqual(0, [SELECT COUNT() FROM MeetingNote__c WHERE CreatedById = :noAccess.Id],
            'No note may be left behind by a refused save');
    }

    private static User createUserWithoutViewAll() {
        Profile p = [
            SELECT Id FROM Profile
            WHERE  UserType = 'Standard'
              AND  UserLicense.Name = 'Salesforce'
              AND  PermissionsViewAllData = false
              AND  PermissionsModifyAllData = false
            ORDER BY Name
            LIMIT 1
        ];
        String unique = String.valueOf(Crypto.getRandomInteger()).replace('-', '');
        User u = new User(
            ProfileId         = p.Id,
            LastName          = 'NoAccess',
            Alias             = 'noacc',
            Email             = 'noaccess' + unique + '@example.com',
            Username          = 'noaccess' + unique + '@example.com.aatest',
            TimeZoneSidKey    = 'Europe/Oslo',
            LocaleSidKey      = 'en_US',
            EmailEncodingKey  = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        insert u;
        return u;
    }

    // ── Liability normalisation ──────────────────────────────────────────────

    @IsTest
    static void testNormalizeLiabilities_PositiveAmountAndBlankCategory() {
        List<SObject> recs = new List<SObject>{
            new FinServ__AssetsAndLiabilities__c(
                Name = 'Boliglån', AssetorLiabilityType__c = 'Liability',
                FF_Category__c = 'Safety', FinServ__Amount__c = -2500000),
            new FinServ__AssetsAndLiabilities__c(
                Name = 'Hytte', AssetorLiabilityType__c = 'NonfinancialAsset',
                FF_Category__c = 'Preserve & Grow', FinServ__Amount__c = 1000000),
            new FinServ__AssetsAndLiabilities__c(
                Name = 'Lån uten beløp', AssetorLiabilityType__c = 'Liability')
        };

        MeetingSummaryController.normalizeLiabilities(recs);

        FinServ__AssetsAndLiabilities__c liability = (FinServ__AssetsAndLiabilities__c) recs[0];
        Assert.areEqual(2500000, liability.FinServ__Amount__c, 'Liability amount must be positive');
        Assert.isNull(liability.FF_Category__c, 'Liability must have no category');

        FinServ__AssetsAndLiabilities__c asset = (FinServ__AssetsAndLiabilities__c) recs[1];
        Assert.areEqual('Preserve & Grow', asset.FF_Category__c, 'Assets keep their category');
        Assert.areEqual(1000000, asset.FinServ__Amount__c, 'Assets keep their amount');

        Assert.isNull(((FinServ__AssetsAndLiabilities__c) recs[2]).FinServ__Amount__c,
            'A blank amount stays blank');
    }

    // ── getMeetingNoteVersions ───────────────────────────────────────────────

    @IsTest
    static void testGetMeetingNoteVersions_InvalidFlow_ThrowsException() {
        Test.startTest();
        try {
            MeetingSummaryController.getMeetingNoteVersions(INVALID_FLOW, 'someEventId');
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for invalid flow');
        }
        Test.stopTest();
    }
}