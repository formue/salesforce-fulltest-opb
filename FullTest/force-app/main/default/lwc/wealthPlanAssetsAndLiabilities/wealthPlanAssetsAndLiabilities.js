import { LightningElement, api, track, wire } from 'lwc';
import { FlowNavigationNextEvent } from 'lightning/flowSupport';
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';

import ASSET_OBJECT from '@salesforce/schema/FinServ__AssetsAndLiabilities__c';
import AL_TYPE_FIELD from '@salesforce/schema/FinServ__AssetsAndLiabilities__c.AssetorLiabilityType__c';
import TYPE_FIELD from '@salesforce/schema/FinServ__AssetsAndLiabilities__c.FinServ__AssetsAndLiabilitiesType__c';
import CATEGORY_FIELD from '@salesforce/schema/FinServ__AssetsAndLiabilities__c.FF_Category__c';

const RT_NAME_MAPPING = {
    'Asset': 'NonfinancialAsset',
    'Business': 'FF_Business',
    'Financial Asset': 'FF_Financial_Asset_c',
    'Liability': 'Liability'
};

export default class WealthPlanAssetsAndLiabilities extends LightningElement {
    @api recordId = ''; 
    @api inputAssets = []; 
    @api inputHouseholdMembers = []; 
    @api inputBusinessAccounts = []; 
    @api inputPrimaryMemberId = ''; 
    @api backgroundColor = '#f0f9ff'; 
    @api inputIsPublished = false;
    @api isBusinessContext = false; 
    @api rowsPerPage = 5; 

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

    @api outputAssets = []; 
    @api outputAssetsToDelete = []; 
    @api outputAction = '';
    @api outputIsPublished = false;
    @api outputAiContext = '';

    @track assets = [];
    @track isDirty = false;
    @track isEditorView = false;
    @track currentAsset = {};
    @track isNewRecord = false;
    @track isCorporateTheme = true;
    _originalSnapshot = null;
    _pristineMap = {};
    @track localIsPublished = false;
    @track currentPage = 1;
    
    @track dynamicALTypeOptions = [];
    rawTypeData;
    rawCategoryData;
    
    @track allTypeOptions = [];
    @track allCategoryOptions = [];
    @track editorTypeOptions = [];
    @track editorCategoryOptions = [];

    currencyFormatter = new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', minimumFractionDigits: 0, maximumFractionDigits: 0 });

    safeIdMatch(id1, id2) {
        if (!id1 || !id2) return false;
        return String(id1).substring(0, 15) === String(id2).substring(0, 15);
    }

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
                '--shell-btn-primary-bg: #10b981',
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

    get publishCardClass() { return this.localIsPublished ? 'publish-card is-published' : 'publish-card is-draft'; }
    get isToggleDisabled() { return this.inputIsPublished === true; }
    get publishTitleText() { return this.isToggleDisabled ? 'Plan is permanently published and locked' : (this.localIsPublished ? 'Will be published upon saving' : 'Click to mark as published'); }

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

    @wire(getObjectInfo, { objectApiName: ASSET_OBJECT }) assetObjectInfo;

    @wire(getPicklistValues, { recordTypeId: '$assetObjectInfo.data.defaultRecordTypeId', fieldApiName: AL_TYPE_FIELD })
    wiredALTypeValues({ data }) {
        if (data) {
            this.dynamicALTypeOptions = data.values.map(val => ({ label: val.label, value: val.value }));
            this.triggerDataEnrichment();
        }
    }

    @wire(getPicklistValues, { recordTypeId: '$assetObjectInfo.data.defaultRecordTypeId', fieldApiName: TYPE_FIELD })
    wiredTypeValues({ data }) {
        if (data) {
            this.rawTypeData = data;
            this.allTypeOptions = data.values.map(val => ({ label: val.label, value: val.value }));
            this.updateDependentOptions();
            this.triggerDataEnrichment();
        }
    }

    @wire(getPicklistValues, { recordTypeId: '$assetObjectInfo.data.defaultRecordTypeId', fieldApiName: CATEGORY_FIELD })
    wiredCategoryValues({ data }) {
        if (data) {
            this.rawCategoryData = data;
            this.allCategoryOptions = data.values.map(val => ({ label: val.label, value: val.value }));
            this.updateDependentOptions();
            this.triggerDataEnrichment();
        }
    }

