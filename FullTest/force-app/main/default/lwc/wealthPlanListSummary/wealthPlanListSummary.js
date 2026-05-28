import { LightningElement, api, track, wire } from 'lwc';
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';
import ASSET_OBJECT from '@salesforce/schema/FinServ__AssetsAndLiabilities__c';
import AL_TYPE_FIELD from '@salesforce/schema/FinServ__AssetsAndLiabilities__c.FinServ__AssetsAndLiabilitiesType__c';
import GOAL_OBJECT from '@salesforce/schema/FinServ__FinancialGoal__c';
import FF_GOAL_FIELD from '@salesforce/schema/FinServ__FinancialGoal__c.FF_Goal__c';

const NOK = new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 });
const recordUrl = id => id && !id.startsWith('NEW_') ? `/lightning/r/${id}/view` : null;

export default class WealthPlanListSummary extends LightningElement {
    @api recordId;
    @api isPublished = false;
    @api isBusinessContext = false;
    @api investmentPrefs = {};

    _assetClassLabels = {
        moneymarket: 'Moneymarket', bonds: 'Bonds', mutualFunds: 'Mutual Funds',
        equities: 'Equities', privateEquity: 'Private Equity',
        alternativeInvestments: 'Alternative Investments', realEstate: 'Real Estate'
    };

    get investmentKnowledgeBadges() {
        const raw = this.investmentPrefs?.Asset_Class_Knowledge__c || '';
        return raw.split(';').map(v => v.trim()).filter(v => v)
            .map(v => ({ id: v, label: this._assetClassLabels[v] || v }));
    }

    get investmentExperienceBadges() {
        const raw = this.investmentPrefs?.Asset_Class_Experience__c || '';
        return raw.split(';').map(v => v.trim()).filter(v => v)
            .map(v => ({ id: v, label: this._assetClassLabels[v] || v }));
    }

    get hasInvestmentKnowledge() { return this.investmentKnowledgeBadges.length > 0; }
    get hasInvestmentExperience() { return this.investmentExperienceBadges.length > 0; }

    get sustainabilityItems() {
        return (this.sustainabilityPrefs || []).map(s => {
            const dateObj = s.Date__c ? new Date(s.Date__c) : null;
            const formattedDate = dateObj
                ? dateObj.toLocaleDateString('nb-NO', { year: 'numeric', month: 'short', day: 'numeric' })
                : '';
            const themesArray = s.SpecificThemes__c
                ? s.SpecificThemes__c.split(';').map(t => t.trim()).filter(t => t)
                : [];
            return { ...s, formattedDate, themesArray, hasThemes: themesArray.length > 0 };
        });
    }

    get hasSustainabilityPrefs() { return this.sustainabilityItems.length > 0; }

    get ownershipItems() {
        const dict = this._entityDictionary;
        return (this.ownership || []).map(o => {
            const safeOwnedId = o.Company_Owned__c ? String(o.Company_Owned__c).trim().substring(0, 15) : null;
            const safeOwnerId = o.Company_Owner__c ? String(o.Company_Owner__c).trim().substring(0, 15) : null;

            const ownedName = (safeOwnedId && dict[safeOwnedId])
                || (o.Company_Owned__r && o.Company_Owned__r.Name)
                || o.CompanyOwnedName
                || 'Unknown';
            const ownerName = (safeOwnerId && dict[safeOwnerId])
                || (o.Company_Owner__r && o.Company_Owner__r.Name)
                || o.CompanyOwnerName
                || 'Unknown';

            return {
                id: o.Id,
                url: recordUrl(o.Id),
                CompanyOwnedName: ownedName,
                CompanyOwnerName: ownerName,
                formattedPercent: o.Percentage_Owned__c != null ? `${o.Percentage_Owned__c} %` : '—',
                Beneficial_Owner__c: o.Beneficial_Owner__c === true,
                Stock_Class__c: o.Stock_Class__c || '',
                Comment__c: o.Comment__c || ''
            };
        });
    }

    get hasOwnershipItems() { return this.ownershipItems.length > 0; }

