import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

export default class SecurityMasterDataCenter extends LightningElement {
    @api defaultTab = 'overview';

    @track activeTab             = 'overview';
    @track selectedSecurityId    = null;
    @track selectedSecurityName  = '';
    @track pendingSearch         = '';

    overviewKey   = 0;
    securitiesKey = 0;
    actionsKey    = 0;
    progressKey   = 0;

    connectedCallback() {
        if (this.defaultTab) this.activeTab = this.defaultTab;
    }

    // ── tab navigation ────────────────────────────────────────────

    handleTabClick(event) {
        this.activeTab = event.currentTarget.dataset.tab;
    }

    goToDetail()     { this.activeTab = 'detail'; }
    goToSecurities() { this.activeTab = 'securities'; }

    // ── security selection ────────────────────────────────────────

    handleSecuritySelected(event) {
        this.selectedSecurityId   = event.detail.recordId;
        this.selectedSecurityName = event.detail.securityName || '';
        this.activeTab            = 'detail';
    }

    handleSecurityNameResolved(event) {
        this.selectedSecurityName = event.detail.securityName || '';
    }

    handleBackToList() {
        this.activeTab = 'securities';
    }

    // ── other events ──────────────────────────────────────────────

    handleSecurityFilter(event) {
        this.pendingSearch = event.detail.searchTerm || '';
        this.activeTab     = 'securities';
    }

    handleShowTab(event) {
        this.activeTab = event.detail.tab;
    }

    handleFieldUpdated() {
        this.overviewKey  += 1;
        this.progressKey  += 1;
    }

    handleRefresh() {
        this.overviewKey   += 1;
        this.securitiesKey += 1;
        this.actionsKey    += 1;
        this.progressKey   += 1;
        this.dispatchEvent(new ShowToastEvent({
            title: 'Refreshed',
            message: 'Security data reloaded.',
            variant: 'success',
            mode: 'dismissable'
        }));
    }

    // ── getters ───────────────────────────────────────────────────

    get isOverview()   { return this.activeTab === 'overview'; }
    get isSecurities() { return this.activeTab === 'securities'; }
    get isDetail()     { return this.activeTab === 'detail'; }
    get isActions()    { return this.activeTab === 'actions'; }
    get isProgress()   { return this.activeTab === 'progress'; }

    get selectedSecurityShort() {
        const name = this.selectedSecurityName;
        return name && name.length > 20 ? name.slice(0, 20) + '…' : name;
    }

    _tabCls(tab) {
        return `smc-tab${this.activeTab === tab ? ' smc-tab--active' : ''}`;
    }
    get tabCls0() { return this._tabCls('overview'); }
    get tabCls1() { return this._tabCls('securities'); }
    get tabCls2() { return this._tabCls('detail'); }
    get tabCls3() { return this._tabCls('actions'); }
    get tabCls4() { return this._tabCls('progress'); }
}
