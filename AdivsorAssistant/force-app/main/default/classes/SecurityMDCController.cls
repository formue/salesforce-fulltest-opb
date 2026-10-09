public with sharing class SecurityMDCController {

    static final Integer QUALITY_FIELD_COUNT = 10;

    // ─── wrappers ────────────────────────────────────────────────────────────

    public class OverviewMetrics {
        @AuraEnabled public Integer totalCount;
        @AuraEnabled public Integer openActionCount;
        @AuraEnabled public Integer highPriorityCount;
        @AuraEnabled public Integer avgCompleteness;
        @AuraEnabled public List<FieldCompleteness> fieldCompleteness;
    }

    public class FieldCompleteness {
        @AuraEnabled public String fieldApiName;
        @AuraEnabled public String fieldLabel;
        @AuraEnabled public Integer missingCount;
        @AuraEnabled public Integer completenessScore;
        public FieldCompleteness(String api, String lbl, Integer missing, Integer total) {
            this.fieldApiName       = api;
            this.fieldLabel         = lbl;
            this.missingCount       = missing;
            this.completenessScore  = total == 0 ? 100 : (Integer) (((total - missing) * 100.0) / total);
        }
    }

    public class SecurityWrapper {
        @AuraEnabled public Id        id;
        @AuraEnabled public String    securityName;
        @AuraEnabled public String    isin;
        @AuraEnabled public String    symbol;
        @AuraEnabled public String    securityId;
        @AuraEnabled public String    cusip;
        @AuraEnabled public String    securitiesName;
        @AuraEnabled public String    sourceSystemId;
        @AuraEnabled public String    assetClassCode;
        @AuraEnabled public String    assetClass;
        @AuraEnabled public String    assetCategory;
        @AuraEnabled public String    assetCategoryName;
        @AuraEnabled public String    exchange;
        @AuraEnabled public String    classificationNO;
        @AuraEnabled public String    classificationSE;
        @AuraEnabled public String    classificationDK;
        @AuraEnabled public String    classificationNordnet;
        @AuraEnabled public String    classificationFIFO;
        @AuraEnabled public String    classificationWisetalk;
        @AuraEnabled public Decimal   price;
        @AuraEnabled public Date      lastUpdated;
        @AuraEnabled public Id        implementationPlanId;
        @AuraEnabled public String    implementationPlanName;
        @AuraEnabled public Decimal   percentage;
        @AuraEnabled public Id        ownerId;
        @AuraEnabled public String    ownerName;
        @AuraEnabled public Datetime  lastModifiedDate;
        @AuraEnabled public Datetime  createdDate;
        @AuraEnabled public Integer   completenessScore;
        @AuraEnabled public Integer   openActionCount;
        @AuraEnabled public List<SecurityCost__c> costs;
    }

    public class ActionItem {
        @AuraEnabled public Id     taskId;
        @AuraEnabled public String subject;
        @AuraEnabled public String priority;
        @AuraEnabled public Date   activityDate;
        @AuraEnabled public String status;
        @AuraEnabled public String description;
        @AuraEnabled public Id     securityId;
        @AuraEnabled public String securityName;
        @AuraEnabled public String assigneeName;
    }

    // ─── public methods ───────────────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static OverviewMetrics getSecuritiesOverview(String typeFilter) {
        List<FinServ__Securities__c> secs = querySecurities(typeFilter, null);

        Set<Id> secIds = new Set<Id>();
        for (FinServ__Securities__c s : secs) secIds.add(s.Id);

        Integer openActions  = 0;
        Integer highPriority = 0;
        if (!secIds.isEmpty()) {
            for (Task t : [SELECT Priority FROM Task
                           WHERE WhatId IN :secIds AND IsClosed = false
                           WITH USER_MODE]) {
                openActions++;
                if (t.Priority == 'High') highPriority++;
            }
        }

        Integer mIsin = 0, mSymbol = 0, mSecId = 0, mCode = 0, mClass = 0;
        Integer mNO   = 0, mSE    = 0, mDK    = 0, mNordnet = 0, mPrice = 0;
        Integer totalScore = 0;

        for (FinServ__Securities__c s : secs) {
            if (String.isBlank(s.ISIN__c))                  mIsin++;
            if (String.isBlank(s.Symbol__c))                mSymbol++;
            if (String.isBlank(s.FinServ__SecurityId__c))   mSecId++;
            if (String.isBlank(s.AssetClassCode__c))        mCode++;
            if (String.isBlank(s.FinServ__AssetClass__c))   mClass++;
            if (String.isBlank(s.ClassificationNO__c))      mNO++;
            if (String.isBlank(s.ClassificationSE__c))      mSE++;
            if (String.isBlank(s.ClassificationDK__c))      mDK++;
            if (String.isBlank(s.ClassificationNordnet__c)) mNordnet++;
            if (s.FinServ__Price__c == null)                 mPrice++;
            totalScore += computeScore(s);
        }

        Integer total = secs.size();
        OverviewMetrics m      = new OverviewMetrics();
        m.totalCount           = total;
        m.openActionCount      = openActions;
        m.highPriorityCount    = highPriority;
        m.avgCompleteness      = total == 0 ? 100 : (totalScore / total);
        m.fieldCompleteness    = new List<FieldCompleteness>{
            new FieldCompleteness('ISIN__c',                  'ISIN',               mIsin,    total),
            new FieldCompleteness('Symbol__c',                'Symbol',             mSymbol,  total),
            new FieldCompleteness('FinServ__SecurityId__c',   'Security ID',        mSecId,   total),
            new FieldCompleteness('AssetClassCode__c',        'Asset Class Code',   mCode,    total),
            new FieldCompleteness('FinServ__AssetClass__c',   'Asset Class',        mClass,   total),
            new FieldCompleteness('ClassificationNO__c',      'Classification NO',  mNO,      total),
            new FieldCompleteness('ClassificationSE__c',      'Classification SE',  mSE,      total),
            new FieldCompleteness('ClassificationDK__c',      'Classification DK',  mDK,      total),
            new FieldCompleteness('ClassificationNordnet__c', 'Classification Nordnet', mNordnet, total),
            new FieldCompleteness('FinServ__Price__c',        'Price',              mPrice,   total)
        };
        return m;
    }

    @AuraEnabled(cacheable=true)
    public static List<SecurityWrapper> getSecuritiesList(String searchTerm, String typeFilter) {
        List<FinServ__Securities__c> secs = querySecurities(typeFilter, searchTerm);

        Set<Id> secIds = new Set<Id>();
        for (FinServ__Securities__c s : secs) secIds.add(s.Id);

        Map<Id, Integer> actionCounts = new Map<Id, Integer>();
        if (!secIds.isEmpty()) {
            for (Task t : [SELECT WhatId FROM Task
                           WHERE WhatId IN :secIds AND IsClosed = false
                           WITH USER_MODE]) {
                Id wid  = (Id) t.WhatId;
                actionCounts.put(wid, (actionCounts.containsKey(wid) ? actionCounts.get(wid) : 0) + 1);
            }
        }

        List<SecurityWrapper> result = new List<SecurityWrapper>();
        for (FinServ__Securities__c s : secs) {
            SecurityWrapper w  = toWrapper(s);
            w.openActionCount  = actionCounts.containsKey(s.Id) ? actionCounts.get(s.Id) : 0;
            result.add(w);
        }
        return result;
    }

    @AuraEnabled(cacheable=true)
    public static SecurityWrapper getSecurityDetail(Id securityId) {
        List<FinServ__Securities__c> secs = [
            SELECT Id, Name, Security_Name__c, ISIN__c, Symbol__c,
                   FinServ__SecuritiesName__c, FinServ__SecurityId__c, FinServ__SourceSystemId__c,
                   FinServ__CUSIP__c, AssetClassCode__c, FinServ__AssetCategory__c,
                   FinServ__AssetCategoryName__c, FinServ__AssetClass__c, FinServ__Exchange__c,
                   ClassificationNO__c, ClassificationSE__c, ClassificationDK__c,
                   ClassificationNordnet__c, ClassificationFIFO__c, ClassificationWisetalk__c,
                   FinServ__Price__c, FinServ__LastUpdated__c,
                   ImplementationPlan__c, ImplementationPlan__r.Name,
                   Percentage__c, OwnerId, Owner.Name,
                   CreatedDate, LastModifiedDate
            FROM FinServ__Securities__c
            WHERE Id = :securityId
            WITH USER_MODE
            LIMIT 1
        ];
        if (secs.isEmpty()) throw new AuraHandledException('Security record not found.');

        SecurityWrapper w = toWrapper(secs[0]);
        w.openActionCount = [SELECT COUNT() FROM Task
                             WHERE WhatId = :securityId AND IsClosed = false
                             WITH USER_MODE];
        w.costs = [SELECT Id, Country__c, YearOne__c, YearTwo__c, YearThree__c, SourceSystemId__c
                   FROM SecurityCost__c
                   WHERE Security__c = :securityId
                   WITH USER_MODE
                   ORDER BY Country__c ASC NULLS LAST];
        return w;
    }

    @AuraEnabled(cacheable=true)
    public static List<ActionItem> getDataQualityActions(String securityId) {
        List<Task> tasks;
        if (String.isNotBlank(securityId)) {
            tasks = [SELECT Id, Subject, Priority, ActivityDate, Status, Description, WhatId, Owner.Name
                     FROM Task
                     WHERE WhatId = :securityId AND IsClosed = false
                     WITH USER_MODE
                     ORDER BY ActivityDate ASC NULLS LAST];
        } else {
            // Polymorphic WhatId does not support SOQL semi-joins; load IDs first
            List<Id> allSecIds = new List<Id>();
            for (FinServ__Securities__c s : [SELECT Id FROM FinServ__Securities__c
                                              WITH USER_MODE LIMIT 2000]) {
                allSecIds.add(s.Id);
            }
            tasks = allSecIds.isEmpty()
                ? new List<Task>()
                : [SELECT Id, Subject, Priority, ActivityDate, Status, Description, WhatId, Owner.Name
                   FROM Task
                   WHERE WhatId IN :allSecIds AND IsClosed = false
                   WITH USER_MODE
                   ORDER BY ActivityDate ASC NULLS LAST
                   LIMIT 500];
        }

        Set<Id> secIds = new Set<Id>();
        for (Task t : tasks) if (t.WhatId != null) secIds.add((Id) t.WhatId);

        Map<Id, String> nameMap = new Map<Id, String>();
        if (!secIds.isEmpty()) {
            for (FinServ__Securities__c s : [SELECT Id, Security_Name__c FROM FinServ__Securities__c
                                              WHERE Id IN :secIds WITH USER_MODE]) {
                nameMap.put(s.Id, s.Security_Name__c);
            }
        }

        List<ActionItem> result = new List<ActionItem>();
        for (Task t : tasks) {
            ActionItem a    = new ActionItem();
            a.taskId        = t.Id;
            a.subject       = t.Subject;
            a.priority      = t.Priority;
            a.activityDate  = t.ActivityDate;
            a.status        = t.Status;
            a.description   = t.Description;
            a.securityId    = (Id) t.WhatId;
            a.securityName  = nameMap.containsKey((Id) t.WhatId) ? nameMap.get((Id) t.WhatId) : '';
            a.assigneeName  = t.Owner != null ? t.Owner.Name : '';
            result.add(a);
        }
        return result;
    }

    @AuraEnabled
    public static void updateSecurityField(Id securityId, String fieldApiName,
                                           String newValue, Id closeActionId) {
        try {
            Schema.DescribeFieldResult dfr = Schema.getGlobalDescribe()
                .get('FinServ__Securities__c').getDescribe()
                .fields.getMap().get(fieldApiName).getDescribe();
            SObject sec = Schema.getGlobalDescribe()
                .get('FinServ__Securities__c').newSObject(securityId);

            Schema.DisplayType dt = dfr.getType();
            if (dt == Schema.DisplayType.CURRENCY || dt == Schema.DisplayType.DOUBLE
                    || dt == Schema.DisplayType.PERCENT || dt == Schema.DisplayType.INTEGER) {
                sec.put(fieldApiName, String.isBlank(newValue) ? null : Decimal.valueOf(newValue));
            } else if (dt == Schema.DisplayType.DATE) {
                sec.put(fieldApiName, String.isBlank(newValue) ? null : Date.valueOf(newValue));
            } else if (dt == Schema.DisplayType.BOOLEAN) {
                sec.put(fieldApiName, newValue == 'true');
            } else {
                sec.put(fieldApiName, String.isBlank(newValue) ? null : newValue);
            }
            SObjectAccessDecision sad = Security.stripInaccessible(
                AccessType.UPDATABLE, new List<SObject>{ sec });
            update sad.getRecords();

            if (closeActionId != null) {
                Task t = new Task(Id = closeActionId, Status = 'Completed');
                SObjectAccessDecision taskSad = Security.stripInaccessible(
                    AccessType.UPDATABLE, new List<SObject>{ t });
                update taskSad.getRecords();
            }
        } catch (Exception e) {
            throw new AuraHandledException('Error updating field: ' + e.getMessage());
        }
    }

    @AuraEnabled
    public static Id createDataQualityAction(Id securityId, String fieldLabel,
                                             String fieldApiName, String priority) {
        try {
            String p   = String.isNotBlank(priority) ? priority : 'Normal';
            Task t     = new Task(
                Subject      = 'Missing ' + fieldLabel,
                WhatId       = securityId,
                Priority     = p,
                Status       = 'Open',
                ActivityDate = p == 'High' ? Date.today().addDays(7) : Date.today().addDays(14),
                Description  = 'Field: ' + fieldApiName
            );
            SObjectAccessDecision sad = Security.stripInaccessible(
                AccessType.CREATABLE, new List<SObject>{ t });
            insert sad.getRecords();
            return sad.getRecords()[0].Id;
        } catch (Exception e) {
            throw new AuraHandledException('Error creating action: ' + e.getMessage());
        }
    }

    @AuraEnabled
    public static void completeAction(Id taskId) {
        try {
            Task t = new Task(Id = taskId, Status = 'Completed');
            SObjectAccessDecision sad = Security.stripInaccessible(
                AccessType.UPDATABLE, new List<SObject>{ t });
            update sad.getRecords();
        } catch (Exception e) {
            throw new AuraHandledException('Error completing action: ' + e.getMessage());
        }
    }

    // ─── private helpers ─────────────────────────────────────────────────────

    private static final String BASE_SOQL =
        'SELECT Id, Name, Security_Name__c, ISIN__c, Symbol__c, '
        + 'FinServ__SecuritiesName__c, FinServ__SecurityId__c, FinServ__SourceSystemId__c, '
        + 'FinServ__CUSIP__c, AssetClassCode__c, FinServ__AssetCategory__c, '
        + 'FinServ__AssetCategoryName__c, FinServ__AssetClass__c, FinServ__Exchange__c, '
        + 'ClassificationNO__c, ClassificationSE__c, ClassificationDK__c, '
        + 'ClassificationNordnet__c, ClassificationFIFO__c, ClassificationWisetalk__c, '
        + 'FinServ__Price__c, FinServ__LastUpdated__c, '
        + 'ImplementationPlan__c, ImplementationPlan__r.Name, '
        + 'Percentage__c, OwnerId, Owner.Name, '
        + 'CreatedDate, LastModifiedDate '
        + 'FROM FinServ__Securities__c';

    private static List<FinServ__Securities__c> querySecurities(String typeFilter, String searchTerm) {
        String likeVal = String.isNotBlank(searchTerm)
            ? '%' + String.escapeSingleQuotes(searchTerm) + '%'
            : null;
        Boolean hasType   = String.isNotBlank(typeFilter);
        Boolean hasSearch = likeVal != null;

        String soql = BASE_SOQL;
        List<String> conds = new List<String>();
        if (hasType)   conds.add('AssetClassCode__c = :typeFilter');
        if (hasSearch) conds.add('(Security_Name__c LIKE :likeVal OR ISIN__c LIKE :likeVal OR Symbol__c LIKE :likeVal)');
        if (!conds.isEmpty()) soql += ' WHERE ' + String.join(conds, ' AND ');
        soql += ' WITH USER_MODE ORDER BY Security_Name__c ASC NULLS LAST LIMIT 2000';
        return Database.query(soql);
    }

    private static Integer computeScore(FinServ__Securities__c s) {
        Integer n = 0;
        if (String.isNotBlank(s.ISIN__c))                  n++;
        if (String.isNotBlank(s.Symbol__c))                n++;
        if (String.isNotBlank(s.FinServ__SecurityId__c))   n++;
        if (String.isNotBlank(s.AssetClassCode__c))        n++;
        if (String.isNotBlank(s.FinServ__AssetClass__c))   n++;
        if (String.isNotBlank(s.ClassificationNO__c))      n++;
        if (String.isNotBlank(s.ClassificationSE__c))      n++;
        if (String.isNotBlank(s.ClassificationDK__c))      n++;
        if (String.isNotBlank(s.ClassificationNordnet__c)) n++;
        if (s.FinServ__Price__c != null)                   n++;
        return (n * 100) / QUALITY_FIELD_COUNT;
    }

    private static SecurityWrapper toWrapper(FinServ__Securities__c s) {
        SecurityWrapper w        = new SecurityWrapper();
        w.id                     = s.Id;
        w.securityName           = s.Security_Name__c;
        w.isin                   = s.ISIN__c;
        w.symbol                 = s.Symbol__c;
        w.securityId             = s.FinServ__SecurityId__c;
        w.cusip                  = s.FinServ__CUSIP__c;
        w.securitiesName         = s.FinServ__SecuritiesName__c;
        w.sourceSystemId         = s.FinServ__SourceSystemId__c;
        w.assetClassCode         = s.AssetClassCode__c;
        w.assetClass             = s.FinServ__AssetClass__c;
        w.assetCategory          = s.FinServ__AssetCategory__c;
        w.assetCategoryName      = s.FinServ__AssetCategoryName__c;
        w.exchange               = s.FinServ__Exchange__c;
        w.classificationNO       = s.ClassificationNO__c;
        w.classificationSE       = s.ClassificationSE__c;
        w.classificationDK       = s.ClassificationDK__c;
        w.classificationNordnet  = s.ClassificationNordnet__c;
        w.classificationFIFO     = s.ClassificationFIFO__c;
        w.classificationWisetalk = s.ClassificationWisetalk__c;
        w.price                  = s.FinServ__Price__c;
        w.lastUpdated            = s.FinServ__LastUpdated__c;
        w.implementationPlanId   = s.ImplementationPlan__c;
        w.implementationPlanName = s.ImplementationPlan__r != null ? s.ImplementationPlan__r.Name : null;
        w.percentage             = s.Percentage__c;
        w.ownerId                = s.OwnerId;
        w.ownerName              = s.Owner != null ? s.Owner.Name : null;
        w.lastModifiedDate       = s.LastModifiedDate;
        w.createdDate            = s.CreatedDate;
        w.completenessScore      = computeScore(s);
        w.openActionCount        = 0;
        w.costs                  = new List<SecurityCost__c>();
        return w;
    }
}
