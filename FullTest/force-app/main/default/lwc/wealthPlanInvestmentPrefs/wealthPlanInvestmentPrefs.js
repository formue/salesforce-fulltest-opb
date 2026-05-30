import { LightningElement, api, track } from 'lwc';
import { FlowNavigationNextEvent } from 'lightning/flowSupport';

export default class WealthPlanInvestmentPrefs extends LightningElement {
    @api backgroundColor = '#f0f9ff'; 
    @api inputIsPublished = false;

    // --- REAKTIVE SETTERE ---
    _inputAccountRecord = {};
    _inputPrimaryOwnerRecord = {};

    @api
    get inputAccountRecord() { return this._inputAccountRecord; }
    set inputAccountRecord(value) {
        this._inputAccountRecord = value ? JSON.parse(JSON.stringify(value)) : {};
        this.processData();
    }

    @api
    get inputPrimaryOwnerRecord() { return this._inputPrimaryOwnerRecord; }
    set inputPrimaryOwnerRecord(value) {
        this._inputPrimaryOwnerRecord = value ? JSON.parse(JSON.stringify(value)) : {};
        this.processData();
    }

    // --- AI MODUL PARAMETERE ---
    @api showAiSection = false;
    @api defaultAccordionOpen = false;
    
    @track _isAiLoading = false;
    @track _aiInsightSummary = '';
    @track isAiExpanded = false;

    @api 
    get isAiLoading() { return this._isAiLoading; }
    set isAiLoading(value) { this._isAiLoading = value; }

    @api 
    get aiInsightSummary() { return this._aiInsightSummary; }
    set aiInsightSummary(value) {
        this._aiInsightSummary = value;
        if (value && value.trim().length > 0) {
            this._isAiLoading = false;
        }
    }

    // --- TEMPLATES ---
    @api templateEnglish = ''; 
    @api templateLocal = ''; 
    @api localLanguageCode = 'NO'; 

    // --- OUTPUTS ---
    @api outputAccountRecord = {}; 
    @api outputPrimaryOwnerRecord = {};
    @api outputAction = '';
    @api outputIsPublished = false;

    // --- LOCAL STATE ---
    @track isDirty = false;
    @track isEditorView = false;
    @track localIsPublished = false;
    @track isCorporateTheme = true;
    _pristineInvestmentData = null;
    @track investmentData = {
        knowledgeList: [], experienceList: [], comment: '',
        riskProfile: '', riskProfileDetails: '', lossAversion: '', winningAppetite: ''
    };

    @track knowledgeOptions = [
        { label: 'Moneymarket', value: 'moneymarket' },
        { label: 'Bonds', value: 'bonds' },
        { label: 'Mutual Funds', value: 'mutualFunds' },
        { label: 'Equities', value: 'equities' },
        { label: 'Private Equity', value: 'privateEquity' },
        { label: 'Alternative Investments', value: 'alternativeInvestments' },
        { label: 'Real Estate', value: 'realEstate' }
    ];

    @track experienceOptions = [
        { label: 'Moneymarket', value: 'moneymarket' },
        { label: 'Bonds', value: 'bonds' },
        { label: 'Mutual Funds', value: 'mutualFunds' },
        { label: 'Equities', value: 'equities' },
        { label: 'Private Equity', value: 'privateEquity' },
        { label: 'Alternative Investments', value: 'alternativeInvestments' },
        { label: 'Real Estate', value: 'realEstate' }
    ];

