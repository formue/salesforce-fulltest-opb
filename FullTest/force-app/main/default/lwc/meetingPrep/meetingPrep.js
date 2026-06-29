import { LightningElement, api, track } from 'lwc';
import generateTopicSuggestions from '@salesforce/apex/MeetingPrepController.generateTopicSuggestions';
import getTasksForAccounts from '@salesforce/apex/MeetingPrepController.getTasksForAccounts';
import getEventsForAccounts from '@salesforce/apex/MeetingPrepController.getEventsForAccounts';
import getMilestones from '@salesforce/apex/MeetingPrepController.getMilestones';
import getHoldingsFromFlow from '@salesforce/apex/PortfolioFlowService.getHoldingsFromFlow';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 365 * DAY_MS;
const BOUNDARY_LIMIT = 2.0;
const DRIFT_ALERT = 5;
const TASKS_PREVIEW_LIMIT = 5;
const LIFE_EVENT_LIMIT = 5;
const LIFE_EVENT_WINDOW_DAYS = 365;
const ICON_BIRTHDAY = 'M12 3v3M9 8h6a3 3 0 0 1 3 3v0a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v0a3 3 0 0 1 3-3zM5 14h14v6H5z';
const ICON_MILESTONE = 'M5 21V4a1 1 0 0 1 1-1h11l-2 4 2 4H6';

const ASSETS = [
    { key: 'pm', label: 'Money Market',   color: '#8b5cf6' },
    { key: 'ob', label: 'Bonds',          color: '#3b82f6' },
    { key: 'ak', label: 'Equities',       color: '#10b981' },
    { key: 'hf', label: 'Hedgefund',      color: '#f59e0b' },
    { key: 'ei', label: 'Real Assets',    color: '#ef4444' },
    { key: 'pe', label: 'Private Equity', color: '#ec4899' }
];

const dateFmt = new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' });
const pctFmt = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function normalizeClass(raw) {
    if (!raw) return '';
    return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}

function trim15(id) {
    return id ? String(id).trim().substring(0, 15) : '';
}

export default class MeetingPrep extends LightningElement {
    // ── Active inputs ──
    @api recordId = '';
    @api inputPrimaryMember;
    @api inputHouseholdMembers = [];
    @api inputBusinessAccounts = [];
    @api portfolioFlowApiName = 'Portfolio_Level_AI_Generation';
    @api taskFlowApiName = 'MeetingPrep_SUB_GetTasks';
    @api eventFlowApiName = 'MeetingPrep_SUB_GetEvents';
    @api milestoneFlowApiName = 'MeetingPrep_SUB_GetMilestones';
    @api topicSuggestionFlowApiName = '';
    @api customerName = '';
    @api backgroundColor = '#f0f9ff';

    // ── Deprecated inputs (kept to keep old deployed flow versions valid) ──
    @api inputStrategy;
    @api inputPortfolio;
    @api inputTasks;
    @api inputEvents;

    // ── UI state ──
    @track isCorporateTheme = true;
    @track tasksExpanded = true;
    @track eventsExpanded = true;
    @track topicsExpanded = false;

    // ── Selection state ──
    @track _selectedPersonIds = new Set();
    @track _selectedBusinessIds = new Set();
    @track _loadedAccountIds = new Set();
    @track _activeStrategyTab = '';
    @track _activeTasksTab = '__all__';
    @track _activeEventsTab = '__all__';

    // ── Data state ──
    @track _strategyByAccount = {};
    @track _tasks = [];
    @track _events = [];
    @track _milestones = [];

    // ── Loading / error state ──
    @track _holdingsLoading = false;
    @track _holdingsError = '';
    @track _activityLoading = false;

    // ── Topic suggestions ──
    @track _topics = [];
    @track _topicsLoading = false;
    @track _topicsError = '';
    _topicsRequested = false;

    // ─────────────────────────────────────────────────────
    // LIFECYCLE
    // ─────────────────────────────────────────────────────
    connectedCallback() {
        // Initial selection is the primary member only; other chips start unchecked.
        this._loadedAccountIds = new Set(this.selectedAccountIds);
        if (this.primaryMemberId) {
            this._activeStrategyTab = this.primaryMemberId;
        }
        this._loadAll();
    }

