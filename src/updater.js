// src/updater.js — GitHub Release & Update Checker for Agiva Mod
'use strict';

const https = require('https');
const path = require('path');
const pkg = require('../package.json');

const REPO_OWNER = 'edamameboy';
const REPO_NAME = 'agiva-mod';
const GITHUB_REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const RAW_PACKAGE_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/package.json`;

let updateCache = null;
let lastCheckTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Compare two semver strings: '1.2.1' vs '1.2.2'
 * Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1, v2) {
  const clean = v => (v || '').replace(/^[^\d]*/, '').split('-')[0].trim();
  const p1 = clean(v1).split('.').map(n => parseInt(n, 10) || 0);
  const p2 = clean(v2).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(p1.length, p2.length);

  for (let i = 0; i < len; i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * Perform HTTPS GET request with JSON parsing
 */
function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': `agiva-mod/${pkg.version}`,
        'Accept': 'application/vnd.github.v3+json, application/json',
        ...headers
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          return reject(new Error(`Invalid JSON response (status ${res.statusCode})`));
        }
        resolve({ statusCode: res.statusCode, data: json });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Connection timed out'));
    });

    req.on('error', err => reject(err));
    req.end();
  });
}

/**
 * Check for updates against GitHub Releases & main package.json
 */
async function checkForUpdates({ force = false } = {}) {
  const now = Date.now();
  if (!force && updateCache && (now - lastCheckTime) < CACHE_TTL_MS) {
    return updateCache;
  }

  const currentVersion = pkg.version;
  let result = {
    ok: true,
    currentVersion,
    latestVersion: currentVersion,
    hasUpdate: false,
    releaseName: '',
    releaseNotes: '',
    releaseUrl: `${GITHUB_REPO_URL}/releases`,
    publishedAt: '',
    assets: [],
    portableDownloadUrl: null,
    setupDownloadUrl: null,
    source: 'github-api',
    checkedAt: new Date().toISOString()
  };

  try {
    // 1. Try GitHub Releases API first (best for full changelog & binary assets)
    const apiRes = await fetchJson(GITHUB_API_URL);

    if (apiRes.statusCode === 200 && apiRes.data && apiRes.data.tag_name) {
      const release = apiRes.data;
      const remoteTag = release.tag_name;
      const remoteVersion = remoteTag.replace(/^[^\d]*/, '').trim();

      result.latestVersion = remoteVersion;
      result.releaseName = release.name || `Version ${remoteVersion}`;
      result.releaseNotes = release.body || '';
      result.releaseUrl = release.html_url || `${GITHUB_REPO_URL}/releases/tag/${remoteTag}`;
      result.publishedAt = release.published_at || '';
      result.hasUpdate = compareVersions(remoteVersion, currentVersion) > 0;

      if (Array.isArray(release.assets)) {
        result.assets = release.assets.map(a => ({
          name: a.name,
          size: a.size,
          downloadUrl: a.browser_download_url,
          downloadCount: a.download_count
        }));

        const portable = result.assets.find(a => a.name.toLowerCase().includes('portable'));
        if (portable) result.portableDownloadUrl = portable.downloadUrl;

        const setup = result.assets.find(a => a.name.toLowerCase().includes('setup') || a.name.toLowerCase().endsWith('.exe'));
        if (setup) result.setupDownloadUrl = setup.downloadUrl;
      }

      updateCache = result;
      lastCheckTime = now;
      return result;
    }

    // 2. Fallback to raw package.json if releases are 404 (none published yet) or 403 (rate limited)
    const rawRes = await fetchJson(RAW_PACKAGE_URL);
    if (rawRes.statusCode === 200 && rawRes.data && rawRes.data.version) {
      const remoteVersion = rawRes.data.version;
      result.source = 'raw-package';
      result.latestVersion = remoteVersion;
      result.hasUpdate = compareVersions(remoteVersion, currentVersion) > 0;
      result.releaseName = `Agiva Mod v${remoteVersion}`;
      result.releaseNotes = result.hasUpdate
        ? `Versi baru v${remoteVersion} telah dirilis di GitHub repository.`
        : 'Aplikasi sudah versi terbaru.';

      updateCache = result;
      lastCheckTime = now;
      return result;
    }

    // If both return 404 or nothing found yet
    result.hasUpdate = false;
    result.releaseNotes = 'Belum ada rilis baru di repositori GitHub.';
    updateCache = result;
    lastCheckTime = now;
    return result;

  } catch (err) {
    // If rate limit or offline, still return current version cleanly without crash
    return {
      ok: false,
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      releaseUrl: `${GITHUB_REPO_URL}/releases`,
      error: err.message || 'Gagal terhubung ke GitHub',
      checkedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  checkForUpdates,
  getCurrentVersion: () => pkg.version,
  getRepoUrl: () => GITHUB_REPO_URL
};