    get dynamicBgStyle() {
        if (this.isCorporateTheme) {
            return [
                '--component-bg-color: #eeebe5',
                '--shell-header-bg: #0d1b48',
                '--shell-header-margin: -24px -24px 0',
                '--shell-header-padding: 20px 24px 24px',
                '--shell-header-radius: 24px 24px 0 0',
                '--shell-title-color: #ffffff',
                '--shell-subtitle-color: rgba(255,255,255,0.6)',
                '--shell-btn-primary-bg: rgba(255,255,255,0.12)',
                '--shell-btn-border: 1.5px solid rgba(255,255,255,0.28)',
                '--shell-btn-color: #ffffff',
                `--shell-btn-anim: ${this.isDirty ? 'shellBtnGlow 2.4s ease-in-out infinite' : 'none'}`,
                '--modal-header-bg: #0d1b48',
                '--modal-title-color: #ffffff',
                '--modal-footer-bg: #eeebe5',
                '--modal-btn-bg: #0d1b48',
            ].join('; ');
        }
        return `--component-bg-color: ${this.backgroundColor};`;
    }
    get dashboardWrapperClass() {
        return this.isCorporateTheme ? 'dashboard-content-wrapper theme-corporate' : 'dashboard-content-wrapper';
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

    connectedCallback() {
        this.isAiExpanded = this.defaultAccordionOpen;
        this.localIsPublished = this.inputIsPublished;
        this.processData();
        this._pristineInvestmentData = JSON.parse(JSON.stringify(this.investmentData));
    }

    processData() {
        if (this._inputAccountRecord) {
            this.investmentData.knowledgeList = this.parseMultiSelect(this._inputAccountRecord.Asset_Class_Knowledge__c);
            this.investmentData.experienceList = this.parseMultiSelect(this._inputAccountRecord.Asset_Class_Experience__c);
            this.investmentData.comment = this._inputAccountRecord.FF_KnowledgeAndTrainingComment__c || '';
        }
        if (this._inputPrimaryOwnerRecord) {
            this.investmentData.riskProfile = this._inputPrimaryOwnerRecord.FF_riskProfile__c || '';
            this.investmentData.riskProfileDetails = this._inputPrimaryOwnerRecord.FF_riskProfileDetails__c || '';
            this.investmentData.lossAversion = this._inputPrimaryOwnerRecord.FF_lossAversionDetails__c || '';
            this.investmentData.winningAppetite = this._inputPrimaryOwnerRecord.FF_winningAppetiteDetails__c || '';
        }
    }

    parseMultiSelect(value) {
        if (!value) return [];
        return value.split(';').map(item => item.trim()).filter(i => i.length > 0);
    }

    // --- UI GETTERS ---
    get knowledgeBadges() { 
        return this.investmentData.knowledgeList.map(k => {
            const opt = this.knowledgeOptions.find(o => o.value === k);
            return { id: k, label: opt ? opt.label : k };
        }); 
    }
    get experienceBadges() { 
        return this.investmentData.experienceList.map(e => {
            const opt = this.experienceOptions.find(o => o.value === e);
            return { id: e, label: opt ? opt.label : e };
        }); 
    }
    get hasKnowledge() { return this.knowledgeBadges.length > 0; }
    get hasExperience() { return this.experienceBadges.length > 0; }
    get displayRiskProfile() { return this.investmentData.riskProfile || 'Not Assessed'; }
    get knowledgeCount() { return this.investmentData.knowledgeList.length; }
    get experienceCount() { return this.investmentData.experienceList.length; }

    toggleAiPanel() { this.isAiExpanded = !this.isAiExpanded; }
    get chevronClass() { return this.isAiExpanded ? 'ai-chevron open' : 'ai-chevron'; }
    get aiBodyClass() { return this.isAiExpanded ? 'ai-body expanded' : 'ai-body collapsed'; }
    get publishCardClass() { return this.localIsPublished ? 'publish-card is-published' : 'publish-card is-draft'; }
    get isToggleDisabled() { return this.inputIsPublished === true; }
    get publishTitleText() { return this.isToggleDisabled ? 'Plan is permanently published and locked' : (this.localIsPublished ? 'Will be published upon saving' : 'Click to mark as published'); }

    // --- EVENT HANDLERS ---
    handlePublishToggle(event) {
        if (this.isToggleDisabled) return; 
        this.localIsPublished = event.target.checked;
        this.outputIsPublished = this.localIsPublished;
        this.isDirty = true; 
        this.dispatchEvent(new CustomEvent('unsavedstatuschange', { detail: { hasUnsavedChanges: true } }));
    }

    handleEditRequest() {
        this._snapshotBeforeEdit = JSON.parse(JSON.stringify(this.investmentData));
        this.isEditorView = true;
    }

    handleCancelEdit() {
        // Revert to pristine original from inputGoals
        if (this._pristineInvestmentData) {
            this.investmentData = JSON.parse(JSON.stringify(this._pristineInvestmentData));
        }
        this.isEditorView = false;
        this.isDirty = false;
    }

    handleFormChange(event) {
        this.investmentData[event.detail.field] = event.detail.value;
    }

    handleDualListChange(event) {
        const field = event.target.dataset.field;
        this.investmentData[field] = event.detail.value;
    }

    handleApplyEdit() {
        // Check if anything actually changed
        if (this._snapshotBeforeEdit) {
            const snap = this._snapshotBeforeEdit;
            const cur = this.investmentData;
            const unchanged =
                JSON.stringify(cur.knowledgeList) === JSON.stringify(snap.knowledgeList) &&
                JSON.stringify(cur.experienceList) === JSON.stringify(snap.experienceList) &&
                cur.comment === snap.comment &&
                cur.riskProfile === snap.riskProfile &&
                cur.riskProfileDetails === snap.riskProfileDetails &&
                cur.lossAversion === snap.lossAversion &&
                cur.winningAppetite === snap.winningAppetite;
            if (unchanged) { this.isEditorView = false; return; }
        }
        this.isEditorView = false;
        this.isDirty = true;
        this.dispatchEvent(new CustomEvent('unsavedstatuschange', { detail: { hasUnsavedChanges: true } }));
    }

    handleSaveToFlow() {
        this.outputAccountRecord = {
            ...this._inputAccountRecord,
            Asset_Class_Knowledge__c: this.investmentData.knowledgeList.join(';'),
            Asset_Class_Experience__c: this.investmentData.experienceList.join(';'),
            FF_KnowledgeAndTrainingComment__c: this.investmentData.comment
        };
        this.outputPrimaryOwnerRecord = {
            ...this._inputPrimaryOwnerRecord,
            FF_riskProfile__c: this.investmentData.riskProfile,
            FF_riskProfileDetails__c: this.investmentData.riskProfileDetails,
            FF_lossAversionDetails__c: this.investmentData.lossAversion,
            FF_winningAppetiteDetails__c: this.investmentData.winningAppetite
        };
        this.outputAction = 'SAVE';
        this.isDirty = false;
        this.dispatchEvent(new FlowNavigationNextEvent());
    }
}