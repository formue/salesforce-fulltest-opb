import { LightningElement, api, track, wire } from 'lwc';
import { FlowNavigationNextEvent } from 'lightning/flowSupport';
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';

// Standard Salesforce Schema
import SUST_OBJECT from '@salesforce/schema/SustainabilityPreferences__c';
import SUST_PREF_FIELD from '@salesforce/schema/SustainabilityPreferences__c.SustainabilityPreferences__c';
import ENG_STRAT_FIELD from '@salesforce/schema/SustainabilityPreferences__c.EngagementStrategy__c';
import SHARE_FIELD from '@salesforce/schema/SustainabilityPreferences__c.SustainableInvestmentsShare__c';
import IMPACTS_FIELD from '@salesforce/schema/SustainabilityPreferences__c.ImproveNegativeImpacts__c';
import THEMES_FIELD from '@salesforce/schema/SustainabilityPreferences__c.SpecificThemes__c';

export default class WealthPlanSustainabilityPrefs extends LightningElement {
    // --- INPUTS ---
    @api recordId = ''; 
    @api inputRecords = []; 
    @api backgroundColor = '#f0f9ff'; 
    @api inputIsPublished = false;

    // --- MODAL CONFIG ---
    @api useModalForEditor = false;
    @api editorModalWidth = '1000px';

    // --- AI DASHBOARD INPUTS ---
    @api showAiSection = false;
    @api defaultAccordionOpen = false;
    
    @track _isAiLoading = false;
    @track _aiInsightSummary = '';

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

    // --- TEMPLATE INPUTS FROM FLOW ---
    @api templateEnglish = ''; 
    @api templateLocal = ''; 
    @api localLanguageCode = 'NO'; 

    // --- OUTPUTS ---
    @api outputRecords = []; 
    @api outputRecordsToDelete = []; 
    @api outputAction = '';
    @api outputIsPublished = false;

    // --- DISPLAY CONTROLS ---
    @api rowsPerPage = 5; 

    // --- LOCAL STATE ---
    @track records = [];
    @track isDirty = false;
    @track isEditorView = false;
    @track currentRecord = {};
    @track isNewRecord = false;
    _originalSnapshot = null;
    _pristineMap = {};
    @track localIsPublished = false;
    @track currentPage = 1;
    @track isAiExpanded = false;
    @track isCorporateTheme = true;

    _editorRendered = false;

    // --- PICKLIST RAW DATA & FILTERED OPTIONS ---
    @track prefOptions = []; 
    
    rawStratData;
    rawShareData;
    rawImpactsData;
    rawThemesData;

    @track editorStratOptions = [];
    @track editorShareOptions = [];
    @track editorImpactOptions = [];
    @track editorThemeOptions = [];

