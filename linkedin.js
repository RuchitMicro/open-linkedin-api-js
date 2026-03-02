/**
 * linkedin-api.js
 * A universal JavaScript port of the open-linkedin-api Python library.
 * Works in: Node.js, Chrome Extensions, and any JS environment with fetch support.
 *
 * Usage:
 *   // Node.js
 *   const { LinkedinClient, Linkedin } = require('./linkedin-api');
 *
 *   // ES Module / Browser / Chrome Extension
 *   import { LinkedinClient, Linkedin } from './linkedin-api.js';
 *
 *   const api = new Linkedin('username@email.com', 'password');
 *   await api.init(); // authenticate
 *   const profile = await api.getProfile({ publicId: 'john-doe' });
 */

// ─── Environment Detection ────────────────────────────────────────────────────

const ENV = (() => {
  if (typeof process !== 'undefined' && process.versions && process.versions.node) return 'node';
  if (typeof chrome !== 'undefined' && chrome.storage) return 'extension';
  return 'browser';
})();

// ─── Storage Abstraction ──────────────────────────────────────────────────────

const Storage = {
  async get(key) {
    if (ENV === 'node') {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const filePath = path.join(os.tmpdir(), `linkedin_cookies_${key}.json`);
        if (fs.existsSync(filePath)) {
          return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
      } catch {}
      return null;
    }
    if (ENV === 'extension') {
      return new Promise(resolve => {
        chrome.storage.local.get([`linkedin_cookies_${key}`], result => {
          resolve(result[`linkedin_cookies_${key}`] || null);
        });
      });
    }
    // Browser
    try {
      const val = localStorage.getItem(`linkedin_cookies_${key}`);
      return val ? JSON.parse(val) : null;
    } catch {
      return null;
    }
  },

  async set(key, value) {
    if (ENV === 'node') {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const os = await import('os');
        const filePath = path.join(os.tmpdir(), `linkedin_cookies_${key}.json`);
        fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
      } catch {}
      return;
    }
    if (ENV === 'extension') {
      return new Promise(resolve => {
        chrome.storage.local.set({ [`linkedin_cookies_${key}`]: value }, resolve);
      });
    }
    try {
      localStorage.setItem(`linkedin_cookies_${key}`, JSON.stringify(value));
    } catch {}
  },
};

// ─── Cookie Utilities ─────────────────────────────────────────────────────────

function parseCookieHeader(cookieHeaders) {
  const cookies = {};
  const headers = Array.isArray(cookieHeaders) ? cookieHeaders : [cookieHeaders];
  for (const header of headers) {
    if (!header) continue;
    const parts = header.split(';');
    const [nameVal] = parts;
    const idx = nameVal.indexOf('=');
    if (idx === -1) continue;
    const name = nameVal.slice(0, idx).trim();
    const value = nameVal.slice(idx + 1).trim();
    // Try to find expires
    let expires = null;
    for (const part of parts.slice(1)) {
      const p = part.trim();
      if (p.toLowerCase().startsWith('expires=')) {
        expires = new Date(p.slice(8)).getTime() / 1000;
      }
      if (p.toLowerCase().startsWith('max-age=')) {
        expires = Date.now() / 1000 + parseInt(p.slice(8), 10);
      }
    }
    cookies[name] = { value, expires };
  }
  return cookies;
}