    // ─────────────────────────────────────────────────────
    // SAFE INPUT GUARDS
    // ─────────────────────────────────────────────────────
    safeArr(v) { return Array.isArray(v) ? v : (v ? [v] : []); }
    get safeHouseholdMembers() { return this.safeArr(this.inputHouseholdMembers); }
    get safeBusinessAccounts() { return this.safeArr(this.inputBusinessAccounts); }

    // ─────────────────────────────────────────────────────
    // ACCOUNT DICTIONARY + SELECTION
    // ─────────────────────────────────────────────────────
    get primaryMemberId() { return trim15(this.inputPrimaryMember?.Id); }
    get primaryMemberName() { return this.inputPrimaryMember?.Name || 'Primary'; }

    get accountDictionary() {
        const dict = {};
        const all = [this.inputPrimaryMember, ...this.safeHouseholdMembers, ...this.safeBusinessAccounts];
        all.forEach(a => {
            if (a && a.Id && a.Name) dict[trim15(a.Id)] = a.Name;
        });
        return dict;
    }

    get otherPersonAccounts() {
        const primaryId = this.primaryMemberId;
        return this.safeHouseholdMembers.filter(a => trim15(a?.Id) !== primaryId);
    }

    get hasOtherPersonAccounts() { return this.otherPersonAccounts.length > 0; }
    get hasBusinessAccounts() { return this.safeBusinessAccounts.length > 0; }

    get personAccountChips() {
        return this.otherPersonAccounts.map(a => {
            const id = trim15(a.Id);
            const selected = this._selectedPersonIds.has(id);
            return {
                id,
                name: a.Name,
                selected,
                chipClass: selected ? 'source-chip source-chip-active' : 'source-chip'
            };
        });
    }

    get businessAccountChips() {
        return this.safeBusinessAccounts.map(a => {
            const id = trim15(a.Id);
            const selected = this._selectedBusinessIds.has(id);
            return {
                id,
                name: a.Name,
                selected,
                chipClass: selected ? 'source-chip source-chip-business source-chip-active' : 'source-chip source-chip-business'
            };
        });
    }

    get selectedAccountIds() {
        const ids = [];
        if (this.primaryMemberId) ids.push(this.primaryMemberId);
        this._selectedPersonIds.forEach(id => { if (id !== this.primaryMemberId) ids.push(id); });
        this._selectedBusinessIds.forEach(id => ids.push(id));
        return ids;
    }

    get selectedAccounts() {
        const dict = this.accountDictionary;
        const primaryId = this.primaryMemberId;
        return this.selectedAccountIds.map(id => ({
            id,
            name: dict[id] || '(Account)',
            isPrimary: id === primaryId
        }));
    }

    _selectionSignature(set) {
        // Used to detect whether the current selection has diverged from what's been loaded.
        return [...set].sort().join('|');
    }

    get pendingChanges() {
        const current = this._selectionSignature(new Set(this.selectedAccountIds));
        const loaded = this._selectionSignature(this._loadedAccountIds);
        return current !== loaded;
    }

    get updateBtnDisabled() {
        return !this.pendingChanges || this._holdingsLoading || this._activityLoading;
    }

    get updateBtnLabel() {
        if (this._holdingsLoading || this._activityLoading) return 'Loading…';
        return this.pendingChanges ? 'Update data' : 'Data is up to date';
    }

    // ── Chip toggle handlers ──
    handleTogglePerson(event) {
        const id = event.currentTarget?.dataset?.id;
        if (!id) return;
        const next = new Set(this._selectedPersonIds);
        if (next.has(id)) next.delete(id); else next.add(id);
        this._selectedPersonIds = next;
    }

    handleToggleBusiness(event) {
        const id = event.currentTarget?.dataset?.id;
        if (!id) return;
        const next = new Set(this._selectedBusinessIds);
        if (next.has(id)) next.delete(id); else next.add(id);
        this._selectedBusinessIds = next;
    }

    handleUpdateData() {
        this._loadAll();
    }

