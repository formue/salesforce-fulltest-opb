import { LightningElement, api, track } from 'lwc';
import { FlowAttributeChangeEvent, FlowNavigationNextEvent } from 'lightning/flowSupport';
import getHoldingsForStrategy from '@salesforce/apex/StrategyAllocationHubController.getHoldingsForStrategy';

// All percentages in the data contract are decimal fractions: 0.06 = 6 %.
// lightning-datatable type:'percent' multiplies by 100 internally.

const OVERVIEW_COLUMNS = [
    { label: 'Status',       fieldName: 'statusLabel',  sortable: true,
      cellAttributes: { class: { fieldName: 'driftClass' } } },
    { label: 'Customer',     fieldName: 'customerName', sortable: true },
    { label: 'Advisor',      fieldName: 'ownerName',    sortable: true },
    { label: 'Department',   fieldName: 'department',   sortable: true },
    { label: 'Asset Class',  fieldName: 'assetClass',   sortable: true },
    { label: 'Actual %',  fieldName: 'actualPct', type: 'percent', sortable: true,
      typeAttributes: { maximumFractionDigits: 1 },
      cellAttributes: { class: { fieldName: 'driftClass' } } },
    { label: 'Target %',  fieldName: 'targetPct', type: 'percent', sortable: true,
      typeAttributes: { maximumFractionDigits: 1 } },
    { label: 'Drift %',   fieldName: 'driftPct',  type: 'percent', sortable: true,
      typeAttributes: { maximumFractionDigits: 1 },
      cellAttributes: { class: { fieldName: 'driftClass' } } },
    { label: 'Action Amount', fieldName: 'actionAmount', type: 'currency', sortable: true,
      typeAttributes: { currencyCode: { fieldName: 'currencyCode' }, maximumFractionDigits: 0 } }
];

const HOLDING_COLUMNS = [
    { label: 'Product',      fieldName: 'productName' },
    { label: 'Asset Class',  fieldName: 'assetClass' },
    { label: 'Market Value', fieldName: 'marketValue', type: 'currency',
      typeAttributes: { currencyCode: { fieldName: 'currencyCode' }, maximumFractionDigits: 0 } }
];

export default class StrategyAllocationHub extends LightningElement {
    // ── Flow inputs ──────────────────────────────────────────────────────────
    @api portfolioDataStr = '[]';
    @api defaultAssetClass = '';

    // ── Flow outputs (published via FlowAttributeChangeEvent only) ──────────
    @api selectedBuyerId;
    @api selectedSellerId;
    @api tradeVolume;
    @api isMatchConfirmed = false;

    // ── Internal state ───────────────────────────────────────────────────────
    @track driftThreshold    = 5.0;
    @track allData           = [];
    @track buyers            = [];
    @track sellers           = [];
    @track selectedBuyer          = null;
    @track selectedSeller         = null;
    @track selectedSellerProducts = []; // HoldingRows chosen on seller side (multi-select)
    @track assetClassOptions = [];
    @track departmentOptions = [];
    @track advisorOptions    = [];
    @track selectedAssetClass = '';
    @track selectedDepartment = '';
    @track selectedAdvisor    = '';
    @track selectionWarning  = '';
    @track sortedBy          = 'driftPct';
    @track sortedDirection   = 'desc';
    @track isLoading             = true;
    @track buyerPage             = 1;
    @track sellerPage            = 1;
    @track loadedHoldings        = {};   // rowId → HoldingRow[]
    @track loadingRowId          = null; // rowId currently fetching
    @track actionPanelCollapsed  = false;

    PAGE_SIZE = 20;

    // Primitive — no @track needed; direct assignment triggers re-render
    expandedBuyerRowId  = null;
    expandedSellerRowId = null;

    overviewColumns = OVERVIEW_COLUMNS;
    holdingColumns  = HOLDING_COLUMNS;

    // ── Lifecycle ────────────────────────────────────────────────────────────

