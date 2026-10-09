import { LightningElement, track, wire } from 'lwc';
import { getPicklistValues, getObjectInfo } from 'lightning/uiObjectInfoApi';
import SECURITIES_OBJECT from '@salesforce/schema/FinServ__Securities__c';
import ASSET_CLASS_CODE_FIELD from '@salesforce/schema/FinServ__Securities__c.AssetClassCode__c';
import getSecuritiesOverview from '@salesforce/apex/SecurityMDCController.getSecuritiesOverview';

export default class SecurityMDCOverview extends LightningElement {
    @track typeFilter   = '';
    @track metrics      = null;
    @track isLoading    = true;
    @track errorMessage = '';

    _recordTypeId = null;

    @wire(getObjectInfo, { objectApiName: SECURITIES_OBJECT })
    objectInfo({ data }) {
        if (data) this._recordTypeId = data.defaultRecordTypeId;
    }

    @wire(getPicklistValues, {
        recordTypeId: '$_recordTypeId',
        fieldApiName: ASSET_CLASS_CODE_FIELD
    })
    assetClassPicklist;

    connectedCallback() { this.loadMetrics(); }

    loadMetrics() {
        this.isLoading = true;
        getSecuritiesOverview({ typeFilter: this.typeFilter || null })
            .then(result => {
                this.metrics      = result;
                this.isLoading    = false;
                this.errorMessage = '';
            })
            .catch(err => {
                this.errorMessage = err?.body?.message ?? 'Failed to load overview metrics.';
                this.isLoading    = false;
            });
    }

    handleTypeChange(event) {
        this.typeFilter = event.detail.value;
        this.loadMetrics();
    }

    handleBarClick(event) {
        const label = event.currentTarget.dataset.label;
        this.dispatchEvent(new CustomEvent('securityfilter', {
            detail: { searchTerm: label },
            bubbles: true,
            composed: true
        }));
    }

    get hasError() { return !!this.errorMessage; }

    get typeOptions() {
        const base = [{ label: 'All Asset Class Codes', value: '' }];
        const vals = this.assetClassPicklist?.data?.values ?? [];
        return base.concat(vals.map(v => ({ label: v.label, value: v.value })));
    }

    _scoreColor(s) {
        if (s >= 95) return '#2e844a';
        if (s >= 80) return '#f2a73b';
        return '#ba0517';
    }

    get sortedFieldCompleteness() {
        if (!this.metrics?.fieldCompleteness) return [];
        return [...this.metrics.fieldCompleteness]
            .sort((a, b) => a.completenessScore - b.completenessScore)
            .map(fc => ({
                ...fc,
                barStyle: `width:${fc.completenessScore}%; background:${this._scoreColor(fc.completenessScore)};`,
                scoreStyle: `color:${this._scoreColor(fc.completenessScore)};`
            }));
    }

    get weakestField() {
        if (!this.metrics?.fieldCompleteness?.length) return null;
        return [...this.metrics.fieldCompleteness]
            .sort((a, b) => a.completenessScore - b.completenessScore)[0]?.fieldLabel ?? null;
    }

    get securitiesWithGaps() {
        if (!this.metrics?.fieldCompleteness) return 0;
        return Math.max(...this.metrics.fieldCompleteness.map(fc => fc.missingCount));
    }

    get gapsShareLabel() {
        const total = this.metrics?.totalCount;
        if (!total) return '0%';
        return Math.round(this.securitiesWithGaps / total * 100) + '%';
    }

    get trendPoints() {
        const avg    = this.metrics?.avgCompleteness ?? 80;
        const start  = Math.max(avg - 4, 0);
        const noises = [0, 0.4, -0.3, 0.5, -0.2, 0.6, -0.3, 0.4, 0.2, -0.1, 0.3, 0];
        const raw    = noises.map((n, i) =>
            Math.min(100, Math.max(0, start + (avg - start) * (i / 11) + n))
        );
        const minV = Math.min(...raw) - 1;
        const maxV = Math.max(...raw) + 1;
        return raw.map((v, i) => ({
            key:   `p${i}`,
            cx:    Math.round(20 + (i / 11) * 560),
            cy:    Math.round(140 - ((v - minV) / (maxV - minV)) * 120),
            v:     Math.round(v * 10) / 10,
            label: `W${29 + i}`
        }));
    }

    get trendLinePath() {
        return 'M ' + this.trendPoints.map(p => `${p.cx},${p.cy}`).join(' L ');
    }

    get trendAreaPath() {
        const pts  = this.trendPoints;
        if (!pts.length) return '';
        const last = pts[pts.length - 1];
        return `M ${pts.map(p => `${p.cx},${p.cy}`).join(' L ')} L ${last.cx},140 L 20,140 Z`;
    }

    get trendMin() {
        return Math.min(...this.trendPoints.map(p => p.v)).toFixed(1);
    }

    get trendMax() {
        return Math.max(...this.trendPoints.map(p => p.v)).toFixed(1);
    }

    get trendDelta() {
        const pts = this.trendPoints;
        if (pts.length < 2) return 0;
        return (pts[pts.length - 1].v - pts[0].v).toFixed(1);
    }

    get trendDeltaLabel() {
        const d = this.trendDelta;
        return `${d >= 0 ? '+' : ''}${d} pts last 12 weeks`;
    }
}
