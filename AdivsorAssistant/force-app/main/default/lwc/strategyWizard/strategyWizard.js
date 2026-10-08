import { LightningElement, api, track } from "lwc";
import {
  FlowAttributeChangeEvent,
  FlowNavigationNextEvent
} from "lightning/flowSupport";

/**
 * ============================================================================
 * c-strategy-wizard — the whole Create Strategy routine on one flow screen
 * ============================================================================
 *
 * WHAT THIS IS
 *
 * A working mockup of the five-step Create Strategy wizard, rendered inside a
 * single Flow screen so the full journey can be reviewed end to end:
 *
 *   1. Select Account        strategy type + the account it belongs to
 *   2. Strategy Details      name, amount, management type, risk & lock-in
 *   3. Custodian             delegated to c-custodian-menu (the real thing)
 *   4. Investment Profile    profile choice + editable asset class split
 *   5. Review and Create     every choice, with Edit links back to each step
 *
 * WHAT IS REAL AND WHAT IS MOCKED
 *
 *   Step 3 is production logic. It renders c-custodian-menu in `embedded`
 *   mode, which reads Custodian__mdt and Custodian_Account_Type__mdt over the
 *   GraphQL wire — live org data, no Apex.
 *
 *   Steps 1, 2 and 4 are MOCKED. Their data lives in the MOCK_* constants
 *   below and nothing is written back to InvestmentStrategy__c. They exist to
 *   show the shape of the journey, not to replace the org components that do
 *   this today (`wizard`, `wealthPlanRiskAndLockinFormue`,
 *   `wealthPlanInvestmentPrefs`). Replacing a mocked step means swapping its
 *   constant for a real data source and its renderer for the real child.
 *
 * HOW STATE WORKS
 *
 *   `_wip` ("work in progress") holds every answer. It is @track so the
 *   summary rail and the review step recompute as the advisor moves. Values
 *   the hosting flow needs are mirrored to @api getters and pushed out with
 *   FlowAttributeChangeEvent from `publish()`.
 *
 * WHY THE CUSTODIAN STEP TALKS IN CustomEvents
 *
 *   A nested LWC cannot reach the Flow runtime. c-custodian-menu therefore
 *   raises a plain `selectionchange` CustomEvent, and this component — which
 *   IS the flow screen — re-publishes those values as flow attributes. Same
 *   parent/child bridge as advisorAssistant.
 *
 * REMOVING A STEP
 *
 *   Steps are data, not markup: drop the entry from STEPS, its renderer flag
 *   from the `isStep*` getters, and its rules from REQUIRED. Nothing else
 *   references step order.
 */

/* ---------------------------------------------------------------------------
 * MOCK DATA — steps 1, 2 and 4 only. Replace with real sources when wiring up.
 * ------------------------------------------------------------------------- */

/** Accounts the strategy can belong to. Real source: Account / Household. */
const MOCK_ACCOUNTS = [
  { id: "a1", name: "Anne Jacobsen", kind: "Person" },
  { id: "a2", name: "Anne Jacobsen Invest AS", kind: "Company" },
  { id: "a3", name: "Jacobsen Holding AS", kind: "Company" }
];

/** InvestmentStrategy__c.Type__c, narrowed to what the wizard offers. */
const MOCK_STRATEGY_TYPES = [
  { id: "New", label: "New Strategy", colour: "#3b3bd6", glyph: "N" },
  {
    id: "StartingPortfolio",
    label: "Starting Portfolio",
    colour: "#1b9ae0",
    glyph: "S"
  }
];

/** InvestmentStrategy__c.ManagementType__c. */
const MOCK_MANAGEMENT_TYPES = [
  {
    id: "PortfolioManagement",
    label: "Portfolio Management",
    colour: "#3b3bd6",
    glyph: "P"
  },
  { id: "Advisory", label: "Advisory", colour: "#2aa36b", glyph: "A" }
];

/**
 * The predefined risk level and its three-bucket split. Real source: the
 * StrategyPreference / StrategyAssetClass custom metadata already in the org.
 */
const MOCK_RISK_LEVEL = {
  label: "High/High",
  stability: 16,
  marketGrowth: 44,
  alternativeGrowth: 40
};

