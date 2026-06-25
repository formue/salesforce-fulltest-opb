import { LightningElement, api, track, wire } from 'lwc';
import generateSummary      from '@salesforce/apex/MeetingSummaryController.generateSummary';
import generateMeetingTodos from '@salesforce/apex/MeetingSummaryController.generateMeetingTodos';
import regenerateMeetingSummary from '@salesforce/apex/MeetingSummaryController.regenerateMeetingSummary';
import saveMeetingNote from '@salesforce/apex/MeetingSummaryController.saveMeetingNote';
import saveTodos           from '@salesforce/apex/MeetingSummaryController.saveTodos';
import saveFileToEvent     from '@salesforce/apex/MeetingSummaryController.saveFileToEvent';
import saveWealthPlan      from '@salesforce/apex/MeetingSummaryController.saveWealthPlan';
import getMeetingNoteVersions from '@salesforce/apex/MeetingSummaryController.getMeetingNoteVersions';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';
import { FlowAttributeChangeEvent, FlowNavigationNextEvent } from 'lightning/flowSupport';
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';

import GOAL_OBJECT from '@salesforce/schema/FinServ__FinancialGoal__c';
import STATUS_FIELD from '@salesforce/schema/FinServ__FinancialGoal__c.FinServ__Status__c';
import FF_GOAL_FIELD from '@salesforce/schema/FinServ__FinancialGoal__c.FF_Goal__c';

import INCOME_OBJECT from '@salesforce/schema/FF_Income__c';
import INCOME_TYPE_FIELD from '@salesforce/schema/FF_Income__c.FF_Type__c';

import ASSET_OBJECT from '@salesforce/schema/FinServ__AssetsAndLiabilities__c';
import AL_TYPE_FIELD from '@salesforce/schema/FinServ__AssetsAndLiabilities__c.AssetorLiabilityType__c';
import ASSET_TYPE_FIELD from '@salesforce/schema/FinServ__AssetsAndLiabilities__c.FinServ__AssetsAndLiabilitiesType__c';
import ASSET_CATEGORY_FIELD from '@salesforce/schema/FinServ__AssetsAndLiabilities__c.FF_Category__c';

import MILESTONE_OBJECT from '@salesforce/schema/Household_Milestones__c';
import MILESTONE_YEAR_FIELD from '@salesforce/schema/Household_Milestones__c.Milestone_Year__c';

import OWNERSHIP_OBJECT from '@salesforce/schema/Company_Ownership__c';
import STOCK_CLASS_FIELD from '@salesforce/schema/Company_Ownership__c.Stock_Class__c';

import SUST_OBJECT from '@salesforce/schema/SustainabilityPreferences__c';
import SUST_PREF_FIELD from '@salesforce/schema/SustainabilityPreferences__c.SustainabilityPreferences__c';
import ENG_STRAT_FIELD from '@salesforce/schema/SustainabilityPreferences__c.EngagementStrategy__c';
import SUST_SHARE_FIELD from '@salesforce/schema/SustainabilityPreferences__c.SustainableInvestmentsShare__c';
import IMPACTS_FIELD from '@salesforce/schema/SustainabilityPreferences__c.ImproveNegativeImpacts__c';

// ── Section definitions matching wealthPlan modules ──────────────────────────
// type: 'text' | 'textarea' | 'number' | 'checkbox' | 'select'
// selectKey: runtime key to look up options (resolved in reviewSections getter)
const SECTIONS = [
    { key: 'goals',          label: 'Financial Goals',           icon: 'goals',       object: 'FinServ__FinancialGoal__c',
      fields: [
        { api: 'FF_Goal__c',               label: 'Goal Category',   type: 'select', selectKey: 'goalOptions',   required: true, role: 'title' },
        { api: 'FF_Custom_Goal__c',        label: 'Custom Goal',     type: 'text', role: 'subtitle',
          crossValidate(rec) {
            const goalLc = (rec.FF_Goal__c || '').toLowerCase();
            const isOther = goalLc === 'other' || goalLc === 'annet' || goalLc === 'annat';
            if (isOther && !rec.FF_Custom_Goal__c)
                return "Please fill in the Custom Goal before clicking 'Save'";
            if (rec.FF_Custom_Goal__c && !isOther)
                return "A Custom Goal can only be created if the value 'Other/Annet/Annat' is chosen from the picklist";
            return null;
          }},
        { api: 'FinServ__Description__c',  label: 'Description',     type: 'textarea', role: 'description' },
        { api: 'FinServ__Status__c',       label: 'Status',          type: 'select', selectKey: 'statusOptions', required: true, role: 'meta' },
        { api: 'FinServ__PrimaryOwner__c', label: 'Primary Owner',   type: 'select', selectKey: 'ownerOptions',  required: true, role: 'meta' },
      ]},
    { key: 'income',         label: 'Income Streams',            icon: 'income',      object: 'FF_Income__c',
      fields: [
        { api: 'Name',              label: 'Name',            type: 'text', role: 'title' },
        { api: 'FF_Type__c',        label: 'Income Type',     type: 'select', selectKey: 'incomeTypeOptions', role: 'subtitle' },
        { api: 'FF_Type_Other__c',  label: 'Custom Type',     type: 'text',
          crossValidate(rec) {
            const typeLc = (rec.FF_Type__c || '').toLowerCase();
            const isOther = typeLc === 'other' || typeLc === 'annet' || typeLc === 'annat';
            if (isOther && !rec.FF_Type_Other__c)
                return "Type (Other) must be filled if 'Other' is chosen in picklist";
            if (rec.FF_Type_Other__c && !isOther)
                return "Type 'Other' must be chosen in Picklist to register a custom Income Type";
            return null;
          }},
        { api: 'FF_Amount__c',      label: 'Amount (NOK)',    type: 'number', role: 'meta' },
        { api: 'FF_Account__c',     label: 'Account Holder',  type: 'select', selectKey: 'ownerOptions', role: 'meta' },
      ]},
    { key: 'assets',         label: 'Assets & Liabilities',     icon: 'assets',      object: 'FinServ__AssetsAndLiabilities__c',
      fields: [
        { api: 'Name',                                  label: 'Name',            type: 'text', role: 'title', maxlength: 80,
          crossValidate(rec) { return rec.Name && rec.Name.length > 80 ? 'Name must be 80 characters or less' : null; } },
        { api: 'AssetorLiabilityType__c',               label: 'Asset/Liability', type: 'select', selectKey: 'alTypeOptions', role: 'subtitle' },
        { api: 'FinServ__AssetsAndLiabilitiesType__c',  label: 'Type',            type: 'select', selectKey: 'assetTypeOptions', role: 'subtitle' },
        { api: 'FF_Category__c',                        label: 'Category',        type: 'select', selectKey: 'assetCategoryOptions' },
        { api: 'FinServ__Amount__c',                    label: 'Amount (NOK)',    type: 'number', role: 'meta' },
        { api: 'FinServ__PrimaryOwner__c',              label: 'Primary Owner',   type: 'select', selectKey: 'ownerOptions', role: 'meta' },
        { api: 'FinServ__Description__c',               label: 'Description',     type: 'textarea', role: 'description' },
      ]},
    { key: 'milestones',     label: 'Household Milestones',     icon: 'milestones',  object: 'Household_Milestones__c',
      fields: [
        { api: 'Name',                    label: 'Name',             type: 'text', role: 'title' },
        { api: 'Milestone_Year__c',       label: 'Year',             type: 'select', selectKey: 'milestoneYearOptions', role: 'meta', required: true },
        { api: 'FF_AppDescription__c',    label: 'Description',      type: 'textarea', role: 'description' },
        { api: 'FF_AdditionalAMLInfo__c', label: 'Additional Info',  type: 'textarea' },
      ]},
    { key: 'ownership',      label: 'Company Ownership',         icon: 'ownership',   object: 'Company_Ownership__c',
      fields: [
        { api: 'Company_Owned__c',      label: 'Company Owned',    type: 'select', selectKey: 'companyOptions', required: true, role: 'title' },
        { api: 'Company_Owner__c',      label: 'Owner',            type: 'select', selectKey: 'entityOptions', required: true, role: 'subtitle' },
        { api: 'Percentage_Owned__c',   label: 'Ownership %',      type: 'number', role: 'meta' },
        { api: 'Beneficial_Owner__c',   label: 'Beneficial Owner', type: 'checkbox', role: 'meta' },
        { api: 'Stock_Class__c',        label: 'Stock Class',      type: 'select', selectKey: 'stockClassOptions', role: 'meta' },
        { api: 'Comment__c',            label: 'Comment',          type: 'textarea', role: 'description' },
      ]},
    { key: 'sustainability', label: 'Sustainability Preferences', icon: 'sustainability', object: 'SustainabilityPreferences__c',
      fields: [
        { api: 'Name',                          label: 'Name',                  type: 'text', role: 'title' },
        { api: 'SustainabilityPreferences__c',  label: 'Preference',            type: 'select', selectKey: 'sustPrefOptions', role: 'subtitle' },
        { api: 'EngagementStrategy__c',         label: 'Engagement Strategy',   type: 'select', selectKey: 'sustStratOptions', role: 'meta' },
        { api: 'SustainableInvestmentsShare__c', label: 'Investments Share',    type: 'select', selectKey: 'sustShareOptions', role: 'meta' },
        { api: 'ImproveNegativeImpacts__c',     label: 'Negative Impacts',      type: 'select', selectKey: 'sustImpactOptions', role: 'meta' },
        { api: 'SpecificThemes__c',             label: 'Themes',                type: 'text', role: 'meta' },
        { api: 'AdvisorCommentPreferences__c',  label: 'Advisor Comment',       type: 'textarea', role: 'description' },
      ]},
    { key: 'greetings',      label: 'Personal Greeting',         icon: 'greetings',   object: 'FF_PersonalGreeting__c',
      fields: [
        { api: 'FF_Subject__c',             label: 'Subject',   type: 'text', role: 'title' },
        { api: 'FF_personalGreeting__c',    label: 'Greeting',  type: 'textarea', role: 'description', maxlength: 3000 },
        { api: 'FF_Active__c',              label: 'Active',    type: 'checkbox', role: 'meta' },
      ]},
    { key: 'todos',          label: 'Action Items / To-Dos',     icon: 'todos',       object: 'Task',
      fields: [
        { api: 'Subject',          label: 'Subject',       type: 'text', role: 'title' },
        { api: 'Description',      label: 'Description',   type: 'textarea', role: 'description' },
        { api: 'ActivityDate',     label: 'Due Date',       type: 'text', role: 'meta' },
        { api: 'Priority',         label: 'Priority',       type: 'select', selectKey: 'taskPriorityOptions', role: 'meta' },
        { api: 'Status',           label: 'Status',         type: 'text', role: 'meta' },
      ]},
];

// Fields that use owner options — eligible for smart propagation
const OWNER_FIELD_APIS = new Set(['FinServ__PrimaryOwner__c', 'FF_Account__c']);

// ── AI-friendly → Salesforce API name mappings per section ───────────────────
// The AI prompt may return human-readable keys; we normalize them here.
const FIELD_ALIASES = {
    goals: {
        category: 'FF_Goal__c', goal: 'FF_Goal__c', goalCategory: 'FF_Goal__c',
        customGoal: 'FF_Custom_Goal__c', custom_goal: 'FF_Custom_Goal__c', customGoalName: 'FF_Custom_Goal__c',
        description: 'FinServ__Description__c', desc: 'FinServ__Description__c',
        status: 'FinServ__Status__c',
        owner: 'FinServ__PrimaryOwner__c', primaryOwner: 'FinServ__PrimaryOwner__c',
    },
    income: {
        name: 'Name', incomeName: 'Name',
        type: 'FF_Type__c', incomeType: 'FF_Type__c',
        customType: 'FF_Type_Other__c', typeOther: 'FF_Type_Other__c',
        amount: 'FF_Amount__c',
        account: 'FF_Account__c', owner: 'FF_Account__c',
        business: 'FoundationBusiness__c',
    },
    assets: {
        name: 'Name', assetName: 'Name',
        alType: 'AssetorLiabilityType__c', assetOrLiability: 'AssetorLiabilityType__c',
        assetLiabilityType: 'AssetorLiabilityType__c', recordType: 'AssetorLiabilityType__c',
        type: 'FinServ__AssetsAndLiabilitiesType__c', subType: 'FinServ__AssetsAndLiabilitiesType__c',
        category: 'FF_Category__c',
        amount: 'FinServ__Amount__c', value: 'FinServ__Amount__c', estimatedValue: 'FinServ__Amount__c',
        owner: 'FinServ__PrimaryOwner__c', primaryOwner: 'FinServ__PrimaryOwner__c',
        description: 'FinServ__Description__c',
        business: 'FoundationBusiness__c',
    },
    milestones: {
        name: 'Name', milestoneName: 'Name', title: 'Name', event: 'Name',
        year: 'Milestone_Year__c', milestoneYear: 'Milestone_Year__c',
        description: 'FF_AppDescription__c', appDescription: 'FF_AppDescription__c',
        additionalInfo: 'FF_AdditionalAMLInfo__c', amlInfo: 'FF_AdditionalAMLInfo__c',
        details: 'FF_AppDescription__c',
    },
    ownership: {
        companyOwned: 'Company_Owned__c', ownedCompany: 'Company_Owned__c', company: 'Company_Owned__c',
        companyOwner: 'Company_Owner__c', owner: 'Company_Owner__c',
        percentage: 'Percentage_Owned__c', percentageOwned: 'Percentage_Owned__c', share: 'Percentage_Owned__c',
        beneficialOwner: 'Beneficial_Owner__c', beneficial: 'Beneficial_Owner__c',
        stockClass: 'Stock_Class__c',
        comment: 'Comment__c',
    },
    sustainability: {
        name: 'Name',
        preference: 'SustainabilityPreferences__c', sustainabilityPreference: 'SustainabilityPreferences__c',
        engagementStrategy: 'EngagementStrategy__c', strategy: 'EngagementStrategy__c',
        investmentsShare: 'SustainableInvestmentsShare__c', share: 'SustainableInvestmentsShare__c',
        negativeImpacts: 'ImproveNegativeImpacts__c', impacts: 'ImproveNegativeImpacts__c',
        themes: 'SpecificThemes__c', specificThemes: 'SpecificThemes__c',
        comment: 'AdvisorCommentPreferences__c', advisorComment: 'AdvisorCommentPreferences__c',
    },
    greetings: {
        subject: 'FF_Subject__c', title: 'FF_Subject__c',
        greeting: 'FF_personalGreeting__c', message: 'FF_personalGreeting__c', text: 'FF_personalGreeting__c',
        active: 'FF_Active__c', isActive: 'FF_Active__c',
    },
    todos: {
        subject: 'Subject', title: 'Subject', task: 'Subject', action: 'Subject',
        description: 'Description', details: 'Description', notes: 'Description',
        dueDate: 'ActivityDate', due: 'ActivityDate', date: 'ActivityDate', deadline: 'ActivityDate',
        priority: 'Priority',
        status: 'Status',
    },
};

