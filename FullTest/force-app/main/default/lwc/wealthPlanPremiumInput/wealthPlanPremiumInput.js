import { LightningElement, api } from 'lwc';

export default class WealthPremiumInput extends LightningElement {
    @api label = '';
    @api type = 'text'; // text, number, select, textarea
    @api fieldName = '';
    @api value = '';
    @api options = [];
    @api isMoney = false;
    @api isMassive = false;
    @api required = false;
    @api readOnly = false;
    @api maxLength;

    get isSelect() { return this.type === 'select'; }
    get isTextarea() { return this.type === 'textarea'; }
    get isStandardInput() { return this.type !== 'select' && this.type !== 'textarea'; }

    get inputClass() {
        return `premium-input${this.isMoney ? ' is-money' : ''}${this.readOnly ? ' is-readonly' : ''}`;
    }

    get textareaClass() {
        return `premium-input premium-textarea${this.isMassive ? ' massive' : ''}${this.readOnly ? ' is-readonly' : ''}`;
    }

    get selectClass() {
        return `premium-input${this.readOnly ? ' is-readonly' : ''}`;
    }

    handleChange(event) {
        let val = event.target.value;
        if (this.type === 'number') {
            val = val ? parseFloat(val) : null;
        }
        this.dispatchEvent(new CustomEvent('valuechange', {
            detail: {
                field: this.fieldName,
                value: val
            }
        }));
    }
}