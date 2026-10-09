import { LightningElement, api, track, wire } from 'lwc';
import { getPicklistValues, getObjectInfo } from 'lightning/uiObjectInfoApi';
import SECURITIES_OBJECT from '@salesforce/schema/FinServ__Securities__c';
import ASSET_CLASS_CODE_FIELD from '@salesforce/schema/FinServ__Securities__c.AssetClassCode__c';
import getSecuritiesList from '@salesforce/apex/SecurityMDCController.getSecuritiesList';

const COLUMNS = [
    {
        label: 'Security Name',
        fieldName: 'securityName',
        type: 'button',
        typeAttributes: {
            label: { fieldName: 'securityName' },
            name: 'view',
            variant: 'base'
        },
        cellAttributes: { alignment: 'left' },
        sortable: false
    },
    { label: 'ISIN',         fieldName: 'isin',            type: 'text',     sortable: true },
    { label: 'Symbol',       fieldName: 'symbol',          type: 'text',     sortable: true },
    { label: 'Asset Class',  fieldName: 'assetClassCode',  type: 'text',     sortable: true },
    { label: 'Price',        fieldName: 'price',           type: 'currency', sortable: true,
      typeAttributes: { currencyCode: 'NOK', minimumFractionDigits: 2 } },
    { label: 'Completeness', fieldName: 'completenessScore', type: 'number', sortable: true },
    { label: 'Open Actions', fieldName: 'openActionCount',   type: 'number', sortable: true }
];

export default class SecurityMDCSecurities extends LightningElement {
    @api initialSearch      = '';
    @api selectedSecurityId = null;

    @track searchTerm    = '';
    @track typeFilter    = '';
    @track gapsOnly      = false;
    @track isLoading     = true;
    @track errorMessage  = '';
    @track sortedBy      = 'securityName';
    @track sortedDirection = 'asc';

    _allRows   = [];
    _debounceTimer;
    _recordTypeId = null;

    columns = COLUMNS;

    @wire(getObjectInfo, { objectApiName: SECURITIES_OBJECT })
    objectInfo({ data }) {
        if (data) this._recordTypeId = data.defaultRecordTypeId;
    }

    @wire(getPicklistValues, {
        recordTypeId: '$_recordTypeId',
        fieldApiName: ASSET_CLASS_CODE_FIELD
    })
    assetClassPicklist;

    connectedCallback() {
        if (this.initialSearch) this.searchTerm = this.initialSearch;
        this.loadList();
    }

    loadList() {
        this.isLoading = true;
        getSecuritiesList({
            searchTerm: this.searchTerm || null,
            typeFilter: this.typeFilter || null
        })
            .then(rows => {
                this._allRows   = rows.map(r => ({
                    ...r,
                    completenessClass: this.scoreClass(r.completenessScore)
                }));
                this.isLoading  = false;
                this.errorMessage = '';
            })
            .catch(err => {
                this.errorMessage = err?.body?.message ?? 'Failed to load securities.';
                this.isLoading    = false;
            });
    }

    handleSearch(event) {
        this.searchTerm = event.detail.value;
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this.loadList(), 300);
    }

    handleTypeChange(event) {
        this.typeFilter = event.detail.value;
        this.loadList();
    }

    handleGapsToggle(event) {
        this.gapsOnly = event.detail.checked;
    }

    handleRowAction(event) {
        const { name } = event.detail.action;
        const row = event.detail.row;
        if (name === 'view') {
            this.dispatchEvent(new CustomEvent('securityselected', {
                detail: { recordId: row.id, securityName: row.securityName || '' },
                bubbles: true,
                composed: true
            }));
        }
    }

    get selectedRowIds() {
        return this.selectedSecurityId ? [this.selectedSecurityId] : [];
    }

    handleSort(event) {
        this.sortedBy        = event.detail.fieldName;
        this.sortedDirection = event.detail.sortDirection;
    }

    get displayRows() {
        let rows = this.gapsOnly
            ? this._allRows.filter(r => r.completenessScore < 100)
            : [...this._allRows];

        const dir = this.sortedDirection === 'asc' ? 1 : -1;
        const key = this.sortedBy;
        rows.sort((a, b) => {
            const va = a[key] ?? '';
            const vb = b[key] ?? '';
            if (va < vb) return -1 * dir;
            if (va > vb) return 1  * dir;
            return 0;
        });
        return rows;
    }

    get rowCountLabel() {
        const total   = this._allRows.length;
        const display = this.displayRows.length;
        return display === total ? `${total} records` : `${display} of ${total} records`;
    }

    get hasError() { return !!this.errorMessage; }

    get typeOptions() {
        const base = [{ label: 'All', value: '' }];
        const vals = this.assetClassPicklist?.data?.values ?? [];
        return base.concat(vals.map(v => ({ label: v.label, value: v.value })));
    }

    scoreClass(score) {
        if (score >= 95) return 'slds-text-color_success';
        if (score >= 80) return 'slds-text-color_warning';
        return 'slds-text-color_error';
    }
}