// ── HTML → Markdown converter (DOMParser-based, browser-only) ────────────────
function _nodeToMd(node) {
    if (node.nodeType === 3) return node.textContent; // TEXT_NODE
    if (node.nodeType !== 1) return '';               // not ELEMENT_NODE
    const tag = node.tagName.toLowerCase();
    const inner = () => Array.from(node.childNodes).map(_nodeToMd).join('');
    switch (tag) {
        case 'h1': return `# ${inner()}\n\n`;
        case 'h2': return `## ${inner()}\n\n`;
        case 'h3': return `### ${inner()}\n\n`;
        case 'h4': return `#### ${inner()}\n\n`;
        case 'h5': return `##### ${inner()}\n\n`;
        case 'h6': return `###### ${inner()}\n\n`;
        case 'p':  return `${inner()}\n\n`;
        case 'br': return '\n';
        case 'strong': case 'b': return `**${inner()}**`;
        case 'em':     case 'i': return `*${inner()}*`;
        case 'code': return `\`${inner()}\``;
        case 'ul': return Array.from(node.children).map(li => `- ${_nodeToMd(li).trim()}\n`).join('') + '\n';
        case 'ol': return Array.from(node.children).map((li, i) => `${i + 1}. ${_nodeToMd(li).trim()}\n`).join('') + '\n';
        case 'li': return inner();
        case 'hr': return '---\n\n';
        case 'a':  { const h = node.getAttribute('href'); return h ? `[${inner()}](${h})` : inner(); }
        default:   return inner();
    }
}
function _htmlToMd(html) {
    if (!html) return '';
    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return _nodeToMd(doc.body).trim();
    } catch(e) {
        return html; // safe fallback if DOMParser unavailable
    }
}
function _stripStyleBlocks(html) {
    if (!html) return html;
    return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').trim();
}
function _stripHtmlToText(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

export default class AdvisorAssistant extends NavigationMixin(LightningElement) {
    // ── Inputs ───────────────────────────────────────────────────────────────
    @api recordId;
    @api flowApiName;                      // Wealth Plan structuring flow
    @api meetingSummaryFlowApiName;        // Meeting Summary flow (returns plain text/HTML summary)
    @api regenerateSummaryFlowApiName;     // Dedicated regeneration flow (inputs: currentSummary, instructions; output: generatedResponse)
    @api saveSummaryFlowApiName;           // Background save flow (inputs: noteId, noteHtml, eventId, published; output: savedNoteId)
    @api versionHistoryFlowApiName = '';  // Subflow fired on event select; input: EventId; output collection: MeetingNoteVersions
    @api createVersionFlowApiName  = '';  // Flow called when saving a new-version draft; creates MeetingNoteVersion__c + updates MeetingNote__c
    @api backgroundColor = 'linear-gradient(165deg, #f3f6fb 0%, #e6ecf7 100%)';
    @api inputTasks        = [];
    // inputMeetingNotes uses a setter so late-arriving flow data is handled explicitly
    _inputMeetingNotes = [];
    @api get inputMeetingNotes() { return this._inputMeetingNotes; }
    set inputMeetingNotes(val) {
        this._inputMeetingNotes = val || [];
    }

    // Meeting_Artifact__c records — matched to selected event via Event.MeetingArtifacts__c
    _inputArtifacts = [];
    @api get inputArtifacts() { return this._inputArtifacts; }
    set inputArtifacts(val) {
        this._inputArtifacts = val || [];
    }

    // ContentDocumentLink records — provides the join: LinkedEntityId → artifact, ContentDocumentId → file
    // Fields needed: ContentDocumentId, LinkedEntityId
    // Note: Flow Get Records cannot traverse ContentDocument.Title etc. — pass ContentDocuments separately.
    _inputContentDocumentLinks = [];
    @api get inputContentDocumentLinks() { return this._inputContentDocumentLinks; }
    set inputContentDocumentLinks(val) {
        this._inputContentDocumentLinks = val || [];
    }

    // ContentDocument records — display metadata for the linked files
    // Fields needed: Id, Title, FileType
    _inputContentDocuments = [];
    @api get inputContentDocuments() { return this._inputContentDocuments; }
    set inputContentDocuments(val) {
        this._inputContentDocuments = val || [];
    }

    // ── Reactive event loading ───────────────────────────────────────────────
    // inputEvents uses a setter so the component reacts when the flow populates it late.
    // Loading starts true automatically in connectedCallback (10 s auto-fallback).
    // The flow does NOT need to pass an inputEventsLoading flag.
    _inputEvents = [];
    _inputEventsLoading = true;   // starts true; cleared when events arrive or 10 s elapses
    _eventsLoadingTimeoutId = null;

    @api get inputEvents() { return this._inputEvents; }
    set inputEvents(val) {
        this._inputEvents = val || [];
        if (this._inputEvents.length > 0) {
            // Events arrived — immediately clear loading and cancel the fallback timer
            this._inputEventsLoading = false;
            if (this._eventsLoadingTimeoutId) {
                clearTimeout(this._eventsLoadingTimeoutId);
                this._eventsLoadingTimeoutId = null;
            }
            if (!this._eventsLoadedAt) this._eventsLoadedAt = new Date();
            this._step = 'summary';
        }
    }
    @api inputHouseholdMembers = [];
    @api inputCompanies = [];   // Account records — used as options for Company_Owned__c
    @api inputPersons   = [];   // Person/Account records — used as options for Company_Owner__c
    // Single Account record (preferred) — use .Id for owner defaulting and dropdown selection
    @api inputPrimaryMember = null;
    // Legacy: keep for backwards compatibility, but inputPrimaryMember.Id takes precedence
    @api inputPrimaryMemberId = '';

    get _resolvedPrimaryMemberId() {
        return (this.inputPrimaryMember && this.inputPrimaryMember.Id) || this.inputPrimaryMemberId || '';
    }

    // ── Existing wealth plan ─────────────────────────────────────────────────
    @api inputWealthPlanId           = '';   // Non-blank → an existing wealth plan record exists

    // ── Existing data inputs (loaded from Salesforce) ────────────────────────
    @api inputExistingGoals          = [];
    @api inputExistingIncomes        = [];
    @api inputExistingAssets         = [];
    @api inputExistingMilestones     = [];
    @api inputExistingOwnerships     = [];
    @api inputExistingSustainability = [];
    @api inputExistingGreetings      = [];

    // ── Feature toggles ──────────────────────────────────────────────────────
    // LWC @api booleans default false. We store the raw values and treat
    // "not explicitly set to false/string 'false'" as enabled.
    @api hideBetaBadge          = false;
    @api modalMode              = false;
    @api showEditTracking       = false;
    @api showExpandCollapseAll  = false;
    @api showDetailedStats      = false;
    @api showDiscardSection     = false;
    @api showRegenerateSection  = false;
    @api showScrollToError      = false;
    @api briefEnabled           = false;   // show "At a Glance" section when a brief is returned
    @api briefOpenByDefault     = false;   // start the section expanded
    @api saveTodosFlowApiName       = '';  // autolaunched flow that creates Task records from accepted action items
    @api saveFileToEventFlowApiName = '';  // autolaunched flow invoked when saving an uploaded file to the event record
    @api wealthPlanSaveFlowApiName  = '';  // autolaunched flow that handles WP DML via typed SObject record collections
    @api inputWhoId             = '';      // WhoId (Contact/Lead) to link to saved tasks — set from the parent Flow

    // Track whether parent explicitly disabled a feature (string 'false' from Flow)
    _explicitlyDisabled = {};

    get isSpeechSupported() {
        return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    }

    get micButtonClass() {
        return this._isListening 
            ? 'wph-mic-btn wph-mic-active pulse-animation' 
            : 'wph-mic-btn';
    }

    connectedCallback() {
        // If Flow passes string 'false', record it. Otherwise treat as enabled.
        ['showEditTracking','showExpandCollapseAll','showDetailedStats','showDiscardSection','showRegenerateSection','showScrollToError'].forEach(prop => {
            if (this[prop] === 'false') this._explicitlyDisabled[prop] = true;
        });

        // Always open on the summary step — tabs handle all sub-navigation.
        this._step = 'summary';
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._eventsLoadingTimeoutId = setTimeout(() => {
            this._inputEventsLoading = false;
            this._eventsLoadingTimeoutId = null;
        }, 10000);

        // Feature 5: Keyboard shortcuts
        this._boundKeyHandler = this._handleKeyDown.bind(this);
        document.addEventListener('keydown', this._boundKeyHandler);

    }

    renderedCallback() {
        // Focus the absorber when the component overlay first opens
        if (this._modalOpen && !this._prevModalOpen) {
            this._prevModalOpen = true;
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => { this.refs.focusAbsorber?.focus(); }, 0);
        } else if (!this._modalOpen) {
            this._prevModalOpen = false;
        }
        if (this._editorNeedsInit && this._summaryEditMode) {
            const el = this.refs.summaryEditor;
            if (el) {
                el.innerHTML = this._summaryEditValue || '';
                this._editorNeedsInit = false;
                el.focus();
            }
        }
        if (this._briefEditorNeedsInit && this._briefEditMode) {
            const el = this.refs.briefEditor;
            if (el) {
                el.innerHTML = this._briefEditValue || '';
                this._briefEditorNeedsInit = false;
                el.focus();
            }
        }
    }

    _on(v, prop) {
        if (prop && this._explicitlyDisabled[prop]) return false;
        if (v === 'false') return false;
        return true; // default ON — false from @api default is treated as "not set"
    }

    // ── Outputs (matching wealthPlan component patterns) ────────────────────
    @api outputSummary               = '';
    @api outputMeetingSummary        = '';
    @api outputMeetingNote           = null;   // MeetingNote__c record for update { Id, Note__c, NoteMarkdown__c } — mutually exclusive with outputMeetingNoteToCreate
    @api outputMeetingNoteToCreate   = null;   // MeetingNote__c shell for create { Note__c, NoteMarkdown__c } — populated when no existing note exists
    @api outputNoteIdToDelete        = '';     // Deprecated — retained for flow backwards compatibility; deletion handled via deleteNote flag in saveSummaryFlowApiName
    @api outputNoteMarkdown          = '';     // Markdown string derived from Note__c — for web app consumption
    @api outputMeetingType           = '';     // 'whiteboard' | 'status' | 'annual' | ''
    @api outputHasTodos              = false;  // whether To-Do's format was selected
    @api outputSelectedEventId       = '';     // Id of the selected event — used by flow to link new note to Event.MeetingNote__c
    // New/AI records for upsert
    @api outputGoals                 = [];
    @api outputIncomes               = [];
    @api outputAssets                = [];
    @api outputMilestones            = [];
    @api outputOwnerships            = [];
    @api outputSustainability        = [];
    @api outputGreetings             = [];
    @api outputTodos                 = [];
    // Modified existing records for update
    @api outputGoalsToUpdate         = [];
    @api outputIncomesToUpdate       = [];
    @api outputAssetsToUpdate        = [];
    @api outputMilestonesToUpdate    = [];
    @api outputOwnershipsToUpdate    = [];
    @api outputSustainabilityToUpdate = [];
    @api outputGreetingsToUpdate     = [];
    // Existing records marked for deletion
    @api outputGoalsToDelete         = [];
    @api outputIncomesToDelete       = [];
    @api outputAssetsToDelete        = [];
    @api outputMilestonesToDelete    = [];
    @api outputOwnershipsToDelete    = [];
    @api outputSustainabilityToDelete = [];
    @api outputGreetingsToDelete     = [];

    // ── Local state ──────────────────────────────────────────────────────────
    @track _step = 'input';         // 'input' | 'loading' | 'review'
    @track _wpGenerating = false;   // wealth plan generation in-progress (loading shown inline in right panel)
    @track _freeText = '';
    @track _stagedFile  = null;   // single file for Advanced section regeneration (unchanged)
    @track _sharedFiles = [];    // shared file pool — visible in both WP and MS upload zones
    @track _uploadFeedback = null; // { latestName, totalFiles } — shown for 3s after upload
    _uploadFeedbackTimer = null;
    @track _selectedTaskIds = {};
    @track _summary = '';
    @track _sections = [];          // parsed section data
    @track _editingRow = null;      // { sectionKey, rowIndex }
    @track _expandedSections = {};
    @track _progressValue = 0;
    @track _loadingMessage = 'Preparing context...';
    @track _lockedRows = {};        // keyed by record._id (stable across reorders)
    @track _lockedSections = {};    // { 'goals': true }
    @track _editedRows = {};        // { 'goals_0': true } — tracks manually edited AI records
    @track _meetingType = '';       // 'first' | 'status' | 'other'
    @track _allExpanded = false;
    @track _showExistingData = false;
    @track _existingLoaded = false;
    @track _savedDraftSections = null; // preserved when entering existing-view mode
    @track _deletedRows = {};
    @track _showSaveConfirm = false;
    @track _savePreview = null;     // { create: N, update: N, delete: N, sections: [...] }
    @track _guideOpen = false;
    @track _tourActive = false;
    @track _tourPromptDismissed = false;
    @track _tourStep = 0;
    @track _tourBubbleStyle = '';
    @track _tourArrowStyle = '';
    @track _tourHighlightStyle = '';
    @track _tourPosition = 'bottom';
    @track _showWpTips  = false;   // Wealth Plan writing tips panel
    @track _showMsTips  = false;   // Meeting Summary writing tips panel
    @track _modalOpen   = false;   // true when overlay is open (only relevant if modalMode=true)
    _escHandler = null;            // stored reference for ESC key cleanup

    // ── Feature 10: Undo/Redo ────────────────────────────────────────────────
    @track _undoStack = [];
    @track _redoStack = [];
    _editingFieldSnapshot = {};     // { fieldApi: originalValue } — snapshot at edit start

    // ── Feature 2: Diff View ─────────────────────────────────────────────────
    @track _existingSnapshots = {}; // { sfId: { fieldApi: originalValue } }
    @track _diffVisibleRows = {};   // { recId: true }

    // ── Feature 7: Conflict Detection ────────────────────────────────────────
    @track _duplicateFlags = {};    // { aiRecId: { matchedTitle, sectionKey } }

    // ── Feature 9: Batch Lock Modal ──────────────────────────────────────────
    @track _showBulkLockConfirm = false;
    @track _bulkLockPreview = null; // { sectionKey, sectionLabel, toLock, toSkipErrors, alreadyLocked }

    // ── Feature 12: Editable Summary ─────────────────────────────────────────
    @track _isSummaryEditing = false;
    @track _originalMeetingSummary = '';
    @track _isListening = false;
    _recognition;

    // ── Feature 5: Keyboard Shortcuts ────────────────────────────────────────
    @track _focusedRowId = null;
    @track _focusedSectionKey = null;

    // Feature mode selection — Meeting Summary is default (first and most-used)
    @track _modeWealthPlan      = false;
    @track _modeMeetingSummary  = true;
    @track _modeOther           = false;
    @track _modeExistingOnly    = false;

    // Meeting Summary left-panel accordion state
    @track _msTypeOpen      = false;  // Meeting Category — collapsed until event is selected
    @track _msInputOpen     = false;
    @track _msDocUploadOpen = false;
    @track _msNotesOpen     = false;
    @track _msRegenOpen     = false;

    // Collapsible input zones (all collapsed by default)
    @track _wpNotesExpanded   = false;
    @track _docExpanded       = false;
    @track _artifactsExpanded = false;
    @track _showEmptySections   = false;
    @track _ownerPropagationPrompt = null; // { sectionKey, fieldApi, fieldLabel, value, ownerLabel, count }
    @track _meetingSummaryResult = '';
    @track _summaryTabOpen       = false;
    @track _modalDragging        = false; // true while user drags the modal resize handle
    @track _modalHeightPx        = null;  // null = CSS default (82vh); set by user drag
    _modalDragStartY      = 0;
    _modalDragStartH      = 0;
    _editorNeedsInit      = false;  // set true when summary modal opens; cleared after innerHTML is set
    _briefEditorNeedsInit = false;  // same for brief modal
    _prevModalOpen        = false;  // tracks previous _modalOpen to detect transitions

    // ── Event selection + meeting type modal ─────────────────────────────────
    @track _selectedEventId      = null;   // Id of the selected Salesforce Event
    @track _showMeetingTypeModal = false;
    @track _selectedMeetingType  = null;   // 'whiteboard' | 'status' | 'annual'
    @track _hasTodos             = false;
    @track _eventsLoadedAt       = null;   // Date when events finished loading
    @track _msNotesExpanded      = false;
    @track _msFilesExpanded      = false;
    @track _msTodosExpanded      = false;
    @track _todosGenerating      = false;
    @track _todosSaved           = false;
    @track _todosSaving          = false;

    // ── Main tab navigation (within summary step) ────────────────────────────
    @track _activeTab           = 'summary'; // 'summary' | 'wealthplan' | 'existing'
    @track _activeMsSection     = 'meeting'; // 'meeting' | 'todos'
    @track _showPublishConfirm          = false;
    @track _showGenerateOverwriteConfirm = false;
    @track _advancedExpanded    = false;

    // ── Summary step state ───────────────────────────────────────────────────
    @track _summaryInstructions    = '';
    @track _summaryEditMode        = false;
    @track _summaryEditValue       = '';
    @track _briefEditMode          = false;
    @track _briefEditValue         = '';
    @track _regeneratingSummaryOnly = false; // kept for loadingTitle getter (wealth plan loading step)
    @track _currentNoteHtml         = null;  // regenerated HTML; null = read from original note
    @track _summarySaved            = false; // true after handleSaveSummary; reset when content changes
    @track _selectedArtifactFileIds = new Set(); // ContentDocumentIds of selected artifact files (multi-select, Artifacts zone)
    @track _includeMeetingSummary   = false; // whether to include the event's meeting summary as input to Wealth Plan generation
    @track _saveFileModal           = null;  // { index, name, documentId } when open, null when closed
    @track _sessionSavedFiles       = [];    // files saved to event this session — shown optimistically in Meeting Files
    @track _summarySaving           = false; // true while background-saving via saveSummaryFlowApiName
    @track _wpSaving                = false; // true while wealthPlanSaveFlowApiName subflow call is in flight
    @track _wpSaveNotice            = null;  // { totalNew, totalUpdated, totalDeleted } — compact banner shown after subflow save
    @track _notePublishedLocally    = false; // set to true after Save & Publish (before re-query from Salesforce)
    @track _selectionPopup          = null;  // { text, x, y } — floating "Add as Action Item" popup
    @track _publishExitPending      = false; // set by Publish & Exit — triggers exit after handlePublish succeeds
    @track _backgroundSavedNoteId   = null;  // Id of a MeetingNote__c created via background save (no existing note)
    @track _lastSavedHtml           = null;  // HTML last successfully background-saved; baseline for Revert
    @track _showDeleteNoteConfirm   = false; // true while delete confirmation modal is open
    @track _creatingNewVersion      = false; // true after handleCreateNewVersion — forces create path in _applyNoteOutputs
    @track _meetingNoteVersions     = [];    // MeetingNoteVersion__c records loaded for the selected event
    @track _showVersionHistory      = false; // version history panel open/collapsed
    @track _previewingVersionId     = null;  // Id of version being previewed; null = live note
    _savedNoteCache                 = {};    // { [eventId]: { noteId, noteHtml, published } } — persists across event switches
    _meetingTypeCache               = {};    // { [eventId]: { type, hasTodos } } — per-event meeting type
    _selectedTaskIdsCache           = {};    // { [eventId]: { [taskId]: true } } — per-event task selections
    _meetingTodosCache              = {};    // { [eventId]: todo[] } — per-event generated action items
    @track _meetingTodos            = [];    // parsed todos from JSON summary response
    @track _summaryGenerating       = false;
    @track _summaryLoadingMessage   = '';
    @track _meetingBrief            = null;  // "At a Glance" content returned by the flow
    @track _briefExpanded           = false;
    @track _briefGenerating         = false;
    @track _noteDeletedLocally      = false; // true after note deleted this session; cleared on event re-select
    @track _versionSavedLocally     = false; // true after version save; makes isNotePublished ignore selectedEventNote?.Published__c
    // _noNoteSelectedArtifactIds and _noNoteStagedFiles removed — now using shared _selectedArtifactFileIds and _sharedFiles

    // ── Picklist metadata (wired from Salesforce) ──────────────────────────
    @track _goalPicklistOptions = [];
    @track _statusPicklistOptions = [];
    @track _incomeTypePicklistOptions = [];
    @track _alTypePicklistOptions = [];
    @track _assetTypePicklistOptions = [];
    @track _assetCategoryPicklistOptions = [];
    @track _milestoneYearPicklistOptions = [];
    @track _stockClassPicklistOptions = [];
    @track _sustPrefPicklistOptions = [];
    @track _sustStratPicklistOptions = [];
    @track _sustSharePicklistOptions = [];
    @track _sustImpactPicklistOptions = [];

    @wire(getObjectInfo, { objectApiName: GOAL_OBJECT }) _goalObjectInfo;
    @wire(getObjectInfo, { objectApiName: INCOME_OBJECT }) _incomeObjectInfo;
    @wire(getObjectInfo, { objectApiName: ASSET_OBJECT }) _assetObjectInfo;
    @wire(getObjectInfo, { objectApiName: MILESTONE_OBJECT }) _milestoneObjectInfo;
    @wire(getObjectInfo, { objectApiName: OWNERSHIP_OBJECT }) _ownershipObjectInfo;
    @wire(getObjectInfo, { objectApiName: SUST_OBJECT }) _sustObjectInfo;

    // Goal picklists
    @wire(getPicklistValues, { recordTypeId: '$_goalObjectInfo.data.defaultRecordTypeId', fieldApiName: FF_GOAL_FIELD })
    wiredGoalValues({ data }) {
        if (data) { this._goalPicklistOptions = data.values.map(v => ({ label: v.label, value: v.value })); }
    }

    @wire(getPicklistValues, { recordTypeId: '$_goalObjectInfo.data.defaultRecordTypeId', fieldApiName: STATUS_FIELD })
    wiredStatusValues({ data }) {
        if (data) { this._statusPicklistOptions = data.values.map(v => ({ label: v.label, value: v.value })); }
    }

    // Income picklists
    @wire(getPicklistValues, { recordTypeId: '$_incomeObjectInfo.data.defaultRecordTypeId', fieldApiName: INCOME_TYPE_FIELD })
    wiredIncomeTypeValues({ data }) {
        if (data) { this._incomeTypePicklistOptions = data.values.map(v => ({ label: v.label, value: v.value })); }
    }

    // Asset picklists
    @wire(getPicklistValues, { recordTypeId: '$_assetObjectInfo.data.defaultRecordTypeId', fieldApiName: AL_TYPE_FIELD })
    wiredALTypeValues({ data }) {
        if (data) { this._alTypePicklistOptions = data.values.map(v => ({ label: v.label, value: v.value })); }
    }

    @wire(getPicklistValues, { recordTypeId: '$_assetObjectInfo.data.defaultRecordTypeId', fieldApiName: ASSET_TYPE_FIELD })
    wiredAssetTypeValues({ data }) {
        if (data) { this._assetTypePicklistOptions = data.values.map(v => ({ label: v.label, value: v.value })); }
    }

    @wire(getPicklistValues, { recordTypeId: '$_assetObjectInfo.data.defaultRecordTypeId', fieldApiName: ASSET_CATEGORY_FIELD })
    wiredAssetCategoryValues({ data }) {
        if (data) { this._assetCategoryPicklistOptions = data.values.map(v => ({ label: v.label, value: v.value })); }
    }

    // Milestone picklists
    @wire(getPicklistValues, { recordTypeId: '$_milestoneObjectInfo.data.defaultRecordTypeId', fieldApiName: MILESTONE_YEAR_FIELD })
    wiredMilestoneYearValues({ data }) {
        if (data) { this._milestoneYearPicklistOptions = data.values.map(v => ({ label: v.label, value: v.value })); }
    }

    // Ownership picklists
    @wire(getPicklistValues, { recordTypeId: '$_ownershipObjectInfo.data.defaultRecordTypeId', fieldApiName: STOCK_CLASS_FIELD })
    wiredStockClassValues({ data }) {
        if (data) { this._stockClassPicklistOptions = data.values.map(v => ({ label: v.label, value: v.value })); }
    }

    // Sustainability picklists (all loaded flat — no dependent filtering in helper context)
    @wire(getPicklistValues, { recordTypeId: '$_sustObjectInfo.data.defaultRecordTypeId', fieldApiName: SUST_PREF_FIELD })
    wiredSustPref({ data }) {
        if (data) { this._sustPrefPicklistOptions = data.values.map(v => ({ label: v.label, value: v.value })); }
    }

    @wire(getPicklistValues, { recordTypeId: '$_sustObjectInfo.data.defaultRecordTypeId', fieldApiName: ENG_STRAT_FIELD })
    wiredSustStrat({ data }) {
        if (data) { this._sustStratPicklistOptions = data.values.map(v => ({ label: v.label, value: v.value })); }
    }

    @wire(getPicklistValues, { recordTypeId: '$_sustObjectInfo.data.defaultRecordTypeId', fieldApiName: SUST_SHARE_FIELD })
    wiredSustShare({ data }) {
        if (data) { this._sustSharePicklistOptions = data.values.map(v => ({ label: v.label, value: v.value })); }
    }

    @wire(getPicklistValues, { recordTypeId: '$_sustObjectInfo.data.defaultRecordTypeId', fieldApiName: IMPACTS_FIELD })
    wiredSustImpact({ data }) {
        if (data) { this._sustImpactPicklistOptions = data.values.map(v => ({ label: v.label, value: v.value })); }
    }

    /** Returns a map of selectKey → options array, used by reviewSections to resolve dropdowns */
    get _selectOptionsMap() {
        return {
            goalOptions: [{ label: '-- Select Goal --', value: '' }, ...this._goalPicklistOptions],
            statusOptions: [{ label: '-- Select Status --', value: '' }, ...this._statusPicklistOptions],
            incomeTypeOptions: [{ label: '-- Select Type --', value: '' }, ...this._incomeTypePicklistOptions],
            alTypeOptions: [{ label: '-- Asset or Liability --', value: '' }, ...this._alTypePicklistOptions],
            assetTypeOptions: [{ label: '-- Select Type --', value: '' }, ...this._assetTypePicklistOptions],
            assetCategoryOptions: [{ label: '-- Select Category --', value: '' }, ...this._assetCategoryPicklistOptions],
            milestoneYearOptions: [{ label: '-- Select Year --', value: '' }, ...this._milestoneYearPicklistOptions],
            stockClassOptions: [{ label: '-- Select Class --', value: '' }, ...this._stockClassPicklistOptions],
            sustPrefOptions: [{ label: '-- Select Preference --', value: '' }, ...this._sustPrefPicklistOptions],
            sustStratOptions: [{ label: '-- Select Strategy --', value: '' }, ...this._sustStratPicklistOptions],
            sustShareOptions: [{ label: '-- Select Share --', value: '' }, ...this._sustSharePicklistOptions],
            sustImpactOptions: [{ label: '-- Select Impact --', value: '' }, ...this._sustImpactPicklistOptions],
            taskPriorityOptions: [
                { label: '-- Select Priority --', value: '' },
                { label: 'High', value: 'High' }, { label: 'Normal', value: 'Normal' }, { label: 'Low', value: 'Low' }
            ],
            ownerOptions:   this._buildOwnerOptions(),
            companyOptions: this._buildCompanyOptions(),
            entityOptions:  this._buildEntityOptions()
        };
    }

    /** Check if a value exists in a given options list */
    _isValidOption(selectKey, value) {
        if (!value) return true; // empty is always valid (user hasn't chosen)
        const opts = this._selectOptionsMap[selectKey];
        if (!opts || opts.length <= 1) return true; // picklist not loaded yet, skip validation
        return opts.some(o => o.value === value);
    }

    _buildOwnerOptions() {
        const opts = [{ label: '-- Select Owner --', value: '' }];
        const seen = new Set();
        // Always include the primary member first if provided as a record
        if (this.inputPrimaryMember && this.inputPrimaryMember.Id && this.inputPrimaryMember.Name) {
            opts.push({ label: `${this.inputPrimaryMember.Name} (Primary)`, value: this.inputPrimaryMember.Id });
            seen.add(this.inputPrimaryMember.Id);
        }
        (this.inputHouseholdMembers || []).forEach(m => {
            if (m && m.Id && !seen.has(m.Id)) {
                opts.push({ label: m.Name, value: m.Id });
                seen.add(m.Id);
            }
        });
        return opts;
    }

    /** Options for Company_Owned__c — household member accounts */
    _buildCompanyOptions() {
        const opts = [{ label: '-- Select Company --', value: '' }];
        const seen = new Set();
        if (this.inputPrimaryMember?.Id && this.inputPrimaryMember?.Name) {
            opts.push({ label: this.inputPrimaryMember.Name, value: this.inputPrimaryMember.Id });
            seen.add(this.inputPrimaryMember.Id);
        }
        (this.inputHouseholdMembers || []).forEach(m => {
            if (m?.Id && m?.Name && !seen.has(m.Id)) {
                opts.push({ label: m.Name, value: m.Id });
                seen.add(m.Id);
            }
        });
        return opts;
    }

    /** Options for Company_Owner__c — all household members (persons + companies can be owners) */
    _buildEntityOptions() {
        const opts = [{ label: '-- Select Owner --', value: '' }];
        const seen = new Set();
        if (this.inputPrimaryMember?.Id && this.inputPrimaryMember?.Name) {
            opts.push({ label: `${this.inputPrimaryMember.Name} (Primary)`, value: this.inputPrimaryMember.Id });
            seen.add(this.inputPrimaryMember.Id);
        }
        (this.inputHouseholdMembers || []).forEach(m => {
            if (m?.Id && m?.Name && !seen.has(m.Id)) {
                opts.push({ label: m.Name, value: m.Id });
                seen.add(m.Id);
            }
        });
        return opts;
    }

    _loadingInterval;
    _summaryLoadingInterval;
    _summaryLoadingPhases = [
        'Reading your documents…',
        'Analysing meeting context…',
        'Identifying key discussion points…',
        'Structuring the summary…',
        'Polishing the output…'
    ];
    _loadingPhases = [
        'Preparing context...',
        'Analyzing meeting data...',
        'Extracting wealth plan sections...',
        'Structuring financial goals...',
        'Mapping assets and income...',
        'Finalizing recommendations...'
    ];

    // ── Style / layout getters ───────────────────────────────────────────────
    get dynamicBgStyle() {
        if (this._theme === 'corporate') {
            return '--component-bg-color: linear-gradient(165deg, #f8f4ee 0%, #ede8de 100%); --component-bg-solid: #f0ebe1;';
        }
        const bg = this.backgroundColor || 'linear-gradient(165deg, #f3f6fb 0%, #e6ecf7 100%)';
        const solid = bg.startsWith('linear-gradient') || bg.startsWith('radial-gradient') ? '#edf2f9' : bg;
        return `--component-bg-color: ${bg}; --component-bg-solid: ${solid};`;
    }
    get isSummaryStep()    { return this._step === 'summary' || this._step === 'review'; }
    get isLoadingStep()    { return this._step === 'loading'; }
    get isReviewStep()     { return this._step === 'review'; }
    get showEventPicker()  { return this.isSummaryStep || this.isReviewStep || this.isLoadingStep; }
    get showBetaBadge()  { return !this.hideBetaBadge; }

    get progressBarStyle()  { return `width: ${this._progressValue}%`; }
    get formattedProgress() { return `${Math.round(this._progressValue)}%`; }

    // ── Event selection ──────────────────────────────────────────────────────
    get eventItems() {
        return (this.inputEvents || []).map(e => {
            const dateStr = e.ActivityDate || e.StartDateTime || '';
            let date = '';
            if (dateStr) {
                try { date = new Date(dateStr).toLocaleDateString('no-NO', { day: '2-digit', month: 'short', year: 'numeric' }); }
                catch (_) { date = dateStr; }
            }
            let time = '';
            if (e.StartDateTime) {
                try { time = new Date(e.StartDateTime).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' }); }
                catch (_) {}
            }
            const isSelected = e.Id === this._selectedEventId;
            return {
                id: e.Id,
                subject: e.Subject || 'Untitled Event',
                location: e.Location || '',
                date,
                time,
                isSelected,
                cardClass: isSelected ? 'wph-event-card wph-event-card-active' : 'wph-event-card',
            };
        });
    }
    get _selectedEventItem()   { return this.eventItems.find(ev => ev.isSelected); }
    get selectedEventSubject() { return this._selectedEventItem?.subject || ''; }
    get selectedEventDate()    { return this._selectedEventItem?.date || ''; }
    get selectedEventMeta() {
        const ev = this._selectedEventItem;
        if (!ev) return '';
        return ev.time ? `${ev.date} · kl. ${ev.time}` : ev.date;
    }
    get hasEvents()              { return (this.inputEvents || []).length > 0; }
    get isEventsLoading()        { return this._inputEventsLoading; }
    get hasNoEvents()            { return !this._inputEventsLoading && !this.hasEvents; }
    get eventsCountLabel() {
        const n = (this.inputEvents || []).length;
        return n === 1 ? '1 meeting found' : `${n} meetings found`;
    }
    get eventsLoadedTimeLabel() {
        if (!this._eventsLoadedAt) return '';
        return this._eventsLoadedAt.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });
    }
    get eventSelectionRequired() { return this.hasEvents && !this._selectedEventId; }
    get modeCardsDisabled()      { return this.eventSelectionRequired; }
    get inputZonesClass()        { return this.eventSelectionRequired ? 'wph-input-zones fade-in wph-zones-locked' : 'wph-input-zones fade-in'; }
    get noEventSelected()        { return !this._selectedEventId; }

    // ── Meeting note getters ─────────────────────────────────────────────────
    get selectedEventNote() {
        if (this._noteDeletedLocally) return null;
        const evt = (this._inputEvents || []).find(e => e.Id === this._selectedEventId);
        if (!evt?.MeetingNote__c) return null;
        return (this._inputMeetingNotes || []).find(n => n.Id === evt.MeetingNote__c) || null;
    }
    // True when a note record is linked to the selected event (Note__c may be empty)
    get hasSummaryForEvent() {
        if (this._noteDeletedLocally) return false;
        return !!this._selectedEventId && (!!(this.selectedEventNote) || !!this._currentNoteHtml || this._meetingNoteVersions.length > 0);
    }
    get summaryDisplayHtml() {
        if (this._previewingVersionId) {
            return this._meetingNoteVersions.find(v => v.Id === this._previewingVersionId)?.Note__c ?? null;
        }
        return this._currentNoteHtml ?? this.selectedEventNote?.Note__c ?? null;
    }
    get briefDisplayHtml() {
        if (this._previewingVersionId) return this.previewingVersion?.BriefSummary__c || null;
        return this._meetingBrief;
    }
    get sortedVersions() {
        return [...this._meetingNoteVersions]
            .sort((a, b) => (b.DateActive__c || '').localeCompare(a.DateActive__c || ''));
    }
    get hasVersionHistory()             { return this._meetingNoteVersions.length > 0; }
    get isPreviewingHistoricalVersion() { return !!this._previewingVersionId; }
    get previewingVersion()             { return this._meetingNoteVersions.find(v => v.Id === this._previewingVersionId) || null; }
    // True when content has diverged from what was last saved (or from original if never saved)
    get canRevertSummary() {
        if (!this._currentNoteHtml) return false;
        // After a background save, only allow revert if content has changed since that save
        if (this._lastSavedHtml !== null) return this._currentNoteHtml !== this._lastSavedHtml;
        return true;
    }
    // Meeting type getters — class-based so LWC re-renders reactively
    get isWhiteboardSelected() { return this._selectedMeetingType === 'whiteboard'; }
    get isStatusSelected()     { return this._selectedMeetingType === 'status'; }
    get isAnnualSelected()     { return this._selectedMeetingType === 'annual'; }
    get whiteboardBtnClass() { return `wph-ms-type-btn${this.isWhiteboardSelected ? ' wph-ms-type-btn--active' : ''}`; }
    get statusBtnClass()     { return `wph-ms-type-btn${this.isStatusSelected ? ' wph-ms-type-btn--active' : ''}`; }
    get annualBtnClass()     { return `wph-ms-type-btn${this.isAnnualSelected ? ' wph-ms-type-btn--active' : ''}`; }
    get todosBtnClass()      { return `wph-ms-type-btn wph-ms-type-btn--todo${this._hasTodos ? ' wph-ms-type-btn--active' : ''}`; }
    get actionItemsToggleClass() { return `wph-toggle-switch${this._hasTodos ? ' wph-toggle-switch--on' : ''}`; }
    get actionItemsToggleTitle() { return this._hasTodos ? "Disable To-Do's extraction" : "Enable To-Do's extraction"; }
    get hasMeetingTodos()      { return this._meetingTodos.length > 0; }
    get showTodosSection()     { return this._todosGenerating || this._meetingTodos.length > 0; }
    get acceptedTodosCount()   { return this._meetingTodos.filter(t => t._accepted).length; }
    get todosBadgeLabel()      { return `${this.acceptedTodosCount} / ${this._meetingTodos.length}`; }
    get todoPriorityCounts() {
        const high   = this._meetingTodos.filter(t => t.Priority === 'High').length;
        const normal = this._meetingTodos.filter(t => t.Priority === 'Normal' || !t.Priority).length;
        const low    = this._meetingTodos.filter(t => t.Priority === 'Low').length;
        return { high, normal, low, hasAny: (high + normal + low) > 0 };
    }
    get selectionPopupStyle() {
        if (!this._selectionPopup) return '';
        return `left:${this._selectionPopup.x}px;top:${this._selectionPopup.y}px`;
    }
    get hasSomeAccepted()      { return this._meetingTodos.some(t => t._accepted && !t._saved); }
    get saveTodosLabel()       { return this._todosSaving ? 'Saving…' : (this._todosSaved ? '✓ Saved' : "Save to-do's"); }
    get msTodosChevronClass() { return this._msTodosExpanded ? 'wph-zone-collapse-chevron wph-zone-chevron--open' : 'wph-zone-collapse-chevron'; }
    get meetingTypeLabel() {
        const labels = { whiteboard: 'Whiteboard Meeting', status: 'Status Meeting', annual: 'Annual Review' };
        return this._selectedMeetingType ? (labels[this._selectedMeetingType] || null) : null;
    }
    get meetingFormatBadges() { return this._hasTodos ? ["To-Do's"] : []; }

    // Published state — parent flow must include Published__c in its MeetingNote__c query
    get isNotePublished() {
        if (this._creatingNewVersion) return false;
        if (this._versionSavedLocally) return this._notePublishedLocally;
        return !!(this.selectedEventNote?.Published__c || this._notePublishedLocally);
    }
    get canDeleteNote()       { return !!(this._backgroundSavedNoteId || this.selectedEventNote?.Id) && !this.isNotePublished; }
    // Show the floating save bar when on the summary tab with a draft note that is not being regenerated
    get showMsSaveBar()       { return this.isSummaryTab && !this.noEventSelected && this.hasSummaryForEvent && !this.isNotePublished && !this._summaryGenerating; }
    get _saveBarBusy()        { return this._summarySaving || this._briefGenerating || this.isPreviewingHistoricalVersion; }
    // Button label for inline summary generation (no-note state)
    get summaryGenerateBtnLabel() { return this._summaryGenerating ? 'Generating…' : 'Generate Meeting Summary'; }
    // True when the selected event has a meeting summary available to use as Wealth Plan input
    get hasMeetingSummaryInput() { return !!(this._currentNoteHtml ?? this.selectedEventNote?.Note__c); }
    // Plain-text preview of the summary (first 120 chars, HTML stripped)
    get meetingSummaryPreview() {
        const html = this._currentNoteHtml ?? this.selectedEventNote?.Note__c ?? '';
        if (!html) return '';
        // Strip tags then decode HTML entities
        const stripped = html.replace(/<[^>]*>/g, ' ');
        const plain = stripped
            .replace(/&#(\d+);/g,       (_, n) => String.fromCharCode(Number(n)))
            .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
            .replace(/&[a-z]+;/gi, ' ')
            .replace(/\s+/g, ' ').trim();
        return plain.length > 120 ? plain.substring(0, 120) + '…' : plain;
    }

    // Artifact files for meeting summary checkbox list — wraps artifactFiles with isChecked/isDisabled
    get noNoteArtifactFiles() {
        const selected = this._selectedArtifactFileIds;
        const staged   = this._sharedFiles.filter(f => f.included).length;
        return (this.artifactFiles || []).map(f => {
            const isChecked  = selected.has(f.id);
            const isDisabled = !isChecked && selected.size + staged >= 3;
            return {
                ...f,
                isChecked,
                isDisabled,
                rowClass: isChecked  ? 'wph-artifact-file-row wph-artifact-file-row-selected'
                        : isDisabled ? 'wph-artifact-file-row wph-no-note-row-disabled'
                                     : 'wph-artifact-file-row'
            };
        });
    }

    // ── Shared file pool getters (used by both WP and MS zones) ─────────────
    get _totalNoNoteFileCount() {
        return this._selectedArtifactFileIds.size +
               this._sharedFiles.filter(f => f.included).length;
    }
    get noNoteCanAddFile() { return this._totalNoNoteFileCount < 3; }
    get sharedFilesCount() { return this._sharedFiles.length; }

    // Ordered list [{documentId}] — artifact selections first, then uploads
    get noNoteFilesForFlow() {
        const files = [];
        for (const id of this._selectedArtifactFileIds) {
            if (files.length >= 3) break;
            files.push({ documentId: id });
        }
        for (const f of this._sharedFiles) {
            if (!f.included) continue;
            if (files.length >= 3) break;
            files.push({ documentId: f.documentId });
        }
        return files;
    }

    // ── Main tab getters ─────────────────────────────────────────────────────
    get isSummaryTab()    { return this._activeTab === 'summary'; }
    get isWealthPlanTab() { return this._activeTab === 'wealthplan'; }
    get isExistingTab()   { return this._activeTab === 'existing'; }
    get summaryTabClass()       { return `wph-main-tab${this._activeTab === 'summary'    ? ' wph-main-tab-active' : ''}`; }
    get wealthPlanTabClass()    { return `wph-main-tab${this._activeTab === 'wealthplan' ? ' wph-main-tab-active' : ''}`; }
    get existingTabClass()      { return `wph-main-tab${this._activeTab === 'existing'   ? ' wph-main-tab-active' : ''}`; }
    get hasExistingWealthPlan() { return !!this.inputWealthPlanId; }
    get hasSavedDraft()        { return this._savedDraftSections !== null; }
    // Inline style for active tab — bypasses CSS scoping issues in Salesforce synthetic shadow DOM
    static _TAB_ACTIVE_STYLE   = 'background:#dce8f5;border-color:#1e3a5f;color:#0f2044;font-weight:700';
    static _TAB_INACTIVE_STYLE = '';
    get summaryTabStyle()    { return this._activeTab === 'summary'    ? WealthPlanHelper._TAB_ACTIVE_STYLE : WealthPlanHelper._TAB_INACTIVE_STYLE; }
    get wealthPlanTabStyle() { return this._activeTab === 'wealthplan' ? WealthPlanHelper._TAB_ACTIVE_STYLE : WealthPlanHelper._TAB_INACTIVE_STYLE; }
    get existingTabStyle()   { return this._activeTab === 'existing'   ? WealthPlanHelper._TAB_ACTIVE_STYLE : WealthPlanHelper._TAB_INACTIVE_STYLE; }
    get summaryLeftTabClass()    { return 'wph-left-tab' + (this._activeTab === 'summary' ? ' wph-left-tab--active' : ''); }
    get wealthPlanLeftTabClass() { return 'wph-left-tab' + (this._activeTab === 'wealthplan' ? ' wph-left-tab--active' : ''); }

    // ── Meeting Summary sub-section (Meeting | To-do's) ─────────────────────
    get isMeetingSection() { return this._activeMsSection === 'meeting'; }
    get isTodosSection()   { return this._activeMsSection === 'todos'; }
    get hasRegenInstructions() { return (this._summaryInstructions || '').trim().length > 0; }
    get isRegenDisabled()      { return !this.regenerateSummaryFlowApiName || !this.hasRegenInstructions; }
    static _SUBTAB_ACTIVE   = 'wph-ms-subtab wph-ms-subtab-active';
    static _SUBTAB_INACTIVE = 'wph-ms-subtab';
    get meetingSubtabClass() { return this._activeMsSection === 'meeting' ? WealthPlanHelper._SUBTAB_ACTIVE : WealthPlanHelper._SUBTAB_INACTIVE; }
    get todosSubtabClass()   { return this._activeMsSection === 'todos'   ? WealthPlanHelper._SUBTAB_ACTIVE : WealthPlanHelper._SUBTAB_INACTIVE; }

    // Advanced section collapsible
    get advancedBodyClass()    { return this._advancedExpanded ? 'wph-advanced-body' : 'wph-advanced-body wph-zone-collapse-hidden'; }
    get advancedChevronClass() { return this._advancedExpanded ? 'wph-collapse-chevron wph-chevron-open' : 'wph-collapse-chevron'; }

    // ── Meeting artifact + file getters ──────────────────────────────────────
    get selectedEventArtifact() {
        const evt = (this._inputEvents || []).find(e => e.Id === this._selectedEventId);
        if (!evt?.MeetingArtifacts__c) return null;
        return (this._inputArtifacts || []).find(a => a.Id === evt.MeetingArtifacts__c) || null;
    }
    get artifactFiles() {
        const artifact = this.selectedEventArtifact;
        const linked = artifact ? (() => {
            const docMap = {};
            (this._inputContentDocuments || []).forEach(doc => { docMap[doc.Id] = doc; });
            return (this._inputContentDocumentLinks || [])
                .filter(cdl => cdl.LinkedEntityId === artifact.Id)
                .map(cdl => {
                    const doc = docMap[cdl.ContentDocumentId] || {};
                    const ft = (doc.FileType || '').toUpperCase();
                    const selected = this._selectedArtifactFileIds.has(cdl.ContentDocumentId);
                    let iconStyle = 'color:#94a3b8;';
                    let tagClass  = 'wph-artifact-type-tag';
                    if (ft === 'PDF')                              { iconStyle = 'color:#ef4444;'; tagClass += ' wph-atype-pdf';  }
                    else if (ft === 'DOCX' || ft === 'DOC')       { iconStyle = 'color:#2563eb;'; tagClass += ' wph-atype-docx'; }
                    else if (ft === 'TXT')                         { iconStyle = 'color:#059669;'; tagClass += ' wph-atype-txt';  }
                    else if (['PNG','JPG','JPEG'].includes(ft))    { iconStyle = 'color:#7c3aed;'; tagClass += ' wph-atype-img';  }
                    return {
                        id:         cdl.ContentDocumentId,
                        title:      doc.Title || cdl.ContentDocumentId,
                        fileType:   ft,
                        isSelected: selected,
                        iconStyle,
                        tagClass,
                        rowClass:   selected
                                        ? 'wph-artifact-file-row wph-artifact-file-row-selected'
                                        : 'wph-artifact-file-row'
                    };
                });
        })() : [];
        // Append files saved to event this session so they appear immediately
        return [...linked, ...this._sessionSavedFiles];
    }
    get hasArtifactFiles()        { return this.artifactFiles.length > 0; }
    get hasArtifactForEvent()     { return !!this.selectedEventArtifact; }
    get noArtifactsOrTasks()      { return !this.hasArtifactFiles && !this.hasArtifactForEvent && !this.hasTasks && !this.hasMeetingSummaryInput; }

    get loadingTitle() {
        return this._regeneratingSummaryOnly ? 'Generating Meeting Summary…' : 'Structuring Wealth Plan Data';
    }
    handleEventSelect(event) {
        event.stopPropagation();
        const id = event.currentTarget.dataset.id;
        // Save current event's todos before switching
        if (this._selectedEventId) {
            this._meetingTodosCache = { ...this._meetingTodosCache, [this._selectedEventId]: this._meetingTodos };
        }
        // Radio-style: clicking the selected event deselects it
        this._selectedEventId    = this._selectedEventId === id ? null : id;
        this._noteDeletedLocally  = false;
        this._versionSavedLocally = false;
        // Always keep the selected event Id output current
        this.outputSelectedEventId = this._selectedEventId || '';
        this.dispatchEvent(new FlowAttributeChangeEvent('outputSelectedEventId', this.outputSelectedEventId));
        // Restore from save cache if this event was previously saved in this session,
        // otherwise reset all event-specific state
        const cached = this._savedNoteCache[this._selectedEventId];
        if (cached) {
            this._currentNoteHtml       = cached.noteHtml;
            this._lastSavedHtml         = cached.noteHtml;
            this._backgroundSavedNoteId = cached.noteId || null;
            this._notePublishedLocally  = !!cached.published;
            this._summarySaved          = true;
        } else {
            this._currentNoteHtml       = null;
            this._lastSavedHtml         = null;
            this._backgroundSavedNoteId = null;
            this._notePublishedLocally  = false;
            this._summarySaved          = false;
        }
        // Restore brief from the linked MeetingNote__c (Brief_Summary__c must be queried by the parent flow)
        this._meetingBrief  = this.selectedEventNote?.Brief_Summary__c || null;
        this._briefExpanded = !!(this.selectedEventNote?.Brief_Summary__c) &&
            (this.briefOpenByDefault === true || this.briefOpenByDefault === 'true');
        this._summaryInstructions    = '';
        this._summaryEditMode        = false;
        this._briefEditMode          = false;
        this._briefEditValue         = '';
        this._selectedArtifactFileIds = new Set();
        this._sharedFiles            = [];
        this._sessionSavedFiles      = [];
        this._selectedTaskIds        = this._selectedEventId ? (this._selectedTaskIdsCache[this._selectedEventId] || {}) : {};
        this._meetingTodos           = this._selectedEventId ? (this._meetingTodosCache[this._selectedEventId] || []) : [];
        this._advancedExpanded       = false;
        this._activeTab              = 'summary';
        // Auto-include meeting summary in Wealth Plan context if one exists for this event
        this._includeMeetingSummary  = !!this.selectedEventNote;
        // Auto-select up to 3 artifact files for the new event (shared across both tabs)
        Promise.resolve().then(() => {
            const ids = (this.artifactFiles || []).slice(0, 3).map(f => f.id);
            this._selectedArtifactFileIds = new Set(ids);
        });
        // Restore per-event meeting type — cache wins; fall back to MeetingType__c on the Event record
        const _evtForType = (this._inputEvents || []).find(e => e.Id === this._selectedEventId);
        const cachedType = this._selectedEventId ? this._meetingTypeCache[this._selectedEventId] : null;
        const _labelToKey = { 'Whiteboard Meeting': 'whiteboard', 'Status Meeting': 'status', 'Annual Review': 'annual' };
        const _typeFromEvent = _evtForType?.MeetingType__c ? (_labelToKey[_evtForType.MeetingType__c] || null) : null;
        this._selectedMeetingType = cachedType ? cachedType.type : _typeFromEvent;
        this._hasTodos            = cachedType ? cachedType.hasTodos : false;
        // Auto-open Meeting Type accordion when no type is set — draws attention to the glowing frame
        this._msTypeOpen = !this._selectedMeetingType;
        // Close the event dropdown after selection
        this._eventDropdownOpen = false;
        // Auto-collapse left panel when the selected event already has a summary
        if (this._selectedEventId && this.selectedEventNote) {
            this._leftPanelCollapsed = true;
        }
        // Auto-open MS sections that have content after the reactive data settles
        Promise.resolve().then(() => {
            this._msInputOpen     = this.noNoteArtifactFiles?.length > 0;
            this._msDocUploadOpen = this._sharedFiles?.length > 0;
            this._msNotesOpen = (this._freeText || '').trim().length > 0;
        });
        // Reset version state and load versions for the newly selected event
        this._previewingVersionId = null;
        this._showVersionHistory  = false;
        this._meetingNoteVersions = [];
        if (this._selectedEventId) {
            this._loadVersionHistory(this._selectedEventId);
        }
    }

    handleArtifactFileSelect(event) {
        const id  = event.currentTarget.dataset.id;
        const set = new Set(this._selectedArtifactFileIds);
        if (set.has(id)) {
            set.delete(id);
        } else {
            const includedUploads = this._sharedFiles.filter(f => f.included).length;
            if (set.size + includedUploads >= 3) return;
            set.add(id);
        }
        this._selectedArtifactFileIds = set;
    }

    handleToggleMeetingSummary() {
        this._includeMeetingSummary = !this._includeMeetingSummary;
    }

    // ── Shared file upload handlers (used by both WP and MS zones) ───────────
    handleSharedFileUpload(event) {
        const uploaded = event.detail.files || [];
        const before   = this._sharedFiles.length;
        const newFiles = [...this._sharedFiles];
        for (const file of uploaded) {
            if (this._selectedArtifactFileIds.size + newFiles.length >= 3) break;
            if (!file || !file.name) continue;
            const ext = (file.name.split('.').pop() || '').toLowerCase();
            if (ext === 'txt' && newFiles.some(f => f.extension === 'txt')) {
                this._showToast('File Limit', 'Only one text document is allowed.', 'warning');
                continue;
            }
            let iconStyle = 'background: #f1f5f9; color: #64748b;';
            if (ext === 'pdf')                           iconStyle = 'background: #fee2e2; color: #ef4444;';
            else if (ext === 'txt')                      iconStyle = 'background: #d1fae5; color: #059669;';
            else if (['png','jpg','jpeg'].includes(ext)) iconStyle = 'background: #ede9fe; color: #7c3aed;';
            newFiles.push({ name: file.name, documentId: file.documentId, extension: ext, iconStyle, savedToEvent: false, included: true });
        }
        this._sharedFiles = newFiles;
        if (newFiles.length > before) {
            this._triggerUploadFeedback(newFiles);
        }
    }

    handleSharedFileIncludeToggle(event) {
        const idx = parseInt(event.currentTarget.dataset.index, 10);
        this._sharedFiles = this._sharedFiles.map((f, i) => {
            if (i !== idx) return f;
            if (!f.included) {
                const total = this._selectedArtifactFileIds.size + this._sharedFiles.filter(f2 => f2.included).length;
                if (total >= 3) return f;
            }
            return { ...f, included: !f.included };
        });
    }

    _triggerUploadFeedback(files) {
        if (this._uploadFeedbackTimer) clearTimeout(this._uploadFeedbackTimer);
        const latest = files[files.length - 1];
        this._uploadFeedback = {
            latestName: latest.name,
            totalFiles: this._selectedArtifactFileIds.size + files.length
        };
        this._uploadFeedbackTimer = setTimeout(() => {
            this._uploadFeedback = null;
            this._uploadFeedbackTimer = null;
        }, 3000);
    }

    handleRemoveSharedFile(event) {
        event.stopPropagation();
        const idx = parseInt(event.currentTarget.dataset.index, 10);
        this._sharedFiles = this._sharedFiles.filter((_, i) => i !== idx);
    }

    handleSaveToEventClick(event) {
        event.stopPropagation();
        const idx = parseInt(event.currentTarget.dataset.index, 10);
        const f = this._sharedFiles[idx];
        if (!f || f.savedToEvent) return;
        this._saveFileModal = { index: idx, name: f.name, documentId: f.documentId };
    }

    async handleConfirmSaveToEvent() {
        const { index, name, documentId } = this._saveFileModal;
        this._saveFileModal = null;
        try {
            await saveFileToEvent({
                flowApiName:       this.saveFileToEventFlowApiName,
                contentDocumentId: documentId,
                eventId:           this._selectedEventId
            });
            this._sharedFiles = this._sharedFiles.filter((_, i) => i !== index);
            const ext = (name.split('.').pop() || '').toUpperCase();
            this._sessionSavedFiles = [...this._sessionSavedFiles, {
                id: documentId, title: name, fileType: ext,
                isSelected: false, rowClass: 'wph-artifact-file-row'
            }];
            this._showToast('File Saved', `${name} has been saved to the event.`, 'success');
        } catch (e) {
            this._showToast('Save Failed', e.body?.message || 'Could not save the file.', 'error');
        }
    }

    handleCancelSaveToEvent() { this._saveFileModal = null; }

    // ── Summary step handlers ────────────────────────────────────────────────
    handleSummaryInstructionsInput(event) {
        this._summaryInstructions = event.target.value;
    }

    async handleRegenerateSummary() {
        if (!this.regenerateSummaryFlowApiName) {
            this._showToast('Configuration Error', 'Regenerate Summary Flow API Name is not set.', 'error');
            return;
        }
        this._summaryGenerating = true;
        this._startSummaryLoadingCycle();
        try {
            const result = await regenerateMeetingSummary({
                flowApiName:    this.regenerateSummaryFlowApiName,
                currentSummary: this.summaryDisplayHtml || '',
                instructions:   this._summaryInstructions || '',
                documentId:     [...this._selectedArtifactFileIds][0] || (this._stagedFile ? this._stagedFile.documentId : '') || ''
            });
            this._currentNoteHtml    = _stripStyleBlocks(result);
            this._noteDeletedLocally = false;
            this.outputMeetingSummary = this._currentNoteHtml;
            this.dispatchEvent(new FlowAttributeChangeEvent('outputMeetingSummary', this._currentNoteHtml));
            this._summaryInstructions = '';
            this._summarySaved        = false;
        } catch (error) {
            const msg = error.body ? error.body.message : error.message;
            this._showToast('Regeneration Failed', msg, 'error');
        } finally {
            this._stopSummaryLoadingCycle();
            this._summaryGenerating = false;
        }
    }

    handleEditSummaryDirect() {
        this._summaryEditValue = this.summaryDisplayHtml || '';
        this._summaryEditMode  = true;
        this._editorNeedsInit  = true;
    }

    handleEditorInput(event) {
        this._summaryEditValue = event.currentTarget.innerHTML;
    }

    handleBriefEditorInput(event) {
        this._briefEditValue = event.currentTarget.innerHTML;
    }

    handleEditorKeyDown(event) {
        event.stopPropagation();
    }

    handleEditorPaste(event) {
        event.preventDefault();
        const html = (event.clipboardData || window.clipboardData).getData('text/html');
        const text = (event.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertHTML', false, html || text);
    }

    handleSaveSummaryEdit() {
        this._modalHeightPx      = null;
        this._noteDeletedLocally = false;
        this._currentNoteHtml    = this._summaryEditValue;
        this.outputMeetingSummary = this._currentNoteHtml;
        this.dispatchEvent(new FlowAttributeChangeEvent('outputMeetingSummary', this._currentNoteHtml));
        this._summaryEditMode = false;
        this._summarySaved    = false;
        this.handleSaveSummary();
    }

    handleCancelSummaryEdit() {
        this._modalHeightPx    = null;
        this._summaryEditMode  = false;
        this._summaryEditValue = '';
        this._editorNeedsInit  = false;
    }

    get _modalCardStyle() {
        return this._modalHeightPx ? `height:${this._modalHeightPx}px;` : '';
    }

    handleModalDragStart(event) {
        event.preventDefault();
        const card = this.template.querySelector('.wph-edit-modal-card');
        this._modalDragStartH = card ? card.offsetHeight : Math.round(window.innerHeight * 0.82);
        this._modalDragStartY = event.clientY;
        this._modalDragging   = true;
    }

    handleModalResizeDrag(event) {
        if (!this._modalDragging) return;
        const delta = event.clientY - this._modalDragStartY;
        const minH  = 300;
        const maxH  = window.innerHeight - 60;
        this._modalHeightPx = Math.min(maxH, Math.max(minH, this._modalDragStartH + delta));
    }

    handleModalResizeDragEnd() {
        this._modalDragging = false;
    }

    handleRevertSummary() {
        this._summaryEditMode = false;
        if (this._lastSavedHtml !== null) {
            // Revert to the last background-saved version
            this._currentNoteHtml = this._lastSavedHtml;
            this._summarySaved    = true;  // back to a saved state
        } else {
            // No background save yet — revert to original from inputMeetingNotes
            this._currentNoteHtml = null;
            this._summarySaved    = false;
        }
        const html = this.summaryDisplayHtml || '';
        this.outputMeetingSummary = html;
        this.dispatchEvent(new FlowAttributeChangeEvent('outputMeetingSummary', html));
    }

    // ── Private helper: record a successful background save in local state ───
    _recordSaveSuccess(html, noteId, published) {
        this._lastSavedHtml          = html;
        this._currentNoteHtml        = html;   // keep display in sync with saved state
        this._summarySaved           = true;
        this._noteDeletedLocally     = false;  // a saved note exists again; re-enable normal getters
        if (noteId) this._backgroundSavedNoteId = noteId;
        if (published) this._notePublishedLocally = true;
        // Persist in cache so switching events and returning shows the saved content
        this._savedNoteCache = {
            ...this._savedNoteCache,
            [this._selectedEventId]: {
                noteId:    noteId || this.selectedEventNote?.Id || this._backgroundSavedNoteId,
                noteHtml:  html,
                published: !!published
            }
        };
    }

    // ── Private helper: push note data into flow output attributes ───────────
    _applyNoteOutputs(html, publishedFlag) {
        this.outputMeetingSummary = html;
        this.dispatchEvent(new FlowAttributeChangeEvent('outputMeetingSummary', html));
        const md = _htmlToMd(html);
        this.outputNoteMarkdown = md;
        this.dispatchEvent(new FlowAttributeChangeEvent('outputNoteMarkdown', md));
        const noteId = (this._creatingNewVersion && this.createVersionFlowApiName)
            ? (this.selectedEventNote?.Id || this._backgroundSavedNoteId || null)
            : (this._creatingNewVersion ? null : (this.selectedEventNote?.Id || this._backgroundSavedNoteId || null));
        if (noteId) {
            const updated = { Id: noteId, Note__c: html, NoteMarkdown__c: md, ...(publishedFlag ? { Published__c: true } : {}) };
            this.outputMeetingNote = updated;
            this.dispatchEvent(new FlowAttributeChangeEvent('outputMeetingNote', updated));
            this.outputMeetingNoteToCreate = null;
            this.dispatchEvent(new FlowAttributeChangeEvent('outputMeetingNoteToCreate', null));
        } else {
            const newNote = { Note__c: html, NoteMarkdown__c: md, ...(publishedFlag ? { Published__c: true } : {}) };
            this.outputMeetingNoteToCreate = newNote;
            this.dispatchEvent(new FlowAttributeChangeEvent('outputMeetingNoteToCreate', newNote));
            this.outputMeetingNote = null;
            this.dispatchEvent(new FlowAttributeChangeEvent('outputMeetingNote', null));
        }
        this.dispatchEvent(new FlowAttributeChangeEvent('outputSelectedEventId', this._selectedEventId || ''));
    }

    // Save & Review — persists draft in background, stays in modal
    async handleSaveSummary() {
        const html = this.summaryDisplayHtml || '';
        this._applyNoteOutputs(html, false);
        // New-version draft: route to dedicated version flow
        if (this._creatingNewVersion && this.createVersionFlowApiName) {
            this._summarySaving = true;
            try {
                const savedId = await saveMeetingNote({
                    flowApiName:   this.createVersionFlowApiName,
                    noteId:        this.selectedEventNote?.Id || this._backgroundSavedNoteId || '',
                    noteHtml:      html,
                    noteMarkdown:  _htmlToMd(html),
                    briefHtml:     this._meetingBrief     || '',
                    briefMarkdown: _htmlToMd(this._meetingBrief || ''),
                    eventId:       this._selectedEventId  || '',
                    published:     false,
                    meetingType:   this.meetingTypeLabel || '',
                    deleteNote:    false
                });
                this._creatingNewVersion  = false;
                this._versionSavedLocally = true;
                this._recordSaveSuccess(html, savedId, false);
                this._loadVersionHistory(this._selectedEventId);
            } catch (e) {
                const msg = e.body ? e.body.message : e.message;
                this._showToast('Save Failed', msg, 'error');
            } finally {
                this._summarySaving = false;
            }
            return;
        }
        // Standard save path
        if (!this.saveSummaryFlowApiName) {
            this._recordSaveSuccess(html, null, false);
            return;
        }
        this._summarySaving = true;
        try {
            const savedId = await saveMeetingNote({
                flowApiName:   this.saveSummaryFlowApiName,
                noteId:        this.selectedEventNote?.Id || this._backgroundSavedNoteId || '',
                noteHtml:      html,
                noteMarkdown:  _htmlToMd(html),
                briefHtml:     this._meetingBrief     || '',
                briefMarkdown: _htmlToMd(this._meetingBrief || ''),
                eventId:       this._selectedEventId  || '',
                published:     false,
                meetingType:   this.meetingTypeLabel || '',
                deleteNote:    false
            });
            this._recordSaveSuccess(html, savedId, false);
        } catch (e) {
            const msg = e.body ? e.body.message : e.message;
            this._showToast('Save Failed', msg, 'error');
        } finally {
            this._summarySaving = false;
        }
    }

    // Save & Exit — background save then navigate out / close modal
    async handleSaveAndExit() {
        await this.handleSaveSummary();
        if (this.modalMode) {
            this.handleCloseModal();
        }
        try { this.dispatchEvent(new FlowNavigationNextEvent()); } catch (e) { /* not in a flow */ }
    }

    handleMainTabSwitch(event) {
        const tab = event.currentTarget.dataset.tab;
        if (tab === 'existing') {
            if (!this.hasExistingData) {
                this._showToast('No Existing Data', 'There is no existing Wealth Plan data to load.', 'warning');
                return;
            }
            // Preserve any generated draft before overwriting sections
            if (!this._modeExistingOnly && this._step === 'review') {
                this._savedDraftSections = this._sections;
            }
            this._activeTab        = 'existing';
            this._modeExistingOnly = true;
            this._sections = this._buildEmptySections();
            this._mergeExistingData();
            this._existingLoaded   = true;
            this._showExistingData = true;
            this._summaryTabOpen   = false;
            const expanded = {};
            this._sections.forEach(s => { if (s.hasRecords) expanded[s.key] = true; });
            this._expandedSections = expanded;
            this._step = 'review';
            return;
        }
        this._activeTab = tab;
        if (tab === 'summary') this._activeMsSection = 'meeting';
        if (tab === 'wealthplan' && this._savedDraftSections) {
            // Restore draft and return to review step
            this._sections = this._savedDraftSections;
            this._modeExistingOnly = false;
            this._step = 'review';
        } else if (this.isReviewStep) {
            // Preserve the generated plan so it can be restored when switching back
            if (!this._modeExistingOnly) this._savedDraftSections = this._sections;
            this._modeExistingOnly = false;
            this._step = 'summary';
        }
    }

    handleDismissDraft() {
        this._savedDraftSections = null;
    }

    handleMsSubtabSwitch(event) {
        const section = event.currentTarget.dataset.section;
        this._activeMsSection = section;
        if (section === 'todos') this._hasTodos = true;
    }

    handleToggleAdvanced()     { this._advancedExpanded = !this._advancedExpanded; }
    handleShowPublishConfirm() { this._showPublishConfirm = true; }
    handleCancelPublish()      { this._showPublishConfirm = false; this._publishExitPending = false; }
    handlePublishAndExit()     { this._publishExitPending = true; this._showPublishConfirm = true; }

    // Save & Publish — persists with Published__c:true in background, stays in modal
    async handlePublish() {
        const html = this.summaryDisplayHtml || '';
        this._applyNoteOutputs(html, true);
        this._showPublishConfirm = false;
        // New-version draft: route to dedicated version flow
        if (this._creatingNewVersion && this.createVersionFlowApiName) {
            this._summarySaving = true;
            try {
                const savedId = await saveMeetingNote({
                    flowApiName:   this.createVersionFlowApiName,
                    noteId:        this.selectedEventNote?.Id || this._backgroundSavedNoteId || '',
                    noteHtml:      html,
                    noteMarkdown:  _htmlToMd(html),
                    briefHtml:     this._meetingBrief     || '',
                    briefMarkdown: _htmlToMd(this._meetingBrief || ''),
                    eventId:       this._selectedEventId  || '',
                    published:     true,
                    meetingType:   this.meetingTypeLabel || '',
                    deleteNote:    false
                });
                this._creatingNewVersion  = false;
                this._versionSavedLocally = true;
                this._recordSaveSuccess(html, savedId, true);
                this._loadVersionHistory(this._selectedEventId);
                this._doExitIfPending();
            } catch (e) {
                this._publishExitPending = false;
                const msg = e.body ? e.body.message : e.message;
                this._showToast('Publish Failed', msg, 'error');
            } finally {
                this._summarySaving = false;
            }
            return;
        }
        // Standard publish path
        if (!this.saveSummaryFlowApiName) {
            this._recordSaveSuccess(html, null, true);
            this._doExitIfPending();
            return;
        }
        this._summarySaving = true;
        try {
            const savedId = await saveMeetingNote({
                flowApiName:   this.saveSummaryFlowApiName,
                noteId:        this.selectedEventNote?.Id || this._backgroundSavedNoteId || '',
                noteHtml:      html,
                noteMarkdown:  _htmlToMd(html),
                briefHtml:     this._meetingBrief     || '',
                briefMarkdown: _htmlToMd(this._meetingBrief || ''),
                eventId:       this._selectedEventId  || '',
                published:     true,
                meetingType:   this.meetingTypeLabel || '',
                deleteNote:    false
            });
            this._recordSaveSuccess(html, savedId, true);
            this._doExitIfPending();
        } catch (e) {
            this._publishExitPending = false;
            const msg = e.body ? e.body.message : e.message;
            this._showToast('Publish Failed', msg, 'error');
        } finally {
            this._summarySaving = false;
        }
    }

    _doExitIfPending() {
        if (!this._publishExitPending) return;
        this._publishExitPending = false;
        if (this.modalMode) this.handleCloseModal();
        try { this.dispatchEvent(new FlowNavigationNextEvent()); } catch(e) { /* not in a flow */ }
    }

    // ── Delete meeting note ──────────────────────────────────────────────────
    handleShowDeleteNoteConfirm() { this._showDeleteNoteConfirm = true; }
    handleCancelDeleteNote()      { this._showDeleteNoteConfirm = false; }
    async handleConfirmDeleteNote() {
        const noteId = this._backgroundSavedNoteId || this.selectedEventNote?.Id;
        if (!noteId) return;
        this._showDeleteNoteConfirm = false;
        if (this.saveSummaryFlowApiName) {
            this._summarySaving = true;
            try {
                await saveMeetingNote({
                    flowApiName:   this.saveSummaryFlowApiName,
                    noteId:        noteId,
                    noteHtml:      '',
                    noteMarkdown:  '',
                    briefHtml:     '',
                    briefMarkdown: '',
                    eventId:       this._selectedEventId || '',
                    published:     false,
                    meetingType:   '',
                    deleteNote:    true
                });
            } catch (e) {
                const msg = e.body ? e.body.message : e.message;
                this._showToast('Delete Failed', msg, 'error');
                return;
            } finally {
                this._summarySaving = false;
            }
        }
        this._currentNoteHtml       = null;
        this._summarySaved          = false;
        this._backgroundSavedNoteId = null;
        this._lastSavedHtml         = null;
        this._noteDeletedLocally    = true;
        this._meetingBrief          = null;
        this._briefEditMode         = false;
        this._briefEditValue        = '';
        this._briefExpanded         = false;
        this._summaryEditMode       = false;
        this._summaryEditValue      = '';
        this._showToast('Meeting Note Deleted', 'The meeting note has been deleted.', 'success');
    }

    // ── Create new version of a published note ───────────────────────────────
    handleCreateNewVersion() {
        this._currentNoteHtml  = null;
        this._lastSavedHtml    = null;
        this._meetingBrief     = null;
        this._briefEditMode    = false;
        this._briefEditValue   = '';
        this._briefExpanded    = false;
        this._summaryEditMode  = false;
        this._summaryEditValue = '';
        this._creatingNewVersion   = true;
        this._notePublishedLocally = false;
        this._summarySaved         = false;
    }

    // ── Version history ──────────────────────────────────────────────────────
    async _loadVersionHistory(eventId) {
        if (!this.versionHistoryFlowApiName || !eventId) return;
        try {
            const versions = await getMeetingNoteVersions({
                flowApiName: this.versionHistoryFlowApiName,
                eventId
            });
            this._meetingNoteVersions = versions || [];
        } catch (e) {
            this._meetingNoteVersions = [];
        }
    }
    handleToggleVersionHistory() { this._showVersionHistory = !this._showVersionHistory; }
    handlePreviewVersion(evt)    { this._previewingVersionId = evt.currentTarget.dataset.id; }
    handleExitVersionPreview()   { this._previewingVersionId = null; }

    handleGenerateSummaryWithConfirm() { this._showGenerateOverwriteConfirm = true; }
    async handleConfirmGenerateOverwrite() {
        this._showGenerateOverwriteConfirm = false;
        await this.handleGenerateSummaryDirect();
    }
    handleCancelGenerateOverwrite() { this._showGenerateOverwriteConfirm = false; }

    // Inline summary generation when no MeetingNote__c exists for the selected event
    async handleGenerateSummaryDirect() {
        if (!this.meetingSummaryFlowApiName) {
            this._showToast('Configuration Error', 'Meeting Summary Flow API Name is not set.', 'error');
            return;
        }
        this._summaryGenerating = true;
        this._leftPanelCollapsed = true;
        this._startSummaryLoadingCycle();
        try {
            const files = this.noNoteFilesForFlow;
            const typeLabel = { whiteboard: 'Whiteboard Meeting', status: 'Status Meeting', annual: 'Annual Review' };
            let ctx = this._freeText || '';
            if (this._selectedMeetingType)
                ctx += (ctx ? '\n\n' : '') + `Meeting Category: ${typeLabel[this._selectedMeetingType]}`;
            if (this._hasTodos)
                ctx += '\nInclude: To-Do\'s';
            const flowParams = {
                flowApiName:        this.meetingSummaryFlowApiName,
                eventId:            this._selectedEventId           || '',
                accountId:          this._resolvedPrimaryMemberId   || '',
                documentId1:        files[0]?.documentId            || '',
                documentId2:        files[1]?.documentId            || '',
                documentId3:        files[2]?.documentId            || '',
                additionalContext:  ctx,
                meetingType:        this._selectedMeetingType       || '',
                hasTodos:           this._hasTodos,
                saveDoc1AsArtifact: false,
                saveDoc2AsArtifact: false,
                saveDoc3AsArtifact: false
            };
            const raw = await generateSummary(flowParams);
            // If the flow still returns both summary+brief as JSON, split them out;
            // otherwise treat the whole string as plain summary HTML.
            let summaryHtml = raw || '';
            let embeddedBrief = null;
            try {
                const parsed = JSON.parse(raw);
                if (parsed?.summary) {
                    summaryHtml    = parsed.summary;
                    embeddedBrief  = parsed.brief || null;
                }
            } catch (_) { /* plain string — no-op */ }
            this._currentNoteHtml    = _stripStyleBlocks(summaryHtml);
            this._noteDeletedLocally = false;  // new summary generated — note exists again
            this._meetingBrief       = null;
            this._briefExpanded      = false;
            this._meetingTodos       = [];
            this._panelEqualOverride = false;
            this.outputMeetingSummary = this._currentNoteHtml;
            this.dispatchEvent(new FlowAttributeChangeEvent('outputMeetingSummary', this._currentNoteHtml));
            this._summarySaved = false;
            // Fire brief and todos as separate async calls so summary is visible immediately
            if (this.briefEnabled === true || this.briefEnabled === 'true') {
                if (embeddedBrief) {
                    // Flow returned brief alongside summary (pre-split flow) — use it directly
                    this._meetingBrief  = embeddedBrief;
                    this._briefExpanded = true;
                } else {
                    this._generateBrief(flowParams, this._currentNoteHtml);
                }
            }
            if (this._hasTodos) {
                this._generateTodos(flowParams);
            }
        } catch (error) {
            const msg = error.body ? error.body.message : error.message;
            this._showToast('Generation Failed', msg, 'error');
        } finally {
            this._stopSummaryLoadingCycle();
            this._summaryGenerating = false;
        }
    }

    async _generateTodos(flowParams) {
        this._todosGenerating = true;
        this._msTodosExpanded = false;
        try {
            const raw = await generateMeetingTodos({
                flowApiName:       flowParams.flowApiName,
                eventId:           flowParams.eventId,
                accountId:         flowParams.accountId,
                documentId1:       flowParams.documentId1,
                documentId2:       flowParams.documentId2,
                documentId3:       flowParams.documentId3,
                meetingType:       flowParams.meetingType,
                hasTodos:          flowParams.hasTodos,
                additionalContext: flowParams.additionalContext
            });
            let parsed = [];
            try {
                let toParse = (raw || '').trim();
                if (toParse.startsWith('```')) {
                    toParse = toParse.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
                }
                const result = JSON.parse(toParse);
                parsed = Array.isArray(result) ? result : (Array.isArray(result?.todos) ? result.todos : []);
            } catch (e) { /* malformed — leave empty */ }
            const normalize = t => ({
                Subject:      t.Subject      || t.subject      || '',
                Description:  t.Description  || t.description  || '',
                ActivityDate: t.ActivityDate || t.dueDate       || t.due_date    || '',
                Priority:     t.Priority     || t.priority      || '',
                Status:       t.Status       || t.status        || 'Not Started',
            });
            const todos = Array.isArray(parsed)
                ? parsed.map((t, i) => {
                    const n = normalize(t);
                    return {
                        ...n,
                        _key:      `todo-${i}`,
                        _accepted: false,
                        _rowClass: 'wph-record-row',
                        _hasMeta:  !!(n.Priority || n.ActivityDate || n.IsPublic__c)
                    };
                })
                : [];
            this._meetingTodos    = todos;
            this._msTodosExpanded = todos.length > 0;
        } catch (error) {
            const msg = error.body ? error.body.message : error.message;
            this._showToast("To-Do's Failed", msg, 'error');
        } finally {
            this._todosGenerating = false;
        }
    }

    async _generateBrief(flowParams, currentSummary) {
        this._briefGenerating = true;
        try {
            const brief = await generateSummary({
                flowApiName:    flowParams.flowApiName,
                eventId:        flowParams.eventId        || '',
                accountId:      flowParams.accountId      || '',
                currentSummary: currentSummary            || ''
            });
            this._meetingBrief  = brief || null;
            this._briefExpanded = !!brief;
        } catch (e) {
            const msg = e?.body?.message || e?.message || 'Unknown error';
            this._showToast('Brief Generation Failed', msg, 'error');
            this._meetingBrief = null;
        } finally {
            this._briefGenerating = false;
        }
    }

    // ── Task selection ───────────────────────────────────────────────────────
    get taskItems() {
        return (this.inputTasks || []).map(t => ({
            id: t.Id,
            subject: t.Subject || 'Untitled Task',
            status: t.Status || '',
            dueDate: t.ActivityDate || '',
            isSelected: !!this._selectedTaskIds[t.Id],
            rowClass: this._selectedTaskIds[t.Id] ? 'wph-task-row selected' : 'wph-task-row'
        }));
    }
    get hasTasks()         { return this.taskItems.length > 0; }
    get selectedTaskCount(){ return Object.keys(this._selectedTaskIds).length; }

    handleTaskToggle(event) {
        const taskId = event.currentTarget.dataset.id;
        const updated = { ...this._selectedTaskIds };
        if (updated[taskId]) { delete updated[taskId]; }
        else { updated[taskId] = true; }
        this._selectedTaskIds = updated;
        if (this._selectedEventId) {
            this._selectedTaskIdsCache = { ...this._selectedTaskIdsCache, [this._selectedEventId]: updated };
        }
    }

    // ── File handling ────────────────────────────────────────────────────────
    get acceptedFormats() { return ['.pdf', '.png', '.jpg', '.jpeg', '.txt']; }
    get hasFile()        { return this._sharedFiles.length > 0; }
    get canAddDocFile()  { return this.noNoteCanAddFile; }

    // Advanced section regeneration — single file (unchanged)
    handleUploadFinished(event) {
        const files = event.detail.files;
        const file = (files && files.length > 0) ? files[0] : null;
        if (file) {
            this._stagedFile = {
                name: file.name || '',
                documentId: file.documentId,
                extension: ((file.name || '').split('.').pop() || '').toLowerCase()
            };
        }
    }

    handleRemoveFile() { this._stagedFile = null; }
    handleTextChange(event) { this._freeText = event.target.value; }

    handleToggleWpTips() { this._showWpTips = !this._showWpTips; }
    handleToggleMsTips() { this._showMsTips = !this._showMsTips; }

    handleWpTemplate() {
        this._freeText = 'Goals:\n- \n\nAssets:\n- \n\nIncome:\n- \n\nDebts:\n- \n\nImportant:\n- \n\nAction Items:\n- ';
        this._showWpTips = false;
    }

    handleMsTemplate() {
        this._freeText = 'Topics Discussed:\n- \n\nKey Decisions:\n- \n\nAction Items:\n- \n\nImportant:\n- ';
        this._showMsTips = false;
    }

    handleToggleMicrophone() {
        if (this._isListening) {
            this._recognition?.stop();
            this._isListening = false;
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this._showToast('Not Supported', 'Speech recognition is not supported in this browser.', 'error');
            return;
        }

        this._recognition = new SpeechRecognition();
        this._recognition.continuous = true;
        this._recognition.interimResults = true;

        this._recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            // Append to existing text
            this._freeText = (this._freeText + ' ' + finalTranscript).trim();
        };

        this._recognition.onerror = () => { this._isListening = false; };
        this._recognition.onend = () => { this._isListening = false; };

        this._recognition.start();
        this._isListening = true;
    }

    handleToggleMsType()      { this._msTypeOpen      = !this._msTypeOpen; }
    handleToggleMsInput()     { this._msInputOpen     = !this._msInputOpen; }
    handleToggleMsDocUpload() { this._msDocUploadOpen = !this._msDocUploadOpen; }
    handleToggleMsNotes()     { this._msNotesOpen     = !this._msNotesOpen; }
    handleToggleMsRegen()     { this._msRegenOpen     = !this._msRegenOpen; }

    handlePreviewFile(event) {
        event.stopPropagation();
        const documentId = event.currentTarget.dataset.documentId;
        this[NavigationMixin.Navigate]({
            type: 'standard__namedPage',
            attributes: { pageName: 'filePreview' },
            state: { recordIds: documentId, selectedRecordId: documentId }
        });
    }

    get sharedFilesWithClasses() {
        return this._sharedFiles.map(f => ({
            ...f,
            rowClass: f.included
                ? 'wph-shared-file-row wph-shared-file-row-selected'
                : 'wph-shared-file-row',
        }));
    }

    get canSaveToEvent() {
        return !!(this.saveFileToEventFlowApiName && this._selectedEventId);
    }

    handleToggleWpNotes()   { this._wpNotesExpanded   = !this._wpNotesExpanded; }
    handleToggleDoc()       { this._docExpanded       = !this._docExpanded; }
    handleToggleArtifacts() { this._artifactsExpanded = !this._artifactsExpanded; }

    handleWpBadgeClick(event) {
        const section = event.currentTarget.dataset.section;
        const toNotes     = section === 'notes';
        const toDoc       = section === 'doc';
        const toArtifacts = section === 'artifacts' || section === 'summary';
        this._wpNotesExpanded   = toNotes     ? !this._wpNotesExpanded   : false;
        this._docExpanded       = toDoc       ? !this._docExpanded       : false;
        this._artifactsExpanded = toArtifacts ? !this._artifactsExpanded : false;
    }

    handleMsBadgeClick(event) {
        const section = event.currentTarget.dataset.section;
        this._msTypeOpen      = section === 'category' ? !this._msTypeOpen      : false;
        this._msNotesOpen     = section === 'notes'    ? !this._msNotesOpen     : false;
        this._msInputOpen     = section === 'files'    ? !this._msInputOpen     : false;
        this._msDocUploadOpen = section === 'doc'      ? !this._msDocUploadOpen : false;
        this._msRegenOpen     = section === 'regen'    ? !this._msRegenOpen     : false;
    }

    get hasAnyInput() {
        return this.hasFile || this.hasSelectedArtifact
            || (this._freeText && this._freeText.trim().length > 0)
            || this.selectedTaskCount > 0;
    }

    // ── Step guide ───────────────────────────────────────────────────────────
    get _sg1Done() { return !!this._selectedEventId; }
    get _sg2Done() { return this._activeTab === 'summary' || this._activeTab === 'wealthplan'; }
    get _sg3Done() { return !!this._selectedMeetingType; }
    get _sg4Done() { return this.hasAnyInput; }

    get _sgActive() {
        if (!this._sg1Done) return 1;
        if (!this._sg2Done) return 2;
        if (!this._sg3Done) return 3;
        if (!this._sg4Done) return 4;
        return 0;
    }
    _sgClass(n, done) {
        if (done)                    return 'wph-sg-step wph-sg-done';
        if (this._sgActive === n)    return 'wph-sg-step wph-sg-active';
        return 'wph-sg-step wph-sg-pending';
    }
    get sgClass1() { return this._sgClass(1, this._sg1Done); }
    get sgClass2() { return this._sgClass(2, this._sg2Done); }
    get sgClass3() { return this._sgClass(3, this._sg3Done); }
    get sgClass4() { return this._sgClass(4, this._sg4Done); }

    get sgStatus1() {
        if (!this._sg1Done) return 'Select a meeting above';
        return this.selectedEventSubject || 'Event selected';
    }
    get sgStatus2() {
        if (!this._sg2Done) return 'Choose a tab below';
        return this._activeTab === 'summary' ? 'Meeting Summary' : 'Wealth Plan';
    }
    get sgStatus3() {
        if (!this._sg3Done) return 'Set via the button above';
        return this.meetingTypeLabel || 'Type set';
    }
    get sgStatus4() {
        if (!this._sg4Done) return 'Add notes, files or artifacts';
        const parts = [];
        if (this._freeText?.trim())               parts.push('Notes');
        if (this._sharedFiles.length)             parts.push(`${this._sharedFiles.length} file${this._sharedFiles.length > 1 ? 's' : ''}`);
        if (this._selectedArtifactFileIds.size)   parts.push(`${this._selectedArtifactFileIds.size} meeting file${this._selectedArtifactFileIds.size > 1 ? 's' : ''}`);
        if (this.selectedTaskCount)               parts.push(`${this.selectedTaskCount} task${this.selectedTaskCount > 1 ? 's' : ''}`);
        return parts.length ? parts.join(' · ') : 'Ready';
    }

    get isGenerateDisabled() {
        if (this._wpGenerating)          return true;
        if (this._step === 'loading')    return true;
        if (this.eventSelectionRequired) return true;
        if (this._modeExistingOnly)      return !this.hasExistingData;
        return !this.hasAnyInput;
    }
    get isSummaryGenerateDisabled() {
        if (!this._selectedMeetingType) return true;
        const hasFiles   = this._totalNoNoteFileCount > 0;
        const hasContext = (this._freeText || '').trim().length > 0;
        return !hasFiles && !hasContext;
    }

    // ── Meeting type modal ───────────────────────────────────────────────────
    handleOpenMeetingTypeModal()  { this._showMeetingTypeModal = true; }
    handleCloseMeetingTypeModal() { this._showMeetingTypeModal = false; }
    handleMeetingTypeChange(event) {
        const btn = event.target.closest('[data-type]') || event.currentTarget;
        const type = btn?.dataset?.type;
        if (!type) return;
        this._selectedMeetingType = this._selectedMeetingType === type ? null : type;
        this._dispatchMeetingTypeOutputs();
    }
    handleMeetingFormatChange() {
        this._hasTodos = !this._hasTodos;
        this._dispatchMeetingTypeOutputs();
    }

    handleAcceptTodo(event) {
        const key = event.currentTarget.dataset.key;
        this._meetingTodos = this._meetingTodos.map(t =>
            t._key === key ? { ...t, _accepted: true, _rowClass: 'wph-record-row wph-row-locked' } : t
        );
        this._dispatchAcceptedTodos();
    }
    handleUndoTodo(event) {
        const key = event.currentTarget.dataset.key;
        this._meetingTodos = this._meetingTodos.map(t =>
            t._key === key ? { ...t, _accepted: false, _rowClass: 'wph-record-row' } : t
        );
        this._dispatchAcceptedTodos();
    }
    handleRemoveTodo(event) {
        const key = event.currentTarget.dataset.key;
        this._meetingTodos = this._meetingTodos.filter(t => t._key !== key);
        this._dispatchAcceptedTodos();
    }
    handleEditTodo(event) {
        const key = event.currentTarget.dataset.key;
        this._meetingTodos = this._meetingTodos.map(t => {
            if (t._key !== key) return t;
            const p = t.Priority || '';
            return { ...t, _isEditing: true,
                _priorityIsBlank:  !p,
                _priorityIsHigh:   p === 'High',
                _priorityIsNormal: p === 'Normal',
                _priorityIsLow:    p === 'Low'
            };
        });
    }
    handleCancelEditTodo(event) {
        const key = event.currentTarget.dataset.key;
        this._meetingTodos = this._meetingTodos.map(t =>
            t._key === key ? { ...t, _isEditing: false } : t
        );
    }
    handleSaveTodoEdit(event) {
        const key = event.currentTarget.dataset.key;
        const form = event.currentTarget.closest('.wph-todo-edit-form');
        if (!form) return;
        const subject      = form.querySelector('[data-field="Subject"]')?.value      || '';
        const description  = form.querySelector('[data-field="Description"]')?.value  || '';
        const priority     = form.querySelector('[data-field="Priority"]')?.value     || '';
        const activityDate = form.querySelector('[data-field="ActivityDate"]')?.value || '';
        const isPublic     = form.querySelector('[data-field="IsPublic__c"]')?.checked || false;
        this._meetingTodos = this._meetingTodos.map(t => {
            if (t._key !== key) return t;
            const hasMeta = !!(priority || activityDate || isPublic);
            return { ...t, Subject: subject, Description: description, Priority: priority,
                ActivityDate: activityDate, IsPublic__c: isPublic, _hasMeta: hasMeta, _isEditing: false };
        });
    }
    handleAcceptAllTodos() {
        this._meetingTodos = this._meetingTodos.map(t =>
            t._saved ? t : { ...t, _accepted: true, _rowClass: 'wph-record-row wph-row-locked' }
        );
        this._dispatchAcceptedTodos();
    }
    async handleSaveTodos() {
        this._dispatchAcceptedTodos();
        if (!this.saveTodosFlowApiName) {
            this._todosSaved = true;
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => { this._todosSaved = false; }, 2000);
            return;
        }
        const todos = this.outputTodos;
        if (!todos.length) return;
        const rawEvent = (this.inputEvents || []).find(e => e.Id === this._selectedEventId);
        this._todosSaving = true;
        try {
            await saveTodos({
                flowApiName: this.saveTodosFlowApiName,
                todosJson:   JSON.stringify(todos),
                eventId:     this._selectedEventId || '',
                whoId:       this.inputWhoId || rawEvent?.WhoId || ''
            });
            const n = todos.length;
            this._meetingTodos = this._meetingTodos.map(t =>
                t._accepted && !t._saved
                    ? { ...t, _saved: true, _isEditing: false, _rowClass: 'wph-record-row wph-row-saved' }
                    : t
            );
            this._showToast("To-Do's Saved", `${n} to-do${n !== 1 ? "'s" : ''} saved successfully`, 'success');
            this._todosSaved = true;
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => { this._todosSaved = false; }, 2000);
        } catch (e) {
            this._showToast('Save Failed', e.body?.message || "Could not save to-do's", 'error');
        } finally {
            this._todosSaving = false;
        }
    }
    _dispatchAcceptedTodos() {
        const rawEvent = (this.inputEvents || []).find(e => e.Id === this._selectedEventId);
        const whoId  = this.inputWhoId || rawEvent?.WhoId || '';
        const whatId = this._selectedEventId || '';
        const accepted = this._meetingTodos
            .filter(t => t._accepted)
            .map(({ Subject, Description, Type, ActivityDate, Priority, IsPublic__c }) => ({
                Subject:          Subject      || '',
                Description:      Description  || '',
                WhoId:            whoId,
                Type:             Type         || 'Other',
                ActivityDate:     ActivityDate || '',
                Priority:         Priority     || 'Normal',
                IsPublic__c:      IsPublic__c  || false,
                Related_Event__c: whatId
            }));
        this.outputTodos = accepted;
        this.dispatchEvent(new FlowAttributeChangeEvent('outputTodos', accepted));
    }
    get showTodosSaveBar() {
        return this.isTodosSection && this._meetingTodos.length > 0 && !this._todosGenerating;
    }
    handleGenerateTodosDirect() {
        if (!this.meetingSummaryFlowApiName) {
            this._showToast('Configuration Error', 'Meeting Summary Flow API Name is not set.', 'error');
            return;
        }
        const files = this.noNoteFilesForFlow;
        const flowParams = {
            flowApiName:       this.meetingSummaryFlowApiName,
            eventId:           this._selectedEventId         || '',
            accountId:         this._resolvedPrimaryMemberId || '',
            documentId1:       files[0]?.documentId          || '',
            documentId2:       files[1]?.documentId          || '',
            documentId3:       files[2]?.documentId          || '',
            meetingType:       this._selectedMeetingType     || '',
            hasTodos:          true,
            additionalContext: this._freeText                || ''
        };
        this._generateTodos(flowParams);
    }
    _dispatchMeetingTypeOutputs() {
        const type = this._selectedMeetingType || '';
        this.outputMeetingType = type;
        this.dispatchEvent(new FlowAttributeChangeEvent('outputMeetingType', type));
        this.outputHasTodos = this._hasTodos;
        this.dispatchEvent(new FlowAttributeChangeEvent('outputHasTodos', this._hasTodos));
        if (this._selectedEventId) {
            this._meetingTypeCache = {
                ...this._meetingTypeCache,
                [this._selectedEventId]: { type: this._selectedMeetingType, hasTodos: this._hasTodos }
            };
        }
    }
    // Readiness indicator classes
    get _hasText()  { return this._freeText && this._freeText.trim().length > 0; }
    get readinessTextClass()    { return `wph-readiness-item${this._hasText ? ' ready' : ''}`; }
    get readinessFileClass()    { return `wph-readiness-item${this.hasFile ? ' ready' : ''}`; }
    get readinessTaskClass()    { return `wph-readiness-item${(this.selectedTaskCount > 0 || this.hasSelectedArtifact) ? ' ready' : ''}`; }
    get readinessSummaryClass() { return `wph-readiness-item${(this._includeMeetingSummary && this.hasMeetingSummaryInput) ? ' ready' : ''}`; }
    get msBadgeCategoryClass() { return `wph-readiness-item${this._selectedMeetingType ? ' ready' : ''}`; }
    get msBadgeNotesClass()  { return `wph-readiness-item${(this._freeText || '').trim().length > 0 ? ' ready' : ''}`; }
    get msBadgeFilesClass()  { return `wph-readiness-item${this._selectedArtifactFileIds.size > 0 ? ' ready' : ''}`; }
    get msBadgeDocClass()    { return `wph-readiness-item${this._sharedFiles.filter(f => f.included).length > 0 ? ' ready' : ''}`; }
    get msBadgeRegenClass()  { return `wph-readiness-item${(this._summaryInstructions || '').trim().length > 0 ? ' ready' : ''}`; }
    get canShowRegenPill()   { return this.isMeetingSection && this.hasSummaryForEvent && !this.isNotePublished; }
    // Meeting summary readiness indicators
    get msReadinessNotesClass() { return `wph-readiness-item${this._freeText?.trim() ? ' ready' : ''}`; }
    get msReadinessFilesClass() { return `wph-readiness-item${(this._sharedFiles.length > 0 || this._selectedArtifactFileIds.size > 0) ? ' ready' : ''}`; }
    get msReadinessTypeClass()  { return `wph-readiness-item${this._selectedMeetingType ? ' ready' : ''}`; }
    // Context summary — merged list of file names and truncated notes for display above generate button
    get msContextFiles() {
        const names = [];
        for (const id of this._selectedArtifactFileIds) {
            const af = (this.artifactFiles || []).find(f => f.id === id);
            if (af) names.push({ key: id, name: af.title });
        }
        for (const f of this._sharedFiles) {
            names.push({ key: f.documentId, name: f.name });
        }
        return names;
    }
    get msContextNotesSnippet() {
        const t = (this._freeText || '').trim();
        if (!t) return null;
        return t.length > 55 ? t.slice(0, 52) + '…' : t;
    }
    get hasMsContextSummary() {
        return !!(this._selectedMeetingType || this.msContextFiles.length || this.msContextNotesSnippet);
    }
    // "At a Glance" brief section
    get showBriefSection() {
        if (!(this.briefEnabled === true || this.briefEnabled === 'true')) return false;
        if (this._previewingVersionId) return !!this.previewingVersion?.BriefSummary__c;
        return this._briefGenerating || !!this._meetingBrief;
    }
    get briefChevronClass() { return `wph-chevron${this._briefExpanded ? ' wph-chevron-up' : ''}`; }
    handleToggleBrief()     { this._briefExpanded = !this._briefExpanded; }
    handleEditBrief() {
        this._briefEditValue       = this._meetingBrief || '';
        this._briefEditMode        = true;
        this._briefEditorNeedsInit = true;
    }
    handleSaveBriefEdit() {
        this._modalHeightPx = null;
        this._meetingBrief  = this._briefEditValue;
        this._briefEditMode = false;
        this.handleSaveSummary();
    }
    handleCancelBriefEdit() {
        this._modalHeightPx        = null;
        this._briefEditMode        = false;
        this._briefEditValue       = '';
        this._briefEditorNeedsInit = false;
    }
    // ── Two-column layout collapse / ratio ──────────────────────────────────
    @track _theme               = 'corporate'; // 'classic' | 'corporate'
    @track _leftPanelCollapsed  = false;
    @track _panelEqualOverride  = false;
    @track _eventDropdownOpen   = false;
    get wpLayoutClass() {
        if (this._leftPanelCollapsed) return 'wph-summary-layout wph-layout-collapsed';
        if (this.isReviewStep && !this._panelEqualOverride) return 'wph-summary-layout wph-layout-wide';
        return 'wph-summary-layout';
    }
    get wpHasResult() { return (this._sections || []).length > 0; }
    handleToggleWpLeftPanel(event) {
        if (event) event.stopPropagation();
        const wasCollapsed = this._leftPanelCollapsed;
        this._leftPanelCollapsed = !this._leftPanelCollapsed;
        if (wasCollapsed) this._collapseAllPanelSections();
    }
    handleWpLeftPanelClick() {
        if (this._leftPanelCollapsed) { this._leftPanelCollapsed = false; this._collapseAllPanelSections(); }
    }
    handleWpReset() {
        this._sections = [];
        this._wpGenerating = false;
        this._step = 'summary';
        this._activeTab = 'wealthplan';
    }

    get summaryLayoutClass() {
        if (this._leftPanelCollapsed) return 'wph-summary-layout wph-layout-collapsed';
        if (this.hasSummaryForEvent && !this._panelEqualOverride) return 'wph-summary-layout wph-layout-wide';
        return 'wph-summary-layout';
    }
    get showPanelRatioToggle()   { return !this._leftPanelCollapsed && this.hasSummaryForEvent; }
    get showWpPanelRatioToggle() { return !this._leftPanelCollapsed && this.isReviewStep; }
    get panelRatioToggleTitle() { return this._panelEqualOverride ? 'Switch to 30/70 view' : 'Switch to 50/50 view'; }
    get panelRatioToggleClass() { return `wph-panel-ratio-btn${this._panelEqualOverride ? ' wph-panel-ratio-btn--equal' : ''}`; }

    handleToggleLeftPanel(event) {
        if (event) event.stopPropagation();
        const wasCollapsed = this._leftPanelCollapsed;
        this._leftPanelCollapsed = !this._leftPanelCollapsed;
        if (wasCollapsed) this._collapseAllPanelSections();
    }
    handleLeftPanelClick() {
        if (this._leftPanelCollapsed) { this._leftPanelCollapsed = false; this._collapseAllPanelSections(); }
    }
    _collapseAllPanelSections() {
        this._msTypeOpen      = false;
        this._msInputOpen     = false;
        this._msDocUploadOpen = false;
        this._msNotesOpen     = false;
        this._msRegenOpen     = false;
        this._expandedSections = {};
        this._allExpanded = false;
    }
    handleStripTabSwitch(event) {
        event.stopPropagation();
        const tab = event.currentTarget.dataset.tab;
        this._activeTab = tab;
        if (tab === 'summary') this._activeMsSection = 'meeting';
    }
    get stripSummaryBtnClass() { return `wph-strip-nav-btn${this._activeTab === 'summary' && this._activeMsSection !== 'todos' ? ' wph-strip-nav-btn--active' : ''}`; }
    get stripWpBtnClass()      { return `wph-strip-nav-btn${this._activeTab === 'wealthplan' ? ' wph-strip-nav-btn--active' : ''}`; }
    get stripTodosBtnClass()   { return `wph-strip-nav-btn${this._activeTab === 'summary' && this._activeMsSection === 'todos' ? ' wph-strip-nav-btn--active' : ''}`; }
    handleStripTodosSwitch(event) {
        event.stopPropagation();
        if (this._activeTab === 'summary' && this._activeMsSection === 'todos') {
            this._activeMsSection = 'meeting';
        } else {
            this._activeTab = 'summary';
            this._activeMsSection = 'todos';
        }
    }
    handleTogglePanelRatio()    { this._panelEqualOverride = !this._panelEqualOverride; }
    handleToggleEventDropdown(event) {
        if (event) event.stopPropagation();
        this._eventDropdownOpen = !this._eventDropdownOpen;
    }

    get eventDropdownLabel() {
        const ev = this._selectedEventItem;
        return ev ? ev.subject : 'Velg møte-hendelse';
    }
    get eventDropdownMeta() {
        const ev = this._selectedEventItem;
        if (!ev) return '';
        return ev.time ? `${ev.date} · kl. ${ev.time}` : ev.date;
    }
    // ── File icon helpers ────────────────────────────────────────────────────
    get fileIconStyle() {
        if (!this._stagedFile) return 'background: #f1f5f9; color: #64748b;';
        const ext = this._stagedFile.extension;
        if (ext === 'pdf')                       return 'background: #fee2e2; color: #ef4444;';
        if (ext === 'docx')                      return 'background: #dbeafe; color: #2563eb;';
        if (ext === 'txt')                       return 'background: #d1fae5; color: #059669;';
        if (['png','jpg','jpeg'].includes(ext))  return 'background: #ede9fe; color: #7c3aed;';
        return 'background: #f1f5f9; color: #64748b;';
    }

    // ── Generate ─────────────────────────────────────────────────────────────
    async handleGenerate() {
        // Wealth Plan tab always generates wealth plan only
        this._modeWealthPlan     = true;
        this._modeMeetingSummary = false;
        this._modeOther          = false;
        this._modeExistingOnly   = false;

        if (!this.flowApiName) {
            this._showToast('Configuration Error', 'Wealth Plan Flow API Name is not set.', 'error');
            return;
        }

        // Build additionalContext — free text, event details, selected action items
        let context = '';
        if (this._freeText) context += this._freeText + '\n\n';

        if (this._selectedEventId) {
            const evt = (this.inputEvents || []).find(e => e.Id === this._selectedEventId);
            if (evt) {
                context += `--- Meeting Event ---\nSubject: ${evt.Subject || ''}\n`;
                context += `Date: ${evt.ActivityDate || evt.StartDateTime || ''}\n`;
                if (evt.Description) context += `Notes: ${evt.Description}\n`;
                if (this._selectedMeetingType) {
                    const typeLabel = { whiteboard: 'Whiteboard Meeting', status: 'Status Meeting', annual: 'Annual Review' };
                    context += `Meeting Category: ${typeLabel[this._selectedMeetingType] || this._selectedMeetingType}\n`;
                }
                if (this._hasTodos) context += `Include: To-Do's\n`;
                context += '\n';
            }
        }

        if (this.selectedTaskCount > 0) {
            context += '--- Selected Action Items ---\n';
            (this.inputTasks || []).forEach(t => {
                if (this._selectedTaskIds[t.Id]) {
                    context += `- ${t.Subject || 'Task'} (${t.Status || 'Open'})${t.Description ? ': ' + t.Description : ''}\n`;
                }
            });
            context += '\n';
        }

        // Meeting note passed as a dedicated flow variable (MeetingNoteText), not embedded in context
        const meetingNoteText = (this._includeMeetingSummary)
            ? (this._currentNoteHtml ?? this.selectedEventNote?.Note__c ?? '')
            : '';

        // Up to 3 document IDs: artifact selections first, then uploaded doc files
        const allDocIds = [
            ...[...this._selectedArtifactFileIds],
            ...this._sharedFiles.map(f => f.documentId)
        ];
        const docId1 = allDocIds[0] || '';
        const docId2 = allDocIds[1] || '';
        const docId3 = allDocIds[2] || '';

        this._cancelled = false;
        this._wpGenerating = true;
        this._leftPanelCollapsed = true;
        this._progressValue = 8;
        this._startLoadingCycle();

        try {
            const tasks = [];
            if (this._modeWealthPlan) {
                tasks.push(generateSummary({
                    flowApiName:       this.flowApiName,
                    documentId1:       docId1,
                    documentId2:       docId2,
                    documentId3:       docId3,
                    additionalContext: context       || '',
                    meetingNoteText:   meetingNoteText || ''
                    // eventId, accountId, saveDocNAsArtifact intentionally omitted —
                    // Apex receives null → isNotBlank / != null guards skip them → not injected into flow
                }).then(r => ({ kind: 'wealthplan', value: r })));
            }

            const results = await Promise.all(tasks);

            // If the user cancelled while the request was in-flight, discard results silently
            if (this._cancelled) return;

            results.forEach(r => {
                if (r.kind === 'wealthplan') {
                    this._parseResult(r.value);
                } else if (r.kind === 'summary') {
                    this._meetingSummaryResult = r.value || '';
                    this._originalMeetingSummary = this._meetingSummaryResult; // Feature 12
                    this._isSummaryEditing = false;
                    this.outputMeetingSummary = this._meetingSummaryResult;
                    this.dispatchEvent(new FlowAttributeChangeEvent('outputMeetingSummary', this._meetingSummaryResult));
                }
            });

            // If only meeting summary was requested, build empty wealth plan sections so review still renders
            if (!this._modeWealthPlan) {
                this._sections = this._buildEmptySections();
            }

            this._progressValue = 100;

            // Auto-collapse summary tab when both modes are on; expanded if summary-only
            this._summaryTabOpen = this.isOnlyMeetingSummary;
            this._wpGenerating = false;
            this._step = 'review';
        } catch (error) {
            if (this._cancelled) return;
            const msg = error.body ? error.body.message : error.message;
            this._showToast('Analysis Failed', msg, 'error');
            this._wpGenerating = false;
            this._activeTab = 'wealthplan';
        } finally {
            this._stopLoadingCycle();
        }
    }

    handleCancelGeneration() {
        this._cancelled = true;
        this._stopLoadingCycle();
        this._progressValue = 0;
        this._wpGenerating = false;
        this._activeTab = 'wealthplan';
    }

    _startSummaryLoadingCycle() {
        let idx = 0;
        this._summaryLoadingMessage = this._summaryLoadingPhases[0];
        this._summaryLoadingInterval = setInterval(() => {
            idx = (idx + 1) % this._summaryLoadingPhases.length;
            this._summaryLoadingMessage = this._summaryLoadingPhases[idx];
        }, 2600);
    }

    _stopSummaryLoadingCycle() {
        if (this._summaryLoadingInterval) {
            clearInterval(this._summaryLoadingInterval);
            this._summaryLoadingInterval = null;
        }
        this._summaryLoadingMessage = '';
    }

    _startLoadingCycle() {
        let idx = 0;
        this._loadingMessage = this._loadingPhases[0];
        this._loadingInterval = setInterval(() => {
            if (idx < this._loadingPhases.length - 1) {
                idx++;
                this._loadingMessage = this._loadingPhases[idx];
                this._progressValue = 8 + (idx * (82 / (this._loadingPhases.length - 1)));
            } else if (this._progressValue < 98) {
                this._progressValue += 1.5;
            }
        }, 2800);
    }

    _stopLoadingCycle() {
        if (this._loadingInterval) { clearInterval(this._loadingInterval); this._loadingInterval = null; }
    }

    disconnectedCallback() {
        this._stopLoadingCycle();
        this._stopSummaryLoadingCycle();
        if (this._eventsLoadingTimeoutId) {
            clearTimeout(this._eventsLoadingTimeoutId);
            this._eventsLoadingTimeoutId = null;
        }
        document.body.style.overflow = '';
        if (this._escHandler) {
            window.removeEventListener('keydown', this._escHandler);
            this._escHandler = null;
        }
        if (this._boundKeyHandler) {
            document.removeEventListener('keydown', this._boundKeyHandler);
        }
    }

    // ── Parse AI result ──────────────────────────────────────────────────────
    _parseResult(raw) {
        let cleaned = (raw || '').trim();

        // Aggressively sanitize: strip BOM, zero-width chars, smart quotes
        cleaned = cleaned
            .replace(/^\uFEFF/, '')                    // BOM
            .replace(/[\u200B-\u200D\uFEFF]/g, '')     // zero-width chars
            .replace(/[\u201C\u201D]/g, '"')            // smart double quotes → standard
            .replace(/[\u2018\u2019]/g, "'")            // smart single quotes → standard
            .replace(/^```(?:json)?\s*/i, '')           // opening markdown fence
            .replace(/\s*```\s*$/i, '')                 // closing markdown fence
            .trim();

        // Find the first JSON structure: { or [
        let summaryPart = '';
        const matchObj = cleaned.match(/[\[{]/);
        if (matchObj && matchObj.index > 0) {
            summaryPart = cleaned.substring(0, matchObj.index).trim();
            cleaned = cleaned.substring(matchObj.index);
        }

        // Find the LAST matching bracket to handle trailing text after JSON
        let jsonStr = cleaned;
        if (cleaned.startsWith('[')) {
            const lastBracket = cleaned.lastIndexOf(']');
            if (lastBracket > 0) jsonStr = cleaned.substring(0, lastBracket + 1);
        } else if (cleaned.startsWith('{')) {
            const lastBrace = cleaned.lastIndexOf('}');
            if (lastBrace > 0) jsonStr = cleaned.substring(0, lastBrace + 1);
        }

        // Try to parse
        let parsed;
        try {
            parsed = JSON.parse(jsonStr);
        } catch (e) {
            console.error('[WealthPlanHelper] JSON.parse failed:', e.message, '| Input:', jsonStr.substring(0, 300));
            this._summary = raw;
            this._sections = this._buildEmptySections();
            return;
        }

        // ── Normalize to { sectionKey: [...records] } ────────────────────────
        const KEY_ALIASES = {
            financialGoals: 'goals', financial_goals: 'goals',
            incomeStreams: 'income', income_streams: 'income', incomes: 'income',
            assetsAndLiabilities: 'assets', assets_and_liabilities: 'assets', assetsLiabilities: 'assets',
            householdMilestones: 'milestones', household_milestones: 'milestones',
            companyOwnership: 'ownership', company_ownership: 'ownership', ownerships: 'ownership',
            sustainabilityPreferences: 'sustainability', sustainability_preferences: 'sustainability', sustainabilityPrefs: 'sustainability',
            personalGreetings: 'greetings', personal_greetings: 'greetings', personalGreeting: 'greetings',
        };

        let normalizedData = {};
        let summary = summaryPart;

        if (Array.isArray(parsed)) {
            // Flat array — detect section from record content
            const detectedKey = this._detectSectionFromRecord(parsed[0]);
            normalizedData[detectedKey] = parsed;
        } else if (typeof parsed === 'object') {
            summary = parsed.summary || parsed.meetingSummary || summaryPart || '';
            Object.entries(parsed).forEach(([k, v]) => {
                if (Array.isArray(v)) {
                    normalizedData[KEY_ALIASES[k] || k] = v;
                }
            });
        }

        this._summary = summary;

        // ── Build editable sections with field normalization ──────────────────
        const primaryId = this._resolvedPrimaryMemberId;
        this._sections = SECTIONS.map(def => {
            const rawRecords = normalizedData[def.key] || [];
            const aliases = FIELD_ALIASES[def.key] || {};
            const validApiNames = new Set(def.fields.map(f => f.api));

            const records = rawRecords.map((rec, i) => {
                const normalized = { _id: `AI_${def.key}_${i}_${Date.now()}`, _source: 'ai' };
                Object.entries(rec).forEach(([key, value]) => {
                    if (validApiNames.has(key)) {
                        normalized[key] = value;
                    } else if (aliases[key]) {
                        normalized[aliases[key]] = value;
                    }
                });
                // Default Primary Owner to primary member if not set by AI
                if (def.key === 'goals' && !normalized.FinServ__PrimaryOwner__c && primaryId) {
                    normalized.FinServ__PrimaryOwner__c = primaryId;
                }
                if (def.key === 'income' && !normalized.FF_Account__c && primaryId) {
                    normalized.FF_Account__c = primaryId;
                }
                if (def.key === 'assets' && !normalized.FinServ__PrimaryOwner__c && primaryId) {
                    normalized.FinServ__PrimaryOwner__c = primaryId;
                }
                return normalized;
            });

            return {
                key: def.key,
                label: def.label,
                object: def.object,
                fields: def.fields,
                records,
                count: records.length,
                hasRecords: records.length > 0,
                isExpanded: records.length > 0
            };
        });

        // Auto-expand only the FIRST section with data; collapse all others
        this._expandedSections = {};
        const firstWithData = this._sections.find(s => s.hasRecords);
        if (firstWithData) {
            this._expandedSections[firstWithData.key] = true;
        }

        // If existing data was already loaded, run conflict detection
        if (this._existingLoaded) this._detectDuplicates();
    }

    _detectSectionFromRecord(record) {
        if (!record || typeof record !== 'object') return 'goals';
        const keys = Object.keys(record).map(k => k.toLowerCase());
        // Check for distinctive field names per section
        if (keys.some(k => k.includes('goal') || k === 'category'))           return 'goals';
        if (keys.some(k => k.includes('amount') && k.includes('type')))       return 'income';
        if (keys.some(k => k.includes('asset') || k.includes('liability')))   return 'assets';
        if (keys.some(k => k.includes('milestone') || k === 'year'))          return 'milestones';
        if (keys.some(k => k.includes('owned') || k.includes('percentage'))) return 'ownership';
        if (keys.some(k => k.includes('sustainability') || k.includes('engagement'))) return 'sustainability';
        if (keys.some(k => k.includes('greeting') || k.includes('subject'))) return 'greetings';
        return 'goals'; // fallback
    }

    _buildEmptySections() {
        return SECTIONS.map(def => ({
            key: def.key, label: def.label, object: def.object,
            fields: def.fields, records: [], count: 0, hasRecords: false, isExpanded: false
        }));
    }

    // ── Review step getters ──────────────────────────────────────────────────
    get hasSummary() { return this._summary && this._summary.trim().length > 0; }

    /** Lightweight per-record stat — no option building, no display strings.
     *  Runs on every record in every section to keep aggregate counts accurate. */
    _computeRecordStat(rec, sectionKey, fields, optMap) {
        const isRowLocked = !!this._lockedRows[rec._id] || !!this._lockedSections[sectionKey];
        const isMarkedForDeletion = rec._source === 'existing' && !!this._deletedRows[rec._id];
        let hasErrors = false;
        if (!isRowLocked && !isMarkedForDeletion) {
            for (const f of fields) {
                const raw = rec[f.api] != null ? String(rec[f.api]) : '';
                let invalid = false;
                if (f.type === 'select' && f.selectKey) {
                    const opts = optMap[f.selectKey] || [];
                    const lc = raw.trim().toLowerCase();
                    const matched = opts.find(o =>
                        o.value === raw ||
                        o.value.trim().toLowerCase() === lc ||
                        (o.label && o.label.trim().toLowerCase() === lc)
                    );
                    invalid = (raw === '' && !!f.required) || (raw !== '' && !matched);
                } else if (f.required) {
                    invalid = raw === '';
                }
                if (invalid) { hasErrors = true; break; }
            }
            // Cross-field validation (e.g. Other picklist + companion text)
            if (!hasErrors) {
                for (const f of fields) {
                    if (f.crossValidate?.(rec)) { hasErrors = true; break; }
                }
            }
        }
        return {
            _hasErrors: hasErrors,
            _isLocked: isRowLocked,
            _canLock: !isRowLocked && !isMarkedForDeletion && !hasErrors,
            _isMarkedForDeletion: isMarkedForDeletion,
        };
    }

    get reviewSections() {
        const optMap = this._selectOptionsMap;
        return this._sections.map((s, idx) => {
            const isExpanded = !!this._expandedSections[s.key];

            // Stats pass — cheap, runs for ALL records so aggregates are always accurate
            const recordStats = s.records.map(rec =>
                this._computeRecordStat(rec, s.key, s.fields, optMap)
            );

            // Full display pass — expensive, only for expanded sections
            const displayRecords = isExpanded ? s.records.map((rec, ri) => {
                const isEditing = this._editingRow && this._editingRow.recId === rec._id;
                const isRowLocked = !!this._lockedRows[rec._id] || !!this._lockedSections[s.key];

                const displayFields = s.fields.map(f => {
                    const rawValue = rec[f.api] != null ? String(rec[f.api]) : '';
                    const isSelect   = f.type === 'select';
                    const isCheckbox = f.type === 'checkbox';
                    const isTextarea = f.type === 'textarea';
                    const isNumber   = f.type === 'number';
                    const isText     = f.type === 'text';

                    let selectOptions = [];
                    let isInvalid = false;
                    let displayValue = rawValue;

                    if (isSelect && f.selectKey) {
                        const baseOpts = optMap[f.selectKey] || [];
                        const trimmedLower = rawValue.trim().toLowerCase();

                        const exactMatch = baseOpts.find(o => o.value === rawValue);
                        const fuzzyValueMatch = !exactMatch ? baseOpts.find(o => o.value.trim().toLowerCase() === trimmedLower) : null;
                        const labelMatch = (!exactMatch && !fuzzyValueMatch) ? baseOpts.find(o => o.label && o.label.trim().toLowerCase() === trimmedLower) : null;

                        const matchedOpt = exactMatch || fuzzyValueMatch || labelMatch;

                        if (matchedOpt && matchedOpt.value !== rawValue) {
                            rec[f.api] = matchedOpt.value;
                            displayValue = matchedOpt.label;
                        }

                        // Invalid if: empty + required, OR has value but no match
                        isInvalid = (rawValue === '' && f.required) || (rawValue !== '' && !matchedOpt);

                        const matchedValue = matchedOpt ? matchedOpt.value : rawValue;
                        selectOptions = baseOpts.map(o => ({ ...o, selected: o.value === matchedValue }));
                        if (isInvalid && rawValue !== '') {
                            selectOptions = [{ label: `⚠ ${rawValue} (not valid)`, value: rawValue, selected: true }, ...selectOptions];
                        }
                        if (matchedOpt && rawValue) displayValue = matchedOpt.label;
                    }
                    // Required text/textarea/number fields with empty value
                    else if (f.required && (rawValue === '' || rawValue === null || rawValue === undefined)) {
                        isInvalid = true;
                    }

                    const isEmpty = rawValue === '' || rawValue === null || rawValue === undefined;
                    const isRequiredEmpty = !!f.required && isEmpty;

                    const crossMsg = (!isRowLocked && f.crossValidate) ? f.crossValidate(rec) : null;
                    if (crossMsg) isInvalid = true;
                    const invalidMsg = crossMsg
                        ?? (isRequiredEmpty ? 'Required' : null)
                        ?? (isInvalid       ? 'Not in picklist' : null)
                        ?? null;

                    const fldMaxlength = f.maxlength || null;
                    return {
                        api: f.api, label: f.label, type: f.type,
                        role: f.role || '',
                        required: !!f.required,
                        value: rawValue, displayValue,
                        isSelect, isCheckbox, isTextarea, isNumber, isText,
                        selectOptions, isInvalid, invalidMsg,
                        isRequiredEmpty,
                        checkboxValue: rec[f.api] === true || rec[f.api] === 'true',
                        selectClass: isInvalid ? 'wph-field-select wph-select-invalid' : 'wph-field-select',
                        valueClass: isInvalid ? 'wph-field-chip-value wph-value-invalid' : 'wph-field-chip-value',
                        chipClass: isInvalid ? 'wph-field-chip wph-chip-invalid' : 'wph-field-chip',
                        maxlength: fldMaxlength,
                        currentLength: fldMaxlength ? rawValue.length : null
                    };
                });

                // Build the title/subtitle/description/meta layout
                const titleField    = displayFields.find(f => f.role === 'title');
                const subtitleFields = displayFields.filter(f => f.role === 'subtitle');
                const descField     = displayFields.find(f => f.role === 'description');
                const metaFields    = displayFields.filter(f => f.role === 'meta');

                // Title text — prefer the title field's display value, fall back to placeholder
                let titleText = titleField ? (titleField.displayValue || titleField.value) : '';
                if (!titleText) titleText = 'Untitled';

                // Subtitle — concatenate any subtitle field values that have data
                const subtitleText = subtitleFields
                    .map(f => f.displayValue || f.value)
                    .filter(v => v && v.trim().length > 0)
                    .join(' · ');

                // Description text — strip HTML for greetings (FF_personalGreeting__c is plain-text-only)
                const rawDescText = descField ? (descField.displayValue || descField.value) : '';
                const descText = (s.key === 'greetings' && descField?.api === 'FF_personalGreeting__c')
                    ? _stripHtmlToText(rawDescText)
                    : rawDescText;
                const descFieldDef = s.key === 'greetings' ? SECTIONS.find(d => d.key === 'greetings')?.fields.find(f => f.api === descField?.api) : null;
                const descMaxLength = descFieldDef?.maxlength || null;
                const descCharCount = descMaxLength ? descText.length : null;

                // Meta chips — only fields with values OR required-empty
                const metaChips = metaFields
                    .filter(f => (f.value && f.value !== '') || f.isRequiredEmpty || f.isInvalid)
                    .map(f => ({
                        ...f,
                        chipDisplayValue: f.isRequiredEmpty ? 'Required' : (f.displayValue || f.value),
                        chipClass: f.isInvalid || f.isRequiredEmpty ? 'wph-meta-chip wph-mc-invalid' : 'wph-meta-chip'
                    }));

                const titleHasError = !!titleField && (titleField.isInvalid || titleField.isRequiredEmpty);

                const hasRowErrors = displayFields.some(f => f.isInvalid);
                const wasEdited = (rec._source === 'ai' || rec._source === 'existing') && !!this._editedRows[rec._id];
                const isMarkedForDeletion = rec._source === 'existing' && !!this._deletedRows[rec._id];

                // Source badge
                let srcLabel, srcClass;
                if (isMarkedForDeletion)          { srcLabel = 'To Delete';      srcClass = 'wph-source-badge wph-src-delete'; }
                else if (rec._source === 'existing' && wasEdited) { srcLabel = 'Modified';  srcClass = 'wph-source-badge wph-src-edited'; }
                else if (rec._source === 'existing')              { srcLabel = 'Existing';  srcClass = 'wph-source-badge wph-src-existing'; }
                else if (rec._source === 'manual') { srcLabel = 'Manual';       srcClass = 'wph-source-badge wph-src-manual'; }
                else if (wasEdited)               { srcLabel = 'AI Edited';    srcClass = 'wph-source-badge wph-src-edited'; }
                else                              { srcLabel = 'AI Generated'; srcClass = 'wph-source-badge wph-src-ai'; }

                // Row class — priority: completed > deleted > focused > locked > error > edited > existing > default
                const isFocused = rec._id === this._focusedRowId;
                let rowClass = 'wph-record-row';
                if (rec._completed)                  rowClass = 'wph-record-row wph-row-completed';
                else if (isMarkedForDeletion)        rowClass = 'wph-record-row wph-row-deleted';
                else if (isRowLocked)                rowClass = 'wph-record-row wph-row-locked';
                else if (hasRowErrors)               rowClass = 'wph-record-row wph-row-error';
                else if (wasEdited)                  rowClass = 'wph-record-row wph-row-edited';
                else if (rec._source === 'existing') rowClass = 'wph-record-row wph-row-existing';
                if (isFocused) rowClass += ' wph-row-focused';

                // Feature 2: Diff view for existing edited records
                const canShowDiff = rec._source === 'existing' && wasEdited;
                const showDiff = canShowDiff && !!this._diffVisibleRows[rec._id];
                const diffFields = showDiff ? this._getDiffFields(rec, s.fields) : [];
                const diffToggleLabel = showDiff ? 'Hide Changes' : 'Show Changes';

                // Feature 7: Duplicate detection
                const dupFlag = this._duplicateFlags[rec._id];
                const isDuplicate = !!dupFlag;
                const duplicateMatchTitle = dupFlag ? `Matches: ${dupFlag.matchedTitle}` : '';

                return {
                    ...rec,
                    _rowIndex: ri, _sectionKey: s.key, _isEditing: isEditing,
                    _isLocked: isRowLocked,
                    _isExisting: rec._source === 'existing',
                    _isMarkedForDeletion: isMarkedForDeletion,
                    _rowClass: rowClass,
                    _sourceLabel: srcLabel,
                    _sourceClass: srcClass,
                    _displayFields: displayFields,
                    _hasErrors: hasRowErrors,
                    _canLock: !hasRowErrors && !isRowLocked,
                    _canSave: !hasRowErrors,
                    // Card layout
                    _titleText: titleText,
                    _titleClass: titleHasError ? 'wph-row-title wph-row-title-error' : 'wph-row-title',
                    _subtitleText: subtitleText,
                    _hasSubtitle: !!subtitleText,
                    _descText: descText,
                    _hasDesc: !!descText,
                    _descMaxLength: descMaxLength,
                    _descCharCount: descCharCount,
                    _metaChips: metaChips,
                    _hasMeta: metaChips.length > 0,
                    // Feature 2: Diff
                    _canShowDiff: canShowDiff,
                    _showDiff: showDiff,
                    _diffFields: diffFields,
                    _diffToggleLabel: diffToggleLabel,
                    // Feature 5: Focus
                    _isFocused: isFocused,
                    // Feature 7: Duplicate
                    _isDuplicate: isDuplicate,
                    _duplicateMatchTitle: duplicateMatchTitle,
                    // State icons — accessibility supplement to left-border color coding
                    _stateIsCompleted: !!rec._completed,
                    _stateIsDeleted:   !rec._completed && isMarkedForDeletion,
                    _stateIsLocked:    !rec._completed && !isMarkedForDeletion && isRowLocked,
                    _stateIsError:     !rec._completed && !isMarkedForDeletion && !isRowLocked && hasRowErrors,
                    _stateIsEdited:    !rec._completed && !isMarkedForDeletion && !isRowLocked && !hasRowErrors && wasEdited,
                    _stateIconTitle:   rec._completed         ? 'Saved to Wealth Plan'
                                   : isMarkedForDeletion     ? 'Marked for deletion'
                                   : isRowLocked             ? 'Locked — will be saved to Salesforce'
                                   : hasRowErrors            ? 'Has validation errors — edit to fix'
                                   : wasEdited               ? 'Edited since last load'
                                   : '',
                };
            }) : [];

            const sectionErrors  = recordStats.filter(r => r._hasErrors).length;
            const lockedCount    = recordStats.filter(r => r._isLocked).length;
            const lockableCount  = recordStats.filter(r => r._canLock).length;
            const totalInSection = recordStats.length;
            const completedCount = s.records.filter(r => r._completed).length;
            const progressPct = totalInSection > 0 ? Math.round(((completedCount + lockedCount) / totalInSection) * 100) : 0;

            return {
                ...s,
                isExpanded: !!this._expandedSections[s.key],
                chevronClass: this._expandedSections[s.key] ? 'wph-chevron open' : 'wph-chevron',
                badgeClass: s.hasRecords ? 'wph-section-badge wph-badge-green' : 'wph-section-badge wph-badge-grey',
                badgeText: s.hasRecords ? `${s.count} suggestion${s.count !== 1 ? 's' : ''}` : 'Empty',
                isSectionLocked: !!this._lockedSections[s.key],
                sectionLockClass: this._lockedSections[s.key] ? 'wph-section-card wph-section-locked fade-in-up' : 'wph-section-card fade-in-up',
                animDelay: `animation-delay:${idx * 110}ms`,
                sectionHasErrors: sectionErrors > 0,
                sectionErrorCount: sectionErrors,
                canLockSection: sectionErrors === 0 && s.hasRecords && !this._lockedSections[s.key],
                // Section progress
                lockedCount,
                lockableCount,
                totalInSection,
                progressPct,
                progressStyle: `width: ${progressPct}%`,
                progressLabel: (() => { const _p = []; if (completedCount > 0) _p.push(`${completedCount} saved`); if (lockedCount > 0) _p.push(`${lockedCount} selected`); return _p.length > 0 ? _p.join(' · ') : `${totalInSection} total`; })(),
                hasLockableRows: lockableCount > 0 && !this._lockedSections[s.key],
                displayRecords
            };
        });
    }

    get totalRecordCount() {
        return this._sections.reduce((sum, s) => sum + s.records.length, 0);
    }

    get sectionsWithData() {
        return this._sections.filter(s => s.hasRecords).length;
    }

    // ── Empty-section filtering ──────────────────────────────────────────────
    get filteredReviewSections() {
        const sections = this.reviewSections.filter(s => s.key !== 'todos');
        if (this._showEmptySections) return sections;
        return sections.filter(s => s.hasRecords);
    }
    get emptySectionCount() {
        return this.reviewSections.filter(s => s.key !== 'todos' && !s.hasRecords).length;
    }
    get hasEmptySections() { return this.emptySectionCount > 0; }
    get emptySectionToggleLabel() {
        if (this._showEmptySections) return 'Hide empty sections';
        const n = this.emptySectionCount;
        return `Show ${n} empty section${n !== 1 ? 's' : ''}`;
    }
    handleToggleEmptySections() { this._showEmptySections = !this._showEmptySections; }

    // ── Smart owner propagation ──────────────────────────────────────────────
    get ownerPropagationMessage() {
        if (!this._ownerPropagationPrompt) return '';
        const { fieldLabel, ownerLabel, count } = this._ownerPropagationPrompt;
        const name = ownerLabel.replace(' (Primary)', '');
        return `Apply "${name}" as ${fieldLabel} to ${count} other unlocked record${count !== 1 ? 's' : ''} in this section?`;
    }

    // ── Error / validation stats ─────────────────────────────────────────────
    get totalErrors() {
        return this.reviewSections.reduce((sum, s) => sum + (s.sectionErrorCount || 0), 0);
    }
    get hasErrors() { return this.totalErrors > 0; }
    get validationProgressPct() {
        const total = this.totalRecordCount;
        if (!total) return 100;
        return Math.round((this.lockedRecordCount / total) * 100);
    }
    get validRecordCount() { return this.totalRecordCount - this.totalErrors; }
    get validationBarStyle() { return `width: ${this.validationProgressPct}%`; }
    get validationBarClass() {
        return this.lockedRecordCount === this.totalRecordCount && this.totalRecordCount > 0
            ? 'wph-val-fill wph-val-good' : 'wph-val-fill wph-val-warn';
    }
    get validationDashArray() {
        const circumference = 2 * Math.PI * 20; // r=20
        const filled = (this.validationProgressPct / 100) * circumference;
        return `${filled.toFixed(1)} ${circumference.toFixed(1)}`;
    }
    get validationRingClass() {
        return this.lockedRecordCount === this.totalRecordCount && this.totalRecordCount > 0
            ? 'wph-ring-stroke-good' : 'wph-ring-stroke-warn';
    }
    get validationLabel() {
        const locked = this.lockedRecordCount;
        const total  = this.totalRecordCount;
        if (!total)           return 'No suggestions yet';
        if (locked === total) return 'All suggestions accepted';
        return `${locked} of ${total} suggestions accepted`;
    }
    get hasDraft() {
        if (this._modeExistingOnly) return false;
        return this._sections && this._sections.some(s => s.records && s.records.length > 0);
    }
    get hasExistingChanges() {
        const hasEdited  = Object.keys(this._editedRows  || {}).length > 0;
        const hasDeleted = Object.keys(this._deletedRows || {}).length > 0;
        const hasManual  = this._sections && this._sections.some(s =>
            s.records && s.records.some(r => r._source === 'manual'));
        return hasEdited || hasDeleted || hasManual;
    }
    get showSaveButton() {
        if (!this._modeExistingOnly) return true;
        return this.hasExistingChanges;
    }
    get hasWpSectionChanges() {
        if (!this._sections) return false;
        return this._sections.some(s => {
            if (s.key === 'todos' || !s.records?.length) return false;
            if (this._lockedSections[s.key]) return true;
            return s.records.some(r =>
                !!this._lockedRows[r._id] ||
                !!this._deletedRows?.[r._id]
            );
        });
    }
    get hasTodosToSave() {
        if (!this._sections) return false;
        const sec = this._sections.find(s => s.key === 'todos');
        if (!sec?.records?.length) return false;
        return sec.records.some(r => !!this._lockedRows[r._id] || !!this._lockedSections['todos']);
    }
    get isWpSaveDisabled()      { return !this.hasWpSectionChanges || this._wpGenerating || this._wpSaving; }
    get wpSaveNoticeVisible()   { return !!this._wpSaveNotice; }
    get isWpSaving()            { return this._wpSaving; }
    get showWpSaveBar() {
        return this.isReviewStep && this.isWealthPlanEnabled && this.showSaveButton && this.hasTodosToSave;
    }

    // ── Coerced feature getters ──────────────────────────────────────────────
    get isEditTrackingOn()      { return this._on(this.showEditTracking, 'showEditTracking'); }
    get isExpandCollapseAllOn() { return this._on(this.showExpandCollapseAll, 'showExpandCollapseAll'); }
    get isDetailedStatsOn()     { return this._on(this.showDetailedStats, 'showDetailedStats'); }
    get isDiscardSectionOn()    { return this._on(this.showDiscardSection, 'showDiscardSection'); }
    get isRegenerateSectionOn() { return this._on(this.showRegenerateSection, 'showRegenerateSection'); }
    get isScrollToErrorOn()     { return this._on(this.showScrollToError, 'showScrollToError'); }

    // ── Detailed stats ───────────────────────────────────────────────────────
    get lockedRecordCount() {
        let count = 0;
        for (const s of this._sections) {
            const sectionLocked = !!this._lockedSections[s.key];
            for (const r of s.records) {
                if (sectionLocked || !!this._lockedRows[r._id]) count++;
            }
        }
        return count;
    }

    // ── Expand / Collapse all ────────────────────────────────────────────────
    handleExpandAll() {
        const expanded = {};
        this._sections.forEach(s => { expanded[s.key] = true; });
        this._expandedSections = expanded;
        this._allExpanded = true;
    }
    handleCollapseAll() {
        this._expandedSections = {};
        this._allExpanded = false;
    }

    // ── Discard section ──────────────────────────────────────────────────────
    handleDiscardSection(event) {
        event.stopPropagation();
        const key = event.currentTarget.dataset.key;
        const secIdx = this._sections.findIndex(s => s.key === key);
        if (secIdx === -1) return;

        // Capture record ids before clearing so we can clean up state
        const removedIds = new Set(this._sections[secIdx].records.map(r => r._id));

        const section = { ...this._sections[secIdx] };
        section.records = [];
        section.count = 0;
        section.hasRecords = false;
        const sections = [...this._sections];
        sections[secIdx] = section;
        this._sections = sections;

        // Clean up locks/edits/deletions for removed records
        const updatedLockRows = { ...this._lockedRows };
        const updatedEdited = { ...this._editedRows };
        const updatedDeleted = { ...this._deletedRows };
        removedIds.forEach(id => {
            delete updatedLockRows[id];
            delete updatedEdited[id];
            delete updatedDeleted[id];
        });
        this._lockedRows = updatedLockRows;
        this._editedRows = updatedEdited;
        this._deletedRows = updatedDeleted;

        const updatedLockedSections = { ...this._lockedSections };
        delete updatedLockedSections[key];
        this._lockedSections = updatedLockedSections;
    }

    // ── Regenerate section (placeholder — fires event for parent to handle) ──
    handleRegenerateSection(event) {
        event.stopPropagation();
        const key = event.currentTarget.dataset.key;
        this._showToast('Regenerate', `Re-generation for "${key}" section is not yet connected to a flow.`, 'info');
    }

    // ── Scroll to first error ────────────────────────────────────────────────
    handleScrollToError() {
        const errorRow = this.template.querySelector('.wph-row-error');
        if (errorRow) {
            errorRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    // ── Meeting type ─────────────────────────────────────────────────────────
    get meetingTypeOptions() {
        return [
            { label: '-- Select Meeting Category --', value: '' },
            { label: 'First Meeting', value: 'first' },
            { label: 'Status Meeting', value: 'status' },
            { label: 'Other', value: 'other' }
        ];
    }

    // ── Feature mode buttons ─────────────────────────────────────────────────
    get modeWealthPlanClass()     { return this._modeWealthPlan     ? 'wph-mode-btn active' : 'wph-mode-btn'; }
    get modeMeetingSummaryClass() { return this._modeMeetingSummary ? 'wph-mode-btn active' : 'wph-mode-btn'; }
    get modeOtherClass()          { return this._modeOther          ? 'wph-mode-btn active' : 'wph-mode-btn'; }

    // Mode pill classes (compact pill selector replaces large mode cards)
    get modeWealthPlanCardClass()     { return `wph-mode-pill${this._modeWealthPlan     ? ' wph-mode-pill-active' : ''}`; }
    get modeMeetingSummaryCardClass() { return `wph-mode-pill${this._modeMeetingSummary ? ' wph-mode-pill-active' : ''}`; }
    get modeOtherCardClass()          { return `wph-mode-pill${this._modeOther          ? ' wph-mode-pill-active' : ''}`; }
    get modeExistingOnlyCardClass()   { return `wph-mode-pill${this._modeExistingOnly   ? ' wph-mode-pill-active-amber' : ''}`; }

    // Meeting Summary accordion classes
    get msTypeBodyClass() {
        const required = (!!this._selectedEventId && !this._selectedMeetingType) ? ' wph-body--required' : '';
        return (this._msTypeOpen ? 'wph-zone-collapse-body' : 'wph-zone-collapse-body wph-zone-collapse-hidden') + required;
    }
    get msInputBodyClass()   { return this._msInputOpen ? 'wph-zone-collapse-body' : 'wph-zone-collapse-body wph-zone-collapse-hidden'; }
    get msNotesBodyClass()   { return this._msNotesOpen ? 'wph-zone-collapse-body' : 'wph-zone-collapse-body wph-zone-collapse-hidden'; }
    get msRegenBodyClass()   { return this._msRegenOpen ? 'wph-zone-collapse-body' : 'wph-zone-collapse-body wph-zone-collapse-hidden'; }
    get msTypeChevronClass() { return this._msTypeOpen  ? 'wph-collapse-chevron wph-chevron-open' : 'wph-collapse-chevron'; }
    get msTypeSectionClass() {
        const needsCategory = !!this._selectedEventId && !this._selectedMeetingType;
        return 'wph-wp-section-strip wph-ms-section-first' +
               (needsCategory ? ' wph-ms-section--needs-category' : '');
    }
    get msInputChevronClass()     { return this._msInputOpen     ? 'wph-collapse-chevron wph-chevron-open' : 'wph-collapse-chevron'; }
    get msDocUploadBodyClass()    { return this._msDocUploadOpen ? 'wph-zone-collapse-body' : 'wph-zone-collapse-body wph-zone-collapse-hidden'; }
    get msDocUploadChevronClass() { return this._msDocUploadOpen ? 'wph-collapse-chevron wph-chevron-open' : 'wph-collapse-chevron'; }
    get msNotesChevronClass()     { return this._msNotesOpen     ? 'wph-collapse-chevron wph-chevron-open' : 'wph-collapse-chevron'; }
    get msRegenChevronClass()     { return this._msRegenOpen     ? 'wph-collapse-chevron wph-chevron-open' : 'wph-collapse-chevron'; }
    get msInputBadgeLabel()  {
        const n = this.noNoteArtifactFiles?.length || 0;
        return n > 0 ? `${n} file${n > 1 ? 's' : ''}` : '';
    }
    get msInputBadgeClass()  {
        return (this.noNoteArtifactFiles?.length > 0) ? 'wph-zone-collapse-badge wph-zcb-green' : 'wph-zone-collapse-badge';
    }
    get msDocUploadBadgeLabel()  {
        const n = (this._sharedFiles || []).filter(f => f.included).length;
        return n > 0 ? `${n} file${n > 1 ? 's' : ''}` : '';
    }
    get msDocUploadBadgeClass()  {
        return (this._sharedFiles || []).some(f => f.included) ? 'wph-zone-collapse-badge wph-zcb-green' : 'wph-zone-collapse-badge';
    }
    get noNoteAtLimit()           { return this._totalNoNoteFileCount >= 3; }
    get msNotesBadgeLabel()  { return (this._freeText || '').trim().length > 0 ? 'Has notes' : ''; }
    get msNotesBadgeClass()  { return (this._freeText || '').trim().length > 0 ? 'wph-zone-collapse-badge wph-zcb-blue' : 'wph-zone-collapse-badge'; }

    // Collapsible input zone classes
    get wpNotesZoneBodyClass()   { return this._wpNotesExpanded   ? 'wph-zone-collapse-body' : 'wph-zone-collapse-body wph-zone-collapse-hidden'; }
    get docZoneBodyClass()       { return this._docExpanded       ? 'wph-zone-collapse-body' : 'wph-zone-collapse-body wph-zone-collapse-hidden'; }
    get artifactsZoneBodyClass() { return this._artifactsExpanded ? 'wph-zone-collapse-body' : 'wph-zone-collapse-body wph-zone-collapse-hidden'; }
    get wpNotesChevronClass()    { return this._wpNotesExpanded   ? 'wph-collapse-chevron wph-chevron-open' : 'wph-collapse-chevron'; }
    get docChevronClass()        { return this._docExpanded       ? 'wph-collapse-chevron wph-chevron-open' : 'wph-collapse-chevron'; }
    get artifactsChevronClass()  { return this._artifactsExpanded ? 'wph-collapse-chevron wph-chevron-open' : 'wph-collapse-chevron'; }
    get wpTipsChevronClass()     { return this._showWpTips  ? 'wph-chevron wph-chevron-up' : 'wph-chevron'; }
    get msTipsChevronClass()     { return this._showMsTips  ? 'wph-chevron wph-chevron-up' : 'wph-chevron'; }
    get hasSelectedTasks()       { return this.selectedTaskCount > 0; }
    get hasSelectedArtifact()    { return this._selectedArtifactFileIds.size > 0; }
    get selectedArtifactCount()  { return this._selectedArtifactFileIds.size; }
    get docBadgeClass()          { return this.hasFile ? 'wph-zone-collapse-badge wph-zone-collapse-badge-ready' : 'wph-zone-collapse-badge'; }
    get docBadgeLabel()          { const n = this._sharedFiles.length; return n > 0 ? `${n} file${n > 1 ? 's' : ''} staged` : 'No file'; }
    get meetingSummaryArtifactClass() {
        return this._includeMeetingSummary
            ? 'wph-artifact-file-row wph-artifact-summary-row wph-artifact-summary-row-selected'
            : 'wph-artifact-file-row wph-artifact-summary-row';
    }
    get artifactsBadgeClass() {
        return (this.hasSelectedArtifact || this.hasSelectedTasks || (this._includeMeetingSummary && this.hasMeetingSummaryInput))
            ? 'wph-zone-collapse-badge wph-zone-collapse-badge-ready'
            : 'wph-zone-collapse-badge';
    }
    get artifactsBadgeLabel() {
        const summary = (this._includeMeetingSummary && this.hasMeetingSummaryInput) ? 'summary' : '';
        const cnt     = this._selectedArtifactFileIds.size;
        const file    = cnt > 0 ? `${cnt} file${cnt > 1 ? 's' : ''}` : '';
        const tasks   = this.selectedTaskCount > 0 ? `${this.selectedTaskCount} task${this.selectedTaskCount > 1 ? 's' : ''}` : '';
        return [summary, file, tasks].filter(Boolean).join(', ') || 'None selected';
    }

    get wpSelectionChips() {
        const chips = [];
        if (this._includeMeetingSummary && this.hasMeetingSummaryInput) {
            chips.push({ key: 'summary', label: 'Summary', cls: 'wph-artifact-type-tag wph-artifact-type-summary' });
        }
        for (const file of this.artifactFiles) {
            if (file.isSelected) {
                chips.push({ key: file.id, label: file.fileType || 'FILE', cls: file.tagClass || 'wph-artifact-type-tag' });
            }
        }
        if (this.selectedTaskCount > 0) {
            chips.push({ key: 'tasks', label: `${this.selectedTaskCount} task${this.selectedTaskCount > 1 ? 's' : ''}`, cls: 'wph-artifact-type-tag' });
        }
        return chips;
    }
    get hasWpSelection() { return this.wpSelectionChips.length > 0; }

    get hasAnyModeSelected() { return this._modeWealthPlan || this._modeMeetingSummary || this._modeOther || this._modeExistingOnly; }
    get isOnlyMeetingSummary() { return this._modeMeetingSummary && !this._modeWealthPlan; }
    get isWealthPlanEnabled() { return this._modeWealthPlan || this._modeExistingOnly; }
    get isMeetingSummaryEnabled() { return this._modeMeetingSummary; }
    get hasMeetingSummary() { return this._meetingSummaryResult && this._meetingSummaryResult.trim().length > 0; }
    get hideInputZones()     { return this._modeExistingOnly; }
    get generateButtonLabel() {
        return this._modeExistingOnly ? 'Load Existing Wealth Plan' : 'Analyze & Structure Wealth Plan';
    }
    get existingDataSummaryItems() {
        const labelMap = {
            goals: 'Financial Goals', income: 'Income Streams',
            assets: 'Assets & Liabilities', milestones: 'Household Milestones',
            ownership: 'Company Ownership', sustainability: 'Sustainability Preferences',
            greetings: 'Personal Greeting',
        };
        const edm = this._existingDataMap;
        return Object.entries(labelMap).map(([key, label]) => {
            const count = (edm[key] || []).length;
            return {
                key, label,
                hasData: count > 0,
                countLabel: count === 1 ? '1 record' : `${count} records`,
                itemClass: count > 0
                    ? 'wph-existing-summary-item wph-existing-has-data'
                    : 'wph-existing-summary-item wph-existing-empty',
            };
        });
    }

    handleModeToggle(event) {
        if (this.eventSelectionRequired) return;  // must select an event first
        const mode = event.currentTarget.dataset.mode;
        if (mode === 'existingonly') {
            const turningOn = !this._modeExistingOnly;
            this._modeExistingOnly = turningOn;
            if (turningOn) {
                this._modeWealthPlan = false;
                this._modeMeetingSummary = false;
                this._modeOther = false;
            }
        } else {
            if (mode === 'wealthplan')   this._modeWealthPlan = !this._modeWealthPlan;
            else if (mode === 'summary') this._modeMeetingSummary = !this._modeMeetingSummary;
            else if (mode === 'other')   this._modeOther = !this._modeOther;
            if (this._modeWealthPlan || this._modeMeetingSummary || this._modeOther) {
                this._modeExistingOnly = false;
            }
        }
    }

    handleToggleSummaryTab() { this._summaryTabOpen = !this._summaryTabOpen; }
    get summaryTabClass()      { return this._summaryTabOpen ? 'wph-summary-tab wph-summary-open' : 'wph-summary-tab'; }
    get summaryChevronClass()  { return this._summaryTabOpen ? 'wph-summary-chevron open' : 'wph-summary-chevron'; }

    @track _summaryCopied = false;
    get summaryCopyClass() { return this._summaryCopied ? 'wph-summary-copy-btn copied' : 'wph-summary-copy-btn'; }
    get summaryCopyLabel() { return this._summaryCopied ? 'Copied!' : 'Copy'; }

    handleCopySummary(event) {
        event.stopPropagation();
        if (!this._meetingSummaryResult) return;
        // Strip HTML tags for plain text copy
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = this._meetingSummaryResult;
        const plainText = tempDiv.textContent || tempDiv.innerText || '';
        navigator.clipboard.writeText(plainText).then(() => {
            this._summaryCopied = true;
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => { this._summaryCopied = false; }, 2000);
        }).catch(() => {
            this._showToast('Copy Failed', 'Could not copy to clipboard.', 'error');
        });
    }

    // ── Existing data ────────────────────────────────────────────────────────
    get _existingDataMap() {
        return {
            goals:          this.inputExistingGoals,
            income:         this.inputExistingIncomes,
            assets:         this.inputExistingAssets,
            milestones:     this.inputExistingMilestones,
            ownership:      this.inputExistingOwnerships,
            sustainability: this.inputExistingSustainability,
            greetings:      this.inputExistingGreetings,
        };
    }

    get hasExistingData() {
        return Object.values(this._existingDataMap).some(arr => arr && arr.length > 0);
    }

    get existingDataLabel() {
        if (this._showExistingData) return 'Hide Existing Data';
        const count = Object.values(this._existingDataMap).reduce((sum, arr) => sum + ((arr && arr.length) || 0), 0);
        return count > 0 ? `Show Existing Data (${count})` : 'No Existing Data';
    }

    handleToggleExistingData() {
        this._showExistingData = !this._showExistingData;
        if (this._showExistingData && !this._existingLoaded) {
            this._mergeExistingData();
            this._existingLoaded = true;
        } else if (!this._showExistingData) {
            this._removeExistingFromSections();
            this._existingLoaded = false;
        }
    }

    _mergeExistingData() {
        const existingMap = this._existingDataMap;
        const sections = this._sections.map(s => {
            const existingRaw = existingMap[s.key];
            if (!existingRaw || !existingRaw.length) return s;

            const parsed = JSON.parse(JSON.stringify(existingRaw));
            const existingRecords = parsed.map((rec, i) => ({
                ...rec,
                _id: `EX_${s.key}_${rec.Id || i}_${Date.now()}`,
                _source: 'existing',
                _sfId: rec.Id || null, // preserve Salesforce Id for updates
            }));

            // Feature 2: Snapshot existing records for diff view
            this._snapshotExistingRecords(existingRecords);

            const section = { ...s };
            section.records = [...existingRecords, ...section.records];
            section.count = section.records.length;
            section.hasRecords = section.records.length > 0;
            return section;
        });
        this._sections = sections;

        // Feature 7: Detect duplicates between AI and existing records
        this._detectDuplicates();
    }

    _removeExistingFromSections() {
        const sections = this._sections.map(s => {
            const section = { ...s };
            section.records = section.records.filter(r => r._source !== 'existing');
            section.count = section.records.length;
            section.hasRecords = section.records.length > 0;
            return section;
        });
        this._sections = sections;
        this._deletedRows = {};
    }

    // ── Delete existing record (mark for deletion) ───────────────────────────
    handleMarkForDeletion(event) {
        const id = event.currentTarget.dataset.id;
        this._deletedRows = { ...this._deletedRows, [id]: true };
        this._pushUndo({ type: 'markDelete', recId: id });
    }

    handleUndoDeletion(event) {
        const id = event.currentTarget.dataset.id;
        const updated = { ...this._deletedRows };
        delete updated[id];
        this._deletedRows = updated;
        this._pushUndo({ type: 'unmarkDelete', recId: id });
    }

    // ── Section expand/collapse ──────────────────────────────────────────────
    handleToggleSection(event) {
        const key = event.currentTarget.dataset.key;
        const isOpen = !!this._expandedSections[key];
        if (!isOpen && !this._allExpanded) {
            // Accordion: open only this section, collapse all others
            this._expandedSections = { [key]: true };
        } else {
            const updated = { ...this._expandedSections };
            updated[key] = !updated[key];
            this._expandedSections = updated;
        }
    }

    // ── Row editing ──────────────────────────────────────────────────────────
    handleEditRow(event) {
        const recId = event.currentTarget.dataset.id;
        const sectionKey = event.currentTarget.dataset.section;
        this._editingRow = { recId, sectionKey };
        // Snapshot field values at edit start for undo (one undo per field)
        this._editingFieldSnapshot = {};
    }

    handleCancelEdit() {
        this._editingRow = null;
        this._editingFieldSnapshot = {};
        this._ownerPropagationPrompt = null;
    }

    handleFieldChange(event) {
        if (!this._editingRow) return;
        const fieldApi = event.currentTarget.dataset.field;
        let value = event.currentTarget.type === 'checkbox' ? event.currentTarget.checked : event.currentTarget.value;
        if (event.currentTarget.type === 'number' && value !== '') value = parseFloat(value);

        // Find the section and record by stable id
        const secIdx = this._sections.findIndex(s => s.key === this._editingRow.sectionKey);
        if (secIdx === -1) return;
        const section = { ...this._sections[secIdx] };
        const records = [...section.records];
        const recIdx = records.findIndex(r => r._id === this._editingRow.recId);
        if (recIdx === -1) return;
        const rec = records[recIdx];
        const oldValue = rec[fieldApi];

        // Skip if no actual change
        if (String(oldValue || '') === String(value || '')) return;

        // Undo: push on first change per field per edit session
        if (!(fieldApi in this._editingFieldSnapshot)) {
            this._editingFieldSnapshot[fieldApi] = oldValue;
            this._pushUndo({ type: 'edit', sectionKey: this._editingRow.sectionKey, recId: rec._id, fieldApi, oldValue, newValue: value });
        } else {
            // Update the newValue in the existing undo entry (latest keystroke wins)
            const stack = [...this._undoStack];
            for (let i = stack.length - 1; i >= 0; i--) {
                if (stack[i].type === 'edit' && stack[i].recId === rec._id && stack[i].fieldApi === fieldApi) {
                    stack[i] = { ...stack[i], newValue: value };
                    break;
                }
            }
            this._undoStack = stack;
        }

        // Update the record
        records[recIdx] = { ...rec, [fieldApi]: value };
        section.records = records;
        const sections = [...this._sections];
        sections[secIdx] = section;
        this._sections = sections;

        // Track edit by stable record._id (for AI and existing records)
        if (rec._source === 'ai' || rec._source === 'existing') {
            this._editedRows = { ...this._editedRows, [rec._id]: true };
        }

        // Smart owner propagation — show inline prompt when an owner field is set
        // and other unlocked records in the same section would benefit from the same value
        if (OWNER_FIELD_APIS.has(fieldApi)) {
            if (value) {
                const sectionKey = this._editingRow.sectionKey;
                const secDef = SECTIONS.find(d => d.key === sectionKey);
                const fieldDef = secDef ? secDef.fields.find(f => f.api === fieldApi) : null;
                const ownerOpts = this._buildOwnerOptions();
                const ownerOpt = ownerOpts.find(o => o.value === value);
                const ownerLabel = ownerOpt ? ownerOpt.label : value;
                const eligibleCount = records.filter(r =>
                    r._id !== rec._id &&
                    !this._lockedRows[r._id] &&
                    !this._lockedSections[sectionKey] &&
                    !(r._source === 'existing' && this._deletedRows[r._id]) &&
                    r[fieldApi] !== value
                ).length;
                if (eligibleCount > 0) {
                    this._ownerPropagationPrompt = {
                        sectionKey, fieldApi,
                        fieldLabel: fieldDef ? fieldDef.label : fieldApi,
                        value, ownerLabel, count: eligibleCount
                    };
                } else {
                    this._ownerPropagationPrompt = null;
                }
            } else {
                this._ownerPropagationPrompt = null;
            }
        }
    }

    handleSaveRow() {
        this._editingRow = null;
        this._ownerPropagationPrompt = null;
    }

    handleApplyOwnerPropagation() {
        const p = this._ownerPropagationPrompt;
        if (!p) return;
        const { sectionKey, fieldApi, value } = p;
        const secIdx = this._sections.findIndex(s => s.key === sectionKey);
        if (secIdx === -1) return;
        const section = { ...this._sections[secIdx] };
        const editingId = this._editingRow ? this._editingRow.recId : null;
        const updatedEditedRows = { ...this._editedRows };
        section.records = section.records.map(r => {
            const isLocked    = !!this._lockedRows[r._id] || !!this._lockedSections[sectionKey];
            const isDeleted   = r._source === 'existing' && !!this._deletedRows[r._id];
            const isEditing   = r._id === editingId;
            if (!isLocked && !isDeleted && !isEditing && r[fieldApi] !== value) {
                if (r._source === 'ai' || r._source === 'existing') updatedEditedRows[r._id] = true;
                return { ...r, [fieldApi]: value };
            }
            return r;
        });
        this._editedRows = updatedEditedRows;
        const sections = [...this._sections];
        sections[secIdx] = section;
        this._sections = sections;
        this._ownerPropagationPrompt = null;
    }

    handleDismissOwnerPropagation() {
        this._ownerPropagationPrompt = null;
    }

    // ── Add / Remove rows ────────────────────────────────────────────────────
    handleAddRow(event) {
        const key = event.currentTarget.dataset.key;
        const secIdx = this._sections.findIndex(s => s.key === key);
        if (secIdx === -1) return;

        const section = { ...this._sections[secIdx] };
        const newRec = { _id: `MAN_${key}_${Date.now()}`, _source: 'manual' };
        section.fields.forEach(f => {
            if (f.type === 'checkbox') newRec[f.api] = false;
            else if (f.type === 'number') newRec[f.api] = null;
            else newRec[f.api] = '';
        });
        // Default Primary Owner / Account to primary member when adding manually
        const primaryId = this._resolvedPrimaryMemberId;
        if (primaryId) {
            if (key === 'goals' || key === 'assets') newRec.FinServ__PrimaryOwner__c = primaryId;
            if (key === 'income') newRec.FF_Account__c = primaryId;
        }
        const insertIdx = section.records.length;
        section.records = [...section.records, newRec];
        section.count = section.records.length;
        section.hasRecords = true;

        const sections = [...this._sections];
        sections[secIdx] = section;
        this._sections = sections;

        this._pushUndo({ type: 'add', sectionKey: key, recId: newRec._id, record: { ...newRec }, index: insertIdx });

        // Auto-expand and start editing (accordion: collapse others unless expand-all is active)
        this._expandedSections = this._allExpanded
            ? { ...this._expandedSections, [key]: true }
            : { [key]: true };
        this._editingRow = { sectionKey: key, recId: newRec._id };
    }

    handleRemoveRow(event) {
        const id = event.currentTarget.dataset.id;
        const sectionKey = event.currentTarget.dataset.section;
        const secIdx = this._sections.findIndex(s => s.key === sectionKey);
        if (secIdx === -1) return;

        const section = { ...this._sections[secIdx] };
        const recIdx = section.records.findIndex(r => r._id === id);
        const removedRecord = recIdx !== -1 ? { ...section.records[recIdx] } : null;
        section.records = section.records.filter(r => r._id !== id);
        section.count = section.records.length;
        section.hasRecords = section.records.length > 0;

        const sections = [...this._sections];
        sections[secIdx] = section;
        this._sections = sections;

        if (removedRecord) {
            this._pushUndo({ type: 'delete', sectionKey, recId: id, record: removedRecord, index: recIdx });
        }

        // Clean up locks/edits for this id
        const updLocks = { ...this._lockedRows }; delete updLocks[id]; this._lockedRows = updLocks;
        const updEdits = { ...this._editedRows }; delete updEdits[id]; this._editedRows = updEdits;

        if (this._editingRow && this._editingRow.recId === id) {
            this._editingRow = null;
        }
    }

    // ── Lock row / section ──────────────────────────────────────────────────
    handleLockRow(event) {
        const id = event.currentTarget.dataset.id;
        const optMap = this._selectOptionsMap;
        for (const sec of this._sections) {
            const rec = sec.records.find(r => r._id === id);
            if (!rec) continue;
            const stat = this._computeRecordStat(rec, sec.key, sec.fields, optMap);
            if (stat._hasErrors) {
                this._showToast('Validation Error', 'Please fix all field errors before accepting this record.', 'error');
                return;
            }
            break;
        }
        this._lockedRows = { ...this._lockedRows, [id]: true };
        this._pushUndo({ type: 'lock', recId: id });
    }

    handleUnlockRow(event) {
        const id = event.currentTarget.dataset.id;
        const updated = { ...this._lockedRows };
        delete updated[id];
        this._lockedRows = updated;
        this._pushUndo({ type: 'unlock', recId: id });
    }

    handleLockSection(event) {
        event.stopPropagation();
        const key = event.currentTarget.dataset.key;
        this._lockedSections = { ...this._lockedSections, [key]: true };
        this._pushUndo({ type: 'lockSection', sectionKey: key });
    }

    handleUnlockSection(event) {
        event.stopPropagation();
        const key = event.currentTarget.dataset.key;
        const updated = { ...this._lockedSections };
        delete updated[key];
        this._lockedSections = updated;
        this._pushUndo({ type: 'unlockSection', sectionKey: key });
    }

    // ── Bulk lock all valid rows in a section (Feature 9: shows summary modal) ──
    handleBulkLockSection(event) {
        event.stopPropagation();
        const key = event.currentTarget.dataset.key;
        const sec = this._sections.find(s => s.key === key);
        if (!sec) return;
        const optMap = this._selectOptionsMap;
        let toLock = 0, toSkipErrors = 0, alreadyLocked = 0;
        sec.records.forEach(rec => {
            if (this._lockedRows[rec._id]) { alreadyLocked++; return; }
            const stat = this._computeRecordStat(rec, key, sec.fields, optMap);
            if (stat._hasErrors) toSkipErrors++;
            else toLock++;
        });
        this._bulkLockPreview = { sectionKey: key, sectionLabel: sec.label, toLock, toSkipErrors, alreadyLocked };
        this._showBulkLockConfirm = true;
    }

    // ── Back to input ────────────────────────────────────────────────────────
    handleBackToInput() {
        this._step = 'summary';
        this._activeTab = 'wealthplan';
        this._undoStack = [];
        this._redoStack = [];
        this._focusedRowId = null;
        this._focusedSectionKey = null;
        this._showMeetingTypeModal = false;
        // _selectedEventId kept; meeting type is per-event via _meetingTypeCache
    }
    handleResumeDraft() {
        this._step = 'review';
    }
    handleClearDraft() {
        this._sections = [];
    }

    // ── Save to Flow ─────────────────────────────────────────────────────────
    // Show confirmation before saving
    handlePreviewSave() {
        const keys = ['goals','income','assets','milestones','ownership','sustainability','greetings','todos'];
        const isSectionLockedFn = (key) => !!this._lockedSections[key];
        const isRecLocked = (recId, sectionKey) => !!this._lockedRows[recId] || isSectionLockedFn(sectionKey);

        let totalCreate = 0, totalUpdate = 0, totalDelete = 0;
        const sectionPreviews = [];

        keys.forEach(key => {
            const sec = this._sections.find(s => s.key === key);
            if (!sec) return;
            let create = 0, update = 0, del = 0;
            sec.records.forEach(r => {
                if (r._source === 'existing' && this._deletedRows[r._id]) del++;
                else if (r._source === 'existing' && this._editedRows[r._id] && isRecLocked(r._id, key)) update++;
                else if (r._source !== 'existing' && isRecLocked(r._id, key)) create++;
            });
            if (create + update + del > 0) {
                sectionPreviews.push({ key, label: sec.label, create, update, del });
            }
            totalCreate += create; totalUpdate += update; totalDelete += del;
        });

        if (totalCreate + totalUpdate + totalDelete === 0) {
            this._showToast('Nothing to Save', 'Lock records before saving to Salesforce.', 'warning');
            return;
        }

        // ── Financial Impact delta ───────────────────────────────────────────
        let newAssetNOK = 0, delAssetNOK = 0;
        const assetSec = this._sections.find(s => s.key === 'assets');
        if (assetSec) {
            assetSec.records.forEach(r => {
                const amt = parseFloat(r['FinServ__Amount__c']) || 0;
                if (r._source !== 'existing' && isRecLocked(r._id, 'assets')) newAssetNOK += amt;
                if (r._source === 'existing' && this._deletedRows[r._id])     delAssetNOK += amt;
            });
        }
        const netNOK      = newAssetNOK - delAssetNOK;
        const goalEntry   = sectionPreviews.find(s => s.key === 'goals');
        const incomeEntry = sectionPreviews.find(s => s.key === 'income');
        const goalNet     = (goalEntry?.create   || 0) - (goalEntry?.del   || 0);
        const incomeNet   = (incomeEntry?.create || 0) - (incomeEntry?.del || 0);
        const signFmt = (n) => n >= 0
            ? `+${Math.abs(n).toLocaleString('nb-NO')}`
            : `-${Math.abs(n).toLocaleString('nb-NO')}`;
        const posClass = 'wph-delta-chip wph-delta-pos';
        const negClass = 'wph-delta-chip wph-delta-neg';
        const delta = {
            hasChange:   netNOK !== 0 || goalNet !== 0 || incomeNet !== 0,
            assetLabel:  netNOK !== 0 ? `${signFmt(Math.round(netNOK))} NOK assets` : null,
            assetClass:  netNOK >= 0 ? posClass : negClass,
            goalLabel:   `${goalNet >= 0 ? '+' : ''}${goalNet} goal${Math.abs(goalNet) !== 1 ? 's' : ''}`,
            goalClass:   goalNet >= 0 ? posClass : negClass,
            goalZero:    goalNet === 0,
            incomeLabel: `${incomeNet >= 0 ? '+' : ''}${incomeNet} income stream${Math.abs(incomeNet) !== 1 ? 's' : ''}`,
            incomeClass: incomeNet >= 0 ? posClass : negClass,
            incomeZero:  incomeNet === 0,
        };

        this._savePreview = { create: totalCreate, update: totalUpdate, delete: totalDelete, sections: sectionPreviews, delta };
        this._showSaveConfirm = true;
    }

    handleCancelSave() { this._showSaveConfirm = false; this._savePreview = null; }

    // ── User Guide ───────────────────────────────────────────────────────────
    @track _guideTab = 'reference'; // 'reference' | 'features'

    get guideClass() { return this._guideOpen ? 'wph-guide wph-guide-open' : 'wph-guide'; }
    get guideChevronClass() { return this._guideOpen ? 'wph-guide-chevron open' : 'wph-guide-chevron'; }
    handleToggleGuide() { this._guideOpen = !this._guideOpen; }

    // ── Tour Guide ───────────────────────────────────────────────────────────
    _tourDefs = [
        { selector: '.wph-event-selector-bar',       title: 'Step 1 — Select an Event',      text: 'Start here. Choose the meeting event you want to document. This anchors all context for the AI.',                                     position: 'bottom' },
        { selector: '[data-tour="ms-category"]',     title: 'Step 2 — Meeting Category',          text: 'Tell the AI what kind of meeting this is. This shapes how the summary is structured — Whiteboard, Status, or Annual Review.',         position: 'right'  },
        { selector: '[data-tour="action-items"]',    title: "Step 3 — To-Do's",               text: "Toggle To-Do's on to have the AI automatically extract and list to-do's from the meeting summary.",                               position: 'right'  },
        { selector: '[data-tour="ms-input"]',        title: 'Step 4 — Input & Context',       text: 'Attach supporting files and event documents here. These are sent to the AI as additional context alongside your notes.',              position: 'right'  },
        { selector: '[data-tour="ms-notes"]',        title: 'Step 5 — Manual Notes',          text: 'Type your own free-text notes from the meeting here. The richer and more detailed your notes, the better the AI summary.',           position: 'right'  },
        { selector: '.wph-action-bar-btn--generate', title: 'Step 6 — Generate Summary',      text: 'Click Generate Meeting Summary when you\'re ready. The AI builds your note from all the context you\'ve provided.',                  position: 'top'    },
        { selector: '[data-tour="wp-tab"]',           title: 'Step 7 — Wealth Plan',           text: 'Switch to the Wealth Plan tab to structure client portfolio updates. Results appear in the right panel alongside your configuration.', position: 'bottom' },
        { selector: '.wph-guide-trigger',            title: 'Step 8 — User Guide',            text: 'Click the ? button at any time to open the User Guide — tips, feature descriptions, and what\'s new are all in there.',              position: 'bottom' }
    ];

    get tourStepNum()       { return this._tourStep + 1; }
    get tourStepTotal()     { return this._tourDefs.length; }
    get tourTitle()         { return this._tourDefs[this._tourStep]?.title || ''; }
    get tourText()          { return this._tourDefs[this._tourStep]?.text  || ''; }
    get tourIsLast()        { return this._tourStep >= this._tourDefs.length - 1; }
    get tourNextLabel()     { return this.tourIsLast ? 'Done ✓' : 'Next →'; }
    get tourBubbleClass()   { return `wph-tour-bubble wph-tour-bubble--${this._tourPosition}`; }
    get showTourPrompt() {
        return !this._tourPromptDismissed &&
               !this._selectedEventId &&
               !this._selectedMeetingType &&
               !(this._freeText && this._freeText.trim().length > 0) &&
               this._sharedFiles.length === 0;
    }
    handleStartTour() {
        this._tourPromptDismissed = true;
        this._tourActive = true;
        this._tourStep   = 0;
        this._positionTour();
    }

    handleTourNext() {
        if (this._tourStep < this._tourDefs.length - 1) {
            this._tourStep++;
            this._positionTour();
        } else {
            this._tourActive = false;
        }
    }

    handleTourSkip() {
        this._tourActive = false;
    }

    _positionTour() {
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        requestAnimationFrame(() => {
            // Skip steps whose target element is not currently in the DOM
            while (this._tourStep < this._tourDefs.length) {
                const def = this._tourDefs[this._tourStep];
                if (!def) { this._tourActive = false; return; }
                if (this.template.querySelector(def.selector)) break;
                this._tourStep++;
            }
            if (this._tourStep >= this._tourDefs.length) { this._tourActive = false; return; }
            const def = this._tourDefs[this._tourStep];
            const el = this.template.querySelector(def.selector);
            const r  = el.getBoundingClientRect();
            const W  = 288;
            const BH = 180;
            const G  = 14;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            let top, left, arrowX, arrowY;

            switch (def.position) {
                case 'bottom':
                    left   = Math.max(8, Math.min(r.left + r.width / 2 - W / 2, vw - W - 8));
                    top    = r.bottom + G;
                    arrowX = (r.left + r.width / 2) - left;
                    break;
                case 'top':
                    left   = Math.max(8, Math.min(r.left + r.width / 2 - W / 2, vw - W - 8));
                    top    = Math.max(8, r.top - BH - G);
                    arrowX = (r.left + r.width / 2) - left;
                    break;
                case 'right':
                    left   = Math.min(r.right + G, vw - W - 8);
                    top    = Math.max(8, Math.min(r.top + r.height / 2 - BH / 2, vh - BH - 8));
                    arrowY = (r.top + r.height / 2) - top;
                    break;
                default:
                    left   = Math.max(8, r.left - W - G);
                    top    = Math.max(8, Math.min(r.top + r.height / 2 - BH / 2, vh - BH - 8));
                    arrowY = (r.top + r.height / 2) - top;
            }

            this._tourPosition       = def.position;
            this._tourBubbleStyle    = `top:${top}px;left:${left}px;width:${W}px;`;
            this._tourHighlightStyle = `top:${r.top - 3}px;left:${r.left - 3}px;width:${r.width + 6}px;height:${r.height + 6}px;`;
            this._tourArrowStyle     = arrowX != null
                ? `left:${Math.max(16, Math.min(arrowX, W - 16))}px;`
                : `top:${Math.max(16, arrowY)}px;`;
        });
    }

    // ── Modal overlay getters + handlers ─────────────────────────────────────
    get showLauncher()     { return this.modalMode && !this._modalOpen; }
    get showMainContent()  { return !this.modalMode || this._modalOpen; }
    get rootWrapperClass() { return this.modalMode ? 'wph-overlay-root' : 'wph-inline-root'; }
    get containerClass() {
        const base = this.modalMode ? 'wph-container wph-overlay-panel' : 'wph-container';
        return this._theme === 'corporate' ? `${base} wph-theme-corporate` : base;
    }
    get themeToggleClass()  { return this._theme === 'corporate' ? 'theme-pill-toggle theme-pill-dark' : 'theme-pill-toggle'; }
    get classicBtnClass()   { return `segment-btn${this._theme === 'classic'   ? ' segment-active' : ''}`; }
    get corporateBtnClass() { return `segment-btn${this._theme === 'corporate' ? ' segment-active' : ''}`; }
    handleThemeSwitch(event) { this._theme = event.currentTarget.dataset.theme; }
    get launcherStatusLabel() {
        if (this.isNotePublished)    return 'Meeting summary published';
        if (this.hasSummaryForEvent) return 'Draft summary available';
        if (this._selectedEventId)   return 'Event selected · Ready to generate';
        return 'No event selected';
    }
    handleOpenModal() {
        this._modalOpen = true;
        document.body.style.overflow = 'hidden';
        this._escHandler = (e) => { if (e.key === 'Escape') this.handleCloseModal(); };
        window.addEventListener('keydown', this._escHandler);
    }
    handleCloseModal() {
        this._modalOpen = false;
        document.body.style.overflow = '';
        if (this._escHandler) {
            window.removeEventListener('keydown', this._escHandler);
            this._escHandler = null;
        }
    }

    get isGuideRefTab()      { return this._guideTab === 'reference'; }
    get isGuideFeatTab()     { return this._guideTab === 'features'; }
    get isGuideWhatsNewTab() { return this._guideTab === 'whatsnew'; }
    get guideRefTabClass()      { return this._guideTab === 'reference' ? 'wph-guide-tab active' : 'wph-guide-tab'; }
    get guideFeatTabClass()     { return this._guideTab === 'features'  ? 'wph-guide-tab active' : 'wph-guide-tab'; }
    get guideWhatsNewTabClass() { return this._guideTab === 'whatsnew'  ? 'wph-guide-tab active' : 'wph-guide-tab'; }
    handleGuideTabSwitch(event) { this._guideTab = event.currentTarget.dataset.tab; }

    handleConfirmSave() {
        this._showSaveConfirm = false;
        const preview = this._savePreview;
        this._savePreview = null;
        if (this.wealthPlanSaveFlowApiName) {
            this._invokeWpSaveSubflow(preview);   // new subflow path
        } else {
            this.handleSaveToFlow();              // original path — unchanged
        }
    }

    async _invokeWpSaveSubflow(preview) {
        this._wpSaving = true;
        try {
            const isSectionLocked = (key) => !!this._lockedSections[key];
            const isRecLocked = (recId, key) => !!this._lockedRows[recId] || isSectionLocked(key);

            // Track internal _ids being saved/deleted so we can update view state after success
            const savedIds   = new Set();
            const deletedIds = new Set();

            const route = (key) => {
                const sec = this._sections.find(s => s.key === key);
                if (!sec) return { create: [], update: [], delete: [] };
                const def = SECTIONS.find(d => d.key === key);
                const clean = r => {
                    const c = {};
                    def.fields.forEach(f => { if (r[f.api] != null) c[f.api] = r[f.api]; });
                    if (r._sfId) c.Id = r._sfId;
                    return c;
                };
                const creates = [], updates = [], deletes = [];
                sec.records.forEach(r => {
                    if (r._completed) return;
                    const locked = isRecLocked(r._id, key);
                    if      (r._source === 'existing' && this._deletedRows[r._id]) {
                        deletes.push(clean(r));
                        deletedIds.add(r._id);
                    } else if (r._source === 'existing' && this._editedRows[r._id] && locked) {
                        updates.push(clean(r));
                        savedIds.add(r._id);
                    } else if (r._source !== 'existing' && locked) {
                        creates.push(clean(r));
                        savedIds.add(r._id);
                    }
                });
                return { create: creates, update: updates, delete: deletes };
            };

            const milestones = route('milestones');
            if (this.recordId) {
                milestones.create.forEach(r => { r.RelatedHousehold__c = this.recordId; });
                milestones.update.forEach(r => { r.RelatedHousehold__c = this.recordId; });
            }

            const greetings = route('greetings');
            if (this.recordId) {
                greetings.create.forEach(r => { r.FF_HouseholdId__c = this.recordId; });
                greetings.update.forEach(r => { r.FF_HouseholdId__c = this.recordId; });
            }
            [...greetings.create, ...greetings.update].forEach(r => {
                if (r.FF_personalGreeting__c) r.FF_personalGreeting__c = _stripHtmlToText(r.FF_personalGreeting__c);
            });

            const payload = {
                goals:          route('goals'),
                income:         route('income'),
                assets:         route('assets'),
                milestones,
                ownership:      route('ownership'),
                sustainability: route('sustainability'),
                greetings,
                todos:          route('todos')
            };

            await saveWealthPlan({
                flowApiName: this.wealthPlanSaveFlowApiName,
                recordsJson: JSON.stringify(payload),
                accountId:   this.inputAccountId || ''
            });

            this._applySaveResult(savedIds, deletedIds, preview);
        } catch (e) {
            this._showToast('Save Error', e.body?.message || 'An error occurred while saving the Wealth Plan.', 'error');
        } finally {
            this._wpSaving = false;
        }
    }

    _applySaveResult(savedIds, deletedIds, preview) {
        // Remove deleted records; mark saved records as completed (non-editable)
        this._sections = this._sections.map(sec => ({
            ...sec,
            records: sec.records
                .filter(r => !deletedIds.has(r._id))
                .map(r => savedIds.has(r._id) ? { ...r, _completed: true } : r)
        }));

        // Clear all pending state — next save starts from a clean slate
        this._lockedRows     = {};
        this._lockedSections = {};
        this._editedRows     = {};
        this._deletedRows    = {};

        // Show compact save notice banner above the sections
        this._wpSaveNotice = {
            totalNew:     preview?.create   || 0,
            totalUpdated: preview?.update   || 0,
            totalDeleted: preview?.delete   || 0
        };
    }

    handleWpNoticeDismiss() {
        this._wpSaveNotice = null;
    }

    handleSaveTodosOnly() {
        const sec = this._sections?.find(s => s.key === 'todos');
        const def = SECTIONS.find(d => d.key === 'todos');
        const toCreate = [];
        if (sec && def) {
            const sectionLocked = !!this._lockedSections['todos'];
            sec.records.forEach(r => {
                if ((!!this._lockedRows[r._id] || sectionLocked) && r._source !== 'existing') {
                    const clean = {};
                    def.fields.forEach(f => { if (r[f.api] != null) clean[f.api] = r[f.api]; });
                    toCreate.push(clean);
                }
            });
        }
        this.outputTodos = toCreate;
        this.dispatchEvent(new FlowAttributeChangeEvent('outputTodos', toCreate));
        this._showToast('To-dos Saved', `${toCreate.length} to-do${toCreate.length !== 1 ? 's' : ''} saved`, 'success');
    }

    handleSaveToFlow() {

        // Route records by stable record._id (not array index, which shifts)
        const isSectionLocked = (key) => !!this._lockedSections[key];
        const isRecLocked = (recId, sectionKey) => !!this._lockedRows[recId] || isSectionLocked(sectionKey);

        const routeSection = (key) => {
            const sec = this._sections.find(s => s.key === key);
            if (!sec) return { toCreate: [], toUpdate: [], toDelete: [] };
            const def = SECTIONS.find(d => d.key === key);
            const cleanRec = r => {
                const clean = {};
                def.fields.forEach(f => { if (r[f.api] != null) clean[f.api] = r[f.api]; });
                if (r._sfId) clean.Id = r._sfId;
                return clean;
            };

            const toCreate = [];
            const toUpdate = [];
            const toDelete = [];

            sec.records.forEach(r => {
                const locked = isRecLocked(r._id, key);
                if (r._source === 'existing' && this._deletedRows[r._id]) {
                    toDelete.push(cleanRec(r));
                } else if (r._source === 'existing' && this._editedRows[r._id] && locked) {
                    toUpdate.push(cleanRec(r));
                } else if (r._source !== 'existing' && locked) {
                    toCreate.push(cleanRec(r));
                }
            });

            return { toCreate, toUpdate, toDelete };
        };

        const goals = routeSection('goals');
        const income = routeSection('income');
        const assets = routeSection('assets');
        const milestones = routeSection('milestones');
        if (this.recordId) {
            milestones.toCreate.forEach(r => { r.RelatedHousehold__c = this.recordId; });
            milestones.toUpdate.forEach(r => { r.RelatedHousehold__c = this.recordId; });
        }
        const ownership = routeSection('ownership');
        const sustainability = routeSection('sustainability');
        const greetings = routeSection('greetings');
        const todos = routeSection('todos');

        this.outputSummary        = this._summary;

        // New records (create)
        this.outputGoals          = goals.toCreate;
        this.outputIncomes        = income.toCreate;
        this.outputAssets         = assets.toCreate;
        this.outputMilestones     = milestones.toCreate;
        this.outputOwnerships     = ownership.toCreate;
        this.outputSustainability = sustainability.toCreate;
        this.outputGreetings      = greetings.toCreate;
        this.outputTodos          = todos.toCreate;

        // Modified existing (update)
        this.outputGoalsToUpdate          = goals.toUpdate;
        this.outputIncomesToUpdate        = income.toUpdate;
        this.outputAssetsToUpdate         = assets.toUpdate;
        this.outputMilestonesToUpdate     = milestones.toUpdate;
        this.outputOwnershipsToUpdate     = ownership.toUpdate;
        this.outputSustainabilityToUpdate = sustainability.toUpdate;
        this.outputGreetingsToUpdate      = greetings.toUpdate;

        // Existing marked for deletion
        this.outputGoalsToDelete          = goals.toDelete;
        this.outputIncomesToDelete        = income.toDelete;
        this.outputAssetsToDelete         = assets.toDelete;
        this.outputMilestonesToDelete     = milestones.toDelete;
        this.outputOwnershipsToDelete     = ownership.toDelete;
        this.outputSustainabilityToDelete = sustainability.toDelete;
        this.outputGreetingsToDelete      = greetings.toDelete;

        // Dispatch all
        const outputs = [
            'outputSummary', 'outputGoals', 'outputIncomes', 'outputAssets',
            'outputMilestones', 'outputOwnerships', 'outputSustainability', 'outputGreetings', 'outputTodos',
            'outputGoalsToUpdate', 'outputIncomesToUpdate', 'outputAssetsToUpdate',
            'outputMilestonesToUpdate', 'outputOwnershipsToUpdate', 'outputSustainabilityToUpdate', 'outputGreetingsToUpdate',
            'outputGoalsToDelete', 'outputIncomesToDelete', 'outputAssetsToDelete',
            'outputMilestonesToDelete', 'outputOwnershipsToDelete', 'outputSustainabilityToDelete', 'outputGreetingsToDelete'
        ];
        outputs.forEach(name => {
            // Ensure collections are always arrays (never null/undefined) so Flow DML doesn't fail
            const val = this[name];
            const safeVal = (name === 'outputSummary') ? (val || '') : (Array.isArray(val) ? val : []);
            this[name] = safeVal;
            this.dispatchEvent(new FlowAttributeChangeEvent(name, safeVal));
        });

        const totalNew = goals.toCreate.length + income.toCreate.length + assets.toCreate.length +
            milestones.toCreate.length + ownership.toCreate.length + sustainability.toCreate.length +
            greetings.toCreate.length + todos.toCreate.length;
        const totalUpdated = goals.toUpdate.length + income.toUpdate.length + assets.toUpdate.length +
            milestones.toUpdate.length + ownership.toUpdate.length + sustainability.toUpdate.length + greetings.toUpdate.length;
        const totalDeleted = goals.toDelete.length + income.toDelete.length + assets.toDelete.length +
            milestones.toDelete.length + ownership.toDelete.length + sustainability.toDelete.length + greetings.toDelete.length;

        this._showToast('Saved', `${totalNew} new, ${totalUpdated} updated, ${totalDeleted} deleted.`, 'success');

        try { this.dispatchEvent(new FlowNavigationNextEvent()); } catch (e) { /* not in flow */ }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FEATURE 10: UNDO / REDO
    // ══════════════════════════════════════════════════════════════════════════

    _pushUndo(action) {
        const stack = this._undoStack.length >= 50
            ? [...this._undoStack.slice(1), action]
            : [...this._undoStack, action];
        this._undoStack = stack;
        this._redoStack = [];
    }

    get canUndo() { return this._undoStack.length > 0; }
    get canRedo() { return this._redoStack.length > 0; }
    get cantUndo() { return !this.canUndo; }
    get cantRedo() { return !this.canRedo; }

    handleUndo() {
        if (!this.canUndo) return;
        const stack = [...this._undoStack];
        const action = stack.pop();
        this._undoStack = stack;
        const inverse = this._applyUndoAction(action);
        if (inverse) this._redoStack = [...this._redoStack, inverse];
    }

    handleRedo() {
        if (!this.canRedo) return;
        const stack = [...this._redoStack];
        const action = stack.pop();
        this._redoStack = stack;
        const inverse = this._applyRedoAction(action);
        if (inverse) this._undoStack = [...this._undoStack, inverse];
    }

    _applyUndoAction(action) {
        switch (action.type) {
            case 'edit': {
                this._applyFieldValue(action.sectionKey, action.recId, action.fieldApi, action.oldValue);
                return { ...action, oldValue: action.newValue, newValue: action.oldValue };
            }
            case 'lock': {
                const u = { ...this._lockedRows }; delete u[action.recId]; this._lockedRows = u;
                return { type: 'unlock', recId: action.recId };
            }
            case 'unlock': {
                this._lockedRows = { ...this._lockedRows, [action.recId]: true };
                return { type: 'lock', recId: action.recId };
            }
            case 'lockSection': {
                const u = { ...this._lockedSections }; delete u[action.sectionKey]; this._lockedSections = u;
                return { type: 'unlockSection', sectionKey: action.sectionKey };
            }
            case 'unlockSection': {
                this._lockedSections = { ...this._lockedSections, [action.sectionKey]: true };
                return { type: 'lockSection', sectionKey: action.sectionKey };
            }
            case 'add': {
                this._removeRecordById(action.sectionKey, action.recId);
                return { type: 'delete', sectionKey: action.sectionKey, recId: action.recId, record: action.record, index: action.index };
            }
            case 'delete': {
                this._insertRecordAt(action.sectionKey, action.record, action.index);
                return { type: 'add', sectionKey: action.sectionKey, recId: action.recId, record: action.record, index: action.index };
            }
            case 'markDelete': {
                const u = { ...this._deletedRows }; delete u[action.recId]; this._deletedRows = u;
                return { type: 'unmarkDelete', recId: action.recId };
            }
            case 'unmarkDelete': {
                this._deletedRows = { ...this._deletedRows, [action.recId]: true };
                return { type: 'markDelete', recId: action.recId };
            }
            case 'batchLock': {
                const u = { ...this._lockedRows };
                action.ids.forEach(id => delete u[id]);
                this._lockedRows = u;
                return { type: 'batchUnlock', ids: action.ids, sectionKey: action.sectionKey };
            }
            case 'batchUnlock': {
                const u = { ...this._lockedRows };
                action.ids.forEach(id => { u[id] = true; });
                this._lockedRows = u;
                return { type: 'batchLock', ids: action.ids, sectionKey: action.sectionKey };
            }
            default: return null;
        }
    }

    _applyRedoAction(action) {
        // Redo is the same as applying the inverse of undo — just swap old/new
        return this._applyUndoAction(action);
    }

    _applyFieldValue(sectionKey, recId, fieldApi, value) {
        const secIdx = this._sections.findIndex(s => s.key === sectionKey);
        if (secIdx === -1) return;
        const section = { ...this._sections[secIdx] };
        const records = [...section.records];
        const recIdx = records.findIndex(r => r._id === recId);
        if (recIdx === -1) return;
        records[recIdx] = { ...records[recIdx], [fieldApi]: value };
        section.records = records;
        const sections = [...this._sections];
        sections[secIdx] = section;
        this._sections = sections;
    }

    _removeRecordById(sectionKey, recId) {
        const secIdx = this._sections.findIndex(s => s.key === sectionKey);
        if (secIdx === -1) return;
        const section = { ...this._sections[secIdx] };
        section.records = section.records.filter(r => r._id !== recId);
        section.count = section.records.length;
        section.hasRecords = section.records.length > 0;
        const sections = [...this._sections];
        sections[secIdx] = section;
        this._sections = sections;
        // Clean up state
        const uL = { ...this._lockedRows }; delete uL[recId]; this._lockedRows = uL;
        const uE = { ...this._editedRows }; delete uE[recId]; this._editedRows = uE;
    }

    _insertRecordAt(sectionKey, record, index) {
        const secIdx = this._sections.findIndex(s => s.key === sectionKey);
        if (secIdx === -1) return;
        const section = { ...this._sections[secIdx] };
        const records = [...section.records];
        records.splice(index, 0, record);
        section.records = records;
        section.count = records.length;
        section.hasRecords = true;
        const sections = [...this._sections];
        sections[secIdx] = section;
        this._sections = sections;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FEATURE 2: DIFF VIEW FOR EXISTING RECORDS
    // ══════════════════════════════════════════════════════════════════════════

    _snapshotExistingRecords(existingRecords) {
        const snapshots = { ...this._existingSnapshots };
        existingRecords.forEach(rec => {
            const sfId = rec._sfId || rec._id;
            if (!snapshots[sfId]) {
                const snap = {};
                Object.keys(rec).forEach(k => {
                    if (!k.startsWith('_')) snap[k] = rec[k];
                });
                snapshots[sfId] = snap;
            }
        });
        this._existingSnapshots = snapshots;
    }

    handleToggleDiffView(event) {
        event.stopPropagation();
        const id = event.currentTarget.dataset.id;
        this._diffVisibleRows = { ...this._diffVisibleRows, [id]: !this._diffVisibleRows[id] };
    }

    _getDiffFields(rec, sectionFields) {
        const sfId = rec._sfId || rec._id;
        const snapshot = this._existingSnapshots[sfId];
        if (!snapshot) return [];
        const optMap = this._selectOptionsMap;
        const diffs = [];
        sectionFields.forEach(f => {
            const oldVal = snapshot[f.api] != null ? String(snapshot[f.api]) : '';
            const newVal = rec[f.api] != null ? String(rec[f.api]) : '';
            if (oldVal !== newVal) {
                let oldDisplay = oldVal;
                let newDisplay = newVal;
                // Resolve select values to labels
                if (f.type === 'select' && f.selectKey) {
                    const opts = optMap[f.selectKey] || [];
                    const oldOpt = opts.find(o => o.value === oldVal);
                    const newOpt = opts.find(o => o.value === newVal);
                    if (oldOpt) oldDisplay = oldOpt.label;
                    if (newOpt) newDisplay = newOpt.label;
                }
                diffs.push({
                    api: f.api,
                    label: f.label,
                    oldValue: oldDisplay || '(empty)',
                    newValue: newDisplay || '(empty)'
                });
            }
        });
        return diffs;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FEATURE 7: SMART CONFLICT DETECTION
    // ══════════════════════════════════════════════════════════════════════════

    _detectDuplicates() {
        const flags = {};
        this._sections.forEach(sec => {
            const def = SECTIONS.find(d => d.key === sec.key);
            if (!def) return;
            const titleField = def.fields.find(f => f.role === 'title');
            if (!titleField) return;

            const aiRecords = sec.records.filter(r => r._source === 'ai');
            const existingRecords = sec.records.filter(r => r._source === 'existing');
            if (!aiRecords.length || !existingRecords.length) return;

            aiRecords.forEach(aiRec => {
                const aiTitle = (aiRec[titleField.api] || '').trim().toLowerCase();
                if (aiTitle.length < 3) return;
                for (const exRec of existingRecords) {
                    const exTitle = (exRec[titleField.api] || '').trim().toLowerCase();
                    if (exTitle.length < 3) continue;
                    if (this._simpleMatch(aiTitle, exTitle)) {
                        flags[aiRec._id] = {
                            matchedTitle: exRec[titleField.api] || 'Existing Record',
                            sectionKey: sec.key
                        };
                        break;
                    }
                }
            });
        });
        this._duplicateFlags = flags;
    }

    _simpleMatch(a, b) {
        if (a === b) return true;
        if (a.includes(b) || b.includes(a)) return true;
        // Word overlap (Jaccard > 0.5)
        const wordsA = new Set(a.split(/\s+/));
        const wordsB = new Set(b.split(/\s+/));
        if (wordsA.size < 2 || wordsB.size < 2) return false;
        let overlap = 0;
        wordsA.forEach(w => { if (wordsB.has(w)) overlap++; });
        const union = new Set([...wordsA, ...wordsB]).size;
        return union > 0 && (overlap / union) > 0.5;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FEATURE 12: EDITABLE MEETING SUMMARY
    // ══════════════════════════════════════════════════════════════════════════

    get isSummaryEdited() {
        return this._originalMeetingSummary !== '' && this._meetingSummaryResult !== this._originalMeetingSummary;
    }
    get summaryEditBtnLabel() { return this._isSummaryEditing ? 'Done' : 'Edit'; }

    handleToggleSummaryEdit(event) {
        event.stopPropagation();
        if (!this._isSummaryEditing && !this._originalMeetingSummary) {
            this._originalMeetingSummary = this._meetingSummaryResult;
        }
        this._isSummaryEditing = !this._isSummaryEditing;
    }

    handleSummaryInput(event) {
        this._meetingSummaryResult = event.target.value;
        this.outputMeetingSummary = this._meetingSummaryResult;
        this.dispatchEvent(new FlowAttributeChangeEvent('outputMeetingSummary', this._meetingSummaryResult));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FEATURE 5: KEYBOARD SHORTCUTS
    // ══════════════════════════════════════════════════════════════════════════

    _boundKeyHandler;

    _handleKeyDown(event) {
        if (this._step !== 'review') return;
        const tag = event.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target.isContentEditable) return;

        const key = event.key;
        if (['ArrowDown', 'ArrowUp', 'Enter', 'd', 'D', 'Delete', 'Escape'].indexOf(key) === -1) return;

        const rows = this._getNavigableRows();
        if (!rows.length) return;

        if (key === 'Escape') {
            if (this._editingRow) { this._editingRow = null; }
            else { this._focusedRowId = null; this._focusedSectionKey = null; }
            return;
        }

        // If no row focused, focus the first one
        if (!this._focusedRowId) {
            if (key === 'ArrowDown' || key === 'ArrowUp') {
                event.preventDefault();
                this._focusedRowId = rows[0]._id;
                this._focusedSectionKey = rows[0].sectionKey;
                this._scrollFocusedRowIntoView();
            }
            return;
        }

        const currentIdx = rows.findIndex(r => r._id === this._focusedRowId);

        if (key === 'ArrowDown') {
            event.preventDefault();
            const next = currentIdx < rows.length - 1 ? currentIdx + 1 : 0;
            this._focusedRowId = rows[next]._id;
            this._focusedSectionKey = rows[next].sectionKey;
            this._scrollFocusedRowIntoView();
        } else if (key === 'ArrowUp') {
            event.preventDefault();
            const prev = currentIdx > 0 ? currentIdx - 1 : rows.length - 1;
            this._focusedRowId = rows[prev]._id;
            this._focusedSectionKey = rows[prev].sectionKey;
            this._scrollFocusedRowIntoView();
        } else if (key === 'Enter') {
            event.preventDefault();
            if (this._editingRow) {
                this._editingRow = null;
            } else {
                const row = rows[currentIdx];
                if (row && !this._lockedRows[row._id]) {
                    this._lockedRows = { ...this._lockedRows, [row._id]: true };
                    this._pushUndo({ type: 'lock', recId: row._id });
                }
            }
        } else if (key === 'd' || key === 'D' || key === 'Delete') {
            const row = rows[currentIdx];
            if (!row || this._lockedRows[row._id] || this._lockedSections[row.sectionKey]) return;
            const sec = this._sections.find(s => s.key === row.sectionKey);
            if (!sec) return;
            const rec = sec.records.find(r => r._id === row._id);
            if (!rec) return;
            if (rec._source === 'existing') {
                if (!this._deletedRows[row._id]) {
                    this._deletedRows = { ...this._deletedRows, [row._id]: true };
                    this._pushUndo({ type: 'markDelete', recId: row._id });
                }
            } else {
                const recIdx = sec.records.findIndex(r => r._id === row._id);
                this._pushUndo({ type: 'delete', sectionKey: row.sectionKey, recId: row._id, record: rec, index: recIdx });
                this._removeRecordById(row.sectionKey, row._id);
            }
        }
    }

    _getNavigableRows() {
        const rows = [];
        this._sections.forEach(sec => {
            if (!this._expandedSections[sec.key]) return;
            sec.records.forEach(rec => {
                rows.push({ _id: rec._id, sectionKey: sec.key });
            });
        });
        return rows;
    }

    _scrollFocusedRowIntoView() {
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            const el = this.template.querySelector(`[data-row-id="${this._focusedRowId}"]`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 50);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FEATURE 9: BATCH LOCK WITH VALIDATION SUMMARY
    // ══════════════════════════════════════════════════════════════════════════

    handleConfirmBulkLock() {
        if (!this._bulkLockPreview) return;
        const key = this._bulkLockPreview.sectionKey;
        const lockedIds = this._executeBulkLock(key);
        if (lockedIds.length) {
            this._pushUndo({ type: 'batchLock', ids: lockedIds, sectionKey: key });
        }
        this._showBulkLockConfirm = false;
        this._bulkLockPreview = null;
    }

    handleCancelBulkLock() {
        this._showBulkLockConfirm = false;
        this._bulkLockPreview = null;
    }

    _executeBulkLock(key) {
        const sec = this._sections.find(s => s.key === key);
        if (!sec) return [];
        const updated = { ...this._lockedRows };
        const optMap = this._selectOptionsMap;
        const lockedIds = [];
        sec.records.forEach(rec => {
            if (updated[rec._id]) return;
            const stat = this._computeRecordStat(rec, key, sec.fields, optMap);
            if (!stat._hasErrors) {
                updated[rec._id] = true;
                lockedIds.push(rec._id);
            }
        });
        this._lockedRows = updated;
        return lockedIds;
    }

    // ── Draft-to-Task: highlight summary text → popup → add action item ─────
    handleSummaryMouseUp(event) {
        const sel  = window.getSelection();
        const text = sel?.toString()?.trim();
        if (!text) { this._selectionPopup = null; return; }
        const zoneRect  = event.currentTarget.getBoundingClientRect();
        const range     = sel.getRangeAt(0).getBoundingClientRect();
        this._selectionPopup = {
            text,
            x: Math.round(range.left - zoneRect.left + range.width / 2),
            y: Math.round(range.top  - zoneRect.top  - 8)
        };
    }
    handleSelectionZoneMouseDown(event) {
        if (!event.target.closest('.wph-convert-popup')) {
            this._selectionPopup = null;
        }
    }
    handleConvertToTask(event) {
        event.preventDefault();
        if (!this._selectionPopup?.text) return;
        const newTodo = {
            Subject:      'Action Item',
            Description:  this._selectionPopup.text.substring(0, 255),
            Priority:     'Normal',
            Type:         'Other',
            ActivityDate: '',
            IsPublic__c:  false,
            _key:         `manual-${Date.now()}`,
            _accepted:    false,
            _saved:       false,
            _isEditing:   false,
            _hasMeta:     true,
            _rowClass:    'wph-record-row'
        };
        this._meetingTodos = [...this._meetingTodos, newTodo];
        this._selectionPopup = null;
        window.getSelection()?.removeAllRanges();
        this._activeMsSection = 'todos';
    }

    // ── Utility ──────────────────────────────────────────────────────────────
    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    // ── Child component event handlers ───────────────────────────────────────

    /** Fired by c-advisor-meeting-summary when the generated/edited summary HTML changes */
    handleSummaryChange(event) {
        this._meetingSummaryResult = event.detail.summaryHtml || '';
        this._currentNoteHtml = event.detail.summaryHtml || null;
        this.outputMeetingSummary = this._meetingSummaryResult;
        this.dispatchEvent(new FlowAttributeChangeEvent('outputMeetingSummary', this.outputMeetingSummary));
    }

    /** Fired by c-advisor-meeting-summary when a note is saved (draft or publish) */
    handleNoteSave(event) {
        const { noteId, noteHtml, published, eventId } = event.detail;
        if (noteId) {
            this.outputMeetingNote = { Id: noteId, Note__c: noteHtml, Published__c: published };
            this.dispatchEvent(new FlowAttributeChangeEvent('outputMeetingNote', this.outputMeetingNote));
        } else {
            this.outputMeetingNoteToCreate = { Note__c: noteHtml, Published__c: published };
            this.dispatchEvent(new FlowAttributeChangeEvent('outputMeetingNoteToCreate', this.outputMeetingNoteToCreate));
        }
        if (eventId) {
            this.outputSelectedEventId = eventId;
            this.dispatchEvent(new FlowAttributeChangeEvent('outputSelectedEventId', this.outputSelectedEventId));
        }
    }

    /** Fired by c-advisor-meeting-summary when a note is published */
    handleNotePublish(event) {
        const { noteId, noteHtml, eventId } = event.detail;
        this.outputMeetingNote = { Id: noteId, Note__c: noteHtml, Published__c: true };
        this.dispatchEvent(new FlowAttributeChangeEvent('outputMeetingNote', this.outputMeetingNote));
        if (eventId) {
            this.outputSelectedEventId = eventId;
            this.dispatchEvent(new FlowAttributeChangeEvent('outputSelectedEventId', this.outputSelectedEventId));
        }
    }

    /** Fired by c-advisor-meeting-summary when the todos list changes */
    handleTodosChange(event) {
        this._meetingTodos = event.detail.todos || [];
    }

    /** Fired by either child component to request a tab switch */
    handleTabSwitch(event) {
        const { tab } = event.detail;
        if (tab) this._activeTab = tab;
    }

    /** Fired by either child component when shared files (uploaded docs) change */
    handleSharedFilesChange(event) {
        this._sharedFiles = event.detail.sharedFiles || [];
    }

    /** Fired by either child component when selected artifact file IDs change */
    handleArtifactFileIdsChange(event) {
        this._selectedArtifactFileIds = event.detail.artifactFileIds || new Set();
    }

    /** Fired by c-advisor-wealth-plan when a section is saved to flow outputs */
    handleSectionSave(event) {
        const { sections, outputs } = event.detail;
        if (!outputs) return;
        // Merge section outputs into @api output properties
        if (outputs.outputGoals)                  { this.outputGoals = outputs.outputGoals; this.dispatchEvent(new FlowAttributeChangeEvent('outputGoals', this.outputGoals)); }
        if (outputs.outputIncomes)                { this.outputIncomes = outputs.outputIncomes; this.dispatchEvent(new FlowAttributeChangeEvent('outputIncomes', this.outputIncomes)); }
        if (outputs.outputAssets)                 { this.outputAssets = outputs.outputAssets; this.dispatchEvent(new FlowAttributeChangeEvent('outputAssets', this.outputAssets)); }
        if (outputs.outputMilestones)             { this.outputMilestones = outputs.outputMilestones; this.dispatchEvent(new FlowAttributeChangeEvent('outputMilestones', this.outputMilestones)); }
        if (outputs.outputOwnerships)             { this.outputOwnerships = outputs.outputOwnerships; this.dispatchEvent(new FlowAttributeChangeEvent('outputOwnerships', this.outputOwnerships)); }
        if (outputs.outputSustainability)         { this.outputSustainability = outputs.outputSustainability; this.dispatchEvent(new FlowAttributeChangeEvent('outputSustainability', this.outputSustainability)); }
        if (outputs.outputGreetings)              { this.outputGreetings = outputs.outputGreetings; this.dispatchEvent(new FlowAttributeChangeEvent('outputGreetings', this.outputGreetings)); }
        if (outputs.outputTodos)                  { this.outputTodos = outputs.outputTodos; this.dispatchEvent(new FlowAttributeChangeEvent('outputTodos', this.outputTodos)); }
        if (outputs.outputGoalsToUpdate)          { this.outputGoalsToUpdate = outputs.outputGoalsToUpdate; this.dispatchEvent(new FlowAttributeChangeEvent('outputGoalsToUpdate', this.outputGoalsToUpdate)); }
        if (outputs.outputIncomesToUpdate)        { this.outputIncomesToUpdate = outputs.outputIncomesToUpdate; this.dispatchEvent(new FlowAttributeChangeEvent('outputIncomesToUpdate', this.outputIncomesToUpdate)); }
        if (outputs.outputAssetsToUpdate)         { this.outputAssetsToUpdate = outputs.outputAssetsToUpdate; this.dispatchEvent(new FlowAttributeChangeEvent('outputAssetsToUpdate', this.outputAssetsToUpdate)); }
        if (outputs.outputMilestonesToUpdate)     { this.outputMilestonesToUpdate = outputs.outputMilestonesToUpdate; this.dispatchEvent(new FlowAttributeChangeEvent('outputMilestonesToUpdate', this.outputMilestonesToUpdate)); }
        if (outputs.outputOwnershipsToUpdate)     { this.outputOwnershipsToUpdate = outputs.outputOwnershipsToUpdate; this.dispatchEvent(new FlowAttributeChangeEvent('outputOwnershipsToUpdate', this.outputOwnershipsToUpdate)); }
        if (outputs.outputSustainabilityToUpdate) { this.outputSustainabilityToUpdate = outputs.outputSustainabilityToUpdate; this.dispatchEvent(new FlowAttributeChangeEvent('outputSustainabilityToUpdate', this.outputSustainabilityToUpdate)); }
        if (outputs.outputGreetingsToUpdate)      { this.outputGreetingsToUpdate = outputs.outputGreetingsToUpdate; this.dispatchEvent(new FlowAttributeChangeEvent('outputGreetingsToUpdate', this.outputGreetingsToUpdate)); }
        if (outputs.outputGoalsToDelete)          { this.outputGoalsToDelete = outputs.outputGoalsToDelete; this.dispatchEvent(new FlowAttributeChangeEvent('outputGoalsToDelete', this.outputGoalsToDelete)); }
        if (outputs.outputIncomesToDelete)        { this.outputIncomesToDelete = outputs.outputIncomesToDelete; this.dispatchEvent(new FlowAttributeChangeEvent('outputIncomesToDelete', this.outputIncomesToDelete)); }
        if (outputs.outputAssetsToDelete)         { this.outputAssetsToDelete = outputs.outputAssetsToDelete; this.dispatchEvent(new FlowAttributeChangeEvent('outputAssetsToDelete', this.outputAssetsToDelete)); }
        if (outputs.outputMilestonesToDelete)     { this.outputMilestonesToDelete = outputs.outputMilestonesToDelete; this.dispatchEvent(new FlowAttributeChangeEvent('outputMilestonesToDelete', this.outputMilestonesToDelete)); }
        if (outputs.outputOwnershipsToDelete)     { this.outputOwnershipsToDelete = outputs.outputOwnershipsToDelete; this.dispatchEvent(new FlowAttributeChangeEvent('outputOwnershipsToDelete', this.outputOwnershipsToDelete)); }
        if (outputs.outputSustainabilityToDelete) { this.outputSustainabilityToDelete = outputs.outputSustainabilityToDelete; this.dispatchEvent(new FlowAttributeChangeEvent('outputSustainabilityToDelete', this.outputSustainabilityToDelete)); }
        if (outputs.outputGreetingsToDelete)      { this.outputGreetingsToDelete = outputs.outputGreetingsToDelete; this.dispatchEvent(new FlowAttributeChangeEvent('outputGreetingsToDelete', this.outputGreetingsToDelete)); }
    }

    /** Fired by c-advisor-wealth-plan after a successful wealth plan generation */
    handleWpGenerated(event) {
        const { summary } = event.detail;
        if (summary) {
            this.outputSummary = summary;
            this.dispatchEvent(new FlowAttributeChangeEvent('outputSummary', this.outputSummary));
        }
    }
}