    triggerDataEnrichment() {
        if (this.assets.length > 0) {
            this.assets = this.assets.map(a => this.enrichAssetData(a));
        }
    }

    // THE FIX: "Åpen dør" fallback. Hvis avhengighet mangler i SF, vis alt i stedet for tomt felt!
    updateDependentOptions() {
        const ctrlVal = this.currentAsset.AssetorLiabilityType__c || 'Asset';

        // TYPE FALLBACK
        let typeOpts = [];
        if (this.rawTypeData && this.rawTypeData.controllerValues) {
            const ctrlIndex = this.rawTypeData.controllerValues[ctrlVal];
            if (ctrlIndex !== undefined) {
                typeOpts = this.rawTypeData.values.filter(opt => opt.validFor.includes(ctrlIndex));
            }
        }
        if (typeOpts.length === 0 && this.rawTypeData && this.rawTypeData.values) {
            typeOpts = this.rawTypeData.values; // Vis alle som fallback
        }
        this.editorTypeOptions = typeOpts.map(opt => ({ label: opt.label, value: opt.value, selected: this.currentAsset.FinServ__AssetsAndLiabilitiesType__c === opt.value }));

        // CATEGORY FALLBACK
        let catOpts = [];
        if (this.rawCategoryData && this.rawCategoryData.controllerValues) {
            const ctrlIndex = this.rawCategoryData.controllerValues[ctrlVal];
            if (ctrlIndex !== undefined) {
                catOpts = this.rawCategoryData.values.filter(opt => opt.validFor.includes(ctrlIndex));
            }
        }
        if (catOpts.length === 0 && this.rawCategoryData && this.rawCategoryData.values) {
            catOpts = this.rawCategoryData.values; // Vis alle som fallback (Løser feilen for Liability!)
        }
        this.editorCategoryOptions = catOpts.map(opt => ({ label: opt.label, value: opt.value, selected: this.currentAsset.FF_Category__c === opt.value }));
    }

    connectedCallback() {
        this.isAiExpanded = this.defaultAccordionOpen;
        this.localIsPublished = this.inputIsPublished;
        this.outputIsPublished = this.localIsPublished;

        if (this.inputAssets && this.inputAssets.length > 0) {
            const cloned = JSON.parse(JSON.stringify(this.inputAssets));
            this._pristineMap = {};
            cloned.forEach(a => { if (a.Id) this._pristineMap[a.Id] = JSON.parse(JSON.stringify(a)); });
            this.assets = cloned.map(ast => this.enrichAssetData(ast));
        }
    }

    // THE FIX: Den samme skuddsikre radaren for Description-boksen
    renderedCallback() {
        if (this.isEditorView) {
            const ta = this.template.querySelector('.textarea-direct');
            if (ta) {
                const expectedValue = this.currentAsset.FinServ__Description__c || '';
                if (ta.value !== expectedValue) {
                    ta.value = expectedValue;
                }
            }
        }
    }

    get totalAssetsSum() { return this.assets.filter(ast => !ast.isMarkedForDeletion && (ast.AssetorLiabilityType__c !== 'Liability' || ast.FinServ__Amount__c > 0)).reduce((sum, ast) => sum + (Number(ast.FinServ__Amount__c) || 0), 0); }
    get totalLiabilitiesSum() { return this.assets.filter(ast => !ast.isMarkedForDeletion && (ast.AssetorLiabilityType__c === 'Liability' || ast.FinServ__Amount__c < 0)).reduce((sum, ast) => sum + (Number(ast.FinServ__Amount__c) || 0), 0); }
    get formattedTotalAssets() { return this.currencyFormatter.format(this.totalAssetsSum); }
    get formattedTotalLiabilities() { return this.currencyFormatter.format(this.totalLiabilitiesSum); }
    get netWorth() { return this.totalAssetsSum + this.totalLiabilitiesSum; }
    get formattedNetWorth() { return this.currencyFormatter.format(this.netWorth); }
    get hasAssets() { return this.assets.length > 0; }
    get modalTitle() { return this.isNewRecord ? 'Create Record' : 'Edit Record'; }