    // ── Capital Needs ────────────────────────────────────────────
    get capitalNeedsItems() {
        return (this.capitalNeeds || []).map(c => ({
            id: c.Id,
            url: recordUrl(c.Id),
            Year__c: c.Year__c || '—',
            Event__c: c.Event__c || '—',
            formattedAmount: c.Amount__c ? NOK.format(c.Amount__c) : '—'
        }));
    }
    get hasCapitalNeedsItems() { return this.capitalNeedsItems.length > 0; }

    // ── Risk & Lock-In ───────────────────────────────────────────
    get _hasRiskLockInData() {
        const s = this.capitalNeedsSummary;
        return s && (s.Risk__c || s.LockIn__c || s.Risk_Override__c || s.Lock_In_Override__c || s.RiskandLockInComment__c);
    }
    get riskLockInData() {
        const s = this.capitalNeedsSummary || {};
        return {
            risk: s.Risk__c || '—',
            lockIn: s.LockIn__c || '—',
            riskOverride: s.Risk_Override__c || '',
            lockInOverride: s.Lock_In_Override__c || '',
            comment: s.RiskandLockInComment__c || '',
            hasOverrides: !!(s.Risk_Override__c || s.Lock_In_Override__c),
            hasComment: !!s.RiskandLockInComment__c
        };
    }

    // ── Investment Strategies ────────────────────────────────────
    get investmentStrategyItems() {
        return (this.investmentStrategies || []).map(s => ({
            id: s.Id,
            url: recordUrl(s.Id),
            Name__c: s.Name__c || '—',
            TotalPortfolio__c: s.TotalPortfolio__c ? NOK.format(s.TotalPortfolio__c) : '—',
            Status__c: s.Status__c || '—',
            InvestmentProfile__c: s.InvestmentProfile__c || '—',
            ManagementType__c: s.ManagementType__c || '—',
            statusPillClass: s.Status__c === 'Active' ? 'meta-pill meta-pill-green' : 'meta-pill'
        }));
    }
    get hasInvestmentStrategyItems() { return this.investmentStrategyItems.length > 0; }

    @api goals = [];
    @api income = [];
    @api assets = [];
    @api milestones = [];
    @api ownership = [];
    @api greetings = [];
    @api sustainabilityPrefs = [];
    @api capitalNeeds = [];
    @api investmentStrategies = [];
    @api capitalNeedsSummary = {};
    @api inputCompanies = [];
    @api inputPersons = [];
    @api inputHouseholdMembers = [];
    @api inputBusinessAccounts = [];
    @api inputPrimaryMemberId = '';
    @api backgroundColor = '#f8fafc';

    get _entityDictionary() {
        const dict = {};
        const allEntities = [...(this.inputCompanies || []), ...(this.inputPersons || [])];
        allEntities.forEach(e => {
            if (e.Id && e.Name) {
                dict[String(e.Id).trim().substring(0, 15)] = e.Name;
            }
        });
        return dict;
    }

    @track isCorporateTheme = true;
    @track expandedSection = '';
    @track _assetTypeOptions = [];
    @track _goalOptions = [];

    @wire(getObjectInfo, { objectApiName: ASSET_OBJECT }) _assetObjectInfo;
    @wire(getObjectInfo, { objectApiName: GOAL_OBJECT }) _goalObjectInfo;

    @wire(getPicklistValues, { recordTypeId: '$_assetObjectInfo.data.defaultRecordTypeId', fieldApiName: AL_TYPE_FIELD })
    wiredAssetTypeValues({ data }) {
        if (data) this._assetTypeOptions = data.values.map(v => ({ label: v.label, value: v.value }));
    }

    @wire(getPicklistValues, { recordTypeId: '$_goalObjectInfo.data.defaultRecordTypeId', fieldApiName: FF_GOAL_FIELD })
    wiredGoalValues({ data }) {
        if (data) this._goalOptions = data.values.map(v => ({ label: v.label, value: v.value }));
    }

