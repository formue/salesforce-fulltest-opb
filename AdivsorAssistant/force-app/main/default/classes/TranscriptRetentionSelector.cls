/**
 * Selects aged transcript files that belong to Meeting Artifacts, for the
 * scheduled flow AdvisorAssistant_SCH_Transcript_Retention.
 *
 * Read-only: this class never deletes. The flow owns the on/off switch, the
 * dry-run decision and the Delete Records step.
 *
 * A file qualifies when its extension is txt, its title contains "Transcript",
 * it was created before the retention cutoff, and it is linked to a
 * Meeting_Artifact__c. Files are reached through ContentDocumentLink filtered
 * by LinkedEntityId (a semi-join on Meeting_Artifact__c), because Salesforce
 * applies file sharing to direct ContentDocument queries even in system mode:
 * the Automated Process user that runs the scheduled flow sees no files that
 * way. Links are read oldest file first in pages of 200, using a
 * (ContentDocument.CreatedDate, ContentDocumentId) cursor. Deleted files take
 * their links with them, so the work does not grow with artifact history.
 *
 * Sharing: declared without sharing (approved), with queries explicitly
 * WITH SYSTEM_MODE (so this stays true if the API version is raised to 67.0+),
 * which is why the PMD CRUD rule is suppressed. Reads only file Id, Title and
 * CreatedDate.
 */
