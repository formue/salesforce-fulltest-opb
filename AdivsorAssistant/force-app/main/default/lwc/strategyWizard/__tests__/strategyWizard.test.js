import { createElement } from "lwc";
import StrategyWizard from "c/strategyWizard";

const flush = () => Promise.resolve().then(() => Promise.resolve());

function mount(countryCode = "NO") {
  const el = createElement("c-strategy-wizard", { is: StrategyWizard });
  el.countryCode = countryCode;
  document.body.appendChild(el);
  return el;
}

const text = (el) => el.shadowRoot.textContent;
const counter = (el) => el.shadowRoot.querySelector(".sw-counter").textContent;
const tilesIn = (el, group) => [
  ...el.shadowRoot.querySelectorAll(`[data-group="${group}"]`)
];
const pick = (el, group, value) =>
  tilesIn(el, group)
    .find((t) => t.dataset.value === value)
    .click();
const next = (el) => el.shadowRoot.querySelector(".sw-next").click();
const back = (el) => el.shadowRoot.querySelector(".sw-ghost").click();

// LWC rewrites id attributes at runtime, so fields are addressed by data-field.
function typeIn(el, field, value) {
  const input = el.shadowRoot.querySelector(`[data-field="${field}"]`);
  input.value = value;
  input.dispatchEvent(new CustomEvent("input"));
}

/** Walk steps 1 and 2 so later steps can be reached. */
async function fillFirstTwoSteps(el) {
  pick(el, "strategyType", "New");
  pick(el, "accountId", "a2");
  await flush();
  next(el);
  await flush();
  typeIn(el, "name", "Core");
  typeIn(el, "totalPortfolio", "2500000");
  pick(el, "managementType", "Advisory");
  await flush();
}

