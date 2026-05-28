import { LightningElement, api, track, wire } from 'lwc';
import { FlowNavigationNextEvent } from 'lightning/flowSupport';
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';
import LightningConfirm from 'lightning/confirm';
import LightningAlert from 'lightning/alert';

import OWNERSHIP_OBJECT from '@salesforce/schema/Company_Ownership__c';
import STOCK_CLASS_FIELD from '@salesforce/schema/Company_Ownership__c.Stock_Class__c';

export default class WealthPlanCompanyOwnership extends LightningElement {
    @api recordId = ''; 
    @api backgroundColor = '#f0f9ff'; 
    @api inputIsPublished = false;
    @api inputEntities = []; 
    @api availableActions = [];

    // --- LEGACY FIELDS TO PREVENT DEPLOYMENT CRASH ---
    @api inputCompanyOwnedField = '';
    @api inputCompanyOwnerField = '';
    @api outputOwnerships = [];

    _inputOwnerships = [];
    _inputCompanies = [];
    _inputPersons = [];
    entityDictionary = {}; 

    @api
    get inputOwnerships() { return this._inputOwnerships; }
    set inputOwnerships(value) {
        if (!value) {
            this._inputOwnerships = [];
        } else {
            const parsed = JSON.parse(JSON.stringify(value));
            this._inputOwnerships = Array.isArray(parsed) ? parsed : [parsed];
        }
        this.processOwnerships();
    }

    @api
    get inputCompanies() { return this._inputCompanies; }
    set inputCompanies(value) {
        if (!value) {
            this._inputCompanies = [];
        } else {
            const parsed = JSON.parse(JSON.stringify(value));
            this._inputCompanies = Array.isArray(parsed) ? parsed : [parsed];
        }
        this.buildEntityDictionary();
        this.processOwnerships(); 
    }

    @api
    get inputPersons() { return this._inputPersons; }
    set inputPersons(value) {
        if (!value) {
            this._inputPersons = [];
        } else {
            const parsed = JSON.parse(JSON.stringify(value));
            this._inputPersons = Array.isArray(parsed) ? parsed : [parsed];
        }
        this.buildEntityDictionary();
        this.processOwnerships(); 
    }

    buildEntityDictionary() {
        this.entityDictionary = {};
        const allEntities = [...this._inputCompanies, ...this._inputPersons];
        
        if (allEntities.length > 0) {
            allEntities.forEach(e => {
                if (e.Id && e.Name) {
                    const safeId = String(e.Id).trim().substring(0, 15);
                    this.entityDictionary[safeId] = e.Name;
                }
            });
        }
    }
    
    @api rowsPerPage = 5; 
    @api visibleLines = 3;

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

    // --- CLEANED UP OUTPUT VARIABLES ---
    @api outputOwnershipsToUpsert = []; 
    @api outputOwnershipsToDelete = []; 

    // --- JSON STRING FALLBACKS (The simplest output method) ---
    @api outputUpsertJSON = '';
    @api outputDeleteJSON = '';

    // --- LEGACY OUTPUT VARIABLES (DO NOT REMOVE, PREVENTS FLOW CRASH) ---
    @api outputRecordsToCreate = []; 
    @api outputRecordsToUpdate = []; 
    @api outputRecordsToDelete = []; 
    @api outputCreateJSON = '';
    @api outputUpdateJSON = '';

    @api outputAction = '';
    @api outputIsPublished = false;

    @track ownerships = [];
    @track isDirty = false;
    @track isEditorView = false;
    @track currentOwnership = {};
    @track isNewRecord = false;
    @track localIsPublished = false; 
    @track currentPage = 1;
    @track stockClassOptions = [];

    _editorRendered = false;
    _originalSnapshot = null;
    _pristineMap = {};

    processOwnerships() {
        if (!this.isDirty && this._inputOwnerships && this._inputOwnerships.length > 0) {
            const cloned = JSON.parse(JSON.stringify(this._inputOwnerships));
            this._pristineMap = {};
            cloned.forEach(o => { if (o.Id) this._pristineMap[o.Id] = JSON.parse(JSON.stringify(o)); });
            this.ownerships = cloned.map(o => this.enrichData(o));
        }
    }

    safeIdMatch(id1, id2) {
        if (!id1 || !id2) return false;
        return String(id1).trim().substring(0, 15) === String(id2).trim().substring(0, 15);
    }

    get dynamicBgStyle() { return `--component-bg-color: ${this.backgroundColor}; --visible-lines: ${this.visibleLines};`; }
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

    @wire(getObjectInfo, { objectApiName: OWNERSHIP_OBJECT }) objectInfo;