@SuppressWarnings('PMD.ApexCRUDViolation')
public without sharing class TranscriptRetentionSelector {
    @TestVisible
    private static final Integer PAGE_SIZE = 200;
    @TestVisible
    private static final Integer DEFAULT_MAX_SCAN = 2000;
    private static final String TITLE_PATTERN = '%Transcript%';
    private static final String FILE_EXTENSION = 'txt';
    private static final String LINE_BREAK = '<br/>';

    /** Test-only replacement for the current time, so tests don't depend on CreatedDate. */
    @TestVisible
    private static Datetime nowOverride;

    /**
     * Returns the transcript files to delete for each request.
     * @param requests Retention settings from the calling flow (one per scheduled run)
     * @return One Response per request, in the same order
     * @example
     * TranscriptRetentionSelector.Request req = new TranscriptRetentionSelector.Request();
     * req.retentionDays = 7; req.maxFiles = 50;
     * List<TranscriptRetentionSelector.Response> res = TranscriptRetentionSelector.selectTranscripts(new List<TranscriptRetentionSelector.Request>{ req });
     */
    @InvocableMethod(
        label='Select Transcripts For Retention'
        description='Returns aged .txt transcript files linked to a Meeting Artifact, oldest first, up to Max Files. Read-only.'
        category='Advisor Assistant'
    )
    public static List<Response> selectTranscripts(List<Request> requests) {
        List<Response> responses = new List<Response>();
        if (requests == null) {
            return responses;
        }
        // Identical settings share one selection, so a bulk call cannot multiply the queries.
        Map<String, Response> responsesBySettings = new Map<String, Response>();
        for (Request request : requests) {
            String settingsKey = request == null
                ? 'null'
                : request.retentionDays + '|' + request.maxFiles + '|' + request.maxScan;
            if (!responsesBySettings.containsKey(settingsKey)) {
                responsesBySettings.put(settingsKey, selectForRequest(request));
            }
            responses.add(responsesBySettings.get(settingsKey));
        }
        return responses;
    }

    private static Response selectForRequest(Request request) {
        Response response = new Response();
        if (request == null || !isPositive(request.retentionDays) || !isPositive(request.maxFiles)) {
            return response;
        }
        Integer maxFiles = request.maxFiles;
        Integer maxScan = isPositive(request.maxScan) ? Math.min(request.maxScan, DEFAULT_MAX_SCAN) : DEFAULT_MAX_SCAN;
        Datetime cutoff = (nowOverride ?? Datetime.now()).addDays(-request.retentionDays);

        Set<Id> selectedIds = new Set<Id>();
        List<String> fileLines = new List<String>();
        ContentDocumentLink lastLink;

        // Bounded paging: at most maxScan / PAGE_SIZE pages (10), one query per page.
        while (response.selectedCount < maxFiles && response.scannedCount < maxScan && hasQueryBudget()) {
            Integer pageSize = Math.min(PAGE_SIZE, maxScan - response.scannedCount);
            List<ContentDocumentLink> links = queryArtifactTranscriptLinks(cutoff, lastLink, pageSize);
            if (links.isEmpty()) {
                break;
            }
            response.scannedCount += links.size();

            for (ContentDocumentLink link : links) {
                // A file linked to two artifacts appears once per link; count it once.
                if (response.selectedCount < maxFiles && selectedIds.add(link.ContentDocumentId)) {
                    response.documents.add(link.ContentDocument);
                    response.selectedCount++;
                    fileLines.add(link.ContentDocumentId + ' - ' + link.ContentDocument.Title?.escapeHtml4());
                }
            }
            if (links.size() < pageSize) {
                break;
            }
            lastLink = links[links.size() - 1];
        }
        response.fileList = String.join(fileLines, LINE_BREAK);
        return response;
    }

    /**
     * Links from Meeting Artifacts to aged transcript files, oldest file first.
     * An artifact always exists before its transcript is attached, so artifacts
     * newer than the cutoff cannot hold a qualifying file.
     */
    private static List<ContentDocumentLink> queryArtifactTranscriptLinks(
        Datetime cutoff,
        ContentDocumentLink lastLink,
        Integer pageSize
    ) {
        if (lastLink == null) {
            return [
                SELECT ContentDocumentId, ContentDocument.Id, ContentDocument.Title, ContentDocument.CreatedDate
                FROM ContentDocumentLink
                WHERE
                    LinkedEntityId IN (SELECT Id FROM Meeting_Artifact__c WHERE CreatedDate < :cutoff)
                    AND ContentDocument.FileExtension = :FILE_EXTENSION
                    AND ContentDocument.Title LIKE :TITLE_PATTERN
                    AND ContentDocument.CreatedDate < :cutoff
                WITH SYSTEM_MODE
                ORDER BY ContentDocument.CreatedDate ASC, ContentDocumentId ASC
                LIMIT :pageSize
            ];
        }
        Datetime lastCreatedDate = lastLink.ContentDocument.CreatedDate;
        Id lastDocumentId = lastLink.ContentDocumentId;
        // Strictly after the last file: remaining links of an already-counted file are skipped.
        return [
            SELECT ContentDocumentId, ContentDocument.Id, ContentDocument.Title, ContentDocument.CreatedDate
            FROM ContentDocumentLink
            WHERE
                LinkedEntityId IN (SELECT Id FROM Meeting_Artifact__c WHERE CreatedDate < :cutoff)
                AND ContentDocument.FileExtension = :FILE_EXTENSION
                AND ContentDocument.Title LIKE :TITLE_PATTERN
                AND ContentDocument.CreatedDate < :cutoff
                AND (ContentDocument.CreatedDate > :lastCreatedDate
                OR (ContentDocument.CreatedDate = :lastCreatedDate
                AND ContentDocumentId > :lastDocumentId))
            WITH SYSTEM_MODE
            ORDER BY ContentDocument.CreatedDate ASC, ContentDocumentId ASC
            LIMIT :pageSize
        ];
    }

    private static Boolean hasQueryBudget() {
        return Limits.getQueries() < Limits.getLimitQueries();
    }

    private static Boolean isPositive(Integer value) {
        return value != null && value > 0;
    }

    /** Input from the calling flow. */
    public class Request {
        @InvocableVariable(label='Retention Days' description='Files created more than this many days ago qualify.' required=true)
        public Integer retentionDays;

        @InvocableVariable(label='Max Files' description='Most files returned per run.' required=true)
        public Integer maxFiles;

        @InvocableVariable(
            label='Max Scan'
            description='Most Meeting Artifact transcript links read per run. Default and maximum 2000.'
            required=false
        )
        public Integer maxScan;
    }

    /** Output to the calling flow. */
    public class Response {
        @InvocableVariable(label='Documents' description='Files to delete (Id, Title, CreatedDate), oldest first.')
        public List<ContentDocument> documents = new List<ContentDocument>();

        @InvocableVariable(label='Selected Count' description='Number of files returned.')
        public Integer selectedCount = 0;

        @InvocableVariable(
            label='Scanned Count'
            description='Number of Meeting Artifact transcript links read (a file linked to two artifacts counts twice).'
        )
        public Integer scannedCount = 0;

        @InvocableVariable(label='File List' description='One "Id - Title" line per file, separated by <br/>.')
        public String fileList = '';
    }
}