    get dynamicBgStyle() {
        if (this.isCorporateTheme) return '';
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
    get publishCardClass() { return this.localIsPublished ? 'publish-card is-published' : 'publish-card is-draft'; }
    get isToggleDisabled() { return this.inputIsPublished === true; }
    get publishTitleText() { return this.isToggleDisabled ? 'Plan is permanently published and locked' : (this.localIsPublished ? 'Will be published upon saving' : 'Click to mark as published'); }
    
    // UI Template Getters
    get hasEnglishTemplate() { return this.templateEnglish && this.templateEnglish.trim().length > 0; }
    get hasLocalTemplate() { return this.templateLocal && this.templateLocal.trim().length > 0; }

    handlePublishToggle(event) {
        if (this.isToggleDisabled) return; 
        this.localIsPublished = event.target.checked;
        this.outputIsPublished = this.localIsPublished;
        this.isDirty = true; 
    }

    toggleAiPanel() { this.isAiExpanded = !this.isAiExpanded; }
    get chevronClass() { return this.isAiExpanded ? 'ai-chevron open' : 'ai-chevron'; }
    get aiBodyClass() { return this.isAiExpanded ? 'ai-body expanded' : 'ai-body collapsed'; }

    // ==========================================
    // METADATA WIRES (Dependent Picklist Engine)
    // ==========================================
    @wire(getObjectInfo, { objectApiName: SUST_OBJECT }) objectInfo;

    @wire(getPicklistValues, { recordTypeId: '$objectInfo.data.defaultRecordTypeId', fieldApiName: SUST_PREF_FIELD })
    wiredPref({ data }) { 
        if (data) {
            this.prefOptions = data.values.map(val => ({ label: val.label, value: val.value })); 
            this.updateDependentOptions();
        }
    }

    @wire(getPicklistValues, { recordTypeId: '$objectInfo.data.defaultRecordTypeId', fieldApiName: ENG_STRAT_FIELD })
    wiredStrat({ data }) { 
        if (data) { this.rawStratData = data; this.updateDependentOptions(); } 
    }

    @wire(getPicklistValues, { recordTypeId: '$objectInfo.data.defaultRecordTypeId', fieldApiName: SHARE_FIELD })
    wiredShare({ data }) { 
        if (data) { this.rawShareData = data; this.updateDependentOptions(); } 
    }

    @wire(getPicklistValues, { recordTypeId: '$objectInfo.data.defaultRecordTypeId', fieldApiName: IMPACTS_FIELD })
    wiredImpacts({ data }) { 
        if (data) { this.rawImpactsData = data; this.updateDependentOptions(); } 
    }

    @wire(getPicklistValues, { recordTypeId: '$objectInfo.data.defaultRecordTypeId', fieldApiName: THEMES_FIELD })
    wiredThemes({ data }) { 
        if (data) { this.rawThemesData = data; this.updateDependentOptions(); } 
    }

    updateDependentOptions() {
        const prefVal = this.currentRecord.SustainabilityPreferences__c;
        const impactVal = this.currentRecord.ImproveNegativeImpacts__c;

        this.editorStratOptions = this.filterDependentOptions(this.rawStratData, prefVal);
        this.editorShareOptions = this.filterDependentOptions(this.rawShareData, prefVal);
        this.editorImpactOptions = this.filterDependentOptions(this.rawImpactsData, prefVal);
        this.editorThemeOptions = this.filterDependentOptions(this.rawThemesData, impactVal);
    }

    filterDependentOptions(rawData, controllerValue) {
        let opts = [];
        if (rawData && rawData.controllerValues) {
            const ctrlIndex = rawData.controllerValues[controllerValue];
            if (ctrlIndex !== undefined) {
                opts = rawData.values.filter(opt => opt.validFor.includes(ctrlIndex));
            }
        } else if (rawData && rawData.values) {
            opts = rawData.values;
        }
        return opts.map(o => ({ label: o.label, value: o.value }));
    }

    // ==========================================
    // LIFECYCLE HOOKS
    // ==========================================
    connectedCallback() {
        this.isAiExpanded = this.defaultAccordionOpen;
        this.localIsPublished = this.inputIsPublished;
        this.outputIsPublished = this.localIsPublished;

        if (this.inputRecords && this.inputRecords.length > 0) {
            const cloned = JSON.parse(JSON.stringify(this.inputRecords));
            this._pristineMap = {};
            cloned.forEach(r => { if (r.Id) this._pristineMap[r.Id] = JSON.parse(JSON.stringify(r)); });
            this.records = cloned.map(rec => this.enrichData(rec));
            this.dispatchDataChanged();
        }
    }

    renderedCallback() {
        if (this.isEditorView && !this._editorRendered) {
            this._editorRendered = true;
            const ta = this.template.querySelector('.textarea-direct');
            if (ta) ta.value = this.currentRecord.AdvisorCommentPreferences__c || '';
        } else if (!this.isEditorView) {
            this._editorRendered = false; 
        }
    }

    // ==========================================
    // GETTERS & DROPDOWN MAPPERS
    // ==========================================
    get totalRecords() { return this.records.filter(r => !r.isMarkedForDeletion).length; }
    get activeRecords() { return this.records.filter(r => !r.isMarkedForDeletion && r.Active__c).length; }
    get hasRecords() { return this.records.length > 0; }
    get modalTitle() { return this.isNewRecord ? 'Create Sustainability Preference' : 'Edit Sustainability Preference'; }

    get totalPages() { return Math.ceil(this.records.length / this.rowsPerPage) || 1; }
    get paginatedData() { const start = (this.currentPage - 1) * this.rowsPerPage; return this.records.slice(start, start + this.rowsPerPage); }
    get isFirstPage() { return this.currentPage === 1; }
    get isLastPage() { return this.currentPage >= this.totalPages; }
    get showPagination() { return this.records.length > this.rowsPerPage; }
    handleNextPage() { if (!this.isLastPage) this.currentPage++; }
    handlePrevPage() { if (!this.isFirstPage) this.currentPage--; }

    get currentPrefOptions() { return this.buildOptions(this.prefOptions, this.currentRecord.SustainabilityPreferences__c, '--None--'); }
    get currentStratOptions() { return this.buildOptions(this.editorStratOptions, this.currentRecord.EngagementStrategy__c, '--None--'); }
    get currentShareOptions() { return this.buildOptions(this.editorShareOptions, this.currentRecord.SustainableInvestmentsShare__c, '--None--'); }
    get currentImpactOptions() { return this.buildOptions(this.editorImpactOptions, this.currentRecord.ImproveNegativeImpacts__c, '--None--'); }

    buildOptions(sourceOptions, currentValue, placeholder) {
        let options = [{ label: placeholder, value: '' }];
        if (sourceOptions && sourceOptions.length > 0) {
            const mappedOpts = sourceOptions.map(opt => ({ ...opt, selected: currentValue === opt.value }));
            options = [...options, ...mappedOpts];
        }
        return options;
    }

    // ==========================================
    // DATA PROCESSING
    // ==========================================
    enrichData(rec) {
        if (rec.isMarkedForDeletion) {
            rec.rowClass = 'compact-row deleted-row-highlight fade-in';
        } else {
            rec.rowClass = rec.isUnsaved ? 'compact-row unsaved-row-highlight' : 'compact-row';
        }

        const dateObj = rec.Date__c ? new Date(rec.Date__c) : null;
        rec.formattedDate = dateObj ? dateObj.toLocaleDateString('nb-NO', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';
        
        const lastModObj = rec.LastModifiedDate ? new Date(rec.LastModifiedDate) : null;
        rec.formattedLastMod = lastModObj ? lastModObj.toLocaleDateString('nb-NO', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unsaved Draft';

        rec.themesArray = rec.SpecificThemes__c ? rec.SpecificThemes__c.split(';').map(i => i.trim()).filter(i => i.length > 0) : [];
        
        return rec;
    }

    // ==========================================
    // HANDLERS
    // ==========================================
    handleFormChange(event) {
        const field = event.detail.field;
        const value = event.detail.value;
        this.currentRecord = { ...this.currentRecord, [field]: value };

        if (field === 'SustainabilityPreferences__c') {
            this.currentRecord.EngagementStrategy__c = '';
            this.currentRecord.SustainableInvestmentsShare__c = '';
            this.currentRecord.ImproveNegativeImpacts__c = '';
            this.currentRecord.SpecificThemes__c = '';
            this.currentRecord.themesArray = [];
            this.updateDependentOptions();
        } else if (field === 'ImproveNegativeImpacts__c') {
            this.currentRecord.SpecificThemes__c = '';
            this.currentRecord.themesArray = [];
            this.updateDependentOptions();
        }
    }

    handleDirectTextareaChange(event) {
        this.currentRecord = { ...this.currentRecord, [event.target.name]: event.target.value };
    }

    // --- TEMPLATE INJECTION LOGIC ---
    insertEnglishTemplate() { this.injectTextToComment(this.templateEnglish); }
    insertLocalTemplate() { this.injectTextToComment(this.templateLocal); }

    injectTextToComment(textToInject) {
        if (!textToInject) return;

        const ta = this.template.querySelector('.textarea-direct');
        let currentText = this.currentRecord.AdvisorCommentPreferences__c || '';
        
        if (currentText.trim().length > 0) {
            currentText = currentText.trimEnd() + '\n\n';
        }
        
        const newText = currentText + textToInject;
        
        // Update data model
        this.currentRecord = { ...this.currentRecord, AdvisorCommentPreferences__c: newText };
        
        // Update DOM element directly
        if (ta) {
            ta.value = newText;
        }
    }

    handleToggleChange(event) {
        this.currentRecord = { ...this.currentRecord, [event.target.dataset.field]: event.target.checked };
    }

    handleDualListChange(event) {
        const valuesArray = event.detail.value || [];
        this.currentRecord.themesArray = [...valuesArray];
        this.currentRecord.SpecificThemes__c = valuesArray.join(';');
    }

    // ==========================================
    // REACTIVE AI EVENT
    // ==========================================
    dispatchDataChanged() {
        this.dispatchEvent(new CustomEvent('datachange', {
            detail: { records: this.records }
        }));
    }

    handleAddNew() {
        this.currentRecord = {
            Name: '', Date__c: new Date().toISOString().split('T')[0], Active__c: true,
            SustainabilityPreferences__c: '', EngagementStrategy__c: '',
            SustainableInvestmentsShare__c: '', ImproveNegativeImpacts__c: '',
            SpecificThemes__c: '', themesArray: [], AdvisorCommentPreferences__c: ''
        };
        this._originalSnapshot = null;
        this.isNewRecord = true;
        this.isEditorView = true;
        this._editorRendered = false;
        this.updateDependentOptions();
    }

    handleEditRequest(event) {
        const found = this.records.find(r => r.Id === event.currentTarget.dataset.id);
        this._originalSnapshot = JSON.parse(JSON.stringify(found));
        this.currentRecord = JSON.parse(JSON.stringify(found));
        this.isNewRecord = false;
        this.isEditorView = true;
        this._editorRendered = false;
        this.updateDependentOptions();
    }

    handleCancelEdit() {
        if (!this.isNewRecord && this.currentRecord.Id) {
            const pristine = this._pristineMap[this.currentRecord.Id];
            if (pristine) {
                const index = this.records.findIndex(r => r.Id === this.currentRecord.Id);
                if (index !== -1) {
                    const restored = JSON.parse(JSON.stringify(pristine));
                    restored.isUnsaved = false; restored.isMarkedForDeletion = false;
                    this.records[index] = this.enrichData(restored);
                    this.records = [...this.records];
                }
            }
        }
        this._originalSnapshot = null;
        this.isEditorView = false;
        this.isDirty = this.records.some(r => r.isUnsaved || r.isMarkedForDeletion);
    }

    handleDeleteClick() {
        if (window.confirm('Mark for deletion? It will be removed permanently when you click "Save to Salesforce".')) {
            const index = this.records.findIndex(r => r.Id === this.currentRecord.Id);
            if (index !== -1) {
                if (this.currentRecord.Id.startsWith('NEW_')) {
                    this.records.splice(index, 1);
                } else {
                    this.records[index].isMarkedForDeletion = true;
                    this.records[index].isUnsaved = true; 
                }
                this.records = [...this.records].map(r => this.enrichData(r));
            }
            this.isEditorView = false; 
            this.isDirty = true;
            this.dispatchEvent(new CustomEvent('unsavedstatuschange', { detail: { hasUnsavedChanges: true } }));
            this.dispatchDataChanged();
        }
    }

    handleRestore(event) {
        const id = event.currentTarget.dataset.id;
        const index = this.records.findIndex(r => r.Id === id);
        if (index !== -1) {
            this.records[index].isMarkedForDeletion = false;
            this.records = [...this.records].map(r => this.enrichData(r));
            this.dispatchDataChanged();
        }
    }

    handleApplyEdit() {
        if (!this.currentRecord.Name || this.currentRecord.Name.trim() === '') {
            alert('Sustainability Preferences Name is required.');
            return;
        }

        if (!this.isNewRecord && this._originalSnapshot) {
            const fields = ['Name', 'Date__c', 'Active__c', 'SustainabilityPreferences__c', 'EngagementStrategy__c', 'SustainableInvestmentsShare__c', 'ImproveNegativeImpacts__c', 'SpecificThemes__c', 'AdvisorCommentPreferences__c'];
            const hasChanges = fields.some(f => String(this.currentRecord[f] || '') !== String(this._originalSnapshot[f] || ''));
            if (!hasChanges) { this.isEditorView = false; this._originalSnapshot = null; return; }
        }

        this.currentRecord.isUnsaved = true;
        const processed = this.enrichData(this.currentRecord);

        if (this.isNewRecord) {
            processed.Id = 'NEW_' + Date.now();
            this.records = [...this.records, processed];
        } else {
            const index = this.records.findIndex(r => r.Id === processed.Id);
            if (index !== -1) { this.records[index] = processed; this.records = [...this.records]; }
        }

        this._originalSnapshot = null;
        this.isEditorView = false;
        this.isDirty = true;
        this.dispatchEvent(new CustomEvent('unsavedstatuschange', { detail: { hasUnsavedChanges: true } }));
        this.dispatchDataChanged();
    }

    handleSaveToFlow() {
        const finalToKeep = [];
        const finalToSave = [];   // Only new + modified records for upsert
        const finalToDelete = [];

        this.records.forEach(r => {
            if (r.isMarkedForDeletion) {
                finalToDelete.push(r);
            } else {
                const wasUnsaved = r.isUnsaved;
                r.isUnsaved = false;
                const processed = this.enrichData(r);
                finalToKeep.push(processed);
                if (wasUnsaved) { finalToSave.push(processed); }
            }
        });

        this.outputRecordsToDelete = [...this.outputRecordsToDelete, ...finalToDelete];
        this.outputRecords = finalToSave;
        this.outputAction = 'SAVE';

        this.records = finalToKeep;
        this.isDirty = false;

        this.dispatchEvent(new CustomEvent('saveaction', { detail: { recordsToSave: finalToSave } }));
        this.dispatchEvent(new FlowNavigationNextEvent());
    }
}