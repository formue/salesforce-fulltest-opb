/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ADVISOR INTERNAL NOTES — the advisor-private notes tab.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A PRIVATE child of advisorAssistant (isExposed=false). Owns one thing end to end:
 * MeetingNote__c.Internal_Notes__c — reading it back for the selected event, editing it as
 * rich text, and saving it through its own Flow, independently of the meeting summary.
 *
 * These notes are NOT client-facing. Nothing here may leak into the summary, the brief, the
 * Markdown mirror or any Flow output. That is why this has its own Apex method, its own
 * Flow branch (saveMode='internalNotes') and its own amber styling.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE TAB CONTRACT — this component is the reference implementation.
 * ───────────────────────────────────────────────────────────────────────────
 * Every tab component under advisorAssistant should implement this shape, so the parent's
 * footer, dirty tracking and note-id brokering stay one code path instead of growing a
 * bespoke set of getters per tab.
 *
 *   IN         selectedEventId   Id of the chosen Event, or null
 *              meetingNote       the resolved MeetingNote__c record, or null
 *              resolvedNoteId    the note id the PARENT has brokered across all tabs
 *              saveFlowApiName   API name of this tab's save Flow
 *   OUT        tabstatechange    { isDirty, isSaving, canSave, savedNoteId, statusLabel }
 *   IMPERATIVE save()            → Promise<boolean>, true only if it really persisted
 *              resetState()      clear everything on teardown
 *
 * TWO RULES, both learned from real regressions in this component family:
 *
 *  1. Inputs must be REFERENCE-STABLE. An @api setter re-runs whenever the incoming value's
 *     identity changes, so a parent getter that rebuilds an array/object per access makes the
 *     setter fire on every parent re-render. That is what blanked the wealth plan once.
 *     Note `meetingNote` here is a record reference the parent already holds — not rebuilt.
 *
 *  2. `tabstatechange` must DIFF before dispatching. It fires from renderedCallback, so an
 *     unconditional dispatch re-renders the parent, which re-renders this child, forever.
 *     See `_emitState` below.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY resolvedNoteId MATTERS
 * ───────────────────────────────────────────────────────────────────────────
 * Two components can CREATE the MeetingNote__c: this one (notes taken before any summary
 * exists) and advisorMeetingSummary. The parent's `inputMeetingNotes` is a snapshot queried
 * at load, so it goes stale the moment either side creates one. The parent therefore brokers:
 * each tab reports the id it knows via `savedNoteId`, the parent merges them into
 * `resolvedNoteId`, and hands that back down. Sending a blank id when a record already exists
 * is what produces duplicates — so always save against `resolvedNoteId`, never a local guess.
 */

import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import saveInternalNotes from '@salesforce/apex/MeetingSummaryController.saveInternalNotes';

export default class AdvisorInternalNotes extends LightningElement {

    // ═══════════════════════════════════════════════════════════════════════
    // TAB CONTRACT — IN
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Selected Event. Changing this is what reseeds the editor, so the setter carries the
     * cache-out / restore logic rather than a lifecycle hook.
     */
    _selectedEventId = null;
    @api get selectedEventId() { return this._selectedEventId; }
    set selectedEventId(v) {
        const next = v || null;
        if (next === this._selectedEventId) return;
        this._applyEventChange(next);
    }

    /** The resolved MeetingNote__c for this event, or null. Source of truth on load. */
    _meetingNote = null;
    @api get meetingNote() { return this._meetingNote; }
    set meetingNote(v) {
        this._meetingNote = v || null;
        // The record can arrive after the event id — the Flow's query resolves late. Only
        // reseed when the advisor has not started typing, so late data never eats an edit.
        if (!this.isDirty && !this._hasLocalEdit) this._seedFromRecord();
    }

    /** Note id brokered by the parent across all tabs. Always save against this. */
    @api resolvedNoteId = '';

    /** API name of the internal-notes save Flow. Blank disables saving. */
    @api saveFlowApiName = '';

