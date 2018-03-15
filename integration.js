'use strict';

let request = require('request');
let _ = require('lodash');
let util = require('util');
let net = require('net');
let config = require('./config/config');
let async = require('async');
let fs = require('fs');
let Logger;
let requestWithDefaults;
let previousDomainRegexAsString = '';
let domainBlacklistRegex = null;

const MAX_PARALLEL_LOOKUPS = 10;

// Global AuthToken Cache
const authTokens = new Map();

function startup(logger) {
    Logger = logger;
    let defaults = {};

    if (typeof config.request.cert === 'string' && config.request.cert.length > 0) {
        defaults.cert = fs.readFileSync(config.request.cert);
    }

    if (typeof config.request.key === 'string' && config.request.key.length > 0) {
        defaults.key = fs.readFileSync(config.request.key);
    }

    if (typeof config.request.passphrase === 'string' && config.request.passphrase.length > 0) {
        defaults.passphrase = config.request.passphrase;
    }

    if (typeof config.request.ca === 'string' && config.request.ca.length > 0) {
        defaults.ca = fs.readFileSync(config.request.ca);
    }

    if (typeof config.request.proxy === 'string' && config.request.proxy.length > 0) {
        defaults.proxy = config.request.proxy;
    }

    requestWithDefaults = request.defaults(defaults);
}


function _createAuthKey(options){
    return options.username + options.password + options.apiKey;
}

/**
 *
 * @param entities
 * @param options
 * @param cb
 */
var createToken = function (options, cb) {
    let authKey = _createAuthKey(options);
    if(authTokens.has(authKey)){
        Logger.debug({user: options.username}, 'Using Cached Auth Token');
        cb(null, authTokens.get(authKey));
        return;
    }

    let requestOptions = {
        uri: 'https://papi.discoverydb.com/papi/login',
        method: 'POST',
        body: {
            "username": options.username,
            "password": options.password,
            "partnerKey": options.apiKey
        },
        json: true
    };

    requestWithDefaults(requestOptions, function (err, response, body) {
        let errorObject = _isApiError(err, response, body);
        if (errorObject) {
            cb(errorObject);
            return;
        }

        let authToken = response.headers['x-auth-token'];
        authTokens.set(authKey, authToken);
        cb(null, authToken);
    });
};

function _setupRegexBlacklists(options) {
    if (options.domainBlacklistRegex !== previousDomainRegexAsString && options.domainBlacklistRegex.length === 0) {
        Logger.debug("Removing Domain Blacklist Regex Filtering");
        previousDomainRegexAsString = '';
        domainBlacklistRegex = null;
    } else {
        if (options.domainBlacklistRegex !== previousDomainRegexAsString) {
            previousDomainRegexAsString = options.domainBlacklistRegex;
            Logger.debug({domainBlacklistRegex: previousDomainRegexAsString}, "Modifying Domain Blacklist Regex");
            domainBlacklistRegex = new RegExp(options.domainBlacklistRegex, 'i');
        }
    }
}


function doLookup(entities, options, cb) {

    Logger.debug({options: options}, 'Options');
    _setupRegexBlacklists(options);

    let lookupResults = [];
    let entityObj = entities;

    //Logger.debug({entity: entityObj}, "Entity Objects");


    if (typeof(options.apiKey) !== 'string' || options.apiKey.length === 0) {
        cb("The API key is not set.");
        return;
    }

    createToken(options, function (err, token) {

        async.each(entities, function (entityObj, next) {
            if (entityObj.isDomain) {
                if (domainBlacklistRegex !== null) {
                    if (domainBlacklistRegex.test(entityObj.value)) {
                        Logger.debug({domain: entityObj.value}, 'Blocked BlackListed Domain Lookup');
                        return next(null);
                    }
                }
                _lookupEntityDomain(entityObj, options, token, function (err, result) {
                    if (err) {
                        next(err);
                    } else {
                        Logger.debug({results: result}, "Logging Domain Results");
                        lookupResults.push(result);
                        next(null);
                    }
                });
            } else if (entityObj && _parseCompanies(entityObj, options) === true) {
                _lookupEntityCompany(entityObj, options, token, function (err, result) {
                    if (err) {
                        next(err);
                    } else {
                        Logger.debug({results: result}, "Logging Company Results");
                        lookupResults.push(result);
                        next(null);
                    }
                });
            } else if (entityObj.types.indexOf('string') > 0) {
                _lookupEntityPerson(entityObj, options, token, function (err, result) {
                    if (err) {
                        next(err);
                    } else {
                        Logger.debug({results: result}, "Logging Person Results");
                        lookupResults.push(result);
                        next(null);
                    }
                });
            } else if (entityObj.isEmail) {
                _lookupEntityPersonEmail(entityObj, options, token, function (err, result) {
                    if (err) {
                        next(err);
                    } else {
                        Logger.debug({results: result}, "Logging Email Results");
                        lookupResults.push(result);
                        next(null);
                    }
                });
            } else {
                lookupResults.push({entity: entityObj, data: null}); //Cache the missed results
                next(null);
            }
        }, function (err) {
            cb(err, lookupResults);
        });
    });
}