    // ─────────────────────────────────────────────────────
    // DATA FETCH
    // ─────────────────────────────────────────────────────
    async _loadAll() {
        const ids = this.selectedAccountIds;
        if (!ids.length) return;

        this._holdingsLoading = true;
        this._activityLoading = true;
        this._holdingsError = '';

        const portfolioPromises = ids.map(id => this._fetchHoldingsForAccount(id));
        const tasksPromise = this._fetchTasksForAccounts(ids);
        const eventsPromise = this._fetchEventsForAccounts(ids);
        const milestonesPromise = this._fetchMilestones();

        try {
            await Promise.all([...portfolioPromises, tasksPromise, eventsPromise, milestonesPromise]);
            this._loadedAccountIds = new Set(ids);
            if (!this._activeStrategyTab || !ids.includes(this._activeStrategyTab)) {
                this._activeStrategyTab = this.primaryMemberId || ids[0];
            }
            if (this._activeTasksTab !== '__all__' && !ids.includes(this._activeTasksTab)) {
                this._activeTasksTab = '__all__';
            }
            if (this._activeEventsTab !== '__all__' && !ids.includes(this._activeEventsTab)) {
                this._activeEventsTab = '__all__';
            }
        } catch (err) {
            // individual fetches already capture per-section errors; this catches an unexpected wrapper failure
            console.error('MeetingPrep load failed', err);
        } finally {
            this._holdingsLoading = false;
            this._activityLoading = false;
        }
    }

    async _fetchHoldingsForAccount(accountId) {
        if (!this.portfolioFlowApiName) return;
        try {
            const jsonResult = await getHoldingsFromFlow({
                flowApiName: this.portfolioFlowApiName,
                accountId
            });
            const next = { ...this._strategyByAccount };
            if (jsonResult) {
                const result = JSON.parse(jsonResult);
                const strategies = Array.isArray(result.strategies) ? result.strategies : [];
                const holdings = Array.isArray(result.holdings) ? result.holdings : [];
                next[accountId] = {
                    weights: this._mapStrategyToTargets(strategies),
                    values: this._mapHoldingsToValues(holdings).values,
                    total: this._mapHoldingsToValues(holdings).total,
                    error: ''
                };
            } else {
                next[accountId] = { weights: this._emptyAlloc(), values: this._emptyAlloc(), total: 0, error: '' };
            }
            this._strategyByAccount = next;
        } catch (err) {
            const next = { ...this._strategyByAccount };
            next[accountId] = {
                weights: this._emptyAlloc(),
                values: this._emptyAlloc(),
                total: 0,
                error: (err && err.body && err.body.message) ? err.body.message : (err?.message || 'Failed to load portfolio.')
            };
            this._strategyByAccount = next;
        }
    }

    async _fetchTasksForAccounts(accountIds) {
        if (!this.taskFlowApiName) { this._tasks = []; return; }
        try {
            const result = await getTasksForAccounts({
                flowApiName: this.taskFlowApiName,
                accountIds
            });
            this._tasks = Array.isArray(result) ? result : [];
        } catch (err) {
            this._tasks = [];
            console.error('Tasks fetch failed', err);
        }
    }

    async _fetchEventsForAccounts(accountIds) {
        if (!this.eventFlowApiName) { this._events = []; return; }
        try {
            const result = await getEventsForAccounts({
                flowApiName: this.eventFlowApiName,
                accountIds
            });
            this._events = Array.isArray(result) ? result : [];
        } catch (err) {
            this._events = [];
            console.error('Events fetch failed', err);
        }
    }

    async _fetchMilestones() {
        if (!this.milestoneFlowApiName || !this.recordId) { this._milestones = []; return; }
        try {
            const result = await getMilestones({
                flowApiName: this.milestoneFlowApiName,
                recordIds: [this.recordId]
            });
            this._milestones = Array.isArray(result) ? result : [];
        } catch (err) {
            this._milestones = [];
            console.error('Milestones fetch failed', err);
        }
    }

    _emptyAlloc() {
        return { pm: 0, ob: 0, ak: 0, hf: 0, ei: 0, pe: 0 };
    }

    _mapStrategyToTargets(strategies) {
        const nw = this._emptyAlloc();
        strategies.forEach(s => {
            const v = s.Target__c || 0;
            switch (s.AssetClass__c) {
                case 'b': nw.pm = v; break;
                case 't': nw.ob = v; break;
                case 'e': nw.ak = v; break;
                case 'g': nw.hf = v; break;
                case 'i': nw.ei = v; break;
                case 'p': nw.pe = v; break;
                default: break;
            }
        });
        return nw;
    }

