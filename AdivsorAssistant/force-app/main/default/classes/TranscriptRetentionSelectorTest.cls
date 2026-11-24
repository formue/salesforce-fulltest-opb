/**
 * Tests for TranscriptRetentionSelector.
 *
 * Files are created now, so "now" is moved 30 days ahead (nowOverride) to make
 * them older than a 7-day cutoff. Test data is built by the private helpers
 * below rather than the org's TestDataFactory, which is not in this repo.
 */
@IsTest
private class TranscriptRetentionSelectorTest {
    private static final Integer RETENTION_DAYS = 7;
    private static final Integer MAX_FILES = 50;

    @IsTest
    static void shouldSelectFile_WhenLinkedToMeetingArtifact() {
        Meeting_Artifact__c artifact = createArtifacts(1)[0];
        Id documentId = createTranscript('Transcript', artifact.Id);
        ageFiles();

        Test.startTest();
        TranscriptRetentionSelector.Response response = run(RETENTION_DAYS, MAX_FILES, null);
        Test.stopTest();

        Assert.areEqual(1, response.selectedCount, 'The artifact transcript should be selected');
        Assert.areEqual(documentId, response.documents[0].Id, 'The selected file should be the artifact transcript');
        Assert.isTrue(response.fileList.contains(documentId), 'The file list should name the selected file');
    }

    @IsTest
    static void shouldSelectFile_WhenRunningUserCannotSeeIt() {
        Meeting_Artifact__c artifact = createArtifacts(1)[0];
        Id documentId = createTranscript('Transcript', artifact.Id);
        ageFiles();
        User restrictedUser = createRestrictedUser();

        TranscriptRetentionSelector.Response response;
        Test.startTest();
        System.runAs(restrictedUser) {
            response = run(RETENTION_DAYS, MAX_FILES, null);
        }
        Test.stopTest();

        Assert.areEqual(1, response.selectedCount, 'A file the running user cannot see should still be found via its artifact link');
        Assert.areEqual(documentId, response.documents[0].Id, 'The selected file should be the artifact transcript');
    }

    @IsTest
    static void shouldNotReadFile_WhenLinkedOnlyToAccountOrUser() {
        Account account = new Account(Name = 'Retention Test Account');
        insert account;
        createTranscript('Transcript', account.Id);
        // No FirstPublishLocationId: linked only to the running user.
        createTranscript('Transcript', null);
        ageFiles();

        Test.startTest();
        TranscriptRetentionSelector.Response response = run(RETENTION_DAYS, MAX_FILES, null);
        Test.stopTest();

        Assert.areEqual(0, response.selectedCount, 'Files not linked to a Meeting Artifact should be skipped');
        Assert.areEqual(0, response.scannedCount, 'Files not linked to a Meeting Artifact should not be read at all');
    }

    @IsTest
    static void shouldCountFileOnce_WhenLinkedToTwoArtifacts() {
        List<Meeting_Artifact__c> artifacts = createArtifacts(2);
        Id documentId = createTranscript('Transcript', artifacts[0].Id);
        insert new ContentDocumentLink(ContentDocumentId = documentId, LinkedEntityId = artifacts[1].Id, ShareType = 'V');
        ageFiles();

        Test.startTest();
        TranscriptRetentionSelector.Response response = run(RETENTION_DAYS, MAX_FILES, null);
        Test.stopTest();

        Assert.areEqual(1, response.selectedCount, 'A file linked to two artifacts should be counted once');
        Assert.areEqual(1, response.documents.size(), 'A file linked to two artifacts should be returned once');
        Assert.areEqual(2, response.scannedCount, 'Both artifact links should have been read');
    }

    @IsTest
    static void shouldRespectMaxFiles_WhenMoreFilesQualify() {
        Meeting_Artifact__c artifact = createArtifacts(1)[0];
        Integer maxFiles = 2;
        createTranscripts(maxFiles + 1, 'Transcript', artifact.Id);
        ageFiles();

        Test.startTest();
        TranscriptRetentionSelector.Response response = run(RETENTION_DAYS, maxFiles, null);
        Test.stopTest();

        Assert.areEqual(maxFiles, response.selectedCount, 'Selection should stop at Max Files');
        Assert.areEqual(maxFiles, response.documents.size(), 'Only Max Files documents should be returned');
    }

    @IsTest
    static void shouldReadEveryPage_WhenMoreThanOnePageQualifies() {
        Integer fileCount = TranscriptRetentionSelector.PAGE_SIZE + 1;
        Meeting_Artifact__c artifact = createArtifacts(1)[0];
        createTranscripts(fileCount, 'Transcript', artifact.Id);
        ageFiles();

        Test.startTest();
        TranscriptRetentionSelector.Response response = run(RETENTION_DAYS, fileCount + 10, null);
        Test.stopTest();

        Assert.areEqual(fileCount, response.selectedCount, 'Files on the second page should be selected');
        Assert.areEqual(fileCount, response.scannedCount, 'Both pages should have been read');
        Assert.areEqual(fileCount, new Set<ContentDocument>(response.documents).size(), 'No file should be returned twice');
    }

