import { LightningElement, api } from 'lwc';

export default class SecurityMDCCompletenessBar extends LightningElement {
    @api label = '';
    @api score = 0;

    get barClass() {
        return this.score >= 95
            ? 'slds-progress-bar__value slds-progress-bar__value_success'
            : 'slds-progress-bar__value';
    }

    get barStyle() {
        let color = '';
        if (this.score < 95 && this.score >= 80) {
            color = 'background: var(--slds-g-color-warning-base-50, #f2a73b);';
        } else if (this.score < 80) {
            color = 'background: var(--slds-g-color-error-base-50, #ba0517);';
        }
        return `width: ${this.score}%; ${color}`;
    }
}
