import { LightningElement, api, track } from 'lwc';
import { FlowNavigationNextEvent, FlowNavigationFinishEvent } from 'lightning/flowSupport';
import invokeFlow from '@salesforce/apex/WealthPlanFlowInvoker.invokeFlow';

// ── Constants ────────────────────────────────────────────────────────────────
const RING_FULL = 376.9911; // 2π × 60  (full 360° donut)

const LOADING_MESSAGES = [
    'Reading your Wealth Plan...',
    'Analysing goals and milestones...',
    'Evaluating asset structure...',
    'Reviewing sustainability profile...',
    'Generating insights...',
    'Finalising recommendations...'
];

const STATE = { IDLE: 'idle', LOADING: 'loading', DONE: 'done', ERROR: 'error' };

export default class WealthPlanProgress extends LightningElement {

    // ── Flow inputs ──────────────────────────────────────────────────────────
    @api recordId;
    @api backgroundColor = '#f0f9ff';

    _rawProgress = 0;

    @api
    get progressPercent() { return this._rawProgress; }
    set progressPercent(value) {
        this._rawProgress = value;
        if (this._hasRendered) { this._renderedPct = this._p; }
    }

    // ── Section counts ───────────────────────────────────────────────────────
    @api goalsCount              = 0;
    @api incomeCount             = 0;
    @api assetsLiabilitiesCount  = 0;
    @api milestonesCount         = 0;
    @api sustainabilityCount     = 0;
    @api personalGreetingsCount  = 0;
    @api ownedCompaniesCount     = 0;
    @api capitalNeedsCount       = 0;
    @api investmentStrategyCount = 0;

    // ── Section published flags ──────────────────────────────────────────────
    @api goalsPublished              = false;
    @api incomePublished             = false;
    @api assetsLiabilitiesPublished  = false;
    @api milestonesPublished         = false;
    @api sustainabilityPublished     = false;
    @api personalGreetingsPublished  = false;
    @api ownedCompaniesPublished     = false;
    @api investmentPreferencesPublished = false;
    @api investmentStrategyActive       = false;

    // ── Capital Needs / Risk & Lock-In ──────────────────────────────────────
    @api capitalNeedsHasData = false;
    @api riskValue           = '';
    @api lockInValue         = '';

    // ── AI config ────────────────────────────────────────────────────────────
    @api flowApiName        = '';
    @api outputVariableName = 'wealthPlanAnalysis';
    @api wealthPlanAnalysis = '';
    @api loadingVariant     = 'scanner'; // 'standard' | 'scanner'

    // ── Internal state ───────────────────────────────────────────────────────
    @track _aiState       = STATE.IDLE;
    @track _analysis      = '';
    @track _errorMessage  = '';
    @track _loadingMsgIdx = 0;
    @track _renderedPct   = 0;

    @track isDrawerOpen = false;

    _msgInterval;
    _hasRendered  = false;
    _irisRaf      = null;
    _irisRendered = false;
    _irisObserver = null;

    // ── Lifecycle ────────────────────────────────────────────────────────────
    connectedCallback() {
        if (this.wealthPlanAnalysis && this.wealthPlanAnalysis.trim().length > 0) {
            this._analysis = this.wealthPlanAnalysis;
            this._aiState  = STATE.DONE;
        }
    }

    renderedCallback() {
        if (!this._hasRendered) {
            this._hasRendered = true;
            setTimeout(() => { this._renderedPct = this._p; }, 50);
        }
        if (this._aiState === STATE.DONE) {
            const el = this.template.querySelector('[data-ai-panel]');
            if (el && el.innerHTML !== this._analysis) {
                el.innerHTML = this._analysis;
            }
        }
        if (this._aiState === STATE.LOADING && this.isIrisScanner && !this._irisRendered) {
            const canvas = this.template.querySelector('[data-iris-canvas]');
            if (canvas) {
                this._irisRendered = true;
                this._startIrisScanner(canvas);
            }
        }
        if (this._aiState !== STATE.LOADING && this._irisRaf) {
            cancelAnimationFrame(this._irisRaf);
            this._irisRaf      = null;
            this._irisRendered = false;
            if (this._irisObserver) { this._irisObserver.disconnect(); this._irisObserver = null; }
        }
    }

    disconnectedCallback() {
        this._clearInterval();
        if (this._irisRaf)      { cancelAnimationFrame(this._irisRaf); this._irisRaf = null; }
        if (this._irisObserver) { this._irisObserver.disconnect();     this._irisObserver = null; }
    }

    // ── Drawer ───────────────────────────────────────────────────────────────
    toggleDrawer() {
        this.isDrawerOpen = !this.isDrawerOpen;
    }

    handleExpandBtnClick(e) {
        e.stopPropagation();
        this.toggleDrawer();
    }

