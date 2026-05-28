import { LightningElement, api, track, wire } from 'lwc';
import { FlowNavigationNextEvent } from 'lightning/flowSupport';
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';

// Standard Salesforce API Mapping
import INCOME_OBJECT from '@salesforce/schema/FF_Income__c';
import TYPE_FIELD from '@salesforce/schema/FF_Income__c.FF_Type__c';

export default class WealthPlanIncome extends LightningElement {
    // --- STANDARD INPUTS FROM FLOW ---
    @api recordId = ''; 
    @api inputIncomes = []; 
    @api inputHouseholdMembers = []; 
    @api inputBusinessAccounts = []; 
    @api inputPrimaryMemberId = ''; 
    @api backgroundColor = '#f0f9ff'; 
    @api inputIsPublished = false;
    @api isBusinessContext = false; 

    // --- SLEEK AI MODULE STATE ---
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

    // --- STANDARD OUTPUTS TO FLOW ---
    @api outputIncomes = []; 
    @api outputIncomesToDelete = []; 
    @api outputAction = '';
    @api outputIsPublished = false;

    // --- LOCAL COMPONENT STATE ---
    @track incomes = [];
    @track isDirty = false;
    @track isEditorView = false;
    @track currentIncome = {};
    @track isNewRecord = false;
    _originalSnapshot = null;
    _pristineMap = {};
    @track localIsPublished = false;
    @track dynamicTypeOptions = [];
    @track currentPage = 1;

    currencyFormatter = new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', minimumFractionDigits: 0, maximumFractionDigits: 0 });

    // Skuddsikker ID-matcher for å håndtere 15 vs 18 tegns ID-er
    safeIdMatch(id1, id2) {
        if (!id1 || !id2) return false;
        return String(id1).substring(0, 15) === String(id2).substring(0, 15);
    }

    get dynamicBgStyle() { return `--component-bg-color: ${this.backgroundColor};`; }

    // ==========================================
    // PUBLISH & AI ACCORDION LOGIC
    // ==========================================
    
    get publishCardClass() {
        return this.localIsPublished ? 'publish-card is-published' : 'publish-card is-draft';
    }
    
    get isToggleDisabled() {
        return this.inputIsPublished === true;
    }
    
    get publishTitleText() {
        if (this.isToggleDisabled) return 'Plan is permanently published and locked';
        return this.localIsPublished ? 'Will be published upon saving' : 'Click to mark as published';
    }

    handlePublishToggle(event) {
        if (this.isToggleDisabled) return; 
        const newValue = event.target.checked;
        this.localIsPublished = newValue;
        this.outputIsPublished = this.localIsPublished;
        this.isDirty = true; 
    }

    toggleAiPanel() { this.isAiExpanded = !this.isAiExpanded; }
    get chevronClass() { return this.isAiExpanded ? 'ai-chevron open' : 'ai-chevron'; }
    get aiBodyClass() { return this.isAiExpanded ? 'ai-body expanded' : 'ai-body collapsed'; }

    // ==========================================
    // WIRES FOR SALESFORCE METADATA
    // ==========================================
    
    @wire(getObjectInfo, { objectApiName: INCOME_OBJECT }) incomeObjectInfo;

    @wire(getPicklistValues, { recordTypeId: '$incomeObjectInfo.data.defaultRecordTypeId', fieldApiName: TYPE_FIELD })
    wiredTypeValues({ error, data }) {
        if (data) {
            this.dynamicTypeOptions = data.values.map(val => {
                return { label: val.label, value: val.value, selected: this.currentIncome.FF_Type__c === val.value };
            });
            if (this.incomes.length > 0) { 
                this.incomes = this.incomes.map(i => this.enrichIncomeData(i)); 
            }
        }
    }

    // ==========================================
    // LIFECYCLE HOOKS
    // ==========================================

