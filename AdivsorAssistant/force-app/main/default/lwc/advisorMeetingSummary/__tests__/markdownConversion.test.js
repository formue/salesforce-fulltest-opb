import { _htmlToMd } from 'c/advisorMeetingSummary';

/**
 * _htmlToMd produces the NoteMarkdown__c mirror the client web app reads.
 * Every case in the first block produced broken markdown before the converter
 * was rewritten to JOIN blocks rather than concatenate them.
 */
describe('HTML → Markdown', () => {
    it.each([
        ['heading welded to preceding text',
         'slutten av en setning.<h3>heading 3</h3>', 'slutten av en setning.\n\n### heading 3'],
        ['adjacent divs',            '<div>a</div><div>b</div>', 'a\n\nb'],
        ['blockquote',               '<blockquote>q</blockquote><p>after</p>', '> q\n\nafter'],
        ['table rows',               '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>', 'a | b\nc | d'],
        ['<br> stays inside the li', '<ul><li>a<br>second line</li><li>b</li></ul>', '- a\n  second line\n- b'],
        ['nested list stays nested', '<ul><li>a<ul><li>n</li></ul></li><li>b</li></ul>', '- a\n  - n\n- b'],
        ['list glued to text',       'Intro:<ul><li>a</li></ul>', 'Intro:\n\n- a'],
        ['source-formatting newlines',
         '<p>Intro</p>\n<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>\n<p>After</p>', 'Intro\n\n- a\n- b\n\nAfter'],
    ])('fixes: %s', (_l, html, expected) => expect(_htmlToMd(html)).toBe(expected));

    it.each([
        ['paragraph then heading', '<p>a.</p><h3>H</h3>', 'a.\n\n### H'],
        ['inline formatting',      '<p>a <strong>b</strong> and <em>i</em></p>', 'a **b** and *i*'],
        ['links',                  '<p>see <a href="https://x.com">l</a></p>', 'see [l](https://x.com)'],
        ['ordered list',           '<ol><li>one</li><li>two</li></ol>', '1. one\n2. two'],
        ['horizontal rule',        '<p>a</p><hr><p>b</p>', 'a\n\n---\n\nb'],
        ['empty input',            '', ''],
    ])('control (already correct): %s', (_l, html, expected) => expect(_htmlToMd(html)).toBe(expected));

    // Added after an audit of what the prompt template actually emits.
    it.each([
        // The only live cosmetic defect: 6 of 48 real headings wrap their text in <b>.
        ['bold spanning a whole heading is dropped', '<h3><b>Møteoversikt</b></h3>', '### Møteoversikt'],
        ['…including <strong>',                      '<h2><strong>Tittel</strong></h2>', '## Tittel'],
        // Partial emphasis inside a heading is meaningful — must survive.
        ['partial emphasis in a heading survives',   '<h3>Plan for <b>2026</b></h3>', '### Plan for **2026**'],
        // The prompt uses <u> as a pseudo-heading; markdown has no underline.
        ['underline becomes bold',                   '<p><u>Team update:</u> ok</p>', '**Team update:** ok'],
        // Never emitted today, but each fails badly if it ever is.
        ['strikethrough is preserved',               '<p>Target <del>5%</del> now 7%</p>', 'Target ~~5%~~ now 7%'],
        ['<s> too',                                  '<p><s>old</s></p>', '~~old~~'],
        ['image keeps alt and src',                  '<p>See <img src="c.png" alt="Chart"></p>', 'See ![Chart](c.png)'],
        ['image without src yields nothing',         '<p>a<img alt="x">b</p>', 'ab'],
        ['pre keeps its newlines and indent',        '<pre><code>const a = 1;\n  const b = 2;</code></pre>',
                                                     '```\nconst a = 1;\n  const b = 2;\n```'],
    ])('%s', (_l, html, expected) => expect(_htmlToMd(html)).toBe(expected));

    it('handles null/undefined without throwing', () => {
        expect(_htmlToMd(null)).toBe('');
        expect(_htmlToMd(undefined)).toBe('');
    });

    it('never emits a blank run, nor a block marker off column 0', () => {
        const md = _htmlToMd('<h1>T</h1>\n<p>p</p>\n<ul>\n <li>a<br>cont</li>\n</ul>\n<h3>H</h3>');
        expect(md).not.toMatch(/\n{3,}/);
        for (const line of md.split('\n')) {
            // Asserted PER LINE on purpose: a naive /\S#/ self-matches on "###".
            expect(line).not.toMatch(/^.+\s#{1,6}\s/);
            expect(line).not.toMatch(/^\S.*\s- \S/);
        }
    });
});