    get drawerClass()     { return this.isDrawerOpen ? 'wp-drawer is-open' : 'wp-drawer'; }
    get commandBarClass() { return this.isDrawerOpen ? 'wp-command-bar is-open' : 'wp-command-bar'; }
    get expandBtnClass()  { return this.isDrawerOpen ? 'expand-btn is-open' : 'expand-btn'; }
    get expandBtnText()   { return this.isDrawerOpen ? 'Close' : 'AI Insights'; }

    get trackFillStyle() {
        const done  = this.allSections.filter(s => s.isComplete).length;
        const total = this.allSections.length;
        const p = total ? ((done / total) * 100).toFixed(1) : 0;
        return `width: ${p}%;`;
    }

    // ── AI invocation ────────────────────────────────────────────────────────
    _runAnalysis() {
        this._aiState       = STATE.LOADING;
        this._loadingMsgIdx = 0;
        if (!this.isDrawerOpen) { this.isDrawerOpen = true; }
        this._startMessageCycle();

        invokeFlow({
            flowApiName:        this.flowApiName,
            recordId:           this.recordId,
            outputVariableName: this.outputVariableName
        })
        .then(result => {
            this._clearInterval();
            this._analysis = result || '';
            this._aiState  = STATE.DONE;
        })
        .catch(error => {
            this._clearInterval();
            this._errorMessage = error?.body?.message || error?.message || 'An unexpected error occurred.';
            this._aiState      = STATE.ERROR;
        });
    }

    _startMessageCycle() {
        this._clearInterval();
        this._msgInterval = setInterval(() => {
            this._loadingMsgIdx = (this._loadingMsgIdx + 1) % LOADING_MESSAGES.length;
        }, 2200);
    }

    _clearInterval() {
        if (this._msgInterval) { clearInterval(this._msgInterval); this._msgInterval = null; }
    }

    handleRetry(e) {
        e.stopPropagation();
        this._analysis     = '';
        this._errorMessage = '';
        this._runAnalysis();
    }

    handleRunAnalysis(e) {
        e.stopPropagation();
        this._analysis     = '';
        this._errorMessage = '';
        this._runAnalysis();
    }

    handleRefresh() {
        try   { this.dispatchEvent(new FlowNavigationNextEvent());   }
        catch { this.dispatchEvent(new FlowNavigationFinishEvent()); }
    }

    // ── Getters ──────────────────────────────────────────────────────────────
    get isLoading()         { return this._aiState === STATE.LOADING; }
    get isError()           { return this._aiState === STATE.ERROR;   }
    get isIdle()            { return this._aiState === STATE.IDLE;    }
    get isDone()            { return this._aiState === STATE.DONE;    }
    get isIrisScanner()     { return this.loadingVariant === 'scanner'; }
    get hasFlowConfigured() { return this.flowApiName && this.flowApiName.trim().length > 0; }
    get loadingMessage()    { return LOADING_MESSAGES[this._loadingMsgIdx]; }
    get errorMessage()      { return this._errorMessage; }

    get aiStateLabel() {
        if (this.isLoading) return 'Running...';
        if (this.isError)   return 'Unavailable';
        if (this.isDone)    return 'Complete';
        return 'Ready';
    }

    get _p() {
        const n = parseInt(this._rawProgress, 10);
        return isNaN(n) ? 0 : Math.min(100, Math.max(0, n));
    }

    // ── Segmented Donut ───────────────────────────────────────────────────────
    get donutSegments() {
        const C          = RING_FULL;
        const sections   = this.allSections;
        const n          = sections.length;
        const gapArc     = 6;
        const segArc     = (C - n * gapArc) / n;
        const halfGapDeg = (gapArc / C) * 180;
        const step       = 360 / n;
        const COLOR      = { published: '#10b981', complete: '#10b981', draft: '#0ea5e9', empty: 'rgba(0,0,0,0.08)' };

        return sections.map((s, i) => ({
            k:         `ds${i}`,
            color:     COLOR[s.state],
            dash:      `${segArc.toFixed(4)} ${(C - segArc).toFixed(4)}`,
            transform: `rotate(${(-90 + i * step + halfGapDeg).toFixed(2)} 80 80)`
        }));
    }