function _parseCompanies(entityObj, options) {
    //Logger.debug({entity: entityObj}, "Printing out the single entityObj for ParseCompanies");
    let companies = options.lookupCompanies;
    let companyStrings = companies.split(",");

    return entityObj.channels.some(channelObj => companyStrings.includes(channelObj.name) >= 0);
}


function _lookupEntityDomain(entityObj, options, token, cb) {
    let requestOptions = {
        uri: 'https://papi.discoverydb.com/papi/v1/search/companies',
        method: 'POST',
        headers: {'X-AUTH-TOKEN': token},
        body: {
            "companyCriteria": {
                "emailDomains": [entityObj.value]
            }
        },
        json: true
    };


    requestWithDefaults(requestOptions, function (err, response, body) {
        let errorObject = _isApiError(err, response, body, entityObj.value);
        if (errorObject) {
            cb(errorObject);
            return;
        }

        Logger.debug({data: body.content[0]}, "Logging Body Data");

        if (_.isEmpty(body.content)) {
            cb(null, {
                entity: entityObj,
                data: null
            });
            return;
        }

        if (_isLookupMiss(response)) {
            cb(null, {
                entity: entityObj,
                data: null
            });
            return;
        }

        if (_isLookupMiss1(response)) {
            cb(null, {
                entity: entityObj,
                data: null
            });
            return;
        }


        // The lookup results returned is an array of lookup objects with the following format
        cb(null, {
            // Required: This is the entity object passed into the integration doLookup method
            entity: entityObj,
            // Required: An object containing everything you want passed to the template
            data: {
                // We are constructing the tags using a custom summary block so no data needs to be passed here
                summary: [],
                // Data that you want to pass back to the notification window details block
                details: body.content[0]
            }
        });
    });
}

function _lookupEntityCompany(entityObj, options, token, cb) {

    let requestOptions = {
        uri: 'https://papi.discoverydb.com/papi/v1/search/companies',
        method: 'POST',
        headers: {'X-AUTH-TOKEN': token},
        body: {
            "companyCriteria": {
                "queryString": entityObj.value,
                "queryStringApplication": ["FULL_NAME"]
            }
        },
        json: true
    };


    requestWithDefaults(requestOptions, function (err, response, body) {
        let errorObject = _isApiError(err, response, body, entityObj.value);
        if (errorObject) {
            cb(errorObject);
            return;
        }
        Logger.debug({data: body.content[0]}, "Logging Body Data");

        if (_.isEmpty(body.content)) {
            cb(null, {
                entity: entityObj,
                data: null
            });
            return;
        }

        if (_isLookupMiss(response)) {
            cb(null, {
                entity: entityObj,
                data: null
            });
            return;
        }

        if (_isLookupMiss1(response)) {
            cb(null, {
                entity: entityObj,
                data: null
            });
            return;
        }


        // The lookup results returned is an array of lookup objects with the following format
        cb(null, {
            // Required: This is the entity object passed into the integration doLookup method
            entity: entityObj,
            // Required: An object containing everything you want passed to the template
            data: {
                // We are constructing the tags using a custom summary block so no data needs to be passed here
                summary: [],
                // Data that you want to pass back to the notification window details block
                details: body.content[0]
            }
        });
    });
}