describe("strategyWizard", () => {
  afterEach(() => {
    while (document.body.firstChild)
      document.body.removeChild(document.body.firstChild);
  });

  it("starts on step 1 of 5 with no Back button", async () => {
    const el = mount();
    await flush();
    expect(counter(el)).toBe("Step 1 of 5 — Select Account");
    expect(el.shadowRoot.querySelector(".sw-ghost")).toBeNull();
  });

  it("blocks Continue until the step's required fields are answered", async () => {
    const el = mount();
    await flush();
    next(el);
    await flush();

    expect(text(el)).toContain("2 fields still need an answer.");
    expect(counter(el)).toContain("Step 1 of 5");
    expect(el.validate().isValid).toBe(false);

    pick(el, "strategyType", "New");
    pick(el, "accountId", "a1");
    await flush();
    next(el);
    await flush();
    expect(counter(el)).toContain("Step 2 of 5");
  });

  it("formats the amount for the customer's country", async () => {
    const el = mount("SE");
    await flush();
    pick(el, "strategyType", "New");
    pick(el, "accountId", "a1");
    await flush();
    next(el);
    await flush();

    typeIn(el, "totalPortfolio", "2500000");
    await flush();
    // Stored bare, displayed grouped.
    expect(el.totalPortfolio).toBe("2500000");
    expect(
      el.shadowRoot.querySelector('[data-field="totalPortfolio"]').value
    ).toMatch(/2\D500\D000/);
    expect(text(el)).toContain("SEK");
  });

  it("reaches the custodian step and renders the embedded component", async () => {
    const el = mount();
    await flush();
    await fillFirstTwoSteps(el);
    next(el);
    await flush();

    expect(counter(el)).toBe("Step 3 of 5 — Custodian");
    const child = el.shadowRoot.querySelector("c-custodian-menu");
    expect(child).not.toBeNull();
    expect(child.embedded).toBe(true);
    expect(child.countryCode).toBe("NO");
  });

  it("mirrors the custodian child's selection into flow outputs", async () => {
    const el = mount();
    await flush();
    await fillFirstTwoSteps(el);
    next(el);
    await flush();

    el.shadowRoot.querySelector("c-custodian-menu").dispatchEvent(
      new CustomEvent("selectionchange", {
        detail: {
          custodian: "Danske_Bank",
          accountType: "Danske_Bank_Danske_Bank_VP",
          custodianLabel: "Danske Bank",
          accountTypeLabel: "Danske Bank VP",
          portfolioType: "VP",
          broker: "Danske Bank",
          accountIssuer: "Danske Bank",
          requiresBankAccountDetails: true,
          isComplete: true
        }
      })
    );
    await flush();

    expect(el.custodian).toBe("Danske_Bank");
    expect(el.accountType).toBe("Danske_Bank_Danske_Bank_VP");
    expect(el.portfolioType).toBe("VP");
    expect(el.requiresBankAccountDetails).toBe(true);

    // The rail shows labels, never the stored DeveloperNames.
    const rail = el.shadowRoot.querySelector(".sw-rail").textContent;
    expect(rail).toContain("Danske Bank");
    expect(rail).toContain("Danske Bank VP");
    expect(rail).not.toContain("Danske_Bank");
    expect(rail).not.toContain("_Formue_");

    // The flow still receives the API names.
    expect(el.custodian).toBe("Danske_Bank");
    expect(el.accountType).toBe("Danske_Bank_Danske_Bank_VP");
  });

  it("switches between the Classic and Cockpit treatments", async () => {
    const el = createElement("c-strategy-wizard", { is: StrategyWizard });
    el.countryCode = "NO";
    el.showStyleToggle = true;
    document.body.appendChild(el);
    await flush();

    // Classic is the default: paged chrome, summary rail, light root.
    expect(el.shadowRoot.querySelector(".sw-root_cockpit")).toBeNull();
    expect(el.shadowRoot.querySelector(".sw-path")).not.toBeNull();
    expect(el.shadowRoot.querySelector(".sw-cksteps")).toBeNull();

    el.shadowRoot.querySelector('[data-ui="cockpit"]').click();
    await flush();

    expect(el.shadowRoot.querySelector(".sw-root_cockpit")).not.toBeNull();
    expect(el.shadowRoot.querySelector(".sw-path")).toBeNull();
    expect(el.shadowRoot.querySelector(".sw-cksteps")).not.toBeNull();
    expect(el.shadowRoot.querySelector(".sw-cklive")).not.toBeNull();
    expect(el.shadowRoot.querySelector(".sw-rail")).toBeNull();

    el.shadowRoot.querySelector('[data-ui="classic"]').click();
    await flush();
    expect(el.shadowRoot.querySelector(".sw-root_cockpit")).toBeNull();
  });

  it("starts in Cockpit when the flow asks for it, and themes the child", async () => {
    const el = createElement("c-strategy-wizard", { is: StrategyWizard });
    el.countryCode = "NO";
    el.uiStyle = "cockpit";
    document.body.appendChild(el);
    await flush();

    expect(el.shadowRoot.querySelector(".sw-root_cockpit")).not.toBeNull();
    // No toggle unless it was asked for.
    expect(el.shadowRoot.querySelector(".sw-styleseg")).toBeNull();

    await fillFirstTwoSteps(el);
    next(el);
    await flush();
    expect(el.shadowRoot.querySelector("c-custodian-menu").theme).toBe(
      "cockpit"
    );
  });

  it("will not leave the custodian step until the child reports complete", async () => {
    const el = mount();
    await flush();
    await fillFirstTwoSteps(el);
    next(el);
    await flush();

    next(el);
    await flush();
    expect(counter(el)).toContain("Step 3 of 5");
    expect(text(el)).toContain("Choose a custodian and an account type.");
  });

  it("keeps a running total per allocation column and flags anything but 100", async () => {
    const el = mount();
    await flush();
    await fillFirstTwoSteps(el);
    next(el);
    await flush();
    // Skip the custodian gate for this case.
    el.shadowRoot.querySelector("c-custodian-menu").dispatchEvent(
      new CustomEvent("selectionchange", {
        detail: {
          custodian: "Formue_Depot",
          accountType: "Formue_Depot_Formue_ETF",
          isComplete: true
        }
      })
    );
    await flush();
    next(el);
    await flush();

    expect(counter(el)).toBe("Step 4 of 5 — Investment Profile");
    pick(el, "profile", "HouseView");
    await flush();

    const totals = [...el.shadowRoot.querySelectorAll(".sw-alloc__tot")];
    expect(totals.map((t) => t.textContent)).toEqual(["100%", "100%", "200%"]);
    expect(totals[0].dataset.bad).toBe("false");
    // Alternative Growth sums above 100 in the seeded figures.
    expect(totals[2].dataset.bad).toBe("true");

    const input = el.shadowRoot.querySelector(
      '[data-bucket="Stability"][data-index="0"]'
    );
    input.value = "10";
    input.dispatchEvent(new CustomEvent("input"));
    await flush();
    expect(
      el.shadowRoot.querySelectorAll(".sw-alloc__tot")[0].textContent
    ).toBe("70%");
  });

  it("reviews every choice on the last step and can jump back to edit", async () => {
    const el = mount();
    await flush();
    await fillFirstTwoSteps(el);
    next(el);
    await flush();
    el.shadowRoot.querySelector("c-custodian-menu").dispatchEvent(
      new CustomEvent("selectionchange", {
        detail: {
          custodian: "Formue_Depot",
          accountType: "Formue_Depot_Formue_ETF",
          portfolioType: "Formue ETF",
          isComplete: true
        }
      })
    );
    await flush();
    next(el);
    await flush();
    pick(el, "profile", "LowCost");
    await flush();
    next(el);
    await flush();

    expect(counter(el)).toBe("Step 5 of 5 — Create Strategy");
    // The rail gives way to a full-width review.
    expect(el.shadowRoot.querySelector(".sw-rail")).toBeNull();
    expect(el.shadowRoot.querySelector(".sw-cols_wide")).not.toBeNull();

    const review = el.shadowRoot.querySelector(".sw-review").textContent;
    expect(review).toContain("Anne Jacobsen Invest AS");
    expect(review).toContain("Core");
    expect(review).toContain("Formue ETF");
    expect(review).toContain("Low Cost");
    expect(review).toContain("NEW");

    // Create reports back.
    next(el);
    await flush();
    expect(text(el)).toContain("Strategy created for Anne Jacobsen Invest AS");

    // Edit jumps to the owning step.
    el.shadowRoot.querySelectorAll(".sw-rev__edit")[1].click();
    await flush();
    expect(counter(el)).toContain("Step 2 of 5");
  });

  it("goes back a step without losing earlier answers", async () => {
    const el = mount();
    await flush();
    await fillFirstTwoSteps(el);
    back(el);
    await flush();

    expect(counter(el)).toContain("Step 1 of 5");
    expect(
      tilesIn(el, "accountId")
        .find((t) => t.dataset.value === "a2")
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(el.strategyName).toBe("Core");
  });
});
