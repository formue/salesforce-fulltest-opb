/**
 * @description Agentforce AML Intelligence Orchestrator.
 * Manages UI state, Multi-pass Pro Mode execution, and dependent AI prompts for AML Compliance.
 */
import { LightningElement, api, track } from 'lwc';
import generateAMLSection from '@salesforce/apex/AMLPromptOrchestrator.generateAMLSection';
import { createRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import CASE_OBJECT from '@salesforce/schema/Case';
import SUBJECT_FIELD from '@salesforce/schema/Case.Subject';
import DESCRIPTION_FIELD from '@salesforce/schema/Case.Description';
import ACCOUNT_ID_FIELD from '@salesforce/schema/Case.AccountId';

export default class AmlIntelligenceTabs extends LightningElement {
    // ==========================================
    // PUBLIC API PROPERTIES (From Flow Builder)
    // ==========================================
    @api accountRecord;
    @api promptCoreSnapshot;
    @api promptRecentActivity;
    @api promptFinancialProfile;
    @api promptTransactions;
    @api promptRiskSummary;

    @api flowApiNameConsensusJudge;
    @api flowApiNameCreateCase;
    @api flowApiNameSaveProfile;
    @api flowApiNameChatQA;

    // Legacy JSON inputs (kept for backward compatibility with existing Flows)
    @api inputAnalyzerRecord;
    @api inputAnalyzerRecords;
    // New record variable inputs (preferred)
    @api analyzerRecord;            // Single AML_Analyzer__c record
    @api analyzerRecordCollection;  // AML_Analyzer__c[] record collection

    // Field API name mapping (matches AML_Analyzer__c field names)
    @api fieldCoreSnapshot       = 'Core_Snapshot__c';
    @api fieldRecentActivity     = 'Recent_Activities__c';
    @api fieldFinancialProfile   = 'Financial_Profile__c';
    @api fieldTransactions       = 'Transactions__c';
    @api fieldRiskSummary        = 'Summary__c';
    @api fieldRiskScore          = 'Risk_Score__c';
    @api fieldNotesCoreSnapshot  = 'Core_Snapshot_Notes__c';
    @api fieldNotesRecentActivity = 'Recent_Activities_Notes__c';
    @api fieldNotesFinancialProfile = 'Financial_Profile_Notes__c';
    @api fieldNotesTransactions  = 'Transaction_Notes__c';
    @api fieldNotesRiskSummary   = 'Summary_Notes__c';
    @api fieldPinnedItems        = 'Pinned_Items__c';
    @api fieldFlaggedItems       = 'Flagged_Items__c';

    // ==========================================
    // STATE MANAGEMENT TRACKING VARIABLES
    // ==========================================

    // Tab Management
    @track tabs = [];
    @track activeTabValue = '';

    // Batch Execution (Run All) State
    isQueueRunning = false;
    @track showOverallProgress = false;
    @track overallProgress = 0;
    @track batchExecutionMode = 'parallel'; // Determines if 'Run All' runs tabs at the same time or sequentially

    // Modal Visibility & Data States
    @track isCaseModalOpen = false;
    @track isCaseLoading = false;
    @track caseSubject = '';
    @track caseDescription = '';

    @track isSaveModalOpen = false;
    @track isSaving = false;

    @track isSettingsModalOpen = false;
    @track isRiskModalOpen = false;

    @track isOverrideModalOpen = false;
    @track overrideScore = 50;
    @track overrideJustification = '';
    activeOverrideTabId = '';

    // Pro Mode (Multi-pass) Configuration
    @track analysisMode = 'standard';
    @track proSettings = { core: 1, activity: 3, financials: 1, transactions: 1, risk: 1, executionMode: 'parallel' };

    // Dynamic Form Inputs & Text Highlight Tracking
    @track activityYears = 3;
    @track activityCount = 10;
    @track flaggedItems = [];
    @track floatingAction = { show: false, top: 0, left: 0, text: '' }; // Positions the "Flag text" button

    // Contextual Chat Assistant State
    @track isChatOpen = false;
    @track chatMessages = [{ id: 'init', role: 'bot', text: 'Hi! I am ready to answer any questions about the generated AML Analysis.', isBot: true }];
    @track chatInputText = '';
    @track isChatLoading = false;

    // Save/Load
    @track _analyzerRecords = [];
    @track _selectedAnalyzerId = '';
    @track _isLoadedFromSaved = false;
    @track _saveMode = 'create';

    // Flag management
    @track _isFlagPanelOpen = false;

    // Side-by-side
    @track _isSplitView = false;
    @track _splitLeftTabId = '';
    @track _splitRightTabId = '';



    // Analyst notes
    @track _analystNotes = {};
    @track _notesExpanded = {};

    // Pins
    @track _pinnedItems = [];
    @track _isPinPanelOpen = false;

    // Collapsible sections
    @track _collapsedSections = {};

    // Audit log
    @track _auditLog = [];
    @track _isAuditPanelOpen = false;

    // User Guide
    @track _guideOpen = false;
    @track _guideTab = 'reference';

    // Feature: Tab review tracking (completion checklist)
    @track _reviewedTabs = {};          // { tabId: true } — set when analyst views tab for 3+ seconds
    _reviewTimers = {};                 // { tabId: timeoutId } — pending review timers

    // Feature: Sound notification on completion
    @track _soundEnabled = true;

    // ==========================================
    // LIFECYCLE HOOKS
    // ==========================================

    connectedCallback() {
        this.initializeTabs();

        // Load analyzer records — prefer new record variable, fallback to legacy JSON
        const collection = this.analyzerRecordCollection || this._parseLegacyJson(this.inputAnalyzerRecords);
        if (collection && collection.length > 0) {
            // Sort by CreatedDate descending so the latest is first
            this._analyzerRecords = [...collection].sort((a, b) => {
                const dateA = a.CreatedDate || a.LastModifiedDate || '';
                const dateB = b.CreatedDate || b.LastModifiedDate || '';
                return dateB.localeCompare(dateA);
            });
        }

        // Auto-hydrate: prefer explicit single record, otherwise load latest from collection
        const singleRecord = this.analyzerRecord || this._parseLegacyJson(this.inputAnalyzerRecord);
        if (singleRecord && singleRecord.Id) {
            this._selectedAnalyzerId = singleRecord.Id;
            this._hydrateFromRecord(singleRecord);
        } else if (this._analyzerRecords.length > 0) {
            // Auto-load the latest (first after sort)
            const latest = this._analyzerRecords[0];
            this._selectedAnalyzerId = latest.Id;
            this._hydrateFromRecord(latest);
        }
    }

    /**
     * @description Prevents memory leaks by clearing all running Javascript intervals when the component is destroyed.
     * This stops background processing if the user navigates away from the record page.
     */
    disconnectedCallback() {
        this.tabs.forEach(tab => {
            if (tab.progressInterval) clearInterval(tab.progressInterval);
        });
        Object.values(this._reviewTimers).forEach(t => clearTimeout(t));
    }

    /**
     * @description Builds the core array that drives the UI.
     * Tabs are filtered out entirely if their Flow API Name wasn't provided by the admin in setup.
     */
    initializeTabs() {
        this.tabs = [
            { id: 'core', label: 'Core Snapshot', icon: 'utility:summary', flowApiName: this.promptCoreSnapshot, result: '', rawResult: '', isIdle: true, isLoading: false, hasContent: false, isPending: false, progress: 0, progressInterval: null, feedback: null, emptyStateIcon: 'standard:client', emptyStateTitle: 'Core Identity Scan', emptyStateDesc: 'Verify identity, demographics, and basic KYC data against global standards.', emptyStateBullets: [{id: 1, text: 'Identity & Entity Verification'}, {id: 2, text: 'Demographic Risk Profiling'}, {id: 3, text: 'Account Structure Check'}], proStatusText: '', executedMode: null, executedRuns: 0, drafts: [], showAuditTrail: false, isAborted: false },
            { id: 'activity', label: 'Recent Activity', icon: 'utility:activity', flowApiName: this.promptRecentActivity, result: '', rawResult: '', isIdle: true, isLoading: false, hasContent: false, isPending: false, progress: 0, progressInterval: null, feedback: null, emptyStateIcon: 'standard:custom_notification', emptyStateTitle: 'Behavioral Event Radar', emptyStateDesc: 'Scan historical interactions, cases, and flags for unusual behavioral patterns.', emptyStateBullets: [{id: 1, text: 'Interaction Velocity'}, {id: 2, text: 'Geographic Footprint Check'}, {id: 3, text: 'Behavioral Anomaly Detection'}], proStatusText: '', executedMode: null, executedRuns: 0, drafts: [], showAuditTrail: false, isAborted: false },
            { id: 'financials', label: 'Financial Profile', icon: 'utility:moneybag', flowApiName: this.promptFinancialProfile, result: '', rawResult: '', isIdle: true, isLoading: false, hasContent: false, isPending: false, progress: 0, progressInterval: null, feedback: null, emptyStateIcon: 'standard:investment_account', emptyStateTitle: 'Wealth & Asset Deep Dive', emptyStateDesc: 'Evaluate Source of Wealth (SoW), asset risk, and financial logic alignment.', emptyStateBullets: [{id: 1, text: 'Source of Wealth Logic'}, {id: 2, text: 'Asset Class Risk Assessment'}, {id: 3, text: 'Goal Transparency Check'}], proStatusText: '', executedMode: null, executedRuns: 0, drafts: [], showAuditTrail: false, isAborted: false },
            { id: 'transactions', label: 'Transactions', icon: 'utility:currency', flowApiName: this.promptTransactions, result: '', rawResult: '', isIdle: true, isLoading: false, hasContent: false, isPending: false, progress: 0, progressInterval: null, feedback: null, emptyStateIcon: 'standard:service_contract', emptyStateTitle: 'Ledger Flow Analysis', emptyStateDesc: 'Scan structured financial movements for AML typologies (structuring, pass-throughs).', emptyStateBullets: [{id: 1, text: 'Volume & Velocity Thresholds'}, {id: 2, text: 'High-Risk Counterparties'}, {id: 3, text: 'Smurfing & Layering Detection'}], proStatusText: '', executedMode: null, executedRuns: 0, drafts: [], showAuditTrail: false, isAborted: false },
            { id: 'risk', label: 'Risk Summary', icon: 'utility:shield', flowApiName: this.promptRiskSummary, result: '', rawResult: '', isIdle: true, isLoading: false, hasContent: false, isPending: false, progress: 0, progressInterval: null, feedback: null, riskScore: null, riskColorStyle: '', gaugeStyle: '', riskLabel: '', emptyStateIcon: 'standard:task2', emptyStateTitle: 'Executive Risk Scorecard', emptyStateDesc: 'Synthesize all modules into a final compliance verdict and action plan.', emptyStateBullets: [{id: 1, text: 'Consolidated AML Score'}, {id: 2, text: 'Critical Red Flag Summary'}, {id: 3, text: 'Actionable Next Steps'}], proStatusText: '', executedMode: null, executedRuns: 0, drafts: [], showAuditTrail: false, isAborted: false }
        ].filter(tab => tab.flowApiName);

        // Set the first available tab as active on load
        if (this.tabs.length > 0) {
            this.activeTabValue = this.tabs[0].id;
        }

        // Initialize analyst notes for each tab
        const notes = {};
        const notesExp = {};
        this.tabs.forEach(t => { notes[t.id] = ''; notesExp[t.id] = false; });
        this._analystNotes = notes;
        this._notesExpanded = notesExp;
    }

    // ==========================================
    // COMPUTED PROPERTIES (Used directly by HTML)
    // ==========================================

    /**
     * @description Computes dynamic CSS classes and conditional flags for each tab in real-time.
     */
    get processedTabs() {
        return this.tabs.map(tab => {
            const isActive = tab.id === this.activeTabValue;
            let tabClass = isActive ? 'custom-tab active-tab' : 'custom-tab inactive-tab';
            let iconClass = 'slds-var-m-right_x-small tab-icon';

            // Append animation classes based on state
            if (tab.isLoading) { tabClass += ' tab-loading'; iconClass += ' icon-loading'; }
            else if (tab.hasContent) { tabClass += ' tab-complete'; iconClass += ' icon-complete'; }
            else if (tab.isPending) { tabClass += ' tab-pending'; iconClass += ' icon-pending'; }
            // Amber dot on unreviewed tabs with content
            if (tab.hasContent && !this._reviewedTabs[tab.id]) { tabClass += ' aml-tab-unreviewed'; }

            const parsedSecs = this._parseIntoSections(tab.rawResult, tab.id);
            return {
                ...tab, isActive, tabClass, iconClass,
                progressStyle: `width: ${tab.progress}%`,
                displayProgress: Number(tab.progress).toFixed(1),
                isActivityTab: tab.id === 'activity',
                contentClass: `modern-content-box slds-var-p-around_large ai-content-container tab-content-${tab.id}`,
                showProBadge: tab.executedMode === 'PRO',
                showStandardBadge: tab.executedMode === 'STANDARD',
                showSavedBadge: tab.executedMode === 'SAVED',
                isRiskTab: tab.id === 'risk',
                noteText: this._analystNotes[tab.id] || '',
                isNoteExpanded: !!this._notesExpanded[tab.id],
                noteToggleLabel: this._notesExpanded[tab.id] ? 'Hide Notes' : 'Analyst Notes',
                parsedSections: parsedSecs,
                hasParsedSections: parsedSecs.length > 0,
                auditTrailLabel: tab.showAuditTrail ? 'Hide Audit Trail' : 'View Audit Trail',
                // Timestamp
                hasTimestamp: !!tab.completedAt,
                timestampLabel: tab.completedAt ? `Generated: ${tab.completedAt}` : '',
                // Review tracking
                isReviewed: !!this._reviewedTabs[tab.id],
                reviewClass: (tab.hasContent && !this._reviewedTabs[tab.id]) ? 'aml-tab-unreviewed' : ''
            };
        });
    }

    get overallProgressStyle() { return `width: ${this.overallProgress}%`; }
    get displayOverallProgress() { return Number(this.overallProgress).toFixed(1); }
    get allSectionsAnalyzed() { return this.tabs.length > 0 && this.tabs.every(tab => tab.hasContent); }
    get isProMode() { return this.analysisMode === 'pro'; }
    get parallelModeClass() { return this.proSettings.executionMode === 'parallel' ? 'execution-btn active' : 'execution-btn'; }
    get serialModeClass() { return this.proSettings.executionMode === 'serial' ? 'execution-btn active' : 'execution-btn'; }
    get batchParallelModeClass() { return this.batchExecutionMode === 'parallel' ? 'execution-btn active' : 'execution-btn'; }
    get batchSerialModeClass() { return this.batchExecutionMode === 'serial' ? 'execution-btn active' : 'execution-btn'; }
    get hasFlaggedItems() { return this.flaggedItems.length > 0; }
    get flaggedCount() { return this.flaggedItems.length; }
    get floatingStyle() { return `top: ${this.floatingAction.top}px; left: ${this.floatingAction.left}px;`; }

    // Analyzer selector
    get analyzerOptions() {
        return this._analyzerRecords.map(r => {
            const name = r.Name || 'Analysis';
            const dateStr = r.CreatedDate || r.LastModifiedDate;
            let timestamp = '';
            if (dateStr) {
                try {
                    const d = new Date(dateStr);
                    timestamp = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                        + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                } catch (e) { /* ignore */ }
            }
            return {
                label: timestamp ? `${name} — ${timestamp}` : name,
                value: r.Id
            };
        });
    }
    get hasAnalyzerRecords() { return this._analyzerRecords.length > 0; }
    get canUpdateExisting() { return this._isLoadedFromSaved && !!this._selectedAnalyzerId; }

    // Flags
    get flagPanelClass() { return this._isFlagPanelOpen ? 'aml-flag-panel aml-flag-panel-open' : 'aml-flag-panel'; }

    // Pins
    get hasPinnedItems() { return this._pinnedItems.length > 0; }
    get pinnedCount() { return this._pinnedItems.length; }

    // Split view
    get splitTabOptions() {
        return this.tabs.filter(t => t.hasContent).map(t => ({ label: t.label, value: t.id }));
    }
    get splitLeftTab() { return this.processedTabs.find(t => t.id === this._splitLeftTabId); }
    get splitRightTab() { return this.processedTabs.find(t => t.id === this._splitRightTabId); }
    get canSplitView() { return this.tabs.filter(t => t.hasContent).length >= 2; }

    // Comparison


    // Risk dependencies
    get riskDependencies() {
        return this.tabs.filter(t => t.id !== 'risk').map(t => ({
            id: t.id,
            label: t.label,
            isDone: t.hasContent,
            isLoading: t.isLoading,
            isPending: t.isPending,
            statusLabel: t.hasContent ? 'Complete' : t.isLoading ? 'Running...' : t.isPending ? 'Queued' : 'Not started',
            dotClass: t.hasContent ? 'aml-dep-dot aml-dep-done' : t.isLoading ? 'aml-dep-dot aml-dep-loading' : t.isPending ? 'aml-dep-dot aml-dep-pending' : 'aml-dep-dot aml-dep-idle'
        }));
    }
    get allDependenciesMet() { return this.tabs.filter(t => t.id !== 'risk').every(t => t.hasContent); }

    // Audit
    get hasAuditEntries() { return this._auditLog.length > 0; }
    get noAuditEntries() { return !this.hasAuditEntries; }
    get auditCount() { return this._auditLog.length; }

    // Save modal helpers
    get saveModeOptions() {
        return [
            { label: 'Create New', value: 'create' },
            { label: 'Update Existing', value: 'update', disabled: !this.canUpdateExisting }
        ];
    }
    get sectionsWithContent() { return this.tabs.filter(t => t.hasContent).length; }
    get totalTabCount() { return this.tabs.length; }
    get notesCount() { return Object.values(this._analystNotes).filter(n => n && n.trim()).length; }

    // User Guide
    get guideClass() { return this._guideOpen ? 'aml-guide aml-guide-open' : 'aml-guide'; }
    get guideChevronClass() { return this._guideOpen ? 'aml-guide-chevron open' : 'aml-guide-chevron'; }
    get isGuideRefTab() { return this._guideTab === 'reference'; }
    get isGuideFeatTab() { return this._guideTab === 'features'; }
    get isGuideReleaseTab() { return this._guideTab === 'releases'; }
    get guideRefTabClass() { return this._guideTab === 'reference' ? 'aml-guide-tab active' : 'aml-guide-tab'; }
    get guideFeatTabClass() { return this._guideTab === 'features' ? 'aml-guide-tab active' : 'aml-guide-tab'; }
    get guideReleaseTabClass() { return this._guideTab === 'releases' ? 'aml-guide-tab active' : 'aml-guide-tab'; }
    handleToggleGuide() { this._guideOpen = !this._guideOpen; }
    handleGuideTabSwitch(event) { this._guideTab = event.currentTarget.dataset.tab; }

    // Tab review checklist
    get reviewedTabCount() { return Object.keys(this._reviewedTabs).length; }
    get totalContentTabs() { return this.tabs.filter(t => t.hasContent).length; }
    get allTabsReviewed() { return this.totalContentTabs > 0 && this.reviewedTabCount >= this.totalContentTabs; }
    get unreviewedCount() { return this.totalContentTabs - this.reviewedTabCount; }
    get hasUnreviewedTabs() { return this.unreviewedCount > 0; }
    get reviewProgressLabel() { return `${this.reviewedTabCount}/${this.totalContentTabs} reviewed`; }

    _startReviewTimer(tabId) {
        // Clear any existing timer for this tab
        if (this._reviewTimers[tabId]) clearTimeout(this._reviewTimers[tabId]);
        // Only track tabs with content that haven't been reviewed yet
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab || !tab.hasContent || this._reviewedTabs[tabId]) return;
        // Mark as reviewed after 3 seconds on the tab
        this._reviewTimers[tabId] = setTimeout(() => {
            this._reviewedTabs = { ...this._reviewedTabs, [tabId]: true };
            this._logAction('reviewed', `Reviewed ${tab.label}`, tabId);
        }, 3000);
    }

    // Sound notification
    toggleSound() { this._soundEnabled = !this._soundEnabled; }
    get soundToggleIcon() { return this._soundEnabled ? 'utility:volume_high' : 'utility:volume_off'; }
    get soundToggleLabel() { return this._soundEnabled ? 'Sound On' : 'Sound Off'; }

    _playCompletionSound() {
        if (!this._soundEnabled) return;
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            // Short pleasant "ding" — two ascending tones
            const playTone = (freq, startTime, duration) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.15, startTime);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
                osc.start(startTime);
                osc.stop(startTime + duration);
            };
            const now = audioCtx.currentTime;
            playTone(660, now, 0.15);
            playTone(880, now + 0.12, 0.2);
        } catch (e) { /* AudioContext not available */ }
    }

    // ==========================================
    // UTILITY HELPER METHODS
    // ==========================================

    /**
     * @description Finds the array index of a tab by its ID. Replaces repeated boilerplate.
     * @param {String} tabId - The ID string of the tab.
     * @returns {Number} The index of the tab, or -1 if not found.
     */
    _getTabIndex(tabId) {
        return this.tabs.findIndex(t => t.id === tabId);
    }

    /** Safely parse legacy JSON string inputs. Returns null on failure. */
    _parseLegacyJson(input) {
        if (!input || typeof input !== 'string') return null;
        try { return JSON.parse(input); } catch (e) { return null; }
    }

    // ==========================================
    // FEATURE: ANALYSIS CHAT (QA Assistant)
    // ==========================================

    toggleChat() { this.isChatOpen = !this.isChatOpen; }
    handleChatInputChange(event) { this.chatInputText = event.target.value; }

    /**
     * @description Sends the user's question, along with the context of all generated tabs, to the AI Chat flow.
     */
    async handleSendChat() {
        if (!this.chatInputText || !this.chatInputText.trim()) return;

        const question = this.chatInputText.trim();
        this.chatMessages = [...this.chatMessages, { id: Date.now().toString(), role: 'user', text: question, isUser: true }];
        this.chatInputText = '';

        // Defensive Guard: Check if Flow is mapped by Admin
        if (!this.flowApiNameChatQA) {
            this.chatMessages = [...this.chatMessages, { id: Date.now().toString() + 'e', role: 'bot', text: 'Setup Error: No Analysis Chat Flow configured in Builder.', isBot: true }];
            return;
        }

        this.isChatLoading = true;

        try {
            // Include Risk Summary data (true parameter)
            let flowInputs = this.gatherContextData(true);
            flowInputs.inputUserQuestion = question;

            const rawResponse = await generateAMLSection({
                accountRecord: this.accountRecord,
                flowApiName: this.flowApiNameChatQA,
                additionalInputs: flowInputs
            });

            this.chatMessages = [...this.chatMessages, { id: Date.now().toString(), role: 'bot', text: rawResponse.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>'), isBot: true }];
        } catch (error) {
            this.chatMessages = [...this.chatMessages, { id: Date.now().toString(), role: 'bot', text: `Error: ${error.body?.message || error.message}`, isBot: true, isError: true }];
        } finally {
            this.isChatLoading = false;
            // Scroll to the bottom of the chat window
            setTimeout(() => {
                const container = this.template.querySelector('.chat-history');
                if(container) container.scrollTop = container.scrollHeight;
            }, 100);
        }
    }

    // ==========================================
    // FEATURE: HUMAN OVERRIDE (Compliance Audit)
    // ==========================================

    handleOpenOverrideModal(event) {
        this.activeOverrideTabId = event.currentTarget.dataset.id;
        const tabIndex = this._getTabIndex(this.activeOverrideTabId);

        if (tabIndex !== -1 && this.tabs[tabIndex].riskScore !== null) {
            this.overrideScore = this.tabs[tabIndex].riskScore;
            this.overrideJustification = '';
            this.isOverrideModalOpen = true;
        } else {
            this.dispatchEvent(new ShowToastEvent({ title: 'Action Unavailable', message: 'You must generate a Risk Score before you can override it.', variant: 'info' }));
        }
    }

    handleCloseOverrideModal() { this.isOverrideModalOpen = false; }
    handleOverrideScoreChange(event) { this.overrideScore = event.target.value; }
    handleOverrideJustChange(event) { this.overrideJustification = event.target.value; }

    /**
     * @description Saves the human-adjusted score, updates the SVG gauge visuals, and prepends
     * an audit-trail justification block to the generated HTML result.
     */
    saveOverride() {
        if (!this.overrideJustification.trim()) {
            this.dispatchEvent(new ShowToastEvent({ title: 'Validation Error', message: 'An audit justification is mandatory for score overrides.', variant: 'error' }));
            return;
        }

        const tabIndex = this._getTabIndex(this.activeOverrideTabId);
        if (tabIndex !== -1) {
            const score = parseInt(this.overrideScore, 10);
            this.tabs[tabIndex].riskScore = score;

            // Calculate SVG Stroke mapping (0 to 251 pixels of dash array)
            const dashArrayVal = (score / 100) * 251;
            let riskColor = score < 40 ? '#c23934' : score < 70 ? '#eab308' : '#2e844a';
            this.tabs[tabIndex].riskLabel = score < 40 ? 'CRITICAL RISK (OVERRIDDEN)' : score < 70 ? 'MODERATE RISK (OVERRIDDEN)' : 'STANDARD VALIDATION (OVERRIDDEN)';
            this.tabs[tabIndex].riskColorStyle = `color: ${riskColor};`;
            this.tabs[tabIndex].gaugeStyle = `stroke: ${riskColor}; stroke-dasharray: ${dashArrayVal}, 251; transition: stroke-dasharray 1.5s cubic-bezier(0.25, 0.8, 0.25, 1);`;

            // Prepend the justification block to the result HTML
            const overrideHtml = `
            <div style="background:#fff5f5; border:1px solid #c23934; padding:16px; border-radius:8px; margin-bottom:20px;">
                <h3 style="color:#c23934; margin-bottom:8px; font-weight:bold; font-size:1.05rem;"><span style="margin-right:8px;">⚖️</span> HUMAN COMPLIANCE OVERRIDE APPLIED</h3>
                <p style="margin-bottom:4px; font-size:0.95rem;"><strong>Adjusted Score:</strong> ${score}</p>
                <p style="font-size:0.95rem;"><strong>Auditor Justification:</strong> <em>"${this.overrideJustification}"</em></p>
            </div>`;

            this.tabs[tabIndex].result = overrideHtml + this.tabs[tabIndex].result;
            this._logAction('override', 'Risk score overridden to ' + score, 'risk');
            this.dispatchEvent(new ShowToastEvent({ title: 'Override Logged', message: 'Score successfully adjusted and recorded for audit.', variant: 'success' }));
        }
        this.isOverrideModalOpen = false;
    }

    // ==========================================
    // UI SETTINGS & INTERACTION HANDLERS
    // ==========================================

    handleOpenSettings() { this.isSettingsModalOpen = true; }
    handleCloseSettings() { this.isSettingsModalOpen = false; }
    handleModeChange(event) { this.analysisMode = event.target.checked ? 'pro' : 'standard'; }
    handleRunCountChange(event) {
        const section = event.target.dataset.section;
        let val = parseInt(event.target.value, 10);
        if (val < 1) val = 1; if (val > 4) val = 4;
        this.proSettings[section] = val;
    }
    handleBatchExecutionModeChange(event) { this.batchExecutionMode = event.currentTarget.dataset.mode; }
    handleExecutionModeChange(event) {
        this.proSettings.executionMode = event.currentTarget.dataset.mode;
        this.proSettings = { ...this.proSettings };
    }
    handleTabClick(event) {
        this.activeTabValue = event.currentTarget.dataset.id;
        this._startReviewTimer(this.activeTabValue);
    }
    handleActivityYearsChange(event) { this.activityYears = parseInt(event.target.value, 10) || 3; }
    handleActivityCountChange(event) { this.activityCount = parseInt(event.target.value, 10) || 10; }
    handleOpenRiskModal() { this.isRiskModalOpen = true; }
    handleCloseRiskModal() { this.isRiskModalOpen = false; }

    // ==========================================
    // TEXT SELECTION & FLAGGING LOGIC (Highlight to Case)
    // ==========================================

    handleMouseDown() { this.floatingAction.show = false; }

    /**
     * @description Captures mouse release events on the component body. If text is highlighted,
     * it renders the "Flag snippet" floating action button near the cursor.
     */
    handleMouseUp(event) {
        const selection = window.getSelection();
        const text = selection.toString().trim();
        // Note: Shadow DOM may restrict this in some strict Salesforce environments.
        if (text.length > 8) {
            this.floatingAction = { show: true, top: event.clientY - 45, left: event.clientX, text: text };
        } else {
            this.floatingAction.show = false;
        }
    }

    handleFlagText() {
        if (this.floatingAction.text) {
            this.flaggedItems = [...this.flaggedItems, { id: 'flag_' + Date.now(), text: this.floatingAction.text }];
            this.floatingAction.show = false;
            this._logAction('flag', 'Text flagged to case cart');
            this.dispatchEvent(new ShowToastEvent({ title: 'Flagged', message: 'Insight added to Case Cart.', variant: 'success' }));
        }
    }

    handleRemoveFlag(event) {
        const id = event.currentTarget.dataset.id;
        this.flaggedItems = this.flaggedItems.filter(f => f.id !== id);
    }
    handleClearAllFlags() {
        this.flaggedItems = [];
    }
    toggleFlagPanel() { this._isFlagPanelOpen = !this._isFlagPanelOpen; }

    toggleAuditTrail(event) {
        const tabIndex = this._getTabIndex(event.target.dataset.id);
        if (tabIndex !== -1) {
            this.tabs[tabIndex].showAuditTrail = !this.tabs[tabIndex].showAuditTrail;
        }
    }

    handleAbort(event) {
        const tabIndex = this._getTabIndex(event.target.dataset.id);
        if (tabIndex !== -1) {
            this.tabs[tabIndex].isAborted = true; // Signals the executeTabFlow to halt at the next await boundary
            this.dispatchEvent(new ShowToastEvent({ title: 'Aborting...', message: 'Execution halted. Resetting tab state.', variant: 'warning' }));
        }
    }

    /**
     * @description Recalculates the master top-level progress bar. It aggregates the progress of all tabs safely.
     */
    updateOverallProgress() {
        if (!this.showOverallProgress) return;
        const totalProgress = this.tabs.reduce((sum, t) => sum + (t.hasContent ? 100 : t.progress), 0);
        this.overallProgress = totalProgress / this.tabs.length;
        if (this.overallProgress >= 100) { setTimeout(() => { this.showOverallProgress = false; }, 1500); }
    }

    // ==========================================
    // BATCH GENERATION ENGINE (Run All Orchestration)
    // ==========================================

    handleNewAnalysis() {
        // Reset all tabs to idle
        this.tabs.forEach((_, idx) => {
            this.tabs[idx].rawResult = '';
            this.tabs[idx].result = '';
            this.tabs[idx].hasContent = false;
            this.tabs[idx].isIdle = true;
            this.tabs[idx].isLoading = false;
            this.tabs[idx].isPending = false;
            this.tabs[idx].progress = 0;
            this.tabs[idx].riskScore = null;
            this.tabs[idx].riskColorStyle = '';
            this.tabs[idx].gaugeStyle = '';
            this.tabs[idx].riskLabel = '';
            this.tabs[idx].executedMode = null;
            this.tabs[idx].executedRuns = 0;
            this.tabs[idx].drafts = [];
            this.tabs[idx].showAuditTrail = false;
            this.tabs[idx].isAborted = false;
            if (this.tabs[idx].progressInterval) {
                clearInterval(this.tabs[idx].progressInterval);
            }
        });

        // Clear all saved state
        this._selectedAnalyzerId = '';
        this._isLoadedFromSaved = false;
        this._saveMode = 'create';
        this._analystNotes = {};
        this._notesExpanded = {};
        this.tabs.forEach(t => { this._analystNotes[t.id] = ''; this._notesExpanded[t.id] = false; });
        this._pinnedItems = [];
        this.flaggedItems = [];
        this._collapsedSections = {};
        this._auditLog = [];
        this._isSplitView = false;
        this._reviewedTabs = {};
        Object.values(this._reviewTimers).forEach(t => clearTimeout(t));
        this._reviewTimers = {};
        this.showOverallProgress = false;
        this.overallProgress = 0;

        this._logAction('newAnalysis', 'Started new analysis — cleared all previous data');
    }

    handleRunAll() {
        this.tabs.forEach(tab => {
            if (!tab.isLoading && !tab.isPending) {
                tab.isIdle = false;
                tab.isPending = true;
                tab.hasContent = false;
                tab.progress = 0;
            }
        });
        this._isLoadedFromSaved = false;
        this.showOverallProgress = true;
        this.overallProgress = 0;
        this._logAction('batchRun', 'Run All initiated');
        this.startQueue();
    }

    handleRefreshAll() {
        this.tabs.forEach(tab => {
            if (!tab.isLoading && !tab.isPending) {
                tab.isPending = true; tab.feedback = null; tab.riskScore = null;
                tab.executedMode = null; tab.executedRuns = 0; tab.drafts = []; tab.showAuditTrail = false;
                tab.hasContent = false; tab.progress = 0;
            }
        });
        this.showOverallProgress = true;
        this.overallProgress = 0;
        this._logAction('refresh', 'Refresh All initiated');
        this.startQueue();
    }

    handleRunSingle(event) {
        const tabId = event.target.dataset.id;
        this.executeTabFlow(tabId);
    }

    /**
     * @description Core batch engine. Uses a 2-Phase approach to respect data dependencies.
     * Phase 1: Gathers Independent data (Core, Activity, Financials, Transactions).
     * Phase 2: Gathers Dependent data (Risk Summary) which requires Phase 1 to be finished.
     */
    async startQueue() {
        if (this.isQueueRunning) return;
        this.isQueueRunning = true;

        // Phase 1: Run all independent tabs (Everything except Risk)
        const pendingIndependent = this.tabs.filter(t => t.isPending && t.id !== 'risk').map(t => t.id);

        if (pendingIndependent.length > 0) {
            if (this.batchExecutionMode === 'parallel') {
                // Execute simultaneously (Fast but hits API limits faster)
                const phase1Promises = pendingIndependent.map(tabId => this.executeTabFlow(tabId));
                await Promise.all(phase1Promises);
            } else {
                // Execute sequentially (Slower but stable)
                for (const tabId of pendingIndependent) {
                    await this.executeTabFlow(tabId);
                }
            }
        }

        // Phase 2: Run dependent tabs (Risk Summary)
        const pendingDependent = this.tabs.filter(t => t.isPending && t.id === 'risk').map(t => t.id);
        if (pendingDependent.length > 0) {
            for (const tabId of pendingDependent) {
                await this.executeTabFlow(tabId);
            }
        }

        this.isQueueRunning = false;
    }

    /**
     * @description Extracts risk score from text and applies SVG gauge styling to a tab.
     * @param {Number} tabIndex - The index of the tab in the tabs array.
     * @param {Number} score - The risk score (0-100).
     */
    _applyRiskGaugeStyles(tabIndex, score) {
        this.tabs[tabIndex].riskScore = score;
        const dashArrayVal = (score / 100) * 251;
        let riskColor = score < 40 ? '#c23934' : score < 70 ? '#eab308' : '#2e844a';
        this.tabs[tabIndex].riskLabel = score < 40 ? 'CRITICAL RISK: MANUAL CHECK MANDATORY' : score < 70 ? 'MODERATE RISK: ENHANCED DILIGENCE REQUIRED' : 'STANDARD VALIDATION';
        this.tabs[tabIndex].riskColorStyle = `color: ${riskColor};`;
        this.tabs[tabIndex].gaugeStyle = `stroke: ${riskColor}; stroke-dasharray: ${dashArrayVal}, 251; transition: stroke-dasharray 1.5s cubic-bezier(0.25, 0.8, 0.25, 1);`;
    }

    /**
     * @description Master AI Callout method. Handles standard generation, Pro Mode multi-pass loops,
     * consensus judging, and SVG risk gauge generation for a specific tab.
     * @param {String} tabId - The ID of the tab to process.
     */
    async executeTabFlow(tabId) {
        const tabIndex = this._getTabIndex(tabId);
        if (tabIndex === -1 || this.tabs[tabIndex].isLoading) return;

        // Reset Tab State for fresh generation
        this.tabs[tabIndex].isIdle = false;
        this.tabs[tabIndex].isPending = false;
        this.tabs[tabIndex].isLoading = true;
        this.tabs[tabIndex].isAborted = false;
        this.tabs[tabIndex].progress = 0;
        this.tabs[tabIndex].feedback = null;
        this.tabs[tabIndex].riskScore = null;
        this.tabs[tabIndex].executedMode = null;
        this.tabs[tabIndex].executedRuns = 0;
        this.tabs[tabIndex].drafts = [];
        this.tabs[tabIndex].showAuditTrail = false;

        // Configuration Fallback: Apply ?? 1 in case a tab doesn't have a configured Pro Setting
        const runCount = this.isProMode ? (this.proSettings[tabId] ?? 1) : 1;
        this.tabs[tabIndex].executedMode = runCount > 1 ? 'PRO' : 'STANDARD';
        this.tabs[tabIndex].executedRuns = runCount;
        this.tabs[tabIndex].proStatusText = runCount > 1 ? `Executing ${runCount} Pro models in ${this.proSettings.executionMode}...` : `Agentforce is synthesizing ${this.tabs[tabIndex].label}...`;

        this._logAction('run', `Started ${this.tabs[tabIndex].label} analysis (${this.tabs[tabIndex].executedMode})`, tabId);

        // 3-Phase Progress Simulator
        // Phase 1 (0→30%): Quick ramp — "request sent"
        // Phase 2 (30→80%): Slow tick — "waiting for AI response"
        // Phase 3 (80→100%): Handled in finally block — "response received"
        const maxWait = runCount > 1 ? 80 : 78;
        this.tabs[tabIndex].progress = 5;
        this.updateOverallProgress();

        // Phase 1: ramp to 30% quickly, then Phase 2: slow tick
        this.tabs[tabIndex].progressInterval = setInterval(() => {
            const current = this.tabs[tabIndex].progress;
            if (current < 30) {
                // Fast: ~5% per tick for 6 ticks = reaches 30% in ~1.8s
                this.tabs[tabIndex].progress = Math.min(30, current + 4 + Math.random() * 2);
            } else if (current < maxWait) {
                // Phase 2: slow tick — diminishing increments the higher we go
                const remaining = maxWait - current;
                const increment = Math.max(0.2, (remaining / 80) * (1.2 + Math.random() * 0.8));
                this.tabs[tabIndex].progress = Math.min(maxWait, current + increment);
            }
            this.updateOverallProgress();
        }, 300);

        try {
            await new Promise(resolve => setTimeout(resolve, 50));
            if (this.tabs[tabIndex].isAborted) throw new Error('ABORTED');

            // Set Context Inputs for specific tabs
            let flowInputs = null;
            if (tabId === 'risk') {
                flowInputs = this.gatherContextData(false); // Gather Phase 1 data
            } else if (tabId === 'activity') {
                flowInputs = { inputActivityYears: this.activityYears, inputActivityCount: this.activityCount };
            }

            let rawResponse = '';

            if (runCount === 1) {
                // ==========================================
                // STANDARD EXECUTION (Single Pass)
                // ==========================================
                rawResponse = await generateAMLSection({ accountRecord: this.accountRecord, flowApiName: this.tabs[tabIndex].flowApiName, additionalInputs: flowInputs });
                if (this.tabs[tabIndex].isAborted) throw new Error('ABORTED');
            } else {
                // ==========================================
                // PRO EXECUTION (Multi-Pass Self-Consistency)
                // ==========================================
                let rawDrafts = [];

                if (this.proSettings.executionMode === 'parallel') {
                    const promises = [];
                    for (let i = 0; i < runCount; i++) { promises.push(generateAMLSection({ accountRecord: this.accountRecord, flowApiName: this.tabs[tabIndex].flowApiName, additionalInputs: flowInputs })); }
                    rawDrafts = await Promise.all(promises);
                    if (this.tabs[tabIndex].isAborted) throw new Error('ABORTED');
                } else {
                    for (let i = 0; i < runCount; i++) {
                        if (this.tabs[tabIndex].isAborted) throw new Error('ABORTED');
                        this.tabs[tabIndex].proStatusText = `Executing Pro model pass ${i + 1} of ${runCount}...`;
                        const draft = await generateAMLSection({ accountRecord: this.accountRecord, flowApiName: this.tabs[tabIndex].flowApiName, additionalInputs: flowInputs });
                        rawDrafts.push(draft);
                    }
                }

                // Store drafts for the Audit Trail feature
                this.tabs[tabIndex].drafts = rawDrafts.map((txt, i) => ({ id: `draft_${i}`, title: `Raw AI Pass ${i+1}`, html: this.formatResponse(txt) }));

                if (!this.flowApiNameConsensusJudge) throw new Error('Pro Mode requires a Consensus Judge Flow API Name to be configured.');
                if (this.tabs[tabIndex].isAborted) throw new Error('ABORTED');

                this.tabs[tabIndex].proStatusText = `Synthesizing ${runCount} models for consensus...`;

                // Map drafts to the Consensus Judge Prompt
                let consensusInputs = {
                    inputDraft1: rawDrafts[0] || 'No Data', inputDraft2: rawDrafts.length > 1 ? rawDrafts[1] : 'No Data',
                    inputDraft3: rawDrafts.length > 2 ? rawDrafts[2] : 'No Data', inputDraft4: rawDrafts.length > 3 ? rawDrafts[3] : 'No Data',
                    targetSection: this.tabs[tabIndex].label
                };

                rawResponse = await generateAMLSection({ accountRecord: this.accountRecord, flowApiName: this.flowApiNameConsensusJudge, additionalInputs: consensusInputs });
                if (this.tabs[tabIndex].isAborted) throw new Error('ABORTED');
            }

            let processedResponse = rawResponse;

            // ==========================================
            // EXTRACT RISK SCORE & BUILD SVG GAUGE
            // ==========================================
            if (tabId === 'risk') {
                const scoreMatch = processedResponse.match(/\[RISK_SCORE:\s*(\d+)\]/i);
                if (scoreMatch) {
                    this._applyRiskGaugeStyles(tabIndex, parseInt(scoreMatch[1], 10));
                    processedResponse = processedResponse.replace(/\[RISK_SCORE:\s*\d+\]/gi, '').trim();
                }
            }

            this.tabs[tabIndex].rawResult = processedResponse;
            this.tabs[tabIndex].result = this.formatResponse(processedResponse);
            this.tabs[tabIndex].hasContent = true;
            this.tabs[tabIndex].completedAt = new Date().toLocaleString();

        } catch (error) {
            // Handle Graceful Abort vs Real Error
            if (error.message === 'ABORTED') {
                clearInterval(this.tabs[tabIndex].progressInterval);
                this.tabs[tabIndex].isLoading = false;
                this.tabs[tabIndex].isIdle = true;
                this.tabs[tabIndex].isPending = false;
                this.tabs[tabIndex].progress = 0;
                return;
            }
            console.error(`Error in ${tabId}:`, error);
            this.tabs[tabIndex].result = `<div class="slds-notify slds-notify_alert slds-theme_alert-texture slds-theme_error" style="border-radius:8px;"><h2><b>Error:</b> ${error.body?.message || error.message}</h2></div>`;
            this.tabs[tabIndex].hasContent = true;
        } finally {
            if (this.tabs[tabIndex].isAborted) return;
            clearInterval(this.tabs[tabIndex].progressInterval);
            this.tabs[tabIndex].progress = 100;
            this.tabs[tabIndex].isLoading = false;
            this.updateOverallProgress();
            if (!this.tabs[tabIndex].isAborted) {
                this._logAction('complete', `${this.tabs[tabIndex].label} analysis complete`, tabId);
                // Start review timer for the active tab
                if (this.activeTabValue === tabId) {
                    this._startReviewTimer(tabId);
                }
                // Play sound when ALL tabs are done
                if (this.tabs.every(t => t.hasContent || t.isIdle)) {
                    this._playCompletionSound();
                }
            }
        }
    }

    /**
     * @description Collects all previously generated data (rawResults) to feed into dependent prompts (Risk/Chat/Case).
     * Replaces blank variables with "No data generated" to prevent prompt errors.
     */
    /**
     * Gathers tab results for dependent flows (Risk, Chat, Case, Save).
     * Flow variable names: inputCoreSnapshot, inputRecentActivity, inputFinancialProfile, inputTransactions, inputRiskSummary
     * IMPORTANT: These names must match the Flow input variable names exactly.
     */
    gatherContextData(includeRiskSummary) {
        const tabMap = {};
        this.tabs.forEach(t => { tabMap[t.id] = t; });

        const context = {
            inputCoreSnapshot: (tabMap.core && tabMap.core.rawResult) || 'No data generated.',
            inputRecentActivity: (tabMap.activity && tabMap.activity.rawResult) || 'No data generated.',
            inputFinancialProfile: (tabMap.financials && tabMap.financials.rawResult) || 'No data generated.',
            inputTransactions: (tabMap.transactions && tabMap.transactions.rawResult) || 'No data generated.'
        };
        if (includeRiskSummary) {
            context.inputRiskSummary = (tabMap.risk && tabMap.risk.rawResult) || 'No data generated.';
        }

        console.log('[AML] Context payload:', Object.entries(context).map(([k, v]) => `${k}: ${v ? v.substring(0, 50) + '...' : 'EMPTY'}`).join(' | '));
        return context;
    }

    /**
     * @description Basic parser that converts Markdown headers and newlines into
     * rich HTML that lightning-formatted-rich-text can safely render.
     */
    formatResponse(text) {
        if (!text) return 'No intelligence gathered.';
        let formatted = text.replace(/\n{3,}/g, '\n\n');
        const headerStyle = 'display:block; color:#014486; background-color:#f8fbfe; padding:8px 12px; border-left:4px solid #0176d3; border-radius:0 6px 6px 0; margin-top:1.5rem; margin-bottom:0.5rem;';
        formatted = formatted.replace(/\*\*(.*?)\*\*/g, `<strong style="${headerStyle}"><span style="margin-right:8px; font-size:1.1rem;">✨</span> $1</strong>`);
        formatted = formatted.replace(/\n/g, '<br/>');
        formatted = formatted.replace(/(<\/?(?:table|thead|tbody|tr|th|td)[^>]*>)\s*(?:<br\/>)+/gi, '$1');
        formatted = formatted.replace(/(?:<br\/>)+\s*(<\/?(?:table|thead|tbody|tr|th|td)[^>]*>)/gi, '$1');
        formatted = formatted.replace(/<\/strong><br\/>/g, '</strong>');
        return formatted;
    }

    /**
     * @description Robust clipboard copy method. Prefers modern navigator.clipboard but gracefully
     * falls back to a template-appended textarea if blocked by Locker Service/LWS iframe restrictions.
     */
    async handleCopyToClipboard(event) {
        const tabIndex = this._getTabIndex(event.currentTarget.dataset.id);
        if (tabIndex === -1) return;
        const textToCopy = this.tabs[tabIndex].rawResult.replace(/<[^>]*>?/gm, '').trim();

        try {
            await navigator.clipboard.writeText(textToCopy);
            this.dispatchEvent(new ShowToastEvent({ title: 'Copied!', message: 'Intelligence snippet copied to clipboard.', variant: 'success' }));
        } catch (err) {
            // Fallback for strict iFrame / Shadow DOM limitations
            const tempTextArea = document.createElement('textarea');
            tempTextArea.value = textToCopy;
            tempTextArea.style.position = 'fixed'; // Prevent scrolling
            tempTextArea.style.opacity = '0';
            this.template.appendChild(tempTextArea); // Append to template to respect shadow boundary
            tempTextArea.select();
            try {
                document.execCommand('copy');
                this.dispatchEvent(new ShowToastEvent({ title: 'Copied!', message: 'Intelligence snippet copied to clipboard.', variant: 'success' }));
            } catch (fallbackErr) {
                this.dispatchEvent(new ShowToastEvent({ title: 'Copy Failed', message: 'Unable to copy text in this environment.', variant: 'error' }));
            }
            this.template.removeChild(tempTextArea);
        }
    }

    // ==========================================
    // FEATURE: LOAD/HYDRATE FROM SAVED RECORDS
    // ==========================================

    handleAnalyzerSelect(event) {
        this._selectedAnalyzerId = event.detail.value;
        const record = this._analyzerRecords.find(r => r.Id === this._selectedAnalyzerId);
        if (record) {
            // Reset all tabs before hydrating a different record
            this.tabs.forEach((_, idx) => {
                this.tabs[idx].rawResult = '';
                this.tabs[idx].result = '';
                this.tabs[idx].hasContent = false;
                this.tabs[idx].isIdle = true;
                this.tabs[idx].riskScore = null;
                this.tabs[idx].riskColorStyle = '';
                this.tabs[idx].gaugeStyle = '';
                this.tabs[idx].riskLabel = '';
                this.tabs[idx].executedMode = null;
            });
            this._pinnedItems = [];
            this.flaggedItems = [];
            this._collapsedSections = {};
            this._hydrateFromRecord(record);
        }
    }

    _hydrateFromRecord(record) {
        console.log('[AML Hydrate] Record fields available:', Object.keys(record).join(', '));

        // Map tab IDs to record field API names
        // Uses the @api field mapping properties if set, otherwise falls back to defaults
        const fieldMap = {
            core: this.fieldCoreSnapshot || 'Core_Snapshot__c',
            activity: this.fieldRecentActivity || 'Recent_Activity__c',
            financials: this.fieldFinancialProfile || 'Financial_Profile__c',
            transactions: this.fieldTransactions || 'Transactions__c',
            risk: this.fieldRiskSummary || 'Risk_Summary__c'
        };

        this.tabs.forEach((tab, idx) => {
            const fieldName = fieldMap[tab.id];
            const rawText = record[fieldName] || '';
            console.log(`[AML Hydrate] Tab "${tab.id}" → field "${fieldName}" → ${rawText ? rawText.substring(0, 50) + '...' : 'EMPTY'}`);
            if (rawText) {
                this.tabs[idx].rawResult = rawText;
                this.tabs[idx].result = this.formatResponse(rawText);
                this.tabs[idx].hasContent = true;
                this.tabs[idx].isIdle = false;
                this.tabs[idx].executedMode = 'SAVED';
            }
        });

        // Apply risk score if available
        const riskScoreVal = record[this.fieldRiskScore];
        if (riskScoreVal != null) {
            const riskIdx = this._getTabIndex('risk');
            if (riskIdx !== -1) {
                this._applyRiskGaugeStyles(riskIdx, parseInt(riskScoreVal, 10));
            }
        }

        // Hydrate notes (individual fields per tab, using configurable field names)
        this._analystNotes = {
            ...this._analystNotes,
            core: record[this.fieldNotesCoreSnapshot] || this._analystNotes.core || '',
            activity: record[this.fieldNotesRecentActivity] || this._analystNotes.activity || '',
            financials: record[this.fieldNotesFinancialProfile] || this._analystNotes.financials || '',
            transactions: record[this.fieldNotesTransactions] || this._analystNotes.transactions || '',
            risk: record[this.fieldNotesRiskSummary] || this._analystNotes.risk || ''
        };

        // Hydrate pins
        try {
            const pinnedRaw = record[this.fieldPinnedItems];
            if (pinnedRaw) {
                this._pinnedItems = JSON.parse(pinnedRaw);
            }
        } catch (e) { /* ignore */ }

        // Hydrate flags
        try {
            const flaggedRaw = record[this.fieldFlaggedItems];
            if (flaggedRaw) {
                this.flaggedItems = JSON.parse(flaggedRaw);
            }
        } catch (e) { /* ignore */ }

        this._isLoadedFromSaved = true;
        this._saveMode = 'update';
        this._logAction('load', `Loaded saved analysis: ${record.Name || record.Id}`);
    }

    // ==========================================
    // FEATURE: ANALYST NOTES
    // ==========================================

    handleNoteChange(event) {
        const tabId = event.currentTarget.dataset.id;
        this._analystNotes = { ...this._analystNotes, [tabId]: event.target.value };
    }
    toggleNoteExpand(event) {
        const tabId = event.currentTarget.dataset.id;
        this._notesExpanded = { ...this._notesExpanded, [tabId]: !this._notesExpanded[tabId] };
    }

    // ==========================================
    // FEATURE: PINNED ITEMS
    // ==========================================

    handlePinText() {
        if (this.floatingAction.text) {
            const activeTab = this.activeTabValue;
            this._pinnedItems = [...this._pinnedItems, {
                id: 'pin_' + Date.now(),
                text: this.floatingAction.text,
                tabId: activeTab,
                timestamp: new Date().toISOString()
            }];
            this.floatingAction = { show: false, top: 0, left: 0, text: '' };
            this._logAction('pin', `Pinned finding from ${activeTab}`, activeTab);
            this.dispatchEvent(new ShowToastEvent({ title: 'Pinned', message: 'Finding bookmarked.', variant: 'success' }));
        }
    }
    handleRemovePin(event) {
        const id = event.currentTarget.dataset.id;
        this._pinnedItems = this._pinnedItems.filter(p => p.id !== id);
    }
    togglePinPanel() { this._isPinPanelOpen = !this._isPinPanelOpen; }

    // ==========================================
    // FEATURE: COLLAPSIBLE SECTIONS
    // ==========================================

    _parseIntoSections(rawText, tabId) {
        if (!rawText) return [];
        // Split on **Header** pattern
        const parts = rawText.split(/(?=\*\*[^*]+\*\*)/);
        // Only use collapsible sections if there are at least 2 real headers
        const withHeaders = parts.filter(p => /^\*\*[^*]+\*\*/.test(p));
        if (withHeaders.length < 2) return [];

        return parts.map((part, idx) => {
            const headerMatch = part.match(/^\*\*([^*]+)\*\*/);
            const header = headerMatch ? headerMatch[1].trim() : '';
            const body = headerMatch ? part.replace(/^\*\*[^*]+\*\*/, '').trim() : part.trim();
            if (!header && !body.trim()) return null;
            // Skip preamble text that has no header
            if (!header) return null;
            const sectionId = `${tabId}_${idx}`;
            const isCollapsed = !!this._collapsedSections[sectionId];
            return {
                id: sectionId,
                header,
                bodyHtml: this.formatResponse(body),
                isCollapsed,
                isExpanded: !isCollapsed,
                chevronClass: isCollapsed ? 'aml-chevron-icon collapsed' : 'aml-chevron-icon'
            };
        }).filter(Boolean);
    }

    handleToggleSection(event) {
        const sectionId = event.currentTarget.dataset.sectionId;
        this._collapsedSections = { ...this._collapsedSections, [sectionId]: !this._collapsedSections[sectionId] };
    }

    handleExpandAllSections(event) {
        const tabId = event.currentTarget.dataset.id;
        const updated = { ...this._collapsedSections };
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return;
        const parts = tab.rawResult.split(/(?=\*\*[^*]+\*\*)/);
        parts.forEach((_, idx) => { updated[`${tabId}_${idx}`] = false; });
        this._collapsedSections = updated;
    }

    handleCollapseAllSections(event) {
        const tabId = event.currentTarget.dataset.id;
        const updated = { ...this._collapsedSections };
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return;
        const parts = tab.rawResult.split(/(?=\*\*[^*]+\*\*)/);
        parts.forEach((_, idx) => { updated[`${tabId}_${idx}`] = true; });
        this._collapsedSections = updated;
    }

    // ==========================================
    // FEATURE: SIDE-BY-SIDE SPLIT VIEW
    // ==========================================

    toggleSplitView() {
        this._isSplitView = !this._isSplitView;
        if (this._isSplitView) {
            const contentTabs = this.tabs.filter(t => t.hasContent);
            if (contentTabs.length >= 2) {
                this._splitLeftTabId = contentTabs[0].id;
                this._splitRightTabId = contentTabs[1].id;
            }
        }
    }
    handleSplitLeftChange(event) { this._splitLeftTabId = event.detail.value; }
    handleSplitRightChange(event) { this._splitRightTabId = event.detail.value; }

    // ==========================================
    // FEATURE: HISTORICAL COMPARISON
    // ==========================================

    // ==========================================
    // FEATURE: SESSION AUDIT LOG
    // ==========================================

    _logAction(action, detail, tabId = null) {
        const entry = {
            id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            timestamp: new Date().toLocaleString(),
            action,
            detail,
            tabId
        };
        const log = [...this._auditLog, entry];
        this._auditLog = log.length > 200 ? log.slice(-200) : log;
    }
    toggleAuditPanel() { this._isAuditPanelOpen = !this._isAuditPanelOpen; }

    // ==========================================
    // ACTION MODALS (Case & Save)
    // ==========================================

    async handleOpenCaseModal() {
        this.isCaseModalOpen = true;
        this.isCaseLoading = true;
        const accName = this.accountRecord && this.accountRecord.Name ? this.accountRecord.Name : 'Customer';
        this.caseSubject = `AML Analysis - ${accName}`;

        // Defensive Guard: Check if Flow is configured
        if (!this.flowApiNameCreateCase) {
            this.caseDescription = 'Configuration Error: No Draft Case Flow API Name provided in component properties.';
            this.isCaseLoading = false;
            return;
        }

        try {
            // 1. Generate base case description using Context Data
            const rawDesc = await generateAMLSection({ accountRecord: this.accountRecord, flowApiName: this.flowApiNameCreateCase, additionalInputs: this.gatherContextData(true) });
            let baseDesc = rawDesc.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');

            // 2. Append any user-flagged items to the bottom of the AI text
            if (this.flaggedItems.length > 0) {
                let flagText = '\n\n=== ANALYST FLAGGED CONCERNS ===\n';
                this.flaggedItems.forEach((flag, idx) => { flagText += `${idx + 1}. "${flag.text}"\n`; });
                this.caseDescription = baseDesc + flagText;
            } else {
                this.caseDescription = baseDesc;
            }
        } catch(e) {
            this.caseDescription = `Error generating description: ${e.message}. Please enter manually.`;
        }
        this.isCaseLoading = false;
    }

    handleCloseCaseModal() { this.isCaseModalOpen = false; }
    handleSubjectChange(event) { this.caseSubject = event.target.value; }
    handleDescriptionChange(event) { this.caseDescription = event.target.value; }

    async handleCreateCase() {
        this.isCaseLoading = true;
        const fields = {};
        fields[SUBJECT_FIELD.fieldApiName] = this.caseSubject;
        fields[DESCRIPTION_FIELD.fieldApiName] = this.caseDescription;
        if (this.accountRecord && this.accountRecord.Id) { fields[ACCOUNT_ID_FIELD.fieldApiName] = this.accountRecord.Id; }

        try {
            await createRecord({ apiName: CASE_OBJECT.objectApiName, fields });
            this.dispatchEvent(new ShowToastEvent({ title: 'Success', message: `Case created successfully!`, variant: 'success' }));
            this.flaggedItems = []; // Clear the case cart upon success
            this.isCaseModalOpen = false;
        } catch(error) {
            this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: error.body?.message || 'Unknown error', variant: 'error' }));
        } finally {
            this.isCaseLoading = false;
        }
    }

    handleOpenSaveModal() { this.isSaveModalOpen = true; }
    handleCloseSaveModal() { if (!this.isSaving) { this.isSaveModalOpen = false; } }

    handleSaveModeChange(event) { this._saveMode = event.detail.value; }

    _gatherSavePayload() {
        const payload = this.gatherContextData(true);
        const riskTab = this.tabs.find(t => t.id === 'risk');
        payload.inputRiskScore = riskTab && riskTab.riskScore != null ? String(riskTab.riskScore) : '';
        payload.inputAnalysisMode = this.analysisMode;
        // Individual analyst notes per tab (not grouped JSON)
        payload.inputNotesCoreSnapshot = this._analystNotes.core || '';
        payload.inputNotesRecentActivity = this._analystNotes.activity || '';
        payload.inputNotesFinancialProfile = this._analystNotes.financials || '';
        payload.inputNotesTransactions = this._analystNotes.transactions || '';
        payload.inputNotesRiskSummary = this._analystNotes.risk || '';
        payload.inputPinnedItems = JSON.stringify(this._pinnedItems);
        payload.inputFlaggedItems = JSON.stringify(this.flaggedItems);
        payload.inputSessionAuditLog = JSON.stringify(this._auditLog);
        payload.inputSaveMode = this._saveMode;
        if (this._saveMode === 'update' && this._selectedAnalyzerId) {
            payload.inputAnalyzerRecordId = this._selectedAnalyzerId;
        }

        console.log('[AML Save] Full payload keys:', Object.keys(payload).join(', '));
        console.log('[AML Save] Flagged items:', this.flaggedItems.length, '| Pinned:', this._pinnedItems.length);
        console.log('[AML Save] Save mode:', this._saveMode, '| Analyzer ID:', this._selectedAnalyzerId || 'N/A');
        return payload;
    }

    async handleConfirmSave() {
        if (!this.flowApiNameSaveProfile) {
            this.dispatchEvent(new ShowToastEvent({ title: 'Configuration Error', message: 'No Save Profile Flow configured.', variant: 'error' }));
            return;
        }
        this.isSaving = true;
        try {
            await generateAMLSection({
                accountRecord: this.accountRecord,
                flowApiName: this.flowApiNameSaveProfile,
                additionalInputs: this._gatherSavePayload()
            });
            this._logAction('save', `Analysis ${this._saveMode === 'update' ? 'updated' : 'saved as new'}`);
            this.dispatchEvent(new ShowToastEvent({ title: 'Success', message: `Analysis ${this._saveMode === 'update' ? 'updated' : 'saved'} successfully!`, variant: 'success' }));
            this.isSaveModalOpen = false;
        } catch (error) {
            this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: error.body?.message || 'Error.', variant: 'error' }));
        } finally {
            this.isSaving = false;
        }
    }
}