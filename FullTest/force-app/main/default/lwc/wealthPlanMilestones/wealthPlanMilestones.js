import { LightningElement, api, track, wire } from 'lwc';
import { FlowNavigationNextEvent } from 'lightning/flowSupport';
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';

import MILESTONE_OBJECT from '@salesforce/schema/Household_Milestones__c';
import YEAR_FIELD from '@salesforce/schema/Household_Milestones__c.Milestone_Year__c';

export default class WealthPlanMilestones extends LightningElement {
    @api recordId = ''; 
    @api inputDefaultHouseholdId = ''; 
    @api backgroundColor = '#f0f9ff'; 
    @api inputIsPublished = false;

    // --- 1. THE DICTIONARY APPROACH ---
    _inputMilestones = [];
    _inputHouseholds = [];
    householdDictionary = {}; 

    // THE FIX: Array.isArray prevents crashes if a Single Record Variable is passed instead of a Collection
    @api
    get inputMilestones() { return this._inputMilestones; }
    set inputMilestones(value) {
        if (!value) {
            this._inputMilestones = [];
        } else {
            const parsed = JSON.parse(JSON.stringify(value));
            this._inputMilestones = Array.isArray(parsed) ? parsed : [parsed];
        }
        this.processMilestones();
    }

    @api
    get inputHouseholds() { return this._inputHouseholds; }
    set inputHouseholds(value) {
        if (!value) {
            this._inputHouseholds = [];
        } else {
            const parsed = JSON.parse(JSON.stringify(value));
            this._inputHouseholds = Array.isArray(parsed) ? parsed : [parsed];
        }
        this.buildHouseholdDictionary();
        this.processMilestones(); 
    }

    buildHouseholdDictionary() {
        this.householdDictionary = {};
        if (this._inputHouseholds && this._inputHouseholds.length > 0) {
            this._inputHouseholds.forEach(h => {
                if (h.Id && h.Name) {
                    const safeId = String(h.Id).trim().substring(0, 15);
                    this.householdDictionary[safeId] = h.Name;
                }
            });
        }
    }
    
    // --- DISPLAY CONTROLS ---
    @api rowsPerPage = 5; 
    @api visibleLines = 3;

    // --- AI MODULE STATE ---
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

    // --- OUTPUTS TO FLOW ---
    @api outputMilestones = []; 
    @api outputMilestonesToDelete = []; 
    @api outputAction = '';
    @api outputIsPublished = false;

    // --- LOCAL COMPONENT STATE ---
    @track milestones = [];
    @track isDirty = false;
    @track isEditorView = false;
    @track currentMilestone = {};
    @track isNewRecord = false;
    @track localIsPublished = false;
    @track currentPage = 1;
    @track yearOptions = [];
    @track isCorporateTheme = true;

    _editorRendered = false;
    _originalSnapshot = null;
    _pristineMap = {};

    processMilestones() {
        if (!this.isDirty && this._inputMilestones && this._inputMilestones.length > 0) {
            const cloned = JSON.parse(JSON.stringify(this._inputMilestones));
            this._pristineMap = {};
            cloned.forEach(m => { if (m.Id) this._pristineMap[m.Id] = JSON.parse(JSON.stringify(m)); });
            this.milestones = cloned.map(m => this.enrichData(m));
        }
    }

    safeIdMatch(id1, id2) {
        if (!id1 || !id2) return false;
        return String(id1).trim().substring(0, 15) === String(id2).trim().substring(0, 15);
    }

