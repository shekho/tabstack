// Todoist sign-in: OAuth 2.0 authorization code flow with PKCE, through
// chrome.identity.launchWebAuthFlow.
//
// The extension registers itself with Todoist as a public client (RFC 7591
// Dynamic Client Registration, token_endpoint_auth_method "none") the first time
// it signs in, so neither the publisher nor users have to create an app or
// handle a client secret. The registration is tied to this install's redirect
// URI and is redone if that changes or Todoist no longer recognizes it.

import { APP_NAME, TODOIST_SCOPES } from '../config.js';
import { t } from './i18n.js';

const AUTHORIZE_URL = 'https://app.todoist.com/oauth/authorize';
const TOKEN_URL = 'https://api.todoist.com/oauth/access_token';
const REGISTER_URL = 'https://api.todoist.com/oauth/register';
const KEY = 'todoistAuth';
const CLIENT_KEY = 'todoistClient';

export class NotSignedInError extends Error {}

const redirectUri = () => chrome.identity.getRedirectURL();

function b64url(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const randomString = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function get(key) {
    return (await chrome.storage.local.get(key))[key] ?? null;
}

async function set(key, value) {
    await chrome.storage.local.set({ [key]: value });
}

async function registerClient() {
    const res = await fetch(REGISTER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_name: APP_NAME,
            redirect_uris: [redirectUri()],
            scope: TODOIST_SCOPES.join(' '),
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
        }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.client_id) throw new Error(json.error_description ?? json.error ?? t('errRegister'));
    const client = { clientId: json.client_id, redirectUri: redirectUri() };
    await set(CLIENT_KEY, client);
    return client;
}

async function getClient({ fresh = false } = {}) {
    const client = await get(CLIENT_KEY);
    if (!fresh && client?.clientId && client.redirectUri === redirectUri()) return client;
    return registerClient();
}

async function tokenRequest(params) {
    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
        throw Object.assign(new Error(json.error_description ?? json.error ?? `Token request failed (${res.status})`), {
            code: json.error,
        });
    }
    return json;
}

function fromTokenResponse(json, prev) {
    return {
        accessToken: json.access_token,
        expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
        // Refresh tokens rotate; a grace-window retry omits the new one.
        refreshToken: json.refresh_token ?? prev?.refreshToken,
        account: prev?.account ?? null,
    };
}

async function authorize(client) {
    const verifier = randomString(48);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = randomString(16);

    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
        client_id: client.clientId,
        response_type: 'code',
        redirect_uri: client.redirectUri,
        scope: TODOIST_SCOPES.join(','),
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
    }).toString();

    const redirect = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true });
    const params = new URL(redirect).searchParams;
    if (params.get('error')) throw Object.assign(new Error(params.get('error')), { code: params.get('error') });
    if (params.get('state') !== state) throw new Error(t('errStateMismatch'));

    return tokenRequest({
        grant_type: 'authorization_code',
        client_id: client.clientId,
        code: params.get('code'),
        redirect_uri: client.redirectUri,
        code_verifier: verifier,
    });
}

/*
    Interactive sign-in. getAccount(accessToken) looks up the user's name and email.
*/
export async function signIn(getAccount) {
    let client = await getClient();
    let json;
    try {
        json = await authorize(client);
    } catch (e) {
        // Todoist no longer knows this registration (for example, it was revoked): register again.
        if (!/invalid_client|incorrect_application_credentials/.test(e.code ?? e.message)) throw e;
        client = await getClient({ fresh: true });
        json = await authorize(client);
    }
    const value = fromTokenResponse(json, null);
    value.account = await getAccount(value.accessToken).catch(() => null);
    await set(KEY, value);
    return value.account;
}

export async function signOut() {
    await chrome.storage.local.remove(KEY);
}

export async function getState() {
    const cur = await get(KEY);
    return { signedIn: !!cur?.accessToken && !cur.needsSignIn, needsSignIn: !!cur?.needsSignIn, account: cur?.account ?? null };
}

async function renew(cur) {
    const client = await get(CLIENT_KEY);
    if (cur.refreshToken && client?.clientId) {
        try {
            const value = fromTokenResponse(
                await tokenRequest({ grant_type: 'refresh_token', client_id: client.clientId, refresh_token: cur.refreshToken }),
                cur
            );
            await set(KEY, value);
            return value;
        } catch (e) {
            console.warn('Token refresh failed.', e);
        }
    }
    await set(KEY, { account: cur.account, needsSignIn: true });
    throw new NotSignedInError(t('errSignInAgain'));
}

// Refresh tokens rotate, so only one renewal may run at a time.
let renewing = null;

export async function getAccessToken({ force = false } = {}) {
    const cur = await get(KEY);
    if (!cur || cur.needsSignIn) throw new NotSignedInError(t('errNotSignedIn'));
    if (!force && cur.accessToken && cur.expiresAt - 60_000 > Date.now()) return cur.accessToken;
    renewing ??= renew(cur).finally(() => {
        renewing = null;
    });
    return (await renewing).accessToken;
}