function serializeCookies(cookies) {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? v.value : v}`)
    .join('; ');
}

function isCookieValid(cookies) {
  const jsessionid = cookies['JSESSIONID'];
  if (!jsessionid) return false;
  const now = Date.now() / 1000;
  const val = typeof jsessionid === 'object' ? jsessionid : { value: jsessionid, expires: null };
  if (val.expires && val.expires < now) return false;
  return true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getIdFromUrn(urn) {
  if (!urn) return null;
  const parts = urn.split(':');
  return parts[parts.length - 1];
}

function getUrnFromRawUpdate(rawString) {
  if (!rawString) return null;
  try {
    return rawString.split('(')[1].split(',')[0];
  } catch {
    return rawString;
  }
}

function generateTrackingId() {
  const arr = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  const bytes = new Uint8Array(arr);
  if (typeof btoa !== 'undefined') {
    return btoa(String.fromCharCode(...bytes));
  }
  return Buffer.from(bytes).toString('base64');
}

function generateTrackingIdAsCharString() {
  const arr = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  return arr.map(i => String.fromCharCode(i)).join('');
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function defaultEvade() {
  return sleep(2000 + Math.floor(Math.random() * 3000));
}

function encodeParams(params, safe = '') {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      const encoded = encodeURIComponent(String(v));
      // Restore characters listed in safe
      const restored = safe.split('').reduce((s, c) => s.split(encodeURIComponent(c)).join(c), encoded);
      return `${encodeURIComponent(k)}=${restored}`;
    })
    .join('&');
}

// ─── LinkedinClient ───────────────────────────────────────────────────────────

class LinkedinClient {
  static LINKEDIN_BASE_URL = 'https://www.linkedin.com';
  static API_BASE_URL = `${LinkedinClient.LINKEDIN_BASE_URL}/voyager/api`;

  static REQUEST_HEADERS = {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36',
    'accept-language': 'en-AU,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
    'x-li-lang': 'en_US',
    'x-restli-protocol-version': '2.0.0',
  };

  static AUTH_REQUEST_HEADERS = {
    'X-Li-User-Agent': 'LIAuthLibrary:0.0.3 com.linkedin.android:4.1.881 Asus_ASUS_Z01QD:android_9',
    'User-Agent': 'ANDROID OS',
    'X-User-Language': 'en',
    'X-User-Locale': 'en_US',
    'Accept-Language': 'en-us',
  };

  constructor({ debug = false, refreshCookies = false, proxies = null, cookiesDir = '' } = {}) {
    this.debug = debug;
    this.refreshCookies = refreshCookies;
    this.proxies = proxies;
    this.cookiesDir = cookiesDir;
    this.cookies = {};
    this.metadata = {};
    this._useCookieCache = !refreshCookies;
  }

  _log(...args) {
    if (this.debug) console.log('[LinkedIn]', ...args);
  }

  _getRequestHeaders(extra = {}) {
    return {
      ...LinkedinClient.REQUEST_HEADERS,
      cookie: serializeCookies(this.cookies),
      'csrf-token': this.cookies['JSESSIONID']
        ? (this.cookies['JSESSIONID'].value || this.cookies['JSESSIONID']).replace(/"/g, '')
        : '',
      ...extra,
    };
  }

  async _requestSessionCookies() {
    this._log('Requesting new session cookies...');
    const res = await fetch(`${LinkedinClient.LINKEDIN_BASE_URL}/uas/authenticate`, {
      headers: LinkedinClient.AUTH_REQUEST_HEADERS,
    });
    const setCookie = res.headers.get('set-cookie') || '';
    return parseCookieHeader(setCookie.split(',').filter(c => c.trim().startsWith('JSESSIONID') || c.includes('=')));
  }

  _setSessionCookies(cookies) {
    this.cookies = { ...this.cookies, ...cookies };
  }

  async authenticate(username, password) {
    if (this._useCookieCache) {
      this._log('Trying cached cookies...');
      const cached = await Storage.get(username);
      if (cached && isCookieValid(cached)) {
        this._log('Using cached cookies');
        this._setSessionCookies(cached);
        await this._fetchMetadata();
        return;
      }
    }
    await this._doAuthenticationRequest(username, password);
    await this._fetchMetadata();
  }

  async _fetchMetadata() {
    try {
      const res = await fetch(LinkedinClient.LINKEDIN_BASE_URL, {
        headers: {
          ...LinkedinClient.AUTH_REQUEST_HEADERS,
          cookie: serializeCookies(this.cookies),
        },
      });
      const html = await res.text();

      // Extract applicationInstance
      const appInstanceMatch = html.match(/name="applicationInstance"[^>]+content="([^"]+)"/);
      if (appInstanceMatch) {
        try {
          this.metadata.clientApplicationInstance = JSON.parse(
            appInstanceMatch[1].replace(/&quot;/g, '"')
          );
        } catch {}
      }

      // Extract clientPageInstanceId
      const pageInstanceMatch = html.match(/name="clientPageInstanceId"[^>]+content="([^"]+)"/);
      if (pageInstanceMatch) {
        this.metadata.clientPageInstanceId = pageInstanceMatch[1];
      }
    } catch (e) {
      this._log('Metadata fetch failed:', e);
    }
  }

  async _doAuthenticationRequest(username, password) {
    const sessionCookies = await this._requestSessionCookies();
    this._setSessionCookies(sessionCookies);

    const jsessionid = this.cookies['JSESSIONID'];
    const jsessionidValue = typeof jsessionid === 'object' ? jsessionid.value : jsessionid;

    const params = new URLSearchParams({
      session_key: username,
      session_password: password,
      JSESSIONID: jsessionidValue,
    });

    const res = await fetch(`${LinkedinClient.LINKEDIN_BASE_URL}/uas/authenticate`, {
      method: 'POST',
      headers: {
        ...LinkedinClient.AUTH_REQUEST_HEADERS,
        'content-type': 'application/x-www-form-urlencoded',
        cookie: serializeCookies(this.cookies),
      },
      body: params.toString(),
    });

    if (res.status === 401) throw new Error('UnauthorizedException');
    if (res.status !== 200) throw new Error(`AuthenticationFailed: HTTP ${res.status}`);

    const data = await res.json();
    if (data && data.login_result !== 'PASS') {
      throw new Error(`ChallengeException: ${data.login_result}`);
    }

    // Merge new cookies
    const setCookie = res.headers.get('set-cookie') || '';
    const newCookies = parseCookieHeader(setCookie.split(','));
    this._setSessionCookies(newCookies);

    // Save to cache
    await Storage.set(username, this.cookies);
  }

  async fetch(uri, { params, baseRequest = false, headers = {} } = {}) {
    await defaultEvade();
    const base = baseRequest ? LinkedinClient.LINKEDIN_BASE_URL : LinkedinClient.API_BASE_URL;
    const qs = params ? `?${encodeParams(params, '(),:*')}` : '';
    const url = `${base}${uri}${qs}`;
    this._log('GET', url);
    const res = await fetch(url, { headers: this._getRequestHeaders(headers) });
    return res;
  }

  async post(uri, { params, body, headers = {}, baseRequest = false } = {}) {
    await defaultEvade();
    const base = baseRequest ? LinkedinClient.LINKEDIN_BASE_URL : LinkedinClient.API_BASE_URL;
    const qs = params ? `?${encodeParams(params, '(),:*')}` : '';
    const url = `${base}${uri}${qs}`;
    this._log('POST', url);
    const res = await fetch(url, {
      method: 'POST',
      headers: this._getRequestHeaders({
        'content-type': 'application/json',
        ...headers,
      }),
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    return res;
  }
}

// ─── Linkedin API ─────────────────────────────────────────────────────────────

class Linkedin {
  static MAX_POST_COUNT = 100;
  static MAX_UPDATE_COUNT = 100;
  static MAX_SEARCH_COUNT = 49;
  static MAX_REPEATED_REQUESTS = 200;

  /**
   * @param {string} username
   * @param {string} password
   * @param {object} [options]
   * @param {boolean} [options.authenticate=true]
   * @param {boolean} [options.refreshCookies=false]
   * @param {boolean} [options.debug=false]
   * @param {object} [options.cookies] - Pre-existing cookie jar
   * @param {string} [options.cookiesDir]
   */
  constructor(username, password, options = {}) {
    this.username = username;
    this.password = password;
    this.options = {
      authenticate: true,
      refreshCookies: false,
      debug: false,
      ...options,
    };
    this.client = new LinkedinClient({
      debug: this.options.debug,
      refreshCookies: this.options.refreshCookies,
      cookiesDir: this.options.cookiesDir || '',
    });
    this._initialized = false;
  }

  /**
   * Must be called before using any API methods (handles authentication).
   */
  async init() {
    if (this._initialized) return;
    if (this.options.authenticate) {
      if (this.options.cookies) {
        this.client._setSessionCookies(this.options.cookies);
      } else {
        await this.client.authenticate(this.username, this.password);
      }
    }
    this._initialized = true;
  }

  _log(...args) {
    if (this.options.debug) console.log('[Linkedin]', ...args);
  }

  async _fetch(uri, opts = {}) {
    if (!this._initialized) await this.init();
    return this.client.fetch(uri, opts);
  }

  async _post(uri, opts = {}) {
    if (!this._initialized) await this.init();
    return this.client.post(uri, opts);
  }

  // ── Profile ──────────────────────────────────────────────────────────────────

  /**
   * Fetch data for a given LinkedIn profile.
   * @param {object} opts
   * @param {string} [opts.publicId]
   * @param {string} [opts.urnId]
   * @returns {Promise<object>}
   */
  async getProfile({ publicId, urnId } = {}) {
    const id = publicId || urnId;
    const res = await this._fetch(`/identity/profiles/${id}/profileView`);
    const data = await res.json();

    if (data && data.status && data.status !== 200) {
      this._log('getProfile failed:', data.message);
      return {};
    }

    const profile = data.profile || {};

    if (profile.miniProfile) {
      const mini = profile.miniProfile;
      if (mini.picture) {
        const vi = mini.picture['com.linkedin.common.VectorImage'];
        if (vi) {
          profile.displayPictureUrl = vi.rootUrl;
          for (const img of vi.artifacts || []) {
            profile[`img_${img.width}_${img.height}`] = img.fileIdentifyingUrlPathSegment;
          }
        }
      }
      profile.profileId = getIdFromUrn(mini.entityUrn);
      profile.profileUrn = mini.entityUrn;
      profile.memberUrn = mini.objectUrn;
      profile.publicId = mini.publicIdentifier;
      delete profile.miniProfile;
    }

    ['defaultLocale', 'supportedLocales', 'versionTag', 'showEducationOnProfileTopCard'].forEach(k => delete profile[k]);

    // Experience
    profile.experience = (data.positionView?.elements || []).map(item => {
      if (item.company?.miniCompany?.logo) {
        const logo = item.company.miniCompany.logo['com.linkedin.common.VectorImage'];
        if (logo) item.companyLogoUrl = logo.rootUrl;
        delete item.company.miniCompany;
      }
      return item;
    });

    // Education
    profile.education = (data.educationView?.elements || []).map(item => {
      if (item.school?.logo) {
        item.school.logoUrl = item.school.logo['com.linkedin.common.VectorImage']?.rootUrl;
        delete item.school.logo;
      }
      return item;
    });

    // Simple arrays
    const simpleViews = {
      languages: 'languageView',
      publications: 'publicationView',
      certifications: 'certificationView',
      volunteer: 'volunteerExperienceView',
      honors: 'honorView',
      projects: 'projectView',
      skills: 'skillView',
    };

    for (const [key, viewKey] of Object.entries(simpleViews)) {
      profile[key] = (data[viewKey]?.elements || []).map(item => {
        const cleaned = { ...item };
        delete cleaned.entityUrn;
        return cleaned;
      });
    }

    profile.urnId = (profile.entityUrn || '').replace('urn:li:fs_profile:', '');
    return profile;
  }

  /**
   * Fetch contact information for a profile.
   */
  async getProfileContactInfo({ publicId, urnId } = {}) {
    const res = await this._fetch(`/identity/profiles/${publicId || urnId}/profileContactInfo`);
    const data = await res.json();

    const contactInfo = {
      emailAddress: data.emailAddress,
      websites: [],
      twitter: data.twitterHandles,
      birthdate: data.birthDateOn,
      ims: data.ims,
      phoneNumbers: data.phoneNumbers || [],
    };

    for (const item of data.websites || []) {
      const cleaned = { ...item };
      if (typeof cleaned.type === 'object') {
        const standard = cleaned.type['com.linkedin.voyager.identity.profile.StandardWebsite'];
        const custom = cleaned.type['com.linkedin.voyager.identity.profile.CustomWebsite'];
        cleaned.label = standard?.category || custom?.label || '';
      }
      delete cleaned.type;
      contactInfo.websites.push(cleaned);
    }

    return contactInfo;
  }

  /**
   * Fetch skills for a profile.
   */
  async getProfileSkills({ publicId, urnId } = {}) {
    const res = await this._fetch(`/identity/profiles/${publicId || urnId}/skills`, {
      params: { count: 100, start: 0 },
    });
    const data = await res.json();
    return (data.elements || []).map(item => {
      const cleaned = { ...item };
      delete cleaned.entityUrn;
      return cleaned;
    });
  }

  /**
   * Fetch profile connections.
   */
  async getProfileConnections(urnId, opts = {}) {
    return this.searchPeople({ connectionOf: urnId, ...opts });
  }

  /**
   * Fetch profile network info.
   */
  async getProfileNetworkInfo(publicProfileId) {
    const res = await this._fetch(`/identity/profiles/${publicProfileId}/networkinfo`, {
      headers: { accept: 'application/vnd.linkedin.normalized+json+2.1' },
    });
    if (res.status !== 200) return {};
    const data = await res.json();
    return data.data || {};
  }

  /**
   * Fetch privacy settings.
   */
  async getProfilePrivacySettings(publicProfileId) {
    const res = await this._fetch(`/identity/profiles/${publicProfileId}/privacySettings`, {
      headers: { accept: 'application/vnd.linkedin.normalized+json+2.1' },
    });
    if (res.status !== 200) return {};
    const data = await res.json();
    return data.data || {};
  }

  /**
   * Fetch member badges.
   */
  async getProfileMemberBadges(publicProfileId) {
    const res = await this._fetch(`/identity/profiles/${publicProfileId}/memberBadges`, {
      headers: { accept: 'application/vnd.linkedin.normalized+json+2.1' },
    });
    if (res.status !== 200) return {};
    const data = await res.json();
    return data.data || {};
  }

  /**
   * Fetch profile experiences (GraphQL version, richer data).
   */
  async getProfileExperiences(urnId) {
    const profileUrn = `urn:li:fsd_profile:${urnId}`;
    const variables = [`profileUrn:${encodeURIComponent(profileUrn)}`, 'sectionType:experience'].join(',');
    const queryId = 'voyagerIdentityDashProfileComponents.7af5d6f176f11583b382e37e5639e69e';

    const res = await this._fetch(
      `/graphql?variables=(${variables})&queryId=${queryId}&includeWebMetadata=true`,
      { headers: { accept: 'application/vnd.linkedin.normalized+json+2.1' } }
    );
    const data = await res.json();

    function parseItem(item, isGroupItem = false) {
      const component = item?.components?.entityComponent;
      if (!component) return null;
      const title = component.titleV2?.text?.text;
      const subtitle = component.subtitle;
      const subtitleText = subtitle?.text || '';
      const subtitleParts = subtitleText.split(' · ');
      const company = isGroupItem ? null : subtitleParts[0] || null;
      const employmentType = isGroupItem ? subtitleParts[0] : subtitleParts[1] || null;
      const location = component.metadata?.text || null;

      const durationText = component.caption?.text || '';
      const durationParts = durationText.split(' · ');
      const dateParts = (durationParts[0] || '').split(' - ');

      const description = component.subComponents?.components?.[0]?.components?.fixedListComponent
        ?.components?.[0]?.components?.textComponent?.text?.text || null;

      return {
        title,
        companyName: company,
        employmentType,
        locationName: location,
        duration: durationParts[1] || null,
        startDate: dateParts[0] || null,
        endDate: dateParts[1] || null,
        description,
      };
    }

    const items = [];
    const topElements = data?.included?.[0]?.components?.elements || [];

    for (const item of topElements) {
      const subComponents = item?.components?.entityComponent?.subComponents;
      const subCompComponents = subComponents?.components?.[0]?.components;
      const pagedListId = subCompComponents?.['*pagedListComponent'] || '';

      if (pagedListId.includes('fsd_profilePositionGroup')) {
        const match = pagedListId.match(/urn:li:fsd_profilePositionGroup:\([A-Za-z0-9]+,[A-Za-z0-9]+\)/);
        if (match) {
          const groupId = match[0];
          const component = item.components?.entityComponent;
          const companyName = component?.titleV2?.text?.text;
          const locationName = component?.caption?.text || null;
          const group = (data.included || []).find(i => (i.entityUrn || '').includes(groupId));
          if (group) {
            for (const groupItem of group.components?.elements || []) {
              const parsed = parseItem(groupItem, true);
              if (parsed) {
                parsed.companyName = companyName;
                parsed.locationName = locationName;
                items.push(parsed);
              }
            }
          }
        }
        continue;
      }

      const parsed = parseItem(item);
      if (parsed) items.push(parsed);
    }

    return items;
  }

  /**
   * Get the current user profile.
   */
  async getUserProfile({ useCache = true } = {}) {
    if (useCache && this.client.metadata.me) return this.client.metadata.me;
    const res = await this._fetch('/me');
    const data = await res.json();
    this.client.metadata.me = data;
    return data;
  }

  /**
   * Remove a connection.
   */
  async removeConnection(publicProfileId) {
    const res = await this._post(
      `/identity/profiles/${publicProfileId}/profileActions?action=disconnect`,
      { headers: { accept: 'application/vnd.linkedin.normalized+json+2.1' } }
    );
    return res.status !== 200;
  }

  /**
   * Unfollow an entity by URN.
   */
  async unfollowEntity(urnId) {
    const res = await this._post('/feed/follows?action=unfollowByEntityUrn', {
      body: { urn: `urn:li:fs_followingInfo:${urnId}` },
      headers: { accept: 'application/vnd.linkedin.normalized+json+2.1' },
    });
    return res.status !== 200;
  }

  // ── Search ────────────────────────────────────────────────────────────────────

  /**
   * Core search method.
   * @param {object} params
   * @param {number} [limit=-1]
   * @param {number} [offset=0]
   */
  async search(params, { limit = -1, offset = 0 } = {}) {
    const count = Linkedin.MAX_SEARCH_COUNT;
    if (limit === null) limit = -1;

    const results = [];
    while (true) {
      const fetchCount = limit > -1 && limit - results.length < count ? limit - results.length : count;

      const defaultParams = {
        count: String(fetchCount),
        filters: 'List()',
        origin: 'GLOBAL_SEARCH_HEADER',
        q: 'all',
        start: results.length + offset,
        queryContext: 'List(spellCorrectionEnabled->true,relatedSearchesEnabled->true,kcardTypes->PROFILE|COMPANY)',
        includeWebMetadata: 'true',
        ...params,
      };

      const keywords = defaultParams.keywords ? `keywords:${defaultParams.keywords},` : '';

      const uri = `/graphql?variables=(start:${defaultParams.start},origin:${defaultParams.origin},query:(${keywords}flagshipSearchIntent:SEARCH_SRP,queryParameters:${defaultParams.filters},includeFiltersInResponse:false))&queryId=voyagerSearchDashClusters.b0928897b71bd00a5a7291755dcd64f0`;

      const res = await this._fetch(uri);
      const data = await res.json();

      const dataClusters = data?.data?.searchDashClustersByAll;
      if (!dataClusters) return [];
      if (dataClusters._type !== 'com.linkedin.restli.common.CollectionResponse') return [];

      const newElements = [];
      for (const cluster of dataClusters.elements || []) {
        if (cluster._type !== 'com.linkedin.voyager.dash.search.SearchClusterViewModel') continue;
        for (const el of cluster.items || []) {
          if (el._type !== 'com.linkedin.voyager.dash.search.SearchItem') continue;
          const e = el.item?.entityResult;
          if (!e) continue;
          if (e._type !== 'com.linkedin.voyager.dash.search.EntityResultViewModel') continue;
          newElements.push(e);
        }
      }

      results.push(...newElements);

      if (
        (limit > -1 && results.length >= limit) ||
        results.length / count >= Linkedin.MAX_REPEATED_REQUESTS ||
        newElements.length === 0
      ) break;

      this._log(`Search results: ${results.length}`);
    }

    return results;
  }

  /**
   * Search for people.
   */
  async searchPeople({
    keywords,
    connectionOf,
    networkDepths,
    currentCompany,
    pastCompanies,
    nonprofitInterests,
    profileLanguages,
    regions,
    industries,
    schools,
    contactInterests,
    serviceCategories,
    includePrivateProfiles = false,
    keywordFirstName,
    keywordLastName,
    keywordTitle,
    keywordCompany,
    keywordSchool,
    networkDepth,
    limit,
    offset,
  } = {}) {
    const filters = ['(key:resultType,value:List(PEOPLE))'];

    if (connectionOf) filters.push(`(key:connectionOf,value:List(${connectionOf}))`);
    if (networkDepths?.length) filters.push(`(key:network,value:List(${networkDepths.join(' | ')}))`);
    else if (networkDepth) filters.push(`(key:network,value:List(${networkDepth}))`);
    if (regions?.length) filters.push(`(key:geoUrn,value:List(${regions.join(' | ')}))`);
    if (industries?.length) filters.push(`(key:industry,value:List(${industries.join(' | ')}))`);
    if (currentCompany?.length) filters.push(`(key:currentCompany,value:List(${currentCompany.join(' | ')}))`);
    if (pastCompanies?.length) filters.push(`(key:pastCompany,value:List(${pastCompanies.join(' | ')}))`);
    if (profileLanguages?.length) filters.push(`(key:profileLanguage,value:List(${profileLanguages.join(' | ')}))`);
    if (nonprofitInterests?.length) filters.push(`(key:nonprofitInterest,value:List(${nonprofitInterests.join(' | ')}))`);
    if (schools?.length) filters.push(`(key:schools,value:List(${schools.join(' | ')}))`);
    if (serviceCategories?.length) filters.push(`(key:serviceCategory,value:List(${serviceCategories.join(' | ')}))`);
    if (keywordFirstName) filters.push(`(key:firstName,value:List(${keywordFirstName}))`);
    if (keywordLastName) filters.push(`(key:lastName,value:List(${keywordLastName}))`);
    if (keywordTitle) filters.push(`(key:title,value:List(${keywordTitle}))`);
    if (keywordCompany) filters.push(`(key:company,value:List(${keywordCompany}))`);
    if (keywordSchool) filters.push(`(key:school,value:List(${keywordSchool}))`);

    const params = { filters: `List(${filters.join(',')})` };
    if (keywords) params.keywords = keywords;

    const data = await this.search(params, { limit, offset });

    return data
      .filter(item => {
        if (!includePrivateProfiles) {
          return item?.entityCustomTrackingInfo?.memberDistance !== 'OUT_OF_NETWORK';
        }
        return true;
      })
      .map(item => ({
        urnId: getIdFromUrn(getUrnFromRawUpdate(item.entityUrn)),
        distance: item?.entityCustomTrackingInfo?.memberDistance || null,
        jobTitle: item?.primarySubtitle?.text || null,
        location: item?.secondarySubtitle?.text || null,
        name: item?.title?.text || null,
      }));
  }

  /**
   * Search for companies.
   */
  async searchCompanies({ keywords, limit, offset } = {}) {
    const filters = ['(key:resultType,value:List(COMPANIES))'];
    const params = {
      filters: `List(${filters.join(',')})`,
      queryContext: 'List(spellCorrectionEnabled->true)',
    };
    if (keywords) params.keywords = keywords;

    const data = await this.search(params, { limit, offset });

    return data
      .filter(item => item?.trackingUrn?.includes('company'))
      .map(item => ({
        urnId: getIdFromUrn(item.trackingUrn),
        name: item?.title?.text || null,
        headline: item?.primarySubtitle?.text || null,
        subline: item?.secondarySubtitle?.text || null,
      }));
  }

  /**
   * Search for jobs.
   */
  async searchJobs({
    keywords,
    companies,
    experience,
    jobType,
    jobTitle,
    industries,
    locationName,
    remote,
    listedAt = 86400,
    distance,
    limit = -1,
    offset = 0,
  } = {}) {
    const count = Linkedin.MAX_SEARCH_COUNT;
    if (limit === null) limit = -1;

    const query = { origin: 'JOB_SEARCH_PAGE_QUERY_EXPANSION' };
    if (keywords) query.keywords = 'KEYWORD_PLACEHOLDER';
    if (locationName) query.locationFallback = 'LOCATION_PLACEHOLDER';

    query.selectedFilters = {};
    if (companies?.length) query.selectedFilters.company = `List(${companies.join(',')})`;
    if (experience?.length) query.selectedFilters.experience = `List(${experience.join(',')})`;
    if (jobType?.length) query.selectedFilters.jobType = `List(${jobType.join(',')})`;
    if (jobTitle?.length) query.selectedFilters.title = `List(${jobTitle.join(',')})`;
    if (industries?.length) query.selectedFilters.industry = `List(${industries.join(',')})`;
    if (distance) query.selectedFilters.distance = `List(${distance})`;
    if (remote?.length) query.selectedFilters.workplaceType = `List(${remote.join(',')})`;
    query.selectedFilters.timePostedRange = `List(r${listedAt})`;
    query.spellCorrectionEnabled = 'true';

    const queryString = JSON.stringify(query)
      .replace(/\s/g, '')
      .replace(/"/g, '')
      .replace('KEYWORD_PLACEHOLDER', keywords || '')
      .replace('LOCATION_PLACEHOLDER', locationName || '')
      .replace(/\{/g, '(')
      .replace(/\}/g, ')');

    const results = [];
    while (true) {
      const fetchCount = limit > -1 && limit - results.length < count ? limit - results.length : count;
      const params = {
        decorationId: 'com.linkedin.voyager.dash.deco.jobs.search.JobSearchCardsCollection-174',
        count: fetchCount,
        q: 'jobSearch',
        query: queryString,
        start: results.length + offset,
      };

      const res = await this._fetch(
        `/voyagerJobsDashJobCards?${encodeParams(params, '(),:*')}`,
        { headers: { accept: 'application/vnd.linkedin.normalized+json+2.1' } }
      );
      const data = await res.json();

      const elements = data.included || [];
      const newData = elements.filter(i => i.$type === 'com.linkedin.voyager.dash.jobs.JobPosting');
      if (!newData.length) break;

      results.push(...newData);
      if (
        (limit > -1 && results.length >= limit) ||
        results.length / count >= Linkedin.MAX_REPEATED_REQUESTS ||
        elements.length === 0
      ) break;

      this._log(`Job results: ${results.length}`);
    }

    return results;
  }

  // ── Posts & Feed ──────────────────────────────────────────────────────────────

  /**
   * Get posts from a profile.
   */
  async getProfilePosts({ publicId, urnId, postCount = 10 } = {}) {
    let profileUrn;
    if (urnId) {
      profileUrn = `urn:li:fsd_profile:${urnId}`;
    } else {
      const profile = await this.getProfile({ publicId });
      profileUrn = (profile.profileUrn || '').replace('fs_miniProfile', 'fsd_profile');
    }

    const params = {
      count: Math.min(postCount, Linkedin.MAX_POST_COUNT),
      start: 0,
      q: 'memberShareFeed',
      moduleKey: 'member-shares:phone',
      includeLongTermHistory: true,
      profileUrn,
    };

    const res = await this._fetch('/identity/profileUpdatesV2', { params });
    const data = await res.json();

    if (data?.status && data.status !== 200) {
      this._log('getProfilePosts failed:', data.message);
      return [{}];
    }

    while (data?.metadata?.paginationToken !== '') {
      if (data.elements.length >= postCount) break;
      params.start += Linkedin.MAX_POST_COUNT;
      params.paginationToken = data.metadata.paginationToken;
      const nextRes = await this._fetch('/identity/profileUpdatesV2', { params });
      const nextData = await nextRes.json();
      data.metadata = nextData.metadata;
      data.elements = [...data.elements, ...nextData.elements];
      data.paging = nextData.paging;
    }

    return data.elements;
  }

  /**
   * Get post comments.
   */
  async getPostComments(postUrn, { commentCount = 100 } = {}) {
    const params = {
      count: Math.min(commentCount, Linkedin.MAX_POST_COUNT),
      start: 0,
      q: 'comments',
      sortOrder: 'RELEVANCE',
      updateId: `activity:${postUrn}`,
    };

    const res = await this._fetch('/feed/comments', { params });
    const data = await res.json();

    if (data?.status && data.status !== 200) return [{}];

    while (data?.metadata?.paginationToken !== '') {
      if (data.elements.length >= commentCount) break;
      params.start += Linkedin.MAX_POST_COUNT;
      params.count = Linkedin.MAX_POST_COUNT;
      params.paginationToken = data.metadata.paginationToken;
      const nextRes = await this._fetch('/feed/comments', { params });
      const nextData = await nextRes.json();
      if (nextData?.status && nextData.status !== 200) break;
      if (!nextData.elements?.length) break;
      data.metadata = nextData.metadata;
      data.elements = [...data.elements, ...nextData.elements];
      data.paging = nextData.paging;
    }

    return data.elements;
  }

  /**
   * Get post reactions.
   */
  async getPostReactions(urnId, { maxResults } = {}, results = []) {
    const params = {
      decorationId: 'com.linkedin.voyager.dash.deco.social.ReactionsByTypeWithProfileActions-13',
      count: 10,
      q: 'reactionType',
      start: results.length,
      threadUrn: urnId,
    };

    const res = await this._fetch('/voyagerSocialDashReactions', { params });
    const data = await res.json();

    if (
      !data.elements?.length ||
      (maxResults != null && results.length >= maxResults)
    ) return results;

    results.push(...data.elements);
    this._log(`Reactions: ${results.length}`);

    return this.getPostReactions(urnId, { maxResults }, results);
  }

  /**
   * React to a post.
   */
  async reactToPost(postUrnId, { reactionType = 'LIKE' } = {}) {
    const res = await this._post('/voyagerSocialDashReactions', {
      params: { threadUrn: `urn:li:activity:${postUrnId}` },
      body: { reactionType },
    });
    return res.status !== 201;
  }

  /**
   * Get feed posts.
   */
  async getFeedPosts({ limit = -1, offset = 0, excludePromotedPosts = true } = {}) {
    const count = Linkedin.MAX_UPDATE_COUNT;
    const actualLimit = limit === -1 ? Linkedin.MAX_UPDATE_COUNT : limit;

    const lPosts = [];
    const lUrns = [];

    while (true) {
      const fetchCount = actualLimit > -1 && actualLimit - lUrns.length < count ? actualLimit - lUrns.length : count;
      const params = { count: String(fetchCount), q: 'chronFeed', start: lUrns.length + offset };

      const res = await this._fetch('/feed/updatesV2', {
        params,
        headers: { accept: 'application/vnd.linkedin.normalized+json+2.1' },
      });
      const json = await res.json();

      const rawPosts = json.included || [];
      const rawUrns = json.data?.['*elements'] || [];

      // Parse posts
      for (const item of rawPosts) {
        const authorName = item?.actor?.name?.text;
        if (authorName) {
          lPosts.push({
            authorName,
            authorProfile: (() => {
              const urn = item?.actor?.urn || '';
              const urnId = urn.split(':').pop();
              if (urn.includes('company')) return `${LinkedinClient.LINKEDIN_BASE_URL}/company/${urnId}`;
              if (urn.includes('member')) return `${LinkedinClient.LINKEDIN_BASE_URL}/in/${urnId}`;
              return urn;
            })(),
            old: item?.actor?.subDescription?.text || '',
            content: item?.commentary?.text?.text || '',
            url: (() => {
              const urn = item?.updateMetadata?.urn;
              return urn ? `${LinkedinClient.LINKEDIN_BASE_URL}/feed/update/${urn}` : '';
            })(),
          });
        }
      }

      for (const raw of rawUrns) {
        try {
          lUrns.push(getUrnFromRawUpdate(raw));
        } catch {}
      }

      if (
        (actualLimit > -1 && lUrns.length >= actualLimit) ||
        lUrns.length / count >= Linkedin.MAX_REPEATED_REQUESTS ||
        rawUrns.length === 0
      ) break;

      this._log(`Feed posts: ${lUrns.length}`);
    }

    // Sort and filter promoted
    if (excludePromotedPosts) {
      const filtered = lPosts.filter(p => !p.old?.includes('Promoted'));
      const sorted = [];
      for (const urn of lUrns) {
        const post = filtered.find(p => p.url?.includes(urn));
        if (post) sorted.push(post);
      }
      return sorted;
    }

    return lPosts;
  }

  // ── Company ───────────────────────────────────────────────────────────────────

  /**
   * Fetch company data.
   */
  async getCompany(publicId) {
    const params = {
      decorationId: 'com.linkedin.voyager.deco.organization.web.WebFullCompanyMain-12',
      q: 'universalName',
      universalName: publicId,
    };
    const res = await this._fetch('/organization/companies', { params });
    const data = await res.json();
    if (data?.status && data.status !== 200) return {};
    return data.elements?.[0] || {};
  }

  /**
   * Fetch school data.
   */
  async getSchool(publicId) {
    return this.getCompany(publicId);
  }

  /**
   * Follow/unfollow a company.
   */
  async followCompany(followingStateUrn, { following = true } = {}) {
    const res = await this._post(`/feed/dash/followingStates/${followingStateUrn}`, {
      body: { patch: { $set: { following } } },
    });
    return res.status !== 200;
  }

  /**
   * Get company updates.
   */
  async getCompanyUpdates({ publicId, urnId, maxResults } = {}, results = []) {
    const params = {
      companyUniversalName: publicId || urnId,
      q: 'companyFeedByUniversalName',
      moduleKey: 'member-share',
      count: Linkedin.MAX_UPDATE_COUNT,
      start: results.length,
    };

    const res = await this._fetch('/feed/updates', { params });
    const data = await res.json();

    if (
      !data.elements?.length ||
      (maxResults != null && results.length >= maxResults)
    ) return results;

    results.push(...data.elements);
    this._log(`Company updates: ${results.length}`);

    return this.getCompanyUpdates({ publicId, urnId, maxResults }, results);
  }

  /**
   * Get profile updates.
   */
  async getProfileUpdates({ publicId, urnId, maxResults } = {}, results = []) {
    const params = {
      profileId: publicId || urnId,
      q: 'memberShareFeed',
      moduleKey: 'member-share',
      count: Linkedin.MAX_UPDATE_COUNT,
      start: results.length,
    };

    const res = await this._fetch('/feed/updates', { params });
    const data = await res.json();

    if (
      !data.elements?.length ||
      (maxResults != null && results.length >= maxResults)
    ) return results;

    results.push(...data.elements);
    return this.getProfileUpdates({ publicId, urnId, maxResults }, results);
  }

  // ── Messaging ─────────────────────────────────────────────────────────────────

  /**
   * Get conversation details for a profile.
   */
  async getConversationDetails(profileUrnId) {
    const res = await this._fetch(
      `/messaging/conversations?keyVersion=LEGACY_INBOX&q=participants&recipients=List(${profileUrnId})`
    );
    const data = await res.json();
    if (!data.elements?.length) return {};
    const item = data.elements[0];
    item.id = getIdFromUrn(item.entityUrn);
    return item;
  }

  /**
   * Get all conversations.
   */
  async getConversations() {
    const res = await this._fetch('/messaging/conversations', {
      params: { keyVersion: 'LEGACY_INBOX' },
    });
    return res.json();
  }

  /**
   * Get a single conversation.
   */
  async getConversation(conversationUrnId) {
    const res = await this._fetch(`/messaging/conversations/${conversationUrnId}/events`);
    return res.json();
  }

  /**
   * Send a message.
   */
  async sendMessage({ messageBody, conversationUrnId, recipients } = {}) {
    if (!conversationUrnId && !recipients) {
      this._log('Must provide conversationUrnId or recipients');
      return true;
    }

    const messageEvent = {
      eventCreate: {
        originToken: generateUUID(),
        value: {
          'com.linkedin.voyager.messaging.create.MessageCreate': {
            attributedBody: { text: messageBody, attributes: [] },
            attachments: [],
          },
        },
        trackingId: generateTrackingIdAsCharString(),
      },
      dedupeByClientGeneratedToken: false,
    };

    if (conversationUrnId && !recipients) {
      const res = await this._post(
        `/messaging/conversations/${conversationUrnId}/events`,
        { params: { action: 'create' }, body: messageEvent }
      );
      return res.status !== 201;
    }

    if (recipients && !conversationUrnId) {
      messageEvent.recipients = recipients;
      messageEvent.subtype = 'MEMBER_TO_MEMBER';
      const payload = { keyVersion: 'LEGACY_INBOX', conversationCreate: messageEvent };
      const res = await this._post('/messaging/conversations', {
        params: { action: 'create' },
        body: payload,
      });
      return res.status !== 201;
    }

    return true;
  }

  /**
   * Mark a conversation as seen.
   */
  async markConversationAsSeen(conversationUrnId) {
    const res = await this._post(`/messaging/conversations/${conversationUrnId}`, {
      body: { patch: { $set: { read: true } } },
    });
    return res.status !== 200;
  }

  // ── Invitations ───────────────────────────────────────────────────────────────

  /**
   * Get pending connection invitations.
   */
  async getInvitations({ start = 0, limit = 3 } = {}) {
    const res = await this._fetch('/relationships/invitationViews', {
      params: { start, count: limit, includeInsights: true, q: 'receivedInvitation' },
    });
    if (res.status !== 200) return [];
    const data = await res.json();
    return (data.elements || []).map(el => el.invitation);
  }

  /**
   * Accept or reject an invitation.
   */
  async replyInvitation(invitationEntityUrn, invitationSharedSecret, { action = 'accept' } = {}) {
    const invitationId = getIdFromUrn(invitationEntityUrn);
    const res = await this._post(`/relationships/invitations/${invitationId}`, {
      params: { action },
      body: {
        invitationId,
        invitationSharedSecret,
        isGenericInvitation: false,
      },
    });
    return res.status === 200;
  }

  /**
   * Add a connection.
   */
  async addConnection(profilePublicId, { message = '', profileUrn = null } = {}) {
    if (message.length > 300) {
      this._log('Message too long. Max 300 characters.');
      return false;
    }

    let urn = profileUrn;
    if (!urn) {
      const profile = await this.getProfile({ publicId: profilePublicId });
      urn = profile.profileUrn?.split(':').pop();
    }

    const payload = {
      invitee: {
        inviteeUnion: { memberProfile: `urn:li:fsd_profile:${urn}` },
      },
      customMessage: message,
    };

    const res = await this._post('/voyagerRelationshipsDashMemberRelationships', {
      params: {
        action: 'verifyQuotaAndCreateV2',
        decorationId: 'com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2',
      },
      body: payload,
      headers: { accept: 'application/vnd.linkedin.normalized+json+2.1' },
    });

    return !res.ok;
  }

  // ── Jobs ──────────────────────────────────────────────────────────────────────

  /**
   * Get a specific job posting.
   */
  async getJob(jobId) {
    const res = await this._fetch(`/jobs/jobPostings/${jobId}`, {
      params: { decorationId: 'com.linkedin.voyager.deco.jobs.web.shared.WebLightJobPosting-23' },
    });
    const data = await res.json();
    if (data?.status && data.status !== 200) return {};
    return data;
  }

  /**
   * Get skills for a job.
   */
  async getJobSkills(jobId) {
    const res = await this._fetch(
      `/voyagerAssessmentsDashJobSkillMatchInsight/urn%3Ali%3Afsd_jobSkillMatchInsight%3A${jobId}`,
      {
        params: {
          decorationId: 'com.linkedin.voyager.dash.deco.assessments.FullJobSkillMatchInsight-17',
        },
      }
    );
    const data = await res.json();
    if (data?.status && data.status !== 200) return {};
    return data;
  }

  // ── Misc ──────────────────────────────────────────────────────────────────────

  /**
   * Get profile view count.
   */
  async getCurrentProfileViews() {
    const res = await this._fetch('/identity/wvmpCards');
    const data = await res.json();
    return data?.elements?.[0]?.value
      ?.['com.linkedin.voyager.identity.me.wvmpOverview.WvmpViewersCard']
      ?.insightCards?.[0]?.value
      ?.['com.linkedin.voyager.identity.me.wvmpOverview.WvmpSummaryInsightCard']
      ?.numViews;
  }

  /**
   * Track an event.
   */
  async track(eventBody, eventInfo) {
    const res = await this._post('/li/track', {
      baseRequest: true,
      body: { eventBody, eventInfo },
      headers: { accept: '*/*', 'content-type': 'text/plain;charset=UTF-8' },
    });
    return res.status !== 200;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

// Universal export: works in Node.js (CJS), ES Modules, and browser globals
const exports = { Linkedin, LinkedinClient, Storage, getIdFromUrn, getUrnFromRawUpdate, generateTrackingId };

if (typeof module !== 'undefined' && module.exports) {
  // Node.js CommonJS
  module.exports = exports;
} else if (typeof window !== 'undefined') {
  // Browser global
  window.LinkedinAPI = exports;
} else if (typeof self !== 'undefined') {
  // Service Worker / Chrome Extension background
  self.LinkedinAPI = exports;
}

// ES Module default export (when bundled or used with type="module")
export { Linkedin, LinkedinClient, Storage, getIdFromUrn, getUrnFromRawUpdate, generateTrackingId };
export default Linkedin;