    @wire(getPicklistValues, { recordTypeId: '$objectInfo.data.defaultRecordTypeId', fieldApiName: STOCK_CLASS_FIELD })
    wiredStockClass({ data }) {
        if (data) {
            this.stockClassOptions = data.values.map(val => ({ label: val.label, value: val.value }));
        }
    }

    connectedCallback() {
        this.isAiExpanded = this.defaultAccordionOpen;
        this.localIsPublished = this.inputIsPublished;
        this.outputIsPublished = this.localIsPublished;
        this.processOwnerships();
    }

    renderedCallback() {
        if (this.isEditorView && !this._editorRendered) {
            this._editorRendered = true;
            const ta = this.template.querySelector('.textarea-direct');
            if (ta) ta.value = this.currentOwnership.Comment__c || '';
        } else if (!this.isEditorView) {
            this._editorRendered = false; 
        }
    }

    get totalOwnerships() { return this.ownerships.filter(o => !o.isMarkedForDeletion).length; }
    get hasOwnerships() { return this.ownerships.length > 0; }
    get modalTitle() { return this.isNewRecord ? 'Add Ownership' : 'Edit Ownership'; }

    get totalPages() { return Math.ceil(this.ownerships.length / this.rowsPerPage) || 1; }
    get paginatedData() { const start = (this.currentPage - 1) * this.rowsPerPage; return this.ownerships.slice(start, start + this.rowsPerPage); }
    get isFirstPage() { return this.currentPage === 1; }
    get isLastPage() { return this.currentPage >= this.totalPages; }
    get showPagination() { return this.ownerships.length > this.rowsPerPage; }

    get currentCompanyOwnedOptions() {
        let options = [{ label: '-- Select Company --', value: '' }];
        const currentValue = this.currentOwnership.Company_Owned__c;
        
        if (this._inputCompanies && this._inputCompanies.length > 0) {
            const compOptions = this._inputCompanies.map(c => ({ 
                label: c.Name || 'Unnamed Company', 
                value: c.Id, 
                selected: this.safeIdMatch(currentValue, c.Id) 
            }));
            options = [...options, ...compOptions];
        } else if (currentValue) {
            options.push({ label: this.currentOwnership.CompanyOwnedName !== 'Unknown' ? this.currentOwnership.CompanyOwnedName : `Unknown (${String(currentValue).substring(0,8)}...)`, value: currentValue, selected: true });
        }
        return options;
    }

    get currentCompanyOwnerOptions() {
        let options = [{ label: '-- Select Owner --', value: '' }];
        const currentValue = this.currentOwnership.Company_Owner__c;
        const allEntities = [...this._inputPersons, ...this._inputCompanies];
        
        if (allEntities && allEntities.length > 0) {
            const ownerOptions = allEntities.map(e => ({ 
                label: e.Name || 'Unnamed Owner', 
                value: e.Id, 
                selected: this.safeIdMatch(currentValue, e.Id) 
            }));
            options = [...options, ...ownerOptions];
        } else if (currentValue) {
            options.push({ label: this.currentOwnership.CompanyOwnerName !== 'Unknown' ? this.currentOwnership.CompanyOwnerName : `Unknown (${String(currentValue).substring(0,8)}...)`, value: currentValue, selected: true });
        }
        return options;
    }

    get currentStockClassOptions() {
        return [{ label: '-- None --', value: '' }, ...this.stockClassOptions.map(opt => ({ ...opt, selected: this.currentOwnership.Stock_Class__c === opt.value }))];
    }

    enrichData(o) {
        o.rowClass = o.isMarkedForDeletion ? 'compact-row deleted-row-highlight fade-in' : (o.isUnsaved ? 'compact-row unsaved-row-highlight' : 'compact-row');
        
        let ownedName = 'Unknown';
        let ownerName = 'Unknown';
        
        if (o.Company_Owned__c) {
            const safeOwnedId = String(o.Company_Owned__c).trim().substring(0, 15);
            if (this.entityDictionary[safeOwnedId]) { ownedName = this.entityDictionary[safeOwnedId]; }
        }
        
        if (o.Company_Owner__c) {
            const safeOwnerId = String(o.Company_Owner__c).trim().substring(0, 15);
            if (this.entityDictionary[safeOwnerId]) { ownerName = this.entityDictionary[safeOwnerId]; }
        }

        if (ownedName === 'Unknown' && o.Company_Owned__r && o.Company_Owned__r.Name) { ownedName = o.Company_Owned__r.Name; }
        if (ownerName === 'Unknown' && o.Company_Owner__r && o.Company_Owner__r.Name) { ownerName = o.Company_Owner__r.Name; }

        if (ownedName === 'Unknown' && o.CompanyOwnedName && o.CompanyOwnedName !== 'Unknown') { ownedName = o.CompanyOwnedName; }
        if (ownerName === 'Unknown' && o.CompanyOwnerName && o.CompanyOwnerName !== 'Unknown') { ownerName = o.CompanyOwnerName; }

        o.CompanyOwnedName = ownedName;
        o.CompanyOwnerName = ownerName;
        o.formattedPercent = o.Percentage_Owned__c != null ? `${o.Percentage_Owned__c} %` : '0 %';
        o.formattedDate = o.LastModifiedDate ? new Date(o.LastModifiedDate).toLocaleDateString('nb-NO') : 'Unsaved Draft';
        return o;
    }

