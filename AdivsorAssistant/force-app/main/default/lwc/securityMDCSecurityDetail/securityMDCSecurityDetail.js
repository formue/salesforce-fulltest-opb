import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getSecurityDetail from '@salesforce/apex/SecurityMDCController.getSecurityDetail';
import getDataQualityActions from '@salesforce/apex/SecurityMDCController.getDataQualityActions';
import updateSecurityField from '@salesforce/apex/SecurityMDCController.updateSecurityField';
import createDataQualityAction from '@salesforce/apex/SecurityMDCController.createDataQualityAction';
import completeAction from '@salesforce/apex/SecurityMDCController.completeAction';

const COST_COLUMNS = [
    { label: 'Country',  fieldName: 'Country__c',  type: 'text' },
    { label: 'Year 1 %', fieldName: 'YearOne__c',  type: 'percent',
      typeAttributes: { minimumFractionDigits: 2, maximumFractionDigits: 4 } },
    { label: 'Year 2 %', fieldName: 'YearTwo__c',  type: 'percent',
      typeAttributes: { minimumFractionDigits: 2, maximumFractionDigits: 4 } },
    { label: 'Year 3 %', fieldName: 'YearThree__c', type: 'percent',
      typeAttributes: { minimumFractionDigits: 2, maximumFractionDigits: 4 } },
    { label: 'Source ID', fieldName: 'SourceSystemId__c', type: 'text' }
];

const ACTION_COLUMNS = [
    { label: 'Subject',  fieldName: 'subject',       type: 'text' },
    { label: 'Priority', fieldName: 'priority',      type: 'text' },
    { label: 'Due',      fieldName: 'activityDate',  type: 'date',
      typeAttributes: { year: 'numeric', month: 'short', day: '2-digit' } },
    { type: 'action', typeAttributes: { rowActions: [
        { label: 'Mark Complete', name: 'complete' }
    ]}}
];

export default class SecurityMDCSecurityDetail extends LightningElement {
    @api securityId;

    @track security           = null;
    @track actions            = [];
    @track isLoading          = true;
    @track errorMessage       = '';
    @track editingFields      = {};
    @track editValues         = {};
    @track showNewActionModal = false;
    @track newActionField     = '';
    @track newActionPriority  = 'Normal';

    costColumns   = COST_COLUMNS;
    actionColumns = ACTION_COLUMNS;

    priorityOptions = [
        { label: 'High',   value: 'High' },
        { label: 'Normal', value: 'Normal' }
    ];

    connectedCallback() {
        if (this.securityId) this.load();
    }

    load() {
        this.isLoading = true;
        Promise.all([
            getSecurityDetail({ securityId: this.securityId }),
            getDataQualityActions({ securityId: this.securityId })
        ])
            .then(([sec, acts]) => {
                this.security     = sec;
                this.actions      = acts;
                this.isLoading    = false;
                this.errorMessage = '';
                this.dispatchEvent(new CustomEvent('securitynameresolved', {
                    detail: { securityName: sec?.securityName || '' },
                    bubbles: true,
                    composed: true
                }));
            })
            .catch(err => {
                this.errorMessage = err?.body?.message ?? 'Failed to load security detail.';
                this.isLoading    = false;
            });
    }