    // ── Section data ──────────────────────────────────────────────────────────
    get allSections() {
        const invPrefPub  = this._b(this.investmentPreferencesPublished);
        const capHasData  = this._b(this.capitalNeedsHasData);
        const capCount    = this._n(this.capitalNeedsCount);
        const riskVal     = this.riskValue  ? String(this.riskValue)  : '';
        const lockInVal   = this.lockInValue ? String(this.lockInValue) : '';
        const riskHasData = riskVal !== '' || lockInVal !== '';
        const stratCount  = this._n(this.investmentStrategyCount);
        const stratActive = this._b(this.investmentStrategyActive);

        const raw = [
            { label: 'Goals',                    shortLabel: 'Goals',        count: this._n(this.goalsCount),             pub: this._b(this.goalsPublished),             hasData: null,        publishable: true  },
            { label: 'Income',                   shortLabel: 'Income',       count: this._n(this.incomeCount),            pub: this._b(this.incomePublished),            hasData: null,        publishable: true  },
            { label: 'Assets & Liabilities',     shortLabel: 'Assets',       count: this._n(this.assetsLiabilitiesCount), pub: this._b(this.assetsLiabilitiesPublished), hasData: null,        publishable: true  },
            { label: 'Capital Needs',            shortLabel: 'Cap. Needs',   count: capCount,    pub: false,       hasData: capHasData,  publishable: false },
            { label: 'Milestones',               shortLabel: 'Milestones',   count: this._n(this.milestonesCount),        pub: this._b(this.milestonesPublished),        hasData: null,        publishable: true  },
            { label: 'Company Ownership',        shortLabel: 'Companies',    count: this._n(this.ownedCompaniesCount),    pub: this._b(this.ownedCompaniesPublished),    hasData: null,        publishable: true  },
            { label: 'Risk & Lock-In',           shortLabel: 'Risk',         count: 0,           pub: false,       hasData: riskHasData, publishable: false, extra: riskHasData ? `${riskVal}` : '' },
            { label: 'Sustainability Pref.',     shortLabel: 'Sust. Pref.',  count: this._n(this.sustainabilityCount),    pub: this._b(this.sustainabilityPublished),    hasData: null,        publishable: true  },
            { label: 'Investment Preferences',   shortLabel: 'Inv. Pref.',   count: invPrefPub ? 1 : 0, pub: invPrefPub, hasData: invPrefPub, publishable: true  },
            { label: 'Investment Strategy',      shortLabel: 'Strategy',     count: stratCount,  pub: false,       hasData: stratCount > 0, publishable: false, active: stratActive },
            { label: 'Personal Greeting',        shortLabel: 'Greeting',     count: this._n(this.personalGreetingsCount), pub: this._b(this.personalGreetingsPublished), hasData: null,        publishable: true  },
        ];

        return raw.map((s, i) => {
            const hasData = s.hasData !== null ? s.hasData : s.count > 0;
            let state;
            if (s.publishable) {
                state = s.pub ? 'published' : (hasData ? 'draft' : 'empty');
            } else {
                state = hasData ? 'complete' : 'empty';
            }

            let countText = '–';
            if (s.extra)                                countText = s.extra;
            else if (s.active !== undefined && hasData) countText = `${s.count} · ${s.active ? 'Active' : 'Inactive'}`;
            else if (hasData)                           countText = `${s.count} rec`;

            let pillCount;
            if (s.extra)   pillCount = s.extra || '–';
            else if (!hasData) pillCount = '–';
            else           pillCount = String(s.count);

            const isComplete = state === 'published' || state === 'complete';
            const isDraft    = state === 'draft';

            let statusLabel;
            if (state === 'published')  statusLabel = 'Published';
            else if (state === 'complete') statusLabel = 'Complete';
            else if (isDraft)           statusLabel = 'In progress';
            else                        statusLabel = 'Not started';

            return {
                label:               s.label,
                shortLabel:          s.shortLabel,
                countText,
                pillCount,
                statusLabel,
                rawCount:            s.count,
                publishable:         s.publishable,
                state,
                isComplete,
                isDraft,
                isEmpty:             state === 'empty',
                isTop:               i % 2 === 0,
                isBottom:            i % 2 !== 0,
                moduleGridClass:     `module-pill mpill--${state}`,
                trackNodeClass:      `track-node-wrapper node-${state}`,
                trackLblClassTop:    'track-lbl top-lbl',
                trackLblClassBottom: 'track-lbl bottom-lbl',
                bentoCardClass:      `bento-card bento-${state}`,
                nodeClass:           `node-item node-${state}`,
                drawerBadgeClass:    `mod-badge badge-${state}`,
                stripBlockClass:     `strip-block strip-block--${state}`
            };
        });
    }

    get totalCount()            { return this.allSections.length; }
    get publishedCount()        { return this.allSections.filter(s => s.state === 'published').length; }
    get publishableTotal()      { return this.allSections.filter(s => s.publishable).length; }
    get sectionsWithDataCount() { return this.allSections.filter(s => s.state !== 'empty').length; }
    get totalRecordCount()      { return this.allSections.reduce((sum, s) => sum + s.rawCount, 0); }
    get publishedCountDisplay() { return `${this.publishedCount}/${this.publishableTotal}`; }

    get pillGroups() {
        const sections = this.allSections;
        const groups = [];
        for (let i = 0; i < sections.length; i += 2) {
            groups.push({ key: `grp-${i}`, pills: sections.slice(i, i + 2) });
        }
        return groups;
    }