    _mapHoldingsToValues(holdings) {
        const nv = this._emptyAlloc();
        let total = 0;
        holdings.forEach(h => {
            const nc = normalizeClass(h.FinServ__AssetClass__c);
            const mv = h.FinServ__MarketValue__c || 0;
            switch (nc) {
                case 'money market':
                case 'money market/cash':
                    nv.pm += mv; break;
                case 'bonds':
                    nv.ob += mv; break;
                case 'equities':
                    nv.ak += mv; break;
                case 'hedgefund':
                case 'hedgefunds':
                case 'hedge fund':
                case 'hedge funds':
                    nv.hf += mv; break;
                case 'real estate':
                case 'real assets':
                    nv.ei += mv; break;
                case 'private equity':
                    nv.pe += mv; break;
                default: break;
            }
            total += mv;
        });
        return { values: nv, total };
    }

    // ─────────────────────────────────────────────────────
    // STRATEGY (per-account, tabbed)
    // ─────────────────────────────────────────────────────
    _strategyRowsFor(accountId) {
        const acct = this._strategyByAccount[accountId];
        const weights = acct?.weights || this._emptyAlloc();
        const values = acct?.values || this._emptyAlloc();
        const total = acct?.total || 0;
        return ASSETS.map(a => {
            const strategyPct = weights[a.key] || 0;
            const value = values[a.key] || 0;
            const currentPct = total > 0 ? (value / total) * 100 : null;
            const hasBoth = strategyPct > 0 && currentPct != null;
            const drift = hasBoth ? currentPct - strategyPct : null;
            const driftAbs = drift == null ? null : Math.abs(drift);
            let driftClass = 'drift-cell drift-ok';
            if (driftAbs != null) {
                if (driftAbs >= DRIFT_ALERT) driftClass = 'drift-cell drift-alert';
                else if (driftAbs > BOUNDARY_LIMIT) driftClass = 'drift-cell drift-warn';
            }
            const stratBar = Math.max(0, Math.min(100, strategyPct));
            const currBar = currentPct == null ? 0 : Math.max(0, Math.min(100, currentPct));
            return {
                key: a.key,
                label: a.label,
                color: a.color,
                strategyDisplay: strategyPct > 0 ? `${pctFmt.format(strategyPct)} %` : '—',
                portfolioDisplay: currentPct == null ? '—' : `${pctFmt.format(currentPct)} %`,
                driftDisplay: drift == null ? '—' : `${drift > 0 ? '+' : ''}${pctFmt.format(drift)} %`,
                driftClass,
                strategyBarStyle: `width:${stratBar}%; background:${a.color};`,
                portfolioBarStyle: `width:${currBar}%; background:${a.color};`
            };
        });
    }

    get strategyTabs() {
        const active = this._activeStrategyTab;
        return this.selectedAccounts.map(acct => ({
            id: acct.id,
            name: acct.name,
            isPrimary: acct.isPrimary,
            isActive: acct.id === active,
            tabClass: acct.id === active ? 'strategy-tab strategy-tab-active' : 'strategy-tab',
            error: this._strategyByAccount[acct.id]?.error || ''
        }));
    }

    get showStrategyTabs() { return this.strategyTabs.length > 1; }

    get activeStrategyAccountName() {
        const dict = this.accountDictionary;
        return dict[this._activeStrategyTab] || this.primaryMemberName;
    }

    get activeStrategyError() {
        return this._strategyByAccount[this._activeStrategyTab]?.error || '';
    }

    get hasActiveStrategyError() { return !!this.activeStrategyError; }

    get activeStrategyRows() {
        return this._strategyRowsFor(this._activeStrategyTab);
    }

    get hasActiveStrategyData() {
        const acct = this._strategyByAccount[this._activeStrategyTab];
        if (!acct) return false;
        const anyWeight = Object.values(acct.weights || {}).some(v => v > 0);
        return anyWeight || acct.total > 0;
    }

    handleSelectStrategyTab(event) {
        const id = event.currentTarget?.dataset?.id;
        if (id) this._activeStrategyTab = id;
    }

    get holdingsLoading() { return this._holdingsLoading; }

    // ─────────────────────────────────────────────────────
    // ACTIVITY TABS (Tasks + Events)
    // ─────────────────────────────────────────────────────
    get showActivityTabs() { return this.selectedAccounts.length > 1; }