    @IsTest
    static void shouldStopAtMaxScan_WhenScanLimitReached() {
        Meeting_Artifact__c artifact = createArtifacts(1)[0];
        createTranscripts(4, 'Transcript', artifact.Id);
        ageFiles();

        Test.startTest();
        TranscriptRetentionSelector.Response response = run(RETENTION_DAYS, MAX_FILES, 3);
        Test.stopTest();

        Assert.areEqual(3, response.scannedCount, 'Reading should stop at Max Scan');
        Assert.areEqual(3, response.selectedCount, 'Only the files read should be selected');
    }

    @IsTest
    static void shouldReturnEmpty_WhenRetentionDaysNotPositive() {
        Meeting_Artifact__c artifact = createArtifacts(1)[0];
        createTranscript('Transcript', artifact.Id);
        ageFiles();

        Test.startTest();
        TranscriptRetentionSelector.Response response = run(0, MAX_FILES, null);
        Test.stopTest();

        Assert.areEqual(0, response.selectedCount, 'Zero retention days should select nothing');
        Assert.areEqual(0, response.scannedCount, 'Zero retention days should not read anything');
    }

    @IsTest
    static void shouldReturnEmpty_WhenMaxFilesMissing() {
        Meeting_Artifact__c artifact = createArtifacts(1)[0];
        createTranscript('Transcript', artifact.Id);
        ageFiles();

        Test.startTest();
        TranscriptRetentionSelector.Response response = run(RETENTION_DAYS, null, null);
        Test.stopTest();

        Assert.areEqual(0, response.selectedCount, 'A missing cap should select nothing');
        Assert.areEqual('', response.fileList, 'A missing cap should return an empty file list');
    }

    @IsTest
    static void shouldSkipFile_WhenNewerThanCutoff() {
        Meeting_Artifact__c artifact = createArtifacts(1)[0];
        createTranscript('Transcript', artifact.Id);
        // No ageFiles(): the file was created just now.

        Test.startTest();
        TranscriptRetentionSelector.Response response = run(RETENTION_DAYS, MAX_FILES, null);
        Test.stopTest();

        Assert.areEqual(0, response.selectedCount, 'A file newer than the cutoff should be skipped');
    }

    @IsTest
    static void shouldSkipFile_WhenTitleDoesNotMatch() {
        Meeting_Artifact__c artifact = createArtifacts(1)[0];
        createTranscript('Meeting notes', artifact.Id);
        ageFiles();

        Test.startTest();
        TranscriptRetentionSelector.Response response = run(RETENTION_DAYS, MAX_FILES, null);
        Test.stopTest();

        Assert.areEqual(0, response.selectedCount, 'A file without "Transcript" in the title should be skipped');
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    private static TranscriptRetentionSelector.Response run(Integer retentionDays, Integer maxFiles, Integer maxScan) {
        TranscriptRetentionSelector.Request request = new TranscriptRetentionSelector.Request();
        request.retentionDays = retentionDays;
        request.maxFiles = maxFiles;
        request.maxScan = maxScan;
        return TranscriptRetentionSelector.selectTranscripts(new List<TranscriptRetentionSelector.Request>{ request })[0];
    }

    /** Moves "now" ahead so files created in the test are older than the cutoff. */
    private static void ageFiles() {
        TranscriptRetentionSelector.nowOverride = Datetime.now().addDays(RETENTION_DAYS + 23);
    }

    /** A Standard User with no access to the test files (inserted in its own context to avoid mixed DML). */
    private static User createRestrictedUser() {
        Profile standardProfile = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
        String uniqueKey = String.valueOf(Crypto.getRandomInteger()).replace('-', '');
        User restrictedUser = new User(
            ProfileId = standardProfile.Id,
            LastName = 'Retention Test',
            Alias = 'rettest',
            Email = 'retention.test@example.com',
            Username = 'retention.test.' + uniqueKey + '@example.com',
            TimeZoneSidKey = 'Europe/Paris',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US'
        );
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert restrictedUser;
        }
        return restrictedUser;
    }

    private static List<Meeting_Artifact__c> createArtifacts(Integer count) {
        List<Meeting_Artifact__c> artifacts = new List<Meeting_Artifact__c>();
        for (Integer i = 0; i < count; i++) {
            artifacts.add(new Meeting_Artifact__c());
        }
        insert artifacts;
        return artifacts;
    }

    private static Id createTranscript(String title, Id linkedEntityId) {
        return createTranscripts(1, title, linkedEntityId)[0];
    }

    /** Inserts .txt files and returns their ContentDocument Ids. */
    private static List<Id> createTranscripts(Integer count, String title, Id linkedEntityId) {
        List<ContentVersion> versions = new List<ContentVersion>();
        for (Integer i = 0; i < count; i++) {
            versions.add(
                new ContentVersion(
                    Title = title,
                    PathOnClient = 'transcript.txt',
                    VersionData = Blob.valueOf('test transcript'),
                    FirstPublishLocationId = linkedEntityId
                )
            );
        }
        insert versions;
        List<Id> documentIds = new List<Id>();
        for (ContentVersion version : [
            SELECT ContentDocumentId
            FROM ContentVersion
            WHERE Id IN :new Map<Id, ContentVersion>(versions).keySet()
            ORDER BY ContentDocumentId
        ]) {
            documentIds.add(version.ContentDocumentId);
        }
        return documentIds;
    }
}
