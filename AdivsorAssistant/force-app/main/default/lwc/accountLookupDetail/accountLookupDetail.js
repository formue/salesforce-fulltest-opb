import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getAccountDetails from '@salesforce/apex/AccountLookupController.getAccountDetails';

/**
 * The whitelisted fields, in display order. `kind` drives how the value is rendered:
 * a phone becomes a tel: link, an email a mailto:, a website an external link.
 */
const FIELDS = [
    { key: 'recordType', label: 'Record Type', source: 'recordType',     kind: 'text' },
    { key: 'type',       label: 'Type',        source: 'type',           kind: 'text' },
    { key: 'status',     label: 'Status',      source: 'status',         kind: 'text' },
    { key: 'segment',    label: 'Segment',     source: 'segment',        kind: 'text' },
    { key: 'aum',        label: 'AUM',         source: '__aum',          kind: 'text' },
    { key: 'household',  label: 'Household',   source: '__household',    kind: 'text' },
    { key: 'activity',   label: 'Last Activity', source: '__activity',   kind: 'text' },
    { key: 'phone',      label: 'Phone',       source: 'phone',          kind: 'phone' },
    { key: 'email',      label: 'Email',       source: 'email',          kind: 'email' },
    { key: 'website',    label: 'Website',     source: 'website',        kind: 'url' },
    { key: 'industry',   label: 'Industry',    source: 'industry',       kind: 'text' },
    { key: 'city',       label: 'City',        source: 'billingCity',    kind: 'text' },
    { key: 'country',    label: 'Country',     source: 'billingCountry', kind: 'text' },
    { key: 'owner',      label: 'Owner',       source: 'ownerName',      kind: 'text' }
];

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

export default class AccountLookupDetail extends LightningElement {

    // ── Public API ───────────────────────────────────────────────────────────

    @api accountId;

    // ── State ────────────────────────────────────────────────────────────────

    @track _account = null;
    @track _isLoading = true;
    @track _errorMessage = '';

    _hasFocused = false;

    // ── Lifecycle ────────────────────────────────────────────────────────────

    async connectedCallback() {
        await this._fetchDetails();
    }

    renderedCallback() {
        // Move focus into the dialog once, so the modal is usable from the keyboard
        // and screen readers announce it on open.
        if (!this._hasFocused) {
            const closeButton = this.template.querySelector('.ald-close');
            if (closeButton) {
                closeButton.focus();
                this._hasFocused = true;
            }
        }
    }

    // ── Getters ──────────────────────────────────────────────────────────────

    get account()      { return this._account; }
    get isLoading()    { return this._isLoading; }
    get errorMessage() { return this._errorMessage; }
    get hasAccount()   { return this._account !== null; }

    get hasFullAccess() {
        return !!(this._account && this._account.hasFullAccess);
    }

    get isLimitedView() {
        return this.hasAccount && !this.hasFullAccess;
    }

    get title() {
        return this._account ? this._account.name : 'Account';
    }

    /**
     * The exact figure when the user can already read the record, otherwise the band the
     * server sent. The client never has the exact value for a limited-view account, so
     * there is nothing here to leak.
     */
    get aumValue() {
        const a = this._account;
        if (!a) {
            return null;
        }
        if (a.hasFullAccess && a.aum !== null && a.aum !== undefined) {
            return formatAum(a.aum);
        }
        return a.aumBand ? `${a.aumBand} (approximate)` : null;
    }

    /** Household name with its member count, when the count could be worked out. */
    get householdValue() {
        const a = this._account;
        if (!a || !a.householdName) {
            return null;
        }
        if (a.householdMemberCount > 0) {
            const members = a.householdMemberCount === 1
                ? '1 member'
                : `${a.householdMemberCount} members`;
            return `${a.householdName} · ${members}`;
        }
        return a.householdName;
    }

    /** The date plus how long ago it was, which is the part people actually read. */
    get activityValue() {
        const a = this._account;
        if (!a || !a.lastActivityDate) {
            return null;
        }
        const then = new Date(a.lastActivityDate);
        if (isNaN(then.getTime())) {
            return a.lastActivityDate;
        }
        const days = Math.floor((Date.now() - then.getTime()) / 86400000);
        if (days <= 0) return `${a.lastActivityDate} (today)`;
        if (days < 31) return `${a.lastActivityDate} (${days} days ago)`;
        if (days < 365) return `${a.lastActivityDate} (${Math.floor(days / 30)} months ago)`;
        return `${a.lastActivityDate} (${Math.floor(days / 365)} years ago)`;
    }

    /** Only whitelisted fields, and only those the account actually has a value for. */
    get fields() {
        if (!this._account) {
            return [];
        }
        const source = {
            ...this._account,
            __aum: this.aumValue,
            __household: this.householdValue,
            __activity: this.activityValue
        };
        return FIELDS
            .filter(field => !!source[field.source])
            .map(field => {
                const value = source[field.source];
                return {
                    ...field,
                    value,
                    href: this._hrefFor(field.kind, value),
                    isLink: field.kind !== 'text',
                    isExternal: field.kind === 'url'
                };
            });
    }

    /**
     * "4 of 8 details available" -- a quiet signal that a record is thin, which is often
     * why someone is looking it up in the first place. Derived from what came back;
     * nothing extra is requested to produce it.
     */
    get completenessLabel() {
        return `${this.fields.length} of ${FIELDS.length} details available`;
    }

    get completenessStyle() {
        const pct = Math.round((this.fields.length / FIELDS.length) * 100);
        return `width: ${pct}%`;
    }

    // ── Handlers ─────────────────────────────────────────────────────────────

    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            this.handleClose();
        }
    }

    handleOpenRecord() {
        // Belt and braces: the button is only rendered when access is real, and the
        // event is only dispatched when it still is.
        if (!this.hasFullAccess) {
            return;
        }
        this.dispatchEvent(new CustomEvent('openrecord', {
            detail: { accountId: this._account.accountId }
        }));
    }

    async handleCopy(event) {
        const value = event.currentTarget.dataset.value;
        try {
            await navigator.clipboard.writeText(value);
            this._showToast('Copied', value, 'success');
        } catch {
            // Clipboard access is denied in some contexts; say so rather than fail silently.
            this._showToast('Could not copy', 'Select the text and copy it manually.', 'warning');
        }
    }

    // ── Private ──────────────────────────────────────────────────────────────

    _hrefFor(kind, value) {
        if (kind === 'phone') return `tel:${value.replace(/\s/g, '')}`;
        if (kind === 'email') return `mailto:${value}`;
        if (kind === 'url') {
            return /^https?:\/\//i.test(value) ? value : `https://${value}`;
        }
        return null;
    }

    async _fetchDetails() {
        this._isLoading = true;
        this._errorMessage = '';
        try {
            this._account = await getAccountDetails({ accountId: this.accountId });
        } catch (e) {
            this._account = null;
            this._errorMessage = this._extractError(e);
        } finally {
            this._isLoading = false;
        }
    }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    _extractError(err) {
        if (!err) return 'Unknown error';
        if (err.body && err.body.message) return err.body.message;
        if (err.message) return err.message;
        return JSON.stringify(err);
    }
}