    _buildActivityTabs(activeTabId, sourceList) {
        const tabs = [{
            id: '__all__',
            name: 'All',
            count: sourceList.length,
            isPrimary: false,
            isActive: activeTabId === '__all__',
            tabClass: activeTabId === '__all__' ? 'activity-tab activity-tab-active' : 'activity-tab'
        }];
        this.selectedAccounts.forEach(acct => {
            const count = sourceList.filter(r => trim15(r.WhatId) === acct.id).length;
            tabs.push({
                id: acct.id,
                name: acct.name,
                count,
                isPrimary: acct.isPrimary,
                isActive: activeTabId === acct.id,
                tabClass: activeTabId === acct.id ? 'activity-tab activity-tab-active' : 'activity-tab'
            });
        });
        return tabs;
    }

    get tasksTabs() { return this._buildActivityTabs(this._activeTasksTab, this._tasks); }
    get eventsTabs() { return this._buildActivityTabs(this._activeEventsTab, this._events); }

    get filteredTasks() {
        if (this._activeTasksTab === '__all__') return this._tasks;
        return this._tasks.filter(t => trim15(t.WhatId) === this._activeTasksTab);
    }
    get filteredEvents() {
        if (this._activeEventsTab === '__all__') return this._events;
        return this._events.filter(e => trim15(e.WhatId) === this._activeEventsTab);
    }

    handleSelectTasksTab(event) {
        const id = event.currentTarget?.dataset?.id;
        if (id) this._activeTasksTab = id;
    }
    handleSelectEventsTab(event) {
        const id = event.currentTarget?.dataset?.id;
        if (id) this._activeEventsTab = id;
    }

    // ─────────────────────────────────────────────────────
    // LIFE EVENTS (birthdays + milestones)
    // ─────────────────────────────────────────────────────
    _nextBirthdayDate(birthdate) {
        const d = this._toDate(birthdate);
        if (!d) return null;
        const now = new Date();
        const candidate = new Date(now.getFullYear(), d.getMonth(), d.getDate());
        if (candidate.getTime() < now.setHours(0, 0, 0, 0)) {
            candidate.setFullYear(candidate.getFullYear() + 1);
        }
        return candidate;
    }