    handleFormChange(event) { 
        const field = event.detail.field;
        const value = event.detail.value;
        this.currentOwnership = { ...this.currentOwnership, [field]: value }; 
        
        if (field === 'Company_Owned__c') {
            const safeId = value ? String(value).trim().substring(0, 15) : null;
            this.currentOwnership.CompanyOwnedName = (safeId && this.entityDictionary[safeId]) ? this.entityDictionary[safeId] : 'Unknown';
        }
        if (field === 'Company_Owner__c') {
            const safeId = value ? String(value).trim().substring(0, 15) : null;
            this.currentOwnership.CompanyOwnerName = (safeId && this.entityDictionary[safeId]) ? this.entityDictionary[safeId] : 'Unknown';
        }
    }
    
    handleDirectTextareaChange(event) {
        this.currentOwnership = { ...this.currentOwnership, [event.target.name]: event.target.value };
    }

    handleToggleChange(event) {
        this.currentOwnership = { ...this.currentOwnership, [event.target.dataset.field]: event.target.checked };
    }

    handleAddNew() {
        this.currentOwnership = {
            Company_Owned__c: '', Company_Owner__c: '', Percentage_Owned__c: null,
            Beneficial_Owner__c: false, Stock_Class__c: '', Comment__c: '',
            CompanyOwnedName: 'Unknown', CompanyOwnerName: 'Unknown'
        };
        this._originalSnapshot = null;
        this.isNewRecord = true;
        this.isEditorView = true;
        this._editorRendered = false;
    }

    handleEditRequest(event) {
        const found = this.ownerships.find(o => o.Id === event.currentTarget.dataset.id);
        this._originalSnapshot = JSON.parse(JSON.stringify(found));
        this.currentOwnership = JSON.parse(JSON.stringify(found));
        this.isNewRecord = false;
        this.isEditorView = true;
        this._editorRendered = false;
    }

    handleCancelEdit() {
        if (!this.isNewRecord && this.currentOwnership.Id) {
            const pristine = this._pristineMap[this.currentOwnership.Id];
            if (pristine) {
                const index = this.ownerships.findIndex(o => o.Id === this.currentOwnership.Id);
                if (index !== -1) {
                    const restored = JSON.parse(JSON.stringify(pristine));
                    restored.isUnsaved = false; restored.isMarkedForDeletion = false;
                    this.ownerships[index] = this.enrichData(restored);
                    this.ownerships = [...this.ownerships];
                }
            }
        }
        this._originalSnapshot = null;
        this.isEditorView = false;
        this.isDirty = this.ownerships.some(o => o.isUnsaved || o.isMarkedForDeletion);
    }

    async handleDeleteClick() {
        const result = await LightningConfirm.open({
            message: 'Mark for deletion? It will be permanently removed when you click "Save to Salesforce".',
            theme: 'warning',
            label: 'Confirm Deletion'
        });

        if (result) {
            const index = this.ownerships.findIndex(o => o.Id === this.currentOwnership.Id);
            if (index !== -1) {
                if (this.currentOwnership.Id.startsWith('NEW_')) {
                    this.ownerships.splice(index, 1);
                } else { 
                    this.ownerships[index].isMarkedForDeletion = true; 
                    this.ownerships[index].isUnsaved = true; 
                }
                this.ownerships = [...this.ownerships].map(o => this.enrichData(o));
                this.validateCurrentPage();
            }
            this.isEditorView = false; 
            this.isDirty = true;
        }
    }

    handleRestore(event) {
        const id = event.currentTarget.dataset.id;
        const index = this.ownerships.findIndex(o => o.Id === id);
        if (index !== -1) {
            this.ownerships[index].isMarkedForDeletion = false;
            this.ownerships = [...this.ownerships].map(o => this.enrichData(o));
        }
    }

