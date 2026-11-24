import { createElement } from 'lwc';
import AdvisorWealthPlan from 'c/advisorWealthPlan';
import generateSummary from '@salesforce/apex/MeetingSummaryController.generateSummary';

jest.mock(
    '@salesforce/apex/MeetingSummaryController.generateSummary',
    () => ({ default: jest.fn() }),
    { virtual: true }
);

// Lets the mocked Apex promise and the resulting re-render settle.
// eslint-disable-next-line @lwc/lwc/no-async-operation
const flush = () => new Promise(r => setTimeout(r, 0));

/** Run one raw model response through the real component and report what it rendered. */
async function run(raw) {
    generateSummary.mockResolvedValue(raw);
    const el = createElement('c-advisor-wealth-plan', { is: AdvisorWealthPlan });
    el.flowApiName = 'WealthPlan_AL_AI_Helper_Trigger';
    el.freeText = 'Some context so the pre-flight guard passes';
    document.body.appendChild(el);
    await flush();
    el.regenerate();
    await flush();
    await flush();
    const banner = el.shadowRoot.querySelector('.wph-nodata-title');
    return { el, failed: !!banner, title: banner?.textContent?.trim() ?? null };
}

describe('wealth plan response parsing — through the component', () => {
    let warn, error;
    beforeEach(() => {
        jest.clearAllMocks();
        warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        error = jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => { warn.mockRestore(); error.mockRestore(); });

    const OK = [
        ['clean JSON',                        '{"goals":[{"name":"Pensjon"}]}'],
        ['fenced + preamble',                 'Here is the plan:\n```json\n{"goals":[{"name":"Pensjon"}]}\n```'],
        ['curly quotes inside a value',       '{"goals":[{"note":"Kunden sa \u201cvi vil spare mer\u201d"}]}'],
        ['curly quotes as delimiters',        '{\u201cgoals\u201d:[{\u201cname\u201d:\u201cA\u201d}]}'],
        ['trailing prose with a brace',       '{"goals":[{"name":"A"}]}\n\nNote: use {placeholder}.'],
        ['trailing comma',                    '{"goals":[{"name":"A"},]}'],
        ['truncated mid-object',              '{"goals":[{"name":"Pensjon","amount":1000},{"name":"Bolig","amo'],
        ['array root',                        '[{"FF_Goal__c":"A"}]'],
    ];

    it.each(OK)('parses: %s', async (_label, raw) => {
        const { el, failed, title } = await run(raw);
        expect({ failed, title }).toEqual({ failed: false, title: null });
        document.body.removeChild(el);
    });

    it('still reports genuine prose-only responses', async () => {
        const { el, failed, title } = await run('The user did not provide any text to work from.');
        expect(failed).toBe(true);
        expect(title).toBe('No wealth plan data was returned');
        document.body.removeChild(el);
    });
});

describe('assets & liabilities — liability rule on parse', () => {
    let warn, error;
    beforeEach(() => {
        jest.clearAllMocks();
        warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        error = jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => { warn.mockRestore(); error.mockRestore(); });

    /** Parse one response and return the normalised assets rows from the wpgenerated event. */
    async function parseAssets(assets) {
        generateSummary.mockResolvedValue(JSON.stringify({ assets }));
        const el = createElement('c-advisor-wealth-plan', { is: AdvisorWealthPlan });
        el.flowApiName = 'WealthPlan_AL_AI_Helper_Trigger';
        el.freeText = 'Some context so the pre-flight guard passes';
        let sections = null;
        el.addEventListener('wpgenerated', e => { sections = e.detail.sections; });
        document.body.appendChild(el);
        await flush();
        el.regenerate();
        await flush();
        await flush();
        document.body.removeChild(el);
        return (sections || []).find(s => s.key === 'assets')?.records || [];
    }

    it('makes a negative liability amount positive', async () => {
        const [rec] = await parseAssets([
            { name: 'Boliglån', alType: 'Liability', amount: -2500000 }
        ]);
        expect(rec.FinServ__Amount__c).toBe(2500000);
    });

    it('clears the category of a liability', async () => {
        const [rec] = await parseAssets([
            { name: 'Billån', alType: 'Liability', category: 'Safety', amount: 300000 }
        ]);
        expect(rec.FF_Category__c).toBe('');
        expect(rec.FinServ__Amount__c).toBe(300000);
    });

    it('recognises the liability value case-insensitively and in Norwegian', async () => {
        const recs = await parseAssets([
            { name: 'A', alType: 'liability', amount: '-100' },
            { name: 'B', alType: 'Gjeld', category: 'Create', amount: -200 }
        ]);
        expect(recs.map(r => [r.AssetorLiabilityType__c, r.FF_Category__c, r.FinServ__Amount__c]))
            .toEqual([['Liability', '', '100'], ['Liability', '', 200]]);
    });

    it('leaves assets unchanged', async () => {
        const [rec] = await parseAssets([
            { name: 'Hytte', alType: 'NonfinancialAsset', category: 'Preserve & Grow', amount: -50 }
        ]);
        expect(rec.FF_Category__c).toBe('Preserve & Grow');
        expect(rec.FinServ__Amount__c).toBe(-50);
    });
});
