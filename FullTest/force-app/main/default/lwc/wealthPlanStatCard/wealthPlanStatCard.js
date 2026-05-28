import { LightningElement, api } from 'lwc';

export default class WealthPlanStatCard extends LightningElement {
    @api label = '';
    @api value = '';
    
    // variant options: 'default', 'highlight', 'green', 'blue', 'red'
    @api variant = 'default';

    get computedCardClass() {
        let baseClass = 'stat-card ';
        if (this.variant === 'highlight') {
            baseClass += 'stat-card-highlight';
        }
        return baseClass;
    }

    get computedValueClass() {
        let baseClass = 'stat-value ';
        if (this.variant === 'green' || this.variant === 'highlight') return baseClass + 'text-green';
        if (this.variant === 'red') return baseClass + 'text-red';
        if (this.variant === 'blue') return baseClass + 'text-blue';
        return baseClass;
    }
}