    connectedCallback() {
        try {
            const raw = JSON.parse(this.portfolioDataStr || '[]');
            this.allData = raw.map((row, i) => ({
                ...row,
                rowId: `${row.accountId || i}|${row.assetClass || ''}|${i}`,
                initials: (row.customerName || '?').split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase().substring(0, 2)
            }));
        } catch (e) {
            console.error('[strategyAllocationHub] Failed to parse portfolioDataStr', e);
            this.allData = [];
        }

        this._buildFilterOptions();

        if (this.defaultAssetClass) {
            this.selectedAssetClass = this.defaultAssetClass;
        }

        this.calculateBorders();
        this.isLoading = false;
    }

    // ── Computed getters ─────────────────────────────────────────────────────

    get filteredData() {
        let data = this.allData;
        if (this.selectedAssetClass) data = data.filter(r => r.assetClass === this.selectedAssetClass);
        if (this.selectedDepartment) data = data.filter(r => r.department === this.selectedDepartment);
        if (this.selectedAdvisor)    data = data.filter(r => r.ownerId === this.selectedAdvisor);
        return data;
    }

    get overviewRows() {
        const t = this.driftThreshold / 100;
        return this.filteredData
            .map(row => {
                const outsideBounds = row.lowerBoundPct > 0 || row.upperBoundPct > 0
                    ? row.actualPct < row.lowerBoundPct || row.actualPct > row.upperBoundPct
                    : Math.abs(row.driftPct) > t;
                const driftClass = outsideBounds
                    ? (row.driftPct > 0 ? 'slds-text-color_error' : 'slds-text-color_success')
                    : 'slds-text-color_weak';
                const statusLabel = outsideBounds
                    ? (row.driftPct > 0 ? '▲ Sell' : '▼ Buy')
                    : '– Hold';
                return { ...row, driftClass, statusLabel, outsideBounds };
            })
            .filter(r => r.outsideBounds);
    }

    get portfoliosAnalysed() { return this.filteredData.length; }

    get withinBordersCount() {
        const t = this.driftThreshold / 100;
        return this.filteredData.filter(r => {
            if (r.lowerBoundPct > 0 || r.upperBoundPct > 0) {
                return r.actualPct >= r.lowerBoundPct && r.actualPct <= r.upperBoundPct;
            }
            return Math.abs(r.driftPct) <= t;
        }).length;
    }

    get buyersCount()  { return this.buyers.length; }
    get sellersCount() { return this.sellers.length; }

    get showMatchPrompt() {
        return !this.selectedAssetClass && this.allData.length > 0;
    }

    get showActionPanel() {
        return this.selectedBuyer != null && this.selectedSellerProducts.length > 0;
    }

    get selectedSellVolume() {
        return this.selectedSellerProducts.reduce((s, p) => s + (p.marketValue || 0), 0);
    }

    get selectedSellerProductCount() {
        return this.selectedSellerProducts.length;
    }

    get calculatedTradeVolume() {
        if (!this.showActionPanel) return 0;
        return Math.min(this.selectedSellVolume, this.selectedBuyer.actionAmount || 0);
    }

    get tradeCurrencyCode() {
        return this.selectedBuyer != null ? (this.selectedBuyer.currencyCode || 'NOK') : 'NOK';
    }

    get hasSelectionWarning() { return Boolean(this.selectionWarning); }

    get mainContentClass() {
        return 'main-content slds-p-horizontal_medium slds-p-bottom_medium' +
               (this.showActionPanel ? ' main-content--panel-open' : '');
    }

    get actionPanelClass() {
        return 'action-card' + (this.actionPanelCollapsed ? ' action-card--collapsed' : '');
    }

    get actionCollapseLabel() {
        return this.actionPanelCollapsed ? '▲' : '▼';
    }

    get actionPanelSummary() {
        if (!this.selectedSellerProducts.length || !this.selectedBuyer) return '';
        const sellerRow = this.expandedSellerRow;
        const sellerLabel = sellerRow ? sellerRow.customerName : 'seller';
        const n   = this.selectedSellerProducts.length;
        const vol = this._formatVolume(this.calculatedTradeVolume);
        const products = n === 1
            ? this.selectedSellerProducts[0].productName
            : n + ' products';
        return sellerLabel + ' (' + products + ') → ' + this.selectedBuyer.customerName + ' · ' + vol;
    }

