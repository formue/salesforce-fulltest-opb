import { LightningElement, api, track, wire } from 'lwc';
import { FlowNavigationNextEvent } from 'lightning/flowSupport';
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';

import GOAL_OBJECT from '@salesforce/schema/FinServ__FinancialGoal__c';
import STATUS_FIELD from '@salesforce/schema/FinServ__FinancialGoal__c.FinServ__Status__c';
import FF_GOAL_FIELD from '@salesforce/schema/FinServ__FinancialGoal__c.FF_Goal__c';

export default class WealthPlanGoals extends LightningElement {
    // --- STANDARD INPUTS FROM FLOW ---
    @api recordId = ''; 
    @api inputGoals = []; 
    @api inputHouseholdMembers = []; 
    @api inputPrimaryMemberId = ''; 
    @api backgroundColor = '#f0f9ff'; 
    @api inputIsPublished = false;

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
    @api outputGoals = []; 
    @api outputGoalsToDelete = []; 
    @api outputAction = '';
    @api outputIsPublished = false;

    // --- LOCAL COMPONENT STATE ---
    @track goals = [];
    @track isDirty = false;
    @track isEditorView = false;
    @track currentGoal = {};
    @track isNewRecord = false;
    _originalGoalSnapshot = null; // snapshot at edit-open for change detection
    _pristineGoalsMap = {};       // original goals from inputGoals, keyed by Id
    @track localIsPublished = false; 
    @track dynamicStatusOptions = [];
    @track dynamicGoalOptions = [];
    @track currentPage = 1;
    @track isCorporateTheme = true;

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
                '--shell-btn-primary-bg: #3b82f6',
            ].join('; ');
        }
        return `--component-bg-color: ${this.backgroundColor};`;
    }

