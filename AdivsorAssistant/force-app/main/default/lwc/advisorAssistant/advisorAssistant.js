/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ADVISOR ASSISTANT — parent shell of the AI meeting / wealth-plan assistant.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT IT IS
 *   The only publicly exposed bundle of the three (see advisorAssistant.js-meta.xml:
 *   isExposed=true, targets Flow Screen / Record Page / App Page). Advisors open it
 *   either inline or as a modal, pick a calendar Event, fill in the Configuration
 *   column, and generate an AI meeting summary, a to-do list, or a structured
 *   wealth plan.
 *
 * WHAT THIS FILE OWNS
 *   - Header: brand bar, BETA badge, user guide, guided tour, selected-event pill.
 *   - Event picker modal (built from `inputEvents`).
 *   - Left "CONFIGURATION" column: five collapsible cards — Meeting Category,
 *     Meeting Notes, Meeting Files, Document Upload, Regeneration Instructions.
 *   - Tab bar (Pre-Meeting / Summary / Wealth Plan / To-Do's / Internal Notes).
 *   - The fixed footer, whose buttons delegate into the children.
 *   - Modal chrome: launcher card, backdrop, ESC handling, drag-to-resize.
 *
 * WHAT IT DELEGATES
 *   Nothing AI-related happens here. The real work lives in two child bundles:
 *     <c-advisor-meeting-summary>  — mounted TWICE:
 *          data-role="summary"  → the Summary tab
 *          data-role="todos"    → the To-Do's tab (active-ms-section="todos")
 *        Use `_msChild(role)` to reach the right instance; never
 *        `querySelector('c-advisor-meeting-summary')` on its own, that returns
 *        whichever comes first in the DOM.
 *     <c-advisor-wealth-plan>      — the Wealth Plan tab.
 *   All three stay mounted at all times. Tab switching hides them with the CSS
 *   class `aa-tab-panel--hidden`, NOT with `lwc:if`, so a generation that is
 *   running in the background survives the user switching tabs.
 *
 * FLOW INTEGRATION
 *   Only this component may talk to the Flow runtime. Nested components cannot
 *   dispatch FlowAttributeChangeEvent, so the children emit plain CustomEvents
 *   (`flowoutput`, `flownext`) and this component re-emits them — see
 *   `handleChildFlowOutput` / `handleChildFlowNext` near the bottom of the file.
 *
 * STATE OWNERSHIP
 *   The children are the source of truth for their own state. `_msState` (fed by
 *   the child's `msstatechange` event) drives the footer; this component's own
 *   copies of that state are stale leftovers from before the split.
 *
 * BACKEND DEPENDENCIES (none of these live in this repo — they are org-resident)
 *   Apex : MeetingSummaryController — generateSummary, generateMeetingTodos,
 *          regenerateMeetingSummary, saveMeetingNote, saveTodos, saveFileToEvent,
 *          saveWealthPlan, getMeetingNoteVersions. Each takes a *FlowApiName
 *          string and invokes that autolaunched Flow server-side, so admins can
 *          re-point the AI prompts without a deploy.
 *   Data : Event, Task, MeetingNote__c, MeetingNoteVersion__c, Meeting_Artifact__c,
 *          ContentDocument(Link), Account, plus the seven wealth-plan objects
 *          imported below.
 *
 * HISTORY — IMPORTANT WHEN READING THIS FILE
 *   This is a fork of the older `wealthPlanHelper` monolith, later split into the
 *   parent + two children above. The split copied rather than moved, so roughly
 *   60% of this file is unreachable: handlers, getters and whole subsystems whose
 *   live equivalents now sit in advisorMeetingSummary.js / advisorWealthPlan.js.
 *   Those regions are marked with `LEGACY (unreachable)` banners. Do not extend
 *   them; change the child instead. See DEFECTS.md at the repo root.
 */

import { LightningElement, api, track, wire } from 'lwc';

// ── Apex bridge ─────────────────────────────────────────────────────────────
// Every method is a thin wrapper that runs an admin-configured autolaunched Flow
// server-side. All are imperative (never cacheable) because they mutate or
// invoke generative AI. MeetingSummaryController is NOT in this repo.
import generateSummary      from '@salesforce/apex/MeetingSummaryController.generateSummary';
import generateMeetingTodos from '@salesforce/apex/MeetingSummaryController.generateMeetingTodos';
import regenerateMeetingSummary from '@salesforce/apex/MeetingSummaryController.regenerateMeetingSummary';
import saveMeetingNote from '@salesforce/apex/MeetingSummaryController.saveMeetingNote';
import saveTodos           from '@salesforce/apex/MeetingSummaryController.saveTodos';
import saveFileToEvent     from '@salesforce/apex/MeetingSummaryController.saveFileToEvent';
import saveWealthPlan      from '@salesforce/apex/MeetingSummaryController.saveWealthPlan';
import getMeetingNoteVersions from '@salesforce/apex/MeetingSummaryController.getMeetingNoteVersions';
// ── Platform modules ────────────────────────────────────────────────────────
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
// NavigationMixin powers handlePreviewFile — the standard Salesforce file preview
// opened from the Meeting Files and Document Upload lists.
import { NavigationMixin } from 'lightning/navigation';
// Only this parent may use flowSupport; nested children cannot (see file header).
import { FlowAttributeChangeEvent, FlowNavigationNextEvent } from 'lightning/flowSupport';
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';

// ── Wealth-plan schema ──────────────────────────────────────────────────────
// Object + picklist field references for the seven wealth-plan objects. They feed
// the getObjectInfo / getPicklistValues wires further down, which in turn build the
// dropdown options for the wealth-plan review grid.
// NOTE: that review grid now lives in advisorWealthPlan; the wires here still run
// on every mount but nothing in this template consumes them. See DEFECTS.md #11.
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

// ═══════════════════════════════════════════════════════════════════════════
// MODULE CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SECTIONS — the schema of the wealth-plan review grid.
 *
 * One entry per reviewable module. The AI returns loose JSON; this table is what
 * turns it into a typed, validated, editable grid without any per-object code:
 * it decides which fields to render, in what order, with what widget, and which
 * ones block a save.
 *
 * Shape:
 *   key      unique id, also the JSON key the AI is expected to return
 *   label    section heading in the UI
 *   icon     which inline SVG the template picks
 *   object   target SObject API name — what the save Flow will DML
 *   fields[] the columns, each:
 *     api          SObject field API name
 *     label        field label in the UI
 *     type         'text' | 'textarea' | 'number' | 'checkbox' | 'select'
 *     selectKey    for type 'select': which option list to use. Resolved at
 *                  render time against `_selectOptionsMap`, so picklists loaded
 *                  by the wires and dynamic lists (owners, companies) look the same.
 *     required     empty value blocks the save and flags the row
 *     role         where it appears on the card: 'title' | 'subtitle' | 'meta'
 *                  | 'description'
 *     maxlength    hard cap, enforced on input
 *     crossValidate(rec) → string|null
 *                  validation that needs more than one field on the record.
 *                  Return an error message to block, null to allow.
 *
 * NOTE: the live consumer of this table is advisorWealthPlan.js. The copy here
 * feeds only the LEGACY `reviewSections` getter. Keep both in sync if you touch it.
 */
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

/**
 * Owner-type fields. When the advisor changes one of these on a row, the UI offers
 * to apply the same owner to every other row in the section ("smart propagation"),
 * because the AI usually cannot tell which household member owns what.
 */
const OWNER_FIELD_APIS = new Set(['FinServ__PrimaryOwner__c', 'FF_Account__c']);

/**
 * FIELD_ALIASES — tolerance layer for the AI's output.
 *
 * The model is prompted for Salesforce API names but frequently returns friendly
 * ones ("amount", "dueDate", "primaryOwner"). Rather than tightening the prompt and
 * failing hard when it drifts, every plausible spelling is mapped to the real API
 * name here, per section. Unknown keys are dropped silently during parsing.
 *
 * When you add a field to SECTIONS, add its likely aliases here too — otherwise the
 * AI's value for it is discarded and the field renders empty with no error.
 */
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

// ── HTML ⇄ text helpers ─────────────────────────────────────────────────────
// The note body is stored twice: as rich HTML (MeetingNote__c.Note__c, what the
// advisor edits) and as Markdown (NoteMarkdown__c, consumed by the customer-facing
// web app). These functions produce the Markdown copy on every save.

/**
 * Recursively converts one DOM node to Markdown.
 * Unknown tags fall through to their children, so unsupported markup degrades to
 * plain text rather than being dropped.
 * @param {Node} node
 * @returns {string}
 */
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
/**
 * HTML → Markdown. Returns the input unchanged if DOMParser throws, so a save can
 * never fail because of the Markdown mirror.
 * @param {string} html
 * @returns {string}
 */
function _htmlToMd(html) {
    if (!html) return '';
    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return _nodeToMd(doc.body).trim();
    } catch(e) {
        return html; // safe fallback if DOMParser unavailable
    }
}

/** Removes <style> blocks the AI sometimes wraps its HTML output in. */
function _stripStyleBlocks(html) {
    if (!html) return html;
    return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').trim();
}

/** Crude tag strip + the five entities that actually show up. For word counts and previews. */
function _stripHtmlToText(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export default class AdvisorAssistant extends NavigationMixin(LightningElement) {
    // ═══════════════════════════════════════════════════════════════════════
    // @api INPUTS — set by the Flow screen, or by the App Builder on a record page
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Two families:
    //   *FlowApiName  — API names of autolaunched Flows. The component never runs
    //                   them directly; it passes the name to Apex, which invokes
    //                   the Flow server-side. This is how admins re-point AI
    //                   prompts and save logic without a deploy. A blank name
    //                   silently disables the feature that uses it.
    //   input*        — record collections the Flow queried up front. On a Record
    //                   Page target none of them are exposed in the meta, so they
    //                   are always empty there (see DEFECTS.md #10).
    //
    // The four collections that arrive late from the Flow use getter/setter pairs
    // rather than plain fields, so the component can react the moment data lands.

    // ── Header text ─────────────────────────────────────────────────────────
    // Both default to the product's own wording when left unset or blank, so an
    // existing placement that configures neither is unaffected. Resolved through
    // `headerTitle` / `headerSubtitle` below — never read these two directly.
    @api componentTitle    = '';
    @api componentSubtitle = '';

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
    // The advisor's calendar Events, queried by the Flow. This is the one input
    // the whole UI blocks on, so it drives its own loading state:
    //   - `_inputEventsLoading` starts true (no flag needed from the Flow),
    //   - the setter below clears it the moment a non-empty collection arrives,
    //   - connectedCallback arms a 10 s fallback so a Flow that returns nothing
    //     shows the "no events" empty state instead of spinning forever.
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

    // ── Optional event ranges ───────────────────────────────────────────────
    // Each populated collection adds an option to the range selector in the event
    // picker; an empty one is simply not offered (see `eventRangeOptions`). The
    // Flow supplies them all up front, so switching range is a client-side swap
    // with no extra query. The ranges nest (3 ⊂ 6 ⊂ 12 ⊂ all), which is why
    // `allKnownEvents` dedupes on Id.
    //
    // Do NOT read these directly — go through `activeEvents` (the current range)
    // or `allKnownEvents` (the union, for resolving the selected event).
    @api inputEventsLast3Months  = [];
    @api inputEventsLast6Months  = [];
    @api inputEventsLast12Months = [];
    @api inputEventsAll          = [];

    @api inputHouseholdMembers = [];
    @api inputCompanies = [];   // Account records — used as options for Company_Owned__c
    @api inputPersons   = [];   // Person/Account records — used as options for Company_Owner__c
    // Single Account record (preferred) — use .Id for owner defaulting and dropdown selection
    @api inputPrimaryMember = null;
    // Legacy: keep for backwards compatibility, but inputPrimaryMember.Id takes precedence
    @api inputPrimaryMemberId = '';

    /** The household's primary member Id — new-style record input wins over the legacy Id string. */
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
    // Careful: these use two OPPOSITE conventions, both forced on us by Flow.
    //
    //   show* (six of them) — DEFAULT ON. An @api Boolean cannot default to true
    //     (LWC always initialises it to false), and Flow hands booleans over as the
    //     strings 'true'/'false'. So the raw value is stored as-is and resolved by
    //     `_on()`: enabled unless the literal string 'false' arrived. That is why
    //     the field says `= false` while the meta XML says `default="true"` —
    //     deliberate, not a mismatch.
    //
    //   briefEnabled / briefOpenByDefault / hideBetaBadge / modalMode — DEFAULT OFF,
    //     tested against both the boolean and the string 'true'.
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
    // Forwarded to <c-advisor-internal-notes>, which owns the save.
    @api saveInternalNotesFlowApiName = '';
    @api saveTodosFlowApiName       = '';  // autolaunched flow that creates Task records from accepted action items
    @api saveFileToEventFlowApiName = '';  // autolaunched flow invoked when saving an uploaded file to the event record
    @api wealthPlanSaveFlowApiName  = '';  // autolaunched flow that handles WP DML via typed SObject record collections
    @api inputWhoId             = '';      // WhoId (Contact/Lead) to link to saved tasks — set from the parent Flow

    // Track whether parent explicitly disabled a feature (string 'false' from Flow)
    _explicitlyDisabled = {};

    // LEGACY (unreachable): browser dictation for the notes field. The live mic
    // button is in advisorMeetingSummary (handleToggleMicrophone). Neither getter
    // is bound in advisorAssistant.html.
    get isSpeechSupported() {
        return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    }

    get micButtonClass() {
        return this._isListening
            ? 'wph-mic-btn wph-mic-active pulse-animation'
            : 'wph-mic-btn';
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LIFECYCLE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Resolves the Flow's string booleans, opens straight onto the summary step,
     * arms the 10 s events-loading fallback, and registers the global key handler.
     */
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

        // Keyboard shortcuts for the wealth-plan review grid (↑ ↓ Enter d Esc).
        // FIXME (DEFECTS.md #7): `_handleKeyDown` bails immediately unless
        // `_step === 'review'`, and no live path here ever sets that — the grid
        // moved to advisorWealthPlan. This is a permanent no-op document listener.
        this._boundKeyHandler = this._handleKeyDown.bind(this);
        document.addEventListener('keydown', this._boundKeyHandler);

    }

    /**
     * Two jobs, both of which must run after paint rather than in a setter:
     *  1. move focus into the hidden absorber when the modal opens, so Salesforce's
     *     inline-edit shortcuts don't steal the first keystroke;
     *  2. seed the contenteditable editors' innerHTML once (they are uncontrolled —
     *     re-setting innerHTML on every render would destroy the caret).
     *
     * FIXME (DEFECTS.md #8): neither `summaryEditor` nor `briefEditor` exists as an
     * `lwc:ref` in this template any more (only `focusAbsorber` does), so both
     * seeding branches below are dead. The live editors are in the children.
     */
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

    /**
     * Resolves a default-ON feature toggle. See the toggle block above for why the
     * polarity is inverted: an unset @api Boolean and an explicit false are
     * indistinguishable, so only the literal string 'false' from Flow disables.
     * @param {*} v raw @api value
     * @param {string} [prop] property name, to also consult `_explicitlyDisabled`
     * @returns {boolean}
     */
    _on(v, prop) {
        if (prop && this._explicitlyDisabled[prop]) return false;
        if (v === 'false') return false;
        return true; // default ON — false from @api default is treated as "not set"
    }

    // ═══════════════════════════════════════════════════════════════════════
    // @api OUTPUTS — read back by the Flow after this screen
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Nothing here is written by this component's own logic any more. The children
    // compute the values and emit `flowoutput`; `handleChildFlowOutput` assigns the
    // property AND dispatches the matching FlowAttributeChangeEvent. Assigning one
    // of these directly without the event leaves the Flow with a stale value.
    //
    // The wealth-plan collections come in three flavours so the save Flow can do
    // one insert, one update and one delete pass over typed SObject collections:
    //   output<X>          → records to insert
    //   output<X>ToUpdate  → existing records the advisor edited
    //   output<X>ToDelete  → existing records the advisor marked for deletion
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

    // ═══════════════════════════════════════════════════════════════════════
    // @track LOCAL STATE
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Large because this file still carries the pre-split monolith's state. Only a
    // minority is live; the rest belongs to the LEGACY regions further down and is
    // never written. The live groups are: modal/launcher chrome, event selection,
    // the Configuration cards, the tab bar, `_bgJobs`, and `_msState`.
    //
    // `_step` is effectively pinned to 'summary' — connectedCallback sets it and no
    // live path moves it. The 'input' and 'review' steps were the monolith's other
    // two screens.

    // ── Local state ──────────────────────────────────────────────────────────
    @track _step = 'input';         // 'input' | 'loading' | 'review'
    @track _wpGenerating = false;   // wealth plan generation in-progress (loading shown inline in right panel)
    @track _freeText = '';
    @track _stagedFile  = null;   // single file for Advanced section regeneration (unchanged)
    @track _sharedFiles = [];    // shared file pool — visible in both WP and MS upload zones
    @track _uploadFeedback = null; // { latestName, totalFiles } — shown for 3s after upload
    // FIXME (DEFECTS.md #6): not cleared in disconnectedCallback, unlike the other
    // timers — fires into a torn-down component if the user closes within 3 s.
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
    @track _selectedMeetingType  = null;   // 'whiteboard' | 'status' | 'annual'
    @track _hasTodos             = false;
    @track _acceptedTodosCount   = 0;
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

    // ═══════════════════════════════════════════════════════════════════════
    // @wire — PICKLIST METADATA (18 adapters)
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Two-stage chain, the standard UI API pattern: `getObjectInfo` supplies each
    // object's defaultRecordTypeId, and each `getPicklistValues` wire depends on it
    // via the `'$_xObjectInfo.data.defaultRecordTypeId'` reactive string. The
    // picklist wires therefore stay dormant until their object info resolves.
    // Results are normalised to {label, value} and exposed through
    // `_selectOptionsMap`, so SECTIONS' `selectKey` can resolve real picklists and
    // dynamic lists (owners, companies) through one lookup.
    //
    // TWO THINGS TO KNOW BEFORE EDITING:
    //  1. LEGACY — the only consumer of these options is `reviewSections` further
    //     down, which this template never renders. The live grid is in
    //     advisorWealthPlan. They still fire on every mount. See DEFECTS.md #11.
    //  2. FIXME (DEFECTS.md #5) — every wire below destructures `{ data }` only.
    //     A picklist that fails to load (FLS, deleted field, bad record type) is
    //     silent: the option list stays empty, and `_isValidOption` treats an empty
    //     list as "not loaded yet, skip validation", so bad values pass validation.

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

    /**
     * True if `value` is a legal choice for `selectKey`.
     * Deliberately permissive: an unloaded picklist (length <= 1, i.e. only the
     * "-- Select --" placeholder) is treated as valid so the grid does not flag
     * every row red during the wire round-trip. The cost of that leniency is
     * DEFECTS.md #5 — a wire that errors looks identical to one still loading.
     * @param {string} selectKey key into `_selectOptionsMap`
     * @param {string} value stored field value
     * @returns {boolean}
     */
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
    get isSummaryStep()    { return this._step === 'summary' || this._step === 'review'; }
    get isLoadingStep()    { return this._step === 'loading'; }
    get isReviewStep()     { return this._step === 'review'; }
    get showEventPicker()  { return this.isSummaryStep || this.isReviewStep || this.isLoadingStep; }
    get showBetaBadge()  { return !this.hideBetaBadge; }

    // ── Header text ─────────────────────────────────────────────────────────
    // Single source for the displayed title/subtitle. A blank or whitespace-only
    // @api value falls back to the default wording, so an admin cannot
    // accidentally ship an empty header by clearing the field.
    get headerTitle() {
        return (this.componentTitle || '').trim() || 'Advisor Assistant';
    }
    get headerSubtitle() {
        return (this.componentSubtitle || '').trim() || 'AI-powered meeting & wealth plan structuring';
    }

    get progressBarStyle()  { return `width: ${this._progressValue}%`; }
    get formattedProgress() { return `${Math.round(this._progressValue)}%`; }

    // ═══════════════════════════════════════════════════════════════════════
    // EVENT RANGES
    // ═══════════════════════════════════════════════════════════════════════
    //
    // The picker can show one of up to five lists. `inputEvents` is the always-present
    // "Default" range; the four optional collections each add an option when populated.
    //
    // TWO ACCESSORS, and using the wrong one is a real bug:
    //   activeEvents    — just the selected range. For the picker list and its count.
    //   allKnownEvents  — the union of all five, deduped by Id. For resolving the
    //                     SELECTED event, and for what the children receive.
    //
    // Why the split: switching range deliberately KEEPS the current selection, so the
    // selected event may not be in the active range. If the selected-event lookups used
    // `activeEvents`, picking an event under "All" and then narrowing to "Last 3 months"
    // would silently break the header pill, the meeting-type restore, the WhoId used for
    // to-dos, and the child's note matching.

    /** Selected range key. Not necessarily available — resolve via `_activeRangeKey`. */
    @track _selectedRange = 'default';

    /** The five candidate ranges, in display order. Single source for keys and labels. */
    get _rangeDefs() {
        return [
            // Labels are deliberately terse: the "RANGE" caption above the control
            // supplies the "last …" sense, and the full wording ("Last 12 months")
            // overflowed the 560px picker and wrapped to a ragged second line.
            { key: 'default', label: 'Default',   events: this._inputEvents            || [] },
            { key: 'm3',      label: '3 months',  events: this.inputEventsLast3Months  || [] },
            { key: 'm6',      label: '6 months',  events: this.inputEventsLast6Months  || [] },
            { key: 'm12',     label: '12 months', events: this.inputEventsLast12Months || [] },
            { key: 'all',     label: 'All',       events: this.inputEventsAll          || [] },
        ];
    }

    /** Ranges the Flow actually populated. An empty collection is never offered. */
    get _availableRanges() {
        return this._rangeDefs.filter(r => r.events.length > 0);
    }

    /**
     * The range in effect, which is not always the one the advisor clicked: Flow
     * collections arrive asynchronously and can change on a re-run, so a selected
     * range may not (yet) exist. Falls back to 'default', then to the first available.
     */
    get _activeRangeKey() {
        const avail = this._availableRanges;
        if (avail.some(r => r.key === this._selectedRange)) return this._selectedRange;
        if (avail.some(r => r.key === 'default')) return 'default';
        return avail.length ? avail[0].key : 'default';
    }

    /** Pill models for the selector. */
    get eventRangeOptions() {
        const active = this._activeRangeKey;
        return this._availableRanges.map(r => ({
            key: r.key,
            label: r.label,
            count: r.events.length,
            isActive: r.key === active,
            cls: r.key === active ? 'aa-range-seg aa-range-seg--active' : 'aa-range-seg',
            pressed: String(r.key === active),
        }));
    }

    /** Only worth showing the selector when there is an actual choice. */
    get showEventRangeSelector() { return this._availableRanges.length > 1; }

    /** Events in the active range — drives the picker list and its count. */
    get activeEvents() {
        const active = this._activeRangeKey;
        const def = this._rangeDefs.find(r => r.key === active);
        return def ? def.events : [];
    }

    // Memo for `allKnownEvents`. Keyed on the identities of the five source arrays,
    // which Flow replaces wholesale when the data changes.
    _allKnownSrcs  = null;
    _allKnownCache = [];

    /**
     * Every event the component knows about, across all ranges, deduped by Id.
     * Use this for any lookup of the *selected* event — see the note above.
     *
     * MUST return a STABLE reference. This value is passed down as `input-events`,
     * and both children's `inputEvents` setter runs `this._step = 'summary'` on any
     * non-empty assignment. LWC re-invokes an @api setter whenever the value's
     * identity changes, so rebuilding the array on every access made that setter
     * fire on every parent re-render — which continuously reset advisorWealthPlan
     * out of its 'review' step and blanked the completed plan. Memoise, and only
     * rebuild when one of the source collections is actually replaced.
     */
    get allKnownEvents() {
        const srcs = [
            this._inputEvents            || [],
            this.inputEventsLast3Months  || [],
            this.inputEventsLast6Months  || [],
            this.inputEventsLast12Months || [],
            this.inputEventsAll          || [],
        ];
        const prev = this._allKnownSrcs;
        if (prev && prev.length === srcs.length && prev.every((a, i) => a === srcs[i])) {
            return this._allKnownCache;
        }
        // Common case — only the default collection is populated. Hand back that very
        // array so the reference is identical to what the children saw before ranges existed.
        const nonEmpty = srcs.filter(a => a.length > 0);
        let out;
        if (nonEmpty.length <= 1) {
            out = nonEmpty[0] || [];
        } else {
            const seen = new Set();
            out = [];
            for (const arr of srcs) {
                for (const e of arr) {
                    if (!e || !e.Id || seen.has(e.Id)) continue;
                    seen.add(e.Id);
                    out.push(e);
                }
            }
        }
        this._allKnownSrcs  = srcs;
        this._allKnownCache = out;
        return out;
    }

    handleEventRangeSelect(event) {
        const key = event.currentTarget.dataset.range;
        // Selection is intentionally preserved — see the note above.
        if (key) this._selectedRange = key;
    }

    /**
     * Empty-state text for the picker. Names the range when the advisor has narrowed
     * to one, so "nothing here" doesn't read as "this household has no meetings".
     */
    get noEventsMessage() {
        const key = this._activeRangeKey;
        if (key === 'default' || !this.showEventRangeSelector) {
            return 'No meeting events found for this contact.';
        }
        const full = { m3: 'the last 3 months', m6: 'the last 6 months',
                       m12: 'the last 12 months', all: 'any period' };
        return `No meeting events in ${full[key] || 'this range'}. Try a wider range.`;
    }

    // ── Event selection ──────────────────────────────────────────────────────
    get eventItems() {
        return (this.activeEvents || []).map(e => {
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
                aaEventRowClass: isSelected ? 'aa-event-row aa-event-row--selected' : 'aa-event-row',
            };
        });
    }
    get _selectedEventItem()   { return this.eventItems.find(ev => ev.isSelected); }
    get selectedEventSubject() { return this._selectedEventItem?.subject || ''; }
    get selectedEventDate()    { return this._selectedEventItem?.date || ''; }

    // Participants shown in the header chip — household members by name.
    get selectedEventParticipants() {
        if (!this._selectedEventId) return '';
        const names = [];
        if (this.inputPrimaryMember?.Name) names.push(this.inputPrimaryMember.Name);
        for (const m of (this.inputHouseholdMembers || [])) {
            if (m?.Name && !names.includes(m.Name)) names.push(m.Name);
        }
        return names.join(', ');
    }
    get selectedEventParticipantCount() {
        if (!this._selectedEventId) return 0;
        const s = new Set();
        if (this.inputPrimaryMember?.Id) s.add(this.inputPrimaryMember.Id);
        for (const m of (this.inputHouseholdMembers || [])) {
            if (m?.Id) s.add(m.Id);
        }
        return s.size;
    }
    get hasSelectedEventParticipants() { return this.selectedEventParticipantCount > 0; }
    get selectedEventParticipantLabel() {
        const n = this.selectedEventParticipantCount;
        if (n === 0) return '';
        if (n === 1) return this.selectedEventParticipants;
        return `${this.selectedEventParticipants} (${n})`;
    }
    get selectedEventMeta() {
        const ev = this._selectedEventItem;
        if (!ev) return '';
        return ev.time ? `${ev.date} · kl. ${ev.time}` : ev.date;
    }
    get hasEvents()              { return (this.activeEvents || []).length > 0; }
    get isEventsLoading()        { return this._inputEventsLoading; }
    get hasNoEvents()            { return !this._inputEventsLoading && !this.hasEvents; }
    get eventsCountLabel() {
        const n = (this.activeEvents || []).length;
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
        const evt = (this.allKnownEvents || []).find(e => e.Id === this._selectedEventId);
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
    // acceptedTodosCount is defined once below — it reads _acceptedTodosCount, which the
    // child reports via `todoschange`. Do not re-derive it from _meetingTodos here.
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
    get isTodosTab()      { return this._activeTab === 'summary' && this._activeMsSection === 'todos'; }
    // aria-selected for the tab bar — role="tab" without it reports every tab as
    // unselected to assistive tech, which is worse than no role at all.
    get isSummaryTabSelected()    { return String(this.activeTabValue === 'summary'); }
    get isWealthPlanTabSelected() { return String(this.activeTabValue === 'wealthplan'); }
    get isTodosTabSelected()      { return String(this.activeTabValue === 'todos'); }
    get isSummaryTab()    { return this._activeTab === 'summary' && this._activeMsSection !== 'todos'; }
    get isWealthPlanTab() { return this._activeTab === 'wealthplan'; }
    get isExistingTab()   { return this._activeTab === 'existing'; }
    // Top tab bar classes are provided by aaTabSummaryClass / aaTabWealthPlanClass /
    // aaTabTodosClass — the old summaryTabClass/wealthPlanTabClass/todosTabClass/
    // existingTabClass getters were unbound and are removed.
    get acceptedTodosCount()    { return this._acceptedTodosCount; }
    /** Total to-dos the AI produced, as distinct from how many the user accepted.
     *  Both are shown in the tab header so "3 of 5 accepted" is readable at a glance. */
    get todosCreatedCount()     { return this._meetingTodos.length; }
    get todosCreatedTitle()     { return `${this.todosCreatedCount} to-do's created`; }
    get todosAcceptedTitle()    { return `${this.acceptedTodosCount} of ${this.todosCreatedCount} accepted`; }
    get hasExistingWealthPlan() { return !!this.inputWealthPlanId; }
    get hasSavedDraft()        { return this._savedDraftSections !== null; }
    // Removed: summaryTabStyle / wealthPlanTabStyle / existingTabStyle and the two
    // _TAB_*_STYLE statics they used. They referenced `WealthPlanHelper`, an identifier
    // that does not exist in this module (fork residue), so reading any of them threw
    // ReferenceError. Nothing bound them. Live tab styling is aaTabSummaryClass /
    // aaTabWealthPlanClass / aaTabTodosClass.
    get summaryLeftTabClass()    { return 'wph-left-tab' + (this._activeTab === 'summary' ? ' wph-left-tab--active' : ''); }
    get wealthPlanLeftTabClass() { return 'wph-left-tab' + (this._activeTab === 'wealthplan' ? ' wph-left-tab--active' : ''); }

    // ── Meeting Summary sub-section (Meeting | To-do's) ─────────────────────
    get isMeetingSection() { return this._activeMsSection === 'meeting'; }
    get isTodosSection()   { return this._activeMsSection === 'todos'; }
    get hasRegenInstructions() { return (this._summaryInstructions || '').trim().length > 0; }
    get isRegenDisabled()      { return !this.regenerateSummaryFlowApiName || !this.hasRegenInstructions; }
    // Removed: meetingSubtabClass / todosSubtabClass and the two _SUBTAB_* statics —
    // same undefined `WealthPlanHelper` receiver as the tab-style getters above.

    // Advanced section collapsible
    get advancedBodyClass()    { return this._advancedExpanded ? 'wph-advanced-body' : 'wph-advanced-body wph-zone-collapse-hidden'; }
    get advancedChevronClass() { return this._advancedExpanded ? 'wph-collapse-chevron wph-chevron-open' : 'wph-collapse-chevron'; }

    // ── Meeting artifact + file getters ──────────────────────────────────────
    get selectedEventArtifact() {
        const evt = (this.allKnownEvents || []).find(e => e.Id === this._selectedEventId);
        if (!evt?.MeetingArtifacts__c) return null;
        return (this._inputArtifacts || []).find(a => a.Id === evt.MeetingArtifacts__c) || null;
    }
    // Memoized artifactFiles — the template reads this several times per render.
    // Key encodes every input the derived array depends on so a stale hit is impossible.
    _artifactFilesCache = null;
    _artifactFilesKey = '';
    get artifactFiles() {
        const artifact = this.selectedEventArtifact;
        const artifactId = artifact?.Id || '';
        const cdls = this._inputContentDocumentLinks || [];
        const docs = this._inputContentDocuments || [];
        // Key on the selected IDs themselves, not just how many there are — swapping one
        // selection for another keeps the size identical and would serve stale rows
        // with the wrong isSelected/rowClass.
        const selectedKey = [...this._selectedArtifactFileIds].sort().join(',');
        const key = `${artifactId}|${cdls.length}|${docs.length}|${selectedKey}|${this._sessionSavedFiles.length}`;
        if (this._artifactFilesCache && this._artifactFilesKey === key) {
            return this._artifactFilesCache;
        }
        let linked = [];
        if (artifact) {
            const docMap = {};
            for (const doc of docs) docMap[doc.Id] = doc;
            linked = [];
            for (const cdl of cdls) {
                if (cdl.LinkedEntityId !== artifact.Id) continue;
                const doc = docMap[cdl.ContentDocumentId] || {};
                const ft = (doc.FileType || '').toUpperCase();
                const selected = this._selectedArtifactFileIds.has(cdl.ContentDocumentId);
                let iconStyle = 'color:#94a3b8;';
                let tagClass  = 'wph-artifact-type-tag';
                if (ft === 'PDF')                              { iconStyle = 'color:#ef4444;'; tagClass += ' wph-atype-pdf';  }
                else if (ft === 'DOCX' || ft === 'DOC')       { iconStyle = 'color:#2563eb;'; tagClass += ' wph-atype-docx'; }
                else if (ft === 'TXT')                         { iconStyle = 'color:#059669;'; tagClass += ' wph-atype-txt';  }
                else if (ft === 'PNG' || ft === 'JPG' || ft === 'JPEG') { iconStyle = 'color:#7c3aed;'; tagClass += ' wph-atype-img';  }
                linked.push({
                    id: cdl.ContentDocumentId,
                    title: doc.Title || cdl.ContentDocumentId,
                    fileType: ft,
                    isSelected: selected,
                    iconStyle,
                    tagClass,
                    rowClass: selected
                        ? 'wph-artifact-file-row wph-artifact-file-row-selected'
                        : 'wph-artifact-file-row'
                });
            }
        }
        const out = linked.concat(this._sessionSavedFiles);
        this._artifactFilesCache = out;
        this._artifactFilesKey = key;
        return out;
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
        // Note ids belong to the event we just left; reusing one would update the WRONG
        // event's note. Both children reseed for the new event on their next render.
        this._msState            = { ...this._msState, savedNoteId: null };
        this._internalNotesState = { ...this._internalNotesState, savedNoteId: null };

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
        const _evtForType = (this.allKnownEvents || []).find(e => e.Id === this._selectedEventId);
        const cachedType = this._selectedEventId ? this._meetingTypeCache[this._selectedEventId] : null;
        const _labelToKey = { 'Whiteboard Meeting': 'whiteboard', 'Status Meeting': 'status', 'Annual Review': 'annual' };
        const _typeFromEvent = _evtForType?.MeetingType__c ? (_labelToKey[_evtForType.MeetingType__c] || null) : null;
        this._selectedMeetingType = cachedType ? cachedType.type : _typeFromEvent;
        this._hasTodos            = cachedType ? cachedType.hasTodos : false;
        // Auto-open Meeting Type accordion when no type is set — draws attention to the glowing frame
        this._msTypeOpen = !this._selectedMeetingType;
        // Clear any manual collapse of the Category card so the per-event auto-open applies.
        this._cardOpen = { ...this._cardOpen, category: undefined };
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

    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║ LEGACY (unreachable) — the pre-split MEETING SUMMARY engine            ║
    // ╠═══════════════════════════════════════════════════════════════════════╣
    // ║ Everything from here down to "Task selection" is the monolith's own    ║
    // ║ implementation of summary regeneration, the contenteditable editor,    ║
    // ║ save / publish / delete, and version history. It was COPIED (not       ║
    // ║ moved) into advisorMeetingSummary.js during the split, so this copy is ║
    // ║ orphaned: nothing in advisorAssistant.html binds any of it, and the    ║
    // ║ `lwc:ref` editors it drives no longer exist in this template.          ║
    // ║                                                                       ║
    // ║ Live equivalents → advisorMeetingSummary.js:                          ║
    // ║   handleRegenerateSummary, handleSaveSummary, handlePublish,           ║
    // ║   handleConfirmDeleteNote, handleCreateNewVersion, _loadVersionHistory ║
    // ║                                                                       ║
    // ║ Change the child, not this. Kept only because deleting it is a         ║
    // ║ separate, regression-tested change (DEFECTS.md #11).                   ║
    // ╚═══════════════════════════════════════════════════════════════════════╝

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

    // ── LEGACY (unreachable): task picker, file upload, dictation, step gauge ──
    // The monolith's input-step widgets. The live upload zone is the "Document
    // Upload" Configuration card (handleSharedFileUpload, above); the live mic is in
    // advisorMeetingSummary. `taskItems` / `sgClass1..4` are bound by no template.
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
    // Same 3-document cap the flows enforce: artifact selections + uploads combined.
    get uploadDisabled() { return (this._selectedArtifactFileIds.size + this._sharedFiles.length) >= 3; }
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
            // Interim (non-final) results are ignored — only settled text is committed.
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
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

    /**
     * Opens the standard Salesforce file preview for one ContentDocument.
     *
     * stopPropagation matters: on the Meeting Files rows the row itself toggles
     * selection, so without it a preview click would also select or deselect the file.
     */
    handlePreviewFile(event) {
        event.stopPropagation();
        const documentId = event.currentTarget.dataset.documentId;
        // A row with no ContentDocumentId would navigate to an empty preview.
        if (!documentId) return;
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
    // Categories that exist in the UI but are not selectable yet. The radio is also
    // rendered disabled — this guard is the backstop so the value can never be set.
    static _WIP_MEETING_TYPES = ['working'];
    get isWorkingMeetingSelected() { return false; }

    handleMeetingTypeChange(event) {
        const btn = event.target.closest('[data-type]') || event.currentTarget;
        const type = btn?.dataset?.type;
        if (!type) return;
        if (AdvisorAssistant._WIP_MEETING_TYPES.includes(type)) return;
        this._selectedMeetingType = this._selectedMeetingType === type ? null : type;
        this._dispatchMeetingTypeOutputs();
    }
    handleMeetingFormatChange() {
        this._hasTodos = !this._hasTodos;
        this._dispatchMeetingTypeOutputs();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LIVE ORCHESTRATION — start reading here
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Everything from here to `handleWpGenerated` near the end of the file is what
    // actually runs today: the Configuration column, the tab bar, the primary CTA,
    // the footer, and the bridge to the two children. Most of what sits ABOVE this
    // banner (and everything below the bridge) is LEGACY fork residue.
    //
    // Layout: SLDS 1/3–2/3. Left = Configuration cards, right = the active tab panel.

    // ── Parent-hosted left panel + footer (SLDS 1/3–2/3 layout) ─────────────
    handleMeetingTypeRadioParent(event) {
        const val = event.detail.value;
        this._selectedMeetingType = val || null;
        this._dispatchMeetingTypeOutputs();
    }
    handleParentNotesInput(event) {
        this._freeText = event.detail?.value ?? event.target?.value ?? '';
    }
    /**
     * Meeting Notes textarea.
     *
     * The value is written as textarea child text (`>{_freeText}</textarea>`), which LWC only
     * applies on the FIRST render — so assigning `_freeText` in JS would not update what the
     * user sees. That is LATENT rather than a live bug: this handler and handleParentNotesInput
     * both read FROM the DOM, and the only programmatic writers (handleWpTemplate,
     * handleMsTemplate, handleToggleMicrophone) are not referenced in this template. If one of
     * them is ever wired up, it must call _syncTextarea like
     * handleRunRegenerateInstructions does.
     */
    handleParentNotesTextarea(event) {
        this._freeText = event.target.value || '';
    }
    get hasNotesText() { return (this._freeText || '').trim().length > 0; }
    get filesCountBadge() {
        const n = (this.artifactFiles || []).length + (this._sharedFiles || []).length;
        return n > 0 ? `${n} file${n > 1 ? 's' : ''}` : '';
    }

    // Radio row classes — used by the custom left-panel radios to render selected/unselected pill styles.
    get whiteboardRowClass() { return this._selectedMeetingType === 'whiteboard' ? 'aa-radio-row aa-radio-row--selected' : 'aa-radio-row'; }
    get statusRowClass()     { return this._selectedMeetingType === 'status'     ? 'aa-radio-row aa-radio-row--selected' : 'aa-radio-row'; }
    get annualRowClass()     { return this._selectedMeetingType === 'annual'     ? 'aa-radio-row aa-radio-row--selected' : 'aa-radio-row'; }
    get workingRowClass()    { return 'aa-radio-row aa-radio-row--wip'; }

    // Rich file rows for the left-panel Pictures & Documents card.
    get aaArtifactFiles() {
        return (this.artifactFiles || []).map(f => {
            const ft = (f.fileType || '').toUpperCase();
            let iconWrapClass = 'aa-file-icon aa-file-icon--generic';
            if (ft === 'PDF')                              iconWrapClass = 'aa-file-icon aa-file-icon--pdf';
            else if (ft === 'DOCX' || ft === 'DOC')       iconWrapClass = 'aa-file-icon aa-file-icon--doc';
            else if (['PNG','JPG','JPEG','GIF'].includes(ft)) iconWrapClass = 'aa-file-icon aa-file-icon--img';
            else if (ft === 'TXT')                         iconWrapClass = 'aa-file-icon aa-file-icon--txt';
            return {
                id:        f.id,
                title:     f.title,
                fileType:  ft,
                isSelected:f.isSelected,
                rowClass:  f.isSelected ? 'aa-file-row aa-file-row--selected' : 'aa-file-row',
                checkClass:f.isSelected ? 'aa-file-check aa-file-check--on' : 'aa-file-check aa-file-check--off',
                iconWrapClass,
            };
        });
    }
    get acceptedTodosCountForTab() {
        return this.acceptedTodosCount;
    }
    get actionItemsLabel() {
        const n = this.acceptedTodosCount || 0;
        return n > 0 ? `To-Do's (${n})` : "To-Do's";
    }

    /**
     * The tab bar's five-way value, flattened from the two-field internal state.
     *
     * Internally there are only three tabs ('summary' | 'wealthplan' | 'existing');
     * To-Do's is a SUB-mode of 'summary' selected by `_activeMsSection`, because both
     * are served by the same child component. This getter collapses the pair into the
     * single value the tab bar renders. Read tabs through here, never off `_activeTab`.
     * @returns {'summary'|'todos'|'wealthplan'|'internalnotes'|'existing'}
     */
    get activeTabValue() {
        if (this._activeTab === 'summary' && this._activeMsSection === 'todos') return 'todos';
        return this._activeTab === 'summary' ? 'summary' : this._activeTab;
    }
    get aaTabSummaryClass()    { return this.activeTabValue === 'summary'    ? 'aa-tab-li aa-tab-li--active' : 'aa-tab-li'; }
    get aaTabWealthPlanClass() { return this.activeTabValue === 'wealthplan' ? 'aa-tab-li aa-tab-li--active' : 'aa-tab-li'; }
    get aaTabTodosClass()      { return this.activeTabValue === 'todos'     ? 'aa-tab-li aa-tab-li--active' : 'aa-tab-li'; }
    get aaTabInternalNotesClass() { return this.activeTabValue === 'internalnotes' ? 'aa-tab-li aa-tab-li--active' : 'aa-tab-li'; }

    // ── Tabs with no generation step ─────────────────────────────────────────
    // Internal Notes renders and saves, but has nothing to generate — so it must stay out
    // of the primary CTA's path. Named for the rule it enforces.
    get isInternalNotesTab() { return this.activeTabValue === 'internalnotes'; }
    get tabHasNoGeneration() { return this.isInternalNotesTab; }
    get isInternalNotesTabSelected() { return String(this.isInternalNotesTab); }

    // ── Internal Notes tab ──────────────────────────────────────────────────
    // The editor, its state, its per-event cache and its Apex call all live in
    // <c-advisor-internal-notes>. The parent keeps only what it needs as BROKER:
    // the footer button, and the note id / in-flight state shared across tabs.
    //
    // See that component's header for the tab contract this follows.

    /** Latest `tabstatechange` from the internal-notes tab. */
    @track _internalNotesState = {
        isDirty: false, isSaving: false, canSave: false, savedNoteId: null, statusLabel: ''
    };

    handleInternalNotesStateChange(event) {
        if (event?.detail) this._internalNotesState = { ...event.detail };
    }

    /** Footer action. Thin imperative call, same shape as handleMsSaveReview. */
    handleSaveInternalNotes() {
        const child = this.template.querySelector('c-advisor-internal-notes');
        if (child && typeof child.save === 'function') child.save();
    }

    get showInternalNotesSave() {
        return this.activeTabValue === 'internalnotes' && !!this._selectedEventId;
    }
    get internalNotesSaveDisabled() {
        // Both tabs can create the note record, so never let their saves overlap.
        return this.anySaveInFlight || !this._internalNotesState.canSave;
    }
    get saveInternalNotesLabel() {
        return this._internalNotesState.isSaving ? 'Saving…' : 'Save Internal Notes';
    }

    /**
     * THE note record for the selected event, merged from every source that can know one.
     *
     * Two children can CREATE a MeetingNote__c, and `inputMeetingNotes` is a snapshot queried
     * at load that goes stale the moment either does. So each tab reports the id it knows and
     * the parent merges them here, then hands the result back down. Sending a blank id when a
     * record already exists is what produces duplicates.
     */
    get resolvedNoteId() {
        return this.selectedEventNote?.Id
            || this._internalNotesState.savedNoteId
            || this._msState.savedNoteId
            || '';
    }

    /** True while either tab is saving. Prevents two blank-id creates racing. */
    get anySaveInFlight() {
        return !!this._internalNotesState.isSaving || !!this._msState.isSaving;
    }

    /**
     * Tab bar click. Inverse of `activeTabValue`: expands the flat tab id back into
     * `_activeTab` + `_activeMsSection`. Choosing To-Do's also latches `_hasTodos`,
     * which is what tells the generation Flow to produce action items.
     */
    handleAaTabClick(event) {
        const v = event.currentTarget.dataset.tab;
        if (v === 'summary') {
            this._activeTab = 'summary';
            this._activeMsSection = 'meeting';
        } else if (v === 'wealthplan') {
            this._activeTab = 'wealthplan';
        } else if (v === 'todos') {
            this._activeTab = 'summary';
            this._activeMsSection = 'todos';
            this._hasTodos = true;
        } else if (v === 'internalnotes') {
            this._activeTab = v;
        }
    }
    // Kept for compatibility with any leftover references — no longer wired to a lightning-tab.
    handleTabActivate(event) { return this.handleAaTabClick(event); }

    handleParentRegenerate() {
        // Ensure Wealth Plan tab is active so the child is mounted, then invoke its @api regenerate().
        const wasWp = this._activeTab === 'wealthplan';
        this._activeTab = 'wealthplan';
        const invoke = () => {
            const child = this.template.querySelector('c-advisor-wealth-plan');
            if (child && typeof child.regenerate === 'function') child.regenerate();
        };
        if (wasWp) invoke();
        else setTimeout(invoke, 30); // let the tab switch mount the child
    }

    // ── Dynamic primary CTA — label + handler adapt to the active tab ────────
    get primaryActionLabel() {
        const tab = this.activeTabValue;
        if (tab === 'wealthplan') return 'Generate Wealth Plan';
        if (tab === 'todos')      return "Generate To-Do's";
        return 'Generate Meeting Summary';
    }
    get primaryActionBtnClass() {
        // Matches .aa-regen-btn but the label/handler differ per tab.
        return 'aa-regen-btn';
    }
    /** advisorAssistant renders TWO c-advisor-meeting-summary instances — the Meeting
     *  Summary panel and the To-Do's panel — and both stay mounted (hidden via CSS, not
     *  lwc:if). A bare querySelector('c-advisor-meeting-summary') always returns the
     *  first, so every imperative call must say which panel it means. */
    _msChild(role) {
        return this.template.querySelector(`c-advisor-meeting-summary[data-role="${role}"]`);
    }

    /**
     * The footer's single primary CTA. One button, three destinations — it dispatches
     * to whichever child owns the active tab, guards against double-firing, and
     * enforces the two preconditions for a meeting summary (a category must be
     * chosen; an unpublished draft must not be silently overwritten).
     */
    handlePrimaryAction() {
        // Jobs run in parallel — the three targets (summary flow, wealth-plan flow,
        // todos flow) are independent Apex calls on independent child instances.
        // If the same tab is already running, no-op instead of double-firing.
        const tab = this.activeTabValue;
        if (tab === 'internalnotes') return;
        if (tab === 'wealthplan') {
            if (this._bgJobs.wealthplan) return;
            this._bgJobs = { ...this._bgJobs, wealthplan: true };
            this._startProgressCycle();
            const child = this.template.querySelector('c-advisor-wealth-plan');
            if (child && typeof child.regenerate === 'function') child.regenerate();
            return;
        }
        // Both 'summary' and 'todos' route to advisorMeetingSummary — but they are TWO
        // separate always-mounted instances (panels are CSS-hidden, not lwc:if), so the
        // call must target the one whose panel the user is looking at.
        if (tab === 'todos') {
            const todosChild = this._msChild('todos');
            if (!todosChild) return;
            if (this._bgJobs.todos) return;
            this._bgJobs = { ...this._bgJobs, todos: true };
            this._startProgressCycle();
            if (typeof todosChild.generateTodos === 'function') todosChild.generateTodos();
        } else {
            if (this._bgJobs.summary) return;
            // Meeting Category is required for a meeting summary — draw attention to the
            // card rather than failing silently.
            if (!this._selectedMeetingType) {
                this._flagCategoryRequired();
                return;
            }
            // Never destroy an unpublished draft without offering to save it first.
            if (this._msState.hasUnpublishedSummary) {
                this._showSaveBeforeGenerate = true;
                return;
            }
            this._runSummaryGeneration();
        }
    }

    // ── Meeting Category required-field handling ─────────────────────────────
    /** Open + pulse the Meeting Category card so it is obvious what is blocking. */
    _flagCategoryRequired() {
        this._cardOpen = { ...this._cardOpen, category: true };
        this._categoryFlash = true;
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => { this._categoryFlash = false; }, 1200);
    }
    @track _categoryFlash = false;
    /** Event selection is the required step BEFORE category, so the category cue stays
     *  quiet until an event is chosen — otherwise it competes with the event picker. */
    get needsEventFirst() {
        return this.showMeetingCategory && this.noEventSelected;
    }
    /** True once an event is chosen but no category has been picked yet. */
    get isCategoryMissing() {
        return this.showMeetingCategory && !this.noEventSelected && !this._selectedMeetingType;
    }
    /** Persistent attention cue while unset, plus a stronger flash on a blocked click. */
    get categoryCardClass() {
        let c = this.isCategoryOpen ? 'aa-card aa-card--open' : 'aa-card aa-card--closed';
        if (this.isCategoryMissing) c += ' aa-card--required';
        if (this._categoryFlash)    c += ' aa-card--flash';
        return c;
    }
    /** Chip in the card header: the chosen category, or a Required marker. */
    get categoryHeaderChipClass() {
        return this._selectedMeetingType ? 'aa-chip aa-chip-brand' : 'aa-chip aa-chip-required';
    }
    get categoryHeaderChipLabel() {
        return this.meetingTypeLabel || 'Required';
    }
    /** Generate is blocked on the summary tab until a category is chosen. */
    get isPrimaryActionDisabled() {
        if (this.activeTabValue === 'summary') return !this._selectedMeetingType;
        return false;
    }

    // ── Save-before-regenerate ───────────────────────────────────────────────
    @track _showSaveBeforeGenerate = false;
    get saveBeforeGenerateBody() {
        return this._msState.hasUnsavedChanges
            ? 'This event already has a meeting summary with unsaved changes. Generating a new one replaces it.'
            : 'This event already has an unpublished meeting summary. Generating a new one replaces it.';
    }
    handleCancelSaveBeforeGenerate() { this._showSaveBeforeGenerate = false; }

    /** Save the existing note first, then generate the replacement. */
    async handleSaveThenGenerate() {
        this._showSaveBeforeGenerate = false;
        const child = this._msChild('summary');
        if (!child || typeof child.saveNote !== 'function') return;
        let saved = false;
        // saveNote() reports failure by returning false — it toasts rather than throwing,
        // so a bare await would look like success and we would destroy an unsaved draft.
        try { saved = await child.saveNote(); }
        catch (e) { saved = false; }
        if (!saved) {
            this._showToast('Not Generated',
                'The existing summary could not be saved, so it was left untouched. Resolve the save error and try again.',
                'error');
            return;
        }
        this._runSummaryGeneration();
    }

    /** Explicitly discard the existing draft and generate a replacement. */
    handleDiscardThenGenerate() {
        this._showSaveBeforeGenerate = false;
        this._runSummaryGeneration();
    }

    _runSummaryGeneration() {
        const summaryChild = this._msChild('summary');
        if (!summaryChild) return;
        if (this._bgJobs.summary) return;
        this._bgJobs = { ...this._bgJobs, summary: true };
        this._startProgressCycle();
        if (typeof summaryChild.generateSummary === 'function') summaryChild.generateSummary();
    }

    // Simple parent-level progress simulation so the tab loader progress bar animates
    // during generation. Runs from 0 → ~90% over ~30s and pauses; completion events
    // in handleSummaryChange / handleTodosChange / handleWpGenerated jump it to 100.
    _progressTimerId = null;
    _startProgressCycle() {
        this._stopProgressCycle();
        this._progressValue = 5;
        const step = () => {
            if (!this.isAnyJobRunning) { this._stopProgressCycle(); return; }
            // Ease toward 90% — larger steps early, smaller as it gets close.
            const remaining = 90 - this._progressValue;
            if (remaining <= 0) return;
            const inc = Math.max(0.5, remaining * 0.06);
            this._progressValue = Math.min(90, this._progressValue + inc);
        };
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._progressTimerId = setInterval(step, 500);
    }
    _stopProgressCycle() {
        if (this._progressTimerId) {
            clearInterval(this._progressTimerId);
            this._progressTimerId = null;
        }
    }
    _finishProgress() {
        this._progressValue = 100;
        this._stopProgressCycle();
        // Reset to 0 after a brief moment so a subsequent job starts fresh.
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            if (!this.isAnyJobRunning) this._progressValue = 0;
        }, 800);
    }

    // ── Per-tab "has data" + tab panel visibility ────────────────────────
    get summaryTabHasData() { return this.hasSummaryForEvent; }
    get wpTabHasData()      { return Array.isArray(this._sections) && this._sections.length > 0; }
    get todosTabHasData()   { return (this._meetingTodos && this._meetingTodos.length > 0); }
    get activeTabHasData() {
        const t = this.activeTabValue;
        if (t === 'internalnotes') return false;
        if (t === 'wealthplan') return this.wpTabHasData;
        if (t === 'todos')      return this.todosTabHasData;
        return this.summaryTabHasData;
    }
    // Footer's primary CTA hides on empty tabs — the hero CTA in the body takes over.
    get showFooterPrimaryCta() {
        // Nothing to generate from a placeholder tab, even if a background job is running.
        if (this.tabHasNoGeneration) return false;
        return this.activeTabHasData || this.isAnyJobRunning;
    }
    // The tab body renders one of loader / hero / child (via visibility classes).
    get showSummaryHero()  { return this.activeTabValue === 'summary'    && !this.isSummaryGenerating && !this.summaryTabHasData; }
    get showWpHero()       { return this.activeTabValue === 'wealthplan' && !this.isWpGenerating     && !this.wpTabHasData; }
    get showTodosHero()    { return this.activeTabValue === 'todos'      && !this.isTodosGenerating  && !this.todosTabHasData; }

    // Loaders only render on the ACTIVE tab — off-tab jobs show up in the banner + tab pill only.
    get showSummaryLoader() { return this.activeTabValue === 'summary'    && this.isSummaryGenerating; }
    get showWpLoader()      { return this.activeTabValue === 'wealthplan' && this.isWpGenerating; }
    get showTodosLoader()   { return this.activeTabValue === 'todos'      && this.isTodosGenerating; }

    // Panel visibility — keep all three children mounted so their state survives tab switches
    _panelClass(active) { return active ? 'aa-tab-panel' : 'aa-tab-panel aa-tab-panel--hidden'; }
    get summaryPanelClass() { return this._panelClass(this.activeTabValue === 'summary' && this.summaryTabHasData && !this.isSummaryGenerating); }
    get wpPanelClass()      { return this._panelClass(this.activeTabValue === 'wealthplan' && this.wpTabHasData && !this.isWpGenerating); }
    get todosPanelClass()   { return this._panelClass(this.activeTabValue === 'todos' && this.todosTabHasData && !this.isTodosGenerating); }
    // Internal Notes has no "has data" or "generating" gate — it is an editor, always ready.
    get internalNotesPanelClass() { return this._panelClass(this.activeTabValue === 'internalnotes'); }

    // Tab-label pill class — spinner when generating, otherwise hidden.
    get summaryTabPillClass() { return this.isSummaryGenerating ? 'aa-tab-pill aa-tab-pill--running' : 'aa-tab-pill aa-tab-pill--hidden'; }
    get wpTabPillClass()      { return this.isWpGenerating      ? 'aa-tab-pill aa-tab-pill--running' : 'aa-tab-pill aa-tab-pill--hidden'; }
    get todosTabPillClass()   { return this.isTodosGenerating   ? 'aa-tab-pill aa-tab-pill--running' : 'aa-tab-pill aa-tab-pill--hidden'; }
    /**
     * Internal Notes was the only tab with no indicator, so from another tab there was no way to
     * tell notes were unsaved. Unlike the other three this is not about a generation job — there
     * is none — it reflects the save state the child already reports via `tabstatechange`.
     */
    get internalNotesTabPillClass() {
        if (this._internalNotesState.isSaving) return 'aa-tab-pill aa-tab-pill--running';
        if (this._internalNotesState.isDirty)  return 'aa-tab-pill aa-tab-pill--unsaved';
        return 'aa-tab-pill aa-tab-pill--hidden';
    }
    /** Spelt out for the title attribute, since a coloured dot alone says nothing. */
    get internalNotesTabPillTitle() {
        if (this._internalNotesState.isSaving) return 'Saving internal notes…';
        if (this._internalNotesState.isDirty)  return 'Internal notes have unsaved changes';
        return '';
    }
    get hasBackgroundBanner() {
        // Show a banner if a job is running on a tab OTHER than the active one.
        const active = this.activeTabValue;
        if (active !== 'summary'   && this.isSummaryGenerating) return true;
        if (active !== 'wealthplan'&& this.isWpGenerating)      return true;
        if (active !== 'todos'     && this.isTodosGenerating)   return true;
        return false;
    }
    get backgroundBannerLabel() {
        const parts = [];
        if (this.activeTabValue !== 'summary'    && this.isSummaryGenerating) parts.push('Meeting Summary');
        if (this.activeTabValue !== 'wealthplan' && this.isWpGenerating)      parts.push('Wealth Plan');
        if (this.activeTabValue !== 'todos'      && this.isTodosGenerating)   parts.push("To-Do's");
        if (parts.length === 0) return '';
        return `${parts.join(' & ')} still generating in the background…`;
    }

    disconnectedCallback() {
        // Clear generated data on component teardown so a fresh open starts empty.
        this._sections = [];
        this._meetingTodos = [];
        this._currentNoteHtml = null;
        this._meetingSummaryResult = '';
        this._notePublishedLocally = false;
        this._acceptedTodosCount = 0;
        this._bgJobs = { summary: false, wealthplan: false, todos: false };
        this._stopProgressCycle();
        // Ask children to clear their local caches too
        const children = this.template.querySelectorAll('c-advisor-meeting-summary, c-advisor-wealth-plan');
        children.forEach(c => { if (typeof c.resetState === 'function') c.resetState(); });

        // Timer / listener teardown
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

    // Meeting Category is only relevant to Meeting Summary generation.
    get showMeetingCategory() {
        return this.activeTabValue === 'summary';
    }

    // Background job tracker — flips on when a generation kicks off, off when the child emits completion.
    @track _bgJobs = { summary: false, wealthplan: false, todos: false };
    get isSummaryGenerating()    { return !!this._bgJobs.summary; }
    get isWpGenerating()         { return !!this._bgJobs.wealthplan; }
    get isTodosGenerating()      { return !!this._bgJobs.todos; }
    get isAnyJobRunning()        { return this.isSummaryGenerating || this.isWpGenerating || this.isTodosGenerating; }

    // Regenerate-with-instructions state for the Configuration card
    @track _regenInstructions = '';
    handleRegenInstructionsInput(event) { this._regenInstructions = event.target.value || ''; }
    /** Meeting Summary tab only — the Wealth Plan has no regenerate-with-instructions. */
    get showRegenerateInstructions() {
        return this.activeTabValue === 'summary' && this.hasSummaryForEvent && !this.isNotePublished;
    }
    /**
     * Gates the CTA's very existence, not just its disabled state — an action that cannot do
     * anything yet should not be on screen. See the template.
     */
    get canRegenerateInstructions() {
        return (this._regenInstructions || '').trim().length > 0;
    }
    /**
     * Push a value into a native <textarea> that LWC cannot update on its own.
     *
     * A textarea's value comes from child text, which LWC applies only on the first render, so
     * assigning the backing field in JS leaves the visible text stale. Anywhere such a field is
     * set PROGRAMMATICALLY (as opposed to from the user's own input event) has to write the
     * element too.
     *
     * @param {string} refName lwc:ref of the textarea
     * @param {string} value   value to show
     */
    _syncTextarea(refName, value) {
        const el = this.refs?.[refName];
        if (el) el.value = value || '';       // absent when that card is collapsed or hidden
    }

    handleRunRegenerateInstructions() {
        const instructions = (this._regenInstructions || '').trim();
        if (!instructions) return;
        const child = this._msChild('summary');
        if (child && typeof child.regenerateSummaryWithInstructions === 'function') {
            child.regenerateSummaryWithInstructions(instructions);
        }
        // Optimistic: clear the textarea and mark bg job running
        this._regenInstructions = '';
        this._syncTextarea('regenInstructions', '');
        this._bgJobs = { ...this._bgJobs, summary: true };
    }

    // Whole-Configuration-column collapse (session-only, defaults expanded).
    @track _configCollapsed = false;
    handleToggleConfigCollapsed() { this._configCollapsed = !this._configCollapsed; }
    get aaBodyClass()          { return this._configCollapsed ? 'aa-body fade-in aa-body--config-collapsed' : 'aa-body fade-in'; }
    get configCollapseIconClass() { return this._configCollapsed ? 'aa-config-collapse-icon aa-config-collapse-icon--collapsed' : 'aa-config-collapse-icon'; }

    // ── Collapsible Configuration cards ────────────────────────────────────
    // `undefined` = auto (open if the card has data). Setting true/false is an explicit user override.
    @track _cardOpen = { category: undefined, notes: undefined, files: undefined, docs: undefined, regen: undefined };
    // String mirrors for aria-expanded on the collapsible Configuration cards.
    get categoryExpanded() { return String(this.isCategoryOpen); }
    get notesExpanded()    { return String(this.isNotesOpen); }
    get filesExpanded()    { return String(this.isFilesOpen); }
    get docsExpanded()     { return String(this.isDocsOpen); }
    get regenExpanded()    { return String(this.isRegenOpen); }

    get isRegenOpen() {
        // Auto-open when the user has typed something; otherwise start collapsed.
        return this._cardOpen.regen ?? ((this._regenInstructions || '').trim().length > 0);
    }
    get regenCardClass() { return this.isRegenOpen ? 'aa-card aa-card--open' : 'aa-card aa-card--closed'; }

    get isCategoryOpen() {
        // Auto-open only once an event is selected and no category has been chosen —
        // it blocks generation at that point, so surface the options. Before an event is
        // picked, and after a category is set, it defaults closed (the header chip shows
        // the choice). An explicit user toggle always wins.
        return this._cardOpen.category ?? this.isCategoryMissing;
    }
    get isNotesOpen() {
        return this._cardOpen.notes ?? ((this._freeText || '').trim().length > 0);
    }
    get isFilesOpen() {
        return this._cardOpen.files ?? this.hasArtifactFiles;
    }
    get isDocsOpen() {
        return this._cardOpen.docs ?? ((this._sharedFiles || []).length > 0);
    }

    // categoryCardClass is defined once, above, alongside the required-field handling.
    get notesCardClass()    { return this.isNotesOpen    ? 'aa-card aa-card--open' : 'aa-card aa-card--closed'; }
    get filesCardClass()    { return this.isFilesOpen    ? 'aa-card aa-card--open' : 'aa-card aa-card--closed'; }
    get docsCardClass()     { return this.isDocsOpen     ? 'aa-card aa-card--open' : 'aa-card aa-card--closed'; }

    handleCardToggle(event) {
        const key = event.currentTarget.dataset.card;
        if (!key) return;
        const currentlyOpen =
            key === 'category' ? this.isCategoryOpen :
            key === 'notes'    ? this.isNotesOpen    :
            key === 'files'    ? this.isFilesOpen    :
            key === 'docs'     ? this.isDocsOpen     :
            key === 'regen'    ? this.isRegenOpen    : false;
        this._cardOpen = { ...this._cardOpen, [key]: !currentlyOpen };
    }

    // Uploaded documents (drop zone) badge.
    get uploadedCountBadge() {
        const n = (this._sharedFiles || []).length;
        return n > 0 ? `${n} file${n > 1 ? 's' : ''}` : '';
    }

    // Handle native file-input selection from the Document Upload drop zone.

    // Save & Exit / Save to Wealth Plan only appear when there is something to save.
    get hasSaveableChanges() {
        // A generated/edited meeting note, a generated wealth plan, or accepted todos count all count as saveable.
        const hasMeetingNote = !!(this._currentNoteHtml || this._meetingSummaryResult);
        const hasSummary = !!(this._summary && this._summary.length > 0);
        const hasSections = Array.isArray(this._sections) && this._sections.length > 0;
        const hasTodos = (this._acceptedTodosCount || 0) > 0;
        return hasMeetingNote || hasSummary || hasSections || hasTodos;
    }

    // Footer buttons appear when the current tab has an action-ready state.
    // Publish + Publish & Exit: summary tab has a draft note that isn't published yet.
    /* Footer actions for the meeting summary mirror the child's own save bar:
       unsaved draft  → Save & Review / Save & Publish / Save & Exit
       already saved  → Publish / Publish & Exit
       Driven by _msState (reported by the child), because this component's own
       hasSummaryForEvent / isNotePublished copies are stale — their backing fields
       are never written here. */
    get showSummaryActions() {
        return this.activeTabValue === 'summary'
            && this._msState.hasSummary
            && !this._msState.isPublished
            && !this._msState.isGenerating;
    }
    get showSummarySaveActions() { return this.showSummaryActions &&  this._msState.hasUnsavedChanges; }
    get showPublishButtons()     { return this.showSummaryActions && !this._msState.hasUnsavedChanges; }
    get summaryActionsBusy()     { return !!this._msState.isSaving; }
    // Delete Note: summary tab has a persisted note that isn't published.
    get showDeleteNoteButton() {
        return this.activeTabValue === 'summary' && this._msState.canDelete;
    }

    /** Save the draft without publishing — the "Save & Review" path. */
    handleMsSaveReview() {
        const child = this._msChild('summary');
        if (child && typeof child.saveNote === 'function') child.saveNote();
    }
    /** Save, then leave. Publishing stays a separate, later decision. */
    handleMsSaveAndExit() {
        const child = this._msChild('summary');
        if (child && typeof child.saveNoteAndExit === 'function') child.saveNoteAndExit();
    }
    // Save to Wealth Plan + Save & Exit: wealth-plan tab has generated sections.
    get showWealthPlanSave() {
        return this.activeTabValue === 'wealthplan' && Array.isArray(this._sections) && this._sections.length > 0;
    }
    /** Authoritative meeting-summary state, reported by the child. The parent's own
     *  hasSummaryForEvent / isNotePublished copies are stale (their backing fields are
     *  never written here), so the footer and the overwrite guard use this instead.
     *
     *  FIXME (DEFECTS.md #9): the child emits EIGHT keys; only four are seeded here.
     *  hasSummary / isPublished / isGenerating / isSaving read as `undefined` until the
     *  child's first msstatechange. Benign today (those footer buttons simply stay
     *  hidden), but a future `if (!this._msState.isSaving)` would treat the unreported
     *  state as false. Initialise all eight to false. */
    @track _msState = {
        canPublish: false, canDelete: false, hasSummary: false, isPublished: false,
        isGenerating: false, isSaving: false, hasUnpublishedSummary: false,
        hasUnsavedChanges: false, savedNoteId: null
    };
    handleMsStateChange(event) {
        if (!event?.detail) return;
        this._msState = { ...this._msState, ...event.detail };
    }

    handleMsPublish() {
        const child = this._msChild('summary');
        if (child && typeof child.publishNote === 'function') child.publishNote();
    }
    handleMsPublishAndExit() {
        const child = this._msChild('summary');
        if (child && typeof child.publishNoteAndExit === 'function') child.publishNoteAndExit();
    }
    handleMsDelete() {
        const child = this._msChild('summary');
        if (child && typeof child.deleteNote === 'function') child.deleteNote();
    }

    async handleParentSaveAndExit() {
        // Persist first — exiting without saving silently discards summary edits.
        const child = this._msChild('summary');
        if (child && typeof child.saveNote === 'function') {
            try { await child.saveNote(); } catch (e) { /* toast already raised by the child */ }
        }
        if (this.modalMode) {
            this.handleCloseModal?.();
            return;
        }
        try { this.dispatchEvent(new FlowNavigationNextEvent()); } catch (e) { /* not in a flow */ }
    }

    handleParentSaveToWealthPlan() {
        // Delegate to the wealth plan child's save-preview flow (opens its confirm modal).
        const wasWp = this._activeTab === 'wealthplan';
        this._activeTab = 'wealthplan';
        const invoke = () => {
            const child = this.template.querySelector('c-advisor-wealth-plan');
            if (child && typeof child.triggerSave === 'function') child.triggerSave();
        };
        if (wasWp) invoke();
        else setTimeout(invoke, 30);
    }

    // ── LEGACY (unreachable): the to-do list editor ──────────────────────────
    // Accept / undo / remove / edit / save-all for AI-generated action items, plus
    // the `saveTodos` Apex call. The live version is in advisorMeetingSummary (the
    // instance mounted with data-role="todos"). The parent now only mirrors the
    // resulting list via `handleTodosChange` so the tab badge can show a count.
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
        const rawEvent = (this.allKnownEvents || []).find(e => e.Id === this._selectedEventId);
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
        const rawEvent = (this.allKnownEvents || []).find(e => e.Id === this._selectedEventId);
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
    // theme system removed — single unified design
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

    // ╔═══════════════════════════════════════════════════════════════════════╗
    // ║ LEGACY (unreachable) — the pre-split WEALTH PLAN engine                ║
    // ╠═══════════════════════════════════════════════════════════════════════╣
    // ║ From here to the end of the class: generation, AI-JSON parsing, the    ║
    // ║ review grid, existing-record merge/diff, row editing, locking,         ║
    // ║ duplicate detection, undo/redo, the save preview and the save Apex     ║
    // ║ call, keyboard navigation, and the selection→task popup.               ║
    // ║                                                                       ║
    // ║ All of it now lives in advisorWealthPlan.js. Nothing here is bound by  ║
    // ║ advisorAssistant.html — the parent shows the wealth plan solely by     ║
    // ║ mounting <c-advisor-wealth-plan> and listening for `wpgenerated`.      ║
    // ║                                                                       ║
    // ║ This block is also the ONLY consumer of the 18 @wire adapters near the ║
    // ║ top of the file, which is why they still run on every mount.           ║
    // ║ Exception: `_showToast` and the CHILD BRIDGE section at the very end   ║
    // ║ ARE live — they sit after this block, not inside it.                   ║
    // ╚═══════════════════════════════════════════════════════════════════════╝

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
            const evt = (this.allKnownEvents || []).find(e => e.Id === this._selectedEventId);
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

    // NOTE: teardown lives in the single disconnectedCallback above — a second
    // definition here would silently override it (later member wins).

    /**
     * Turns the AI's raw response into `_sections`, defensively.
     *
     * The model is asked for JSON but in practice returns it wrapped in prose,
     * ```json fences, smart quotes, zero-width characters or a BOM — sometimes all
     * at once. Rather than fail the generation, this walks a fixed cleanup ladder:
     *   1. strip BOM / zero-width chars / smart quotes / markdown fences;
     *   2. treat anything before the first `{` or `[` as a prose summary and keep it;
     *   3. truncate at the LAST matching bracket, discarding trailing commentary;
     *   4. JSON.parse; on failure, show the raw text as the summary and fall back to
     *      empty sections so the advisor still sees something and can regenerate.
     * Parsed keys are then normalised through FIELD_ALIASES.
     *
     * @param {string} raw Apex/Flow response
     * @returns {void} writes `_summary` and `_sections`
     */
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
            console.error('[AdvisorAssistant] JSON.parse failed:', e.message, '| Input:', jsonStr.substring(0, 300));
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

    /**
     * The complete render model for the wealth-plan review grid — the single most
     * expensive getter in the file, and the reason the wires exist.
     *
     * It joins four sources into one array the template can render without logic:
     * `_sections` (AI + existing records), SECTIONS (field metadata),
     * `_selectOptionsMap` (picklist options), and the per-row UI state maps
     * (`_lockedRows`, `_editedRows`, `_deletedRows`, `_duplicateFlags`,
     * `_existingSnapshots`). For every field it precomputes the widget flags
     * (isSelect/isCheckbox/…), the option list, validity and error message; for
     * every row the CSS class, source badge, title/subtitle/meta chips and diff
     * fields; for every section the progress percentage.
     *
     * Two passes on purpose: a cheap stats pass over ALL records so the section
     * headers stay accurate, and the expensive display pass only for expanded
     * sections. Without that split, a household with hundreds of records
     * recomputes every collapsed row on each keystroke.
     *
     * LEGACY — the live implementation is advisorWealthPlan's `_buildReviewSections`,
     * which memoises this into a tracked field instead of recomputing per render.
     */
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
                            // Do NOT write back to `rec` here — this is a getter, and
                            // mutating tracked state during render can loop re-renders.
                            // The normalised value is carried by matchedValue below.
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
    // Every selector below MUST resolve inside THIS component's template —
    // this.template.querySelector cannot pierce c-advisor-meeting-summary /
    // c-advisor-wealth-plan shadow roots. Steps are ordered top-to-bottom, and the
    // step number lives only in the badge ({tourStepNum} / {tourStepTotal}) so that
    // conditionally-rendered steps being skipped never desyncs the numbering.
    /**
     * The guided tour, in the order the advisor works: pick an event, give it context, generate,
     * then the four tabs where results land.
     *
     * Every selector is resolved with `this.template.querySelector`, so it can only reach THIS
     * component's template — the `data-tour` anchors inside advisorMeetingSummary belong to that
     * component's own separate tour and are unreachable from here.
     *
     * `_positionTour` SILENTLY SKIPS any step whose target is not in the DOM, so a stale selector
     * shrinks the tour with no error. Two consequences worth knowing:
     *
     *  - Step 6 must be `.aa-footer-left .aa-primary-cta`, not `.aa-primary-cta`. That class
     *    matches five elements and querySelector takes the first in document order; on a fresh
     *    start `showSummaryHero` is true, so a bare selector highlighted the hero's "Generate
     *    Meeting Summary" button mid-page while this text described the footer's persistent CTA.
     *  - `_positionTour` places the bubble against a fixed assumed height (BH = 180), so `text`
     *    stays short. Keep it under ~170 characters or the bubble overflows its own box.
     *
     * The tour deliberately does NOT switch tabs as it advances: pointing at a tab button while
     * describing what is behind it has no side effects, and it avoids leaving the advisor parked
     * on Internal Notes when the tour finishes. `tourStepTotal` derives from this array's length,
     * so the "Step n of N" counter looks after itself.
     */
    _tourDefs = [
        { selector: '.aa-header-event-zone',            title: 'Select an Event',    text: 'Start here. Choose the meeting event you want to document. This anchors all context for the AI. Use Range to look further back.',             position: 'bottom' },
        { selector: '[data-card="category"]',           title: 'Meeting Category',   text: 'Tell the AI what kind of meeting this is. This shapes how the summary is structured — Whiteboard, Status, or Annual Review.',                  position: 'right'  },
        { selector: '[data-card="notes"]',              title: 'Manual Notes',       text: 'Type your own free-text notes from the meeting here. The richer and more detailed your notes, the better the AI summary.',                     position: 'right'  },
        { selector: '[data-card="files"]',              title: 'Meeting Files',      text: 'Pick documents already attached to the event. These are sent to the AI as context, and the eye icon previews one without leaving.',            position: 'right'  },
        { selector: '[data-card="docs"]',               title: 'Document Upload',    text: 'Upload supporting documents from your machine to give the AI extra material to work from.',                                                    position: 'right'  },
        { selector: '.aa-footer-left .aa-primary-cta',  title: 'Generate',           text: 'When you\'re ready, click Generate. It targets whichever tab you\'re on, and jobs keep running if you switch away.',                            position: 'top'    },
        { selector: '[data-tab="summary"]',             title: 'Meeting Summary',    text: 'The AI note lands here, with a short At a Glance brief above it. Edit either one, regenerate with instructions, then Save & Publish.',         position: 'bottom' },
        { selector: '[data-tab="wealthplan"]',          title: 'Wealth Plan',        text: 'Structured portfolio suggestions to review row by row. Accept the ones you want, then Save to Wealth Plan writes only those.',                 position: 'bottom' },
        { selector: '[data-tab="todos"]',               title: 'To-Do\'s',            text: 'Action items pulled from the summary. Accept the ones you want and save them as Tasks — or add one yourself if the AI missed it.',             position: 'bottom' },
        { selector: '[data-tab="internalnotes"]',       title: 'Internal Notes',     text: 'Your private notes. Never shared with the client and never part of the summary. They save themselves a few seconds after you stop typing.',    position: 'bottom' },
        { selector: '.aa-guide-trigger',                title: 'User Guide',         text: 'Click the ? button at any time to open the User Guide — tips, feature descriptions, and what\'s new are all in there.',                          position: 'bottom' }
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
        // Only dismiss the banner once we know at least one step can actually render.
        // Otherwise a stale selector list silently eats the banner for the whole session.
        const hasTarget = this._tourDefs.some(d => this.template.querySelector(d.selector));
        if (!hasTarget) return;
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
    get containerClass() { return this.modalMode ? 'aa-root wph-overlay-panel' : 'aa-root'; }
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

    /**
     * Routes every reviewed record into insert / update / delete buckets and hands
     * them to the `saveWealthPlan` Apex method as JSON.
     *
     * The routing rule is the important part, and it is deliberately conservative:
     * **only LOCKED rows are saved.** Locking is the advisor's explicit "I have
     * checked this" gesture, so an unreviewed AI suggestion can never reach the
     * database. Per record:
     *   existing + marked deleted            → delete
     *   existing + edited + locked           → update
     *   not existing (AI/manual) + locked    → create
     *   anything else                        → skipped
     * `clean()` projects each record down to the fields declared in SECTIONS,
     * dropping the internal `_id` / `_source` / `_rowClass` bookkeeping.
     *
     * Apex returns the literal 'Saved' on full success, otherwise a JSON envelope
     * `{ errors: [...], successSections: [...] }` so a partial failure can be shown
     * per section rather than as one opaque error.
     *
     * @param {object} preview the confirm-modal preview built by `handlePreviewSave`
     */
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

            // FIXME (DEFECTS.md #2): `inputAccountId` is declared nowhere in this class
            // — not as @api, not as a field — so it is always undefined and Apex always
            // receives accountId: ''. The same line exists in both children, where it IS
            // reached. The intended value is almost certainly `_resolvedPrimaryMemberId`.
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
    // FEATURE 10: UNDO / REDO   (LEGACY — live copy in advisorWealthPlan.js)
    // ══════════════════════════════════════════════════════════════════════════
    //
    // Command-pattern, not snapshot-based: the review grid can hold thousands of
    // records, so cloning `_sections` per keystroke is not viable. Each mutation
    // pushes a small descriptor { type, …payload } instead, and `_applyUndoAction`
    // both reverses it and RETURNS the inverse descriptor, which is what gets pushed
    // onto the redo stack — so redo is just undo applied to the inverse.
    //
    // Action types: edit, lock, unlock, lockSection, unlockSection, add, delete,
    // markDelete, unmarkDelete, batchLock, batchUnlock.
    // The stack is capped at 50 entries; any new action clears the redo stack.

    /** Push a reversible action, evicting the oldest past 50 and invalidating redo. */
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
    // FEATURE 5: KEYBOARD SHORTCUTS   (LEGACY — live copy in advisorWealthPlan.js)
    // ══════════════════════════════════════════════════════════════════════════

    _boundKeyHandler;

    /**
     * Row navigation for the review grid: ↑/↓ move focus, Enter edits, d/Delete
     * marks for deletion, Escape cancels. Bound to `document` rather than the host
     * so it works while focus sits anywhere in the page, and it deliberately
     * ignores keys typed into inputs, textareas, selects and contenteditables.
     *
     * FIXME (DEFECTS.md #7): the guard below is why this never runs in this
     * component — `_step` is pinned to 'summary' by connectedCallback and no live
     * path sets 'review'. The listener is still registered on every mount.
     */
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

    // ═══════════════════════════════════════════════════════════════════════
    // CHILD BRIDGE — the parent↔child contract
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Downwards: imperative @api calls on the child (`_msChild(role).saveNote()`,
    //            `wealthPlanChild.regenerate()`, …).
    // Upwards:   plain CustomEvents, because a nested component cannot reach the
    //            Flow runtime. Five events, all handled below:
    //
    //   summarychange  { summaryHtml }                → mirror + clear the summary job
    //   todoschange    { todos, acceptedCount }       → mirror + clear the todos job
    //   wpgenerated    { summary, sections }          → mirror + clear the WP job
    //   msstatechange  { canPublish, canDelete, … }   → `handleMsStateChange`, drives the footer
    //   flowoutput     { attributeName, attributeValue } → re-emitted as a real Flow event
    //   flownext       (no detail)                    → re-emitted as FlowNavigationNextEvent
    //
    // The three "…change" handlers are also how a background job is known to have
    // finished: the child does not report completion separately, so the arrival of
    // its result is the completion signal that clears `_bgJobs` and the progress bar.

    /** Fired by c-advisor-meeting-summary when the generated/edited summary HTML changes */
    handleSummaryChange(event) {
        this._meetingSummaryResult = event.detail.summaryHtml || '';
        this._currentNoteHtml = event.detail.summaryHtml || null;
        this.outputMeetingSummary = this._meetingSummaryResult;
        this.dispatchEvent(new FlowAttributeChangeEvent('outputMeetingSummary', this.outputMeetingSummary));
        // A summary just materialized — the summary bg job is complete.
        if (this._bgJobs.summary) {
            this._bgJobs = { ...this._bgJobs, summary: false };
            this._finishProgress();
        }
    }



    /** Fired by c-advisor-meeting-summary when the todos list changes */
    handleTodosChange(event) {
        this._meetingTodos = event.detail.todos || [];
        this._hasTodos = this._meetingTodos.length > 0;
        this._acceptedTodosCount = event.detail.acceptedCount ?? this._meetingTodos.filter(t => t._accepted).length;
        if (this._bgJobs.todos) {
            this._bgJobs = { ...this._bgJobs, todos: false };
            this._finishProgress();
        }
    }

    /** Fired by top-level tab bar buttons in advisorAssistant.html */
    handleTopTabSwitch(event) {
        const tab = event.currentTarget.dataset.tab;
        if (!tab) return;
        if (tab === 'todos') {
            this._activeTab = 'summary';
            this._activeMsSection = 'todos';
        } else {
            this._activeTab = tab;
            if (tab === 'summary') this._activeMsSection = 'meeting';
        }
    }


    /** Children are nested and cannot talk to the Flow runtime themselves. They emit
     *  `flowoutput` / `flownext`; this component owns the @api output* properties and
     *  is the one actually on the Flow screen, so it re-emits the real flow events.
     *  This replaces the old per-concern listeners (notesave / notepublish /
     *  sectionsave), which no child ever dispatched. */
    handleChildFlowOutput(event) {
        const { attributeName, attributeValue } = event.detail || {};
        if (!attributeName || !(attributeName in this)) return;
        this[attributeName] = attributeValue;
        this.dispatchEvent(new FlowAttributeChangeEvent(attributeName, attributeValue));
    }

    /**
     * A child asked to leave the screen ("Save & Exit"). In modal mode that means
     * closing the overlay; on a Flow screen it means advancing the Flow. The try/catch
     * covers the Record Page / App Page targets, where there is no Flow to navigate.
     */
    handleChildFlowNext() {
        if (this.modalMode) { this.handleCloseModal?.(); return; }
        try { this.dispatchEvent(new FlowNavigationNextEvent()); } catch (e) { /* not in a flow */ }
    }

    /** Fired by c-advisor-wealth-plan after a wealth plan generation completes */
    handleWpGenerated(event) {
        const { summary } = event.detail;
        if (summary) {
            this.outputSummary = summary;
            this.dispatchEvent(new FlowAttributeChangeEvent('outputSummary', this.outputSummary));
        }
        if (this._bgJobs.wealthplan) {
            this._bgJobs = { ...this._bgJobs, wealthplan: false };
            this._finishProgress();
        }
        // Cache the freshly generated sections on the parent so tab switches don't lose them.
        const sections = event.detail?.sections;
        if (Array.isArray(sections)) this._sections = sections;
    }
}