/** InvestmentStrategy__c.InvestmentProfile__c. */
const MOCK_PROFILES = [
  { id: "HouseView", label: "House View", colour: "#f28c1a", glyph: "H" },
  { id: "LowCost", label: "Low Cost", colour: "#e0516b", glyph: "L" },
  { id: "ActiveOnly", label: "Active Only", colour: "#1b7fe0", glyph: "A" },
  {
    id: "Sustainability",
    label: "Sustainability",
    colour: "#5ab045",
    glyph: "S"
  }
];

/** Asset class weights within each bucket. Each column should total 100. */
const MOCK_ALLOCATION = {
  Stability: [
    ["Developed Markets Index Bonds", 40],
    ["Emerging Markets", 5],
    ["Global Active", 5],
    ["Green Bonds", 0],
    ["Global High Yield", 5],
    ["Home Market High Yield", 5],
    ["Home Market Investment Grade", 40]
  ],
  "Market Growth": [
    ["Developed Markets Index Equities", 60],
    ["Developed Markets Index - hedged", 0],
    ["Emerging Markets", 10],
    ["Global Security Selection", 20],
    ["Impact", 0],
    ["Home Market", 10],
    ["Home Market Index", 0]
  ],
  "Alternative Growth": [
    ["Multistrategy Hedge as share of Hedge Funds", 100],
    ["Real Estate as part of Real Assets", 60],
    ["Infrastructure as part of Real Assets", 40]
  ]
};

/* ------------------------------------------------------------------ config */

/** The three allocation buckets, with the CSS variable that colours each. */
const BUCKETS = [
  { key: "Stability", token: "--sw-stab" },
  { key: "Market Growth", token: "--sw-mkt" },
  { key: "Alternative Growth", token: "--sw-alt" }
];

/** Step order. The path indicator, titles and validation all derive from this. */
const STEPS = [
  {
    key: "account",
    chip: "Select Account",
    title: "Create Strategy",
    sub: "Choose a strategy type and the account it belongs to"
  },
  {
    key: "details",
    chip: "Strategy Details",
    title: "Strategy Details",
    sub: "Name the strategy and set how it is managed"
  },
  {
    key: "custodian",
    chip: "Custodian",
    title: "Custodian Setup",
    sub: "Choose where the securities are held and how the account is registered"
  },
  {
    key: "profile",
    chip: "Investment Profile",
    title: "Investment Profile",
    sub: "Pick a profile, then fine-tune the asset class split"
  },
  {
    key: "create",
    chip: "Create Strategy",
    title: "Review and Create",
    sub: "Check every choice before the strategy is created"
  }
];

/** Fields each step requires, and the message shown when one is missing. */
const REQUIRED = [
  { strategyType: "Choose a strategy type.", accountId: "Select an account." },
  {
    name: "Enter a name.",
    totalPortfolio: "Enter the total portfolio.",
    managementType: "Choose a management type."
  },
  // Step 3 is validated by the custodian child, not by field presence here.
  {},
  { profile: "Choose an investment profile." },
  {}
];

/** Amount formatting follows the customer's country. */
const CURRENCY = {
  NO: { code: "NOK", locale: "nb-NO" },
  SE: { code: "SEK", locale: "sv-SE" },
  DK: { code: "DKK", locale: "da-DK" }
};

export default class StrategyWizard extends LightningElement {
  /* ----------------------------------------------------------- flow inputs */

  /** ISO country code of the customer. Passed straight to the custodian step. */
  @api countryCode;

  /** Id of the record the flow was launched from. Not written to in the mockup. */
  @api recordId;

  /**
   * Which visual treatment to render: "classic" (the paged wizard, matching
   * the existing Create Strategy screens) or "cockpit" (a dark single canvas
   * with a live portfolio panel). Set in Flow Builder.
   */
  @api uiStyle = "classic";

  /**
   * Show the in-screen Classic/Cockpit switch. On for the mockup so both can
   * be compared in one flow run; turn it off for anything real.
   */
  @api showStyleToggle = false;

  _ui;

  /* ------------------------------------------------------------ flow state */