    _formatVolume(v) {
        if (v >= 1e9) return 'NOK ' + (v / 1e9).toFixed(1) + 'b';
        if (v >= 1e6) return 'NOK ' + (v / 1e6).toFixed(1) + 'm';
        if (v >= 1e3) return 'NOK ' + (v / 1e3).toFixed(0) + 'k';
        return 'NOK ' + v;
    }

    get totalBuyVolume()  { return this.buyers.reduce((s, r) => s + (r.actionAmount || 0), 0); }
    get totalSellVolume() { return this.sellers.reduce((s, r) => s + (r.actionAmount || 0), 0); }

    get indicativeVolume() { return Math.min(this.totalBuyVolume, this.totalSellVolume); }

    get indicativeVolumeFormatted() {
        const v = this.indicativeVolume;
        if (v >= 1e9) return 'NOK ' + (v / 1e9).toFixed(1) + 'b';
        if (v >= 1e6) return 'NOK ' + (v / 1e6).toFixed(1) + 'm';
        if (v >= 1e3) return 'NOK ' + (v / 1e3).toFixed(0) + 'k';
        return 'NOK ' + v;
    }

    // ── Action panel — product comparison ───────────────────────────────────

    get selectedSellerHoldings() {
        if (!this.expandedSellerRowId) return [];
        return this.loadedHoldings[this.expandedSellerRowId] || [];
    }

    get selectedBuyerHoldings() {
        if (!this.selectedBuyer) return [];
        return this.loadedHoldings[this.selectedBuyer.rowId] || [];
    }

    get sellerHoldingsLoaded() {
        return this.expandedSellerRowId != null &&
               this.loadedHoldings[this.expandedSellerRowId] !== undefined;
    }

    get buyerHoldingsLoaded() {
        return this.selectedBuyer != null &&
               this.loadedHoldings[this.selectedBuyer.rowId] !== undefined;
    }

    get showProductComparison() {
        return this.selectedSellerProducts.length > 0 || this.buyerHoldingsLoaded;
    }

    // For template iteration — avoids calling getter with .length in template
    get selectedSellerProductsForPanel() {
        return this.selectedSellerProducts;
    }

    get buyerHoldingsEmpty() {
        return this.buyerHoldingsLoaded && this.selectedBuyerHoldings.length === 0;
    }

    get sellerHoldingsEmpty() {
        return this.sellerHoldingsLoaded && this.selectedSellerHoldings.length === 0;
    }

    // seller row that owns the currently expanded panel (for action panel sell-side display)
    get expandedSellerRow() {
        if (!this.expandedSellerRowId) return null;
        return this.sellers.find(r => r.rowId === this.expandedSellerRowId) || null;
    }

    // ── Pagination getters ───────────────────────────────────────────────────

    get buyerPageCount()  { return Math.max(1, Math.ceil(this.buyers.length  / this.PAGE_SIZE)); }
    get sellerPageCount() { return Math.max(1, Math.ceil(this.sellers.length / this.PAGE_SIZE)); }

    get buyerPageLabel()  { return 'Page ' + this.buyerPage  + ' / ' + this.buyerPageCount;  }
    get sellerPageLabel() { return 'Page ' + this.sellerPage + ' / ' + this.sellerPageCount; }

    get buyerRangeLabel() {
        const from = (this.buyerPage - 1) * this.PAGE_SIZE + 1;
        const to   = Math.min(this.buyerPage * this.PAGE_SIZE, this.buyers.length);
        return this.buyers.length === 0 ? 'No results' : from + '–' + to + ' of ' + this.buyers.length;
    }
    get sellerRangeLabel() {
        const from = (this.sellerPage - 1) * this.PAGE_SIZE + 1;
        const to   = Math.min(this.sellerPage * this.PAGE_SIZE, this.sellers.length);
        return this.sellers.length === 0 ? 'No results' : from + '–' + to + ' of ' + this.sellers.length;
    }