    connectedCallback() {
        this.isAiExpanded = this.defaultAccordionOpen;
        this.localIsPublished = this.inputIsPublished;
        this.outputIsPublished = this.localIsPublished;

        if (this.inputIncomes && this.inputIncomes.length > 0) {
            const cloned = JSON.parse(JSON.stringify(this.inputIncomes));
            this._pristineMap = {};
            cloned.forEach(i => { if (i.Id) this._pristineMap[i.Id] = JSON.parse(JSON.stringify(i)); });
            this.incomes = cloned.map(inc => this.enrichIncomeData(inc));
        }
    }

    // ==========================================
    // UI GETTERS
    // ==========================================

    get totalIncomeCount() { return this.incomes.filter(i => !i.isMarkedForDeletion).length; }
    
    get formattedTotalIncome() { 
        const total = this.incomes
            .filter(i => !i.isMarkedForDeletion)
            .reduce((sum, inc) => sum + (Number(inc.FF_Amount__c) || 0), 0);
        return this.currencyFormatter.format(total);
    }
    
    get hasIncomes() { return this.incomes.length > 0; }
    get modalTitle() { return this.isNewRecord ? 'Create Income Source' : 'Edit Income Source'; }

    get PAGE_SIZE() { return 15; }
    get paginatedIncomes() {
        const start = (this.currentPage - 1) * this.PAGE_SIZE;
        return this.incomes.slice(start, start + this.PAGE_SIZE);
    }
    get totalPages() { return Math.max(1, Math.ceil(this.incomes.length / this.PAGE_SIZE)); }
    get showPagination() { return this.incomes.length > this.PAGE_SIZE; }
    get isFirstPage() { return this.currentPage === 1; }
    get isLastPage() { return this.currentPage >= this.totalPages; }
    handlePrevPage() { if (!this.isFirstPage) this.currentPage--; }
    handleNextPage() { if (!this.isLastPage) this.currentPage++; }

    get currentTypeOptions() {
        let options = [{ label: '-- Select Income Type --', value: '' }];
        if (this.dynamicTypeOptions) {
            const typeOpts = this.dynamicTypeOptions.map(opt => {
                return { ...opt, selected: this.currentIncome.FF_Type__c === opt.value };
            });
            options = [...options, ...typeOpts];
        }
        return options;
    }

    get currentOwnerOptions() {
        let options = [{ label: '-- Select Household Member --', value: '' }];
        if (this.inputHouseholdMembers && this.inputHouseholdMembers.length > 0) {
            const memberOptions = this.inputHouseholdMembers.map(member => {
                return { 
                    label: member.Name, 
                    value: member.Id, 
                    selected: this.safeIdMatch(this.currentIncome.FF_Account__c, member.Id) 
                };
            });
            options = [...options, ...memberOptions];
        }
        return options;
    }

    get currentBusinessOptions() {
        let options = [{ label: '-- Select Foundation/Business --', value: '' }];
        if (this.inputBusinessAccounts && this.inputBusinessAccounts.length > 0) {
            const bizOptions = this.inputBusinessAccounts.map(biz => {
                return { 
                    label: biz.Name, 
                    value: biz.Id, 
                    selected: this.safeIdMatch(this.currentIncome.FoundationBusiness__c, biz.Id) 
                };
            });
            options = [...options, ...bizOptions];
        }
        return options;
    }

    get isCustomType() {
        if (!this.currentIncome || !this.currentIncome.FF_Type__c) return false;
        const val = String(this.currentIncome.FF_Type__c).toLowerCase();
        return val === 'other' || val === 'annet' || val === 'custom';
    }

    // ==========================================
    // DATA PROCESSING
    // ==========================================

