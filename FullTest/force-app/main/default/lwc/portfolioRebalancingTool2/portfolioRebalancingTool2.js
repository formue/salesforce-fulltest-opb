import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getHoldingsFromFlow from '@salesforce/apex/PortfolioFlowService.getHoldingsFromFlow';
import getAIRecommendationFromFlow from '@salesforce/apex/PortfolioFlowService.getAIRecommendationFromFlow';

const BOUNDARY_LIMIT = 2.0;
const TRADE_THRESHOLD_DEFAULT = 5;
const TRADE_THRESHOLD_CASH = 0;
const INPUT_DEBOUNCE_MS = 400;
const MAX_PORTFOLIO_VALUE = 999999999999;

const ASSETS = [
    { key: 'pm', label: 'Money Market',   color: '#8b5cf6' },
    { key: 'ob', label: 'Bonds',          color: '#3b82f6' },
    { key: 'ak', label: 'Equities',       color: '#10b981' },
    { key: 'hf', label: 'Hedgefund',      color: '#f59e0b' },
    { key: 'ei', label: 'Real Assets',    color: '#ef4444' },
    { key: 'pe', label: 'Private Equity', color: '#ec4899' }
];

const NB_LOCALE = 'nb-NO';
const _nfInt    = new Intl.NumberFormat(NB_LOCALE, { maximumFractionDigits: 0 });
const _nfPct1   = new Intl.NumberFormat(NB_LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const _nfPct2   = new Intl.NumberFormat(NB_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtKr(n)        { return 'kr ' + _nfInt.format(Math.round(n || 0)); }
function fmtTradeKr(n)   { const v = Math.round(n || 0); return (v >= 0 ? '+' : '') + 'kr ' + _nfInt.format(v); }
function fmtPct(val, digits) {
    if (val === null || val === undefined || isNaN(val) || !isFinite(val)) return '—';
    return (digits === 2 ? _nfPct2 : _nfPct1).format(val) + ' %';
}
function fmtDevPct(val) {
    if (val === null || val === undefined || isNaN(val) || !isFinite(val)) return '—';
    return (val >= 0 ? '+' : '') + _nfPct1.format(val) + ' %';
}
function parseThousands(str) {
    if (!str) return null;
    const num = parseFloat(str.replace(/\s/g, '').replace(/,/g, '.').replace(/[^\d.-]/g, ''));
    return isNaN(num) ? null : num;
}
function normalizeClass(raw) {
    if (!raw) return '';
    return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}
function formatAIResponse(text) {
    if (!text) return '';
    let t = String(text);
    t = t.replace(/^### (.*$)/gim, '<h3><strong>$1</strong></h3>');
    t = t.replace(/^## (.*$)/gim, '<h2><strong>$1</strong></h2>');
    t = t.replace(/^# (.*$)/gim, '<h2><strong>$1</strong></h2>');
    t = t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/^\s*[\*\-]\s+(.*$)/gim, '&bull; $1<br/>');
    t = t.replace(/\n/g, '<br/>');
    t = t.replace(/(<br\/>){3,}/g, '<br/><br/>');
    return t;
}

export default class PortfolioRebalancingTool2 extends LightningElement {
    @api recordId;
    @api flowApiName = 'Portfolio_Level_AI_Generation';
    @api promptTemplateApiName = 'Portfolio_Rebalancing_Recommendations';
    @api aiProductFlowApiName = 'Product_Level_AI_Generation';

    @track theme = 'light';
    @track activeTab = 'insights';
    @track isLoading = false;

    total = 0;
    @track weights = {};
    @track values = {};
    @track weightInputs = {};
    @track valueInputs = {};

    @track strategyProductsList = [];
    @track actualAmounts = {};
    @track keepInvestment = {};
    @track cmpExtraProducts = [];
    @track addFormState = {};

    @track expandedCmpRows = {};
    @track expandedOrdRows = {};
    @track manualOverrides = {};
    @track manualTrades = {};
    @track separateMode = false;
    @track roundToThousand = false;

    @track productAiState = {};
    @track aiRecommendationText = '';
    isAiLoading = false;

    _chartDataHash = null;
    _totalInputTimeout = null;

    // ── LIFECYCLE ──────────────────────────────────────────────────
    connectedCallback() {
        const saved = localStorage.getItem('portfolioRebalancerTheme');
        if (saved) this.theme = saved;
        if (this.recordId) this.handleFetchHoldings();
    }

    renderedCallback() {
        const hash = this._getDataHash();
        if (this._chartDataHash !== hash) {
            this._chartDataHash = hash;
            this._drawAllocationChart();
            if (this.activeTab === 'summary') {
                this._drawBeforeAfterChart();
                this._drawChangeChart();
            }
        }
    }

    _getDataHash() {
        try {
            return JSON.stringify({ total: this.total, weights: this.weights, values: this.values, activeTab: this.activeTab, theme: this.theme, actLen: Object.keys(this.actualAmounts || {}).length, trades: this.manualTrades, overrides: this.manualOverrides });
        } catch (e) { return null; }
    }

    _getChartInk(varName) {
        try {
            const root = this.template.querySelector('.tool-container') || this.template.host;
            const val = getComputedStyle(root).getPropertyValue(varName).trim();
            return val || 'rgba(160,170,190,0.9)';
        } catch (e) { return 'rgba(160,170,190,0.9)'; }
    }

    // ── THEME & NAVIGATION ─────────────────────────────────────────
    get containerClass() {
        if (this.theme === 'hc')   return 'tool-container dark hc';
        if (this.theme === 'dark') return 'tool-container dark';
        return 'tool-container';
    }
    get themeLabel() {
        if (this.theme === 'hc')   return 'High Contrast';
        if (this.theme === 'dark') return 'Dark Mode';
        return 'Light Mode';
    }
    get themeSwitchClass() { return `theme-toggle-switch ${this.theme !== 'light' ? 'active' : ''}`; }
    get isThemeToggleOn()  { return this.theme !== 'light'; }
    get themeToggleAriaLabel() {
        const next = { light: 'dark', dark: 'high-contrast', hc: 'light' }[this.theme] || 'dark';
        return `Theme: ${this.themeLabel}. Activate to switch to ${next} theme.`;
    }

    toggleTheme() {
        const cycle = { light: 'dark', dark: 'hc', hc: 'light' };
        this.theme = cycle[this.theme] || 'light';
        localStorage.setItem('portfolioRebalancerTheme', this.theme);
    }
    handleThemeChange(event) {
        this.theme = event.target.value;
        localStorage.setItem('portfolioRebalancerTheme', this.theme);
    }
    handleTabChange(event) { this.activeTab = event.currentTarget.dataset.tab; }

    get activeTabTitle() {
        const t = { insights: 'Portfolio Insights', comparison: 'Product Comparison', rebalancing: 'Rebalancing', orders: 'Rebalancing Orders', ai: 'AI Engine', analytics: 'Analytics', summary: 'Summary', settings: 'Settings' };
        return t[this.activeTab] || 'Portfolio Insights';
    }

    get insightsTabClass()    { return `nav-item ${this.activeTab === 'insights'    ? 'active' : ''}`; }
    get comparisonTabClass()  { return `nav-item ${this.activeTab === 'comparison'  ? 'active' : ''}`; }
    get rebalancingTabClass() { return `nav-item ${this.activeTab === 'rebalancing' ? 'active' : ''}`; }
    get ordersTabClass()      { return `nav-item ${this.activeTab === 'orders'      ? 'active' : ''}`; }
    get aiTabClass()          { return `nav-item ${this.activeTab === 'ai'          ? 'active' : ''}`; }
    get analyticsTabClass()   { return `nav-item ${this.activeTab === 'analytics'   ? 'active' : ''}`; }
    get summaryTabClass()     { return `nav-item ${this.activeTab === 'summary'     ? 'active' : ''}`; }
    get settingsTabClass()    { return `nav-item ${this.activeTab === 'settings'    ? 'active' : ''}`; }

    get isInsightsTab()    { return this.activeTab === 'insights'; }
    get isComparisonTab()  { return this.activeTab === 'comparison'; }
    get isRebalancingTab() { return this.activeTab === 'rebalancing'; }
    get isOrdersTab()      { return this.activeTab === 'orders'; }
    get isAiTab()          { return this.activeTab === 'ai'; }
    get isAnalyticsTab()   { return this.activeTab === 'analytics'; }
    get isSummaryTab()     { return this.activeTab === 'summary'; }
    get isSettingsTab()    { return this.activeTab === 'settings'; }

    get showFetchButton()  { return this.activeTab === 'insights'; }
    get showExportButton() { return this.activeTab === 'orders' && this.orderData.hasOrders; }
    get showAIButton()     { return this.activeTab === 'ai' && this.hasHoldings; }
    get isExportDisabled() { return !this.orderData.hasOrders || this.isLoading; }
    get isAIDisabled()     { return !this.hasHoldings || this.isAiLoading; }

    // ── DATA STATE ─────────────────────────────────────────────────
    get hasHoldings()          { return this.total > 0 || Object.keys(this.actualAmounts || {}).length > 0; }
    get hasAIRecommendations() { return !!this.aiRecommendationText; }
    get hasComparisonData()    { return this.comparisonSections.some(s => s.hasRows); }
    get hasOrders()            { return this.orderData.hasOrders; }
    get hasOverrides()         { return Object.keys(this.manualOverrides).length > 0; }

    // ── HERO INPUT ─────────────────────────────────────────────────
    get formattedTotalValue() { return this.total > 0 ? _nfInt.format(this.total) : ''; }
    get hasPortfolioDrift()   { return this.hasHoldings && this.total > 0; }

    get portfolioDrift() {
        if (this.total === 0) return '0,00%';
        let totalDrift = 0;
        ASSETS.forEach(a => {
            const w = this.weights[a.key] || 0;
            const v = this.values[a.key] || 0;
            totalDrift += Math.abs((this.total > 0 ? (v / this.total) * 100 : 0) - w);
        });
        return _nfPct2.format(totalDrift / ASSETS.length) + '%';
    }

    get heroDriftClass() {
        const d = parseFloat(this.portfolioDrift.replace(',', '.'));
        if (d > 5) return 'hero-drift-value hero-drift-high';
        if (d > 2) return 'hero-drift-value hero-drift-medium';
        return 'hero-drift-value hero-drift-low';
    }

    // ── ASSET ALLOCATION TABLE ─────────────────────────────────────
    get detailedAssetAllocation() {
        return ASSETS.map(a => {
            const targetPct  = this.weights[a.key] || 0;
            const actualValue = this.values[a.key] || 0;
            const actualPct  = this.total > 0 ? (actualValue / this.total) * 100 : 0;
            const targetAmt  = this.total > 0 && targetPct > 0 ? this.total * targetPct / 100 : 0;
            const deviation  = actualPct - targetPct;
            let deviationClass = 'deviation-neutral';
            if (targetPct > 0)
                deviationClass = Math.abs(deviation) <= BOUNDARY_LIMIT ? 'deviation-ok' : 'deviation-breach';
            return {
                key: a.key, label: a.label,
                dotStyle: `background:${a.color};width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:8px;`,
                targetPct:    targetPct > 0 ? fmtPct(targetPct, 1) : '—',
                boundary:     targetPct > 0 ? `${Math.max(0, targetPct - BOUNDARY_LIMIT).toFixed(1)}% – ${Math.min(100, targetPct + BOUNDARY_LIMIT).toFixed(1)}%` : '—',
                targetAmount: targetAmt  > 0 ? fmtKr(targetAmt) : '—',
                marketValue:  actualValue > 0 ? fmtKr(actualValue) : '—',
                actualPct:    actualValue > 0 ? fmtPct(actualPct, 2) : '—',
                deviation:    targetPct > 0 ? fmtDevPct(deviation) : '—',
                deviationClass
            };
        });
    }

    get totalTargetPct() {
        return fmtPct(ASSETS.reduce((s, a) => s + (this.weights[a.key] || 0), 0), 1);
    }
    get totalTargetAmount() {
        let t = 0;
        ASSETS.forEach(a => { if (this.total > 0) t += this.total * (this.weights[a.key] || 0) / 100; });
        return t > 0 ? fmtKr(t) : '—';
    }
    get totalMarketValue() { return this.total > 0 ? fmtKr(this.total) : '—'; }

    // ── TRAFFIC LIGHT SUMMARY ──────────────────────────────────────
    get trafficLightSummary() {
        if (this.total === 0) return null;
        let within = 0, outside = 0, noData = 0;
        ASSETS.forEach(a => {
            const w = this.weights[a.key] || 0, v = this.values[a.key] || 0;
            if (w === 0 && v === 0) return;
            if (w === 0) { noData++; return; }
            Math.abs((v / this.total) * 100 - w) <= BOUNDARY_LIMIT ? within++ : outside++;
        });
        return (within + outside + noData) > 0 ? { within, outside, noData } : null;
    }

    // ── DATA FETCHING ──────────────────────────────────────────────
    async handleFetchHoldings() {
        if (!this.recordId) { this.showToast('Error', 'No record ID provided', 'error'); return; }
        if (!this.flowApiName) { this.showToast('Error', 'Flow API Name not configured', 'error'); return; }
        this.isLoading = true;
        try {
            const jsonResult = await getHoldingsFromFlow({ flowApiName: this.flowApiName, accountId: this.recordId });
            if (!jsonResult) { this.showToast('Info', 'No data returned from flow', 'info'); return; }
            const result = JSON.parse(jsonResult);
            const strategies       = result.strategies       || [];
            const strategyProducts = result.strategyProducts || [];
            const holdings         = result.holdings         || [];
            if (strategies.length > 0)       this._mapFlowResultsToTargets(strategies);
            if (strategyProducts.length > 0) this._mapFlowResultsToStrategyProducts(strategyProducts);
            if (holdings.length > 0) {
                this._mapFlowResultsToAssets(holdings);
                this._mapFlowResultsToComparison(holdings);
                this.showToast('Success', `Loaded ${holdings.length} holdings`, 'success');
            } else {
                this.showToast('Info', 'No holdings found', 'info');
            }
        } catch (error) {
            console.error('Error fetching holdings:', error);
            this.showToast('Error', 'Failed to fetch holdings: ' + (error.body?.message || error.message), 'error');
        } finally {
            this.isLoading = false;
        }
    }

    // ── MAPPING FUNCTIONS ──────────────────────────────────────────
    _mapFlowResultsToTargets(strategies) {
        let nw = { pm: 0, ob: 0, ak: 0, hf: 0, ei: 0, pe: 0 };
        try {
            strategies.forEach(s => {
                const v = s.Target__c || 0;
                switch (s.AssetClass__c) {
                    case 'b': nw.pm = v; break; case 't': nw.ob = v; break; case 'e': nw.ak = v; break;
                    case 'g': nw.hf = v; break; case 'i': nw.ei = v; break; case 'p': nw.pe = v; break;
                }
            });
            this.weights = nw;
            Object.keys(nw).forEach(k => { this.weightInputs[k] = nw[k] > 0 ? nw[k].toString().replace('.', ',') : ''; });
        } catch (e) { console.error('Error mapping targets:', e); }
    }

    _mapFlowResultsToStrategyProducts(strategyProducts) {
        const map = new Map();
        try {
            strategyProducts.forEach(prod => {
                const code = (prod.AssetClassCode__c || '').toLowerCase();
                let assetKey = null, assetClass = '';
                switch (code) {
                    case 'b': assetKey = 'pm'; assetClass = 'Money Market'; break;
                    case 't': assetKey = 'ob'; assetClass = 'Bonds';        break;
                    case 'e': assetKey = 'ak'; assetClass = 'Equities';     break;
                    case 'g': assetKey = 'hf'; assetClass = 'Hedge Funds';  break;
                    case 'i': assetKey = 'ei'; assetClass = 'Real Assets';  break;
                    case 'p': assetKey = 'pe'; assetClass = 'Private Equity'; break;
                }
                const symbol   = (prod.SecuritySymbol__c || '').trim().toLowerCase();
                const security = prod.Product__c || prod.SleeveDescription__c || prod.SecuritySymbol__c || 'Unknown Security';
                const targetPct = prod.Target__c || 0;
                if (assetKey && symbol) {
                    if (map.has(symbol)) map.get(symbol).targetPct += targetPct;
                    else map.set(symbol, { assetKey, assetClass, symbol, security, targetPct });
                }
            });
            this.strategyProductsList = Array.from(map.values());
        } catch (e) { console.error('Error mapping products:', e); }
    }

    _mapFlowResultsToAssets(holdings) {
        let nv = { pm: 0, ob: 0, ak: 0, hf: 0, ei: 0, pe: 0 }, newTotal = 0;
        try {
            holdings.forEach(h => {
                const nc = normalizeClass(h.FinServ__AssetClass__c);
                const mv = h.FinServ__MarketValue__c || 0;
                switch (nc) {
                    case 'money market': case 'money market/cash': nv.pm += mv; break;
                    case 'bonds':       nv.ob += mv; break;
                    case 'equities':    nv.ak += mv; break;
                    case 'hedgefund': case 'hedgefunds': case 'hedge fund': case 'hedge funds': nv.hf += mv; break;
                    case 'real estate': case 'real assets': nv.ei += mv; break;
                    case 'private equity': nv.pe += mv; break;
                }
                newTotal += mv;
            });
            this.values = nv;
            this.total  = newTotal;
            Object.keys(nv).forEach(k => { this.valueInputs[k] = nv[k] > 0 ? _nfInt.format(nv[k]) : ''; });
        } catch (e) { console.error('Error mapping assets:', e); }
    }

    _mapFlowResultsToComparison(holdings) {
        let newActuals = { ...this.actualAmounts };
        let newExtras  = [...this.cmpExtraProducts];
        const assetLabels = { pm: 'Money Market', ob: 'Bonds', ak: 'Equities', hf: 'Hedgefund', ei: 'Real Assets', pe: 'Private Equity' };
        const holdingNameMap = new Map();
        try {
            holdings.forEach(h => {
                const nc  = normalizeClass(h.FinServ__AssetClass__c);
                const mv  = h.FinServ__MarketValue__c || 0;
                const sec = h.Securities_Name__c || h.Name || 'Unknown Security';
                const sym = String(h.FinServ__Symbol__c || sec).trim().toLowerCase();
                if (sym && h.Securities_Name__c) holdingNameMap.set(sym, h.Securities_Name__c);
                if (mv > 0 && sym) {
                    let ak = null;
                    switch (nc) {
                        case 'money market': case 'money market/cash': ak = 'pm'; break;
                        case 'bonds':        ak = 'ob'; break;
                        case 'equities':     ak = 'ak'; break;
                        case 'hedgefund': case 'hedgefunds': case 'hedge fund': case 'hedge funds': ak = 'hf'; break;
                        case 'real estate': case 'real assets': ak = 'ei'; break;
                        case 'private equity': ak = 'pe'; break;
                    }
                    if (ak) {
                        newActuals[sym] = (newActuals[sym] || 0) + mv;
                        const allTP = this._getAllProducts();
                        const isTarget = allTP.some(p => p.assetKey === ak && p.symbol === sym);
                        const isAlreadyExtra = newExtras.some(p => p.assetKey === ak && p.symbol === sym);
                        if (!isTarget && !isAlreadyExtra)
                            newExtras.push({ assetKey: ak, assetClass: assetLabels[ak], symbol: sym, security: sec, targetAmount: 0, targetPct: 0, isExtra: true });
                    }
                }
            });
            this.actualAmounts  = newActuals;
            this.cmpExtraProducts = newExtras;
            // Overwrite strategy product names with Securities_Name__c from holdings where available
            if (holdingNameMap.size > 0) {
                this.strategyProductsList = this.strategyProductsList.map(sp => {
                    const name = holdingNameMap.get(sp.symbol);
                    return name ? { ...sp, security: name } : sp;
                });
            }
            // Default lock for ei/pe
            const newKeep = { ...this.keepInvestment };
            [...this.strategyProductsList, ...this.cmpExtraProducts].forEach(p => {
                if (newKeep[p.symbol] === undefined && (p.assetKey === 'ei' || p.assetKey === 'pe'))
                    newKeep[p.symbol] = true;
            });
            this.keepInvestment = newKeep;
        } catch (e) { console.error('Error mapping comparison:', e); }
    }

    _getAllProducts() {
        return this.strategyProductsList.map(sp => ({
            assetClass: sp.assetClass, assetKey: sp.assetKey,
            symbol: sp.symbol, security: sp.security,
            targetPct: sp.targetPct, targetAmount: this.total * (sp.targetPct / 100)
        }));
    }

    _getProductListForClass(assetKey) {
        return this.strategyProductsList.filter(p => p.assetKey === assetKey).map(p => ({ symbol: p.symbol, label: p.security }));
    }

    // ── REBALANCING CALCULATION ────────────────────────────────────
    get rebalancingData() {
        try {
            const total = this.total || 0;
            if (total === 0 || !Object.keys(this.actualAmounts || {}).length) return { hasData: false };

            const allProducts = this._getAllProducts();
            const adminKeys   = new Set(allProducts.map(p => p.security));
            const combined    = [...allProducts, ...this.cmpExtraProducts.filter(p => !adminKeys.has(p.security))];
            let totalNetCash  = 0;
            const classes     = [];

            ASSETS.forEach(a => {
                const w           = this.weights[a.key] || 0;
                const classTarget = total * (w / 100);
                const clsAll      = combined.filter(p => p.assetKey === a.key);
                const isLocked    = p => { let k = this.keepInvestment[p.symbol]; if (k === undefined) k = (p.assetKey === 'ei' || p.assetKey === 'pe'); return k; };
                const locked      = clsAll.filter(p => isLocked(p) && ((p.targetAmount || 0) > 0 || this.actualAmounts[p.symbol] != null));
                const rebalanceable = clsAll.filter(p => !isLocked(p));
                const planned     = rebalanceable.filter(p => (p.targetAmount || 0) > 0);
                const unplanned   = rebalanceable.filter(p => !(p.targetAmount > 0) && this.actualAmounts[p.symbol] != null);
                const currentTotal = clsAll.reduce((s, p) => s + (this.actualAmounts[p.symbol] ?? 0), 0);
                const lockedAmount = locked.reduce((s, p) => s + (this.actualAmounts[p.symbol] ?? p.targetAmount ?? 0), 0);
                const rebTarget   = classTarget - lockedAmount;
                const rebCurrent  = rebalanceable.reduce((s, p) => s + (this.actualAmounts[p.symbol] ?? 0), 0);
                const classNetTrade = rebTarget - rebCurrent;
                if (w === 0 && currentTotal === 0) return;
                // Build product trades first so postPct reflects actual advisor-set trades
                const sumPT    = planned.reduce((s, p) => s + (p.targetAmount || 0), 0);
                const threshold = a.key === 'pm' ? TRADE_THRESHOLD_CASH : TRADE_THRESHOLD_DEFAULT;
                const productTrades = [];
                planned.forEach(p => {
                    const actual = this.actualAmounts[p.symbol] ?? 0;
                    const hasActual = this.actualAmounts[p.symbol] != null;
                    const adjTarget = sumPT > 0 && rebTarget > 0 ? rebTarget * (p.targetAmount / sumPT) : 0;
                    const trade = adjTarget - actual;
                    const mt    = this.manualTrades[p.symbol];
                    const eff   = mt !== undefined ? mt : 0;
                    const pctDiff = adjTarget > 0 ? Math.abs(eff / adjTarget) * 100 : 0;
                    let aLabel, aClass;
                    if (eff === 0 || pctDiff < threshold) { aLabel = 'Hold'; aClass = 'reb-pill reb-pill-hold'; }
                    else if (eff > 0)                      { aLabel = 'Buy';  aClass = 'reb-pill reb-pill-buy';  }
                    else                                    { aLabel = 'Sell'; aClass = 'reb-pill reb-pill-sell'; }
                    const tPct  = total > 0 && adjTarget > 0 ? (adjTarget / total) * 100 : null;
                    const ptPct = total > 0 ? ((actual + eff) / total) * 100 : null;
                    productTrades.push({
                        symbol: p.symbol, security: p.security,
                        actualDisplay: hasActual ? this._fmtKr(actual) : '—', actualRaw: actual,
                        adjTargetDisplay: adjTarget > 0 ? this._fmtKr(adjTarget) : '—',
                        targetPctDisplay: tPct  !== null ? fmtPct(tPct, 1) : '—',
                        rawTargetPctDisplay: p.targetPct > 0 ? fmtPct(p.targetPct, 1) : '—',
                        tradeDisplay: this._fmtTrade(eff), tradeInputValue: mt !== undefined ? Math.round(mt) : 0,
                        tradeRawInt: Math.round(trade),
                        tradeClass: eff >= 0 ? 'reb-buy' : 'reb-sell',
                        postTradePctDisplay: ptPct !== null ? fmtPct(ptPct, 1) : '—',
                        actionHtml: aLabel, actionClass: aClass,
                        noData: !hasActual, unplanned: false,
                        tradeValue: eff, tradeRaw: trade, hasManualTrade: mt !== undefined
                    });
                });
                unplanned.forEach(p => {
                    const actual = this.actualAmounts[p.symbol] ?? 0;
                    const hasActual = this.actualAmounts[p.symbol] != null;
                    const mt    = this.manualTrades[p.symbol];
                    const eff   = mt !== undefined ? mt : 0;
                    const ptPct = total > 0 ? ((actual + eff) / total) * 100 : null;
                    productTrades.push({
                        symbol: p.symbol, security: p.security,
                        actualDisplay: hasActual ? this._fmtKr(actual) : '—', actualRaw: actual,
                        adjTargetDisplay: '—', targetPctDisplay: '—', rawTargetPctDisplay: '—',
                        tradeDisplay: this._fmtTrade(eff),
                        tradeInputValue: mt !== undefined ? Math.round(mt) : 0,
                        tradeRawInt: Math.round(-actual),
                        tradeClass: eff < 0 ? 'reb-sell' : eff > 0 ? 'reb-buy' : 'reb-neutral',
                        postTradePctDisplay: ptPct !== null ? fmtPct(ptPct, 1) : '—',
                        actionHtml: eff === 0 ? 'Hold' : (eff < 0 ? 'Sell' : 'Buy'),
                        actionClass: eff === 0 ? 'reb-pill reb-pill-hold' : (eff < 0 ? 'reb-pill reb-pill-sell' : 'reb-pill reb-pill-buy'),
                        noData: !hasActual, unplanned: true,
                        tradeValue: eff, tradeRaw: -actual, hasManualTrade: mt !== undefined
                    });
                });
                const lockedProducts = locked.map(p => ({ security: p.security, actualDisplay: this.actualAmounts[p.symbol] != null ? this._fmtKr(this.actualAmounts[p.symbol]) : '—' }));
                const netTrade = productTrades.reduce((s, p) => s + p.tradeValue, 0);
                // postPct based on actual advisor-set trades, not theoretical classNetTrade
                const postPct = total > 0 ? ((currentTotal + netTrade) / total) * 100 : 0;
                totalNetCash += netTrade;
                let isWithinBoundary = null, bClass = '', bText = '—';
                if (w > 0) {
                    isWithinBoundary = postPct >= w - BOUNDARY_LIMIT && postPct <= w + BOUNDARY_LIMIT;
                    bClass = isWithinBoundary ? 'reb-pill reb-pill-ok' : 'reb-pill reb-pill-breach';
                    bText  = isWithinBoundary ? '✓ Within' : '✕ Outside';
                }
                classes.push({
                    key: a.key, label: a.label, dotStyle: `background:${a.color}`, postPct,
                    currentTotalDisplay: currentTotal > 0 ? this._fmtKr(currentTotal) : '—',
                    classTargetDisplay:  classTarget  > 0 ? this._fmtKr(classTarget)  : '—',
                    netTradeDisplay: (classTarget > 0 || currentTotal > 0) ? this._fmtTrade(netTrade) : '—',
                    netTradeClass: netTrade >= 0 ? 'reb-buy' : 'reb-sell',
                    boundaryOk: isWithinBoundary !== null, boundaryBadgeClass: bClass, boundaryBadgeText: bText,
                    overlocked: lockedAmount > classTarget && classTarget > 0,
                    productTrades, lockedProducts, hasProducts: productTrades.length > 0 || lockedProducts.length > 0,
                    rebTargetDisplay: rebTarget > 0 ? this._fmtKr(rebTarget) : '—', rebTargetIsPositive: rebTarget > 0,
                    netTradeProductDisplay: this._fmtTrade(netTrade), netTradeProductClass: netTrade >= 0 ? 'reb-buy' : 'reb-sell', threshold
                });
            });

            return {
                hasData: true, classes,
                totalNetCashDisplay: this._fmtTrade(totalNetCash),
                totalNetCashClass: totalNetCash >= 0 ? 'reb-buy' : 'reb-sell',
                isSurplus: totalNetCash < 0, isDeficit: totalNetCash > 0
            };
        } catch (e) { console.error('Error computing rebalancing data:', e); return { hasData: false }; }
    }

    get tradeBalanceBar() {
        const reb = this.rebalancingData;
        if (!reb || !reb.hasData) return null;
        let buy = 0, sell = 0;
        reb.classes.forEach(c => (c.productTrades || []).forEach(p => { if (p.tradeValue > 0) buy += p.tradeValue; else sell += Math.abs(p.tradeValue); }));
        const tot = buy + sell;
        if (tot === 0) return null;
        const buyPct = Math.round((buy / tot) * 100);
        return { buyStyle: `width:${buyPct}%;`, sellStyle: `width:${100 - buyPct}%;`, buyDisplay: this._fmtKr(buy), sellDisplay: this._fmtKr(sell) };
    }

    // ── ORDERS (SWITCH ASSEMBLY) ───────────────────────────────────
    _getRebalancingTrades() {
        const total = this.total || 0;
        const allProducts = this._getAllProducts();
        const adminKeys   = new Set(allProducts.map(p => p.security));
        const combined    = [...allProducts, ...this.cmpExtraProducts.filter(p => !adminKeys.has(p.security))];
        const trades = [];
        ASSETS.forEach(a => {
            const w = this.weights[a.key] || 0;
            const clsAll = combined.filter(p => p.assetKey === a.key);
            const isLocked = p => { let k = this.keepInvestment[p.symbol]; if (k === undefined) k = (p.assetKey === 'ei' || p.assetKey === 'pe'); return k; };
            const locked      = clsAll.filter(p => isLocked(p) && ((p.targetAmount || 0) > 0 || this.actualAmounts[p.symbol] != null));
            const rebalanceable = clsAll.filter(p => !isLocked(p));
            const planned     = rebalanceable.filter(p => (p.targetAmount || 0) > 0);
            const unplanned   = rebalanceable.filter(p => !(p.targetAmount > 0) && this.actualAmounts[p.symbol] != null);
            const lockedAmt   = locked.reduce((s, p) => s + (this.actualAmounts[p.symbol] ?? p.targetAmount ?? 0), 0);
            const rebTarget   = total * (w / 100) - lockedAmt;
            const sumPT       = planned.reduce((s, p) => s + (p.targetAmount || 0), 0);
            const threshold   = a.key === 'pm' ? TRADE_THRESHOLD_CASH : TRADE_THRESHOLD_DEFAULT;
            planned.forEach(p => {
                const actual    = this.actualAmounts[p.symbol] ?? 0;
                const adjTarget = sumPT > 0 && rebTarget > 0 ? rebTarget * (p.targetAmount / sumPT) : 0;
                const mt        = this.manualTrades[p.symbol];
                const eff       = mt !== undefined ? mt : 0;
                if (Math.abs(eff) > 0)
                    trades.push({ security: p.security, symbol: p.symbol, assetKey: a.key, assetClass: a.label, trade: eff, actual, unplanned: false });
            });
            unplanned.forEach(p => {
                const actual = this.actualAmounts[p.symbol] ?? 0;
                const mt     = this.manualTrades[p.symbol];
                const eff    = mt !== undefined ? mt : 0;
                if (Math.abs(eff) > 0) trades.push({ security: p.security, symbol: p.symbol, assetKey: a.key, assetClass: a.label, trade: eff, actual, unplanned: true });
            });
        });
        return trades;
    }

    get orderData() {
        try {
            if (this.total === 0 || !Object.keys(this.actualAmounts || {}).length)
                return { hasOrders: false, emptyMessage: 'No data available. Fetch holdings first.' };

            const trades   = this._getRebalancingTrades();
            const rawSells = [], rawBuys = [];
            trades.forEach(p => {
                if (p.unplanned) { if (p.actual > 0) rawSells.push({ ...p, amount: p.actual }); }
                else { if (p.trade > 0) rawBuys.push({ ...p, amount: p.trade }); else if (p.trade < 0) rawSells.push({ ...p, amount: Math.abs(p.trade) }); }
            });

            const dedup = arr => {
                const m = new Map();
                arr.forEach(t => { if (m.has(t.symbol)) m.get(t.symbol).amount += t.amount; else m.set(t.symbol, { ...t }); });
                return Array.from(m.values()).map(t => {
                    const ov = this.manualOverrides[t.symbol];
                    return ov !== undefined ? { ...t, amount: ov, isManual: true } : { ...t, isManual: false };
                }).filter(t => Math.round(t.amount) > 0);
            };

            const sells = dedup(rawSells).sort((a, b) => b.amount - a.amount);
            const buys  = dedup(rawBuys).sort((a, b) => b.amount - a.amount);
            const switches = [];
            let avail = buys.map(b => ({ ...b, remaining: b.amount }));

            // Intra-class
            sells.forEach(sell => {
                const assigned = []; let cap = sell.amount;
                avail.filter(b => b.assetKey === sell.assetKey && b.remaining > 0).forEach(b => {
                    if (cap <= 0) return;
                    const alloc = Math.min(cap, b.remaining);
                    assigned.push({ ...b, legAmount: alloc }); cap -= alloc; b.remaining -= alloc;
                });
                if (assigned.length > 0) {
                    const lp = this._wholePcts(assigned, sell.amount, 'legAmount');
                    switches.push({ key: 'sw_intra_' + sell.symbol, sell: { ...sell }, sellInputClass: 'ord-amt-input' + (sell.isManual ? ' is-manual' : ''),
                        buyLegs: lp.map(b => ({ ...b, inputClass: 'ord-amt-input' + (b.isManual ? ' is-manual' : ''), legAmountRaw: this._fmtDisplayAmt(b.legAmount), legAmountValue: Math.round(b.legAmount) })),
                        crossClass: false, isExpanded: !!this.expandedOrdRows['sw_intra_' + sell.symbol], toggleIcon: this.expandedOrdRows['sw_intra_' + sell.symbol] ? '−' : '+' });
                    sell.remaining = cap;
                } else { sell.remaining = sell.amount; }
            });
            // Cross-class
            sells.filter(s => s.remaining > 0).forEach(sell => {
                const assigned = []; let cap = sell.remaining;
                avail.filter(b => b.remaining > 0).forEach(b => {
                    if (cap <= 0) return;
                    const alloc = Math.min(cap, b.remaining);
                    assigned.push({ ...b, legAmount: alloc }); cap -= alloc; b.remaining -= alloc;
                });
                if (assigned.length > 0) {
                    const lp = this._wholePcts(assigned, sell.amount, 'legAmount');
                    switches.push({ key: 'sw_cross_' + sell.symbol, sell: { ...sell }, sellInputClass: 'ord-amt-input' + (sell.isManual ? ' is-manual' : ''),
                        buyLegs: lp.map(b => ({ ...b, inputClass: 'ord-amt-input' + (b.isManual ? ' is-manual' : ''), legAmountRaw: this._fmtDisplayAmt(b.legAmount), legAmountValue: Math.round(b.legAmount) })),
                        crossClass: true, isExpanded: !!this.expandedOrdRows['sw_cross_' + sell.symbol], toggleIcon: this.expandedOrdRows['sw_cross_' + sell.symbol] ? '−' : '+' });
                    sell.remaining = cap;
                }
            });

            const totalSells = sells.reduce((s, o) => s + o.amount, 0);
            const totalBuys  = buys.reduce((s,  o) => s + o.amount, 0);
            const residual   = totalSells - totalBuys;
            let residualData = null;
            if (residual > 0) {
                residualData = { isSurplus: true, isDeficit: false, amountDisplay: this._fmtKr(residual) };
            } else if (residual < 0) {
                const defBuys = avail.filter(b => b.remaining >= 1).map(b => ({ ...b, legAmount: b.remaining }));
                const lp = this._wholePcts(defBuys, Math.abs(residual), 'legAmount');
                residualData = {
                    isSurplus: false, isDeficit: true, amountDisplay: this._fmtKr(Math.abs(residual)),
                    buyRows: lp.map((b, idx) => {
                        const bk = b.symbol + '_BUY_RESIDUAL_' + idx;
                        const bi = this.productAiState[bk] || { loading: false, text: null };
                        return { ...b, inputClass: 'ord-amt-input' + (b.isManual ? ' is-manual' : ''), legAmountRaw: this._fmtDisplayAmt(b.legAmount), legAmountValue: Math.round(b.legAmount), buyAiKey: bk, buyAiLoading: bi.loading, buyAiText: bi.text };
                    }).filter(b => b.legAmountValue > 0)
                };
            }

            if (switches.length === 0 && (!residualData || residual === 0))
                return { hasOrders: false, emptyMessage: '✓ No orders required. All positions are within threshold.' };

            return {
                hasOrders: true,
                switches: switches.map((sw, i) => {
                    const fBuys  = sw.buyLegs.filter(b => b.legAmountValue > 0);
                    const sellAk = sw.sell.symbol + '_SELL_' + i;
                    const sellAi = this.productAiState[sellAk] || { loading: false, text: null };
                    return { ...sw, index: i + 1,
                        sellAmountRawDisplay: this._fmtDisplayAmt(sw.sell.amount), sellAmountValue: Math.round(sw.sell.amount),
                        sellAiKey: sellAk, sellAiLoading: sellAi.loading, sellAiText: sellAi.text,
                        buyLegs: fBuys.map((b, bI) => {
                            const bk = b.symbol + '_BUY_' + i + '_' + bI;
                            const bi = this.productAiState[bk] || { loading: false, text: null };
                            return { ...b, buyAiKey: bk, buyAiLoading: bi.loading, buyAiText: bi.text };
                        })
                    };
                }),
                residualData,
                summary: {
                    switchCount: switches.length, intraCount: switches.filter(s => !s.crossClass).length, crossCount: switches.filter(s => s.crossClass).length,
                    totalSells: this._fmtKr(totalSells), totalBuys: this._fmtKr(totalBuys),
                    residualAmount: residual !== 0 ? this._fmtKr(Math.abs(residual)) : null,
                    residualDir: residual > 0 ? '→ Kundekonto' : '← Kundekonto'
                }
            };
        } catch (e) { console.error('Error computing order data:', e); return { hasOrders: false, emptyMessage: 'Error calculating orders.' }; }
    }

    _wholePcts(items, totalAmt, amtKey = 'amount') {
        if (!totalAmt || !items.length) return items.map(i => ({ ...i, pct: 0 }));
        const floats = items.map(i => (i[amtKey] / totalAmt) * 100);
        const floors = floats.map(Math.floor);
        const rem    = 100 - floors.reduce((a, b) => a + b, 0);
        const diffs  = floats.map((f, i) => f - floors[i]);
        diffs.map((d, i) => i).sort((a, b) => diffs[b] - diffs[a]).slice(0, rem).forEach(i => floors[i]++);
        return items.map((item, i) => ({ ...item, pct: floors[i] }));
    }

    _fmtKr(n)          { return fmtKr(n); }
    _fmtTrade(n)        { return fmtTradeKr(n); }
    _fmtDisplayAmt(n)   { const v = this.roundToThousand ? Math.round(n / 1000) * 1000 : Math.round(n); return _nfInt.format(v); }

    get separateOrderData() {
        const od = this.orderData;
        if (!od || !od.hasOrders) return { hasBuys: false, hasSells: false, buys: [], sells: [] };
        const bm = new Map(), sm = new Map();
        od.switches.forEach(sw => {
            const sk = sw.sell.symbol;
            if (sm.has(sk)) sm.get(sk).amount += sw.sellAmountValue; else sm.set(sk, { ...sw.sell, amount: sw.sellAmountValue });
            sw.buyLegs.forEach(b => { if (bm.has(b.symbol)) bm.get(b.symbol).amount += b.legAmountValue; else bm.set(b.symbol, { ...b, amount: b.legAmountValue }); });
        });
        if (od.residualData?.isDeficit && od.residualData.buyRows)
            od.residualData.buyRows.forEach(b => { if (bm.has(b.symbol)) bm.get(b.symbol).amount += b.legAmountValue; else bm.set(b.symbol, { ...b, amount: b.legAmountValue }); });
        const sells = Array.from(sm.values()).sort((a,b) => b.amount - a.amount).map(s => ({ ...s, amountDisplay: this._fmtDisplayAmt(s.amount) }));
        const buys  = Array.from(bm.values()).sort((a,b) => b.amount - a.amount).map(b => ({ ...b, amountDisplay: this._fmtDisplayAmt(b.amount) }));
        return { buys, sells, hasBuys: buys.length > 0, hasSells: sells.length > 0 };
    }

    get switchModeActive()       { return !this.separateMode; }
    get separateModeLabel()      { return this.separateMode ? '⇄ Switch Mode' : '⇄ Separate Orders'; }
    get separateModeBtnClass()   { return 'btn-ghost' + (this.separateMode      ? ' btn-ghost-active' : ''); }
    get roundBtnClass()          { return 'btn-ghost' + (this.roundToThousand   ? ' btn-ghost-active' : ''); }

    // ── COMPARISON SECTIONS ────────────────────────────────────────
    get comparisonSections() {
        const allProducts = this._getAllProducts();
        return ASSETS.map(a => {
            const targetProds = allProducts.filter(p => p.assetKey === a.key && p.targetAmount > 0);
            const extras      = this.cmpExtraProducts.filter(p => p.assetKey === a.key).map(p => ({ ...p, isExtra: true }));
            const allRaw      = [...targetProds, ...extras];
            let sumTarget = 0, sumActual = 0;
            const rows = allRaw.map(p => { sumTarget += p.targetAmount || 0; sumActual += this.actualAmounts[p.symbol] ?? 0; return this._buildCmpRow(p); });
            const devKr = sumActual - sumTarget;
            const devPct = sumTarget > 0 ? (devKr / sumTarget) * 100 : null;
            const devClass = devKr === 0 ? '' : devKr > 0 ? 'cmp-pos' : 'cmp-neg';
            const addState = this.addFormState[a.key] || { show: false };
            const visible  = rows.map(r => r.symbol);
            const prodList = this._getProductListForClass(a.key).filter(s => !visible.includes(s.symbol));
            return {
                assetKey: a.key, assetClass: a.label, keepLabel: (a.key === 'ei' || a.key === 'pe') ? 'No Sale' : 'Keep',
                dotStyle: `background:${a.color};width:8px;height:8px;border-radius:50%;display:inline-block;`,
                isEmpty: !rows.length, hasRows: rows.length > 0, rows,
                sumTargetDisplay: sumTarget > 0 ? fmtKr(sumTarget) : '—',
                sumActualDisplay: sumActual > 0 ? _nfInt.format(Math.round(sumActual)) : '0',
                sumDevKrDisplay:  devKr !== 0 ? 'kr ' + (devKr >= 0 ? '+' : '') + _nfInt.format(Math.round(devKr)) : '—',
                sumDevKrClass: devClass, sumDevPctDisplay: fmtDevPct(devPct), sumDevPctClass: devClass,
                showAddForm: addState.show, hasSelectOptions: prodList.length > 0,
                showCustomInput: !prodList.length || addState.selectValue === '__custom__',
                selectOptions: prodList.map(p => ({ value: p.symbol, label: p.label }))
            };
        });
    }

    _buildCmpRow(p) {
        const actual  = this.actualAmounts[p.symbol] ?? null;
        const devKr   = actual !== null ? actual - p.targetAmount : null;
        const devPct  = actual !== null && p.targetAmount > 0 ? ((actual - p.targetAmount) / p.targetAmount) * 100 : null;
        const dClass  = devKr === null ? '' : devKr >= 0 ? 'cmp-pos' : 'cmp-neg';
        let kept = this.keepInvestment[p.symbol];
        if (kept === undefined) kept = (p.assetKey === 'ei' || p.assetKey === 'pe');
        const isExpanded = !!this.expandedCmpRows[p.symbol];
        const actualPct  = this.total > 0 && actual !== null ? (actual / this.total) * 100 : 0;
        return {
            symbol: p.symbol, security: p.security, isExtra: p.isExtra || false, targetAmount: p.targetAmount,
            targetDisplay: p.targetAmount > 0 ? fmtKr(p.targetAmount) : '—',
            actualDisplay: actual !== null ? _nfInt.format(Math.round(actual)) : '',
            devKrDisplay:  devKr  !== null ? 'kr ' + (devKr >= 0 ? '+' : '') + _nfInt.format(Math.round(devKr)) : '—',
            devKrClass: dClass, devPctDisplay: fmtDevPct(devPct), devPctClass: dClass,
            kept, rowClass: kept ? 'cmp-row-kept' : '', isExpanded, toggleIcon: isExpanded ? '−' : '+',
            detailKey: p.symbol + '_detail',
            targetPctDisplay: p.targetPct > 0 ? fmtPct(p.targetPct, 1) : '—',
            actualPctDisplay: actualPct > 0 ? fmtPct(actualPct, 1) : '—'
        };
    }

    // ── ANALYTICS ─────────────────────────────────────────────────
    get barChartData() {
        let hasData = false;
        const rows = ASSETS.map(a => {
            const tPct = this.weights[a.key] || 0;
            const aPct = this.total > 0 ? ((this.values[a.key] || 0) / this.total) * 100 : 0;
            if (tPct > 0 || aPct > 0) hasData = true;
            const isAlert = Math.abs(aPct - tPct) > BOUNDARY_LIMIT;
            return {
                key: a.key, label: a.label,
                targetWidth: `width:${Math.min(tPct, 100)}%;`, actualWidth: `width:${Math.min(aPct, 100)}%;`,
                targetVal: tPct.toFixed(1) + '%', actualVal: aPct.toFixed(1) + '%',
                actualClass:    `bc-bar bc-actual ${isAlert ? 'bc-alert' : 'bc-ok'}`,
                actualValClass: `bc-bar-val ${isAlert ? 'bc-val-alert' : 'bc-val-ok'}`,
                bLowStyle:  `left:${Math.max(0, tPct - BOUNDARY_LIMIT)}%;`,
                bHighStyle: `left:${Math.min(100, tPct + BOUNDARY_LIMIT)}%;`,
                showBoundaries: tPct > 0
            };
        });
        const xAxis = [0,10,20,30,40,50,60,70,80,90,100].map(v => ({ label: v + '%', style: `left:${v}%;` }));
        return { rows, xAxis, hasData };
    }

    _drawAllocationChart() {
        const canvas = this.template.querySelector('[data-id="allocationChart"]');
        if (!canvas || this.total === 0) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let x = 0;
        ASSETS.forEach(a => {
            const segW = ((this.values[a.key] || 0) / this.total) * canvas.width;
            if (segW < 1) return;
            ctx.fillStyle = a.color; ctx.fillRect(x, 0, segW, canvas.height); x += segW;
        });
    }

    _drawBeforeAfterChart() {
        const canvas = this.template.querySelector('[data-id="beforeAfterChart"]');
        if (!canvas) return;
        const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        const data = this.summaryData;
        if (!data?.length) return;
        const ink     = this._getChartInk('--prt-chart-ink');
        const muted   = this._getChartInk('--prt-chart-muted');
        const grid    = this._getChartInk('--prt-chart-grid');
        const maxPct = Math.max(...data.map(d => Math.max(d.actualPct, d.targetPct, d.postTradePct || 0)), 10);
        const labelW = 110, chartW = w - labelW - 8, rowH = h / data.length;
        const barH = Math.min(rowH * 0.32, 14), gap = rowH * 0.08;
        data.forEach((d, i) => {
            const yMid = i * rowH + rowH / 2, top1 = yMid - barH - gap / 2, top2 = yMid + gap / 2;
            ctx.font = '10px sans-serif'; ctx.fillStyle = ink; ctx.textAlign = 'right';
            ctx.fillText(d.label, labelW - 6, yMid + 4);
            ctx.fillStyle = muted; ctx.fillRect(labelW, top1, Math.max((d.actualPct / maxPct) * chartW, 2), barH);
            ctx.fillStyle = d.color; ctx.fillRect(labelW, top2, Math.max(((d.postTradePct || 0) / maxPct) * chartW, 2), barH);
            const tx = labelW + (d.targetPct / maxPct) * chartW;
            ctx.save(); ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(tx, top1 - 2); ctx.lineTo(tx, top2 + barH + 2);
            ctx.strokeStyle = grid; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
        });
    }

    _drawChangeChart() {
        const canvas = this.template.querySelector('[data-id="changeChart"]');
        if (!canvas) return;
        const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        const data = this.summaryData;
        if (!data?.length) return;
        const ink  = this._getChartInk('--prt-chart-ink');
        const grid = this._getChartInk('--prt-chart-grid');
        const maxDev = Math.max(...data.map(d => Math.abs(d.deviation)), 5);
        const chartW = w - 8, cx = chartW / 2 + 4, rowH = h / data.length;
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.stroke();
        const bp = (BOUNDARY_LIMIT / maxDev) * (chartW / 2);
        ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,95,109,0.45)';
        ctx.beginPath(); ctx.moveTo(cx - bp, 0); ctx.lineTo(cx - bp, h); ctx.moveTo(cx + bp, 0); ctx.lineTo(cx + bp, h); ctx.stroke(); ctx.setLineDash([]);
        data.forEach((d, i) => {
            const y = i * rowH + rowH * 0.2, barH = rowH * 0.6, barW = (Math.abs(d.deviation) / maxDev) * (chartW / 2);
            ctx.fillStyle = d.withinBoundary ? '#4ade80' : '#ff5f6d';
            if (d.deviation >= 0) ctx.fillRect(cx, y, barW, barH); else ctx.fillRect(cx - barW, y, barW, barH);
            ctx.font = '10px sans-serif'; ctx.fillStyle = ink;
            if (d.deviation >= 0) { ctx.textAlign = 'left';  ctx.fillText('+' + d.deviation.toFixed(1) + '%', cx + barW + 3, y + barH / 2 + 4); }
            else                  { ctx.textAlign = 'right'; ctx.fillText(d.deviation.toFixed(1)       + '%', cx - barW - 3, y + barH / 2 + 4); }
        });
    }

    // ── SUMMARY ────────────────────────────────────────────────────
    get summaryData() {
        const trades = this.manualTrades;
        const total = this.total || 0;
        const combined = [...this._getAllProducts(), ...this.cmpExtraProducts];
        const classNet = {};
        combined.forEach(p => {
            const mt = trades[p.symbol];
            if (mt !== undefined) classNet[p.assetKey] = (classNet[p.assetKey] || 0) + mt;
        });
        return ASSETS.map(a => {
            const w = this.weights[a.key] || 0, v = this.values[a.key] || 0;
            const actualPct = total > 0 ? (v / total) * 100 : 0;
            const deviation = actualPct - w;
            const netTrade = classNet[a.key] || 0;
            const postTradePct = total > 0 ? ((v + netTrade) / total) * 100 : actualPct;
            const ptChange = w > 0 ? postTradePct - w : null;
            return {
                key: a.key, label: a.label, color: a.color, actualPct, targetPct: w, postTradePct, deviation, postTradeChange: ptChange,
                withinBoundary: w > 0 && Math.abs(deviation) <= BOUNDARY_LIMIT,
                actualPctDisplay: actualPct.toFixed(1) + '%',
                targetPctDisplay: w > 0 ? w.toFixed(1) + '%' : '—',
                postTradePctDisplay: w > 0 || (v + netTrade) > 0 ? postTradePct.toFixed(1) + '%' : '—',
                changeDisplay: ptChange !== null ? (ptChange >= 0 ? '+' : '') + ptChange.toFixed(1) + '%' : '—',
                changeClass: ptChange !== null && Math.abs(ptChange) <= BOUNDARY_LIMIT ? 'sum-change-ok' : 'sum-change-warn',
                dotStyle: `background:${a.color};width:12px;height:12px;border-radius:50%;display:inline-block;`
            };
        }).filter(d => d.targetPct > 0 || d.actualPct > 0);
    }

    get summaryCards() {
        const od = this.orderData;
        if (!od?.hasOrders) return null;
        const s = od.summary;
        return { transactions: s.switchCount, totalSold: s.totalSells, totalBought: s.totalBuys, residual: s.residualAmount || '—', residualDir: s.residualAmount ? s.residualDir : null, hasResidualDir: !!s.residualAmount };
    }

    // ── AI ─────────────────────────────────────────────────────────
    handleGenerateAI() {
        if (!this.promptTemplateApiName) return;
        this.isAiLoading = true;
        this.aiRecommendationText = '';
        try {
            getAIRecommendationFromFlow({ flowApiName: this.promptTemplateApiName, accountId: this.recordId, portfolioData: this._generatePortfolioContextString() })
                .then(result => { this.aiRecommendationText = result ? formatAIResponse(result) : '<em>No recommendation returned.</em>'; })
                .catch(err => {
                    let msg = 'Communication with AI Flow failed.';
                    if (typeof err === 'string') msg = err;
                    else if (err?.body?.message) msg = err.body.message;
                    else if (err?.message) msg = err.message;
                    this.aiRecommendationText = `<p><strong>Error:</strong> ${msg}</p>`;
                })
                .finally(() => { this.isAiLoading = false; });
        } catch (e) { this.aiRecommendationText = `<p><strong>Error:</strong> Failed to prepare data for AI.</p>`; this.isAiLoading = false; }
    }

    _generatePortfolioContextString() {
        let ctx = 'CURRENT PORTFOLIO CONTEXT:\n\n--- ASSET ALLOCATION ---\n';
        ASSETS.forEach(a => {
            const w = this.weights[a.key] || 0, v = this.values[a.key] || 0;
            const ap = this.total > 0 ? (v / this.total) * 100 : 0;
            ctx += `${a.label}: Target ${w}%, Actual ${ap.toFixed(1)}%, Dev ${(ap - w >= 0 ? '+' : '')}${(ap - w).toFixed(1)}%\n`;
        });
        const od = this.orderData;
        if (od?.hasOrders) {
            ctx += `\n--- RECOMMENDED TRADES ---\nSummary: ${od.summary.switchCount} switches, Sells: ${od.summary.totalSells}, Buys: ${od.summary.totalBuys}\n\n`;
            od.switches.forEach(sw => {
                ctx += `Switch ${sw.index} (${sw.crossClass ? 'Cross-class' : 'Intra-class'}):\n  SELL: ${sw.sell.security} - ${sw.sellAmountRawDisplay}\n`;
                sw.buyLegs.forEach(b => { ctx += `  BUY: ${b.security} - ${b.legAmountRaw} (${b.pct}%)\n`; });
            });
            if (od.residualData?.isSurplus) ctx += `\nRESIDUAL: TO CUSTOMER ACCOUNT: ${od.residualData.amountDisplay}\n`;
            else if (od.residualData?.isDeficit) { ctx += `\nRESIDUAL: FINANCED FROM CUSTOMER ACCOUNT: ${od.residualData.amountDisplay}\n`; od.residualData.buyRows?.forEach(b => { ctx += `  BUY: ${b.security} - ${b.legAmountRaw} (${b.pct}%)\n`; }); }
        } else {
            ctx += `\n--- RECOMMENDED TRADES ---\nPortfolio is well balanced. No trades necessary.\n`;
        }
        const mk = Object.keys(this.manualOverrides);
        if (mk.length > 0) { ctx += `\n--- MANUAL OVERRIDES ---\n`; mk.forEach(k => { ctx += `- ${k}: kr ${this.manualOverrides[k]}\n`; }); }
        ctx += '\n--- PRODUCT COMPARISON ---\n';
        this.comparisonSections.forEach(sec => { if (sec.hasRows) { ctx += `[${sec.assetClass}]\n`; sec.rows.forEach(r => { ctx += `  - ${r.security}: Target ${r.targetDisplay}, Actual kr ${r.actualDisplay || '0'}, Dev ${r.devKrDisplay}\n`; }); } });
        return ctx;
    }

    async handleGenerateProductAI(event) {
        if (!this.aiProductFlowApiName) return;
        await this.fetchProductAI(event.currentTarget.dataset.aikey, event.currentTarget.dataset.action, event.currentTarget.dataset.symbol, event.currentTarget.dataset.assetclass, event.currentTarget.dataset.amount);
    }

    async handleGenerateAllProductAI() {
        if (!this.aiProductFlowApiName) return;
        const od = this.orderData;
        if (!od?.hasOrders) return;
        let exp = { ...this.expandedOrdRows }, promises = [];
        od.switches.forEach(sw => {
            exp[sw.key] = true;
            if (!this.productAiState[sw.sellAiKey]?.text) promises.push(this.fetchProductAI(sw.sellAiKey, 'SELL', sw.sell.symbol, sw.sell.assetClass, sw.sellAmountRawDisplay));
            sw.buyLegs.forEach(b => { if (!this.productAiState[b.buyAiKey]?.text) promises.push(this.fetchProductAI(b.buyAiKey, 'BUY', b.symbol, b.assetClass, b.legAmountRaw)); });
        });
        if (od.residualData?.isDeficit) od.residualData.buyRows?.forEach(b => { if (!this.productAiState[b.buyAiKey]?.text) promises.push(this.fetchProductAI(b.buyAiKey, 'BUY', b.symbol, b.assetClass, b.legAmountRaw)); });
        this.expandedOrdRows = exp;
        await Promise.allSettled(promises);
    }

    async fetchProductAI(aiKey, action, symbol, assetClass, amount) {
        this.productAiState = { ...this.productAiState, [aiKey]: { loading: true, text: null } };
        let ctx = `--- INDIVIDUAL ORDER CONTEXT ---\nACTION: ${action}\nPRODUCT SYMBOL: ${symbol}\nASSET CLASS: ${assetClass}\nORDER AMOUNT: kr ${amount}\n`;
        if (this.manualOverrides[symbol] !== undefined) ctx += `MANUAL OVERRIDE: Yes, adjusted to kr ${this.manualOverrides[symbol]}.\n`;
        ctx += `\n--- PORTFOLIO STATUS ---\n`;
        ASSETS.forEach(a => { const w = this.weights[a.key] || 0, v = this.values[a.key] || 0, ap = this.total > 0 ? (v / this.total) * 100 : 0; ctx += `${a.label}: Target ${w}%, Actual ${ap.toFixed(1)}%, Dev ${(ap - w >= 0 ? '+' : '')}${(ap - w).toFixed(1)}%\n`; });
        try {
            const result = await getAIRecommendationFromFlow({ flowApiName: this.aiProductFlowApiName, accountId: this.recordId, portfolioData: ctx });
            this.productAiState = { ...this.productAiState, [aiKey]: { loading: false, text: result ? formatAIResponse(result) : '<em>No rationale returned.</em>' } };
        } catch (err) {
            let msg = 'Failed.'; if (typeof err === 'string') msg = err; else if (err?.body?.message) msg = err.body.message; else if (err?.message) msg = err.message;
            this.productAiState = { ...this.productAiState, [aiKey]: { loading: false, text: `<p><strong>Error:</strong> ${msg}</p>` } };
        }
    }

    // ── INPUT EVENT HANDLERS ───────────────────────────────────────
    handleTotalValueChange(event) {
        const raw = event.target.value.replace(/[^0-9]/g, '');
        const v   = parseInt(raw, 10) || 0;
        if (v > MAX_PORTFOLIO_VALUE) return;
        if (this._totalInputTimeout) clearTimeout(this._totalInputTimeout);
        this._totalInputTimeout = setTimeout(() => { this.total = v; }, INPUT_DEBOUNCE_MS);
    }
    handleHeroInputFocus(event) { event.target.value = this.total > 0 ? this.total.toString() : ''; }
    handleHeroInputBlur(event)  { const v = parseFloat(event.target.value.replace(/\s/g, '')) || 0; event.target.value = v > 0 ? _nfInt.format(v) : ''; }
    handleFocusNum(event)       { event.target.value = event.target.value.replace(/\s/g, ''); }
    handleBlurNum(event)        { const v = parseThousands(event.target.value); if (v !== null && !isNaN(v)) event.target.value = _nfInt.format(Math.round(v)); }

    // ── COMPARISON HANDLERS ────────────────────────────────────────
    handleCmpActualInput(event) {
        const sym = event.currentTarget.dataset.symbol, raw = parseThousands(event.target.value);
        if (raw !== null) { this.actualAmounts = { ...this.actualAmounts, [sym]: raw }; }
        else { const a = { ...this.actualAmounts }; delete a[sym]; this.actualAmounts = a; }
    }
    handleCmpActualBlur(event) { const sym = event.currentTarget.dataset.symbol, raw = this.actualAmounts[sym]; event.target.value = raw !== undefined ? _nfInt.format(Math.round(raw)) : ''; }
    handleToggleKeep(event) { const sym = event.currentTarget.dataset.symbol; this.keepInvestment = { ...this.keepInvestment, [sym]: event.target.checked }; }
    handleToggleCmpRow(event) { const k = event.currentTarget.dataset.key; this.expandedCmpRows = { ...this.expandedCmpRows, [k]: !this.expandedCmpRows[k] }; }
    handleClearActuals() { this.actualAmounts = {}; this.keepInvestment = {}; this.cmpExtraProducts = []; }
    handleRemoveExtraProduct(event) { const ak = event.currentTarget.dataset.assetKey, sym = event.currentTarget.dataset.symbol; this.cmpExtraProducts = this.cmpExtraProducts.filter(p => !(p.assetKey === ak && p.symbol === sym)); }
    handleToggleAddForm(event) { const ak = event.currentTarget.dataset.assetKey, cur = this.addFormState[ak] || { show: false }; this.addFormState = { ...this.addFormState, [ak]: { show: !cur.show, selectValue: '', customText: '', showCustom: false } }; }
    handleAddSelectChange(event) { const ak = event.currentTarget.dataset.assetKey, val = event.target.value; this.addFormState = { ...this.addFormState, [ak]: { ...this.addFormState[ak], selectValue: val, showCustom: val === '__custom__' } }; }
    handleAddTextChange(event) { const ak = event.currentTarget.dataset.assetKey; this.addFormState = { ...this.addFormState, [ak]: { ...this.addFormState[ak], customText: event.target.value } }; }
    handleConfirmAddProduct(event) {
        const ak = event.currentTarget.dataset.assetKey, ac = event.currentTarget.dataset.assetClass, fs = this.addFormState[ak] || {};
        let sym = fs.selectValue, sec = '';
        if (sym === '__custom__' || !sym) { const t = (fs.customText || '').trim(); sym = t.toLowerCase(); sec = t; }
        else { const mp = this.strategyProductsList.find(p => p.symbol === sym); sec = mp ? mp.security : sym; }
        if (!sym) return;
        const ap = this._getAllProducts();
        if (ap.some(p => p.assetKey === ak && p.symbol === sym) || this.cmpExtraProducts.some(p => p.assetKey === ak && p.symbol === sym)) { this.addFormState = { ...this.addFormState, [ak]: { show: false } }; return; }
        this.cmpExtraProducts = [...this.cmpExtraProducts, { assetKey: ak, assetClass: ac, symbol: sym, security: sec, targetAmount: 0, isExtra: true }];
        this.addFormState = { ...this.addFormState, [ak]: { show: false } };
    }

    // ── ORDER HANDLERS ─────────────────────────────────────────────
    handleToggleOrdRow(event) { const k = event.currentTarget.dataset.key; this.expandedOrdRows = { ...this.expandedOrdRows, [k]: !this.expandedOrdRows[k] }; }
    handleOrderAmountChange(event) {
        const sym = event.currentTarget.dataset.symbol;
        const legVal = parseFloat(event.currentTarget.dataset.legvalue) || 0;
        const nv = parseThousands(event.target.value);
        if (nv === null || isNaN(nv)) { const o = { ...this.manualOverrides }; delete o[sym]; this.manualOverrides = o; return; }
        let cur = this._getCalculatedTotalForSymbol(sym);
        if (this.manualOverrides[sym] !== undefined) cur = this.manualOverrides[sym];
        const nt = cur + (nv - legVal);
        this.manualOverrides = { ...this.manualOverrides, [sym]: nt > 0 ? nt : 0 };
    }
    _getCalculatedTotalForSymbol(symbol) { let t = 0; this._getRebalancingTrades().forEach(tr => { if (tr.symbol === symbol) t += Math.abs(tr.unplanned ? tr.actual : tr.trade); }); return t; }
    handleClearOverrides()      { this.manualOverrides = {}; }
    handleToggleSeparateMode()  { this.separateMode = !this.separateMode; }
    handleToggleRound()         { this.roundToThousand = !this.roundToThousand; }

    // ── REBALANCING (P2) HANDLERS ──────────────────────────────────
    handleResetAllTrades() {
        this.manualTrades = {};
    }

    handleAutoAllForClass(event) {
        const assetKey = event.currentTarget.dataset.assetKey;
        const reb = this.rebalancingData;
        if (!reb || !reb.hasData) return;
        const cls = reb.classes.find(c => c.key === assetKey);
        if (!cls) return;
        const newTrades = { ...this.manualTrades };
        cls.productTrades.forEach(pt => { newTrades[pt.symbol] = pt.tradeRaw; });
        this.manualTrades = newTrades;
    }

    handleManualTradeInput(event) {
        const sym = event.currentTarget.dataset.symbol, raw = parseFloat(event.target.value);
        if (isNaN(raw)) { const t = { ...this.manualTrades }; delete t[sym]; this.manualTrades = t; }
        else { this.manualTrades = { ...this.manualTrades, [sym]: raw }; }
    }
    handleTradeChip(event) {
        const sym = event.currentTarget.dataset.symbol, chip = event.currentTarget.dataset.chip, actual = parseFloat(event.currentTarget.dataset.actual) || 0;
        if (chip === 'suggested') { const rv = parseFloat(event.currentTarget.dataset.traderaw) || 0; this.manualTrades = { ...this.manualTrades, [sym]: rv }; }
        else if (chip === 'sellAll') this.manualTrades = { ...this.manualTrades, [sym]: -actual };
        else if (chip === 'hold')    this.manualTrades = { ...this.manualTrades, [sym]: 0 };
    }

    // ── PDF EXPORT ─────────────────────────────────────────────────
    handleExportPDF() {
        const dateStr = new Date().toLocaleDateString('nb-NO', { year: 'numeric', month: 'long', day: 'numeric' });
        const od = this.orderData;
        let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Portfolio Proposal</title><style>body{font-family:'Helvetica Neue',sans-serif;color:#1a1f36;padding:0;margin:0;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact;}.page-container{padding:40px;max-width:900px;margin:0 auto;}.brand-header{background:#0d0f14;color:#fff;padding:30px 40px;display:flex;justify-content:space-between;align-items:center;border-radius:12px 12px 0 0;}.brand-title{margin:0;font-size:1.8rem;font-weight:700;color:#c8f060;}.doc-meta{text-align:right;font-size:.85rem;color:#9ca3af;}.content-body{padding:30px 40px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;}h2{font-size:1.25rem;color:#111827;border-bottom:2px solid #f3f4f6;padding-bottom:10px;margin-top:40px;margin-bottom:20px;font-weight:700;}h3{font-size:1.05rem;color:#374151;margin-top:30px;font-weight:600;background:#f9fafb;padding:10px 15px;border-radius:8px;border-left:4px solid #c8f060;}.metric-bar{display:flex;gap:20px;background:#f9fafb;padding:24px;border-radius:12px;margin-bottom:30px;border:1px solid #e5e7eb;}.metric-card{flex:1;}.metric-label{font-size:.75rem;text-transform:uppercase;color:#6b7280;font-weight:600;display:block;}.metric-value{font-size:1.6rem;font-weight:700;color:#111827;}table{width:100%;border-collapse:collapse;font-size:.9rem;}th,td{padding:12px 16px;text-align:right;border-bottom:1px solid #f3f4f6;}th{color:#6b7280;font-size:.75rem;text-transform:uppercase;font-weight:600;background:#f9fafb;}th:first-child,td:first-child{text-align:left;}.badge{padding:4px 10px;border-radius:12px;font-size:.65rem;font-weight:700;text-transform:uppercase;}.badge-buy{background:#dcfce7;color:#15803d;}.badge-sell{background:#fee2e2;color:#b91c1c;}.badge-cash{background:#fef3c7;color:#b45309;}.product-name{font-weight:600;display:block;}.product-class{color:#6b7280;font-size:.75rem;}.text-red{color:#dc2626;}.text-green{color:#16a34a;}@media print{.page-break{page-break-before:always;}}</style></head><body><div class="page-container"><div class="brand-header"><div><h1 class="brand-title">Rebalancer Proposal</h1><div style="color:#9ca3af;font-size:.9rem;margin-top:4px;">PORTFOLIO TOOL</div></div><div class="doc-meta"><div><strong>Date:</strong> ${dateStr}</div></div></div><div class="content-body"><div class="metric-bar"><div class="metric-card"><span class="metric-label">Total Portfolio</span><span class="metric-value">kr ${this.total > 0 ? _nfInt.format(this.total) : '0'}</span></div></div><h2>1. Asset Allocation</h2><table><thead><tr><th>Asset Class</th><th>Target %</th><th>Target Amount</th><th>Market Value</th><th>Actual %</th><th>Deviation</th></tr></thead><tbody>${this.detailedAssetAllocation.map(r => `<tr><td><strong>${r.label}</strong></td><td>${r.targetPct}</td><td>${r.targetAmount}</td><td>${r.marketValue}</td><td>${r.actualPct}</td><td class="${r.deviationClass}">${r.deviation}</td></tr>`).join('')}</tbody></table><div class="page-break"></div><h2>2. Recommended Orders</h2>`;

        if (od?.hasOrders) {
            html += `<div class="metric-bar"><div class="metric-card"><span class="metric-label">Total Sells</span><span class="metric-value text-red">${od.summary.totalSells}</span></div><div class="metric-card"><span class="metric-label">Total Buys</span><span class="metric-value text-green">${od.summary.totalBuys}</span></div></div>`;
            html += od.switches.map(sw => `<h3>Switch ${sw.index} (${sw.crossClass ? 'Cross-class' : 'Intra-class'})</h3><table><thead><tr><th>Action</th><th>Product</th><th>Amount</th><th>Note</th></tr></thead><tbody><tr><td><span class="badge badge-sell">SELL</span></td><td><span class="product-name">${sw.sell.security}</span><span class="product-class">${sw.sell.assetClass}</span></td><td>kr ${sw.sellAmountRawDisplay}</td><td>—</td></tr>${sw.buyLegs.map(b => `<tr><td><span class="badge badge-buy">BUY</span></td><td><span class="product-name">${b.security}</span><span class="product-class">${b.assetClass}</span></td><td>kr ${b.legAmountRaw}</td><td>${b.pct}% of sell</td></tr>`).join('')}</tbody></table>`).join('');
            if (od.residualData) {
                html += `<h3>Residual Cash</h3><table><thead><tr><th>Action</th><th>Account/Product</th><th>Amount</th></tr></thead><tbody>`;
                if (od.residualData.isSurplus) html += `<tr><td><span class="badge badge-cash">TO CASH</span></td><td>Customer Account</td><td>${od.residualData.amountDisplay}</td></tr>`;
                else { html += `<tr><td><span class="badge badge-cash">FROM CASH</span></td><td>Customer Account</td><td>${od.residualData.amountDisplay}</td></tr>`; html += od.residualData.buyRows.map(b => `<tr><td><span class="badge badge-buy">BUY</span></td><td><span class="product-name">${b.security}</span></td><td>kr ${b.legAmountRaw} (${b.pct}%)</td></tr>`).join(''); }
                html += `</tbody></table>`;
            }
        } else { html += `<p style="color:#6b7280;font-style:italic;padding:20px;background:#f9fafb;border-radius:8px;text-align:center;"><strong>✓ No trades necessary.</strong></p>`; }
        html += `</div></div><script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script></body></html>`;

        try {
            const b64  = window.btoa(unescape(encodeURIComponent(html)));
            const link = document.createElement('a');
            link.href  = 'data:text/html;base64,' + b64;
            link.download = `Portfolio_Proposal_${new Date().toISOString().split('T')[0]}.html`;
            const c = this.template.querySelector('.tool-container') || this.template.host;
            c.appendChild(link); link.click(); c.removeChild(link);
        } catch (e) { console.error('Export failed', e); this.showToast('Error', 'Failed to export report', 'error'); }
    }

    // ── UTILITY ────────────────────────────────────────────────────
    showToast(title, message, variant) { this.dispatchEvent(new ShowToastEvent({ title, message, variant })); }
}