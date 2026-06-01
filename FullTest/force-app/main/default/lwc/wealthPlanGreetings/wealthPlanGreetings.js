import { LightningElement, api, track } from 'lwc';
import { FlowNavigationNextEvent } from 'lightning/flowSupport';
import generateGreetingDraft from '@salesforce/apex/WealthPlanAIAgent.generateGreetingDraft';

export default class WealthPlanGreetings extends LightningElement {
    @api recordId = ''; 
    @api inputGreetings = []; 
    @api inputActiveGreeting = null; 
    @api backgroundColor = '#f0f9ff'; 
    @api inputIsPublished = false;
    
    // MODAL PROPERTIES
    @api useModalForEditor = false;
    @api editorModalWidth = '1000px'; // NEW: Custom width default
    
    @api inputAiFlowApiName = '';

    // LEGACY FIELDS
    @api inputAutoOpenRecordId = ''; 
    @api outputAiPromptContext = ''; 
    @api aiDraftGreeting = ''; 
    
    @api rowsPerPage = 5; 
    @api visibleLines = 3;
    @api autoFitGreetingBox = false; 

    // DASHBOARD AI MODULE STATE
    @api showAiSection = false;
    @api defaultAccordionOpen = false;
    
    @track _isAiLoading = false;
    @track _aiInsightSummary = '';
    @track isDashboardAiExpanded = false; 

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

    @api outputGreetings = []; 
    @api outputGreetingsToDelete = []; 
    @api outputAction = '';
    @api outputIsPublished = false;

    @track greetings = [];
    @track isDirty = false;
    @track isEditorView = false;
    @track currentGreeting = {};
    @track isNewRecord = false;
    _originalSnapshot = null;
    _pristineMap = {};
    @track localIsPublished = false;
    @track currentPage = 1;

    @track isMagicApplied = false;
    @track isEditorAiExpanded = false;
    @track isGeneratingBackgroundAi = false;
    @track isCorporateTheme = true;

    _editorRendered = false;

