import { createElement } from 'lwc';
import AccountLookup from 'c/accountLookup';
import searchAccounts from '@salesforce/apex/AccountLookupController.searchAccounts';
import getHouseholdMembers from '@salesforce/apex/AccountLookupController.getHouseholdMembers';

jest.mock(
    '@salesforce/apex/AccountLookupController.searchAccounts',
    () => ({ default: jest.fn() }),
    { virtual: true }
);

jest.mock(
    '@salesforce/apex/AccountLookupController.getHouseholdMembers',
    () => ({ default: jest.fn() }),
    { virtual: true }
);

// These tests run on fake timers to drive the debounce, so this drains microtasks
// rather than using a timer.
const flush = () => Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => Promise.resolve())
    .then(() => Promise.resolve())
    .then(() => Promise.resolve());

const ROW = {
    accountId: '001000000000001AAA',
    name: 'Acme Holding',
    type: 'Customer',
    phone: '+47 22 00 00 00',
    website: 'https://acme.example.com',
    industry: 'Banking',
    billingCity: 'Oslo',
    billingCountry: 'Norway',
    recordType: 'Business',
    email: null,
    segment: 'Core',
    status: 'Active',
    aumBand: '10-100M',
    aum: null,
    householdId: null,
    householdName: null,
    householdMemberCount: null,
    lastActivityDate: null,
    ownerName: 'Kari Nordmann',
    hasFullAccess: false
};

const row = (overrides, n = 2) => ({
    ...ROW,
    accountId: `00100000000000${n}AAA`,
    ...overrides
});

function build() {
    const el = createElement('c-account-lookup', { is: AccountLookup });
    document.body.appendChild(el);
    return el;
}

const rows = el => [...el.shadowRoot.querySelectorAll('.al-result')];
const text = node => (node ? node.textContent.replace(/\s+/g, ' ').trim() : null);

/** Types into the search box the way the user does, then lets the debounce fire. */
async function type(el, value) {
    const input = el.shadowRoot.querySelector('lightning-input');
    input.value = value;
    input.dispatchEvent(new CustomEvent('change'));
    jest.runOnlyPendingTimers();
    await flush();
}

/** Sends a key to the search input, the way a keyboard user drives the list. */
async function press(el, key) {
    el.shadowRoot.querySelector('lightning-input').dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true })
    );
    await flush();
}