get dashboardWrapperClass() {
        return this.isCorporateTheme
            ? 'dashboard-content-wrapper theme-corporate'
            : 'dashboard-content-wrapper';
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
    
    @wire(getObjectInfo, { objectApiName: GOAL_OBJECT }) goalObjectInfo;

    @wire(getPicklistValues, { recordTypeId: '$goalObjectInfo.data.defaultRecordTypeId', fieldApiName: FF_GOAL_FIELD })
    wiredGoalValues({ error, data }) {
        if (data) {
            this.dynamicGoalOptions = data.values.map(val => {
                return { label: val.label, value: val.value, selected: this.currentGoal.FF_Goal__c === val.value };
            });
            if (this.goals.length > 0) { this.goals = this.goals.map(g => this.enrichGoalData(g)); }
        }
    }

    @wire(getPicklistValues, { recordTypeId: '$goalObjectInfo.data.defaultRecordTypeId', fieldApiName: STATUS_FIELD })
    wiredStatusValues({ error, data }) {
        if (data) {
            this.dynamicStatusOptions = data.values.map(val => {
                return { label: val.label, value: val.value, selected: this.currentGoal.FinServ__Status__c === val.value };
            });
        }
    }

    // ==========================================
    // LIFECYCLE HOOKS
    // ==========================================
    
    connectedCallback() {
        this.isAiExpanded = this.defaultAccordionOpen;
        this.localIsPublished = this.inputIsPublished;
        this.outputIsPublished = this.localIsPublished;

        if (this.inputGoals && this.inputGoals.length > 0) {
            const cloned = JSON.parse(JSON.stringify(this.inputGoals));
            // Store pristine copy of each goal keyed by Id — never mutated
            this._pristineGoalsMap = {};
            cloned.forEach(g => { if (g.Id) this._pristineGoalsMap[g.Id] = JSON.parse(JSON.stringify(g)); });
            this.goals = cloned.map(g => this.enrichGoalData(g));
        }
    }

    // ==========================================
    // UI GETTERS (Now excluding marked-for-deletion items)
    // ==========================================
    
    get totalGoals() { return this.goals.filter(g => !g.isMarkedForDeletion).length; }
    get activeGoals() { return this.goals.filter(g => !g.isMarkedForDeletion && g.FinServ__Status__c === 'In Progress').length; }
    get completedGoals() { return this.goals.filter(g => !g.isMarkedForDeletion && g.FinServ__Status__c === 'Completed').length; }
    get hasGoals() { return this.goals.length > 0; }
    get modalTitle() { return this.isNewRecord ? 'Create New Goal' : 'Edit Goal Details'; }

    get PAGE_SIZE() { return 15; }
    get paginatedGoals() {
        const start = (this.currentPage - 1) * this.PAGE_SIZE;
        return this.goals.slice(start, start + this.PAGE_SIZE);
    }
    get totalPages() { return Math.max(1, Math.ceil(this.goals.length / this.PAGE_SIZE)); }
    get showPagination() { return this.goals.length > this.PAGE_SIZE; }
    get isFirstPage() { return this.currentPage === 1; }
    get isLastPage() { return this.currentPage >= this.totalPages; }
    handlePrevPage() { if (!this.isFirstPage) this.currentPage--; }
    handleNextPage() { if (!this.isLastPage) this.currentPage++; }

    get currentStatusOptions() {
        return this.dynamicStatusOptions.map(opt => {
            return { ...opt, selected: this.currentGoal.FinServ__Status__c === opt.value };
        });
    }

    get currentGoalOptions() {
        let options = [{ label: '-- Select Standard Goal --', value: '' }];
        if (this.dynamicGoalOptions) {
            const goalOpts = this.dynamicGoalOptions.map(opt => {
                return { ...opt, selected: this.currentGoal.FF_Goal__c === opt.value };
            });
            options = [...options, ...goalOpts];
        }
        return options;
    }

    get currentOwnerOptions() {
        let options = [{ label: '-- Select Household Member --', value: '' }];
        if (this.inputHouseholdMembers && this.inputHouseholdMembers.length > 0) {
            const memberOptions = this.inputHouseholdMembers.map(member => {
                return { label: member.Name, value: member.Id, selected: this.currentGoal.FinServ__PrimaryOwner__c === member.Id };
            });
            options = [...options, ...memberOptions];
        }
        return options;
    }

    get isCustomGoal() {
        if (!this.currentGoal || !this.currentGoal.FF_Goal__c) return false;
        const val = String(this.currentGoal.FF_Goal__c).toLowerCase();
        return val === 'other' || val === 'annet' || val === 'custom';
    }

    get descriptionCharCount() {
        return this.currentGoal && this.currentGoal.FinServ__Description__c ? this.currentGoal.FinServ__Description__c.length : 0;
    }

    get descriptionCharsLeft() {
        return 256 - this.descriptionCharCount;
    }

    get charCounterClass() {
        return this.descriptionCharCount >= 256 ? 'char-counter limit-reached' : 'char-counter';
    }

    // ==========================================
    // DATA PROCESSING
    // ==========================================
    
    enrichGoalData(goal) {
        let badgeClass = 'badge '; let accentClass = 'card-accent ';
        if (goal.FinServ__Status__c === 'Completed') { badgeClass += 'badge-success'; accentClass += 'accent-success'; } 
        else if (goal.FinServ__Status__c === 'In Progress') { badgeClass += 'badge-active'; accentClass += 'accent-active'; } 
        else { badgeClass += 'badge-neutral'; accentClass += 'accent-neutral'; }
        
        // Handle visual classes for deleted vs unsaved
        if (goal.isMarkedForDeletion) {
            goal.statusClass = badgeClass;
            goal.accentClass = 'card-accent accent-danger';
            goal.cardWrapperClass = 'goal-card deleted-highlight fade-in';
        } else {
            goal.statusClass = badgeClass;
            goal.accentClass = accentClass;
            goal.cardWrapperClass = goal.isUnsaved ? 'goal-card unsaved-highlight' : 'goal-card';
        }

        if (goal.FinServ__PrimaryOwner__c && this.inputHouseholdMembers && this.inputHouseholdMembers.length > 0) {
            const ownerRec = this.inputHouseholdMembers.find(acc => acc.Id === goal.FinServ__PrimaryOwner__c);
            if (ownerRec) { goal.OwnerName = ownerRec.Name; }
        }
        if (!goal.OwnerName) goal.OwnerName = 'Unknown Member';
        
        goal.ownerInitials = goal.OwnerName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        
        let goalLabel = goal.FF_Goal__c;
        if (this.dynamicGoalOptions && this.dynamicGoalOptions.length > 0) {
            const foundOpt = this.dynamicGoalOptions.find(opt => opt.value === goal.FF_Goal__c);
            if (foundOpt) { goalLabel = foundOpt.label; }
        }
        
        goal.DisplayTitle = goal.FF_Custom_Goal__c ? goal.FF_Custom_Goal__c : (goalLabel || 'Unnamed Goal');

        if (goal.isMarkedForDeletion) {
            goal.rowClass = 'compact-row deleted-row-highlight';
        } else if (goal.isUnsaved) {
            goal.rowClass = 'compact-row unsaved-row-highlight';
        } else {
            goal.rowClass = 'compact-row';
        }

        if (goal.FinServ__Status__c === 'Completed') {
            goal.badgeTinyClass = 'badge-tiny badge-success-tiny';
        } else if (goal.FinServ__Status__c === 'In Progress') {
            goal.badgeTinyClass = 'badge-tiny badge-active-tiny';
        } else {
            goal.badgeTinyClass = 'badge-tiny';
        }

        if (goal.LastModifiedDate) {
            goal.formattedDate = new Date(goal.LastModifiedDate).toLocaleDateString('nb-NO', { year: 'numeric', month: 'short', day: 'numeric' });
        } else {
            goal.formattedDate = '';
        }

        return goal;
    }

    // ==========================================
    // EVENT HANDLERS
    // ==========================================
    
    handleFormChange(event) { 
        let field = event.detail.field;
        let value = event.detail.value;
        
        // Enforce 256 character hard stop for Description
        if (field === 'FinServ__Description__c' && value && value.length > 256) {
            value = value.substring(0, 256);
        }
        
        this.currentGoal = { ...this.currentGoal, [field]: value }; 
    }

    handleAddNew() {
        this.currentGoal = { FF_Goal__c: '', FF_Custom_Goal__c: '', FinServ__Description__c: '', FinServ__Status__c: 'Not Started', FinServ__PrimaryOwner__c: this.inputPrimaryMemberId || '' };
        this._originalGoalSnapshot = null; // no original for new records
        this.isNewRecord = true;
        this.isEditorView = true;
    }

    handleEditRequest(event) {
        const foundGoal = this.goals.find(g => g.Id === event.currentTarget.dataset.id);
        this._originalGoalSnapshot = JSON.parse(JSON.stringify(foundGoal)); // pristine copy
        this.currentGoal = JSON.parse(JSON.stringify(foundGoal));
        this.isNewRecord = false;
        this.isEditorView = true;
    }

    handleCancelEdit() {
        if (!this.isNewRecord && this.currentGoal.Id) {
            const goalId = this.currentGoal.Id;
            const pristine = this._pristineGoalsMap[goalId];
            if (pristine) {
                // Revert to the original state from inputGoals — removes all local edits
                const index = this.goals.findIndex(g => g.Id === goalId);
                if (index !== -1) {
                    const restored = JSON.parse(JSON.stringify(pristine));
                    restored.isUnsaved = false;
                    restored.isMarkedForDeletion = false;
                    this.goals[index] = this.enrichGoalData(restored);
                    this.goals = [...this.goals];
                }
            }
        }
        this._originalGoalSnapshot = null;
        this.isEditorView = false;

        // Recalculate isDirty — still dirty if any goal remains unsaved or marked for deletion
        this.isDirty = this.goals.some(g => g.isUnsaved || g.isMarkedForDeletion);
    }

    /**
     * "Damnatio Memoriae" - Marks a goal visually for deletion but keeps it on screen.
     * Only true Salesforce records get marked. Unsaved local drafts are deleted immediately.
     */
    handleDeleteClick() {
        if (window.confirm('Mark this goal for deletion? It will be removed permanently when you click "Save to Salesforce".')) {
            const index = this.goals.findIndex(g => g.Id === this.currentGoal.Id);
            if (index !== -1) {
                // If it's a brand new unsaved record, just remove it completely to avoid clutter
                if (this.currentGoal.Id.startsWith('NEW_')) {
                    this.goals.splice(index, 1);
                } else {
                    // Mark existing Salesforce record for deletion
                    this.goals[index].isMarkedForDeletion = true;
                    this.goals[index].isUnsaved = true; // Flags to the View Shell that changes exist
                }
                this.goals = [...this.goals].map(g => this.enrichGoalData(g));
            }
            this.isEditorView = false; 
            this.isDirty = true;
        }
    }

    /**
     * Un-does the deletion mark, restoring the card to its original glory.
     */
    handleRestoreGoal(event) {
        const goalId = event.currentTarget.dataset.id;
        const index = this.goals.findIndex(g => g.Id === goalId);
        if (index !== -1) {
            this.goals[index].isMarkedForDeletion = false;
            this.goals = [...this.goals].map(g => this.enrichGoalData(g));
        }
    }

    handleApplyEdit() {
        if (this.isCustomGoal && (!this.currentGoal.FF_Custom_Goal__c || this.currentGoal.FF_Custom_Goal__c.trim() === '')) {
            alert('Please provide a Custom Goal Name when "Other" is selected.');
            return;
        }
        if (!this.isCustomGoal) {
            this.currentGoal.FF_Custom_Goal__c = '';
        }

        // For existing records, check whether any data field actually changed
        if (!this.isNewRecord && this._originalGoalSnapshot) {
            const fieldsToCompare = [
                'FF_Goal__c', 'FF_Custom_Goal__c', 'FinServ__Description__c',
                'FinServ__Status__c', 'FinServ__PrimaryOwner__c'
            ];
            const hasChanges = fieldsToCompare.some(f =>
                (this.currentGoal[f] || '') !== (this._originalGoalSnapshot[f] || '')
            );
            if (!hasChanges) {
                // No actual changes — just close the editor without marking dirty
                this.isEditorView = false;
                this._originalGoalSnapshot = null;
                return;
            }
        }

        this.currentGoal.isUnsaved = true;
        const processedGoal = this.enrichGoalData(this.currentGoal);

        if (this.isNewRecord) {
            processedGoal.Id = 'NEW_' + Date.now();
            this.goals = [...this.goals, processedGoal];
        } else {
            const index = this.goals.findIndex(g => g.Id === processedGoal.Id);
            if (index !== -1) {
                this.goals[index] = processedGoal;
                this.goals = [...this.goals];
            }
        }

        this._originalGoalSnapshot = null;
        this.isEditorView = false;
        this.isDirty = true;
    }

    /**
     * Executes the final DML routing. Filters out goals marked for deletion,
     * routes them to the delete array, and passes the survivors to be saved.
     */
    handleSaveToFlow() {
        const finalGoalsToKeep = [];
        const finalGoalsToDelete = [];

        this.goals.forEach(g => {
            if (g.isMarkedForDeletion) {
                finalGoalsToDelete.push(g);
            } else {
                g.isUnsaved = false;
                finalGoalsToKeep.push(this.enrichGoalData(g));
            }
        });

        // Add dynamically deleted goals to the output deletion queue
        this.outputGoalsToDelete = [...this.outputGoalsToDelete, ...finalGoalsToDelete];
        
        // Output only the kept goals for Upsert
        this.outputGoals = finalGoalsToKeep; 
        
        // Update local state to physically remove the red cards from the UI once saved
        this.goals = finalGoalsToKeep;

        this.outputAction = 'SAVE';
        this.isDirty = false;
        
        this.dispatchEvent(new FlowNavigationNextEvent());
    }
}