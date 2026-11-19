// src/updater.js — GitHub Release & Update Checker for Agiva Mod
'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const paths = require('./paths');
const pkg = require('../package.json');

const REPO_OWNER = 'edamameboy';
const REPO_NAME = 'agiva-mod';
const GITHUB_REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const RAW_PACKAGE_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/package.json`;

let updateCache = null;
let lastCheckTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let isDownloading = false;

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

        const setup = result.assets.find(a => !a.name.toLowerCase().includes('portable') && (a.name.toLowerCase().includes('setup') || a.name.toLowerCase().endsWith('.exe')));
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

/**
 * Download a binary file with HTTP/HTTPS redirect support and progress streaming
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    function get(currentUrl, redirectCount = 0) {
      if (redirectCount > 8) {
        return reject(new Error('Terlalu banyak pengalihan (redirect limit exceeded)'));
      }
      try {
        const parsed = new URL(currentUrl);
        const client = parsed.protocol === 'http:' ? http : https;

        const req = client.get(currentUrl, {
          headers: {
            'User-Agent': `agiva-mod/${pkg.version}`,
            'Accept': 'application/octet-stream, */*'
          }
        }, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
            const redirectUrl = res.headers.location;
            if (!redirectUrl) return reject(new Error('Redirect URL kosong'));
            return get(redirectUrl, redirectCount + 1);
          }

          if (res.statusCode !== 200) {
            return reject(new Error(`Unduhan gagal dengan status HTTP ${res.statusCode}`));
          }

          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let receivedBytes = 0;
          let lastReportTime = 0;
          const fileStream = fs.createWriteStream(destPath);

          res.on('data', (chunk) => {
            receivedBytes += chunk.length;
            fileStream.write(chunk);

            const now = Date.now();
            if (onProgress && totalBytes > 0 && (now - lastReportTime > 150 || receivedBytes >= totalBytes)) {
              lastReportTime = now;
              const percent = Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
              onProgress({
                percent,
                receivedBytes,
                totalBytes,
                receivedMB: (receivedBytes / (1024 * 1024)).toFixed(1),
                totalMB: (totalBytes / (1024 * 1024)).toFixed(1)
              });
            }
          });

          res.on('end', () => {
            fileStream.end(() => {
              resolve({ destPath, totalBytes: receivedBytes });
            });
          });

          res.on('error', (err) => {
            fileStream.destroy();
            fs.unlink(destPath, () => {});
            reject(err);
          });

          fileStream.on('error', (err) => {
            fileStream.destroy();
            fs.unlink(destPath, () => {});
            reject(err);
          });
        });

        req.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    }

    get(url);
  });
}

/**
 * Execute Windows handoff batch script to replace current running executable and restart
 */
function performSelfRestart(newExePath) {
  const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
  const targetExe = process.env.PORTABLE_EXECUTABLE_FILE || (paths.isPackaged ? process.execPath : null);

  // If running in development (pure Node.js / non-packaged)
  if (!targetExe) {
    return {
      success: true,
      mode: 'dev',
      message: `File update berhasil diunduh ke: ${newExePath}. Silakan jalankan file tersebut secara manual.`,
      newExePath
    };
  }

  const pid = process.pid;
  const batPath = path.join(os.tmpdir(), `agiva_updater_${Date.now()}.bat`);

  // Write handoff batch script with spaces-safe quoting & file-lock retry loop
  const batContent = `@echo off
chcp 65001 > nul
set "OLD_PID=${pid}"
set "NEW_EXE=${newExePath}"
set "TARGET_EXE=${targetExe}"

:: Beri jeda agar aplikasi lama selesai menutup
timeout /t 2 /nobreak > nul

:wait_loop
tasklist /fi "pid eq %OLD_PID%" 2>nul | find "%OLD_PID%" > nul
if %ERRORLEVEL% equ 0 (
    timeout /t 1 /nobreak > nul
    goto wait_loop
)

:: Timpa executable lama dengan file versi baru (retry hingga 15x jika masih terkunci wrapper portable)
set RETRY=0
:copy_retry
copy /y "%NEW_EXE%" "%TARGET_EXE%" > nul 2>&1
if errorlevel 1 (
    set /a RETRY+=1
    if %RETRY% lss 15 (
        timeout /t 1 /nobreak > nul
        goto copy_retry
    )
    move /y "%NEW_EXE%" "%TARGET_EXE%" > nul 2>&1
)

:: Hapus file download sementara jika file sudah disalin
if exist "%NEW_EXE%" del /f /q "%NEW_EXE%" > nul 2>&1

:: Jalankan aplikasi versi terbaru
start "" "%TARGET_EXE%"

:: Hapus batch script ini
del "%~f0"
`;

  fs.writeFileSync(batPath, batContent, 'utf8');

  // Spawn detached process
  const child = spawn('cmd.exe', ['/c', batPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();

  // Gracefully quit application after short buffer
  setTimeout(() => {
    if (global.agivaElectronBridge && typeof global.agivaElectronBridge.quit === 'function') {
      global.agivaElectronBridge.quit();
    } else {
      process.exit(0);
    }
  }, 1000);

  return {
    success: true,
    mode: isPortable ? 'portable' : 'packaged',
    targetExe,
    batPath
  };
}

/**
 * High-level download and apply update
 */
async function downloadAndApplyUpdate(targetUrl, onProgress) {
  if (isDownloading) {
    throw new Error('Proses pengunduhan pembaruan sedang berlangsung!');
  }

  if (!targetUrl) {
    throw new Error('URL unduhan pembaruan tidak ditemukan');
  }

  isDownloading = true;
  const tempDest = path.join(os.tmpdir(), `agiva_update_${Date.now()}.exe`);

  try {
    await downloadFile(targetUrl, tempDest, onProgress);
    isDownloading = false;
    const restartResult = performSelfRestart(tempDest);
    return restartResult;
  } catch (err) {
    isDownloading = false;
    try { fs.unlinkSync(tempDest); } catch {}
    throw err;
  }
}

module.exports = {
  checkForUpdates,
  downloadAndApplyUpdate,
  performSelfRestart,
  getCurrentVersion: () => pkg.version,
  getRepoUrl: () => GITHUB_REPO_URL
};
