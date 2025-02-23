"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Authenticator = void 0;
const aws_jwt_verify_1 = require("aws-jwt-verify");
const axios_1 = __importDefault(require("axios"));
const pino_1 = __importDefault(require("pino"));
const querystring_1 = require("querystring");
const cookie_1 = require("./util/cookie");
const csrf_1 = require("./util/csrf");
class Authenticator {
    _region;
    _userPoolId;
    _userPoolAppId;
    _userPoolAppSecret;
    _userPoolDomain;
    _cookieExpirationDays;
    _disableCookieDomain;
    _httpOnly;
    _sameSite;
    _cookieBase;
    _cookiePath;
    _cookieDomain;
    _csrfProtection;
    _logoutConfiguration;
    _parseAuthPath;
    _cookieSettingsOverrides;
    _logger;
    _jwtVerifier;
    constructor(params) {
        this._verifyParams(params);
        this._region = params.region;
        this._userPoolId = params.userPoolId;
        this._userPoolAppId = params.userPoolAppId;
        this._userPoolAppSecret = params.userPoolAppSecret;
        this._userPoolDomain = params.userPoolDomain;
        this._cookieExpirationDays = params.cookieExpirationDays || 365;
        this._disableCookieDomain = ('disableCookieDomain' in params && params.disableCookieDomain === true);
        this._cookieDomain = params.cookieDomain;
        this._httpOnly = ('httpOnly' in params && params.httpOnly === true);
        this._sameSite = params.sameSite;
        this._cookieBase = `CognitoIdentityServiceProvider.${params.userPoolAppId}`;
        this._cookiePath = params.cookiePath;
        this._cookieSettingsOverrides = params.cookieSettingsOverrides || {};
        this._logger = (0, pino_1.default)({
            level: params.logLevel || 'silent',
            base: null, //Remove pid, hostname and name logging as not usefull for Lambda
        });
        this._jwtVerifier = aws_jwt_verify_1.CognitoJwtVerifier.create({
            userPoolId: params.userPoolId,
            clientId: params.userPoolAppId,
            tokenUse: 'id',
        });
        this._csrfProtection = params.csrfProtection;
        this._logoutConfiguration = params.logoutConfiguration;
        this._parseAuthPath = (params.parseAuthPath || '').replace(/^\//, '');
    }
    /**
     * Verify that constructor parameters are corrects.
     * @param  {object} params constructor params
     * @return {void} throw an exception if params are incorects.
     */
    _verifyParams(params) {
        if (typeof params !== 'object') {
            throw new Error('Expected params to be an object');
        }
        ['region', 'userPoolId', 'userPoolAppId', 'userPoolDomain'].forEach(param => {
            if (typeof params[param] !== 'string') {
                throw new Error(`Expected params.${param} to be a string`);
            }
        });
        if (params.cookieExpirationDays && typeof params.cookieExpirationDays !== 'number') {
            throw new Error('Expected params.cookieExpirationDays to be a number');
        }
        if ('disableCookieDomain' in params && typeof params.disableCookieDomain !== 'boolean') {
            throw new Error('Expected params.disableCookieDomain to be boolean');
        }
        if ('cookieDomain' in params && typeof params.cookieDomain !== 'string') {
            throw new Error('Expected params.cookieDomain to be a string');
        }
        if ('httpOnly' in params && typeof params.httpOnly !== 'boolean') {
            throw new Error('Expected params.httpOnly to be a boolean');
        }
        if (params.sameSite !== undefined && !cookie_1.SAME_SITE_VALUES.includes(params.sameSite)) {
            throw new Error('Expected params.sameSite to be a Strict || Lax || None');
        }
        if ('cookiePath' in params && typeof params.cookiePath !== 'string') {
            throw new Error('Expected params.cookiePath to be a string');
        }
        if (params.logoutConfiguration && !/\/\w+/.test(params.logoutConfiguration.logoutUri)) {
            throw new Error('Expected params.logoutConfiguration.logoutUri to be a valid non-empty string starting with "/"');
        }
    }
    /**
     * Exchange authorization code for tokens.
     * @param  {String} redirectURI Redirection URI.
     * @param  {String} code        Authorization code.
     * @return {Promise} Authenticated user tokens.
     */
    _fetchTokensFromCode(redirectURI, code) {
        const authorization = this._getAuthorization();
        const request = {
            url: `https://${this._userPoolDomain}/oauth2/token`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...(authorization && { 'Authorization': `Basic ${authorization}` }),
            },
            data: (0, querystring_1.stringify)({
                client_id: this._userPoolAppId,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: redirectURI,
            }),
        };
        this._logger.debug({ msg: 'Fetching tokens from grant code...', request, code });
        return axios_1.default.request(request)
            .then(resp => {
            this._logger.debug({ msg: 'Fetched tokens', tokens: resp.data });
            return {
                idToken: resp.data.id_token,
                accessToken: resp.data.access_token,
                refreshToken: resp.data.refresh_token,
            };
        })
            .catch(err => {
            this._logger.error({ msg: 'Unable to fetch tokens from grant code', request, code });
            throw err;
        });
    }
    /**
     * Fetch accessTokens from refreshToken.
     * @param  {String} redirectURI Redirection URI.
     * @param  {String} refreshToken Refresh token.
     * @return {Promise<Tokens>} Refreshed user tokens.
     */
    _fetchTokensFromRefreshToken(redirectURI, refreshToken) {
        const authorization = this._getAuthorization();
        const request = {
            url: `https://${this._userPoolDomain}/oauth2/token`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...(authorization && { 'Authorization': `Basic ${authorization}` }),
            },
            data: (0, querystring_1.stringify)({
                client_id: this._userPoolAppId,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
                redirect_uri: redirectURI,
            }),
        };
        this._logger.debug({ msg: 'Fetching tokens from refreshToken...', request, refreshToken });
        return axios_1.default.request(request)
            .then(resp => {
            this._logger.debug({ msg: 'Fetched tokens', tokens: resp.data });
            return {
                idToken: resp.data.id_token,
                accessToken: resp.data.access_token,
            };
        })
            .catch(err => {
            this._logger.error({ msg: 'Unable to fetch tokens from refreshToken', request, refreshToken });
            throw err;
        });
    }
    _getAuthorization() {
        return this._userPoolAppSecret && Buffer.from(`${this._userPoolAppId}:${this._userPoolAppSecret}`).toString('base64');
    }
    _validateCSRFCookies(request) {
        if (!this._csrfProtection) {
            throw new Error('_validateCSRFCookies should not be called if CSRF protection is disabled.');
        }
        const requestParams = (0, querystring_1.parse)(request.querystring);
        const requestCookies = request.headers.cookie?.flatMap(h => cookie_1.Cookies.parse(h.value)) || [];
        this._logger.debug({ msg: 'Validating CSRF Cookies', requestCookies });
        const parsedState = JSON.parse(Buffer.from(csrf_1.urlSafe.parse(requestParams.state), 'base64').toString());
        const { nonce: originalNonce, nonceHmac, pkce } = this._getCSRFTokensFromCookie(request.headers.cookie);
        if (!parsedState.nonce ||
            !originalNonce ||
            parsedState.nonce !== originalNonce) {
            if (!originalNonce) {
                throw new Error('Your browser didn\'t send the nonce cookie along, but it is required for security (prevent CSRF).');
            }
            throw new Error('Nonce mismatch. This can happen if you start multiple authentication attempts in parallel (e.g. in separate tabs)');
        }
        if (!pkce) {
            throw new Error('Your browser didn\'t send the pkce cookie along, but it is required for security (prevent CSRF).');
        }
        const calculatedHmac = (0, csrf_1.signNonce)(parsedState.nonce, this._csrfProtection.nonceSigningSecret);
        if (calculatedHmac !== nonceHmac) {
            throw new Error(`Nonce signature mismatch! Expected ${calculatedHmac} but got ${nonceHmac}`);
        }
    }
    _getOverridenCookieAttributes(cookieAttributes = {}, cookieType) {
        const res = { ...cookieAttributes };
        const overrides = this._cookieSettingsOverrides?.[cookieType];
        if (overrides) {
            if (overrides.httpOnly !== undefined) {
                res.httpOnly = overrides.httpOnly;
            }
            if (overrides.sameSite !== undefined) {
                res.sameSite = overrides.sameSite;
            }
            if (overrides.path !== undefined) {
                res.path = overrides.path;
            }
            if (overrides.expirationDays !== undefined) {
                res.expires = new Date(Date.now() + overrides.expirationDays * 864e+5);
            }
        }
        this._logger.debug({
            msg: 'Cookie settings overriden',
            cookieAttributes,
            cookieType,
            cookieSettingsOverrides: this._cookieSettingsOverrides,
        });
        return res;
    }
    /**
     * Create a Lambda@Edge redirection response to set the tokens on the user's browser cookies.
     * @param  {Object} tokens   Cognito User Pool tokens.
     * @param  {String} domain   Website domain.
     * @param  {String} location Path to redirection.
     * @return Lambda@Edge response.
     */
    async _getRedirectResponse(tokens, domain, location) {
        const decoded = await this._jwtVerifier.verify(tokens.idToken);
        const username = decoded['cognito:username'];
        const usernameBase = `${this._cookieBase}.${username}`;
        const cookieDomain = (0, cookie_1.getCookieDomain)(domain, this._disableCookieDomain, this._cookieDomain);
        const cookieAttributes = {
            domain: cookieDomain,
            expires: new Date(Date.now() + this._cookieExpirationDays * 864e+5),
            secure: true,
            httpOnly: this._httpOnly,
            sameSite: this._sameSite,
            path: this._cookiePath,
        };
        const cookies = [
            cookie_1.Cookies.serialize(`${usernameBase}.accessToken`, tokens.accessToken, this._getOverridenCookieAttributes(cookieAttributes, 'accessToken')),
            cookie_1.Cookies.serialize(`${usernameBase}.idToken`, tokens.idToken, this._getOverridenCookieAttributes(cookieAttributes, 'idToken')),
            ...(tokens.refreshToken ? [cookie_1.Cookies.serialize(`${usernameBase}.refreshToken`, tokens.refreshToken, this._getOverridenCookieAttributes(cookieAttributes, 'refreshToken'))] : []),
            cookie_1.Cookies.serialize(`${usernameBase}.tokenScopesString`, 'phone email profile openid aws.cognito.signin.user.admin', cookieAttributes),
            cookie_1.Cookies.serialize(`${this._cookieBase}.LastAuthUser`, username, cookieAttributes),
        ];
        // Clear CSRF Token Cookies
        if (this._csrfProtection) {
            // Domain attribute is always not set here as CSRF cookies are used
            // exclusively by the CF distribution
            const csrfCookieAttributes = { ...cookieAttributes, domain: undefined, expires: new Date() };
            cookies.push(cookie_1.Cookies.serialize(`${this._cookieBase}.${csrf_1.PKCE_COOKIE_NAME_SUFFIX}`, '', csrfCookieAttributes), cookie_1.Cookies.serialize(`${this._cookieBase}.${csrf_1.NONCE_COOKIE_NAME_SUFFIX}`, '', csrfCookieAttributes), cookie_1.Cookies.serialize(`${this._cookieBase}.${csrf_1.NONCE_HMAC_COOKIE_NAME_SUFFIX}`, '', csrfCookieAttributes));
        }
        const response = {
            status: '302',
            headers: {
                'location': [{
                        key: 'Location',
                        value: location,
                    }],
                'cache-control': [{
                        key: 'Cache-Control',
                        value: 'no-cache, no-store, max-age=0, must-revalidate',
                    }],
                'pragma': [{
                        key: 'Pragma',
                        value: 'no-cache',
                    }],
                'set-cookie': cookies.map(c => ({ key: 'Set-Cookie', value: c })),
            },
        };
        this._logger.debug({ msg: 'Generated set-cookie response', response });
        return response;
    }
    /**
     * Extract value of the authentication token from the request cookies.
     * @param  {Array}  cookieHeaders 'Cookie' request headers.
     * @return {Tokens} Extracted id token or access token. Null if not found.
     */
    _getTokensFromCookie(cookieHeaders) {
        if (!cookieHeaders) {
            this._logger.debug("Cookies weren't present in the request");
            throw new Error("Cookies weren't present in the request");
        }
        this._logger.debug({ msg: 'Extracting authentication token from request cookie', cookieHeaders });
        const cookies = cookieHeaders.flatMap(h => cookie_1.Cookies.parse(h.value));
        const tokenCookieNamePrefix = `${this._cookieBase}.`;
        const idTokenCookieNamePostfix = '.idToken';
        const refreshTokenCookieNamePostfix = '.refreshToken';
        const tokens = {};
        for (const { name, value } of cookies) {
            if (name.startsWith(tokenCookieNamePrefix) && name.endsWith(idTokenCookieNamePostfix)) {
                tokens.idToken = value;
            }
            if (name.startsWith(tokenCookieNamePrefix) && name.endsWith(refreshTokenCookieNamePostfix)) {
                tokens.refreshToken = value;
            }
        }
        if (!tokens.idToken && !tokens.refreshToken) {
            this._logger.debug('Neither idToken, nor refreshToken was present in request cookies');
            throw new Error('Neither idToken, nor refreshToken was present in request cookies');
        }
        this._logger.debug({ msg: 'Found tokens in cookie', tokens });
        return tokens;
    }
    /**
     * Extract values of the CSRF tokens from the request cookies.
     * @param  {Array}  cookieHeaders 'Cookie' request headers.
     * @return {CSRFTokens} Extracted CSRF Tokens from cookie.
     */
    _getCSRFTokensFromCookie(cookieHeaders) {
        if (!cookieHeaders) {
            this._logger.debug("Cookies weren't present in the request");
            throw new Error("Cookies weren't present in the request");
        }
        this._logger.debug({ msg: 'Extracting CSRF tokens from request cookie', cookieHeaders });
        const cookies = cookieHeaders.flatMap(h => cookie_1.Cookies.parse(h.value));
        const csrfTokens = cookies.reduce((tokens, { name, value }) => {
            if (name.startsWith(this._cookieBase)) {
                [
                    csrf_1.NONCE_COOKIE_NAME_SUFFIX,
                    csrf_1.NONCE_HMAC_COOKIE_NAME_SUFFIX,
                    csrf_1.PKCE_COOKIE_NAME_SUFFIX,
                ].forEach(key => {
                    if (name.endsWith(`.${key}`)) {
                        tokens[key] = value;
                    }
                });
            }
            return tokens;
        }, {});
        this._logger.debug({ msg: 'Found CSRF tokens in cookie', csrfTokens });
        return csrfTokens;
    }
    /**
     * Extracts the redirect uri from the state param. When CSRF protection is
     * enabled, redirect uri is encoded inside state along with other data. So, it
     * needs to be base64 decoded. When CSRF is not enabled, state can be used
     * directly.
     * @param {string} state
     * @returns {string}
     */
    _getRedirectUriFromState(state) {
        if (this._csrfProtection) {
            const parsedState = JSON.parse(Buffer.from(csrf_1.urlSafe.parse(state), 'base64').toString());
            this._logger.debug({ msg: 'Parsed state param to extract redirect uri', parsedState });
            return parsedState.redirect_uri;
        }
        return state;
    }
    async _revokeTokens(tokens) {
        const authorization = this._getAuthorization();
        const revokeRequest = {
            url: `https://${this._userPoolDomain}/oauth2/revoke`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...(authorization && { 'Authorization': `Basic ${authorization}` }),
            },
            data: (0, querystring_1.stringify)({
                client_id: this._userPoolAppId,
                token: tokens.refreshToken,
            }),
        };
        this._logger.debug({ msg: 'Revoking refreshToken...', request: revokeRequest, refreshToken: tokens.refreshToken });
        return axios_1.default.request(revokeRequest)
            .then(() => {
            this._logger.debug({ msg: 'Revoked refreshToken', refreshToken: tokens.refreshToken });
        })
            .catch(err => {
            this._logger.error({ msg: 'Unable to revoke refreshToken', request: revokeRequest, err: JSON.stringify(err) });
            throw err;
        });
    }
    async _clearCookies(event, tokens = {}) {
        this._logger.info({ msg: 'Clearing cookies...', event, tokens });
        const { request } = event.Records[0].cf;
        const cfDomain = request.headers.host[0].value;
        const requestParams = (0, querystring_1.parse)(request.querystring);
        const redirectURI = this._logoutConfiguration?.logoutRedirectUri ||
            requestParams.redirect_uri ||
            `https://${cfDomain}`;
        const cookieDomain = (0, cookie_1.getCookieDomain)(cfDomain, this._disableCookieDomain, this._cookieDomain);
        const cookieAttributes = {
            domain: cookieDomain,
            expires: new Date(),
            secure: true,
            httpOnly: this._httpOnly,
            sameSite: this._sameSite,
            path: this._cookiePath,
        };
        let responseCookies = [];
        try {
            const decoded = await this._jwtVerifier.verify(tokens.idToken);
            const username = decoded['cognito:username'];
            this._logger.info({ msg: 'Token verified. Clearing cookies...', idToken: tokens.idToken, username });
            const usernameBase = `${this._cookieBase}.${username}`;
            responseCookies = [
                cookie_1.Cookies.serialize(`${usernameBase}.accessToken`, '', cookieAttributes),
                cookie_1.Cookies.serialize(`${usernameBase}.idToken`, '', cookieAttributes),
                ...(tokens.refreshToken ? [cookie_1.Cookies.serialize(`${usernameBase}.refreshToken`, '', cookieAttributes)] : []),
                cookie_1.Cookies.serialize(`${usernameBase}.tokenScopesString`, '', cookieAttributes),
                cookie_1.Cookies.serialize(`${this._cookieBase}.LastAuthUser`, '', cookieAttributes),
            ];
        }
        catch (err) {
            this._logger.info({
                msg: 'Unable to verify token. Inferring data from request cookies and clearing them...',
                idToken: tokens.idToken,
            });
            const requestCookies = request.headers.cookie?.flatMap(h => cookie_1.Cookies.parse(h.value)) || [];
            for (const { name } of requestCookies) {
                if (name.startsWith(this._cookieBase)) {
                    responseCookies.push(cookie_1.Cookies.serialize(name, '', cookieAttributes));
                }
            }
        }
        const response = {
            status: '302',
            headers: {
                'location': [{
                        key: 'Location',
                        value: redirectURI,
                    }],
                'cache-control': [{
                        key: 'Cache-Control',
                        value: 'no-cache, no-store, max-age=0, must-revalidate',
                    }],
                'pragma': [{
                        key: 'Pragma',
                        value: 'no-cache',
                    }],
                'set-cookie': responseCookies.map(c => ({ key: 'Set-Cookie', value: c })),
            },
        };
        this._logger.debug({ msg: 'Generated set-cookie response', response });
        return response;
    }
    /**
     * Get redirect to cognito userpool response
     * @param  {CloudFrontRequest}  request The original request
     * @param  {string}  redirectURI Redirection URI.
     * @return {CloudFrontResultResponse} Redirect response.
     */
    _getRedirectToCognitoUserPoolResponse(request, redirectURI) {
        const cfDomain = request.headers.host[0].value;
        let redirectPath = request.uri;
        if (request.querystring && request.querystring !== '') {
            redirectPath += encodeURIComponent('?' + request.querystring);
        }
        let oauthRedirectUri = redirectURI;
        if (this._parseAuthPath) {
            oauthRedirectUri = `https://${cfDomain}/${this._parseAuthPath}`;
        }
        let csrfTokens = {};
        let state = redirectPath;
        if (this._csrfProtection) {
            csrfTokens = (0, csrf_1.generateCSRFTokens)(redirectURI, this._csrfProtection.nonceSigningSecret);
            state = csrfTokens.state;
        }
        const userPoolUrl = `https://${this._userPoolDomain}/authorize?redirect_uri=${oauthRedirectUri}&response_type=code&client_id=${this._userPoolAppId}&state=${state}`;
        this._logger.debug(`Redirecting user to Cognito User Pool URL ${userPoolUrl}`);
        let cookies;
        if (this._csrfProtection) {
            const cookieAttributes = {
                expires: new Date(Date.now() + 10 * 60 * 1000),
                secure: true,
                httpOnly: this._httpOnly,
                sameSite: this._sameSite,
                path: this._cookiePath,
            };
            cookies = [
                cookie_1.Cookies.serialize(`${this._cookieBase}.${csrf_1.PKCE_COOKIE_NAME_SUFFIX}`, csrfTokens.pkce || '', cookieAttributes),
                cookie_1.Cookies.serialize(`${this._cookieBase}.${csrf_1.NONCE_COOKIE_NAME_SUFFIX}`, csrfTokens.nonce || '', cookieAttributes),
                cookie_1.Cookies.serialize(`${this._cookieBase}.${csrf_1.NONCE_HMAC_COOKIE_NAME_SUFFIX}`, csrfTokens.nonceHmac || '', cookieAttributes),
            ];
        }
        const response = {
            status: '302',
            headers: {
                'location': [{
                        key: 'Location',
                        value: userPoolUrl,
                    }],
                'cache-control': [{
                        key: 'Cache-Control',
                        value: 'no-cache, no-store, max-age=0, must-revalidate',
                    }],
                'pragma': [{
                        key: 'Pragma',
                        value: 'no-cache',
                    }],
                ...(cookies
                    ? { 'set-cookie': cookies && cookies.map(c => ({ key: 'Set-Cookie', value: c })) }
                    : {}),
            },
        };
        return response;
    }
    /**
     * Handle Lambda@Edge event:
     *   * if authentication cookie is present and valid: forward the request
     *   * if authentication cookie is invalid, but refresh token is present: set cookies with refreshed tokens
     *   * if ?code=<grant code> is present: set cookies with new tokens
     *   * else redirect to the Cognito UserPool to authenticate the user
     * @param  {Object}  event Lambda@Edge event.
     * @return {Promise} CloudFront response.
     */
    async handle(event) {
        this._logger.debug({ msg: 'Handling Lambda@Edge event', event });
        const { request } = event.Records[0].cf;
        const requestParams = (0, querystring_1.parse)(request.querystring);
        const cfDomain = request.headers.host[0].value;
        const redirectURI = `https://${cfDomain}`;
        try {
            const tokens = this._getTokensFromCookie(request.headers.cookie);
            if (this._logoutConfiguration && request.uri.startsWith(this._logoutConfiguration.logoutUri)) {
                this._logger.info({ msg: 'Revoking tokens', tokens });
                await this._revokeTokens(tokens);
                this._logger.info({ msg: 'Revoked tokens. Clearing cookies', tokens });
                return this._clearCookies(event, tokens);
            }
            try {
                this._logger.debug({ msg: 'Verifying token...', tokens });
                const user = await this._jwtVerifier.verify(tokens.idToken);
                this._logger.info({ msg: 'Forwarding request', path: request.uri, user });
                return request;
            }
            catch (err) {
                this._logger.info({ msg: 'Token verification failed', tokens, refreshToken: tokens.refreshToken });
                if (tokens.refreshToken) {
                    this._logger.debug({ msg: 'Verifying idToken failed, verifying refresh token instead...', tokens, err });
                    return await this._fetchTokensFromRefreshToken(redirectURI, tokens.refreshToken)
                        .then(tokens => this._getRedirectResponse(tokens, cfDomain, request.uri));
                }
                else {
                    throw err;
                }
            }
        }
        catch (err) {
            if (this._logoutConfiguration && request.uri.startsWith(this._logoutConfiguration.logoutUri)) {
                this._logger.info({ msg: 'Clearing cookies', path: redirectURI });
                return this._clearCookies(event);
            }
            this._logger.debug("User isn't authenticated: %s", err);
            if (requestParams.code) {
                return this._fetchTokensFromCode(redirectURI, requestParams.code)
                    .then(tokens => this._getRedirectResponse(tokens, cfDomain, this._getRedirectUriFromState(requestParams.state)));
            }
            else {
                return this._getRedirectToCognitoUserPoolResponse(request, redirectURI);
            }
        }
    }
    /**
     *
     * 1. If the token cookies are present in the request, send users to the redirect_uri
     * 2. If cookies are not present, initiate the authentication flow
     *
     * @param event Event that triggers this Lambda function
     * @returns Lambda response
     */
    async handleSignIn(event) {
        this._logger.debug({ msg: 'Handling Lambda@Edge event', event });
        const { request } = event.Records[0].cf;
        const requestParams = (0, querystring_1.parse)(request.querystring);
        const cfDomain = request.headers.host[0].value;
        const redirectURI = requestParams.redirect_uri || `https://${cfDomain}`;
        try {
            const tokens = this._getTokensFromCookie(request.headers.cookie);
            this._logger.debug({ msg: 'Verifying token...', tokens });
            const user = await this._jwtVerifier.verify(tokens.idToken);
            this._logger.info({ msg: 'Redirecting user to', path: redirectURI, user });
            return {
                status: '302',
                headers: {
                    'location': [{
                            key: 'Location',
                            value: redirectURI,
                        }],
                },
            };
        }
        catch (err) {
            this._logger.debug("User isn't authenticated: %s", err);
            return this._getRedirectToCognitoUserPoolResponse(request, redirectURI);
        }
    }
    /**
     *
     * Handler that performs OAuth token exchange -- exchanges the authorization
     * code obtained from the query parameter from server for tokens -- and sets
     * tokens as cookies. This is done after performing CSRF checks, by verifying
     * that the information encoded in the state query parameter is related to the
     * one stored in the cookies.
     *
     * @param event Event that triggers this Lambda function
     * @returns Lambda response
     */
    async handleParseAuth(event) {
        this._logger.debug({ msg: 'Handling Lambda@Edge event', event });
        const { request } = event.Records[0].cf;
        const cfDomain = request.headers.host[0].value;
        const requestParams = (0, querystring_1.parse)(request.querystring);
        try {
            if (!this._parseAuthPath) {
                throw new Error('parseAuthPath is not set');
            }
            const redirectURI = `https://${cfDomain}/${this._parseAuthPath}`;
            if (requestParams.code) {
                if (this._csrfProtection) {
                    this._validateCSRFCookies(request);
                }
                const tokens = await this._fetchTokensFromCode(redirectURI, requestParams.code);
                const location = this._getRedirectUriFromState(requestParams.state);
                return this._getRedirectResponse(tokens, cfDomain, location);
            }
            else {
                this._logger.debug({ msg: 'Code param not found', requestParams });
                throw new Error('OAuth code parameter not found');
            }
        }
        catch (err) {
            this._logger.debug({ msg: 'Unable to exchange code for tokens', err });
            return {
                status: '400',
                body: `${err}`,
            };
        }
    }
    /**
     *
     * Uses the refreshToken present in the cookies to get a new set of tokens
     * from the authorization server. After fetching the tokens, they are sent
     * back to the client as cookies.
     *
     * @param event Event that triggers this Lambda function
     * @returns Lambda response
     */
    async handleRefreshToken(event) {
        this._logger.debug({ msg: 'Handling Lambda@Edge event', event });
        const { request } = event.Records[0].cf;
        const cfDomain = request.headers.host[0].value;
        const requestParams = (0, querystring_1.parse)(request.querystring);
        const redirectURI = requestParams.redirect_uri || `https://${cfDomain}`;
        try {
            let tokens = this._getTokensFromCookie(request.headers.cookie);
            this._logger.debug({ msg: 'Verifying token...', tokens });
            const user = await this._jwtVerifier.verify(tokens.idToken);
            this._logger.debug({ msg: 'Refreshing tokens...', tokens, user });
            tokens = await this._fetchTokensFromRefreshToken(redirectURI, tokens.refreshToken);
            this._logger.debug({ msg: 'Refreshed tokens...', tokens, user });
            return this._getRedirectResponse(tokens, cfDomain, redirectURI);
        }
        catch (err) {
            this._logger.debug("User isn't authenticated: %s", err);
            return this._getRedirectToCognitoUserPoolResponse(request, redirectURI);
        }
    }
    /**
     *
     * Revokes the refreshToken (which also invalidates the accessToken obtained
     * using that refreshToken) and clears the cookies. Even if the revoke
     * operation fails, clear cookies based on the cookie names present in the
     * request headers.
     *
     * @param event Event that triggers this Lambda function
     * @returns Lambda response
     */
    async handleSignOut(event) {
        this._logger.debug({ msg: 'Handling Lambda@Edge event', event });
        const { request } = event.Records[0].cf;
        const requestParams = (0, querystring_1.parse)(request.querystring);
        const cfDomain = request.headers.host[0].value;
        const redirectURI = requestParams.redirect_uri || `https://${cfDomain}`;
        try {
            const tokens = this._getTokensFromCookie(request.headers.cookie);
            this._logger.info({ msg: 'Revoking tokens', tokens });
            await this._revokeTokens(tokens);
            this._logger.info({ msg: 'Revoked tokens. Clearing cookies...', tokens });
            return this._clearCookies(event, tokens);
        }
        catch (err) {
            this._logger.info({ msg: 'Unable to revoke tokens. Clearing cookies...', path: redirectURI });
            return this._clearCookies(event);
        }
    }
}
exports.Authenticator = Authenticator;