function _lookupEntityPerson(entityObj, options, token, cb) {

    let requestOptions = {
        uri: 'https://papi.discoverydb.com/papi/v1/search/persons',
        method: 'POST',
        headers: {'X-AUTH-TOKEN': token},
        body: {
            "personCriteria": {
                "queryString": entityObj.value,
                "queryStringApplication": ["FULL_NAME"]
            }
        },
        json: true
    };

    Logger.debug({request: requestOptions}, "What does the request look like");

    requestWithDefaults(requestOptions, function (err, response, body) {
        let errorObject = _isApiError(err, response, body, entityObj.value);
        if (errorObject) {
            cb(errorObject);
            return;
        }
        Logger.debug({entity: entityObj}, "What does the Entity Obj Look like");

        Logger.debug({data: body.content[0]}, "Logging Body Data");

        if (_.isEmpty(body.content)) {
            cb(null, {
                entity: entityObj,
                data: null
            });
            return;
        }

        if (_isLookupMiss(response)) {
            cb(null, {
                entity: entityObj,
                data: null
            });
            return;
        }

        if (_isLookupMiss1(response)) {
            cb(null, {
                entity: entityObj,
                data: null
            });
            return;
        }


        // The lookup results returned is an array of lookup objects with the following format
        cb(null, {
            // Required: This is the entity object passed into the integration doLookup method
            entity: entityObj,
            // Required: An object containing everything you want passed to the template
            data: {
                // We are constructing the tags using a custom summary block so no data needs to be passed here
                summary: [],
                // Data that you want to pass back to the notification window details block
                details: {data: body.content[0]}
            }
        });
    });
}


function _lookupEntityPersonEmail(entityObj, options, token, cb) {

    let requestOptions = {
        uri: 'https://papi.discoverydb.com/papi/v1/search/persons',
        method: 'POST',
        headers: {'X-AUTH-TOKEN': token},
        body: {
            "personCriteria": {
                "queryString": entityObj.value,
                "queryStringApplication": ["EMAIL"]
            }
        },
        json: true
    };


    requestWithDefaults(requestOptions, function (err, response, body) {
        let errorObject = _isApiError(err, response, body, entityObj.value);
        if (errorObject) {
            cb(errorObject);
            return;
        }

        if (_.isEmpty(body.content)) {
            cb(null, {
                entity: entityObj,
                data: null
            });
            return;
        }

        Logger.debug({data: body.content[0]}, "Logging Body Data");

        if (_isLookupMiss(response)) {
            cb(null, {
                entity: entityObj,
                data: null
            });
            return;
        }

        if (_isLookupMiss1(response)) {
            cb(null, {
                entity: entityObj,
                data: null
            });
            return;
        }

        // The lookup results returned is an array of lookup objects with the following format
        cb(null, {
            // Required: This is the entity object passed into the integration doLookup method
            entity: entityObj,
            // Required: An object containing everything you want passed to the template
            data: {
                // We are constructing the tags using a custom summary block so no data needs to be passed here
                summary: [],
                // Data that you want to pass back to the notification window details block
                details: {data: body.content[0]}
            }
        });
    });
}


function _isLookupMiss(response) {
    return response.statusCode === 404;
}

function _isLookupMiss1(response) {
    return response.statusCode === 500;
}

function _isApiError(err, response, body, entityValue) {
    if (err) {
        return err;
    }

    if (response.statusCode === 500) {
        return _createJsonErrorPayload("Malinformed Request", null, '500', '1', 'Malinformed Request', {
            err: err
        });
    }

    // Any code that is not 200 and not 404 (missed response), we treat as an error
    if (response.statusCode !== 200 && response.statusCode !== 404) {
        return body;
    }

    return null;
}

// function that takes the ErrorObject and passes the error message to the notification window
var _createJsonErrorPayload = function (msg, pointer, httpCode, code, title, meta) {
    return {
        errors: [
            _createJsonErrorObject(msg, pointer, httpCode, code, title, meta)
        ]
    }
};

var _createJsonErrorObject = function (msg, pointer, httpCode, code, title, meta) {
    let error = {
        detail: msg,
        status: httpCode.toString(),
        title: title,
        code: 'DORG_' + code.toString()
    };

    if (pointer) {
        error.source = {
            pointer: pointer
        };
    }

    if (meta) {
        error.meta = meta;
    }

    return error;
};

function validateOptions(userOptions, cb) {
    let errors = [];
    if (typeof userOptions.apiKey.value !== 'string' ||
        (typeof userOptions.apiKey.value === 'string' && userOptions.apiKey.value.length === 0)) {
        errors.push({
            key: 'apiKey',
            message: 'You must provide a DiscoverOrg Partner API key'
        })
    }

    cb(null, errors);
}

module.exports = {
    doLookup: doLookup,
    startup: startup,
    validateOptions: validateOptions
};
