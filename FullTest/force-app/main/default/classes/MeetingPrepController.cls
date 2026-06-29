public with sharing class MeetingPrepController {

    /**
     * Calls an Autolaunched Flow to generate AI topic suggestions for an upcoming meeting.
     * The flow receives an account/event id plus a serialized context blob (touchpoints,
     * open tasks, drift, etc.) and must populate the Text output variable 'GeneratedTopics'
     * containing a JSON array of objects: [{ "title": "...", "rationale": "..." }, ...].
     *
     * @param flowApiName  API name of the autolaunched suggestion flow.
     * @param accountId    Customer/account/event Id used as flow input 'AccountId'.
     * @param contextJson  JSON blob describing the meeting context (passed as 'ContextJson').
     * @return JSON array string of topic suggestions, or '[]' if the flow returned nothing.
     */
    /**
     * Invokes an autolaunched flow to fetch Tasks for a collection of account ids.
     * The flow must accept a String collection input variable named 'recordIds' and
     * expose a Task collection output variable named 'outputTasks'.
     *
     * @param flowApiName API name of the tasks subflow (e.g. 'MeetingPrep_SUB_GetTasks')
     * @param accountIds  Account ids whose Tasks (by WhatId IN :accountIds) should be returned.
     * @return The Task records returned by the flow, or an empty list.
     */
    @AuraEnabled
    public static List<Task> getTasksForAccounts(String flowApiName, List<String> accountIds) {
        try {
            if (String.isBlank(flowApiName) || accountIds == null || accountIds.isEmpty()) {
                return new List<Task>();
            }
            Map<String, Object> flowInputs = new Map<String, Object>{ 'recordIds' => accountIds };
            Flow.Interview interview = Flow.Interview.createInterview(flowApiName, flowInputs);
            interview.start();
            Object out = interview.getVariableValue('outputTasks');
            return out == null ? new List<Task>() : (List<Task>) out;
        } catch (Exception e) {
            throw new AuraHandledException('Error fetching tasks: ' + e.getMessage());
        }
    }

    /**
     * Invokes an autolaunched flow to fetch Events for a collection of account ids.
     * The flow must accept a String collection input variable named 'recordIds' and
     * expose an Event collection output variable named 'outputEvents'.
     */
    @AuraEnabled
    public static List<Event> getEventsForAccounts(String flowApiName, List<String> accountIds) {
        try {
            if (String.isBlank(flowApiName) || accountIds == null || accountIds.isEmpty()) {
                return new List<Event>();
            }
            Map<String, Object> flowInputs = new Map<String, Object>{ 'recordIds' => accountIds };
            Flow.Interview interview = Flow.Interview.createInterview(flowApiName, flowInputs);
            interview.start();
            Object out = interview.getVariableValue('outputEvents');
            return out == null ? new List<Event>() : (List<Event>) out;
        } catch (Exception e) {
            throw new AuraHandledException('Error fetching events: ' + e.getMessage());
        }
    }

    /**
     * Invokes an autolaunched flow to fetch household milestones for a collection of household ids.
     * The flow must accept a String collection input variable named 'recordIds' and
     * expose a Household_Milestones__c collection output variable named 'outputMilestones'.
     *
     * @param flowApiName API name of the milestones subflow (e.g. 'MeetingPrep_SUB_GetMilestones')
     * @param recordIds   Household Account ids (usually just the screen flow's recordId).
     * @return The milestone records returned by the flow, or an empty list.
     */
    @AuraEnabled
    public static List<Household_Milestones__c> getMilestones(String flowApiName, List<String> recordIds) {
        try {
            if (String.isBlank(flowApiName) || recordIds == null || recordIds.isEmpty()) {
                return new List<Household_Milestones__c>();
            }
            Map<String, Object> flowInputs = new Map<String, Object>{ 'recordIds' => recordIds };
            Flow.Interview interview = Flow.Interview.createInterview(flowApiName, flowInputs);
            interview.start();
            Object out = interview.getVariableValue('outputMilestones');
            return out == null ? new List<Household_Milestones__c>() : (List<Household_Milestones__c>) out;
        } catch (Exception e) {
            throw new AuraHandledException('Error fetching milestones: ' + e.getMessage());
        }
    }

    @AuraEnabled
    public static String generateTopicSuggestions(String flowApiName, String accountId, String contextJson) {
        try {
            Map<String, Object> flowInputs = new Map<String, Object>();
            if (String.isNotBlank(accountId))   flowInputs.put('AccountId', accountId);
            if (String.isNotBlank(contextJson)) flowInputs.put('ContextJson', contextJson);

            Flow.Interview interview = Flow.Interview.createInterview(flowApiName, flowInputs);
            interview.start();

            String result = (String) interview.getVariableValue('GeneratedTopics');
            return String.isBlank(result) ? '[]' : result;
        } catch (Exception e) {
            throw new AuraHandledException('Error generating topic suggestions: ' + e.getMessage());
        }
    }
}