  /**
   * Every answer the advisor has given. @track so the summary rail and review
   * recompute when any nested value changes.
   */
  @track _wip = {
    strategyType: "",
    accountId: "",
    name: "",
    totalPortfolio: "",
    managementType: "",
    custodian: "",
    accountType: "",
    portfolioType: undefined,
    tradexPortfolioType: undefined,
    broker: undefined,
    accountIssuer: undefined,
    nominee: undefined,
    requiresBankAccountDetails: false,
    profile: ""
  };

  @track _allocation = JSON.parse(JSON.stringify(MOCK_ALLOCATION));
  @track _errors = {};

  _step = 0;
  _created = false;
  _custodianComplete = false;

  /**
   * Display labels for the custodian choice. The stored values are
   * DeveloperNames, which are not for reading — the child sends both.
   */
  @track _custodianLabel = "";
  @track _accountTypeLabel = "";

  /* ---------------------------------------------------------- flow outputs
   * Mirrors of _wip so a hosting flow can consume the result. Getters only —
   * the repo's lint rules forbid reassigning an @api field, and values are
   * published through FlowAttributeChangeEvent instead.
   * --------------------------------------------------------------------- */

  @api get custodian() {
    return this._wip.custodian;
  }
  @api get accountType() {
    return this._wip.accountType;
  }
  @api get portfolioType() {
    return this._wip.portfolioType;
  }
  @api get tradexPortfolioType() {
    return this._wip.tradexPortfolioType;
  }
  @api get broker() {
    return this._wip.broker;
  }
  @api get accountIssuer() {
    return this._wip.accountIssuer;
  }
  @api get nominee() {
    return this._wip.nominee;
  }
  @api get requiresBankAccountDetails() {
    return this._wip.requiresBankAccountDetails;
  }
  @api get strategyName() {
    return this._wip.name;
  }
  @api get totalPortfolio() {
    return this._wip.totalPortfolio;
  }
  @api get managementType() {
    return this._wip.managementType;
  }
  @api get investmentProfile() {
    return this._wip.profile;
  }
  @api get strategyType() {
    return this._wip.strategyType;
  }
  @api get selectedAccountId() {
    return this._wip.accountId;
  }

  connectedCallback() {
    // The flow sets the starting style; the toggle may then override it.
    this._ui = this.uiStyle === "cockpit" ? "cockpit" : "classic";
  }

  /* --------------------------------------------------------------- style */

  get isCockpit() {
    return this._ui === "cockpit";
  }

  get isClassic() {
    return this._ui !== "cockpit";
  }

  /** Theme handed down to c-custodian-menu, which cannot be styled from here. */
  get childTheme() {
    return this._ui === "cockpit" ? "cockpit" : "classic";
  }

  get rootClass() {
    return this._ui === "cockpit" ? "sw-root sw-root_cockpit" : "sw-root";
  }

  get classicToggleClass() {
    return this.isClassic
      ? "sw-styleseg__btn sw-styleseg__btn_on"
      : "sw-styleseg__btn";
  }

  get cockpitToggleClass() {
    return this.isCockpit
      ? "sw-styleseg__btn sw-styleseg__btn_on"
      : "sw-styleseg__btn";
  }

  get classicPressed() {
    return this.isClassic ? "true" : "false";
  }

  get cockpitPressed() {
    return this.isCockpit ? "true" : "false";
  }

  handleStyleToggle(event) {
    this._ui = event.currentTarget.dataset.ui;
  }

  /* --------------------------------------------------- cockpit step rail */

  get railSteps() {
    return STEPS.map((s, i) => ({
      key: s.key,
      chip: s.chip,
      index: i,
      number: String(i + 1),
      isDone: i < this._step,
      notDone: i >= this._step,
      ariaCurrent: i === this._step ? "step" : null,
      cls:
        i === this._step
          ? "sw-ckstep sw-ckstep_current"
          : i < this._step
            ? "sw-ckstep sw-ckstep_done"
            : "sw-ckstep",
      dotCls:
        i === this._step
          ? "sw-ckstep__dot sw-ckstep__dot_current"
          : i < this._step
            ? "sw-ckstep__dot sw-ckstep__dot_done"
            : "sw-ckstep__dot"
    }));
  }

  /* ------------------------------------------------- cockpit live panel */

