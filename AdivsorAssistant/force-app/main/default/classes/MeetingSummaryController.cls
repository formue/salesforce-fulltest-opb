public with sharing class MeetingSummaryController {
    
    /**
     * Calls an Autolaunched Flow dynamically to generate a summary.
     *
     * Prompt template inputs: Attachment (documentId1), Attachment 2 (documentId2),
     * Notes (advisor free-text), Instructions (user AI instructions), and
     * Transcription (plain text extracted server-side from a .txt file).
     *
     * @return The generated summary string from the Flow.
     */
    @AuraEnabled
    public static String generateSummary(
            String flowApiName,
            String eventId,
            String accountId,
            String documentId1,
            String documentId2,
            String documentId3,
            String additionalContext,
            String notes,
            String instructions,
            String transcriptDocumentId,
            String meetingNoteText,
            String meetingType,
            Boolean hasTodos,
            Boolean saveDoc1AsArtifact,
            Boolean saveDoc2AsArtifact) {
        try {
            Map<String, Object> flowInputs = new Map<String, Object>();
            if (String.isNotBlank(eventId))          flowInputs.put('EventId',           eventId);
            if (String.isNotBlank(accountId))        flowInputs.put('AccountId',         accountId);
            if (String.isNotBlank(documentId1))  flowInputs.put('ContentDocumentId1', documentId1);
            if (String.isNotBlank(documentId2))  flowInputs.put('ContentDocumentId2', documentId2);
            if (String.isNotBlank(documentId3))  flowInputs.put('ContentDocumentId3', documentId3);
            // The advisor's context box, accepted and sent under BOTH names on purpose.
            //
            // The 5-input prompt restructure renamed this from additionalContext/AdditionalContext
            // to notes/Notes and updated the meeting-summary flow, but the WealthPlan flow
            // (v13 Active, v21 Draft) still declares AdditionalContext -- so sending only Notes
            // silently dropped the context there, leaving the prompt with nothing to work from.
            //
            // Inbound: advisorMeetingSummary and advisorWealthPlan send `notes`, while the deployed
            // advisorAssistant and wealthPlanHelper still send `additionalContext`. Accept either.
            // Outbound: createInterview ignores keys a flow does not declare, so sending both names
            // lets each flow pick up the one it knows.
            //
            // Once every flow and component is on Notes, drop the fallback and the second put.
            String contextText = String.isNotBlank(notes) ? notes : additionalContext;
            if (String.isNotBlank(contextText)) {
                flowInputs.put('Notes',             contextText);  // MeetingSummary flow
                flowInputs.put('AdditionalContext', contextText);  // WealthPlan flow
            }
            if (String.isNotBlank(instructions))     flowInputs.put('Instructions',      instructions);
            if (String.isNotBlank(meetingNoteText))  flowInputs.put('MeetingNoteText',   meetingNoteText);
            if (String.isNotBlank(meetingType))      flowInputs.put('MeetingType',       meetingType);
            if (hasTodos != null)                    flowInputs.put('HasTodos',          hasTodos);

            // Extract transcript text server-side so the prompt receives plain text, not a document ID
            String transcription = extractTranscriptText(transcriptDocumentId);
            if (String.isNotBlank(transcription))    flowInputs.put('Transcription',     transcription);

            // GenerateMode is sent unconditionally: it drives the Flow's mode decision, and gating
            // it on meetingType meant a summary generated before a category was chosen sent no mode
            // at all and fell through to the Flow's unexpected-state branch. The WealthPlan flow does
            // not declare it, and createInterview ignores keys a flow does not declare.
            flowInputs.put('GenerateMode', 'summary');
            if (String.isNotBlank(meetingType)) {
                Map<String, String> typeLabels = new Map<String, String>{
                    'whiteboard' => 'Prospect Meeting',
                    'working'    => 'Working Meeting',
                    'status'     => 'Status Meeting',
                    'annual'     => 'Annual Review'
                };
                String typeLabel = typeLabels.containsKey(meetingType) ? typeLabels.get(meetingType) : meetingType;
                String meetingContext = (String.isNotBlank(typeLabel) ? typeLabel : 'Unspecified')
                    + ' | To-Dos: ' + (hasTodos == true ? 'Yes' : 'No');
                flowInputs.put('MeetingContext', meetingContext);
                // Steers the summary outline: the prompt gives Input:Instructions absolute
                // priority, and the summary flow folds this label into that input.
                flowInputs.put('MeetingTypeLabel', typeLabel);
            }
            if (saveDoc1AsArtifact != null) flowInputs.put('SaveDoc1AsArtifact', saveDoc1AsArtifact);
            if (saveDoc2AsArtifact != null) flowInputs.put('SaveDoc2AsArtifact', saveDoc2AsArtifact);

            // Create and start the Flow interview
            Flow.Interview myFlow = Flow.Interview.createInterview(flowApiName, flowInputs);
            myFlow.start();

            return readFlowResult(myFlow, 'GeneratedSummary',
                'No summary was generated by the prompt template. Please check the flow outputs.');

        } catch (AuraHandledException ahe) {
            throw ahe;   // already carries the Flow's ErrorMessage -- do not re-wrap
        } catch (Exception e) {
            throw new AuraHandledException('Error executing summary flow: ' + e.getMessage());
        }
    }

    /**
     * Calls a dedicated Autolaunched Flow to regenerate a meeting summary.
     * The flow receives the existing summary and advisor instructions as named inputs,
     * and returns the regenerated text via the 'generatedResponse' output variable.
     *
     * @param flowApiName    API name of the regeneration flow.
     * @param currentSummary The existing meeting summary HTML to use as context.
     * @param instructions   Advisor instructions for adjusting the regeneration.
     * @return The regenerated summary string from the flow.
     */
    @AuraEnabled
    public static String regenerateMeetingSummary(String flowApiName, String currentSummary, String instructions, String documentId) {
        try {
            Map<String, Object> flowInputs = new Map<String, Object>();
            flowInputs.put('currentSummary', currentSummary);
            flowInputs.put('instructions', instructions);
            if (String.isNotBlank(documentId)) {
                flowInputs.put('documentId', documentId);
            }

            Flow.Interview myFlow = Flow.Interview.createInterview(flowApiName, flowInputs);
            myFlow.start();

            String result = (String) myFlow.getVariableValue('generatedResponse');

            if (String.isBlank(result)) {
                return 'No summary was generated. Please check the flow outputs.';
            }
            return result;

        } catch (Exception e) {
            throw new AuraHandledException('Error executing regeneration flow: ' + e.getMessage());
        }
    }

    /**
     * Calls the same meeting summary Flow to generate structured to-do items.
     * The Flow must populate a Text output variable named 'GeneratedTodos' containing
     * a JSON array of Task-like objects (Subject, Description, ActivityDate, Priority).
     *
     * @return JSON array string, e.g. '[{"Subject":"...","Priority":"Normal"}]'
     */
    @AuraEnabled
    public static String generateMeetingTodos(
            String flowApiName,
            String eventId,
            String accountId,
            String documentId1,
            String documentId2,
            String meetingType,
            Boolean hasTodos,
            String notes,
            String instructions,
            String transcriptDocumentId) {
        try {
            Map<String, Object> flowInputs = new Map<String, Object>();
            flowInputs.put('GenerateMode', 'todos');
            if (String.isNotBlank(eventId))      flowInputs.put('EventId',            eventId);
            if (String.isNotBlank(accountId))    flowInputs.put('AccountId',          accountId);
            if (String.isNotBlank(documentId1))  flowInputs.put('ContentDocumentId1', documentId1);
            if (String.isNotBlank(documentId2))  flowInputs.put('ContentDocumentId2', documentId2);
            if (String.isNotBlank(notes))        flowInputs.put('Notes',              notes);
            if (String.isNotBlank(instructions)) flowInputs.put('Instructions',       instructions);
            if (String.isNotBlank(meetingType))  flowInputs.put('MeetingType',        meetingType);
            if (hasTodos != null)                flowInputs.put('HasTodos',           hasTodos);

            String transcription = extractTranscriptText(transcriptDocumentId);
            if (String.isNotBlank(transcription)) flowInputs.put('Transcription',     transcription);

            Flow.Interview myFlow = Flow.Interview.createInterview(flowApiName, flowInputs);
            myFlow.start();

            return readFlowResult(myFlow, 'GeneratedTodos', '[]');
        } catch (AuraHandledException ahe) {
            throw ahe;   // already carries the Flow's ErrorMessage -- do not re-wrap
        } catch (Exception e) {
            throw new AuraHandledException('Error generating meeting todos: ' + e.getMessage());
        }
    }

    /**
     * Reads a generation Flow's result, surfacing the Flow's own diagnostics.
     *
     * Both generation flows set ErrorMessage on every fault path and on their
     * unexpected-state branches, and DebugLog at a checkpoint before the prompt branch is
     * chosen. Without reading them a failure surfaces as a generic "nothing was generated",
     * which is what made every failure require an Apex debug log to diagnose.
     */
    private static String readFlowResult(Flow.Interview flow, String resultVar, String emptyMessage) {
        String debug = (String) flow.getVariableValue('DebugLog');
        if (String.isNotBlank(debug)) System.debug(LoggingLevel.INFO, 'Flow DebugLog: ' + debug);

        String err = (String) flow.getVariableValue('ErrorMessage');
        if (String.isNotBlank(err)) {
            throw new AuraHandledException(
                err + (String.isNotBlank(debug) ? ' [' + debug + ']' : ''));
        }
        String result = (String) flow.getVariableValue(resultVar);
        if (String.isBlank(result)) {
            return String.isNotBlank(debug) ? emptyMessage + ' [' + debug + ']' : emptyMessage;
        }
        return result;
    }

    /**
     * Reads the plain text body of a ContentDocument (identified by its ContentDocumentId).
     * Only processes TXT/TEXT file types; returns empty string for anything else or on error.
     * Called before invoking generation flows so the prompt receives plain text, not a document ID.
     */
    private static String extractTranscriptText(String contentDocumentId) {
        if (String.isBlank(contentDocumentId)) return '';
        try {
            List<ContentVersion> versions = [
                SELECT VersionData, FileType
                FROM   ContentVersion
                WHERE  ContentDocumentId = :contentDocumentId
                  AND  IsLatest = true
                LIMIT 1
            ];
            if (versions.isEmpty()) return '';
            ContentVersion cv = versions[0];
            if (!new Set<String>{ 'TXT', 'TEXT' }.contains((cv.FileType ?? '').toUpperCase())) return '';
            return cv.VersionData.toString();
        } catch (Exception e) {
            return '';
        }
    }

    /**
     * Saves (create, update or delete) a MeetingNote__c record via an Autolaunched Flow.
     * Allows the LWC to persist the note in the background without navigating the screen flow.
     *
     * Also used for the Create Version flow, which takes the same inputs but writes a
     * MeetingNoteVersion__c and repoints the parent note — the caller decides by passing a
     * different flowApiName.
     *
     * Every parameter is forwarded to the Flow as a like-named input, null-coalesced so the
     * Flow never receives a null. A Flow that does not declare a given input simply ignores it.
     *
     * Internal notes are deliberately NOT handled here — they have their own field, Flow and
     * entry point (saveInternalNotes) so the two concerns can change independently and only
     * one writer ever touches Internal_Notes__c.
     *
     * Flow inputs:  saveMode      (Text)    — always 'summary' from this method
     *               noteId        (Text)    — blank to create
     *               noteHtml      (Text)    — client-facing note body, HTML
     *               briefHtml     (Text)    — "At a Glance" brief, HTML
     *               eventId       (Text)    — Event to link a newly created note to
     *               published     (Boolean)
     *               meetingType   (Text)    — stored picklist label: 'Prospect Meeting' | 'Working Meeting' | 'Status Meeting' | 'Annual Review' | ''
     *               deleteNote    (Boolean) — when true the content inputs arrive blank
     * Flow output:  savedNoteId   (Text)    — Id of the created or updated MeetingNote__c
     *
     * @param flowApiName   API name of the save (or create-version) flow.
     * @param noteId        Id of an existing MeetingNote__c to update, or blank to create.
     * @param noteHtml      HTML content of the note.
     * @param briefHtml     HTML content of the "At a Glance" brief.
     * @param eventId       Id of the Event to link a newly created note to.
     * @param published     Whether to mark the note as Published__c = true.
     * @param meetingType   Meeting category label chosen by the advisor.
     * @param deleteNote    When true, the flow deletes the note instead of saving it.
     * @return The Id of the saved MeetingNote__c record.
     */
    @AuraEnabled
    public static String saveMeetingNote(
            String flowApiName,
            String noteId,
            String noteHtml,
            String briefHtml,
            String eventId,
            Boolean published,
            String meetingType,
            Boolean deleteNote) {
        Savepoint sp = null;
        try {
            // Fail early with the support message rather than letting the Flow die mid-way
            // on INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY.
            assertCanSaveNote(eventId, noteId, meetingType, true);

            Map<String, Object> flowInputs = new Map<String, Object>();
            // Explicit mode so the Flow never has to infer the caller from which inputs
            // happen to be blank — an unset Flow variable and an empty string are
            // indistinguishable to ISBLANK, which made inference unsafe.
            flowInputs.put('saveMode',      'summary');
            flowInputs.put('noteId',        noteId        != null ? noteId        : '');
            flowInputs.put('noteHtml',      noteHtml      != null ? noteHtml      : '');
            flowInputs.put('briefHtml',     briefHtml     != null ? briefHtml     : '');
            flowInputs.put('eventId',       eventId       != null ? eventId       : '');
            flowInputs.put('published',     published     != null ? published     : false);
            flowInputs.put('meetingType',   meetingType   != null ? meetingType   : '');
            flowInputs.put('deleteNote',    deleteNote    != null ? deleteNote    : false);

            // The Flow creates the note BEFORE linking it to the Event. If the link fails,
            // the rollback stops an orphan MeetingNote__c from being left behind.
            sp = Database.setSavepoint();
            Flow.Interview interview = Flow.Interview.createInterview(flowApiName, flowInputs);
            interview.start();
            throwIfFlowFaulted(interview);

            return (String) interview.getVariableValue('savedNoteId');
        } catch (AuraHandledException ahe) {
            rollbackTo(sp);
            throw ahe;
        } catch (Exception e) {
            rollbackTo(sp);
            throw toAuraException('Error executing save note flow: ', e);
        }
    }

    /**
     * Saves advisor-private internal notes to MeetingNote__c.Internal_Notes__c via a
     * dedicated Autolaunched Flow, independently of the meeting summary.
     *
     * Kept separate from saveMeetingNote on purpose: internal notes are not client-facing,
     * are saved on their own button, and must not be coupled to the summary's save,
     * publish, version or delete paths. Only this method writes Internal_Notes__c.
     *
     * The note record may not exist yet — an advisor can capture internal notes before any
     * summary has been generated. In that case noteId arrives blank and the Flow is expected
     * to create the MeetingNote__c, link it to the Event, and return its Id so the caller can
     * reuse that same record for a later summary save rather than creating a second one.
     *
     * Flow inputs:  saveMode      (Text)    — always 'internalNotes' from this method
     *               noteId        (Text)    — blank to create
     *               eventId       (Text)    — Event to link a newly created note to
     *               internalNotes (Text)    — rich text body
     * Flow output:  savedNoteId   (Text)    — Id of the created or updated MeetingNote__c
     *
     * @param flowApiName   API name of the internal-notes save flow.
     * @param noteId        Id of an existing MeetingNote__c to update, or blank to create.
     * @param eventId       Id of the Event to link a newly created note to.
     * @param internalNotes Rich text body. Never surfaced to the client.
     * @return The Id of the saved MeetingNote__c record.
     */
    @AuraEnabled
    public static String saveInternalNotes(
            String flowApiName,
            String noteId,
            String eventId,
            String internalNotes) {
        Savepoint sp = null;
        try {
            // An internal notes save never writes the meeting type, so only the note itself
            // (or, on the create path, the Event link) needs edit access.
            assertCanSaveNote(eventId, noteId, null, false);

            Map<String, Object> flowInputs = new Map<String, Object>();
            // See saveMeetingNote: the Flow branches on this rather than guessing.
            // It matters most when the advisor CLEARS their notes — internalNotes is then
            // empty, and without the mode the Flow would take the summary branch and blank
            // the client-facing note.
            flowInputs.put('saveMode',      'internalNotes');
            flowInputs.put('noteId',        noteId        != null ? noteId        : '');
            flowInputs.put('eventId',       eventId       != null ? eventId       : '');
            flowInputs.put('internalNotes', internalNotes != null ? internalNotes : '');

            sp = Database.setSavepoint();
            Flow.Interview interview = Flow.Interview.createInterview(flowApiName, flowInputs);
            interview.start();
            throwIfFlowFaulted(interview);

            return (String) interview.getVariableValue('savedNoteId');
        } catch (AuraHandledException ahe) {
            rollbackTo(sp);
            throw ahe;
        } catch (Exception e) {
            rollbackTo(sp);
            throw toAuraException('Error executing internal notes flow: ', e);
        }
    }

    /**
     * Invokes an Autolaunched Flow to create Task records from accepted action items.
     *
     * Flow inputs:  TodosJson (Text) — JSON array of { Subject, WhoId, Type, ActivityDate, WhatId }
     *               EventId   (Text) — Id of the related Event (also present as WhatId in each record)
     *               WhoId     (Text) — Contact/Lead Id (also present inside each record)
     * Flow output:  SaveResult (Text, optional) — confirmation message
     *
     * @param flowApiName  API name of the autolaunched save flow.
     * @param todosJson    JSON-serialised array of task objects.
     * @param eventId      Id of the Salesforce Event record.
     * @param whoId        WhoId (Contact or Lead) from the Event.
     * @return Confirmation message from the flow, or 'Saved' if none provided.
     */
    /**
     * Deserialises accepted action items into Task SObjects and passes the collection
     * directly to an Autolaunched Flow. The flow only needs a single Create Records
     * element — no JSON parsing required.
     *
     * Flow input:  TaskRecords (Record Collection, type = Task) — fully populated Task objects
     * Flow output: SaveResult  (Text, optional) — confirmation message
     */
    @AuraEnabled
    public static String saveTodos(
            String flowApiName,
            String todosJson,
            String eventId,
            String whoId) {
        Savepoint sp = null;
        try {
            System.debug('saveTodos called — flowApiName: ' + flowApiName);
            System.debug('saveTodos — eventId: ' + eventId);
            System.debug('saveTodos — whoId (param): ' + whoId);
            System.debug('saveTodos — todosJson: ' + todosJson);

            // Query WhoId and WhatId directly from the Event
            String eventWhoId = null;
            String eventWhatId = null;
            if (String.isNotBlank(eventId)) {
                List<Event> events = [SELECT WhoId, WhatId FROM Event WHERE Id = :eventId LIMIT 1];
                if (!events.isEmpty()) {
                    eventWhoId  = events[0].WhoId;
                    eventWhatId = events[0].WhatId;
                }
            }
            System.debug('saveTodos — eventWhoId: '  + eventWhoId);
            System.debug('saveTodos — eventWhatId: ' + eventWhatId);

            List<Task> tasks = new List<Task>();
            List<Object> rawList = (List<Object>) JSON.deserializeUntyped(todosJson);
            for (Object item : rawList) {
                Map<String, Object> f = (Map<String, Object>) item;
                Task t = new Task();
                t.Subject     = f.containsKey('Subject')     ? (String) f.get('Subject')     : '';
                t.Description = f.containsKey('Description') ? (String) f.get('Description') : '';
                t.Priority    = f.containsKey('Priority')    ? (String) f.get('Priority')    : 'Normal';
                t.Type        = f.containsKey('Type')        ? (String) f.get('Type')        : 'Other';
                if (f.containsKey('ActivityDate') && String.isNotBlank((String) f.get('ActivityDate'))) {
                    t.ActivityDate = Date.valueOf((String) f.get('ActivityDate'));
                }
                if (f.containsKey('IsPublic__c'))     t.IsPublic__c      = (Boolean) f.get('IsPublic__c');
                if (String.isNotBlank(eventId))       t.Related_Event__c = eventId;
                if (String.isNotBlank(eventWhoId))    t.WhoId            = eventWhoId;
                if (String.isNotBlank(eventWhatId))   t.WhatId           = eventWhatId;
                System.debug('saveTodos — task built: ' + t);
                tasks.add(t);
            }

            System.debug('saveTodos — task count: ' + tasks.size());

            Map<String, Object> flowInputs = new Map<String, Object>();
            flowInputs.put('TaskRecords', tasks);
            flowInputs.put('EventId', eventId     != null ? eventId     : '');
            flowInputs.put('WhoId',   eventWhoId  != null ? eventWhoId  : '');
            flowInputs.put('WhatId',  eventWhatId != null ? eventWhatId : '');

            System.debug('saveTodos — flowInputs keys: '              + flowInputs.keySet());
            System.debug('saveTodos — EventId in flowInputs: '        + flowInputs.get('EventId'));
            System.debug('saveTodos — WhoId in flowInputs: '          + flowInputs.get('WhoId'));
            System.debug('saveTodos — WhatId in flowInputs: '         + flowInputs.get('WhatId'));

            sp = Database.setSavepoint();
            Flow.Interview interview = Flow.Interview.createInterview(flowApiName, flowInputs);
            interview.start();

            String result = (String) interview.getVariableValue('SaveResult');
            return String.isNotBlank(result) ? result : 'Saved';
        } catch (Exception e) {
            rollbackTo(sp);
            throw toAuraException('Error saving to-dos: ', e);
        }
    }

    @AuraEnabled
    public static String saveWealthPlan(String flowApiName, String recordsJson, String accountId) {
        try {
            Map<String, Object> all = (Map<String, Object>) JSON.deserializeUntyped(recordsJson);
            List<String> errors          = new List<String>();
            List<String> successSections = new List<String>();

            trySaveSection('goals',          'Goals',
                getWpList(all,'goals','create', List<FinServ__FinancialGoal__c>.class),
                getWpList(all,'goals','update', List<FinServ__FinancialGoal__c>.class),
                getWpList(all,'goals','delete', List<FinServ__FinancialGoal__c>.class),
                errors, successSections);

            trySaveSection('income',         'Income',
                getWpList(all,'income','create', List<FF_Income__c>.class),
                getWpList(all,'income','update', List<FF_Income__c>.class),
                getWpList(all,'income','delete', List<FF_Income__c>.class),
                errors, successSections);

            // Liabilities are stored as a positive amount with no category. The component already
            // normalises them; this is the server-side guard for every caller.
            trySaveSection('assets',         'Assets & Liabilities',
                normalizeLiabilities(getWpList(all,'assets','create', List<FinServ__AssetsAndLiabilities__c>.class)),
                normalizeLiabilities(getWpList(all,'assets','update', List<FinServ__AssetsAndLiabilities__c>.class)),
                getWpList(all,'assets','delete', List<FinServ__AssetsAndLiabilities__c>.class),
                errors, successSections);

            trySaveSection('milestones',     'Milestones',
                getWpList(all,'milestones','create', List<Household_Milestones__c>.class),
                getWpList(all,'milestones','update', List<Household_Milestones__c>.class),
                getWpList(all,'milestones','delete', List<Household_Milestones__c>.class),
                errors, successSections);

            trySaveSection('ownership',      'Ownership',
                getWpList(all,'ownership','create', List<Company_Ownership__c>.class),
                getWpList(all,'ownership','update', List<Company_Ownership__c>.class),
                getWpList(all,'ownership','delete', List<Company_Ownership__c>.class),
                errors, successSections);

            trySaveSection('sustainability', 'Sustainability',
                getWpList(all,'sustainability','create', List<SustainabilityPreferences__c>.class),
                getWpList(all,'sustainability','update', List<SustainabilityPreferences__c>.class),
                getWpList(all,'sustainability','delete', List<SustainabilityPreferences__c>.class),
                errors, successSections);

            trySaveSection('greetings',      'Greetings',
                getWpList(all,'greetings','create', List<FF_PersonalGreeting__c>.class),
                getWpList(all,'greetings','update', List<FF_PersonalGreeting__c>.class),
                getWpList(all,'greetings','delete', List<FF_PersonalGreeting__c>.class),
                errors, successSections);

            trySaveSection('todos',          'To-Dos',
                getWpList(all,'todos','create', List<Task>.class),
                new List<SObject>(), new List<SObject>(),
                errors, successSections);

            if (errors.isEmpty()) return 'Saved';
            return JSON.serialize(new Map<String, Object>{
                'errors'          => errors,
                'successSections' => successSections
            });
        } catch (Exception e) {
            throw new AuraHandledException('Error saving Wealth Plan: ' + e.getMessage());
        }
    }

    private static void trySaveSection(
            String key, String label,
            List<SObject> toCreate, List<SObject> toUpdate, List<SObject> toDelete,
            List<String> errors, List<String> successSections) {
        if (toCreate.isEmpty() && toUpdate.isEmpty() && toDelete.isEmpty()) {
            successSections.add(key);
            return;
        }
        Savepoint sp = Database.setSavepoint();
        try {
            if (!toCreate.isEmpty()) insert toCreate;
            if (!toUpdate.isEmpty()) update toUpdate;
            if (!toDelete.isEmpty()) delete toDelete;
            successSections.add(key);
        } catch (Exception e) {
            Database.rollback(sp);
            errors.add(label + ': ' + (isAccessError(e.getMessage()) ? insufficientAccessMessage() : e.getMessage()));
        }
    }

    // ── Liability normalisation ──────────────────────────────────────────────

    @TestVisible
    private static final String LIABILITY = 'Liability';

    /**
     * A liability is stored with a POSITIVE FinServ__Amount__c and a BLANK FF_Category__c.
     * Category is assigned explicitly (not just left unset) so an update also clears a category
     * that was saved earlier.
     */
    @TestVisible
    private static List<SObject> normalizeLiabilities(List<SObject> records) {
        for (SObject rec : records) {
            FinServ__AssetsAndLiabilities__c al = (FinServ__AssetsAndLiabilities__c) rec;
            if (al.AssetorLiabilityType__c != LIABILITY) continue;
            al.FF_Category__c = null;
            if (al.FinServ__Amount__c != null) al.FinServ__Amount__c = Math.abs(al.FinServ__Amount__c);
        }
        return records;
    }

    // ── Save access handling ─────────────────────────────────────────────────

    /** Shown whenever a save is blocked by record access or Client Net Role. */
    @TestVisible
    private static String insufficientAccessMessage() {
        return System.Label.AA_Save_InsufficientAccess;
    }

    /**
     * Covers INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY, INSUFFICIENT_ACCESS_OR_READONLY, etc.
     * The status code stays in English in the fault text whatever the user's language is.
     */
    @TestVisible
    private static Boolean isAccessError(String message) {
        return message != null && message.contains('INSUFFICIENT_ACCESS');
    }

    private static AuraHandledException supportError() {
        String msg = insufficientAccessMessage();
        AuraHandledException ex = new AuraHandledException(msg);
        ex.setMessage(msg);   // so getMessage() returns the text, including in tests
        return ex;
    }

    /** Access errors get the support message; anything else keeps the technical prefix + cause. */
    @TestVisible
    private static AuraHandledException toAuraException(String prefix, Exception e) {
        if (isAccessError(e.getMessage())) return supportError();
        String msg = prefix + e.getMessage();
        AuraHandledException ex = new AuraHandledException(msg);
        ex.setMessage(msg);
        return ex;
    }

    private static void rollbackTo(Savepoint sp) {
        if (sp != null) Database.rollback(sp);
    }

    /**
     * The save flows route DML faults to an ErrorMessage output, so the interview ends
     * "successfully". Treat that as the failure it is. Flows without the variable are fine.
     */
    private static void throwIfFlowFaulted(Flow.Interview interview) {
        String err;
        try {
            err = (String) interview.getVariableValue('ErrorMessage');
        } catch (Exception e) {
            return;   // flow does not declare ErrorMessage
        }
        if (String.isBlank(err)) return;
        if (isAccessError(err)) throw supportError();
        throw new FlowFaultException(err);
    }

    private class FlowFaultException extends Exception {}

    /**
     * Checks up front that the running user can do what the save flow is about to do, so the
     * advisor gets the support message instead of a half-run Flow.
     *
     * Mirrors the flow's routing:
     *   - the note resolves to noteId, else the note already linked on the Event;
     *   - no note → the flow CREATES one and links it to the Event (needs create + Event edit);
     *   - a note  → the flow UPDATES it (needs note edit), and on a summary save also writes
     *     Event.MeetingType__c when it changed (needs Event edit).
     *
     * The Event lookup is best-effort: if the user cannot read the Event or its fields, the
     * decision is made from the Ids alone — which still demands Event edit on the create path.
     * Only a failure of the access query itself fails OPEN; the catch in the caller and the
     * flow's fault path remain the authoritative check.
     */
    private static void assertCanSaveNote(String eventId, String noteId, String meetingType, Boolean writesMeetingType) {
        Id evtId   = toIdOrNull(eventId);
        Id noteRef = toIdOrNull(noteId);

        Event evt = null;
        if (evtId != null) {
            try {
                List<Event> events = [
                    SELECT Id, MeetingNote__c, MeetingType__c
                    FROM   Event
                    WHERE  Id = :evtId
                    WITH   USER_MODE
                    LIMIT  1
                ];
                if (!events.isEmpty()) evt = events[0];
            } catch (Exception e) {
                evt = null;   // no read access to the fields — decide from the Ids below
            }
        }

        Set<Id> needsEdit = new Set<Id>();
        Id resolvedNoteId = noteRef != null ? noteRef : evt?.MeetingNote__c;
        Boolean needsCreate = resolvedNoteId == null;
        if (needsCreate) {
            // evtId, not evt.Id: an Event the user cannot even read must still fail here.
            if (evtId != null) needsEdit.add(evtId);
        } else {
            needsEdit.add(resolvedNoteId);
            Boolean typeChanges = (evt?.MeetingType__c ?? '') != (meetingType ?? '');
            if (writesMeetingType && evt != null && typeChanges) needsEdit.add(evt.Id);
        }

        if (needsCreate && !Schema.sObjectType.MeetingNote__c.isCreateable()) throw supportError();
        if (needsEdit.isEmpty()) return;

        List<UserRecordAccess> access;
        try {
            access = [
                SELECT RecordId, HasEditAccess
                FROM   UserRecordAccess
                WHERE  UserId = :UserInfo.getUserId()
                  AND  RecordId IN :needsEdit
                LIMIT  10
            ];
        } catch (Exception e) {
            return;   // fail open — see method comment
        }
        for (UserRecordAccess ura : access) {
            if (!ura.HasEditAccess) throw supportError();
        }
    }

    private static Id toIdOrNull(String value) {
        if (String.isBlank(value)) return null;
        try {
            return Id.valueOf(value);
        } catch (Exception e) {
            return null;
        }
    }

    private static List<SObject> getWpList(Map<String, Object> all, String section, String op, System.Type t) {
        Map<String, Object> sec = (Map<String, Object>) all.get(section);
        if (sec == null) return new List<SObject>();
        List<Object> items = (List<Object>) sec.get(op);
        if (items == null || items.isEmpty()) return new List<SObject>();
        return (List<SObject>) JSON.deserialize(JSON.serialize(items), t);
    }

    private static void putSObjects(Map<String,Object> inputs, Map<String,Object> all,
                                    String section, String op, String key, System.Type t) {
        Map<String,Object> sec = (Map<String,Object>) all.get(section);
        if (sec == null) return;
        List<Object> items = (List<Object>) sec.get(op);
        if (items == null || items.isEmpty()) return;
        inputs.put(key, JSON.deserialize(JSON.serialize(items), t));
    }

    @AuraEnabled
    public static String saveFileToEvent(String flowApiName, String contentDocumentId, String eventId) {
        Savepoint sp = null;
        try {
            Map<String, Object> inputs = new Map<String, Object>{
                'ContentDocumentId' => contentDocumentId,
                'EventId'           => eventId
            };
            sp = Database.setSavepoint();
            Flow.Interview interview = Flow.Interview.createInterview(flowApiName, inputs);
            interview.start();
            return 'success';
        } catch (Exception e) {
            rollbackTo(sp);
            throw toAuraException('', e);
        }
    }

    @AuraEnabled
    public static List<MeetingNoteVersion__c> getMeetingNoteVersions(String flowApiName, String eventId) {
        try {
            Map<String, Object> flowInputs = new Map<String, Object>{
                'EventId' => eventId != null ? eventId : ''
            };
            Flow.Interview interview = Flow.Interview.createInterview(flowApiName, flowInputs);
            interview.start();
            List<SObject> raw = (List<SObject>) interview.getVariableValue('MeetingNoteVersions');
            if (raw == null) return new List<MeetingNoteVersion__c>();
            List<MeetingNoteVersion__c> result = new List<MeetingNoteVersion__c>();
            for (SObject obj : raw) { result.add((MeetingNoteVersion__c) obj); }
            return result;
        } catch (Exception e) {
            throw new AuraHandledException('Error loading meeting note versions: ' + e.getMessage());
        }
    }
}