    enrichIncomeData(inc) {
        inc.FF_Amount__c = Number(inc.FF_Amount__c) || 0;
        inc.formattedAmount = this.currencyFormatter.format(inc.FF_Amount__c);
        
        inc.accentClass = inc.isMarkedForDeletion ? 'card-accent accent-danger' : 'card-accent accent-success';

        if (inc.isMarkedForDeletion) {
            inc.cardWrapperClass = 'income-card deleted-highlight fade-in';
        } else {
            inc.cardWrapperClass = inc.isUnsaved ? 'income-card unsaved-highlight' : 'income-card';
        }

        let foundName = '';
        if (inc.FF_Account__c && this.inputHouseholdMembers) {
            const ownerRec = this.inputHouseholdMembers.find(acc => this.safeIdMatch(acc.Id, inc.FF_Account__c));
            if (ownerRec) { foundName = ownerRec.Name; }
        }
        inc.OwnerName = foundName || 'Unknown Member';
        inc.ownerInitials = inc.OwnerName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

        if (this.isBusinessContext && inc.FoundationBusiness__c && this.inputBusinessAccounts) {
            const bizRec = this.inputBusinessAccounts.find(acc => this.safeIdMatch(acc.Id, inc.FoundationBusiness__c));
            if (bizRec) { inc.BusinessName = bizRec.Name; }
        }

        let typeLabel = inc.FF_Type__c;
        if (this.dynamicTypeOptions && this.dynamicTypeOptions.length > 0) {
            const foundOpt = this.dynamicTypeOptions.find(opt => opt.value === inc.FF_Type__c);
            if (foundOpt) { typeLabel = foundOpt.label; }
        }
        
        inc.DisplayType = typeLabel || 'Unspecified';
        inc.DisplayTitle = inc.Name ? inc.Name : (inc.FF_Type_Other__c ? inc.FF_Type_Other__c : 'Unnamed Income');

        if (inc.isMarkedForDeletion) {
            inc.rowClass = 'compact-row deleted-row-highlight';
        } else if (inc.isUnsaved) {
            inc.rowClass = 'compact-row unsaved-row-highlight';
        } else {
            inc.rowClass = 'compact-row';
        }

        if (inc.LastModifiedDate) {
            inc.formattedDate = new Date(inc.LastModifiedDate).toLocaleDateString('nb-NO', { year: 'numeric', month: 'short', day: 'numeric' });
        } else {
            inc.formattedDate = 'Unsaved Draft';
        }

        return inc;
    }

    // ==========================================
    // EVENT HANDLERS
    // ==========================================

    handleFormChange(event) {
        this.currentIncome = { ...this.currentIncome, [event.detail.field]: event.detail.value };
    }

    handleAddNew() {
        this.currentIncome = {
            Name: '', FF_Type_Other__c: '', FF_Amount__c: null,
            FF_Account__c: this.inputPrimaryMemberId || '', FF_Type__c: '', FoundationBusiness__c: ''
        };
        this._originalSnapshot = null;
        this.isNewRecord = true;
        this.isEditorView = true;
    }

    handleEditRequest(event) {
        const foundInc = this.incomes.find(i => i.Id === event.currentTarget.dataset.id);
        this._originalSnapshot = JSON.parse(JSON.stringify(foundInc));
        this.currentIncome = JSON.parse(JSON.stringify(foundInc));
        this.isNewRecord = false;
        this.isEditorView = true;
    }

    handleCancelEdit() {
        if (!this.isNewRecord && this.currentIncome.Id) {
            const pristine = this._pristineMap[this.currentIncome.Id];
            if (pristine) {
                const index = this.incomes.findIndex(i => i.Id === this.currentIncome.Id);
                if (index !== -1) {
                    const restored = JSON.parse(JSON.stringify(pristine));
                    restored.isUnsaved = false; restored.isMarkedForDeletion = false;
                    this.incomes[index] = this.enrichIncomeData(restored);
                    this.incomes = [...this.incomes];
                }
            }
        }
        this._originalSnapshot = null;
        this.isEditorView = false;
        this.isDirty = this.incomes.some(i => i.isUnsaved || i.isMarkedForDeletion);
    }