  /** The hero figure, formatted, with its currency as a trailing unit. */
  get heroAmount() {
    return this._wip.totalPortfolio ? this.money(this._wip.totalPortfolio) : "";
  }

  get hasHeroAmount() {
    return Boolean(this._wip.totalPortfolio);
  }

  /**
   * Facts the live panel lists. Each carries whether it is still pending so
   * the panel can show absence without printing a misleading dash.
   */
  get liveFacts() {
    return [
      ["Account", this.accountName],
      ["Custodian", this._custodianLabel],
      ["Account type", this._accountTypeLabel],
      ["Portfolio type", this._wip.portfolioType],
      ["Broker", this._wip.broker],
      ["Profile", this.labelOf(MOCK_PROFILES, this._wip.profile)]
    ].map(([label, value]) => ({
      key: label,
      label,
      value: value || "Not chosen",
      cls: value ? "sw-ckfact__val" : "sw-ckfact__val sw-ckfact__val_pending"
    }));
  }

  get showBankChip() {
    return Boolean(this._wip.accountType);
  }

  get bankChipClass() {
    return this._wip.requiresBankAccountDetails
      ? "sw-ckchip sw-ckchip_warn"
      : "sw-ckchip sw-ckchip_ok";
  }

  get bankChipLabel() {
    return this._wip.requiresBankAccountDetails
      ? "Bank details needed"
      : "No bank details needed";
  }

  get bankChipIcon() {
    return this._wip.requiresBankAccountDetails
      ? "utility:warning"
      : "utility:check";
  }

  /* ------------------------------------------------------- step plumbing */

  get steps() {
    return STEPS.map((s, i) => ({
      key: s.key,
      chip: s.chip,
      index: i,
      isDone: i < this._step,
      isCurrent: i === this._step,
      notDone: i >= this._step,
      ariaCurrent: i === this._step ? "step" : null,
      cls:
        i === this._step
          ? "sw-path__btn sw-path__btn_current"
          : i < this._step
            ? "sw-path__btn sw-path__btn_done"
            : "sw-path__btn"
    }));
  }

  get stepTitle() {
    return STEPS[this._step].title;
  }
  get stepSub() {
    return STEPS[this._step].sub;
  }
  get stepCounter() {
    return `Step ${this._step + 1} of ${STEPS.length} — ${STEPS[this._step].chip}`;
  }

  get isStepAccount() {
    return STEPS[this._step].key === "account";
  }
  get isStepDetails() {
    return STEPS[this._step].key === "details";
  }
  get isStepCustodian() {
    return STEPS[this._step].key === "custodian";
  }
  get isStepProfile() {
    return STEPS[this._step].key === "profile";
  }
  get isStepCreate() {
    return STEPS[this._step].key === "create";
  }

  get isFirstStep() {
    return this._step === 0;
  }
  get isLastStep() {
    return this._step === STEPS.length - 1;
  }

  /**
   * The Classic summary rail: a running recap, so it has no place on the
   * review step — and none in Cockpit either, where the live panel replaces it.
   */
  get showRail() {
    return this.isClassic && !this.isLastStep;
  }
  get columnsClass() {
    return this.isLastStep ? "sw-cols sw-cols_wide" : "sw-cols";
  }
  get nextLabel() {
    return this.isLastStep ? "Create strategy" : "Continue";
  }

  /* ------------------------------------------------------------- step 1 */

  get accountRows() {
    return MOCK_ACCOUNTS.map((a) => ({
      value: a.id,
      label: a.name,
      kind: a.kind,
      ariaChecked: this._wip.accountId === a.id ? "true" : "false",
      cls: this._wip.accountId === a.id ? "sw-row sw-row_selected" : "sw-row"
    }));
  }

  get strategyTypeTiles() {
    return this.tiles(MOCK_STRATEGY_TYPES, this._wip.strategyType, false);
  }

  /* ------------------------------------------------------------- step 2 */

  get managementTiles() {
    return this.tiles(MOCK_MANAGEMENT_TYPES, this._wip.managementType, false);
  }

  get currencyCode() {
    return this.currency.code;
  }
  get currency() {
    return CURRENCY[this.countryCode] || CURRENCY.NO;
  }

  /** The amount as the advisor sees it: grouped digits, no currency symbol. */
  get formattedTotal() {
    return this.money(this._wip.totalPortfolio);
  }