    handleBack() {
        this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }));
    }

    // ── inline edit ─────────────────────────────────────────────────────────

    handleFieldEdit(event) {
        const field = event.currentTarget.dataset.field;
        this.editingFields = { ...this.editingFields, [field]: true };
        this.editValues    = { ...this.editValues,    [field]: this.security[field] ?? '' };
    }

    handleFieldChange(event) {
        const field = event.currentTarget.dataset.field;
        this.editValues = { ...this.editValues, [field]: event.detail.value };
    }

    handleFieldCancel(event) {
        const field = event.currentTarget.dataset.field;
        const ef = { ...this.editingFields };
        delete ef[field];
        this.editingFields = ef;
    }

    handleFieldSave(event) {
        const field    = event.currentTarget.dataset.field;
        const newValue = String(this.editValues[field] ?? '');
        updateSecurityField({
            securityId:   this.securityId,
            fieldApiName: field,
            newValue:     newValue,
            closeActionId: null
        })
            .then(() => {
                this.security = { ...this.security, [field]: this.editValues[field] ?? '' };
                const ef = { ...this.editingFields };
                delete ef[field];
                this.editingFields = ef;
                this.dispatchEvent(new CustomEvent('fieldupdated', { bubbles: true, composed: true }));
                this.toast('Saved', `${field} updated.`, 'success');
            })
            .catch(err => this.toast('Error', err?.body?.message ?? 'Save failed.', 'error'));
    }

    // ── new action modal ─────────────────────────────────────────────────────

    handleNewAction()         { this.showNewActionModal = true; }
    closeNewActionModal()     { this.showNewActionModal = false; this.newActionField = ''; this.newActionPriority = 'Normal'; }
    handleNewActionField(e)   { this.newActionField    = e.detail.value; }
    handleNewActionPriority(e){ this.newActionPriority = e.detail.value; }

    handleCreateAction() {
        if (!this.newActionField) {
            this.toast('Required', 'Enter a field name.', 'warning');
            return;
        }
        createDataQualityAction({
            securityId:   this.securityId,
            fieldLabel:   this.newActionField,
            fieldApiName: this.newActionField,
            priority:     this.newActionPriority
        })
            .then(() => {
                this.closeNewActionModal();
                this.toast('Created', 'Action created.', 'success');
                return getDataQualityActions({ securityId: this.securityId });
            })
            .then(acts => { this.actions = acts; })
            .catch(err => this.toast('Error', err?.body?.message ?? 'Create failed.', 'error'));
    }

    handleActionRowAction(event) {
        const { name } = event.detail.action;
        if (name === 'complete') {
            const taskId = event.detail.row.taskId;
            completeAction({ taskId })
                .then(() => {
                    this.actions = this.actions.filter(a => a.taskId !== taskId);
                    this.security = { ...this.security, openActionCount: Math.max(0, (this.security.openActionCount || 1) - 1) };
                    this.toast('Done', 'Action completed.', 'success');
                })
                .catch(err => this.toast('Error', err?.body?.message ?? 'Failed.', 'error'));
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    get hasError()   { return !!this.errorMessage; }
    get hasCosts()   { return this.security?.costs?.length > 0; }
    get hasActions() { return this.actions?.length > 0; }

    get completenessStyle() {
        const s = this.security?.completenessScore ?? 0;
        const color = s >= 95 ? '#2e844a' : s >= 80 ? '#f2a73b' : '#ba0517';
        return `color:${color};`;
    }

    get openActionsLabel() {
        const n = this.security?.openActionCount ?? 0;
        return `${n} open action${n !== 1 ? 's' : ''}`;
    }

    get actionsBadgeClass() {
        const n = this.security?.openActionCount ?? 0;
        return n > 0 ? 'badge-warning' : '';
    }

    // Field group builders ──────────────────────────────────────────────────

    _buildField(key, label, opts = {}) {
        const val      = this.security?.[key] ?? null;
        const missing  = val === null || val === '';
        return {
            key,
            label,
            displayValue: missing ? '—' : String(val),
            valueClass:   missing ? 'slds-text-color_weak' : '',
            editing:      !!this.editingFields[key],
            editValue:    this.editValues[key] ?? val ?? '',
            ...opts
        };
    }

    get identityFields() {
        if (!this.security) return [];
        return [
            this._buildField('securityName',    'Security Name'),
            this._buildField('isin',            'ISIN'),
            this._buildField('symbol',          'Symbol'),
            this._buildField('securityId',      'Security ID'),
            this._buildField('cusip',           'CUSIP'),
            this._buildField('securitiesName',  'Securities Name'),
            this._buildField('sourceSystemId',  'Source System ID')
        ];
    }

    get classificationFields() {
        if (!this.security) return [];
        return [
            this._buildField('assetClassCode',    'Asset Class Code'),
            this._buildField('assetClass',        'Asset Class'),
            this._buildField('assetCategory',     'Asset Category'),
            this._buildField('assetCategoryName', 'Asset Category Name'),
            this._buildField('exchange',          'Exchange')
        ];
    }

    get custodianFields() {
        if (!this.security) return [];
        return [
            this._buildField('classificationNO',       'Classification NO'),
            this._buildField('classificationSE',       'Classification SE'),
            this._buildField('classificationDK',       'Classification DK'),
            this._buildField('classificationNordnet',  'Classification Nordnet'),
            this._buildField('classificationFIFO',     'Classification FIFO'),
            this._buildField('classificationWisetalk', 'Classification Wisetalk')
        ];
    }

    get marketFields() {
        if (!this.security) return [];
        return [
            this._buildField('price',       'Price'),
            this._buildField('lastUpdated', 'Last Updated'),
            this._buildField('percentage',  'Percentage'),
            this._buildField('implementationPlanName', 'Implementation Plan'),
            this._buildField('ownerName',   'Owner')
        ];
    }
}