    handleDeleteClick() {
        if (window.confirm('Mark this income for deletion? It will be permanently removed when you click "Save to Salesforce".')) {
            const index = this.incomes.findIndex(i => i.Id === this.currentIncome.Id);
            if (index !== -1) {
                if (this.currentIncome.Id.startsWith('NEW_')) {
                    this.incomes.splice(index, 1);
                } else {
                    this.incomes[index].isMarkedForDeletion = true;
                    this.incomes[index].isUnsaved = true; 
                }
                this.incomes = [...this.incomes].map(i => this.enrichIncomeData(i));
            }
            this.isEditorView = false; 
            this.isDirty = true;
            this.dispatchEvent(new CustomEvent('unsavedstatuschange', { detail: { hasUnsavedChanges: true } }));
        }
    }

    handleRestoreIncome(event) {
        const incId = event.currentTarget.dataset.id;
        const index = this.incomes.findIndex(i => i.Id === incId);
        if (index !== -1) {
            this.incomes[index].isMarkedForDeletion = false;
            this.incomes = [...this.incomes].map(i => this.enrichIncomeData(i));
        }
    }

    handleApplyEdit() {
        if (this.isCustomType && (!this.currentIncome.FF_Type_Other__c || this.currentIncome.FF_Type_Other__c.trim() === '')) {
            alert('Please provide a Custom Type Name when "Other" is selected.');
            return;
        }
        if (!this.isCustomType) { this.currentIncome.FF_Type_Other__c = ''; }

        if (this.isBusinessContext && (!this.currentIncome.FoundationBusiness__c || this.currentIncome.FoundationBusiness__c.trim() === '')) {
            alert('Please select a Foundation/Business account.');
            return;
        }

        if (!this.isNewRecord && this._originalSnapshot) {
            const fields = ['Name', 'FF_Type_Other__c', 'FF_Amount__c', 'FF_Account__c', 'FF_Type__c', 'FoundationBusiness__c'];
            const hasChanges = fields.some(f => String(this.currentIncome[f] || '') !== String(this._originalSnapshot[f] || ''));
            if (!hasChanges) { this.isEditorView = false; this._originalSnapshot = null; return; }
        }

        this.currentIncome.isUnsaved = true;
        const processedIncome = this.enrichIncomeData(this.currentIncome);

        if (this.isNewRecord) {
            processedIncome.Id = 'NEW_' + Date.now();
            this.incomes = [...this.incomes, processedIncome];
        } else {
            const index = this.incomes.findIndex(i => i.Id === processedIncome.Id);
            if (index !== -1) { this.incomes[index] = processedIncome; this.incomes = [...this.incomes]; }
        }

        this._originalSnapshot = null;
        this.isEditorView = false;
        this.isDirty = true;
        this.dispatchEvent(new CustomEvent('unsavedstatuschange', { detail: { hasUnsavedChanges: true } }));
    }

    handleSaveToFlow() {
        const finalIncomesToKeep = [];
        const finalIncomesToSave = []; // Vaskepannen! Sender kun det som faktisk er endret.
        const finalIncomesToDelete = [];

        this.incomes.forEach(i => {
            if (i.isMarkedForDeletion) {
                finalIncomesToDelete.push(i);
            } else {
                const wasUnsaved = i.isUnsaved;
                i.isUnsaved = false;
                const processed = this.enrichIncomeData(i);
                
                finalIncomesToKeep.push(processed); // Beholder alt synlig i UI
                
                // Legger KUN nyopprettede eller redigerte kort i lagrings-listen
                if (wasUnsaved) {
                    finalIncomesToSave.push(processed); 
                }
            }
        });

        this.outputIncomesToDelete = [...this.outputIncomesToDelete, ...finalIncomesToDelete];
        this.outputIncomes = finalIncomesToSave; // Setter Flow Output til kun de endrede!
        this.outputAction = 'SAVE';
        
        this.incomes = finalIncomesToKeep;
        this.isDirty = false;

        this.dispatchEvent(new CustomEvent('saveaction', { detail: { recordsToSave: finalIncomesToSave } }));
        this.dispatchEvent(new FlowNavigationNextEvent());
    }
}