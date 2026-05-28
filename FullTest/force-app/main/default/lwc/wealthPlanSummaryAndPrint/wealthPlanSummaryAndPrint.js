import { LightningElement, api } from 'lwc';
import { FlowNavigationNextEvent, FlowNavigationFinishEvent } from 'lightning/flowSupport';

export default class WealthPlanSummaryAndPrint extends LightningElement {
    @api recordId = '';
    @api householdId = '';
    @api backgroundColor = '#f0f9ff';

    @api inputGoals;
    @api inputMilestones;
    @api inputGreetings;
    @api inputIncomes;
    @api inputAssets;
    @api inputOwnerships;
    @api inputSustainability;
    @api inputCapitalNeeds;
    @api inputCapitalNeedsSummary;
    @api inputInvestmentStrategies;

    // Legacy inputs — kept to prevent Flow crashes
    @api householdMembers;
    @api householdBusinessMembers;
    @api householdPrimaryMember;
    @api householdSelectedMember;

    // ── Safe array helpers ──────────────────────────────────────
    getSafeArray(proxyObj) {
        if (!proxyObj) return [];
        try {
            const clean = JSON.parse(JSON.stringify(proxyObj));
            if (Array.isArray(clean)) return clean;
            if (typeof clean === 'object' && Object.keys(clean).length > 0) return [clean];
            return [];
        } catch (e) { return []; }
    }

    get safeGoals()        { return this.getSafeArray(this.inputGoals); }
    get safeIncomes()      { return this.getSafeArray(this.inputIncomes); }
    get safeAssets()       { return this.getSafeArray(this.inputAssets); }
    get safeMilestones()   { return this.getSafeArray(this.inputMilestones); }
    get safeSustainability() { return this.getSafeArray(this.inputSustainability); }
    get safeOwnerships()          { return this.getSafeArray(this.inputOwnerships); }
    get safeGreetings()           { return this.getSafeArray(this.inputGreetings); }
    get safeCapitalNeeds()        { return this.getSafeArray(this.inputCapitalNeeds); }
    get safeInvestmentStrategies() { return this.getSafeArray(this.inputInvestmentStrategies); }
    get hasRiskLockIn() {
        const s = this.inputCapitalNeedsSummary;
        return s && (s.Risk__c || s.LockIn__c);
    }

    // ── Readiness ring ──────────────────────────────────────────
    get activeModuleCount() {
        let count = [
            this.safeGoals, this.safeIncomes, this.safeAssets,
            this.safeMilestones, this.safeSustainability,
            this.safeOwnerships, this.safeGreetings,
            this.safeCapitalNeeds, this.safeInvestmentStrategies
        ].filter(a => a.length > 0).length;
        if (this.hasRiskLockIn) count++;
        return count;
    }

    get totalModules()       { return 10; }
    get planReadinessScore() { return Math.round((this.activeModuleCount / this.totalModules) * 100); }
    get readinessDashArray() { return `${this.planReadinessScore}, 100`; }

    get readinessRingColor() {
        const s = this.planReadinessScore;
        if (s === 100) return '#10b981';
        if (s >= 50)  return '#0ea5e9';
        return '#f59e0b';
    }

    // ── Hero extras ─────────────────────────────────────────────
    get isPlanComplete() { return this.planReadinessScore === 100; }

    get readinessMessage() {
        const s = this.planReadinessScore;
        if (s === 100) return 'Your wealth plan is complete and ready for the client.';
        if (s >= 86)  return 'Almost there — just one module still needs attention.';
        if (s >= 57)  return 'Good progress. Keep populating the remaining modules.';
        return 'Build the foundation by populating each data module.';
    }

    get moduleProgressStyle() {
        return `width: ${this.planReadinessScore}%; background: ${this.readinessRingColor};`;
    }

    get totalRecords() {
        return this.safeGoals.length + this.safeIncomes.length + this.safeAssets.length +
               this.safeMilestones.length + this.safeSustainability.length +
               this.safeOwnerships.length + this.safeGreetings.length +
               this.safeCapitalNeeds.length + this.safeInvestmentStrategies.length;
    }

    // ── Checklist modules ───────────────────────────────────────
    get checklistModules() {
        return [
            this.buildModule('Financial Goals',     'Long-term objectives and targets.',   this.safeGoals.length,          '0.1s'),
            this.buildModule('Assets & Liabilities','Real estate, cash, and debt.',        this.safeAssets.length,         '0.2s'),
            this.buildModule('Income Streams',      'Salaries, dividends, and pensions.',  this.safeIncomes.length,        '0.3s'),
            this.buildModule('Historical Milestones','Key life and business events.',      this.safeMilestones.length,     '0.4s'),
            this.buildModule('Company Ownership',   'Equity stakes and structures.',       this.safeOwnerships.length,     '0.5s'),
            this.buildModule('Sustainability Prefs','ESG engagement and impact.',          this.safeSustainability.length, '0.6s'),
            this.buildModule('Personal Greeting',   'Custom app introduction.',            this.safeGreetings.length,      '0.7s'),
            this.buildModule('Capital Needs',       'Future events and capital requirements.', this.safeCapitalNeeds.length,  '0.8s'),
            this.buildModule('Risk % Lock-In',      'Risk tolerance and lock-in values.',  this.hasRiskLockIn ? 1 : 0,        '0.9s'),
            this.buildModule('Investment Strategy',  'Active strategies and allocations.', this.safeInvestmentStrategies.length, '1.0s'),
        ];
    }

    buildModule(title, desc, count, delay) {
        const hasData  = count > 0;
        const fillPct  = Math.min(Math.round((count / 5) * 100), 100);
        const fillColor = hasData ? '#10b981' : '#fcd34d';
        return {
            title, desc,
            hasData,
            countText:      hasData ? `${count} Records` : 'Missing Data',
            tooltipCount:   hasData ? `${count} record${count !== 1 ? 's' : ''} logged` : 'No records yet',
            tooltipFill:    `${fillPct}% toward target (5+ records)`,
            tooltipHint:    hasData ? 'Looking good — keep it updated.' : 'Add data to complete this module.',
            animationDelay: `animation-delay: ${delay};`,
            cardClass:      hasData ? 'check-card is-complete fade-in-up' : 'check-card is-empty fade-in-up',
            iconColor:      hasData ? 'color: #10b981;' : 'color: #94a3b8;',
            badgeClass:     hasData ? 'check-badge badge-good' : 'check-badge badge-warn',
            fillStyle:      `width: ${fillPct}%; background-color: ${fillColor};`,
        };
    }

    // ── Missing modules callout ─────────────────────────────────
    get missingModules()     { return this.checklistModules.filter(m => !m.hasData).map(m => m.title); }
    get hasMissingModules()  { return this.missingModules.length > 0; }
    get missingCount()       { return this.missingModules.length; }
    get missingLabel()       { return this.missingCount === 1 ? 'module' : 'modules'; }
    get missingModulesList() { return this.missingModules.join(' · '); }

    // ── Print / Flow navigation ─────────────────────────────────
    handlePrint() {
        try   { this.dispatchEvent(new FlowNavigationNextEvent());   }
        catch { this.dispatchEvent(new FlowNavigationFinishEvent()); }
    }

    // ── Style ───────────────────────────────────────────────────
    get dynamicBgStyle() { return `--component-bg-color: ${this.backgroundColor};`; }
}