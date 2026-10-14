import { LightningElement, track } from 'lwc';
import getUserInstruction  from '@salesforce/apex/UserInstructionController.getUserInstruction';
import saveUserInstruction from '@salesforce/apex/UserInstructionController.saveUserInstruction';

const MAX_LENGTH = 32768;

export default class AdvisorUserInstructions extends LightningElement {

    // ── State ────────────────────────────────────────────────────────────────

    @track _record        = undefined; // undefined = not yet loaded
    @track _draftText     = '';
    @track _isEditing     = false;
    @track _isInUse       = false;
    @track _isSaving      = false;
    @track _isLoading     = true;
    @track _errorMessage  = '';

    // ── Lifecycle ────────────────────────────────────────────────────────────

    async connectedCallback() {
        await this._fetchInstruction();
    }

    renderedCallback() {
        // Native <textarea> value must be set as a DOM property to reliably
        // reflect changes after the initial render.
        if (this._isEditing) {
            const ta = this.template.querySelector('.aui-textarea');
            if (ta && ta.value !== this._draftText) {
                ta.value = this._draftText;
            }
        }
    }

    // ── Getters ──────────────────────────────────────────────────────────────

    get isLoading()       { return this._isLoading; }
    get isEditing()       { return this._isEditing; }
    get isInUse()         { return this._isInUse; }
    get isSaving()        { return this._isSaving; }
    get errorMessage()    { return this._errorMessage; }
    get hasInstruction()  { return !!this._record; }
    get instructionText() { return this._record ? (this._record.InstructionText__c || '') : ''; }
    get draftText()       { return this._draftText; }

    get editTitle() {
        return this._record ? 'Edit Instructions' : 'Add Instructions';
    }

    get charCountLabel() {
        const used = this._draftText ? this._draftText.length : 0;
        return `${used.toLocaleString()} / ${MAX_LENGTH.toLocaleString()}`;
    }

    get isSaveDisabled() {
        return this._isSaving || !this._draftText || !this._draftText.trim();
    }

    get saveButtonLabel() {
        return this._record ? 'Update Instructions' : 'Save Instructions';
    }

    // ── Handlers ─────────────────────────────────────────────────────────────

    async handleEdit() {
        this._errorMessage = '';
        // Fetch the latest saved version before opening the editor so the
        // user always starts with their most recent saved text.
        await this._fetchInstruction();
        this._isEditing = true;
    }

    handleCancelEdit() {
        this._isEditing  = false;
        this._draftText  = this.instructionText;
    }

    handleDraftInput(event) {
        this._draftText = event.target.value;
    }

    async handleSave() {
        const text = this._draftText ? this._draftText.trim() : '';
        if (!text) return;

        this._isSaving     = true;
        this._errorMessage = '';
        try {
            const id = await saveUserInstruction({ instructionText: text, isActive: true });
            // Patch local record so view mode reflects the save immediately.
            if (this._record) {
                this._record = { ...this._record, InstructionText__c: text, IsActive__c: true };
            } else {
                this._record = { Id: id, InstructionText__c: text, IsActive__c: true };
            }
            this._draftText  = text;
            this._isEditing  = false;
            this._errorMessage = '';
        } catch (e) {
            this._errorMessage = 'Save failed: ' + this._extractError(e);
        } finally {
            this._isSaving = false;
        }
    }

    handleUse() {
        this._isInUse = true;
        this.dispatchEvent(new CustomEvent('useinstructions', {
            detail: { instructionText: this.instructionText }
        }));
    }

    async handleDiscard() {
        this._errorMessage = '';
        this._isSaving     = true;
        try {
            await saveUserInstruction({
                instructionText: this.instructionText,
                isActive: false
            });
            this._isInUse = false;
            if (this._record) {
                this._record = { ...this._record, IsActive__c: false };
            }
            this.dispatchEvent(new CustomEvent('discardinstruction'));
        } catch (e) {
            this._errorMessage = 'Discard failed: ' + this._extractError(e);
        } finally {
            this._isSaving = false;
        }
    }

    // ── Private ───────────────────────────────────────────────────────────────

    async _fetchInstruction() {
        this._isLoading = true;
        try {
            const record    = await getUserInstruction();
            this._record    = record ?? null;
            this._draftText = record ? (record.InstructionText__c || '') : '';
        } catch (e) {
            this._errorMessage = 'Could not load your instructions: ' + this._extractError(e);
        } finally {
            this._isLoading = false;
        }
    }

    _extractError(err) {
        if (!err) return 'Unknown error';
        if (err.body && err.body.message) return err.body.message;
        if (err.message) return err.message;
        return JSON.stringify(err);
    }
}