  get riskLabel() {
    return MOCK_RISK_LEVEL.label;
  }

  /**
   * The risk level as a stacked bar. Three numbers are a split, so showing
   * the split reads faster than reading the numbers.
   */
  get riskSegments() {
    return [
      {
        key: "Stability",
        value: MOCK_RISK_LEVEL.stability,
        token: "--sw-stab"
      },
      {
        key: "Market Growth",
        value: MOCK_RISK_LEVEL.marketGrowth,
        token: "--sw-mkt"
      },
      {
        key: "Alternative Growth",
        value: MOCK_RISK_LEVEL.alternativeGrowth,
        token: "--sw-alt"
      }
    ].map((p) => ({
      ...p,
      label: `${p.value}%`,
      barStyle: `width:${p.value}%;background:var(${p.token})`,
      swatchStyle: `background:var(${p.token})`
    }));
  }

  get riskBarLabel() {
    return this.riskSegments
      .map((p) => `${p.key} ${p.value} percent`)
      .join(", ");
  }

  /* ------------------------------------------------------------- step 4 */

  get profileTiles() {
    return this.tiles(MOCK_PROFILES, this._wip.profile, true);
  }

  get hasProfile() {
    return Boolean(this._wip.profile);
  }

  /** One column per bucket, each with live bars and a running total. */
  get allocationColumns() {
    return BUCKETS.map(({ key, token }) => {
      const total = this.columnTotal(key);
      return {
        key,
        total: `${total}%`,
        isOffTarget: total !== 100,
        swatchStyle: `background:var(${token})`,
        rows: this._allocation[key].map(([label, value], index) => ({
          key: `${key}-${index}`,
          label,
          value,
          index,
          bucket: key,
          barStyle: `width:${Math.min(100, Number(value) || 0)}%;background:var(${token})`
        }))
      };
    });
  }

  /* -------------------------------------------------------- summary rail */

  /**
   * The running recap. Each group reports whether it is complete so the rail
   * can show progress without the advisor leaving the current step.
   */
  get summaryGroups() {
    const rows = [
      {
        step: 0,
        title: "Account",
        rows: [
          ["Type", this.labelOf(MOCK_STRATEGY_TYPES, this._wip.strategyType)],
          ["Account", this.accountName]
        ]
      },
      {
        step: 1,
        title: "Details",
        rows: [
          ["Name", this._wip.name],
          ["Amount", this.amountWithCurrency],
          [
            "Management",
            this.labelOf(MOCK_MANAGEMENT_TYPES, this._wip.managementType)
          ]
        ]
      },
      {
        step: 2,
        title: "Custodian",
        rows: [
          ["Custodian", this._custodianLabel],
          ["Account type", this._accountTypeLabel],
          ["Portfolio type", this._wip.portfolioType]
        ]
      },
      {
        step: 3,
        title: "Profile",
        rows: [["Profile", this.labelOf(MOCK_PROFILES, this._wip.profile)]]
      }
    ];

    return rows.map((g) => {
      const filled = g.rows
        .filter(([, v]) => v)
        .map(([k, v]) => ({ key: k, label: k, value: v }));
      return {
        key: g.title,
        title: g.title,
        rows: filled,
        hasRows: filled.length > 0,
        cls:
          g.step === this._step
            ? "sw-sumgroup sw-sumgroup_active"
            : "sw-sumgroup",
        dotCls:
          filled.length === g.rows.length
            ? "sw-sumgroup__dot sw-sumgroup__dot_full"
            : "sw-sumgroup__dot"
      };
    });
  }

  /* ------------------------------------------------------------- review */