    get totalPages() { return Math.ceil(this.assets.length / this.rowsPerPage) || 1; }
    get paginatedAssets() { const start = (this.currentPage - 1) * this.rowsPerPage; return this.assets.slice(start, start + this.rowsPerPage); }
    get isFirstPage() { return this.currentPage === 1; }
    get isLastPage() { return this.currentPage >= this.totalPages; }
    get showPagination() { return this.assets.length > this.rowsPerPage; }

    get currentALTypeOptions() { return this.buildOptions(this.dynamicALTypeOptions, this.currentAsset.AssetorLiabilityType__c, '-- Select A/L Type --'); }
    get currentEditorTypeOptions() { return this.buildOptions(this.editorTypeOptions, this.currentAsset.FinServ__AssetsAndLiabilitiesType__c, '-- Select Type --'); }
    get currentEditorCategoryOptions() { return this.buildOptions(this.editorCategoryOptions, this.currentAsset.FF_Category__c, '-- Select Category --'); }

    get currentOwnerOptions() {
        let options = [{ label: '-- Select Primary Owner --', value: '' }];
        if (this.inputHouseholdMembers) {
            const memberOptions = this.inputHouseholdMembers.map(member => ({ label: member.Name, value: member.Id, selected: this.safeIdMatch(this.currentAsset.FinServ__PrimaryOwner__c, member.Id) }));
            options = [...options, ...memberOptions];
        }
        return options;
    }

    get currentBusinessOptions() {
        let options = [{ label: '-- Select Foundation/Business --', value: '' }];
        if (this.inputBusinessAccounts) {
            const bizOptions = this.inputBusinessAccounts.map(biz => ({ label: biz.Name, value: biz.Id, selected: this.safeIdMatch(this.currentAsset.FoundationBusiness__c, biz.Id) }));
            options = [...options, ...bizOptions];
        }
        return options;
    }

    buildOptions(sourceOptions, currentValue, placeholder) {
        let options = [{ label: placeholder, value: '' }];
        if (sourceOptions && sourceOptions.length > 0) {
            const mappedOpts = sourceOptions.map(opt => ({ ...opt, selected: currentValue === opt.value }));
            options = [...options, ...mappedOpts];
        }
        return options;
    }

    getRecordTypeId(typeValue) {
        if (!this.assetObjectInfo || !this.assetObjectInfo.data || !this.assetObjectInfo.data.recordTypeInfos) return null;
        const devName = RT_NAME_MAPPING[typeValue];
        if (!devName) return null;
        const rtInfos = this.assetObjectInfo.data.recordTypeInfos;
        const rt = Object.values(rtInfos).find(info => info.developerName === devName || info.name === devName);
        return rt ? rt.recordTypeId : null;
    }

    enrichAssetData(ast) {
        ast.FinServ__Amount__c = Number(ast.FinServ__Amount__c) || 0;
        ast.formattedAmount = this.currencyFormatter.format(ast.FinServ__Amount__c);
        ast.isAsset = ast.AssetorLiabilityType__c !== 'Liability';
        ast.amountClass = ast.isAsset ? 'grid-amount text-green' : 'grid-amount text-red';
        
        if (ast.isMarkedForDeletion) {
            ast.rowClass = 'compact-row deleted-row-highlight fade-in';
        } else {
            ast.rowClass = ast.isUnsaved ? 'compact-row unsaved-row-highlight' : 'compact-row';
        }

        let foundName = '';
        if (ast.FinServ__PrimaryOwner__c && this.inputHouseholdMembers) {
            const ownerRec = this.inputHouseholdMembers.find(acc => this.safeIdMatch(acc.Id, ast.FinServ__PrimaryOwner__c));
            if (ownerRec) { foundName = ownerRec.Name; }
        }
        ast.OwnerName = foundName || ast.Primary_Owner_Name__c || 'Unknown Member';

        if (this.isBusinessContext && ast.FoundationBusiness__c && this.inputBusinessAccounts) {
            const bizRec = this.inputBusinessAccounts.find(acc => this.safeIdMatch(acc.Id, ast.FoundationBusiness__c));
            if (bizRec) { ast.BusinessName = bizRec.Name; }
        }

        ast.DisplayALType = this.resolveLabel(this.dynamicALTypeOptions, ast.AssetorLiabilityType__c) || 'Unspecified';
        ast.DisplayType = this.resolveLabel(this.allTypeOptions, ast.FinServ__AssetsAndLiabilitiesType__c) || 'Unspecified';
        ast.DisplayCategory = this.resolveLabel(this.allCategoryOptions, ast.FF_Category__c) || 'Unspecified';

        if (ast.LastModifiedDate) {
            ast.formattedDate = new Date(ast.LastModifiedDate).toLocaleDateString('nb-NO', { year: 'numeric', month: 'short', day: 'numeric' });
        } else {
            ast.formattedDate = 'Unsaved Draft';
        }
        return ast;
    }