    get dynamicBgStyle() {
        const visLines = `--visible-lines: ${this.visibleLines}`;
        if (this.isCorporateTheme) return visLines;
        return `--component-bg-color: ${this.backgroundColor}; ${visLines}`;
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

    // ==========================================
    // DASHBOARD AI ACCORDION LOGIC
    // ==========================================
    toggleDashboardAiPanel() { this.isDashboardAiExpanded = !this.isDashboardAiExpanded; }
    get dashboardAiChevronClass() { return this.isDashboardAiExpanded ? 'ai-chevron open' : 'ai-chevron'; }
    get dashboardAiBodyClass() { return this.isDashboardAiExpanded ? 'ai-body expanded' : 'ai-body collapsed'; }

    // ==========================================
    // EDITOR AI ACCORDION LOGIC
    // ==========================================
    toggleEditorAiPanel() { this.isEditorAiExpanded = !this.isEditorAiExpanded; }
    get editorAiChevronClass() { return this.isEditorAiExpanded ? 'ai-chevron open' : 'ai-chevron'; }
    get editorAiBodyClass() { return this.isEditorAiExpanded ? 'ai-body expanded' : 'ai-body collapsed'; }

    get hasActiveGreetingHighlight() { return this.inputActiveGreeting && this.inputActiveGreeting.FF_Subject__c; }
    get activeGreetingSubject() { return this.inputActiveGreeting ? this.inputActiveGreeting.FF_Subject__c : ''; }
    get activeGreetingDate() {
        if (this.inputActiveGreeting && this.inputActiveGreeting.LastModifiedDate) {
            return new Date(this.inputActiveGreeting.LastModifiedDate).toLocaleDateString('nb-NO', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }
        return 'Unknown Date';
    }

    get totalPages() { return Math.ceil(this.greetings.length / this.rowsPerPage) || 1; }
    get paginatedGreetings() {
        const start = (this.currentPage - 1) * this.rowsPerPage;
        return this.greetings.slice(start, start + this.rowsPerPage);
    }
    get isFirstPage() { return this.currentPage === 1; }
    get isLastPage() { return this.currentPage >= this.totalPages; }
    get showPagination() { return this.greetings.length > this.rowsPerPage; }
    handleNextPage() { if (!this.isLastPage) this.currentPage++; }
    handlePrevPage() { if (!this.isFirstPage) this.currentPage--; }
    validateCurrentPage() {
        if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
        if (this.currentPage < 1) this.currentPage = 1;
    }

    get publishCardClass() { return this.localIsPublished ? 'publish-card is-published' : 'publish-card is-draft'; }
    get isToggleDisabled() { return this.inputIsPublished === true; }
    get publishTitleText() { return this.isToggleDisabled ? 'Plan is permanently published and locked' : (this.localIsPublished ? 'Will be published upon saving' : 'Click to mark as published'); }
    get isAlwaysDisabled() { return true; }

    handlePublishToggle(event) {
        if (this.isToggleDisabled) return; 
        const newValue = event.target.checked;
        this.localIsPublished = newValue;
        this.outputIsPublished = this.localIsPublished;
        this.isDirty = true; 
    }

    connectedCallback() {
        this.isDashboardAiExpanded = this.defaultAccordionOpen;
        this.localIsPublished = this.inputIsPublished;
        this.outputIsPublished = this.localIsPublished;
        if (this.inputGreetings && this.inputGreetings.length > 0) {
            const cloned = JSON.parse(JSON.stringify(this.inputGreetings));
            this._pristineMap = {};
            cloned.forEach(g => { if (g.Id) this._pristineMap[g.Id] = JSON.parse(JSON.stringify(g)); });
            this.greetings = cloned.map(g => this.enrichGreetingData(g));
        }

        if (this.inputAutoOpenRecordId) {
            const foundRec = this.greetings.find(g => g.Id === this.inputAutoOpenRecordId);
            if (foundRec) {
                this.currentGreeting = JSON.parse(JSON.stringify(foundRec));
                this.isNewRecord = this.inputAutoOpenRecordId.startsWith('NEW_');
                this.isEditorView = true;
                this.isGeneratingBackgroundAi = false; 
                this.isEditorAiExpanded = true; 
            }
        }
    }

    renderedCallback() {
        if (this.isEditorView && !this._editorRendered && !this.isGeneratingBackgroundAi) {
            this._editorRendered = true;
        } else if (!this.isEditorView) {
            this._editorRendered = false; 
        }
    }

    get totalGreetings() { return this.greetings.filter(g => !g.isMarkedForDeletion).length; }
    get activeGreetings() { return this.greetings.filter(g => !g.isMarkedForDeletion && g.FF_Active__c).length; }
    get readGreetings() { return this.greetings.filter(g => !g.isMarkedForDeletion && g.FF_Read__c).length; }
    get hasGreetings() { return this.greetings.length > 0; }
    get modalTitle() { return this.isNewRecord ? 'Create Personal Greeting' : 'Edit Greeting'; }
    get hasAiDraft() { return this.aiDraftGreeting && this.aiDraftGreeting.trim().length > 0; }
    get aiReplaceBtnClass() { return this.isMagicApplied ? 'btn-ai-replace success-flash' : 'btn-ai-replace'; }

    enrichGreetingData(greeting) {
        if (greeting.isMarkedForDeletion) {
            greeting.rowClass = 'compact-row deleted-row-highlight fade-in';
        } else {
            greeting.rowClass = greeting.isUnsaved ? 'compact-row unsaved-row-highlight' : 'compact-row';
        }

        if (greeting.CreatedDate) {
            greeting.formattedDate = new Date(greeting.CreatedDate).toLocaleDateString('nb-NO', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        } else {
            greeting.formattedDate = 'Unsaved Draft';
        }

        let rawText = greeting.FF_personalGreeting__c || '';
        greeting.FF_personalGreeting__c = rawText; 
        greeting.fullText = rawText;

        return greeting;
    }

    handleFormChange(event) {
        this.currentGreeting = { ...this.currentGreeting, [event.detail.field]: event.detail.value };
    }

    handleRichTextChange(event) {
        this.currentGreeting = { ...this.currentGreeting, FF_personalGreeting__c: event.target.value };
    }
    
    handleAddNew() {
        this.currentGreeting = { FF_Subject__c: '', FF_personalGreeting__c: '', FF_Active__c: true, FF_Read__c: false };
        this._originalSnapshot = null;
        this.isNewRecord = true;
        this.isEditorView = true;
        this.isEditorAiExpanded = false;
        this.isGeneratingBackgroundAi = false;
        this.aiDraftGreeting = '';
    }

    handleEditRequest(event) {
        const foundRec = this.greetings.find(g => g.Id === event.currentTarget.dataset.id);
        this._originalSnapshot = JSON.parse(JSON.stringify(foundRec));
        this.currentGreeting = JSON.parse(JSON.stringify(foundRec));
        this.isNewRecord = false;
        this.isEditorView = true;
        this.isEditorAiExpanded = false;
        this._editorRendered = false;

        this.invokeAiGhostwriter(true);
    }

    handleManualAiTrigger() {
        this.invokeAiGhostwriter(false);
    }

    invokeAiGhostwriter(isBackground = false) {
        if (!this.inputAiFlowApiName || this.inputAiFlowApiName.trim() === '') {
            this.aiDraftGreeting = '<p style="color:red;"><b>Configuration Error:</b> The AI Flow API Name is missing. Please configure it in the Flow Builder properties.</p>';
            if (!isBackground) { this.isEditorAiExpanded = true; }
            return;
        }

        this.isGeneratingBackgroundAi = true;
        if (!isBackground) { this.isEditorAiExpanded = true; }
        this.aiDraftGreeting = ''; 

        const currentSubject = this.currentGreeting.FF_Subject__c || '';
        const plainMessage = (this.currentGreeting.FF_personalGreeting__c || '').replace(/<[^>]*>?/gm, '');

        generateGreetingDraft({ 
            flowApiName: this.inputAiFlowApiName.trim(), 
            subject: currentSubject, 
            message: plainMessage 
        })
        .then(result => {
            this.aiDraftGreeting = result;
            this.isGeneratingBackgroundAi = false;
        })
        .catch(error => {
            console.error('Error from AI Ghostwriter Flow:', error);
            this.aiDraftGreeting = `<p style="color:red;"><b>Error:</b> Could not generate draft. Please ensure the Flow <b>${this.inputAiFlowApiName}</b> is active.</p>`;
            this.isGeneratingBackgroundAi = false;
        });
    }

    handleApplyAiDraft() {
        if (!this.hasAiDraft) return;
        this.currentGreeting = { ...this.currentGreeting, FF_personalGreeting__c: this.aiDraftGreeting };
        
        this.isMagicApplied = true;
        setTimeout(() => { this.isMagicApplied = false; }, 2000);
    }

    handleCancelEdit() {
        if (!this.isNewRecord && this.currentGreeting.Id) {
            const pristine = this._pristineMap[this.currentGreeting.Id];
            if (pristine) {
                const index = this.greetings.findIndex(g => g.Id === this.currentGreeting.Id);
                if (index !== -1) {
                    const restored = JSON.parse(JSON.stringify(pristine));
                    restored.isUnsaved = false; restored.isMarkedForDeletion = false;
                    this.greetings[index] = this.enrichGreetingData(restored);
                    this.greetings = [...this.greetings];
                }
            }
        }
        this._originalSnapshot = null;
        this.isEditorView = false;
        this.isGeneratingBackgroundAi = false;
        this.isDirty = this.greetings.some(g => g.isUnsaved || g.isMarkedForDeletion);
    }

    handleDeleteClick() {
        if (window.confirm('Mark this greeting for deletion? It will be removed permanently when you click "Save to Salesforce".')) {
            const index = this.greetings.findIndex(g => g.Id === this.currentGreeting.Id);
            if (index !== -1) {
                if (this.currentGreeting.Id.startsWith('NEW_')) {
                    this.greetings.splice(index, 1);
                } else {
                    this.greetings[index].isMarkedForDeletion = true;
                    this.greetings[index].isUnsaved = true; 
                }
                this.greetings = [...this.greetings].map(g => this.enrichGreetingData(g));
                this.validateCurrentPage();
            }
            this.isEditorView = false; 
            this.isDirty = true;
            this.dispatchEvent(new CustomEvent('unsavedstatuschange', { detail: { hasUnsavedChanges: true } }));
        }
    }

    handleRestoreGreeting(event) {
        const recId = event.currentTarget.dataset.id;
        const index = this.greetings.findIndex(g => g.Id === recId);
        if (index !== -1) {
            this.greetings[index].isMarkedForDeletion = false;
            this.greetings = [...this.greetings].map(g => this.enrichGreetingData(g));
        }
    }

    handleApplyEdit() {
        if (!this.currentGreeting.FF_Subject__c || this.currentGreeting.FF_Subject__c.trim() === '') {
            alert('Subject is required.');
            return;
        }

        if (!this.isNewRecord && this._originalSnapshot) {
            const fields = ['FF_Subject__c', 'FF_personalGreeting__c', 'FF_Active__c', 'FF_Read__c'];
            const hasChanges = fields.some(f => String(this.currentGreeting[f] || '') !== String(this._originalSnapshot[f] || ''));
            if (!hasChanges) { this.isEditorView = false; this._originalSnapshot = null; return; }
        }

        this.currentGreeting.isUnsaved = true;
        const processedRecord = this.enrichGreetingData(this.currentGreeting);

        if (this.isNewRecord) {
            if (!processedRecord.Id) processedRecord.Id = 'NEW_' + Date.now();
            const existingIndex = this.greetings.findIndex(g => g.Id === processedRecord.Id);
            if (existingIndex === -1) {
                this.greetings = [...this.greetings, processedRecord];
            } else {
                this.greetings[existingIndex] = processedRecord;
                this.greetings = [...this.greetings];
            }
        } else {
            const index = this.greetings.findIndex(g => g.Id === processedRecord.Id);
            if (index !== -1) { this.greetings[index] = processedRecord; this.greetings = [...this.greetings]; }
        }

        this._originalSnapshot = null;
        this.validateCurrentPage();
        this.isEditorView = false;
        this.isDirty = true;
        this.dispatchEvent(new CustomEvent('unsavedstatuschange', { detail: { hasUnsavedChanges: true } }));
    }

    handleToggleChange(event) {
        const fieldName = event.currentTarget.dataset.field;
        this.currentGreeting = { ...this.currentGreeting, [fieldName]: event.target.checked };
    }

    handleSaveToFlow() {
        const finalToKeep = [];
        const finalToDelete = [];

        this.greetings.forEach(g => {
            if (g.isMarkedForDeletion) {
                finalToDelete.push(g);
            } else {
                g.isUnsaved = false;
                finalToKeep.push(this.enrichGreetingData(g));
            }
        });

        this.outputGreetingsToDelete = [...this.outputGreetingsToDelete, ...finalToDelete];
        this.outputGreetings = finalToKeep;
        this.outputAction = 'SAVE';
        
        this.greetings = finalToKeep;
        this.isDirty = false;

        this.dispatchEvent(new CustomEvent('saveaction', { detail: { greetingsToSave: finalToKeep } }));
        this.dispatchEvent(new FlowNavigationNextEvent());
    }
}