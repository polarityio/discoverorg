'use strict';

polarity.export = PolarityComponent.extend({
    details: Ember.computed.alias('block.data.details'),
    summaryTags: Ember.computed('details.tags', function(){
        let summaryTags = [];

        if(this.get('details.fullName')){
            summaryTags.push(this.get('details.fullName'));
        }

        if(this.get('details.data.fullName')){
            summaryTags.push(this.get('details.data.fullName'));
        }

        if(this.get('details.data.company.fullName')){
            summaryTags.push(this.get('details.data.company.fullName'));
        }

        if(this.get('details.data.reportsTo.fullName')){
            summaryTags.push("Reports To: " + this.get('details.data.reportsTo.fullName'));
        }

        if(this.get('details.numEmployees')){
            summaryTags.push("Number of Employees: " + this.get('details.numEmployees'));
        }

        if(this.get('details.revenue')){
            summaryTags.push("Revenue: " + this.get('details.revenue'));
        }

        if(this.get('details.fortuneRank')){
            summaryTags.push("Fortune Rank: " + this.get('details.fortuneRank'));
        }

        if(this.get('details.mainPhoneNumber')){
            summaryTags.push("Phone Number: " + this.get('details.mainPhoneNumber'));
        }
        if(this.get('details.data.officeTelNumber')){
            summaryTags.push("Office Phone Number: " + this.get('details.data.officeTelNumber'));
        }

        if(this.get('details.industry')){
            summaryTags.push("Industry: " + this.get('details.industry'));
        }

        if(this.get('details.data.seniorityLevel.displayName')){
            summaryTags.push("SeniorityLevel: " + this.get('details.data.seniorityLevel.displayName'));
        }

        if(this.get('details.data.title')){
            summaryTags.push("Title: " + this.get('details.data.title'));
        }

        if(this.get('details.location')){
            summaryTags.push("Location: " + this.get('details.location.city') + ', ' + this.get('details.location.stateProvinceRegion') + ' ' + this.get('details.location.countryName'));
        }

        if(this.get('details.data.location')){
            summaryTags.push("Location: " + this.get('details.data.location.city') + ', ' + this.get('details.data.location.stateProvinceRegion') + ' ' + this.get('details.data.location.countryName'));
        }

        return summaryTags;
    })
});