    resolveLabel(optionsList, value) {
        if (!optionsList || !value) return null;
        const found = optionsList.find(opt => opt.value === value);
        return found ? found.label : value;
    }

    handleFormChange(event) {
        const field = event.detail.field;
        let value = event.detail.value;
        
        if (field === 'FinServ__Amount__c' && this.currentAsset.AssetorLiabilityType__c === 'Liability' && value > 0) { value = -Math.abs(value); }
        if (field === 'AssetorLiabilityType__c') {
            if (value === 'Liability' && this.currentAsset.FinServ__Amount__c > 0) { this.currentAsset.FinServ__Amount__c = -Math.abs(this.currentAsset.FinServ__Amount__c); }
            else if (value !== 'Liability' && this.currentAsset.FinServ__Amount__c < 0) { this.currentAsset.FinServ__Amount__c = Math.abs(this.currentAsset.FinServ__Amount__c); }
        }
        
        this.currentAsset = { ...this.currentAsset, [field]: value };

        if (field === 'AssetorLiabilityType__c') {
            this.currentAsset.FinServ__AssetsAndLiabilitiesType__c = '';
            this.currentAsset.FF_Category__c = '';
            this.updateDependentOptions();
        } else if (field === 'FinServ__AssetsAndLiabilitiesType__c' || field === 'FF_Category__c') {
            this.updateDependentOptions();
        }
    }

    handleDirectTextareaChange(event) {
        const fieldName = event.target.name; 
        this.currentAsset = { ...this.currentAsset, [fieldName]: event.target.value };
    }

    handleCheckboxChange(event) {
        const isChecked = event.target.checked;
        this.currentAsset = { ...this.currentAsset, isFoundationBusiness: isChecked };
        if (!isChecked) { this.currentAsset.FoundationBusiness__c = ''; }
    }

    handleAddNew() {
        this.currentAsset = {
            Name: '', FinServ__Amount__c: null, AssetorLiabilityType__c: 'Asset',
            FinServ__AssetsAndLiabilitiesType__c: '', FF_Category__c: '',
            FinServ__PrimaryOwner__c: this.inputPrimaryMemberId || '', FinServ__Description__c: '',
            isFoundationBusiness: false, FoundationBusiness__c: ''
        };
        this._originalSnapshot = null;
        this.isNewRecord = true;
        this.isEditorView = true;
        this.updateDependentOptions();
    }

    handleEditRequest(event) {
        const foundAst = this.assets.find(a => a.Id === event.currentTarget.dataset.id);
        this._originalSnapshot = JSON.parse(JSON.stringify(foundAst));
        this.currentAsset = JSON.parse(JSON.stringify(foundAst));
        this.currentAsset.isFoundationBusiness = !!this.currentAsset.FoundationBusiness__c;
        this.isNewRecord = false;
        this.isEditorView = true;
        this.updateDependentOptions();
    }

    handleCancelEdit() {
        if (!this.isNewRecord && this.currentAsset.Id) {
            const pristine = this._pristineMap[this.currentAsset.Id];
            if (pristine) {
                const index = this.assets.findIndex(a => a.Id === this.currentAsset.Id);
                if (index !== -1) {
                    const restored = JSON.parse(JSON.stringify(pristine));
                    restored.isUnsaved = false; restored.isMarkedForDeletion = false;
                    this.assets[index] = this.enrichAssetData(restored);
                    this.assets = [...this.assets];
                }
            }
        }
        this._originalSnapshot = null;
        this.isEditorView = false;
        this.isDirty = this.assets.some(a => a.isUnsaved || a.isMarkedForDeletion);
    }
    handleNextPage() { if (!this.isLastPage) this.currentPage++; }
    handlePrevPage() { if (!this.isFirstPage) this.currentPage--; }
    