    get buyerPrevDisabled()  { return this.buyerPage  <= 1; }
    get buyerNextDisabled()  { return this.buyerPage  >= this.buyerPageCount;  }
    get sellerPrevDisabled() { return this.sellerPage <= 1; }
    get sellerNextDisabled() { return this.sellerPage >= this.sellerPageCount; }

    get pagedEnrichedBuyers() {
        const start = (this.buyerPage - 1) * this.PAGE_SIZE;
        const slice = this.buyers.slice(start, start + this.PAGE_SIZE);
        return slice.map(r => {
            const isExpanded = r.rowId === this.expandedBuyerRowId;
            const isSelected = this.selectedBuyer != null && this.selectedBuyer.rowId === r.rowId;
            return { ...this._enrichRow(r), isExpanded, isSelected,
                     chevronSymbol: isExpanded ? '↑' : '›',
                     rowClass: 'client-row' + (isSelected ? ' selected' : '') };
        });
    }

    get pagedEnrichedSellers() {
        const start = (this.sellerPage - 1) * this.PAGE_SIZE;
        const slice = this.sellers.slice(start, start + this.PAGE_SIZE);
        const selectedIds = new Set(this.selectedSellerProducts.map(p => p.holdingId));
        return slice.map(r => {
            const isExpanded = r.rowId === this.expandedSellerRowId;
            const isSelected = this.selectedSeller != null && this.selectedSeller.rowId === r.rowId;
            const enriched   = this._enrichRow(r);
            const holdings = (enriched.holdings || []).map(h => ({
                ...h,
                isSelectedProduct: selectedIds.has(h.holdingId),
                productRowClass: 'product-row product-row--sell' +
                    (selectedIds.has(h.holdingId) ? ' product-row--selected' : ' product-row--selectable')
            }));
            const selectedCount = holdings.filter(h => h.isSelectedProduct).length;
            return {
                ...enriched, isExpanded, isSelected, holdings, selectedCount,
                selectedCountLabel: selectedCount > 0 ? selectedCount + ' selected' : '',
                chevronSymbol: isExpanded ? '↑' : '›',
                rowClass: 'client-row' + (isSelected ? ' selected' : '')
            };
        });
    }

    _enrichRow(r) {
        const driftSign = r.driftPct >= 0 ? '+' : '';
        const isBuyer   = r.driftPct < 0;
        const distanceFraction = r.targetPct > 0 ? Math.abs(r.driftPct) / r.targetPct : 0;
        const confidence = Math.min(99, Math.max(62, Math.round(62 + distanceFraction * 60)));
        const keyIssue = isBuyer
            ? `${r.assetClass || 'Position'} below target; ${(r.actualPct * 100).toFixed(1)}% actual vs ${(r.targetPct * 100).toFixed(1)}% target.`
            : `${r.assetClass || 'Position'} above target; ${(r.actualPct * 100).toFixed(1)}% actual vs ${(r.targetPct * 100).toFixed(1)}% target.`;
        return {
            ...r,
            confidence,
            confidenceLabel: confidence + '% confidence',
            keyIssue,
            driftDisplay:    driftSign + (r.driftPct * 100).toFixed(1) + '%',
            actualDisplay:   (r.actualPct * 100).toFixed(1) + '%',
            targetDisplay:   (r.targetPct * 100).toFixed(1) + '%',
            actualBarWidth:  Math.min(100, Math.round(r.actualPct * 100)) + '%',
            targetBarLeft:   Math.min(100, Math.round(r.targetPct * 100)) + '%',
            lowerBarLeft:    Math.min(100, Math.round((r.lowerBoundPct || 0) * 100)) + '%',
            upperBarLeft:    Math.min(100, Math.round((r.upperBoundPct || 0) * 100)) + '%',
            hasBounds:       (r.lowerBoundPct > 0 || r.upperBoundPct > 0),
            holdings:        this.loadedHoldings[r.rowId] || [],
            holdingsLoading: this.loadingRowId === r.rowId,
            hasHoldings:     (this.loadedHoldings[r.rowId] || []).length > 0,
            expansionKey:    r.rowId + '_panel'
        };
    }

    // ── Event handlers ───────────────────────────────────────────────────────

    handleThresholdChange(event) {
        this.driftThreshold = parseFloat(event.target.value);
        this.calculateBorders();
    }

