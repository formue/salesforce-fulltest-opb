import { LightningElement, api, track } from 'lwc';

export default class WealthPlanHub extends LightningElement {

    // ─── SHARED INPUTS ────────────────────────────────────────────
    @api recordId            = '';  // auto-bound on Record Pages
    @api hubRecordId         = '';  // explicit override from Flow/config
    @api hubInputIsPublished = false;
    @api hubHouseholdMembers = [];
    @api hubBusinessAccounts = [];
    @api hubPrimaryMemberId  = '';

    // ─── SECTION FLOW API NAMES ───────────────────────────────────
    @api hubGoalsFlowApiName           = '';
    @api hubIncomeFlowApiName          = '';
    @api hubAssetsFlowApiName          = '';
    @api hubMilestonesFlowApiName      = '';
    @api hubOwnershipFlowApiName       = '';
    @api hubGreetingsFlowApiName       = '';
    @api hubSustainabilityFlowApiName  = '';
    @api hubInvestmentPrefsFlowApiName = '';

    // ─── INTERNAL STATE ───────────────────────────────────────────
    @track activeTab    = 'Goals';
    @track activeSubTab = '';
    @track renderKey    = 0;

    // ─── FLOW INPUT VARIABLES ─────────────────────────────────────
    get flowInputVars() {
        return [{ name: 'recordId', type: 'String', value: this.hubRecordId || this.recordId }];
    }

    // ─── FLOW STATUS HANDLER ──────────────────────────────────────
    handleFlowStatusChange(event) {
        const s = event.detail.status;
        if (s === 'FINISHED' || s === 'FINISHED_SCREEN') {
            this.renderKey++;
        }
    }

    // ─── TAB NAVIGATION ───────────────────────────────────────────
    handleTabChange(event) {
        const selectedTab = event.currentTarget.dataset.tab;
        if (this.activeTab === selectedTab) return;
        this.executeTabChange(selectedTab, this.getDefaultSubTab(selectedTab));
    }

    handleSubTabChange(event) {
        const selectedSubTab = event.currentTarget.dataset.subtab;
        if (this.activeSubTab === selectedSubTab) return;
        this.executeTabChange(this.activeTab, selectedSubTab);
    }

    executeTabChange(tabName, subTabName) {
        this.activeTab    = tabName;
        this.activeSubTab = subTabName;
        this.renderKey++;
    }

    getDefaultSubTab(tab) {
        if (tab === 'Wealth')     return 'Income';
        if (tab === 'Family')     return 'Company';
        if (tab === 'Investment') return 'Sustainability';
        return '';
    }

    // ─── SECTION VISIBILITY ───────────────────────────────────────
    get isGoalsTab()                 { return this.activeTab === 'Goals'; }
    get isWealthIncome()             { return this.activeTab === 'Wealth'     && this.activeSubTab === 'Income'; }
    get isWealthAssets()             { return this.activeTab === 'Wealth'     && this.activeSubTab === 'Assets'; }
    get isWealthCapital()            { return this.activeTab === 'Wealth'     && this.activeSubTab === 'Capital'; }
    get isFamilyRelationship()       { return this.activeTab === 'Family'     && this.activeSubTab === 'Relationship'; }
    get isFamilyMilestones()         { return this.activeTab === 'Family'     && this.activeSubTab === 'Milestones'; }
    get isFamilyCompany()            { return this.activeTab === 'Family'     && this.activeSubTab === 'Company'; }
    get isFamilyGreetings()          { return this.activeTab === 'Family'     && this.activeSubTab === 'Greetings'; }
    get isInvestmentSustainability() { return this.activeTab === 'Investment' && this.activeSubTab === 'Sustainability'; }
    get isInvestmentPrefs()          { return this.activeTab === 'Investment' && this.activeSubTab === 'InvestmentPrefs'; }

    // ─── SUB-TAB VISIBILITY ───────────────────────────────────────
    get hasSubTabs()      { return this.activeTab === 'Wealth' || this.activeTab === 'Family' || this.activeTab === 'Investment'; }
    get isWealthTab()     { return this.activeTab === 'Wealth'; }
    get isFamilyTab()     { return this.activeTab === 'Family'; }
    get isInvestmentTab() { return this.activeTab === 'Investment'; }

    // ─── TAB CLASS GETTERS ────────────────────────────────────────
    get getTabClassGoals()      { return this.activeTab === 'Goals'      ? 'pill-tab active' : 'pill-tab'; }
    get getTabClassWealth()     { return this.activeTab === 'Wealth'     ? 'pill-tab active' : 'pill-tab'; }
    get getTabClassFamily()     { return this.activeTab === 'Family'     ? 'pill-tab active' : 'pill-tab'; }
    get getTabClassInvestment() { return this.activeTab === 'Investment' ? 'pill-tab active' : 'pill-tab'; }

    get getSubTabClassIncome()          { return this.activeSubTab === 'Income'          ? 'pill-tab sub-pill active' : 'pill-tab sub-pill'; }
    get getSubTabClassAssets()          { return this.activeSubTab === 'Assets'          ? 'pill-tab sub-pill active' : 'pill-tab sub-pill'; }
    get getSubTabClassCapital()         { return this.activeSubTab === 'Capital'         ? 'pill-tab sub-pill active' : 'pill-tab sub-pill'; }
    get getSubTabClassRelationship()    { return this.activeSubTab === 'Relationship'    ? 'pill-tab sub-pill active' : 'pill-tab sub-pill'; }
    get getSubTabClassMilestones()      { return this.activeSubTab === 'Milestones'      ? 'pill-tab sub-pill active' : 'pill-tab sub-pill'; }
    get getSubTabClassCompany()         { return this.activeSubTab === 'Company'         ? 'pill-tab sub-pill active' : 'pill-tab sub-pill'; }
    get getSubTabClassGreetings()       { return this.activeSubTab === 'Greetings'       ? 'pill-tab sub-pill active' : 'pill-tab sub-pill'; }
    get getSubTabClassSustainability()  { return this.activeSubTab === 'Sustainability'  ? 'pill-tab sub-pill active' : 'pill-tab sub-pill'; }
    get getSubTabClassInvestmentPrefs() { return this.activeSubTab === 'InvestmentPrefs' ? 'pill-tab sub-pill active' : 'pill-tab sub-pill'; }
}