    get dynamicBgStyle() {
        const extra = `; --visible-lines: ${this.visibleLines}`;
        if (this.isCorporateTheme) {
            return [
                '--component-bg-color: #eeebe5',
                '--shell-header-bg: #0d1b48',
                '--shell-header-margin: -24px -24px 0',
                '--shell-header-padding: 20px 24px 24px',
                '--shell-header-radius: 24px 24px 0 0',
                '--shell-title-color: #ffffff',
                '--shell-subtitle-color: rgba(255,255,255,0.6)',
                '--shell-btn-primary-bg: #10b981',
            ].join('; ') + extra;
        }
        return `--component-bg-color: ${this.backgroundColor};` + extra;
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

    handlePublishToggle(event) {
        if (this.isToggleDisabled) return; 
        this.localIsPublished = event.target.checked;
        this.outputIsPublished = this.localIsPublished;
        this.isDirty = true; 
    }

    toggleAiPanel() { this.isAiExpanded = !this.isAiExpanded; }
    get chevronClass() { return this.isAiExpanded ? 'ai-chevron open' : 'ai-chevron'; }
    get aiBodyClass() { return this.isAiExpanded ? 'ai-body expanded' : 'ai-body collapsed'; }

    @wire(getObjectInfo, { objectApiName: MILESTONE_OBJECT }) objectInfo;

    @wire(getPicklistValues, { recordTypeId: '$objectInfo.data.defaultRecordTypeId', fieldApiName: YEAR_FIELD })
    wiredYearValues({ data }) {
        if (data) {
            this.yearOptions = data.values.map(val => ({ label: val.label, value: val.value }));
        }
    }

    connectedCallback() {
        this.isAiExpanded = this.defaultAccordionOpen;
        this.localIsPublished = this.inputIsPublished;
        this.outputIsPublished = this.localIsPublished;
        this.processMilestones();
    }

    renderedCallback() {
        if (this.isEditorView && !this._editorRendered) {
            this._editorRendered = true;
            const textareas = this.template.querySelectorAll('.textarea-direct');
            textareas.forEach(ta => {
                const field = ta.getAttribute('name');
                ta.value = this.currentMilestone[field] || '';
            });
        } else if (!this.isEditorView) {
            this._editorRendered = false; 
        }
    }

    get totalMilestones() { return this.milestones.filter(m => !m.isMarkedForDeletion).length; }
    get hasMilestones() { return this.milestones.length > 0; }
    get modalTitle() { return this.isNewRecord ? 'Create Milestone' : 'Edit Milestone'; }

    get totalPages() { return Math.ceil(this.milestones.length / this.rowsPerPage) || 1; }
    get paginatedData() { const start = (this.currentPage - 1) * this.rowsPerPage; return this.milestones.slice(start, start + this.rowsPerPage); }
    get isFirstPage() { return this.currentPage === 1; }
    get isLastPage() { return this.currentPage >= this.totalPages; }
    get showPagination() { return this.milestones.length > this.rowsPerPage; }

    handleNextPage() { if (!this.isLastPage) this.currentPage++; }
    handlePrevPage() { if (!this.isFirstPage) this.currentPage--; }
    validateCurrentPage() { if (this.currentPage > this.totalPages) this.currentPage = this.totalPages; if (this.currentPage < 1) this.currentPage = 1; }

    get currentYearOptions() {
        return [{ label: '-- None --', value: '' }, ...this.yearOptions.map(opt => ({ ...opt, selected: this.currentMilestone.Milestone_Year__c === opt.value }))];
    }

    get currentHouseholdValue() {
        return this.currentMilestone.RelatedHousehold__c || '';
    }

    get currentHouseholdOptions() {
        let options = [{ label: '-- Select Household --', value: '' }];
        const currentValue = this.currentMilestone.RelatedHousehold__c;
        
        if (this._inputHouseholds && this._inputHouseholds.length > 0) {
            const hOptions = this._inputHouseholds.map(h => ({ 
                label: h.Name || 'Unnamed Household', 
                value: h.Id, 
                selected: this.safeIdMatch(currentValue, h.Id) 
            }));
            options = [...options, ...hOptions];
        } else if (currentValue) {
            // THE FIX: Failsafe if the Flow forgot to pass the collection. Shows the ID so it's not totally blank.
            options.push({
                label: this.currentMilestone.HouseholdName !== 'Unknown Household' ? this.currentMilestone.HouseholdName : `Unknown (${currentValue.substring(0,8)}...)`,
                value: currentValue,
                selected: true
            });
        }
        return options;
    }

    enrichData(m) {
        m.rowClass = m.isMarkedForDeletion ? 'compact-row deleted-row-highlight fade-in' : (m.isUnsaved ? 'compact-row unsaved-row-highlight' : 'compact-row');
        
        let hhName = 'Unknown Household';
        
        // 1. Direct Dictionary Lookup (Fastest & Safest)
        if (m.RelatedHousehold__c) {
            const safeId = String(m.RelatedHousehold__c).trim().substring(0, 15);
            if (this.householdDictionary[safeId]) {
                hhName = this.householdDictionary[safeId];
            }
        }
        
        // 2. Cross-Object Fallback
        if (hhName === 'Unknown Household' && m.RelatedHousehold__r && m.RelatedHousehold__r.Name) {
            hhName = m.RelatedHousehold__r.Name;
        }

        // 3. UI Memory Fallback
        if (hhName === 'Unknown Household' && m.HouseholdName) {
            hhName = m.HouseholdName;
        }

        m.HouseholdName = hhName;
        m.formattedDate = m.LastModifiedDate ? new Date(m.LastModifiedDate).toLocaleDateString('nb-NO') : 'Unsaved Draft';
        return m;
    }

    handleFormChange(event) { 
        const field = event.detail.field;
        const value = event.detail.value;
        this.currentMilestone = { ...this.currentMilestone, [field]: value }; 
        
        if (field === 'RelatedHousehold__c') {
            const safeId = value ? String(value).trim().substring(0, 15) : null;
            if (safeId && this.householdDictionary[safeId]) {
                this.currentMilestone.HouseholdName = this.householdDictionary[safeId];
            } else {
                this.currentMilestone.HouseholdName = 'Unknown Household';
            }
        }
    }
    
    handleDirectTextareaChange(event) {
        const fieldName = event.target.name; 
        this.currentMilestone = { ...this.currentMilestone, [fieldName]: event.target.value };
    }

    handleAddNew() {
        let resolvedName = 'Unknown Household';
        let defaultId = this.inputDefaultHouseholdId || '';

        if (defaultId) {
            const safeId = String(defaultId).trim().substring(0, 15);
            if (this.householdDictionary[safeId]) {
                resolvedName = this.householdDictionary[safeId];
            }
        }

        this.currentMilestone = {
            Name: '',
            Milestone_Year__c: '',
            RelatedHousehold__c: defaultId,
            FF_AdditionalAMLInfo__c: '',
            FF_AppDescription__c: '',
            HouseholdName: resolvedName
        };

        this._originalSnapshot = null;
        this.isNewRecord = true;
        this.isEditorView = true;
        this._editorRendered = false;
    }

    handleEditRequest(event) {
        const found = this.milestones.find(m => m.Id === event.currentTarget.dataset.id);
        this._originalSnapshot = JSON.parse(JSON.stringify(found));
        this.currentMilestone = JSON.parse(JSON.stringify(found));
        this.isNewRecord = false;
        this.isEditorView = true;
        this._editorRendered = false;
    }

    handleCancelEdit() {
        if (!this.isNewRecord && this.currentMilestone.Id) {
            const pristine = this._pristineMap[this.currentMilestone.Id];
            if (pristine) {
                const index = this.milestones.findIndex(m => m.Id === this.currentMilestone.Id);
                if (index !== -1) {
                    const restored = JSON.parse(JSON.stringify(pristine));
                    restored.isUnsaved = false;
                    restored.isMarkedForDeletion = false;
                    this.milestones[index] = this.enrichData(restored);
                    this.milestones = [...this.milestones];
                }
            }
        }
        this._originalSnapshot = null;
        this.isEditorView = false;
        this.isDirty = this.milestones.some(m => m.isUnsaved || m.isMarkedForDeletion);
    }

    handleDeleteClick() {
        if (window.confirm('Mark for deletion?')) {
            const index = this.milestones.findIndex(m => m.Id === this.currentMilestone.Id);
            if (index !== -1) {
                if (this.currentMilestone.Id.startsWith('NEW_')) this.milestones.splice(index, 1);
                else { this.milestones[index].isMarkedForDeletion = true; this.milestones[index].isUnsaved = true; }
                this.milestones = [...this.milestones].map(m => this.enrichData(m));
                this.validateCurrentPage();
            }
            this.isEditorView = false; 
            this.isDirty = true;
        }
    }

    handleRestore(event) {
        const id = event.currentTarget.dataset.id;
        const index = this.milestones.findIndex(m => m.Id === id);
        if (index !== -1) {
            this.milestones[index].isMarkedForDeletion = false;
            this.milestones = [...this.milestones].map(m => this.enrichData(m));
        }
    }

    handleApplyEdit() {
        if (!this.currentMilestone.Name) { alert('Name is required.'); return; }

        if (!this.isNewRecord && this._originalSnapshot) {
            const fields = ['Name', 'Milestone_Year__c', 'RelatedHousehold__c', 'FF_AdditionalAMLInfo__c', 'FF_AppDescription__c'];
            const hasChanges = fields.some(f => (this.currentMilestone[f] || '') !== (this._originalSnapshot[f] || ''));
            if (!hasChanges) {
                this.isEditorView = false;
                this._originalSnapshot = null;
                return;
            }
        }

        this.currentMilestone.isUnsaved = true;
        const processed = this.enrichData(this.currentMilestone);

        if (this.isNewRecord) {
            processed.Id = 'NEW_' + Date.now();
            this.milestones = [...this.milestones, processed];
        } else {
            const index = this.milestones.findIndex(m => m.Id === processed.Id);
            if (index !== -1) { this.milestones[index] = processed; this.milestones = [...this.milestones]; }
        }

        this._originalSnapshot = null;
        this.validateCurrentPage();
        this.isEditorView = false;
        this.isDirty = true;
    }

    handleSaveToFlow() {
        const toKeep = [];
        const toSave = [];
        const toDelete = [];

        this.milestones.forEach(m => {
            if (m.isMarkedForDeletion) toDelete.push(m);
            else {
                const unsaved = m.isUnsaved;
                m.isUnsaved = false;
                const processed = this.enrichData(m);
                toKeep.push(processed); 
                if (unsaved) toSave.push(processed); 
            }
        });

        this.outputMilestonesToDelete = [...this.outputMilestonesToDelete, ...toDelete];
        this.outputMilestones = toSave; 
        this.outputAction = 'SAVE';
        this.milestones = toKeep;
        this.isDirty = false;
        this.dispatchEvent(new FlowNavigationNextEvent());
    }
}