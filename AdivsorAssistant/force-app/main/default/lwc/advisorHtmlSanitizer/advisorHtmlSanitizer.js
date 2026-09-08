/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ADVISOR HTML SANITIZER — allowlist scrubbing for AI-authored rich text.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A plain ES module: no LWC imports, no component, nothing stateful. That is deliberate — it
 * makes the one piece of security-relevant code in this feature directly testable outside the
 * framework.
 *
 * WHY THIS EXISTS
 * advisorMeetingSummary used to render summaries through `lightning-formatted-rich-text`, which
 * sanitises for you. But its content lands in that component's own shadow root, so the LWC style
 * compiler's scope token never reaches it — every typography rule we wrote was inert and the
 * summary rendered at browser defaults. Painting the HTML into a div we own
 * (`lwc:dom="manual"`) fixes the styling and hands us the sanitising responsibility.
 *
 * The input is not trustworthy: it comes back from a Flow prompt template that reads client
 * documents and meeting notes. A crafted document could put markup in the model's mouth.
 *
 * ALLOWLIST, NOT DENYLIST. A denylist is a list of the attacks someone already thought of.
 * Anything not named below is removed, so a tag or attribute nobody anticipated fails closed.
 *
 * Three dispositions:
 *   DROP     removed with its subtree — script/style/iframe/... Their text content is not
 *            content, it is payload, so unwrapping would be wrong.
 *   UNWRAP   element removed, children kept — an unknown tag is assumed to be prose the model
 *            marked up in a way we do not support, so the words survive and the tag does not.
 *   KEEP     in ALLOWED_TAGS: attributes filtered to ATTR_ALLOWLIST, URLs scheme-checked.
 */

/** Kept, with attributes filtered. */
const ALLOWED_TAGS = new Set([
    'p', 'br', 'hr', 'span', 'div',
    'strong', 'b', 'em', 'i', 'u', 's',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'code', 'pre',
    'a',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td'
]);

/**
 * Removed together with everything inside them. `style` is here as well as in
 * advisorMeetingSummary's own `_stripStyleBlocks` — belt and braces, since this module may end up
 * called from somewhere that does not strip first.
 */
const DROP_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'applet',
    'link', 'meta', 'base', 'title',
    'form', 'input', 'button', 'select', 'textarea', 'option',
    'svg', 'math', 'template', 'noscript',
    'audio', 'video', 'source', 'track', 'canvas', 'img', 'picture'
]);

/** Per-tag attribute allowlist. Any tag absent from this map keeps NO attributes. */
const ATTR_ALLOWLIST = {
    a:  new Set(['href', 'title']),
    th: new Set(['colspan', 'rowspan']),
    td: new Set(['colspan', 'rowspan'])
};

/** Schemes permitted in href. Everything else — javascript:, data:, vbscript: — is dropped. */
const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/)/i;

/**
 * Scrub one element subtree in place, depth-first.
 *
 * Iterates over a STATIC copy of childNodes, because unwrapping mutates the live list underneath
 * a naive loop and silently skips siblings — which is exactly how a scrubber ends up leaving
 * things behind.
 *
 * @param {Element} root element whose children are scrubbed (root itself is not inspected)
 */
function scrubChildren(root) {
    const children = Array.prototype.slice.call(root.childNodes);
    for (const node of children) {
        // Text nodes are always fine — they cannot execute.
        if (node.nodeType === 3) continue;
        // Comments can carry conditional-comment tricks in old engines, and are never content.
        if (node.nodeType !== 1) { node.remove(); continue; }

        const tag = node.tagName.toLowerCase();

        if (DROP_TAGS.has(tag)) {
            node.remove();
            continue;
        }

        if (!ALLOWED_TAGS.has(tag)) {
            // UNWRAP: scrub the inside first, then splice the children into our place.
            scrubChildren(node);
            const parent = node.parentNode;
            while (node.firstChild) parent.insertBefore(node.firstChild, node);
            node.remove();
            continue;
        }

        // KEEP — strip every attribute not explicitly allowed for this tag. Copy the list
        // first: removeAttribute mutates node.attributes as we walk it.
        const allowed = ATTR_ALLOWLIST[tag];
        const names = Array.prototype.map.call(node.attributes, a => a.name);
        for (const name of names) {
            if (!allowed || !allowed.has(name.toLowerCase())) {
                node.removeAttribute(name);
                continue;
            }
            if (name.toLowerCase() === 'href' && !SAFE_URL.test(node.getAttribute(name).trim())) {
                node.removeAttribute(name);
            }
        }
        // Links open away from the Salesforce tab; noopener so the opened page cannot reach back.
        if (tag === 'a' && node.hasAttribute('href')) {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer');
        }

        scrubChildren(node);
    }
}

/**
 * Sanitise AI-authored rich text for injection via innerHTML.
 *
 * @param {string} html untrusted HTML
 * @returns {string} HTML containing only allowlisted tags and attributes; '' for empty input
 */
export function sanitizeRichText(html) {
    if (!html || typeof html !== 'string') return '';
    // DOMParser gives a detached document — parsing here executes nothing and loads nothing.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc || !doc.body) return '';
    scrubChildren(doc.body);
    // A READ, not a write — serialising the scrubbed detached document back to a string.
    // The rule does not distinguish the two directions.
    // eslint-disable-next-line @lwc/lwc/no-inner-html
    return doc.body.innerHTML;
}