    get relationshipPersons() {
        return (this.inputHouseholdMembers || []).map(acc => {
            const isPrimary  = this.inputPrimaryMemberId &&
                String(acc.Id).substring(0, 15) === String(this.inputPrimaryMemberId).substring(0, 15);
            const nameStr    = acc.Name || 'Unknown Member';
            const role       = acc.Role__c || (isPrimary ? 'Primary Client' : 'Household Member');
            const occupation = acc.FinServ__Occupation__pc || '';
            const employer   = acc.FinServ__CurrentEmployer__pc || '';
            const age        = acc.FinServ__Age__c ? `${acc.FinServ__Age__c} yrs` : '';
            return {
                Id: acc.Id,
                Name: nameStr,
                Initials: this._initials(nameStr),
                Role: role,
                Occupation: occupation,
                hasOccupation: !!occupation,
                Employer: employer,
                hasEmployer: !!employer,
                Age: age,
                hasAge: !!age,
                subline: [role, occupation].filter(Boolean).join(' · '),
                isPrimary,
                badgeClass: isPrimary ? 'rel-badge rel-badge-primary' : 'rel-badge rel-badge-secondary'
            };
        });
    }

    get relationshipBusinesses() {
        return (this.inputBusinessAccounts || []).map(biz => {
            const nameStr  = biz.Name || 'Unknown Entity';
            const bizType  = biz.Type || (biz.RecordType && biz.RecordType.Name) || 'Holding Company';
            const industry = biz.Industry || '';
            const orgNum   = biz.AccountNumber || biz.FinServ__TaxId__c || '';
            return {
                Id: biz.Id,
                Name: nameStr,
                Initials: this._initials(nameStr),
                Type: bizType,
                Industry: industry,
                OrgNumber: orgNum,
                hasIndustry: !!industry,
                hasOrgNumber: !!orgNum,
                subline: [bizType, industry].filter(Boolean).join(' · ')
            };
        });
    }

    get hasRelPersons()    { return this.relationshipPersons.length > 0; }
    get hasRelBusinesses() { return this.relationshipBusinesses.length > 0; }

    _initials(name) {
        if (!name) return '??';
        const parts = name.trim().split(' ');
        return parts.length >= 2
            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
            : name.substring(0, 2).toUpperCase();
    }

