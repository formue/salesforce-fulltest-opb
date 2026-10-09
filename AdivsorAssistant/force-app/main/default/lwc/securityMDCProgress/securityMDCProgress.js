import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getSecuritiesOverview  from '@salesforce/apex/SecurityMDCController.getSecuritiesOverview';
import getDataQualityActions  from '@salesforce/apex/SecurityMDCController.getDataQualityActions';
import completeAction         from '@salesforce/apex/SecurityMDCController.completeAction';

const DOMAINS = [
    {
        key:           'market',
        label:         'Market & Price Data',
        fields:        ['FinServ__Price__c', 'Symbol__c', 'ISIN__c', 'FinServ__SecurityId__c'],
        fieldKeywords: ['price', 'symbol', 'isin', 'security id']
    },
    {
        key:           'classification',
        label:         'Classification Data',
        fields:        ['ClassificationNO__c', 'ClassificationSE__c', 'ClassificationDK__c', 'ClassificationNordnet__c'],
        fieldKeywords: ['classification']
    },
    {
        key:           'reference',
        label:         'Reference Data',
        fields:        ['AssetClassCode__c', 'FinServ__AssetClass__c'],
        fieldKeywords: ['asset class']
    }
];

export default class SecurityMDCProgress extends LightningElement {
    @track isLoading    = true;
    @track errorMessage = '';
    @track _metrics     = null;
    @track _actions     = [];

    connectedCallback() { this.load(); }

    load() {
        this.isLoading = true;
        Promise.all([
            getSecuritiesOverview({ typeFilter: null }),
            getDataQualityActions({ securityId: null })
        ])
            .then(([metrics, actions]) => {
                this._metrics     = metrics;
                this._actions     = actions;
                this.isLoading    = false;
                this.errorMessage = '';
            })
            .catch(err => {
                this.errorMessage = err?.body?.message ?? 'Failed to load progress data.';
                this.isLoading    = false;
            });
    }

    handleComplete(event) {
        const taskId = event.currentTarget.dataset.taskid;
        completeAction({ taskId })
            .then(() => {
                this._actions = this._actions.filter(a => a.taskId !== taskId);
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Done', message: 'Action marked complete.', variant: 'success'
                }));
            })
            .catch(err => this.dispatchEvent(new ShowToastEvent({
                title: 'Error', message: err?.body?.message ?? 'Failed.', variant: 'error'
            })));
    }

    handleViewSecurity(event) {
        const taskId = event.currentTarget.dataset.taskid;
        const row    = this._actions.find(a => a.taskId === taskId);
        if (!row) return;
        this.dispatchEvent(new CustomEvent('securityselected', {
            detail: { recordId: row.securityId, securityName: row.securityName || '' },
            bubbles: true,
            composed: true
        }));
    }

    handleSeeAll() {
        this.dispatchEvent(new CustomEvent('showtab', {
            detail: { tab: 'actions' },
            bubbles: true,
            composed: true
        }));
    }

    handleViewDomainActions() { this.handleSeeAll(); }

    get hasError()         { return !!this.errorMessage; }
    get hasRecentActions() { return this.recentActions.length > 0; }

    // ── private helpers ──────────────────────────────────────────────

    _scoreColor(s) {
        if (s >= 95) return '#2e844a';
        if (s >= 80) return '#f2a73b';
        return '#ba0517';
    }

    _priorityColor(priority) {
        if (priority === 'High')   return '#ba0517';
        if (priority === 'Normal') return '#f2a73b';
        return '#0070d2';
    }

    _initials(name) {
        if (!name) return '?';
        return name.split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).join('').slice(0, 2);
    }

    _topAssignee(domainActions) {
        if (!domainActions.length) return null;
        const counts = {};
        domainActions.forEach(a => { const n = a.assigneeName || ''; counts[n] = (counts[n] || 0) + 1; });
        return Object.keys(counts).filter(k => k).sort((a, b) => counts[b] - counts[a])[0] || null;
    }

    _actionDomain(subject) {
        const s = (subject ?? '').toLowerCase();
        for (const d of DOMAINS) {
            if (d.fieldKeywords.some(kw => s.includes(kw))) return d.label;
        }
        return 'Other';
    }

    // ── computed getters ─────────────────────────────────────────────

    get domainCards() {
        const fc    = this._metrics?.fieldCompleteness ?? [];
        const fcMap = {};
        fc.forEach(f => { fcMap[f.fieldApiName] = f; });

        return DOMAINS.map(d => {
            const domFields  = d.fields.map(f => fcMap[f]).filter(Boolean);
            const avg        = domFields.length
                ? Math.round(domFields.reduce((s, f) => s + f.completenessScore, 0) / domFields.length)
                : 100;
            const domActions = this._actions.filter(a =>
                d.fieldKeywords.some(kw => (a.subject ?? '').toLowerCase().includes(kw))
            );
            const critical   = domActions.filter(a => a.priority === 'High').length;
            const topOwner   = this._topAssignee(domActions);

            const fieldTags = domFields
                .filter(f => f.completenessScore < 100)
                .sort((a, b) => a.completenessScore - b.completenessScore)
                .slice(0, 3)
                .map(f => ({ key: f.fieldApiName, label: f.fieldLabel }));

            return {
                key:            d.key,
                label:          d.label,
                controlsPct:    avg,
                openActions:    domActions.length,
                critical,
                topOwner,
                topInitials:    topOwner ? this._initials(topOwner) : null,
                fieldTags,
                fieldTagsExist: fieldTags.length > 0,
                barStyle:       `width:${avg}%; background:${this._scoreColor(avg)};`,
                criticalStyle:  `color:${critical > 0 ? '#ba0517' : '#181818'};`
            };
        });
    }

    get recentActions() {
        return [...this._actions]
            .sort((a, b) => {
                const da = a.activityDate ?? '';
                const db = b.activityDate ?? '';
                if (db < da) return -1;
                if (db > da) return  1;
                return 0;
            })
            .slice(0, 10)
            .map(a => ({
                ...a,
                severityDotStyle: `background:${this._priorityColor(a.priority)};`,
                severityLabel:    a.priority === 'High' ? 'Critical' : (a.priority ?? 'Normal'),
                domainLabel:      this._actionDomain(a.subject),
                assigneeInitials: this._initials(a.assigneeName),
                formattedDate:    a.activityDate
                    ? new Date(a.activityDate).toLocaleDateString('no-NO', {
                        day: '2-digit', month: '2-digit', year: 'numeric'
                      })
                    : '—'
            }));
    }
}