    async handleApplyEdit() {
        if (!this.currentOwnership.Company_Owned__c || !this.currentOwnership.Company_Owner__c) {
            await LightningAlert.open({ message: 'Both Owned Company and Owner are required.', theme: 'error', label: 'Missing Information' });
            return;
        }

        if (!this.isNewRecord && this._originalSnapshot) {
            const fields = ['Company_Owned__c', 'Company_Owner__c', 'Percentage_Owned__c', 'Beneficial_Owner__c', 'Stock_Class__c', 'Comment__c'];
            const hasChanges = fields.some(f => String(this.currentOwnership[f] || '') !== String(this._originalSnapshot[f] || ''));
            if (!hasChanges) { this.isEditorView = false; this._originalSnapshot = null; return; }
        }

        this.currentOwnership.isUnsaved = true;
        const processed = this.enrichData(this.currentOwnership);

        if (this.isNewRecord) {
            processed.Id = 'NEW_' + Date.now();
            this.ownerships = [...this.ownerships, processed];
        } else {
            const index = this.ownerships.findIndex(o => o.Id === processed.Id);
            if (index !== -1) { this.ownerships[index] = processed; this.ownerships = [...this.ownerships]; }
        }

        this._originalSnapshot = null;
        this.validateCurrentPage();
        this.isEditorView = false;
        this.isDirty = true;
    }

    // --- THE ULTIMATE WHITELIST (Fixed for Aura Crashes) ---
    createCleanRecord(rawRecord) {
        // 1. MUST specify sobjectType for Flow to understand manually created objects
        const cleanRec = { sobjectType: 'Company_Ownership__c' };
        
        // 2. Only append fields if they actually have a value to prevent null/empty string crashes
        if (rawRecord.Company_Owned__c) { cleanRec.Company_Owned__c = rawRecord.Company_Owned__c; }
        if (rawRecord.Company_Owner__c) { cleanRec.Company_Owner__c = rawRecord.Company_Owner__c; }
        
        if (rawRecord.Percentage_Owned__c !== null && rawRecord.Percentage_Owned__c !== '' && rawRecord.Percentage_Owned__c !== undefined) {
            cleanRec.Percentage_Owned__c = Number(rawRecord.Percentage_Owned__c);
        }
        
        cleanRec.Beneficial_Owner__c = rawRecord.Beneficial_Owner__c === true;
        
        if (rawRecord.Stock_Class__c) { cleanRec.Stock_Class__c = rawRecord.Stock_Class__c; }
        if (rawRecord.Comment__c) { cleanRec.Comment__c = rawRecord.Comment__c; }
        
        return cleanRec;
    }

    handleSaveToFlow() {
        const toKeep = [];
        const toUpsert = [];
        const toDelete = [];

        this.ownerships.forEach(o => {
            if (o.isMarkedForDeletion) {
                // Must include sobjectType here as well
                toDelete.push({ sobjectType: 'Company_Ownership__c', Id: o.Id });
            } else {
                const wasUnsaved = o.isUnsaved;
                o.isUnsaved = false;
                const processed = this.enrichData(o);
                toKeep.push(processed); 
                
                if (wasUnsaved) {
                    const cleanRec = this.createCleanRecord(processed);
                    // ALWAYS assign the Id so Flow can check if it starts with NEW_
                    cleanRec.Id = processed.Id;
                    toUpsert.push(cleanRec);
                }
            }
        });

        // Oppdaterer Flow med ferdig sorterte SObject variabler
        this.outputOwnershipsToUpsert = toUpsert;
        this.outputOwnershipsToDelete = toDelete;
        
        // NEW: Enkle JSON strings for garantert krasj-fri overføring til Flow
        this.outputUpsertJSON = JSON.stringify(toUpsert);
        this.outputDeleteJSON = JSON.stringify(toDelete);
        
        this.outputAction = 'SAVE';
        this.ownerships = toKeep;
        this.isDirty = false;
        
        if (this.availableActions && this.availableActions.includes('NEXT')) {
            this.dispatchEvent(new FlowNavigationNextEvent());
        } else if (!this.availableActions || this.availableActions.length === 0) {
            // Fallback just in case it's not populated
            this.dispatchEvent(new FlowNavigationNextEvent());
        }
    }

    handlePrevPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
        }
    }

    handleNextPage() {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
        }
    }

    validateCurrentPage() {
        if (this.currentPage > this.totalPages && this.totalPages > 0) {
            this.currentPage = this.totalPages;
        } else if (this.currentPage === 0 && this.totalPages > 0) {
            this.currentPage = 1;
        }
    }
}