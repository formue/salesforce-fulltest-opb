@IsTest
private class MeetingSummaryControllerTest {

    static final String INVALID_FLOW = 'NonExistent_Flow_XYZ_123';

    // ── generateSummary ──────────────────────────────────────────────────────

    @IsTest
    static void testGenerateSummary_InvalidFlow_ThrowsException() {
        Test.startTest();
        try {
            MeetingSummaryController.generateSummary(
                INVALID_FLOW, null, null, null, null, null,
                null, null, 'annual', false, false, false, false, null
            );
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for invalid flow');
        }
        Test.stopTest();
    }

    @IsTest
    static void testGenerateSummary_BriefMode_InvalidFlow_ThrowsException() {
        // Passing currentSummary triggers GenerateMode = 'brief'
        Test.startTest();
        try {
            MeetingSummaryController.generateSummary(
                INVALID_FLOW, null, null, null, null, null,
                null, null, null, null, null, null, null, 'existing summary text'
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
                INVALID_FLOW, null, null, null, null, null, 'annual', false, null
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
                INVALID_FLOW, null, '<p>Note</p>', '# Note', '<p>Brief</p>', '# Brief', null, false, 'annual', false
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
                INVALID_FLOW, '001000000000001AAA', '<p>Published</p>', '# Published',
                '<p>Brief</p>', '# Brief', null, true, 'whiteboard', false
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