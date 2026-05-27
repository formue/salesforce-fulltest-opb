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
                INVALID_FLOW, null, '<p>Note</p>', '# Note', '<p>Brief</p>', '# Brief', null, false, 'annual'
            );
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
                '<p>Brief</p>', '# Brief', null, true, 'whiteboard'
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
    static void testSaveWealthPlan_InvalidFlow_ThrowsException() {
        // Empty section arrays — putSObjects skips all, flow invocation throws
        String recordsJson = JSON.serialize(new Map<String, Object>{
            'goals' => new Map<String, Object>{
                'create' => new List<Object>(),
                'update' => new List<Object>(),
                'delete' => new List<Object>()
            }
        });
        Test.startTest();
        try {
            MeetingSummaryController.saveWealthPlan(INVALID_FLOW, recordsJson, null);
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for invalid flow');
        }
        Test.stopTest();
    }

    @IsTest
    static void testSaveWealthPlan_NullJson_ThrowsException() {
        // Null recordsJson causes JSON.deserializeUntyped to throw
        Test.startTest();
        try {
            MeetingSummaryController.saveWealthPlan(INVALID_FLOW, null, null);
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for null JSON');
        }
        Test.stopTest();
    }

    @IsTest
    static void testSaveWealthPlan_WithTodosData_InvalidFlow_ThrowsException() {
        // Non-empty todos.create exercises the putSObjects deserialization path
        String recordsJson = JSON.serialize(new Map<String, Object>{
            'todos' => new Map<String, Object>{
                'create' => new List<Object>{
                    new Map<String, Object>{
                        'Subject'  => 'Send report',
                        'Priority' => 'High',
                        'Type'     => 'Other'
                    }
                },
                'update' => new List<Object>(),
                'delete' => new List<Object>()
            }
        });
        Test.startTest();
        try {
            MeetingSummaryController.saveWealthPlan(INVALID_FLOW, recordsJson, 'acc001');
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for invalid flow');
        }
        Test.stopTest();
    }

    @IsTest
    static void testSaveWealthPlan_EmptyPayload_InvalidFlow_ThrowsException() {
        // No sections at all — inputs map has only AccountId, still throws at flow invocation
        Test.startTest();
        try {
            MeetingSummaryController.saveWealthPlan(INVALID_FLOW, '{}', 'acc001');
            Assert.fail('Expected AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isNotNull(e, 'AuraHandledException should be thrown for invalid flow');
        }
        Test.stopTest();
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
}