  /** The review panels. `editStep` powers the Edit link back to each step. */
  get reviewGroups() {
    return [
      {
        key: "account",
        title: "Account",
        editStep: 0,
        isNew: false,
        rows: this.reviewRows([
          [
            "Strategy type",
            this.labelOf(MOCK_STRATEGY_TYPES, this._wip.strategyType)
          ],
          ["Account", this.accountName]
        ])
      },
      {
        key: "details",
        title: "Strategy details",
        editStep: 1,
        isNew: false,
        rows: this.reviewRows([
          ["Name", this._wip.name],
          ["Total portfolio", this.amountWithCurrency],
          [
            "Management",
            this.labelOf(MOCK_MANAGEMENT_TYPES, this._wip.managementType)
          ],
          ["Risk & lock-in", MOCK_RISK_LEVEL.label]
        ])
      },
      {
        key: "custodian",
        title: "Custodian",
        editStep: 2,
        isNew: true,
        rows: this.reviewRows([
          ["Custodian", this._custodianLabel],
          ["Account type", this._accountTypeLabel],
          ["Portfolio type", this._wip.portfolioType],
          ["Tradex type", this._wip.tradexPortfolioType],
          ["Broker", this._wip.broker],
          ["Account issuer", this._wip.accountIssuer],
          ["Nominee", this._wip.nominee],
          [
            "Bank details",
            this._wip.requiresBankAccountDetails ? "Required after create" : ""
          ]
        ])
      },
      {
        key: "profile",
        title: "Investment profile",
        editStep: 3,
        isNew: false,
        rows: this.reviewRows([
          ["Profile", this.labelOf(MOCK_PROFILES, this._wip.profile)],
          ...BUCKETS.map(({ key }) => [key, `${this.columnTotal(key)}%`])
        ])
      }
    ];
  }

  get created() {
    return this._created;
  }
  get createdMessage() {
    return `Strategy created for ${this.accountName} — ${this._custodianLabel} · ${this._accountTypeLabel}.`;
  }

  /* ----------------------------------------------------------- validation */

  get errorCount() {
    return Object.keys(this._errors).length;
  }
  get hasErrors() {
    return this.errorCount > 0;
  }
  get errorSummary() {
    return this.errorCount === 1
      ? "One field still needs an answer."
      : `${this.errorCount} fields still need an answer.`;
  }

  get errStrategyType() {
    return this._errors.strategyType;
  }
  get errAccountId() {
    return this._errors.accountId;
  }
  get errName() {
    return this._errors.name;
  }
  get errTotalPortfolio() {
    return this._errors.totalPortfolio;
  }
  get errManagementType() {
    return this._errors.managementType;
  }
  get errCustodian() {
    return this._errors.custodian;
  }
  get errProfile() {
    return this._errors.profile;
  }

  get nameInvalid() {
    return Boolean(this._errors.name);
  }
  get totalInvalid() {
    return Boolean(this._errors.totalPortfolio);
  }

  /* ------------------------------------------------------------ handlers */

  handleTileClick(event) {
    const { group, value } = event.currentTarget.dataset;
    this.set(group, value);
  }

  /** Arrow keys move within a radiogroup; each group is one tab stop. */
  handleTileKeydown(event) {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
      event.key
    ];
    if (!delta && event.key !== "Home" && event.key !== "End") {
      return;
    }
    event.preventDefault();

    const { group } = event.currentTarget.dataset;
    const items = [
      ...this.template.querySelectorAll(`[data-group="${group}"]`)
    ];
    const from = items.indexOf(event.currentTarget);
    let next;
    if (event.key === "Home") next = items[0];
    else if (event.key === "End") next = items[items.length - 1];
    else next = items[(from + delta + items.length) % items.length];
    if (!next) {
      return;
    }