describe('c-account-lookup', () => {
    let el;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        window.localStorage.clear();
    });

    afterEach(() => {
        if (el && el.parentNode) {
            document.body.removeChild(el);
        }
        el = undefined;
        jest.useRealTimers();
    });

    // ── Search behaviour ─────────────────────────────────────────────────

    it('renders the search input and the limited-view helper text', () => {
        el = build();
        const input = el.shadowRoot.querySelector('lightning-input');
        expect(input).not.toBeNull();
        expect(input.label).toBe('Find any account');
        expect(text(el.shadowRoot.querySelector('.al-helper')))
            .toContain('Limited view of every account');
    });

    it('does not call Apex below the minimum length', async () => {
        el = build();
        await type(el, 'ac');
        expect(searchAccounts).not.toHaveBeenCalled();
    });

    it('searches once, after the debounce, with the trimmed term', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();

        const input = el.shadowRoot.querySelector('lightning-input');
        input.value = 'acm';
        input.dispatchEvent(new CustomEvent('change'));
        input.value = 'acme ';
        input.dispatchEvent(new CustomEvent('change'));
        expect(searchAccounts).not.toHaveBeenCalled(); // still inside the debounce window

        jest.runOnlyPendingTimers();
        await flush();

        expect(searchAccounts).toHaveBeenCalledTimes(1);
        expect(searchAccounts).toHaveBeenCalledWith({ searchTerm: 'acme', scope: 'all' });
    });

    it('renders a row per result with its secondary detail line', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        expect(rows(el)).toHaveLength(1);
        expect(text(el.shadowRoot.querySelector('.al-name'))).toBe('Acme Holding');
        expect(text(el.shadowRoot.querySelector('.al-subline')))
            .toBe('Business · Core · Customer');
        expect(text(el.shadowRoot.querySelector('.al-col-location'))).toBe('Oslo, Norway');
    });

    it('shows the empty state when nothing matches', async () => {
        searchAccounts.mockResolvedValue([]);
        el = build();
        await type(el, 'acme');

        expect(text(el.shadowRoot.querySelector('.al-empty'))).toContain('No accounts found');
        expect(rows(el)).toHaveLength(0);
    });

    it('shows the server message when the search fails', async () => {
        searchAccounts.mockRejectedValue({
            body: { message: 'You do not have access to Account Lookup.' }
        });
        el = build();
        await type(el, 'acme');

        expect(text(el.shadowRoot.querySelector('.al-error')))
            .toContain('You do not have access to Account Lookup.');
        expect(rows(el)).toHaveLength(0);
    });

    it('clears results when the term drops below the minimum', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');
        expect(rows(el)).toHaveLength(1);

        await type(el, 'ac');
        expect(rows(el)).toHaveLength(0);
        expect(el.shadowRoot.querySelector('.al-empty')).toBeNull();
    });

    it('ignores a stale response that lands after a newer one', async () => {
        let resolveFirst;
        const first = new Promise(resolve => { resolveFirst = resolve; });
        searchAccounts
            .mockReturnValueOnce(first)
            .mockResolvedValueOnce([row({ name: 'Second Result' })]);

        el = build();
        await type(el, 'acme');   // first request, still pending
        await type(el, 'acmes');  // second request, resolves immediately

        resolveFirst([row({ name: 'First Result' })]);
        await flush();

        expect(text(el.shadowRoot.querySelector('.al-name'))).toBe('Second Result');
    });

    it('shows a skeleton while loading, not an empty panel', async () => {
        searchAccounts.mockReturnValue(new Promise(() => {})); // never settles
        el = build();
        await type(el, 'acme');

        expect(el.shadowRoot.querySelectorAll('.al-skeleton-row').length).toBeGreaterThan(0);
    });

    // ── Scope: the main filter ───────────────────────────────────────────

    const scopeButton = (el2, label) => [...el2.shadowRoot.querySelectorAll('.al-scope')]
        .find(b => text(b) === label);

    it('offers the four scopes and starts on All customers', () => {
        el = build();
        const labels = [...el.shadowRoot.querySelectorAll('.al-scope')].map(text);
        expect(labels).toEqual([
            'All customers', 'My customers', "My team's customers", 'Mine & team'
        ]);
        expect(scopeButton(el, 'All customers').className).toContain('al-scope_active');
    });

    it('re-runs the search in the chosen scope', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        searchAccounts.mockClear();
        scopeButton(el, 'My customers').click();
        await flush();

        expect(searchAccounts).toHaveBeenCalledWith({ searchTerm: 'acme', scope: 'mine' });
        expect(scopeButton(el, 'My customers').className).toContain('al-scope_active');
    });

    it('sends the right key for each scope', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        const check = async (label, scope) => {
            searchAccounts.mockClear();
            scopeButton(el, label).click();
            await flush();
            expect(searchAccounts).toHaveBeenCalledWith({ searchTerm: 'acme', scope });
        };

        await check("My team's customers", 'team');
        await check('Mine & team', 'both');
        await check('All customers', 'all');
    });

    it('does not re-query when the active scope is clicked again', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        searchAccounts.mockClear();
        scopeButton(el, 'All customers').click();
        await flush();

        expect(searchAccounts).not.toHaveBeenCalled();
    });

    it('does not search on a scope change when the term is too short', async () => {
        el = build();
        await type(el, 'ac');

        scopeButton(el, 'My customers').click();
        await flush();

        expect(searchAccounts).not.toHaveBeenCalled();
    });

    it('says which scope is in force', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        expect(text(el.shadowRoot.querySelector('.al-helper')))
            .toContain('Limited view of every account');

        scopeButton(el, 'My customers').click();
        await flush();

        expect(text(el.shadowRoot.querySelector('.al-helper')))
            .toContain('Searching My customers only');
    });

    it('offers a way back to all customers when a scope finds nothing', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        searchAccounts.mockResolvedValue([]);
        scopeButton(el, 'My customers').click();
        await flush();

        expect(text(el.shadowRoot.querySelector('.al-empty')))
            .toContain('Nothing in My customers');

        searchAccounts.mockResolvedValue([ROW]);
        [...el.shadowRoot.querySelectorAll('.al-link')]
            .find(b => text(b) === 'Search all customers instead').click();
        await flush();

        expect(searchAccounts).toHaveBeenCalledWith({ searchTerm: 'acme', scope: 'all' });
        expect(rows(el)).toHaveLength(1);
    });

    it('drops a household pivot when the scope changes', async () => {
        searchAccounts.mockResolvedValue([{
            ...ROW,
            householdId: '001000000000009AAA',
            householdName: 'Nordmann Family'
        }]);
        getHouseholdMembers.mockResolvedValue([row({ name: 'Member One' }, 5)]);
        el = build();
        await type(el, 'acme');

        el.shadowRoot.querySelector('.al-household').click();
        await flush();
        expect(el.shadowRoot.querySelector('.al-breadcrumb')).not.toBeNull();

        scopeButton(el, 'My customers').click();
        await flush();

        expect(el.shadowRoot.querySelector('.al-breadcrumb')).toBeNull();
    });

    // ── Access ───────────────────────────────────────────────────────────

    it('marks a row the user cannot access as limited view', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        expect(text(el.shadowRoot.querySelector('.al-pill'))).toBe('Limited view');
        expect(el.shadowRoot.querySelector('.al-pill_full')).toBeNull();
    });

    it('marks a row the user owns as full access', async () => {
        searchAccounts.mockResolvedValue([row({ hasFullAccess: true })]);
        el = build();
        await type(el, 'acme');

        expect(text(el.shadowRoot.querySelector('.al-pill'))).toBe('Full access');
        expect(el.shadowRoot.querySelector('.al-pill_limited')).toBeNull();
    });

    it('reports the access split in the insight line', async () => {
        searchAccounts.mockResolvedValue([ROW, row({ hasFullAccess: true }, 3)]);
        el = build();
        await type(el, 'acme');

        expect(text(el.shadowRoot.querySelector('.al-summary-facts')))
            .toContain('2 results');
        expect(text(el.shadowRoot.querySelector('.al-summary-facts')))
            .toContain('1 you can open');
        expect(text(el.shadowRoot.querySelector('.al-summary-facts')))
            .toContain('1 limited view');
    });

    // ── AUM ──────────────────────────────────────────────────────────────

    it('shows a band, not a figure, for an account the user cannot open', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        const aum = el.shadowRoot.querySelector('.al-aum');
        expect(text(aum)).toBe('10-100M');
        expect(aum.className).toContain('al-aum_band');
        expect(aum.title).toContain('Approximate size band');
    });

    it('shows the exact figure for an account the user can open', async () => {
        searchAccounts.mockResolvedValue([
            row({ hasFullAccess: true, aum: 12300000, aumBand: '10-100M' })
        ]);
        el = build();
        await type(el, 'acme');

        const aum = el.shadowRoot.querySelector('.al-aum');
        expect(aum.className).not.toContain('al-aum_band');
        expect(text(aum)).not.toBe('10-100M'); // a formatted figure, not the band
        expect(aum.title).toBe('Assets under management');
    });

    it('omits the AUM chip when the account has no assets recorded', async () => {
        searchAccounts.mockResolvedValue([row({ aumBand: null, aum: null })]);
        el = build();
        await type(el, 'acme');

        expect(el.shadowRoot.querySelector('.al-aum')).toBeNull();
    });

    it('reports band counts and totals only what it may total', async () => {
        searchAccounts.mockResolvedValue([
            ROW,
            row({ aumBand: '100M+' }, 3),
            row({ hasFullAccess: true, aum: 5000000, aumBand: '1-10M' }, 4)
        ]);
        el = build();
        await type(el, 'acme');

        const aumPart = [...el.shadowRoot.querySelectorAll('.al-summary-part')]
            .find(p => text(p).includes('AUM'));
        // Only the exact row contributes to a total, and the tooltip says so.
        expect(aumPart.title).toContain('Across accounts you can open');
        expect(aumPart.title).toContain('1 × 100M+'); // largest band first
        expect(aumPart.title).toContain('1 × 10-100M');
    });

    it('reports bands without a total when no exact figure is available', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        const aumPart = [...el.shadowRoot.querySelectorAll('.al-summary-part')]
            .find(p => text(p).includes('10-100M'));
        expect(aumPart).toBeDefined();
        expect(aumPart.title).toBe('Size bands in these results');
    });

    it('shows no AUM chip when the figure is zero, even with full access', async () => {
        // The regression that prompted this round: this org stores 0 rather than null on
        // most accounts, and a bare "0" was rendered on every accessible row.
        searchAccounts.mockResolvedValue([
            row({ hasFullAccess: true, aum: 0, aumBand: null })
        ]);
        el = build();
        await type(el, 'acme');

        expect(el.shadowRoot.querySelector('.al-aum')).toBeNull();
        expect(text(el.shadowRoot.querySelector('.al-result'))).not.toContain('0');
    });

    // ── Status ───────────────────────────────────────────────────────────

    it('renders the status dot by state', async () => {
        searchAccounts.mockResolvedValue([ROW, row({ status: 'Inactive' }, 3)]);
        el = build();
        await type(el, 'acme');

        const dots = [...el.shadowRoot.querySelectorAll('.al-status')];
        expect(dots).toHaveLength(2);
        expect(dots.some(d => d.className.includes('al-status_active'))).toBe(true);
        expect(dots.some(d => d.className.includes('al-status_inactive'))).toBe(true);
    });

    it('omits the status dot when the account has no status', async () => {
        searchAccounts.mockResolvedValue([row({ status: null })]);
        el = build();
        await type(el, 'acme');

        expect(el.shadowRoot.querySelector('.al-status')).toBeNull();
    });

    // ── Highlighting ─────────────────────────────────────────────────────

    it('highlights the matched part of the name', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        expect(text(el.shadowRoot.querySelector('.al-mark'))).toBe('Acme');
        expect(text(el.shadowRoot.querySelector('.al-name'))).toBe('Acme Holding');
    });

    it('renders a name containing markup as text, never as markup', async () => {
        searchAccounts.mockResolvedValue([row({ name: 'Acme <img src=x> Ltd' })]);
        el = build();
        await type(el, 'acme');

        expect(el.shadowRoot.querySelector('.al-name img')).toBeNull();
        expect(text(el.shadowRoot.querySelector('.al-name'))).toBe('Acme <img src=x> Ltd');
    });

    // ── Keyboard ─────────────────────────────────────────────────────────

    it('moves through results with the arrow keys and wraps around', async () => {
        searchAccounts.mockResolvedValue([ROW, row({ name: 'Acme Two' }, 3)]);
        el = build();
        await type(el, 'acme');

        await press(el, 'ArrowDown');
        expect(rows(el)[0].className).toContain('al-result_active');

        await press(el, 'ArrowDown');
        expect(rows(el)[1].className).toContain('al-result_active');

        await press(el, 'ArrowDown'); // wraps back to the first
        expect(rows(el)[0].className).toContain('al-result_active');

        await press(el, 'ArrowUp');   // wraps back to the last
        expect(rows(el)[1].className).toContain('al-result_active');
    });

    it('opens the active row on Enter', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        await press(el, 'ArrowDown');
        await press(el, 'Enter');

        expect(el.shadowRoot.querySelector('c-account-lookup-detail')).not.toBeNull();
    });

    it('clears the search on Escape', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');
        expect(rows(el)).toHaveLength(1);

        await press(el, 'Escape');
        expect(rows(el)).toHaveLength(0);
    });

    // ── Filters ──────────────────────────────────────────────────────────

    const openFilters = async el2 => {
        el2.shadowRoot.querySelector('.al-filters-btn').click();
        await flush();
    };

    it('groups filter options under their field label', async () => {
        searchAccounts.mockResolvedValue([
            ROW,
            row({ name: 'Nordmann Family', recordType: 'Household' }, 3),
            row({ name: 'Kari Nordmann', recordType: 'Person Account' }, 4),
            row({ name: 'Another Business' }, 5)
        ]);
        el = build();
        await type(el, 'nord');
        await openFilters(el);

        const labels = [...el.shadowRoot.querySelectorAll('.al-filtergroup-label')].map(text);
        // This is what makes "Other (6)" and "Test (5)" comprehensible.
        expect(labels).toContain('Record type');
        const options = [...el.shadowRoot.querySelectorAll('.al-option')].map(text);
        expect(options).toContain('Household (1)');
    });

    it('filters on an option and shows a removable pill for it', async () => {
        searchAccounts.mockResolvedValue([
            ROW,
            row({ name: 'Nordmann Family', recordType: 'Household' }, 3),
            row({ name: 'Another Business' }, 4)
        ]);
        el = build();
        await type(el, 'nord');
        await openFilters(el);

        [...el.shadowRoot.querySelectorAll('.al-option')]
            .find(o => text(o).startsWith('Household')).click();
        await flush();

        expect(rows(el)).toHaveLength(1);
        expect(text(el.shadowRoot.querySelector('.al-name'))).toBe('Nordmann Family');
        expect(text(el.shadowRoot.querySelector('.al-activefilter')))
            .toContain('Record type: Household');
        expect(text(el.shadowRoot.querySelector('.al-filters-btn'))).toContain('Filters (1)');

        el.shadowRoot.querySelector('.al-activefilter').click();
        await flush();
        expect(rows(el)).toHaveLength(3);
    });

    it('combines filters across two different fields', async () => {
        searchAccounts.mockResolvedValue([
            row({ name: 'A', recordType: 'Business', billingCity: 'Oslo' }, 2),
            row({ name: 'B', recordType: 'Business', billingCity: 'Bergen' }, 3),
            row({ name: 'C', recordType: 'Household', billingCity: 'Oslo' }, 4),
            row({ name: 'D', recordType: 'Household', billingCity: 'Oslo' }, 5)
        ]);
        el = build();
        await type(el, 'acme');
        await openFilters(el);

        const click = prefix => [...el.shadowRoot.querySelectorAll('.al-option')]
            .find(o => text(o).startsWith(prefix)).click();

        click('Household');
        await flush();
        click('Oslo');
        await flush();

        expect([...el.shadowRoot.querySelectorAll('.al-name')].map(text)).toEqual(['C', 'D']);
        expect(el.shadowRoot.querySelectorAll('.al-activefilter')).toHaveLength(2);
    });

    it('offers a way out when filters hide everything', async () => {
        searchAccounts.mockResolvedValue([
            row({ name: 'A', recordType: 'Household', billingCity: 'Oslo' }, 2),
            row({ name: 'B', recordType: 'Household', billingCity: 'Oslo' }, 3),
            row({ name: 'C', recordType: 'Business', billingCity: 'Bergen' }, 4),
            row({ name: 'D', recordType: 'Business', billingCity: 'Bergen' }, 5)
        ]);
        el = build();
        await type(el, 'acme');
        await openFilters(el);

        const click = prefix => [...el.shadowRoot.querySelectorAll('.al-option')]
            .find(o => text(o).startsWith(prefix)).click();

        click('Household');   // A and B
        await flush();
        click('Bergen');      // ...but neither is in Bergen
        await flush();

        expect(rows(el)).toHaveLength(0);
        const empty = el.shadowRoot.querySelector('.al-empty');
        expect(text(empty)).toContain('No results match these filters');

        [...el.shadowRoot.querySelectorAll('.al-link')]
            .find(b => text(b) === 'Clear filters').click();
        await flush();
        expect(rows(el)).toHaveLength(4);
    });

    // ── Duplicates ───────────────────────────────────────────────────────

    it('flags accounts that look like the same company', async () => {
        searchAccounts.mockResolvedValue([
            row({ name: 'Acme Holding AS' }, 2),
            row({ name: 'acme-holding' }, 3),
            row({ name: 'Totally Different' }, 4)
        ]);
        el = build();
        await type(el, 'acme');

        expect(text(el.shadowRoot.querySelector('.al-dup-badge')))
            .toContain('2 possible duplicates');
        expect(el.shadowRoot.querySelectorAll('.al-dup-dot')).toHaveLength(2);
    });

    it('does not flag distinct accounts', async () => {
        searchAccounts.mockResolvedValue([ROW, row({ name: 'Beta Industries' }, 3)]);
        el = build();
        await type(el, 'a');
        await type(el, 'acme');

        expect(el.shadowRoot.querySelector('.al-dup-badge')).toBeNull();
    });

    // ── Recent searches ──────────────────────────────────────────────────

    it('remembers a search and re-runs it when the pill is clicked', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        await type(el, ''); // empty input reveals the recent list
        const pill = el.shadowRoot.querySelector('.al-chip');
        expect(text(pill)).toBe('acme');

        searchAccounts.mockClear();
        pill.click();
        await flush();

        expect(searchAccounts).toHaveBeenCalledWith({ searchTerm: 'acme', scope: 'all' });
    });

    it('clears remembered searches on request', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');
        await type(el, '');

        el.shadowRoot.querySelector('.al-link').click();
        await flush();

        expect(el.shadowRoot.querySelector('.al-chip')).toBeNull();
    });

    it('still renders when storage is unavailable', async () => {
        const storage = Object.getPrototypeOf(window.localStorage);
        const getItem = jest.spyOn(storage, 'getItem')
            .mockImplementation(() => { throw new Error('denied'); });
        const setItem = jest.spyOn(storage, 'setItem')
            .mockImplementation(() => { throw new Error('denied'); });

        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        expect(rows(el)).toHaveLength(1); // the search still works
        getItem.mockRestore();
        setItem.mockRestore();
    });

    // ── Household pivot ──────────────────────────────────────────────────

    const WITH_HOUSEHOLD = {
        ...ROW,
        householdId: '001000000000009AAA',
        householdName: 'Nordmann Family'
    };

    it('shows a household chip when the account has one', async () => {
        searchAccounts.mockResolvedValue([WITH_HOUSEHOLD]);
        el = build();
        await type(el, 'acme');

        expect(text(el.shadowRoot.querySelector('.al-household'))).toBe('Nordmann Family');
    });

    it('pivots into the household without opening the detail modal', async () => {
        searchAccounts.mockResolvedValue([WITH_HOUSEHOLD]);
        getHouseholdMembers.mockResolvedValue([
            row({ name: 'Member One' }, 5),
            row({ name: 'Member Two' }, 6)
        ]);
        el = build();
        await type(el, 'acme');

        el.shadowRoot.querySelector('.al-household').click();
        await flush();

        expect(getHouseholdMembers).toHaveBeenCalledWith({ householdId: '001000000000009AAA' });
        expect(rows(el)).toHaveLength(2);
        expect(text(el.shadowRoot.querySelector('.al-breadcrumb-name'))).toBe('Nordmann Family');
        // The chip is inside the row, which also opens the modal -- it must not do both.
        expect(el.shadowRoot.querySelector('c-account-lookup-detail')).toBeNull();
    });

    it('restores the previous results on back, with no new query', async () => {
        searchAccounts.mockResolvedValue([WITH_HOUSEHOLD]);
        getHouseholdMembers.mockResolvedValue([row({ name: 'Member One' }, 5)]);
        el = build();
        await type(el, 'acme');

        el.shadowRoot.querySelector('.al-household').click();
        await flush();
        expect(text(el.shadowRoot.querySelector('.al-name'))).toBe('Member One');

        searchAccounts.mockClear();
        el.shadowRoot.querySelector('.al-back').click();
        await flush();

        expect(text(el.shadowRoot.querySelector('.al-name'))).toBe('Acme Holding');
        expect(searchAccounts).not.toHaveBeenCalled();
    });

    it('leaves the household on Escape', async () => {
        searchAccounts.mockResolvedValue([WITH_HOUSEHOLD]);
        getHouseholdMembers.mockResolvedValue([row({ name: 'Member One' }, 5)]);
        el = build();
        await type(el, 'acme');

        el.shadowRoot.querySelector('.al-household').click();
        await flush();

        await press(el, 'Escape');
        expect(el.shadowRoot.querySelector('.al-breadcrumb')).toBeNull();
        expect(text(el.shadowRoot.querySelector('.al-name'))).toBe('Acme Holding');
    });

    it('shows the server message when the household cannot be loaded', async () => {
        searchAccounts.mockResolvedValue([WITH_HOUSEHOLD]);
        getHouseholdMembers.mockRejectedValue({
            body: { message: 'You do not have access to Account Lookup.' }
        });
        el = build();
        await type(el, 'acme');

        el.shadowRoot.querySelector('.al-household').click();
        await flush();

        expect(text(el.shadowRoot.querySelector('.al-error')))
            .toContain('You do not have access to Account Lookup.');
    });

    it('counts households in the insight line', async () => {
        searchAccounts.mockResolvedValue([WITH_HOUSEHOLD, row({ name: 'No Household' }, 7)]);
        el = build();
        await type(el, 'acme');

        expect(text(el.shadowRoot.querySelector('.al-summary-facts'))).toContain('1 household');
    });

    // ── Sort and density ─────────────────────────────────────────────────

    it('sorts by name by default and by AUM on request', async () => {
        searchAccounts.mockResolvedValue([
            row({ name: 'Alpha', aumBand: '< 1M' }, 2),
            row({ name: 'Beta', aumBand: '100M+' }, 3)
        ]);
        el = build();
        await type(el, 'a');
        await type(el, 'acme');

        expect([...el.shadowRoot.querySelectorAll('.al-name')].map(text))
            .toEqual(['Alpha', 'Beta']);

        const byAum = [...el.shadowRoot.querySelectorAll('.al-sort')]
            .find(b => text(b) === 'AUM');
        byAum.click();
        await flush();

        expect([...el.shadowRoot.querySelectorAll('.al-name')].map(text))
            .toEqual(['Beta', 'Alpha']);
    });

    it('sorts accounts without a household last', async () => {
        searchAccounts.mockResolvedValue([
            row({ name: 'No Household' }, 2),
            row({ name: 'In Household', householdId: '001000000000009AAA', householdName: 'Aaa Family' }, 3)
        ]);
        el = build();
        await type(el, 'acme');

        [...el.shadowRoot.querySelectorAll('.al-sort')]
            .find(b => text(b) === 'Household').click();
        await flush();

        expect([...el.shadowRoot.querySelectorAll('.al-name')].map(text))
            .toEqual(['In Household', 'No Household']);
    });

    it('toggles density and remembers it', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        expect(el.shadowRoot.querySelector('.al-root_compact')).toBeNull();

        [...el.shadowRoot.querySelectorAll('.al-link')]
            .find(b => text(b) === 'Compact').click();
        await flush();

        expect(el.shadowRoot.querySelector('.al-root_compact')).not.toBeNull();
        expect(window.localStorage.getItem('accountLookup.density')).toBe('"compact"');
    });

    // ── Row detail ───────────────────────────────────────────────────────

    it('shows the owner by name, not just initials', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        expect(text(el.shadowRoot.querySelector('.al-ownername'))).toBe('Kari Nordmann');
        expect(text(el.shadowRoot.querySelector('.al-avatar'))).toBe('KN');
    });

    it('shows last activity as an age, with the date in the tooltip', async () => {
        const threeMonthsAgo = new Date(Date.now() - 95 * 86400000)
            .toISOString().slice(0, 10);
        searchAccounts.mockResolvedValue([row({ lastActivityDate: threeMonthsAgo })]);
        el = build();
        await type(el, 'acme');

        const activity = el.shadowRoot.querySelector('.al-col-activity');
        expect(text(activity)).toBe('3mo ago');
        expect(activity.title).toContain(threeMonthsAgo);
    });

    it('says so when there is no activity at all', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        const activity = el.shadowRoot.querySelector('.al-col-activity');
        expect(text(activity)).toBe('—');
        expect(activity.title).toBe('No activity logged');
    });

    it('drops the repeated account name from the household chip', async () => {
        // Household names here mostly repeat the account name, which wasted the whole chip.
        searchAccounts.mockResolvedValue([row({
            name: 'Anna Jacobsson DEMO',
            householdId: '001000000000009AAA',
            householdName: 'Anna Jacobsson DEMO Household',
            householdMemberCount: 4
        })]);
        el = build();
        await type(el, 'anna');

        expect(text(el.shadowRoot.querySelector('.al-household'))).toBe('Household · 4 members');
    });

    it('keeps a household name that says something of its own', async () => {
        searchAccounts.mockResolvedValue([row({
            householdId: '001000000000009AAA',
            householdName: 'Nordmann Family',
            householdMemberCount: 2
        })]);
        el = build();
        await type(el, 'acme');

        expect(text(el.shadowRoot.querySelector('.al-household'))).toBe('Nordmann Family · 2 members');
    });

    it('omits the member count when it could not be worked out', async () => {
        searchAccounts.mockResolvedValue([row({
            householdId: '001000000000009AAA',
            householdName: 'Nordmann Family',
            householdMemberCount: null
        })]);
        el = build();
        await type(el, 'acme');

        expect(text(el.shadowRoot.querySelector('.al-household'))).toBe('Nordmann Family');
    });

    // ── Row actions ──────────────────────────────────────────────────────

    it('offers call and email links without opening the modal', async () => {
        searchAccounts.mockResolvedValue([row({ email: 'post@acme.example.com' })]);
        el = build();
        await type(el, 'acme');

        const links = [...el.shadowRoot.querySelectorAll('.al-action')].map(a => a.href);
        expect(links.some(h => h === 'tel:+4722000000')).toBe(true);
        expect(links.some(h => h === 'mailto:post@acme.example.com')).toBe(true);

        el.shadowRoot.querySelector('.al-action').click();
        await flush();
        expect(el.shadowRoot.querySelector('c-account-lookup-detail')).toBeNull();
    });

    it('offers an open-record button only where access is real', async () => {
        searchAccounts.mockResolvedValue([ROW, row({ hasFullAccess: true }, 3)]);
        el = build();
        await type(el, 'acme');

        // One button for the one accessible row -- the limited-view row gets no route
        // to the record page.
        expect(el.shadowRoot.querySelectorAll('.al-action_open')).toHaveLength(1);
    });

    it('does not open the modal when the open-record button is used', async () => {
        searchAccounts.mockResolvedValue([row({ hasFullAccess: true })]);
        el = build();
        await type(el, 'acme');

        el.shadowRoot.querySelector('.al-action_open').click();
        await flush();

        expect(el.shadowRoot.querySelector('c-account-lookup-detail')).toBeNull();
    });

    // ── Recently viewed ──────────────────────────────────────────────────

    it('remembers accounts opened through the tool', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');
        rows(el)[0].click();
        await flush();

        el.shadowRoot.querySelector('c-account-lookup-detail')
            .dispatchEvent(new CustomEvent('close'));
        await flush();
        await type(el, '');

        const chip = el.shadowRoot.querySelector('.al-chip_account');
        expect(text(chip)).toContain('Acme Holding');
    });

    it('reopens a remembered account without searching again', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');
        rows(el)[0].click();
        await flush();
        el.shadowRoot.querySelector('c-account-lookup-detail')
            .dispatchEvent(new CustomEvent('close'));
        await flush();
        await type(el, '');

        searchAccounts.mockClear();
        el.shadowRoot.querySelector('.al-chip_account').click();
        await flush();

        expect(el.shadowRoot.querySelector('c-account-lookup-detail')).not.toBeNull();
        expect(searchAccounts).not.toHaveBeenCalled();
    });

    // ── Layout ───────────────────────────────────────────────────────────

    it('stays stacked when the component cannot be measured', async () => {
        // jsdom has no ResizeObserver, which is also the real fallback path.
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        expect(el.shadowRoot.querySelector('.al-root_wide')).toBeNull();
        expect(el.shadowRoot.querySelector('.al-colhead')).toBeNull();
    });

    it('switches to columns when the component itself is wide', async () => {
        // Measured from the component, not the window: a 480px utility panel on a wide
        // monitor must stay stacked.
        let observerCallback;
        window.ResizeObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        observerCallback([{ contentRect: { width: 900 } }]);
        await flush();
        expect(el.shadowRoot.querySelector('.al-root_wide')).not.toBeNull();
        expect(el.shadowRoot.querySelector('.al-colhead')).not.toBeNull();

        observerCallback([{ contentRect: { width: 480 } }]);
        await flush();
        expect(el.shadowRoot.querySelector('.al-root_wide')).toBeNull();

        delete window.ResizeObserver;
    });

    // ── Empty state ──────────────────────────────────────────────────────

    it('suggests what to try when nothing matches', async () => {
        searchAccounts.mockResolvedValue([]);
        el = build();
        await type(el, 'acme');

        const hints = [...el.shadowRoot.querySelectorAll('.al-hints li')].map(text);
        expect(hints.length).toBeGreaterThan(0);
        expect(hints.join(' ')).toContain('shorter');
    });

    // ── Detail modal ─────────────────────────────────────────────────────

    it('opens the detail modal when a row is clicked', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        rows(el)[0].click();
        await flush();

        expect(el.shadowRoot.querySelector('c-account-lookup-detail')).not.toBeNull();
    });

    it('closes the detail modal on its close event', async () => {
        searchAccounts.mockResolvedValue([ROW]);
        el = build();
        await type(el, 'acme');

        rows(el)[0].click();
        await flush();

        el.shadowRoot.querySelector('c-account-lookup-detail')
            .dispatchEvent(new CustomEvent('close'));
        await flush();

        expect(el.shadowRoot.querySelector('c-account-lookup-detail')).toBeNull();
    });
});