    // ═══════════════════════════════════════════════════════════════════════
    // TAB CONTRACT — IMPERATIVE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Persist the notes. Own Flow, own Apex method — never touches the summary's fields.
     *
     * If the event has no MeetingNote__c yet the Flow creates one and returns its id, which
     * is reported upward via `savedNoteId` so a later summary save reuses that same record.
     *
     * @returns {Promise<boolean>} true only if the notes actually reached the server.
     *   Errors surface as a toast, never thrown — so callers that rely on persistence must
     *   check this rather than assume completion.
     */
    @api async save() {
        if (this._isSaving) return false;                 // re-entry guard
        if (!this.saveFlowApiName) {
            this._toast('Configuration Error', 'Internal Notes Flow API Name is not set.', 'error');
            return false;
        }
        if (!this._selectedEventId) return false;

        // Capture what we send: the advisor may keep typing while the call is in flight, and
        // marking that later text as saved would be a lie.
        const sent = this._notes || '';
        this._isSaving = true;
        try {
            const savedId = await saveInternalNotes({
                flowApiName:   this.saveFlowApiName,
                noteId:        this.resolvedNoteId || '',
                eventId:       this._selectedEventId,
                internalNotes: sent
            });
            this._savedNotes = sent;
            this._savedAt    = new Date();
            if (savedId) this._createdNoteId = savedId;
            this._toast('Saved', 'Internal notes saved.', 'success');
            return true;
        } catch (e) {
            this._toast('Save Failed', e.body ? e.body.message : e.message, 'error');
            return false;
        } finally {
            this._isSaving = false;
        }
    }

    /** Called by the parent on teardown so a fresh open starts clean. */
    @api resetState() {
        this._notes = '';
        this._savedNotes = '';
        this._savedAt = null;
        this._createdNoteId = null;
        this._cache = {};
        this._hasLocalEdit = false;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TAB CONTRACT — OUT
    // ═══════════════════════════════════════════════════════════════════════

    _lastState = null;

    /**
     * Report state upward. Diffs first — see rule 2 in the header: this runs on every render,
     * and dispatching unconditionally would ping-pong with the parent forever.
     */
    _emitState() {
        const state = {
            isDirty:     this.isDirty,
            isSaving:    this._isSaving,
            canSave:     this.canSave,
            savedNoteId: this._createdNoteId || null,
            statusLabel: this.statusLabel
        };
        const prev = this._lastState;
        if (prev && Object.keys(state).every(k => prev[k] === state[k])) return;
        this._lastState = state;
        this.dispatchEvent(new CustomEvent('tabstatechange', { detail: state }));
    }

    renderedCallback() { this._emitState(); }

    // ═══════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════

    @track _notes      = '';    // what the advisor is editing
    @track _savedNotes = '';    // last value known to be persisted — drives isDirty
    @track _savedAt    = null;  // timestamp of the last successful save
    @track _isSaving   = false;
    /** Id of a note THIS component created, when none existed beforehand. */
    _createdNoteId = null;
    /** { [eventId]: text } — unsaved typing survives an event round-trip. */
    _cache = {};
    /** True once the advisor has typed for this event; stops late record data overwriting it. */
    _hasLocalEdit = false;

    /**
     * Event changed: stash the outgoing text, then restore the incoming one. Session edits win
     * over the record so switching events never silently discards typing.
     */
    _applyEventChange(nextId) {
        if (this._selectedEventId) {
            this._cache = { ...this._cache, [this._selectedEventId]: this._notes };
        }
        this._selectedEventId = nextId;
        this._savedAt         = null;
        this._createdNoteId   = null;   // belongs to the event we just left
        this._hasLocalEdit    = false;

        const cached = nextId ? this._cache[nextId] : undefined;
        if (cached !== undefined) {
            this._notes = cached;
            this._savedNotes = this._recordNotes();   // record is still the persisted truth
            this._hasLocalEdit = true;
        } else {
            this._seedFromRecord();
        }
    }

    /** Load from the record, seeding both sides so a freshly loaded note is not dirty. */
    _seedFromRecord() {
        const persisted = this._recordNotes();
        this._notes      = persisted;
        this._savedNotes = persisted;
    }

    _recordNotes() { return this._meetingNote?.Internal_Notes__c || ''; }

    // ═══════════════════════════════════════════════════════════════════════
    // VIEW
    // ═══════════════════════════════════════════════════════════════════════

    get isDirty()  { return (this._notes || '') !== (this._savedNotes || ''); }
    get canSave()  { return !!this._selectedEventId && this.isDirty && !this._isSaving; }
    get isSaving() { return this._isSaving; }

    get statusLabel() {
        if (this.isDirty) return 'Unsaved changes';
        if (this._savedAt) {
            return `Saved ${this._savedAt.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}`;
        }
        return '';
    }
    get statusClass() {
        return this.isDirty
            ? 'ain-status ain-status--unsaved'
            : 'ain-status';
    }

    get noEventSelected() { return !this._selectedEventId; }

    /**
     * Toolbar. Deliberately narrow: colour and font pickers would only produce markup the
     * Flow has to store and the Rich Text Area has to render, for no benefit on a private
     * scratch field.
     */
    get formats() {
        return ['bold', 'italic', 'underline', 'strike', 'list', 'indent', 'link', 'clean'];
    }

    handleNotesChange(event) {
        this._notes = event.target.value || '';
        this._hasLocalEdit = true;
    }

    _toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