    _daysUntil(target) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diff = target.getTime() - today.getTime();
        return Math.round(diff / DAY_MS);
    }

    _milestoneDate(m) {
        const yearRaw = m?.Milestone_Year__c;
        if (yearRaw == null || yearRaw === '') return null;
        const year = parseInt(String(yearRaw).trim(), 10);
        if (isNaN(year)) return null;
        return new Date(year, 0, 1);
    }

    get lifeEvents() {
        const selected = new Set(this.selectedAccountIds);
        const dict = this.accountDictionary;
        const entries = [];

        // Birthdays — primary + person household members (skip businesses)
        const persons = [this.inputPrimaryMember, ...this.safeHouseholdMembers].filter(Boolean);
        persons.forEach(a => {
            const id = trim15(a.Id);
            if (!selected.has(id)) return;
            const bd = a.PersonBirthdate || a.Birthdate;
            const nextDate = this._nextBirthdayDate(bd);
            if (!nextDate) return;
            const daysUntil = this._daysUntil(nextDate);
            if (daysUntil < 0 || daysUntil > LIFE_EVENT_WINDOW_DAYS) return;
            const owner = this._ownerInfo(a.Id);
            entries.push({
                key: 'b_' + id,
                type: 'birthday',
                chipClass: 'life-event-chip life-event-chip-birthday',
                iconPath: ICON_BIRTHDAY,
                label: `${a.Name}'s birthday`,
                dateDisplay: this._formatDate(nextDate),
                daysUntil,
                daysDisplay: daysUntil === 0 ? 'today' : `in ${daysUntil} d`,
                ownerName: owner.name,
                ownerBadgeClass: owner.badgeClass,
                hasOwner: owner.name !== '—'
            });
        });

        // Milestones — household-level
        this._milestones.forEach(m => {
            const date = this._milestoneDate(m);
            if (!date) return;
            const daysUntil = this._daysUntil(date);
            // For milestones we accept the entire milestone-year; show even when Jan 1 has passed
            // but the year is still current (treat as 0 days), and any future-year milestone in window.
            let effective = daysUntil;
            let display;
            if (daysUntil > LIFE_EVENT_WINDOW_DAYS) return;
            if (daysUntil < 0) {
                // Same calendar year, Jan 1 already passed — show as "this year"
                const yearNow = new Date().getFullYear();
                if (date.getFullYear() !== yearNow) return;
                effective = 0;
                display = 'this year';
            } else {
                display = daysUntil === 0 ? 'today' : `in ${daysUntil} d`;
            }
            const owner = this._ownerInfo(m.RelatedHousehold__c);
            entries.push({
                key: 'm_' + (m.Id || Math.random().toString(36)),
                type: 'milestone',
                chipClass: 'life-event-chip life-event-chip-milestone',
                iconPath: ICON_MILESTONE,
                label: m.Name || 'Milestone',
                dateDisplay: String(m.Milestone_Year__c || ''),
                daysUntil: effective,
                daysDisplay: display,
                ownerName: owner.name,
                ownerBadgeClass: owner.badgeClass,
                hasOwner: owner.name !== '—'
            });
        });

        entries.sort((a, b) => a.daysUntil - b.daysUntil);
        return entries.slice(0, LIFE_EVENT_LIMIT);
    }

    get hasLifeEvents() { return this.lifeEvents.length > 0; }

    // ─────────────────────────────────────────────────────
    // OWNER TAGGING
    // ─────────────────────────────────────────────────────
    _ownerInfo(whatId) {
        const id = trim15(whatId);
        const name = this.accountDictionary[id];
        const isPrimary = id && id === this.primaryMemberId;
        return {
            id,
            name: name || '—',
            badgeClass: isPrimary
                ? 'badge-tiny badge-owner badge-owner-primary'
                : 'badge-tiny badge-owner'
        };
    }

    // ─────────────────────────────────────────────────────
    // DATE HELPERS
    // ─────────────────────────────────────────────────────
    _toDate(value) {
        if (!value) return null;
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }
    _eventDate(e) {
        return this._toDate(e?.ActivityDateTime || e?.StartDateTime || e?.ActivityDate);
    }
    _taskDate(t) {
        return this._toDate(t?.ActivityDate || t?.CompletedDateTime || t?.CreatedDate);
    }
    _formatDate(d) { return d ? dateFmt.format(d) : ''; }

    // ─────────────────────────────────────────────────────
    // STATS
    // ─────────────────────────────────────────────────────
    get touchpointCount12mo() {
        const cutoff = Date.now() - WINDOW_MS;
        const inWindow = (d) => d && d.getTime() >= cutoff;
        const events = this._events.filter(e => inWindow(this._eventDate(e))).length;
        const tasks = this._tasks.filter(t => inWindow(this._taskDate(t))).length;
        return events + tasks;
    }

    get tasksCompletedList() {
        return this.filteredTasks.filter(t => (t.Status || '').toLowerCase() === 'completed');
    }
    get tasksOpenList() {
        return this.filteredTasks.filter(t => (t.Status || '').toLowerCase() !== 'completed');
    }
    get tasksCompletedCount() { return this.tasksCompletedList.length; }
    get tasksOpenCount() { return this.tasksOpenList.length; }
    get tasksOpenVariant() { return this.tasksOpenCount > 0 ? 'red' : 'default'; }

    get lastMeeting() {
        const now = Date.now();
        const past = this._events
            .map(e => ({ ev: e, d: this._eventDate(e) }))
            .filter(x => x.d && x.d.getTime() <= now)
            .sort((a, b) => b.d.getTime() - a.d.getTime());
        return past.length ? past[0] : null;
    }
    get hasLastMeeting() { return !!this.lastMeeting; }
    get lastMeetingSubject() { return this.lastMeeting?.ev?.Subject || '(No subject)'; }
    get lastMeetingDate() { return this._formatDate(this.lastMeeting?.d); }
    get lastMeetingLocation() { return this.lastMeeting?.ev?.Location || ''; }
    get lastMeetingDescription() {
        const desc = this.lastMeeting?.ev?.Description || '';
        return desc.length > 280 ? desc.slice(0, 277) + '…' : desc;
    }
    get lastMeetingOwner() {
        return this.lastMeeting ? this._ownerInfo(this.lastMeeting.ev?.WhatId) : null;
    }
    get hasLastMeetingOwner() {
        const o = this.lastMeetingOwner;
        return !!(o && o.name && o.name !== '—');
    }
    get daysSinceLastMeeting() {
        if (!this.lastMeeting) return '—';
        const diff = Date.now() - this.lastMeeting.d.getTime();
        return String(Math.floor(diff / DAY_MS));
    }

    // ─────────────────────────────────────────────────────
    // THEME + HEADER
    // ─────────────────────────────────────────────────────
    get containerClass() {
        return this.isCorporateTheme ? 'mp-container theme-corporate' : 'mp-container';
    }
    get dynamicBgStyle() {
        return this.isCorporateTheme
            ? '--component-bg-color: #eeebe5;'
            : `--component-bg-color: ${this.backgroundColor};`;
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

    get headerSubtitle() {
        const name = this.customerName || this.primaryMemberName;
        return name ? `Briefing for ${name}` : 'Customer briefing before the upcoming meeting';
    }

    // ─────────────────────────────────────────────────────
    // EVENTS LIST
    // ─────────────────────────────────────────────────────
    _participantsOf(e) {
        const parts = [];
        const whoName = e?.Who?.Name;
        const ownerName = e?.Owner?.Name;
        if (whoName) parts.push(whoName);
        if (ownerName && ownerName !== whoName) parts.push(ownerName);
        return parts.join(' · ');
    }
    get eventRows() {
        return this.filteredEvents
            .map(e => {
                const d = this._eventDate(e);
                const owner = this._ownerInfo(e.WhatId);
                return {
                    key: e.Id || Math.random().toString(36),
                    subject: e.Subject || '(Untitled event)',
                    dateDisplay: this._formatDate(d),
                    sortDate: d ? d.getTime() : 0,
                    type: e.Type || '',
                    location: e.Location || '',
                    participants: this._participantsOf(e),
                    ownerName: owner.name,
                    ownerBadgeClass: owner.badgeClass,
                    hasOwner: owner.name !== '—'
                };
            })
            .sort((a, b) => b.sortDate - a.sortDate);
    }
    get eventCount() { return this.eventRows.length; }
    get hasEvents() { return this.eventCount > 0; }

    // ─────────────────────────────────────────────────────
    // TASKS SPLIT PREVIEW
    // ─────────────────────────────────────────────────────
    _previewTasks(list) {
        return list
            .slice()
            .sort((a, b) => {
                const da = this._taskDate(a)?.getTime() ?? 0;
                const db = this._taskDate(b)?.getTime() ?? 0;
                return db - da;
            })
            .slice(0, TASKS_PREVIEW_LIMIT)
            .map(t => {
                const owner = this._ownerInfo(t.WhatId);
                return {
                    key: t.Id || Math.random().toString(36),
                    subject: t.Subject || '(Untitled)',
                    dueDisplay: this._formatDate(this._taskDate(t)),
                    priority: t.Priority || '',
                    status: t.Status || '',
                    ownerName: owner.name,
                    ownerBadgeClass: owner.badgeClass,
                    hasOwner: owner.name !== '—'
                };
            });
    }
    get tasksCompletedPreview() { return this._previewTasks(this.tasksCompletedList); }
    get tasksOpenPreview() { return this._previewTasks(this.tasksOpenList); }
    get tasksCompletedMore() {
        const n = this.tasksCompletedCount - TASKS_PREVIEW_LIMIT;
        return n > 0 ? `+${n} more completed` : '';
    }
    get tasksOpenMore() {
        const n = this.tasksOpenCount - TASKS_PREVIEW_LIMIT;
        return n > 0 ? `+${n} more open` : '';
    }
    get hasCompletedTasks() { return this.tasksCompletedCount > 0; }
    get hasOpenTasks() { return this.tasksOpenCount > 0; }

    // ─────────────────────────────────────────────────────
    // ACCORDIONS
    // ─────────────────────────────────────────────────────
    get tasksBodyClass() { return this.tasksExpanded ? 'ai-body expanded' : 'ai-body collapsed'; }
    get tasksChevronClass() { return this.tasksExpanded ? 'ai-chevron open' : 'ai-chevron'; }
    get eventsBodyClass() { return this.eventsExpanded ? 'ai-body expanded' : 'ai-body collapsed'; }
    get eventsChevronClass() { return this.eventsExpanded ? 'ai-chevron open' : 'ai-chevron'; }
    get topicsBodyClass() { return this.topicsExpanded ? 'ai-body expanded' : 'ai-body collapsed'; }
    get topicsChevronClass() { return this.topicsExpanded ? 'ai-chevron open' : 'ai-chevron'; }

    handleToggleTasks() { this.tasksExpanded = !this.tasksExpanded; }
    handleToggleEvents() { this.eventsExpanded = !this.eventsExpanded; }
    handleToggleTopics() {
        this.topicsExpanded = !this.topicsExpanded;
        if (this.topicsExpanded && !this._topicsRequested) {
            this._loadTopicSuggestions();
        }
    }

    // ─────────────────────────────────────────────────────
    // AI TOPIC SUGGESTIONS
    // ─────────────────────────────────────────────────────
    get hasTopics() { return this._topics && this._topics.length > 0; }
    get topics() { return this._topics; }
    get topicsLoading() { return this._topicsLoading; }
    get topicsError() { return this._topicsError; }
    get topicsFlowConfigured() { return !!(this.topicSuggestionFlowApiName && this.topicSuggestionFlowApiName.trim()); }
    get topicsEmptyMessage() {
        if (!this.topicsFlowConfigured) return 'No AI flow configured. Pass the topicSuggestionFlowApiName property to enable suggestions.';
        return 'No suggestions returned. Try expanding the section again or check the flow output.';
    }

    async _loadTopicSuggestions() {
        if (!this.topicsFlowConfigured) {
            this._topicsRequested = true;
            return;
        }
        this._topicsRequested = true;
        this._topicsLoading = true;
        this._topicsError = '';
        try {
            const TRUNC = 500;
            const trunc = s => (typeof s === 'string' && s.length > TRUNC) ? s.slice(0, TRUNC) + '…' : (s || '');
            const dict = this.accountDictionary;
            const ownerName = whatId => dict[trim15(whatId)] || '';
            const tasks = this._tasks.map(t => ({
                subject: t.Subject || '',
                description: trunc(t.Description),
                status: t.Status || '',
                priority: t.Priority || '',
                activityDate: t.ActivityDate || null,
                owner: ownerName(t.WhatId)
            }));
            const events = this._events.map(e => ({
                subject: e.Subject || '',
                description: trunc(e.Description),
                location: e.Location || '',
                startDateTime: e.ActivityDateTime || e.StartDateTime || null,
                type: e.Type || '',
                owner: ownerName(e.WhatId)
            }));
            const strategyByAccount = this.selectedAccounts.map(acct => ({
                accountName: acct.name,
                isPrimary: acct.isPrimary,
                drift: this._strategyRowsFor(acct.id).map(r => ({ label: r.label, drift: r.driftDisplay }))
            }));
            const lifeEvents = this.lifeEvents.map(e => ({
                type: e.type,
                label: e.label,
                dateDisplay: e.dateDisplay,
                daysUntil: e.daysUntil,
                owner: e.ownerName !== '—' ? e.ownerName : ''
            }));
            const context = {
                household: {
                    primary: this.primaryMemberName,
                    selectedAccounts: this.selectedAccounts.map(a => ({ name: a.name, isPrimary: a.isPrimary }))
                },
                touchpoints12mo: this.touchpointCount12mo,
                tasksOpen: this.tasksOpenCount,
                tasksCompleted: this.tasksCompletedCount,
                daysSinceLastMeeting: this.daysSinceLastMeeting,
                lastMeetingSubject: this.lastMeetingSubject,
                strategyByAccount,
                lifeEvents,
                tasks,
                events
            };
            const result = await generateTopicSuggestions({
                flowApiName: this.topicSuggestionFlowApiName,
                accountId: this.recordId,
                contextJson: JSON.stringify(context)
            });
            this._topics = this._parseTopics(result);
        } catch (err) {
            this._topicsError = (err && err.body && err.body.message) ? err.body.message : (err?.message || 'Failed to load suggestions.');
            this._topics = [];
        } finally {
            this._topicsLoading = false;
        }
    }

    _parseTopics(raw) {
        if (!raw) return [];
        try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!Array.isArray(parsed)) return [];
            return parsed.map((t, i) => ({
                key: 'tp_' + i,
                title: t.title || t.Subject || t.topic || '(Untitled)',
                rationale: t.rationale || t.reason || t.Description || ''
            }));
        } catch (_) {
            return [];
        }
    }
}