    handleAssetClassChange(event) {
        this.selectedAssetClass = event.detail.value;
        this.selectionWarning   = '';
        this.calculateBorders();
    }

    handleDepartmentChange(event) {
        this.selectedDepartment = event.detail.value;
        this.selectedAdvisor    = '';
        this._buildAdvisorOptions();
        this.selectionWarning   = '';
        this.calculateBorders();
    }

    handleAdvisorChange(event) {
        this.selectedAdvisor  = event.detail.value;
        this.selectionWarning = '';
        this.calculateBorders();
    }

    handleOverviewSort(event) {
        const { fieldName, sortDirection } = event.detail;
        this.sortedBy        = fieldName;
        this.sortedDirection = sortDirection;
        this.allData = [...this.allData].sort((a, b) => {
            const dir = sortDirection === 'asc' ? 1 : -1;
            const av  = a[fieldName];
            const bv  = b[fieldName];
            if (av == null) return dir;
            if (bv == null) return -dir;
            return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * dir;
        });
    }

    handleBuyerRowClick(event) {
        const rowId = event.currentTarget.dataset.rowid;
        const row   = this.buyers.find(r => r.rowId === rowId);
        if (!row) return;
        const wasExpanded       = this.expandedBuyerRowId === rowId;
        this.expandedBuyerRowId = wasExpanded ? null : rowId;
        if (wasExpanded) {
            this.selectedBuyer = null; // collapse = deselect
        } else {
            this.selectedBuyer = row;
            this.actionPanelCollapsed = false;
            if (this.loadedHoldings[rowId] === undefined) {
                this._loadHoldings(rowId, row.strategyId, row.assetClass);
            }
        }
        this.selectionWarning = '';
    }

    handleSellerRowClick(event) {
        const rowId = event.currentTarget.dataset.rowid;
        const row   = this.sellers.find(r => r.rowId === rowId);
        if (!row) return;
        const wasExpanded        = this.expandedSellerRowId === rowId;
        this.expandedSellerRowId = wasExpanded ? null : rowId;
        if (wasExpanded) {
            // collapse → clear everything
            this.selectedSeller         = null;
            this.selectedSellerProducts = [];
        } else {
            // switching to a different row clears previous product selections
            this.selectedSeller         = row;
            this.selectedSellerProducts = [];
            if (this.loadedHoldings[rowId] === undefined) {
                this._loadHoldings(rowId, row.strategyId, row.assetClass);
            }
        }
        this.selectionWarning = '';
    }

    handleSellerProductClick(event) {
        event.stopPropagation(); // don't bubble to row click
        const holdingId = event.currentTarget.dataset.holdingid;
        const rowId     = this.expandedSellerRowId;
        if (!rowId || !holdingId) return;
        const holdings = this.loadedHoldings[rowId] || [];
        const holding  = holdings.find(h => h.holdingId === holdingId);
        if (!holding) return;
        const existing = this.selectedSellerProducts.findIndex(p => p.holdingId === holdingId);
        if (existing >= 0) {
            // deselect
            this.selectedSellerProducts = this.selectedSellerProducts.filter(p => p.holdingId !== holdingId);
        } else {
            // add to selection
            this.selectedSellerProducts = [...this.selectedSellerProducts, holding];
            this.actionPanelCollapsed   = false;
        }
        this.selectionWarning = '';
    }

    handleToggleActionPanel() {
        this.actionPanelCollapsed = !this.actionPanelCollapsed;
    }

    handleBuyerPrev()  { if (this.buyerPage  > 1)                    this.buyerPage--;  }
    handleBuyerNext()  { if (this.buyerPage  < this.buyerPageCount)  this.buyerPage++;  }
    handleSellerPrev() { if (this.sellerPage > 1)                    this.sellerPage--; }
    handleSellerNext() { if (this.sellerPage < this.sellerPageCount) this.sellerPage++; }