    get sections() {
        const goalOptions = this._goalOptions;
        const assetTypeOptions = this._assetTypeOptions;
        const expand = id => ({
            isExpanded: this.expandedSection === id,
            chevronIcon: this.expandedSection === id ? 'utility:chevronup' : 'utility:chevrondown'
        });

        const goals = this.goals || [];
        const statusPillClass = s => {
            if (s === 'In Progress') return 'status-pill status-pill-progress';
            if (s === 'Completed')   return 'status-pill status-pill-complete';
            if (s === 'Not Started') return 'status-pill status-pill-pending';
            return 'status-pill status-pill-neutral';
        };
        let goalSummary = 'Add goals';
        let goalPills = null;
        if (goals.length) {
            const counts = goals.reduce((acc, g) => {
                const s = g.FinServ__Status__c || 'New';
                acc[s] = (acc[s] || 0) + 1;
                return acc;
            }, {});
            goalSummary = `${goals.length} Goals`;
            goalPills = Object.entries(counts).map(([s, n]) => ({
                label: `${n} ${s}`,
                pillClass: statusPillClass(s)
            }));
        }

        const totalEntities = (this.inputHouseholdMembers?.length || 0) + (this.inputBusinessAccounts?.length || 0);
        const relPills = [
            { label: `${this.inputHouseholdMembers?.length || 0} Members`,  pillClass: 'status-pill status-pill-progress' },
            { label: `${this.inputBusinessAccounts?.length || 0} Companies`, pillClass: 'status-pill status-pill-complete' }
        ];

        const sections = [
            {
                id: 'relationships',
                title: 'Household Relationships',
                description: 'Family members and corporate entities linked to this household.',
                icon: 'standard:hierarchy',
                status: `${totalEntities} Entities`,
                badgeClass: 'badge-neutral',
                summaryLabel: 'Current State',
                summary: `${totalEntities} Entities`,
                summaryPills: relPills,
                isRelationshipSection: true,
                items: [],
                ...expand('relationships')
            },
            {
                id: 'goals',
                title: 'Financial Goals',
                description: 'Long-term strategic objectives.',
                icon: 'standard:goals',
                status: `${goals.length} Goals`,
                badgeClass: goals.length > 0 ? 'badge-success' : 'badge-neutral',
                summary: goalSummary,
                summaryPills: goalPills,
                colMain: 'Goal Category',
                items: goals.map(g => ({
                    id: g.Id,
                    url: recordUrl(g.Id),
                    main: g.FF_Custom_Goal__c ||
                          (goalOptions.find(o => o.value === g.FF_Goal__c)?.label) ||
                          g.FF_Goal__c || g.Name || 'Unnamed Goal',
                    sub: g.FinServ__Description__c || 'Financial Goal',
                    meta: g.FinServ__Status__c || 'New'
                })),
                ...expand('goals')
            },
            {
                id: 'income',
                title: 'Income Streams',
                description: 'Salary and recurring revenue.',
                icon: 'standard:currency',
                status: 'Tracked',
                badgeClass: 'badge-neutral',
                summary: this.totalIncomeFormatted,
                items: (this.income || []).map(i => ({
                    id: i.Id,
                    url: recordUrl(i.Id),
                    main: i.Name || i.FF_Type_Other__c || 'Unnamed Income',
                    sub: i.FF_Type__c || 'Income',
                    meta: NOK.format(i.FF_Amount__c || 0)
                })),
                ...expand('income')
            },
            {
                id: 'assets',
                title: 'Assets & Liabilities',
                description: 'Composition of net wealth.',
                icon: 'standard:account',
                status: 'Overview',
                badgeClass: 'badge-success',
                summary: `${this.assets?.length || 0} items`,
                items: (this.assets || []).map(a => ({
                    id: a.Id,
                    url: recordUrl(a.Id),
                    main: a.Name,
                    sub: (assetTypeOptions.find(o => o.value === a.FinServ__AssetsAndLiabilitiesType__c)?.label) ||
                         a.FinServ__AssetsAndLiabilitiesType__c || 'Asset',
                    meta: NOK.format(a.FinServ__Amount__c || 0)
                })),
                ...expand('assets')
            },
            {
                id: 'milestones',
                title: 'Household Milestones',
                description: 'Key life events and milestones.',
                icon: 'standard:event',
                status: `${this.milestones?.length || 0} Events`,
                badgeClass: this.milestones?.length > 0 ? 'badge-success' : 'badge-neutral',
                summary: this.milestones?.length > 0 ? `${this.milestones.length} Milestones planned` : 'No milestones',
                items: (this.milestones || []).map(m => ({
                    id: m.Id,
                    url: recordUrl(m.Id),
                    main: m.Name,
                    sub: m.FF_AppDescription__c || 'Milestone',
                    meta: m.Milestone_Year__c || 'N/A'
                })),
                ...expand('milestones')
            },
            {
                id: 'ownership',
                title: 'Company Ownership',
                description: 'Business interests and corporate holdings.',
                icon: 'standard:hierarchy',
                status: `${this.ownership?.length || 0} Entities`,
                badgeClass: this.ownership?.length > 0 ? 'badge-success' : 'badge-neutral',
                summary: this.ownership?.length > 0 ? `${this.ownership.length} Companies` : 'No entities',
                isOwnershipSection: true,
                items: [],
                ...expand('ownership')
            },
            {
                id: 'sustainability',
                title: 'Sustainability Preferences',
                description: 'ESG and sustainability investment criteria.',
                icon: 'standard:environment_hub',
                status: this.sustainabilityPrefs?.length > 0 ? 'Defined' : 'Missing',
                badgeClass: this.sustainabilityPrefs?.length > 0 ? 'badge-success' : 'badge-warning',
                summaryLabel: 'Configurations',
                summary: this.sustainabilityPrefs?.length > 0
                    ? `${(this.sustainabilityPrefs || []).filter(s => s.Active__c).length} Active / ${this.sustainabilityPrefs.length} Total`
                    : 'Not specified',
                isSustainabilitySection: true,
                items: [],
                ...expand('sustainability')
            },
            {
                id: 'investments',
                title: 'Investment Preferences',
                description: 'Risk profile and asset class knowledge.',
                icon: 'standard:investment_account',
                status: this.investmentPrefs?.FF_riskProfile__c ? 'Defined' : 'Pending',
                badgeClass: this.investmentPrefs?.FF_riskProfile__c ? 'badge-success' : 'badge-neutral',
                summaryLabel: 'Risk Profile',
                summary: this.investmentPrefs?.FF_riskProfile__c || 'Not Assessed',
                isInvestmentSection: true,
                items: [],
                ...expand('investments')
            },
            {
                id: 'capitalNeeds',
                title: 'Capital Needs',
                description: 'Future events and capital requirements.',
                icon: 'standard:calibration',
                status: `${this.capitalNeeds?.length || 0} Events`,
                badgeClass: this.capitalNeeds?.length > 0 ? 'badge-success' : 'badge-neutral',
                summary: this.capitalNeeds?.length > 0 ? `${this.capitalNeeds.length} Future events` : 'No events',
                isCapitalNeedsSection: true,
                items: [],
                ...expand('capitalNeeds')
            },
            {
                id: 'riskLockIn',
                title: 'Risk & Lock-In',
                description: 'Risk tolerance and lock-in parameters.',
                icon: 'standard:metrics',
                status: this._hasRiskLockInData ? 'Configured' : 'Pending',
                badgeClass: this._hasRiskLockInData ? 'badge-success' : 'badge-neutral',
                summaryLabel: 'Current Values',
                summary: this._hasRiskLockInData
                    ? `Risk ${this.capitalNeedsSummary.Risk__c || '—'} · Lock-In ${this.capitalNeedsSummary.LockIn__c || '—'}`
                    : 'Not configured',
                isRiskLockInSection: true,
                items: [],
                ...expand('riskLockIn')
            },
            {
                id: 'investmentStrategy',
                title: 'Investment Strategy',
                description: 'Active investment strategies and allocations.',
                icon: 'standard:strategy',
                status: `${this.investmentStrategies?.length || 0} Strategies`,
                badgeClass: this.investmentStrategies?.length > 0 ? 'badge-success' : 'badge-neutral',
                summary: this.investmentStrategies?.length > 0
                    ? `${(this.investmentStrategies || []).filter(s => s.Status__c === 'Active').length} Active / ${this.investmentStrategies.length} Total`
                    : 'No strategies',
                isInvestmentStrategySection: true,
                items: [],
                ...expand('investmentStrategy')
            },
            {
                id: 'greetings',
                title: 'Personal Greeting',
                description: 'Active introduction for the plan.',
                icon: 'standard:person_account',
                status: this.greetings?.length > 0 ? 'Ready' : 'Missing',
                badgeClass: this.greetings?.length > 0 ? 'badge-success' : 'badge-warning',
                summary: this.greetings?.length > 0 ? (this.greetings[0].FF_Subject__c || 'Greeting added') : 'Draft needed',
                isGreetingSection: true,
                items: (this.greetings || []).map(g => ({
                    id: g.Id,
                    url: recordUrl(g.Id),
                    main: g.FF_Subject__c || 'Greeting',
                    sub: g.FF_personalGreeting__c || 'Personalized note',
                    meta: g.FF_Active__c ? 'Active' : 'Inactive'
                })),
                ...expand('greetings')
            }
        ];

        // Apply defaults; individual sections can override these
        return sections.map(s => ({ colMain: 'Item Name / Topic', summaryLabel: 'Current State', ...s }));
    }

