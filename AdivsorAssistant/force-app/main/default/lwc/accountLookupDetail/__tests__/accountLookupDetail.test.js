import { createElement } from 'lwc';
import AccountLookupDetail from 'c/accountLookupDetail';
import getAccountDetails from '@salesforce/apex/AccountLookupController.getAccountDetails';

jest.mock(
    '@salesforce/apex/AccountLookupController.getAccountDetails',
    () => ({ default: jest.fn() }),
    { virtual: true }
);

// eslint-disable-next-line @lwc/lwc/no-async-operation
const flush = () => new Promise(r => setTimeout(r, 0));

const ACCOUNT = {
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

async function build(account) {
    getAccountDetails.mockResolvedValue(account);
    const el = createElement('c-account-lookup-detail', { is: AccountLookupDetail });
    el.accountId = '001000000000001AAA';
    document.body.appendChild(el);
    await flush();
    return el;
}

describe('c-account-lookup-detail', () => {
    let el;

    beforeEach(() => jest.clearAllMocks());

    afterEach(() => {
        if (el && el.parentNode) {
            document.body.removeChild(el);
        }
        el = undefined;
    });

    it('requests the account it was given', async () => {
        el = await build(ACCOUNT);
        expect(getAccountDetails).toHaveBeenCalledWith({ accountId: '001000000000001AAA' });
    });

    it('renders only the fields that have a value', async () => {
        el = await build(ACCOUNT);
        const labels = [...el.shadowRoot.querySelectorAll('.ald-label')].map(n => n.textContent);
        expect(labels).toEqual([
            'Record Type', 'Type', 'Status', 'Segment', 'AUM',
            'Phone', 'Website', 'Industry', 'City', 'Country', 'Owner'
        ]);
        expect(labels).not.toContain('Email');     // null on this account
        expect(labels).not.toContain('Household'); // no household on this account
    });

    it('reports how complete the record is', async () => {
        el = await build(ACCOUNT);
        expect(el.shadowRoot.querySelector('.ald-completeness-label').textContent)
            .toBe('11 of 14 details available');
    });

    it('reports a thinner record as less complete', async () => {
        el = await build({
            accountId: '001000000000001AAA',
            name: 'Sparse Account',
            type: null, phone: null, email: null, website: null, industry: null,
            billingCity: null, billingCountry: null, recordType: null,
            segment: null, status: null, aumBand: null, aum: null,
            householdId: null, householdName: null, householdMemberCount: null,
            lastActivityDate: null,
            ownerName: 'Kari Nordmann', hasFullAccess: false
        });
        expect(el.shadowRoot.querySelector('.ald-completeness-label').textContent)
            .toBe('1 of 14 details available');
    });

    it('makes phone, email and website actionable', async () => {
        el = await build({ ...ACCOUNT, email: 'post@acme.example.com' });
        const hrefs = [...el.shadowRoot.querySelectorAll('.ald-value a')].map(a => a.href);
        expect(hrefs).toContain('tel:+4722000000');
        expect(hrefs).toContain('mailto:post@acme.example.com');
        expect(hrefs).toContain('https://acme.example.com/');
    });

    it('opens an external website in a new tab, safely', async () => {
        el = await build(ACCOUNT);
        const link = [...el.shadowRoot.querySelectorAll('.ald-value a')]
            .find(a => a.href.startsWith('https://acme'));
        expect(link.target).toBe('_blank');
        expect(link.rel).toBe('noopener noreferrer');
    });

    it('copies a value to the clipboard', async () => {
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

        el = await build(ACCOUNT);
        // Copy the phone rather than whichever field happens to be first.
        const phoneField = [...el.shadowRoot.querySelectorAll('.ald-field')]
            .find(f => f.querySelector('.ald-label').textContent === 'Phone');
        phoneField.querySelector('.ald-copy').click();
        await flush();

        expect(writeText).toHaveBeenCalledWith('+47 22 00 00 00');
    });

    it('tells the user when the clipboard is unavailable', async () => {
        const writeText = jest.fn().mockRejectedValue(new Error('denied'));
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

        el = await build(ACCOUNT);
        const toast = jest.fn();
        el.addEventListener('lightning__showtoast', toast);

        el.shadowRoot.querySelector('.ald-copy').click();
        await flush();

        expect(toast).toHaveBeenCalled();
        expect(toast.mock.calls[0][0].detail.variant).toBe('warning');
    });

    it('shows AUM as an approximate band without access', async () => {
        el = await build(ACCOUNT);
        const values = [...el.shadowRoot.querySelectorAll('.ald-value')].map(n => n.textContent);
        expect(values.some(v => v.includes('10-100M (approximate)'))).toBe(true);
    });

    it('shows the exact AUM figure with access', async () => {
        el = await build({ ...ACCOUNT, hasFullAccess: true, aum: 12300000 });
        const values = [...el.shadowRoot.querySelectorAll('.ald-value')].map(n => n.textContent);
        expect(values.some(v => v.includes('approximate'))).toBe(false);
    });

    it('shows the household with its member count', async () => {
        el = await build({
            ...ACCOUNT,
            householdName: 'Nordmann Family',
            householdMemberCount: 4
        });
        const values = [...el.shadowRoot.querySelectorAll('.ald-value')].map(n => n.textContent);
        expect(values.some(v => v.includes('Nordmann Family · 4 members'))).toBe(true);
    });

    it('shows last activity with how long ago it was', async () => {
        const when = new Date(Date.now() - 95 * 86400000).toISOString().slice(0, 10);
        el = await build({ ...ACCOUNT, lastActivityDate: when });
        const values = [...el.shadowRoot.querySelectorAll('.ald-value')].map(n => n.textContent);
        expect(values.some(v => v.includes(when) && v.includes('months ago'))).toBe(true);
    });

    it('shows the limited-view notice and no open button without access', async () => {
        el = await build(ACCOUNT);
        expect(el.shadowRoot.querySelector('.ald-notice').textContent)
            .toContain('You have a limited view of this account.');
        expect(el.shadowRoot.querySelector('.ald-open')).toBeNull();
    });

    it('shows the open button and no notice with access', async () => {
        el = await build({ ...ACCOUNT, hasFullAccess: true });
        expect(el.shadowRoot.querySelector('.ald-notice')).toBeNull();
        expect(el.shadowRoot.querySelector('.ald-open')).not.toBeNull();
    });

    it('emits openrecord with the account id when the user may open it', async () => {
        el = await build({ ...ACCOUNT, hasFullAccess: true });
        const handler = jest.fn();
        el.addEventListener('openrecord', handler);

        el.shadowRoot.querySelector('.ald-open').click();

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].detail).toEqual({ accountId: '001000000000001AAA' });
    });

    it('emits close on Escape', async () => {
        el = await build(ACCOUNT);
        const handler = jest.fn();
        el.addEventListener('close', handler);

        el.shadowRoot.querySelector('section')
            .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('shows the server message when the load fails', async () => {
        getAccountDetails.mockRejectedValue({ body: { message: 'Account not found.' } });
        el = createElement('c-account-lookup-detail', { is: AccountLookupDetail });
        el.accountId = '001000000000001AAA';
        document.body.appendChild(el);
        await flush();

        expect(el.shadowRoot.querySelector('.ald-error').textContent).toContain('Account not found.');
        expect(el.shadowRoot.querySelector('.ald-fields')).toBeNull();
    });
});
