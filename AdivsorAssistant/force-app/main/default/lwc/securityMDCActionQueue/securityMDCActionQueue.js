import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getDataQualityActions from '@salesforce/apex/SecurityMDCController.getDataQualityActions';
import completeAction from '@salesforce/apex/SecurityMDCController.completeAction';

const COLUMNS = [
    { label: 'Security',  fieldName: 'securityName', type: 'text', sortable: true },
    { label: 'Subject',   fieldName: 'subject',      type: 'text', sortable: true },
    { label: 'Priority',  fieldName: 'priority',     type: 'text', sortable: true },
    { label: 'Due Date',  fieldName: 'activityDate', type: 'date', sortable: true,
      typeAttributes: { year: 'numeric', month: 'short', day: '2-digit' } },
    { label: 'Status',    fieldName: 'status',       type: 'text', sortable: true },
    { type: 'action', typeAttributes: { rowActions: [
        { label: 'Mark Complete', name: 'complete' },
        { label: 'View Security', name: 'view' }
    ]}}
];

export default class SecurityMDCActionQueue extends LightningElement {
    @track isLoading      = true;
    @track errorMessage   = '';
    @track searchTerm     = '';
    @track priorityFilter = '';
    @track sortedBy       = 'activityDate';
    @track sortedDirection = 'asc';

    _allRows = [];
    columns  = COLUMNS;

    priorityOptions = [
        { label: 'All',    value: '' },
        { label: 'High',   value: 'High' },
        { label: 'Normal', value: 'Normal' }
    ];

    connectedCallback() {
        this.load();
    }

    load() {
        this.isLoading = true;
        getDataQualityActions({ securityId: null })
            .then(rows => {
                this._allRows     = rows;
                this.isLoading    = false;
                this.errorMessage = '';
            })
            .catch(err => {
                this.errorMessage = err?.body?.message ?? 'Failed to load actions.';
                this.isLoading    = false;
            });
    }

    handleSearch(event) { this.searchTerm = event.detail.value; }

    handlePriorityChange(event) { this.priorityFilter = event.detail.value; }

    handleSort(event) {
        this.sortedBy        = event.detail.fieldName;
        this.sortedDirection = event.detail.sortDirection;
    }

    handleRowAction(event) {
        const { name } = event.detail.action;
        const row       = event.detail.row;
        if (name === 'complete') {
            completeAction({ taskId: row.taskId })
                .then(() => {
                    this._allRows = this._allRows.filter(r => r.taskId !== row.taskId);
                    this.dispatchEvent(new ShowToastEvent({
                        title: 'Done', message: 'Action marked complete.', variant: 'success'
                    }));
                })
                .catch(err => this.dispatchEvent(new ShowToastEvent({
                    title: 'Error', message: err?.body?.message ?? 'Failed.', variant: 'error'
                })));
        } else if (name === 'view') {
            this.dispatchEvent(new CustomEvent('securityselected', {
                detail: { recordId: row.securityId },
                bubbles: true,
                composed: true
            }));
        }
    }

    get displayRows() {
        let rows = [...this._allRows];
        const search = this.searchTerm.toLowerCase();
        if (search) {
            rows = rows.filter(r =>
                (r.subject      ?? '').toLowerCase().includes(search) ||
                (r.securityName ?? '').toLowerCase().includes(search)
            );
        }
        if (this.priorityFilter) {
            rows = rows.filter(r => r.priority === this.priorityFilter);
        }
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

    get hasRows()       { return this.displayRows.length > 0; }
    get hasError()      { return !!this.errorMessage; }
    get rowCountLabel() {
        const t = this._allRows.length, d = this.displayRows.length;
        return d === t ? `${t} open actions` : `${d} of ${t} open actions`;
    }
}
