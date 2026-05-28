import { LightningElement, api, track } from 'lwc';

export default class WealthPlanRelationships extends LightningElement {
    @api backgroundColor = '#f0f9ff';

    _inputHouseholdMembers = [];
    _inputBusinessAccounts = [];
    _inputPrimaryMemberId = '';

    @api
    get inputHouseholdMembers() { return this._inputHouseholdMembers; }
    set inputHouseholdMembers(value) {
        this._inputHouseholdMembers = value ? (Array.isArray(value) ? value : [value]) : [];
        this.processAccounts();
    }

    @api
    get inputBusinessAccounts() { return this._inputBusinessAccounts; }
    set inputBusinessAccounts(value) {
        this._inputBusinessAccounts = value ? (Array.isArray(value) ? value : [value]) : [];
        this.processAccounts();
    }

    @api
    get inputPrimaryMemberId() { return this._inputPrimaryMemberId; }
    set inputPrimaryMemberId(value) {
        this._inputPrimaryMemberId = value || '';
        this.processAccounts();
    }

    // Legacy ghost variables — prevent Flow crashes
    _enableNetworkMap = null;
    @api get enableNetworkMap() { return this._enableNetworkMap !== null ? this._enableNetworkMap : true; }
    set enableNetworkMap(value) { this._enableNetworkMap = value; }

    _enableTreeView = null;
    @api get enableTreeView() { return this._enableTreeView !== null ? this._enableTreeView : true; }
    set enableTreeView(value) { this._enableTreeView = value; }

    @api enableSpotlight = false;
    @api enableDnaAvatars = false;

    @track persons = [];
    @track businesses = [];
    @track isExpanded = false;

    get dynamicStyle()   { return `background-color: ${this.backgroundColor};`; }
    get dynamicBgStyle() { return `background-color: ${this.backgroundColor};`; }
    get hasPersons()    { return this.persons.length > 0; }
    get hasBusinesses() { return this.businesses.length > 0; }
    get totalEntities() { return this.persons.length + this.businesses.length; }
    get chevronIcon()   { return this.isExpanded ? 'utility:chevronup' : 'utility:chevrondown'; }

    connectedCallback() { this.processAccounts(); }

    handleToggleExpand() { this.isExpanded = !this.isExpanded; }


    processAccounts() {
        this.persons = (this._inputHouseholdMembers || []).map(acc => {
            const isPrimary  = String(acc.Id).substring(0, 15) === String(this._inputPrimaryMemberId).substring(0, 15);
            const nameStr    = acc.Name || 'Unknown Member';
            const role       = acc.Role__c || (isPrimary ? 'Primary Client' : 'Household Member');
            const occupation = acc.FinServ__Occupation__pc || '';
            const employer   = acc.FinServ__CurrentEmployer__pc || '';
            const age        = acc.FinServ__Age__c ? `${acc.FinServ__Age__c} yrs` : '';
            return {
                Id: acc.Id,
                Name: nameStr,
                Initials: this.getInitials(nameStr),
                Role: role,
                Occupation: occupation,
                Employer: employer,
                Age: age,
                hasOccupation: !!occupation,
                hasEmployer: !!employer,
                hasAge: !!age,
                subline: [role, occupation].filter(Boolean).join(' · '),
                isPrimary,
                badgeClass: isPrimary ? 'roster-badge badge-primary' : 'roster-badge badge-secondary'
            };
        });

        this.businesses = (this._inputBusinessAccounts || []).map(biz => {
            const nameStr  = biz.Name || 'Unknown Entity';
            const bizType  = biz.Type || (biz.RecordType && biz.RecordType.Name) || 'Holding Company';
            const industry = biz.Industry || '';
            const orgNum   = biz.AccountNumber || biz.FinServ__TaxId__c || '';
            return {
                Id: biz.Id,
                Name: nameStr,
                Initials: this.getInitials(nameStr),
                Type: bizType,
                Industry: industry,
                OrgNumber: orgNum,
                hasIndustry: !!industry,
                hasOrgNumber: !!orgNum,
                subline: [bizType, industry].filter(Boolean).join(' · ')
            };
        });
    }

    getInitials(name) {
        if (!name) return '??';
        const parts = name.trim().split(' ');
        return parts.length >= 2
            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
            : name.substring(0, 2).toUpperCase();
    }
}