    const value = next.dataset.value;
    this.set(group, value);
    Promise.resolve().then(() => {
      const moved = this.template.querySelector(
        `[data-group="${group}"][data-value="${value}"]`
      );
      if (moved) moved.focus();
    });
  }

  handleTextInput(event) {
    const field = event.target.dataset.field;
    this.set(field, event.target.value);
  }

  /**
   * The amount is stored as bare digits and displayed grouped, so the field
   * reformats as the advisor types.
   */
  handleAmountInput(event) {
    const input = event.target;
    const atEnd = input.selectionStart === input.value.length;
    const digits = String(input.value).replace(/\D/g, "");
    this.set("totalPortfolio", digits);
    input.value = this.money(digits);
    if (atEnd) {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  handleAllocationInput(event) {
    const { bucket, index } = event.target.dataset;
    const raw = String(event.target.value).replace(/\D/g, "").slice(0, 3);
    const value = Math.min(100, Number(raw || 0));
    this._allocation[bucket][Number(index)][1] = value;
    // Reassign so @track notices the nested mutation.
    this._allocation = { ...this._allocation };
  }

  /** The custodian child owns its own rules; we just mirror its result. */
  handleCustodianChange(event) {
    const d = event.detail || {};
    this._custodianComplete = Boolean(d.isComplete);
    this._custodianLabel = d.custodianLabel || "";
    this._accountTypeLabel = d.accountTypeLabel || "";
    [
      "custodian",
      "accountType",
      "portfolioType",
      "tradexPortfolioType",
      "broker",
      "accountIssuer",
      "nominee",
      "requiresBankAccountDetails"
    ].forEach((name) => {
      this._wip[name] = d[name];
      this.publish(name, d[name]);
    });
    if (d.custodian && d.accountType) {
      delete this._errors.custodian;
      this._errors = { ...this._errors };
    }
  }

  handleGoto(event) {
    this._step = Number(event.currentTarget.dataset.step);
    this._errors = {};
    this._created = false;
  }

  handleBack() {
    if (this._step > 0) this._step -= 1;
    this._errors = {};
    this._created = false;
  }

  handleNext() {
    if (!this.validateStep()) {
      return;
    }
    if (this.isLastStep) {
      this._created = true;
      this.tryFlowNext();
      return;
    }
    this._step += 1;
    this._created = false;
  }

  /**
   * Flow screen validation, so the flow's own footer is also guarded when the
   * component is not driving navigation itself.
   */
  @api
  validate() {
    return this.validateStep()
      ? { isValid: true }
      : { isValid: false, errorMessage: this.errorSummary };
  }

  /* ------------------------------------------------------------ internals */

  set(field, value) {
    this._wip[field] = value;
    delete this._errors[field];
    this._errors = { ...this._errors };
    this.publish(field, value);
  }

  /**
   * Push one value to the Flow runtime. Only the names declared in the
   * meta.xml are flow attributes; the rest are ignored by the runtime and
   * kept purely as local state.
   */
  publish(name, value) {
    this.dispatchEvent(new FlowAttributeChangeEvent(name, value));
  }

  tryFlowNext() {
    try {
      this.dispatchEvent(new FlowNavigationNextEvent());
    } catch {
      // Not inside a flow — previewing on an app or record page.
    }
  }

  validateStep() {
    const rules = REQUIRED[this._step];
    const found = {};
    Object.entries(rules).forEach(([field, message]) => {
      if (!this._wip[field]) found[field] = message;
    });

    // The custodian step delegates its rules to the child component.
    if (this.isStepCustodian && !this._custodianComplete) {
      found.custodian = "Choose a custodian and an account type.";
    }

    this._errors = found;
    return Object.keys(found).length === 0;
  }

  /* --------------------------------------------------------------- utils */

  tiles(source, selected, withFold) {
    const chosen = source.findIndex((o) => o.id === selected);
    return source.map((o, i) => ({
      value: o.id,
      label: o.label,
      glyph: o.glyph,
      chipStyle: `background:${o.colour}`,
      withFold,
      ariaChecked: o.id === selected ? "true" : "false",
      tabIndex: i === (chosen === -1 ? 0 : chosen) ? 0 : -1,
      cls: o.id === selected ? "sw-tile sw-tile_selected" : "sw-tile"
    }));
  }

  reviewRows(pairs) {
    return pairs.map(([label, value]) => ({
      key: label,
      label,
      value: value || "Not set",
      cls: value ? "sw-rev__val" : "sw-rev__val sw-rev__val_na"
    }));
  }

  labelOf(source, id) {
    const hit = source.find((o) => o.id === id);
    return hit ? hit.label : "";
  }

  get accountName() {
    const hit = MOCK_ACCOUNTS.find((a) => a.id === this._wip.accountId);
    return hit ? hit.name : "";
  }

  get amountWithCurrency() {
    return this._wip.totalPortfolio
      ? `${this.money(this._wip.totalPortfolio)} ${this.currency.code}`
      : "";
  }

  money(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (!digits) {
      return "";
    }
    return new Intl.NumberFormat(this.currency.locale).format(Number(digits));
  }

  columnTotal(bucket) {
    return this._allocation[bucket].reduce((n, [, v]) => n + Number(v || 0), 0);
  }
}