    validateCurrentPage() {
        if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
        if (this.currentPage < 1) this.currentPage = 1;
    }

    handleDeleteClick() {
        if (window.confirm('Mark this record for deletion? It will be permanently removed when you click "Save to Salesforce".')) {
            const index = this.assets.findIndex(a => a.Id === this.currentAsset.Id);
            if (index !== -1) {
                if (this.currentAsset.Id.startsWith('NEW_')) { this.assets.splice(index, 1); } 
                else { this.assets[index].isMarkedForDeletion = true; this.assets[index].isUnsaved = true; }
                this.assets = [...this.assets].map(a => this.enrichAssetData(a));
                this.validateCurrentPage();
            }
            this.isEditorView = false; 
            this.isDirty = true;
            this.dispatchEvent(new CustomEvent('unsavedstatuschange', { detail: { hasUnsavedChanges: true } }));
        }
    }

    handleRestoreAsset(event) {
        const astId = event.currentTarget.dataset.id;
        const index = this.assets.findIndex(a => a.Id === astId);
        if (index !== -1) {
            this.assets[index].isMarkedForDeletion = false;
            this.assets = [...this.assets].map(a => this.enrichAssetData(a));
        }
    }

    handleApplyEdit() {
        if (this.isBusinessContext && this.currentAsset.isFoundationBusiness && (!this.currentAsset.FoundationBusiness__c || this.currentAsset.FoundationBusiness__c.trim() === '')) {
            alert('Please select a Foundation/Business account.'); return;
        }

        if (!this.isNewRecord && this._originalSnapshot) {
            const fields = ['Name', 'FinServ__Amount__c', 'AssetorLiabilityType__c', 'FinServ__AssetsAndLiabilitiesType__c', 'FF_Category__c', 'FinServ__PrimaryOwner__c', 'FinServ__Description__c', 'FoundationBusiness__c'];
            const hasChanges = fields.some(f => String(this.currentAsset[f] || '') !== String(this._originalSnapshot[f] || ''));
            if (!hasChanges) { this.isEditorView = false; this._originalSnapshot = null; return; }
        }

        this.currentAsset.isUnsaved = true;
        const assignedRtId = this.getRecordTypeId(this.currentAsset.AssetorLiabilityType__c);
        if (assignedRtId) { this.currentAsset.RecordTypeId = assignedRtId; }

        const processedAsset = this.enrichAssetData(this.currentAsset);
        if (this.isNewRecord) {
            processedAsset.Id = 'NEW_' + Date.now();
            this.assets = [...this.assets, processedAsset];
        } else {
            const index = this.assets.findIndex(a => a.Id === processedAsset.Id);
            if (index !== -1) { this.assets[index] = processedAsset; this.assets = [...this.assets]; }
        }

        this._originalSnapshot = null;
        this.validateCurrentPage();
        this.isEditorView = false;
        this.isDirty = true;
        this.dispatchEvent(new CustomEvent('unsavedstatuschange', { detail: { hasUnsavedChanges: true } }));
    }

    handleSaveToFlow() {
        const finalAssetsToKeep = [];
        const finalAssetsToSave = []; 
        const finalAssetsToDelete = [];

        this.assets.forEach(a => {
            if (a.isMarkedForDeletion) {
                finalAssetsToDelete.push(a);
            } else {
                const wasUnsaved = a.isUnsaved;
                a.isUnsaved = false;
                const processed = this.enrichAssetData(a);
                finalAssetsToKeep.push(processed); 
                if (wasUnsaved) { finalAssetsToSave.push(processed); }
            }
        });

        this.outputAssetsToDelete = [...this.outputAssetsToDelete, ...finalAssetsToDelete];
        this.outputAssets = finalAssetsToSave; 
        this.outputAction = 'SAVE';
        
        this.assets = finalAssetsToKeep;
        this.isDirty = false;

        this.dispatchEvent(new CustomEvent('saveaction', { detail: { assetsToSave: finalAssetsToSave } }));
        this.dispatchEvent(new FlowNavigationNextEvent());
    }
}