import { LightningElement, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import searchAccounts from '@salesforce/apex/AccountLookupController.searchAccounts';
import getHouseholdMembers from '@salesforce/apex/AccountLookupController.getHouseholdMembers';

const MIN_SEARCH_LENGTH = 3; // Also enforced server-side; this only avoids pointless calls.
const DEBOUNCE_MS = 400;
const RECENT_KEY = 'accountLookup.recentSearches';
const VIEWED_KEY = 'accountLookup.recentAccounts';
const DENSITY_KEY = 'accountLookup.density';
const MAX_RECENT = 5;

/** The component switches to columns when it is this wide, whatever the window is doing. */
const WIDE_BREAKPOINT = 720;

/** Largest first. Used to sort by AUM when only the band is known. */
const BAND_RANK = { '100M+': 4, '10-100M': 3, '1-10M': 2, '< 1M': 1 };

/** Company-form suffixes that say nothing about whether two accounts are the same. */
const COMPANY_SUFFIXES = /\b(as|asa|ab|a\/s|aps|ltd|limited|inc|llc|gmbh|bv|nv|plc|sa|oy)\b/g;

const SORTS = [
    { value: 'name', label: 'Name' },
    { value: 'aum', label: 'AUM' },
    { value: 'household', label: 'Household' }
];

/**
 * The main filter: which accounts to search at all. "All customers" is the sharing
 * bypass this tool exists for; the other three are limited server-side to records the
 * user already has access to.
 */
const SCOPES = [
    {
        value: 'all',
        label: 'All customers',
        title: 'Every account in Salesforce, shown as a limited view'
    },
    {
        value: 'mine',
        label: 'My customers',
        title: 'Accounts you own'
    },
    {
        value: 'team',
        label: "My team's customers",
        title: 'Accounts you are on the account team for'
    },
    {
        value: 'both',
        label: 'Mine & team',
        title: 'Accounts you own or are on the account team for'
    }
];

/** Which fields offer filters, and what to call them in the panel. */
const FILTER_FIELDS = [
    { field: 'recordType', label: 'Record type' },
    { field: 'type', label: 'Type' },
    { field: 'segment', label: 'Segment' },
    { field: 'status', label: 'Status' },
    { field: 'billingCity', label: 'City' }
];

/**
 * Strips case, punctuation and company-form suffixes so "Acme Holding AS" and
 * "acme-holding" compare equal. Only ever used to flag a possible duplicate for a
 * human to judge -- never to merge or hide anything.
 */
function normalizeName(name) {
    return (name || '')
        .toLowerCase()
        .replace(/[.,''`"()\-/\\&]/g, ' ')
        .replace(COMPANY_SUFFIXES, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Compact currency for the figures that are exact, e.g. 12 300 000 -> "12,3 mill.". */
function formatAum(value) {
    try {
        return new Intl.NumberFormat('nb-NO', {
            notation: 'compact',
            maximumFractionDigits: 1
        }).format(value);
    } catch {
        return String(value);
    }
}

/** Short relative age for the activity column. The full date goes in the tooltip. */
function relativeAge(isoDate) {
    if (!isoDate) {
        return null;
    }
    const then = new Date(isoDate);
    if (isNaN(then.getTime())) {
        return null;
    }
    const days = Math.floor((Date.now() - then.getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days < 7) return `${days}d ago`;
    if (days < 31) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
}

export default class AccountLookup extends NavigationMixin(LightningElement) {

    // ── State ────────────────────────────────────────────────────────────────

    @track _searchTerm = '';
    @track _results = [];
    @track _isLoading = false;
    @track _errorMessage = '';
    @track _hasSearched = false;
    @track _selectedAccountId = null;
    @track _activeIndex = -1;
    @track _recentSearches = [];
    @track _recentAccounts = [];
    @track _scope = 'all';
    @track _sortBy = 'name';
    @track _density = 'comfortable';
    @track _isWide = false;
    @track _filtersOpen = false;

    /** One value per field, several fields at once: { recordType: 'Household', ... }. */
    @track _filters = {};

    /** Set while viewing one household's members. The search results stay untouched
     *  underneath, so going back costs no query. */
    @track _pivot = null;
    @track _pivotResults = [];

    _debounceTimerId = null;
    /** Only the newest request may update the UI; a debounced search can overtake itself. */
    _requestId = 0;
    _boundShortcut = null;
    _resizeObserver = null;

    // ── Lifecycle ────────────────────────────────────────────────────────────

    connectedCallback() {
        this._recentSearches = this._readStored(RECENT_KEY, []);
        this._recentAccounts = this._readStored(VIEWED_KEY, []);
        const density = this._readStored(DENSITY_KEY, null);
        if (density === 'compact' || density === 'comfortable') {
            this._density = density;
        }
        this._boundShortcut = this._handleShortcut.bind(this);
        window.addEventListener('keydown', this._boundShortcut);
    }

    renderedCallback() {
        this._observeWidth();

        // Keep the keyboard-selected row visible without stealing focus from the input.
        if (this._activeIndex >= 0) {
            const active = this.template.querySelector('.al-result_active');
            // Guarded: not every environment the component renders in implements it.
            if (active && typeof active.scrollIntoView === 'function') {
                active.scrollIntoView({ block: 'nearest' });
            }
        }
    }

    disconnectedCallback() {
        clearTimeout(this._debounceTimerId);
        window.removeEventListener('keydown', this._boundShortcut);
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
    }

    /**
     * The layout breakpoint has to come from the component's own width, not the window's.
     * The utility bar panel is 480px wide on a 2560px monitor, so a CSS media query would
     * put it into column layout and break it.
     */
    _observeWidth() {
        if (this._resizeObserver || typeof ResizeObserver === 'undefined') {
            return; // No ResizeObserver: stay with the stacked layout.
        }
        const root = this.template.querySelector('.al-root');
        if (!root) {
            return;
        }
        this._resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                const width = entry.contentRect ? entry.contentRect.width : 0;
                const wide = width >= WIDE_BREAKPOINT;
                if (wide !== this._isWide) {
                    this._isWide = wide;
                }
            }
        });
        this._resizeObserver.observe(root);
    }

    // ── Getters ──────────────────────────────────────────────────────────────

    get searchTerm()        { return this._searchTerm; }
    get isLoading()         { return this._isLoading; }
    get errorMessage()      { return this._errorMessage; }
    get selectedAccountId() { return this._selectedAccountId; }
    get isDetailOpen()      { return this._selectedAccountId !== null; }
    get recentSearches()    { return this._recentSearches; }
    get recentAccounts()    { return this._recentAccounts; }
    get isPivoted()         { return this._pivot !== null; }
    get pivotName()         { return this._pivot ? this._pivot.name : ''; }
    get isWide()            { return this._isWide; }
    get scope()             { return this._scope; }
    get filtersOpen()       { return this._filtersOpen; }
    get activeDescendant()  { return this._activeIndex >= 0 ? `al-opt-${this._activeIndex}` : null; }

    /** Search results, or one household's members while pivoted. */
    get activeRows() {
        return this._pivot ? this._pivotResults : this._results;
    }

    get rootClass() {
        const parts = ['al-root'];
        if (this._density === 'compact') parts.push('al-root_compact');
        if (this._isWide) parts.push('al-root_wide');
        return parts.join(' ');
    }

    get isCompact() {
        return this._density === 'compact';
    }

    get densityLabel() {
        return this._density === 'compact' ? 'Comfortable' : 'Compact';
    }

    get scopeOptions() {
        return SCOPES.map(option => ({
            ...option,
            cssClass: option.value === this._scope ? 'al-scope al-scope_active' : 'al-scope'
        }));
    }

    get scopeLabel() {
        const current = SCOPES.find(option => option.value === this._scope);
        return current ? current.label : SCOPES[0].label;
    }

    get isNarrowedScope() {
        return this._scope !== 'all';
    }

    get sortOptions() {
        return SORTS.map(option => ({
            ...option,
            cssClass: option.value === this._sortBy ? 'al-sort al-sort_active' : 'al-sort'
        }));
    }

    get showRecent() {
        return !this._searchTerm && !this.isPivoted && !this._isLoading
            && (this._recentSearches.length > 0 || this._recentAccounts.length > 0);
    }

    get hasRecentSearches() { return this._recentSearches.length > 0; }
    get hasRecentAccounts() { return this._recentAccounts.length > 0; }

    get hasResults() {
        return this.visibleResults.length > 0;
    }

    get showEmptyState() {
        return this._hasSearched && !this._isLoading && !this._errorMessage
            && this.activeRows.length === 0;
    }

    /** Shown when filters hide every row -- a different problem from "nothing matched". */
    get showFilteredOutState() {
        return this.activeRows.length > 0 && this.visibleResults.length === 0;
    }

    get emptyStateHints() {
        return [
            { key: 'shorter', text: 'Try a shorter term — the search matches the start of a name' },
            { key: 'spelling', text: 'Check the spelling, including Norwegian characters' },
            { key: 'company', text: 'Searching the company rather than the person often finds more' }
        ];
    }

    /** The rows after the filters and sort, decorated for rendering. */
    get visibleResults() {
        let rows = this.activeRows;
        for (const [field, value] of Object.entries(this._filters)) {
            rows = rows.filter(row => row[field] === value);
        }
        rows = [...rows].sort(this._comparator());

        return rows.map((row, index) => this._decorate(row, index));
    }

    /** "22 results · 22 you can open · 12 households · 28,5 mill. AUM" — one strip. */
    get summaryParts() {
        const rows = this.activeRows;
        const total = rows.length;
        if (total === 0) {
            return [];
        }
        const open = rows.filter(r => r.hasFullAccess).length;
        const households = new Set(rows.map(r => r.householdId).filter(Boolean)).size;

        const parts = [{ key: 'total', text: total === 1 ? '1 result' : `${total} results`, title: '' }];
        if (open > 0) {
            parts.push({ key: 'open', text: `${open} you can open`, title: '' });
        }
        if (total - open > 0) {
            parts.push({ key: 'limited', text: `${total - open} limited view`, title: '' });
        }
        if (households > 0) {
            parts.push({
                key: 'households',
                text: households === 1 ? '1 household' : `${households} households`,
                title: ''
            });
        }
        const aum = this._aumSummary();
        if (aum) {
            parts.push(aum);
        }
        return parts;
    }

    get hasSummary() {
        return this.summaryParts.length > 0;
    }

    get duplicateCount() {
        return this.activeRows.filter(row => row.isPossibleDuplicate).length;
    }

    get hasDuplicates() {
        return this.duplicateCount > 0;
    }

    get duplicateLabel() {
        return this.duplicateCount === 1
            ? '1 possible duplicate'
            : `${this.duplicateCount} possible duplicates`;
    }

    /**
     * Filter options grouped by field, counted over the unfiltered rows so choosing one
     * filter does not make the others vanish. Filtering is client-side over rows already
     * returned, so it costs no query and never reaches past the server's cap.
     */
    get filterGroups() {
        const rows = this.activeRows;
        return FILTER_FIELDS.map(({ field, label }) => {
            const counts = new Map();
            for (const row of rows) {
                const value = row[field];
                if (value) {
                    counts.set(value, (counts.get(value) || 0) + 1);
                }
            }
            const options = [...counts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([value, count]) => ({
                    key: `${field}|${value}`,
                    field,
                    value,
                    label: `${value} (${count})`,
                    cssClass: this._filters[field] === value
                        ? 'al-option al-option_active'
                        : 'al-option'
                }));
            return { key: field, label, options, hasOptions: options.length > 1 };
        }).filter(group => group.hasOptions);
    }

    get hasFilterGroups() {
        return this.filterGroups.length > 0;
    }

    get activeFilterPills() {
        return Object.entries(this._filters).map(([field, value]) => {
            const meta = FILTER_FIELDS.find(f => f.field === field);
            return {
                key: field,
                field,
                label: `${meta ? meta.label : field}: ${value}`
            };
        });
    }

    get hasActiveFilters() {
        return this.activeFilterPills.length > 0;
    }

    get filtersButtonLabel() {
        const count = this.activeFilterPills.length;
        return count > 0 ? `Filters (${count})` : 'Filters';
    }

    get filtersButtonClass() {
        return this.hasActiveFilters ? 'al-filters-btn al-filters-btn_active' : 'al-filters-btn';
    }

    /** Announced to screen readers; the same information is shown visually below. */
    get statusMessage() {
        if (this._isLoading) return 'Searching...';
        if (this._errorMessage) return this._errorMessage;
        if (!this._hasSearched) return '';
        if (this.activeRows.length === 0) return 'No accounts found.';
        return this.summaryParts.map(p => p.text).join(' · ');
    }

    // ── Handlers ─────────────────────────────────────────────────────────────

    handleSearchChange(event) {
        this._searchTerm = event.target.value || '';
        clearTimeout(this._debounceTimerId);
        this._activeIndex = -1;
        this._leavePivot();

        if (this._searchTerm.trim().length < MIN_SEARCH_LENGTH) {
            // Clear stale rows so a shortened term never leaves old results on screen.
            this._results = [];
            this._hasSearched = false;
            this._errorMessage = '';
            this._clearFilters();
            return;
        }

        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._debounceTimerId = setTimeout(() => this._runSearch(), DEBOUNCE_MS);
    }

    handleSearchKeyDown(event) {
        const rows = this.visibleResults;

        if (event.key === 'ArrowDown' && rows.length) {
            event.preventDefault();
            this._activeIndex = (this._activeIndex + 1) % rows.length;
        } else if (event.key === 'ArrowUp' && rows.length) {
            event.preventDefault();
            this._activeIndex = this._activeIndex <= 0
                ? rows.length - 1
                : this._activeIndex - 1;
        } else if (event.key === 'Enter') {
            event.preventDefault();
            clearTimeout(this._debounceTimerId);
            if (this._activeIndex >= 0 && rows[this._activeIndex]) {
                this._openDetail(rows[this._activeIndex]);
            } else if (this._searchTerm.trim().length >= MIN_SEARCH_LENGTH) {
                this._runSearch();
            }
        } else if (event.key === 'Escape') {
            if (this.isPivoted) {
                this.handleLeaveHousehold();
            } else {
                this._clearSearch();
            }
        }
    }

    handleResultClick(event) {
        const row = this.visibleResults.find(r => r.accountId === event.currentTarget.dataset.id);
        this._openDetail(row);
    }

    handleOpenRecord(event) {
        event.stopPropagation();
        const row = this.visibleResults.find(r => r.accountId === event.currentTarget.dataset.id);
        // Guarded here as well as in the markup: a row the user cannot read must never
        // produce navigation to the record page.
        if (row && row.hasFullAccess) {
            this._navigateToAccount(row.accountId);
        }
    }

    /** The contact links sit inside the row, which opens the detail modal. */
    handleActionClick(event) {
        event.stopPropagation();
    }

    async handleHouseholdClick(event) {
        event.stopPropagation();
        const { id, name } = event.currentTarget.dataset;

        this._isLoading = true;
        this._errorMessage = '';
        try {
            const members = await getHouseholdMembers({ householdId: id });
            this._pivotResults = this._markDuplicates(members || []);
            this._pivot = { id, name };
            this._clearFilters();
            this._activeIndex = -1;
        } catch (e) {
            this._errorMessage = this._extractError(e);
        } finally {
            this._isLoading = false;
        }
    }

    handleLeaveHousehold() {
        this._leavePivot();
        this._clearFilters();
        this._activeIndex = -1;
    }

    handleScopeClick(event) {
        const next = event.currentTarget.dataset.value;
        if (next === this._scope) {
            return;
        }
        this._scope = next;
        this._leavePivot();
        this._clearFilters();
        this._activeIndex = -1;
        if (this._searchTerm.trim().length >= MIN_SEARCH_LENGTH) {
            this._runSearch();
        } else {
            this._results = [];
            this._hasSearched = false;
        }
    }

    /** Offered by the empty state when a narrowed scope found nothing. */
    handleWidenScope() {
        this._scope = 'all';
        this._clearFilters();
        if (this._searchTerm.trim().length >= MIN_SEARCH_LENGTH) {
            this._runSearch();
        }
    }

    handleSortClick(event) {
        this._sortBy = event.currentTarget.dataset.value;
        this._activeIndex = -1;
    }

    handleDensityToggle() {
        this._density = this._density === 'compact' ? 'comfortable' : 'compact';
        this._writeStored(DENSITY_KEY, this._density);
    }

    handleFiltersToggle() {
        this._filtersOpen = !this._filtersOpen;
    }

    handleOptionClick(event) {
        const { field, value } = event.currentTarget.dataset;
        const next = { ...this._filters };
        if (next[field] === value) {
            delete next[field]; // Clicking the active option clears that field.
        } else {
            next[field] = value;
        }
        this._filters = next;
        this._activeIndex = -1;
    }

    handleRemoveFilter(event) {
        const next = { ...this._filters };
        delete next[event.currentTarget.dataset.field];
        this._filters = next;
        this._activeIndex = -1;
    }

    handleClearFilters() {
        this._clearFilters();
        this._activeIndex = -1;
    }

    handleRecentClick(event) {
        this._searchTerm = event.currentTarget.dataset.term;
        this._runSearch();
    }

    handleRecentAccountClick(event) {
        this._selectedAccountId = event.currentTarget.dataset.id;
    }

    handleClearRecent() {
        this._recentSearches = [];
        this._recentAccounts = [];
        this._writeStored(RECENT_KEY, []);
        this._writeStored(VIEWED_KEY, []);
    }

    handleDetailClose() {
        this._selectedAccountId = null;
        const input = this.template.querySelector('lightning-input');
        if (input) {
            input.focus();
        }
    }

    handleDetailOpenRecord(event) {
        this._navigateToAccount(event.detail.accountId);
    }

    // ── Private ──────────────────────────────────────────────────────────────

    _handleShortcut(event) {
        // Only fires while the host page or utility panel already has focus -- an LWC
        // cannot claim a shortcut across the whole Lightning shell.
        if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
            event.preventDefault();
            const input = this.template.querySelector('lightning-input');
            if (input) {
                input.focus();
            }
        }
    }

    /** Everything the template needs for one row, computed once per render. */
    _decorate(row, index) {
        const isExact = row.hasFullAccess && row.aum !== null
            && row.aum !== undefined && row.aum > 0;
        const activity = relativeAge(row.lastActivityDate);

        return {
            ...row,
            optionId: `al-opt-${index}`,
            isActive: index === this._activeIndex,
            rowClass: index === this._activeIndex
                ? 'al-result al-result_active'
                : 'al-result',
            segments: this._highlight(row.name),
            location: [row.billingCity, row.billingCountry].filter(Boolean).join(', '),
            stackedDetail: [row.recordType, row.segment, row.type].filter(Boolean).join(' · '),
            initials: this._initials(row.ownerName),
            hasStatus: !!row.status,
            statusClass: row.status === 'Active'
                ? 'al-status al-status_active'
                : 'al-status al-status_inactive',
            hasActivity: !!activity,
            activityLabel: activity || '—',
            activityTitle: row.lastActivityDate
                ? `Last activity ${row.lastActivityDate}`
                : 'No activity logged',
            hasAum: isExact || !!row.aumBand,
            aumLabel: isExact ? formatAum(row.aum) : row.aumBand,
            aumClass: isExact ? 'al-aum' : 'al-aum al-aum_band',
            aumTitle: isExact
                ? 'Assets under management'
                : 'Approximate size band. The exact figure is only shown for accounts you can open.',
            hasHousehold: !!row.householdName,
            householdLabel: this._householdLabel(row),
            hasPhone: !!row.phone,
            phoneHref: row.phone ? `tel:${row.phone.replace(/\s/g, '')}` : null,
            hasEmail: !!row.email,
            emailHref: row.email ? `mailto:${row.email}` : null,
            accessLabel: row.hasFullAccess ? 'Full access' : 'Limited view',
            accessClass: row.hasFullAccess
                ? 'al-pill al-pill_full'
                : 'al-pill al-pill_limited'
        };
    }

    /**
     * Household names here mostly repeat the account name ("Anna Jacobsson DEMO" ->
     * "Anna Jacobsson DEMO Household"), which wastes the whole chip. Drop the repeated
     * part and show the member count, which is the bit that actually tells you something.
     */
    _householdLabel(row) {
        if (!row.householdName) {
            return null;
        }
        const name = (row.name || '').trim();
        let label = row.householdName;
        if (name && label.toLowerCase().startsWith(name.toLowerCase())) {
            label = label.slice(name.length).trim() || 'Household';
        }
        if (row.householdMemberCount > 0) {
            const members = row.householdMemberCount === 1 ? '1 member' : `${row.householdMemberCount} members`;
            return `${label} · ${members}`;
        }
        return label;
    }

    /** Band counts for the tooltip, plus a total over only the figures we actually have. */
    _aumSummary() {
        const rows = this.activeRows;
        const counts = new Map();
        for (const row of rows) {
            if (row.aumBand) {
                counts.set(row.aumBand, (counts.get(row.aumBand) || 0) + 1);
            }
        }
        if (counts.size === 0) {
            return null;
        }
        const breakdown = [...counts.entries()]
            .sort((a, b) => (BAND_RANK[b[0]] || 0) - (BAND_RANK[a[0]] || 0))
            .map(([band, count]) => `${count} × ${band}`)
            .join(' · ');

        // A total is only ever summed over rows whose exact figure we have. Summing band
        // midpoints for the rest would invent a number.
        const exact = rows.filter(r => r.hasFullAccess && r.aum > 0);
        const total = exact.reduce((sum, r) => sum + r.aum, 0);

        if (total > 0) {
            return {
                key: 'aum',
                text: `${formatAum(total)} AUM`,
                title: `Across accounts you can open. Size bands in these results: ${breakdown}`
            };
        }
        // Nothing exact to total, so report the bands themselves rather than a fake number.
        return { key: 'aum', text: breakdown, title: 'Size bands in these results' };
    }

    _comparator() {
        if (this._sortBy === 'aum') {
            return (a, b) => {
                const rank = (BAND_RANK[b.aumBand] || 0) - (BAND_RANK[a.aumBand] || 0);
                if (rank !== 0) return rank;
                return (b.aum || 0) - (a.aum || 0);
            };
        }
        if (this._sortBy === 'household') {
            return (a, b) => {
                // Accounts with no household sort last rather than clumping at the top.
                if (!a.householdName && !b.householdName) return 0;
                if (!a.householdName) return 1;
                if (!b.householdName) return -1;
                return a.householdName.localeCompare(b.householdName);
            };
        }
        return (a, b) => (a.name || '').localeCompare(b.name || '');
    }

    _leavePivot() {
        this._pivot = null;
        this._pivotResults = [];
    }

    _clearFilters() {
        this._filters = {};
    }

    _clearSearch() {
        clearTimeout(this._debounceTimerId);
        this._searchTerm = '';
        this._results = [];
        this._hasSearched = false;
        this._errorMessage = '';
        this._activeIndex = -1;
        this._leavePivot();
        this._clearFilters();
    }

    _openDetail(row) {
        if (!row) {
            return;
        }
        this._selectedAccountId = row.accountId;
        this._rememberAccount(row);
    }

    async _runSearch() {
        const term = this._searchTerm.trim();
        const requestId = ++this._requestId;

        this._isLoading = true;
        this._errorMessage = '';
        this._leavePivot();
        this._clearFilters();
        try {
            const rows = await searchAccounts({ searchTerm: term, scope: this._scope });
            if (requestId !== this._requestId) {
                return; // A newer search has already been issued; this answer is stale.
            }
            this._results = this._markDuplicates(rows || []);
            this._hasSearched = true;
            this._activeIndex = -1;
            this._rememberSearch(term);
        } catch (e) {
            if (requestId !== this._requestId) {
                return;
            }
            this._results = [];
            this._hasSearched = true;
            this._errorMessage = this._extractError(e);
        } finally {
            if (requestId === this._requestId) {
                this._isLoading = false;
            }
        }
    }

    /**
     * Flags rows that look like the same company. Advisory only -- nothing is hidden
     * or merged.
     */
    _markDuplicates(rows) {
        const seen = new Map();
        for (const row of rows) {
            const key = normalizeName(row.name);
            seen.set(key, (seen.get(key) || 0) + 1);
        }
        return rows.map(row => ({
            ...row,
            isPossibleDuplicate: (seen.get(normalizeName(row.name)) || 0) > 1
        }));
    }

    /**
     * Splits a name into before/match/after segments for highlighting. Rendered through
     * for:each rather than innerHTML, so an account name can never inject markup.
     */
    _highlight(name) {
        const safeName = name || '';
        const term = this._searchTerm.trim();
        if (!term || this.isPivoted) {
            return [{ key: 'whole', text: safeName, isMatch: false }];
        }
        const start = safeName.toLowerCase().indexOf(term.toLowerCase());
        if (start === -1) {
            return [{ key: 'whole', text: safeName, isMatch: false }];
        }
        const end = start + term.length;
        return [
            { key: 'before', text: safeName.slice(0, start), isMatch: false },
            { key: 'match', text: safeName.slice(start, end), isMatch: true },
            { key: 'after', text: safeName.slice(end), isMatch: false }
        ].filter(segment => segment.text.length > 0);
    }

    _initials(ownerName) {
        if (!ownerName) return '?';
        return ownerName
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(part => part[0].toUpperCase())
            .join('');
    }

    _rememberSearch(term) {
        const next = [term, ...this._recentSearches.filter(t => t !== term)].slice(0, MAX_RECENT);
        this._recentSearches = next;
        this._writeStored(RECENT_KEY, next);
    }

    _rememberAccount(row) {
        const entry = { id: row.accountId, name: row.name };
        const next = [entry, ...this._recentAccounts.filter(a => a.id !== entry.id)]
            .slice(0, MAX_RECENT);
        this._recentAccounts = next;
        this._writeStored(VIEWED_KEY, next);
    }

    _readStored(key, fallback) {
        // Storage throws outright in some contexts; the component must render without it.
        try {
            const raw = window.localStorage.getItem(key);
            if (raw === null) return fallback;
            const parsed = JSON.parse(raw);
            return Array.isArray(fallback)
                ? (Array.isArray(parsed) ? parsed : fallback)
                : parsed;
        } catch {
            return fallback;
        }
    }

    _writeStored(key, value) {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        } catch {
            // A browser that refuses storage just means nothing is remembered.
        }
    }

    _navigateToAccount(accountId) {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: accountId, objectApiName: 'Account', actionName: 'view' }
        });
    }

    _extractError(err) {
        if (!err) return 'Unknown error';
        if (err.body && err.body.message) return err.body.message;
        if (err.message) return err.message;
        return JSON.stringify(err);
    }
}
