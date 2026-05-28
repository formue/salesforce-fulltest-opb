import { LightningElement, api } from 'lwc';

export default class WealthPlanViewShell extends LightningElement {
    @api dashboardTitle = 'Overview';
    @api dashboardSubtitle = 'Manage your records.';
    @api editorTitle = 'Edit Record';
    @api isEditorView = false;
    @api isDirty = false;
    @api viewOnly = false;

    @api useModalEditor = false;
    @api modalWidth = '1000px';

    get isSaveDisabled() {
        return !this.isDirty;
    }

    get showDashboard() {
        return !this.isEditorView || this.useModalEditor;
    }

    get showInlineEditor() {
        return this.isEditorView && !this.useModalEditor;
    }

    get showModalEditor() {
        return this.isEditorView && this.useModalEditor;
    }

    get editorPanelStyle() {
        return `width: ${this.modalWidth}; max-width: 92vw; max-height: 88vh; display: flex; flex-direction: column;`;
    }

    renderedCallback() {
        document.body.style.overflow = this.showModalEditor ? 'hidden' : '';
    }

    disconnectedCallback() {
        document.body.style.overflow = '';
    }

    handleShellSave() { this.dispatchEvent(new CustomEvent('shellsave')); }
    handleShellCancel() { this.dispatchEvent(new CustomEvent('shellcancel')); }
    handleShellApply() { this.dispatchEvent(new CustomEvent('shellapply')); }
}