    get statusBadgeText() {
        if (this.publishedCount === this.publishableTotal && this.publishableTotal > 0) return 'Complete';
        if (this.sectionsWithDataCount > 0) return 'In Progress';
        return 'Needs Attention';
    }

    get statusBadgeClass() {
        const base = 'status-badge';
        if (this.publishedCount === this.publishableTotal && this.publishableTotal > 0) return `${base} status-badge--green`;
        if (this.sectionsWithDataCount > 0) return `${base} status-badge--amber`;
        return `${base} status-badge--red`;
    }

    get dynamicBgStyle() { return `--outer-bg: ${this.backgroundColor};`; }

    _n(v) { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
    _b(v) { return v === true || v === 'true'; }

    // ── AI IRIS SCANNER ───────────────────────────────────────────────────────
    _startIrisScanner(canvas) {
        if (this._irisRaf)      { cancelAnimationFrame(this._irisRaf); this._irisRaf = null; }
        if (this._irisObserver) { this._irisObserver.disconnect();     this._irisObserver = null; }

        const MAX_REF_RADIUS = 165;
        const ctx = canvas.getContext('2d');
        let W, H, CX, CY, scale;

        const setupDimensions = () => {
            W = canvas.offsetWidth  || 460;
            H = canvas.offsetHeight || Math.round(W * 0.6);
            canvas.width  = W;
            canvas.height = H;
            CX = W / 2;
            CY = H * 0.45;
            const maxHalf = Math.min(CX, CY) * 0.88;
            scale = maxHalf / MAX_REF_RADIUS;
        };

        const s = v => v * scale;
        let t = 0, scanAngle = 0;

        const RINGS = [
            { r: 28,  segs: 8,  rot: 0, spd:  0.008, w: 8, col: '80,90,220'   },
            { r: 50,  segs: 16, rot: 0, spd: -0.006, w: 6, col: '100,60,200'  },
            { r: 72,  segs: 24, rot: 0, spd:  0.005, w: 7, col: '120,70,210'  },
            { r: 95,  segs: 12, rot: 0, spd: -0.009, w: 9, col: '70,80,190'   }
        ];

        const fade = () => {
            const band = s(70);
            const g2   = ctx.createLinearGradient(0, H - band, 0, H);
            g2.addColorStop(0, 'rgba(255,255,255,0)');
            g2.addColorStop(1, 'rgba(255,255,255,1)');
            ctx.fillStyle = g2;
            ctx.fillRect(0, H - band, W, band);
        };

        const draw = () => {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, W, H);
            t += 0.012; scanAngle += 0.022;

            RINGS.forEach(ring => {
                ring.rot += ring.spd;
                const r = s(ring.r); const rw = s(ring.w);
                for (let i = 0; i < ring.segs; i++) {
                    const a0    = ring.rot + (i / ring.segs) * Math.PI * 2 + 0.04;
                    const a1    = ring.rot + ((i + 1) / ring.segs) * Math.PI * 2 - 0.04;
                    const pulse = 0.55 + 0.45 * Math.sin(t * 1.5 + i * 0.8);
                    ctx.beginPath();
                    ctx.arc(CX, CY, r, a0, a1);
                    ctx.arc(CX, CY, r - rw, a1, a0, true);
                    ctx.closePath();
                    ctx.fillStyle   = `rgba(${ring.col},${pulse * 0.12})`; ctx.fill();
                    ctx.strokeStyle = `rgba(${ring.col},${pulse * 0.45})`; ctx.lineWidth = 0.7; ctx.stroke();
                }
            });

            ctx.save();
            ctx.translate(CX, CY); ctx.rotate(scanAngle);
            const g = ctx.createLinearGradient(0, 0, s(145), 0);
            g.addColorStop(0,   'rgba(100,60,230,0.0)');
            g.addColorStop(0.5, 'rgba(100,60,230,0.13)');
            g.addColorStop(1,   'rgba(100,60,230,0.0)');
            ctx.beginPath(); ctx.moveTo(0, 0);
            ctx.arc(0, 0, s(145), -Math.PI * 0.175, Math.PI * 0.175); ctx.closePath();
            ctx.fillStyle = g; ctx.fill(); ctx.restore();

            ctx.beginPath(); ctx.arc(CX, CY, s(17), 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(100,60,230,0.9)'; ctx.fill();

            fade();
            this._irisRaf = requestAnimationFrame(draw);
        };

        setTimeout(() => {
            setupDimensions();
            if (typeof ResizeObserver !== 'undefined') {
                this._irisObserver = new ResizeObserver(() => {
                    const newW = canvas.offsetWidth;
                    if (newW && newW !== W) { setupDimensions(); }
                });
                this._irisObserver.observe(canvas);
            }
            draw();
        }, 0);
    }
}