    handleProposeMatch() {
        const sellerRow = this.expandedSellerRow;
        this.dispatchEvent(new FlowAttributeChangeEvent('selectedBuyerId',  this.selectedBuyer.accountId));
        this.dispatchEvent(new FlowAttributeChangeEvent('selectedSellerId', sellerRow ? sellerRow.accountId : ''));
        this.dispatchEvent(new FlowAttributeChangeEvent('tradeVolume',      this.calculatedTradeVolume));
        this.dispatchEvent(new FlowAttributeChangeEvent('isMatchConfirmed', true));
        this.dispatchEvent(new FlowNavigationNextEvent());
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    _loadHoldings(rowId, strategyId, assetGroupDisplay) {
        this.loadingRowId = rowId;
        getHoldingsForStrategy({ strategyId, assetGroupDisplay })
            .then(result => {
                const updated = Object.assign({}, this.loadedHoldings);
                updated[rowId] = JSON.parse(result || '[]');
                this.loadedHoldings = updated;
            })
            .catch(e => {
                console.error('[strategyAllocationHub] Failed to load holdings', e);
                const updated = Object.assign({}, this.loadedHoldings);
                updated[rowId] = [];
                this.loadedHoldings = updated;
            })
            .finally(() => {
                if (this.loadingRowId === rowId) this.loadingRowId = null;
            });
    }

    calculateBorders() {
        const data = this.filteredData;
        const t    = this.driftThreshold / 100;
        this.buyers  = data.filter(r =>
            r.lowerBoundPct > 0 ? r.actualPct < r.lowerBoundPct : r.driftPct < -t
        ).sort((a, b) => {
            // furthest below lower bound (or most negative drift) first
            const distA = a.lowerBoundPct > 0 ? a.lowerBoundPct - a.actualPct : -a.driftPct;
            const distB = b.lowerBoundPct > 0 ? b.lowerBoundPct - b.actualPct : -b.driftPct;
            return distB - distA;
        });
        this.sellers = data.filter(r =>
            r.upperBoundPct > 0 ? r.actualPct > r.upperBoundPct : r.driftPct >  t
        ).sort((a, b) => {
            // furthest above upper bound (or most positive drift) first
            const distA = a.upperBoundPct > 0 ? a.actualPct - a.upperBoundPct : a.driftPct;
            const distB = b.upperBoundPct > 0 ? b.actualPct - b.upperBoundPct : b.driftPct;
            return distB - distA;
        });

        this.buyerPage  = 1;
        this.sellerPage = 1;

        if (this.selectedBuyer && !this.buyers.find(r => r.rowId === this.selectedBuyer.rowId)) {
            this.selectedBuyer    = null;
            this.selectionWarning = 'The selected buyer is now within borders and was cleared.';
        }
        if (this.selectedSeller && !this.sellers.find(r => r.rowId === this.selectedSeller.rowId)) {
            this.selectedSeller   = null;
            this.selectionWarning = this.selectionWarning || 'The selected seller is now within borders and was cleared.';
        }
    }

    _buildFilterOptions() {
        const assetSeen = new Set();
        const deptSeen  = new Set();
        const assetOpts = [{ label: 'All asset classes', value: '' }];
        const deptOpts  = [{ label: 'All departments',   value: '' }];

        this.allData.forEach(r => {
            if (r.assetClass && !assetSeen.has(r.assetClass)) {
                assetSeen.add(r.assetClass);
                assetOpts.push({ label: r.assetClass, value: r.assetClass });
            }
            if (r.department && !deptSeen.has(r.department)) {
                deptSeen.add(r.department);
                deptOpts.push({ label: r.department, value: r.department });
            }
        });

        this.assetClassOptions = assetOpts;
        this.departmentOptions = deptOpts;
        this._buildAdvisorOptions();
    }

    _buildAdvisorOptions() {
        const seen = new Set();
        const opts = [{ label: 'All advisors', value: '' }];
        const base = this.selectedDepartment
            ? this.allData.filter(r => r.department === this.selectedDepartment)
            : this.allData;
        base.forEach(r => {
            if (r.ownerName && !seen.has(r.ownerName)) {
                seen.add(r.ownerName);
                opts.push({ label: r.ownerName, value: r.ownerId });
            }
        });
        this.advisorOptions = opts;
    }
}