    get totalIncomeFormatted() {
        return NOK.format((this.income || []).reduce((sum, i) => sum + (i.FF_Amount__c || 0), 0));
    }

    get dynamicStyle() {
        return `background-color: ${this.isCorporateTheme ? '#eeebe5' : this.backgroundColor};`;
    }
    get listSummaryWrapClass() {
        return this.isCorporateTheme ? 'dashboard-wrapper theme-corporate' : 'dashboard-wrapper';
    }
    get themePillWrapClass() {
        return this.isCorporateTheme ? 'theme-pill-toggle theme-pill-dark' : 'theme-pill-toggle';
    }
    get classicSegmentClass() {
        return this.isCorporateTheme ? 'segment-btn' : 'segment-btn segment-active';
    }
    get corporateSegmentClass() {
        return this.isCorporateTheme ? 'segment-btn segment-active' : 'segment-btn';
    }
    handleSetClassic() { this.isCorporateTheme = false; }
    handleSetCorporate() { this.isCorporateTheme = true; }

    handleToggleSection(event) {
        const sectionId = event.currentTarget.dataset.id;
        this.expandedSection = this.expandedSection === sectionId ? '' : sectionId;
    }

    handleNavigate(event) {
        event.stopPropagation();
        const sectionId = event.currentTarget.dataset.id;
        this.dispatchEvent(new CustomEvent('sectionnavigate', { detail: { section: sectionId } }));
    }
}