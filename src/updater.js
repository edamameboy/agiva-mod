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
 * Perform HTTPS GET request without following redirects, returning status, headers, and text body
 */
function fetchHttpText(url, { timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': `agiva-mod/${pkg.version}`,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
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
 * Parse unique release asset download links from GitHub expanded_assets HTML fragment
 */
function parseAssetsFromExpandedHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const prefix = `/${REPO_OWNER}/${REPO_NAME}/releases/download/`;
  const regex = new RegExp(`href="(${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]+)"`, 'gi');
  const seen = new Set();
  const assets = [];
  let match;

  while ((match = regex.exec(html)) !== null) {
    const relPath = match[1].split('?')[0];
    if (seen.has(relPath)) continue;
    seen.add(relPath);

    const rawName = relPath.split('/').pop() || '';
    let name = rawName;
    try { name = decodeURIComponent(rawName); } catch {}
    if (!name) continue;

    assets.push({
      name,
      size: null,
      downloadUrl: `https://github.com${relPath}`,
      downloadCount: 0
    });
  }
  return assets;
}

/**
 * Select preferred portable & setup .exe download URLs from normalized assets list
 */
function pickReleaseAssets(assets = []) {
  const exeAssets = assets.filter(a => a && typeof a.name === 'string' && a.name.toLowerCase().endsWith('.exe'));
  const portable =
    exeAssets.find(a => a.name.toLowerCase().includes('portable')) ||
    exeAssets.find(a => !a.name.toLowerCase().includes('setup')) ||
    null;
  const setup = exeAssets.find(a => a.name.toLowerCase().includes('setup')) || null;

  return {
    portableDownloadUrl: portable ? portable.downloadUrl : null,
    setupDownloadUrl: setup ? setup.downloadUrl : null
  };
}

/**
 * Fetch release assets from GitHub web expanded_assets endpoint (rate-limit-free)
 */
async function fetchAssetsForTag(tag) {
  if (!tag) return [];
  try {
    const url = `${GITHUB_REPO_URL}/releases/expanded_assets/${encodeURIComponent(tag)}`;
    const res = await fetchHttpText(url, { timeout: 10000 });
    if (res.statusCode === 200 && res.body) {
      return parseAssetsFromExpandedHtml(res.body);
    }
  } catch {}
  return [];
}

/**
 * Resolve latest GitHub release metadata & binaries via web redirect (bypasses REST API rate limits)
 */
async function fetchLatestReleaseFromWeb() {
  try {
    const latestRes = await fetchHttpText(`${GITHUB_REPO_URL}/releases/latest`, { timeout: 10000 });
    const location = latestRes.headers?.location || '';
    const tagMatch = location.match(/\/releases\/tag\/([^/?#]+)/i);
    if (!tagMatch || !tagMatch[1]) return null;

    let remoteTag = tagMatch[1];
    try { remoteTag = decodeURIComponent(remoteTag); } catch {}
    const remoteVersion = remoteTag.replace(/^[^\d]*/, '').trim();
    if (!remoteVersion) return null;

    const releaseUrl = `${GITHUB_REPO_URL}/releases/tag/${encodeURIComponent(remoteTag)}`;
    const assets = await fetchAssetsForTag(remoteTag);
    return { remoteTag, remoteVersion, releaseUrl, assets };
  } catch {
    return null;
  }
}

/**
 * Validate that a download URL belongs to official Agiva Mod GitHub releases
 */
function isAllowedDownloadUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url.trim());
    if (process.env.AGIVA_UPDATER_ALLOW_LOCAL === '1' && parsed.protocol === 'http:') {
      return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    }
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname === 'github.com' && parsed.pathname.startsWith(`/${REPO_OWNER}/${REPO_NAME}/`)) {
      return true;
    }
    if (parsed.hostname === 'objects.githubusercontent.com') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check for updates against GitHub Releases, GitHub Web fallback, & main package.json
 */
async function checkForUpdates({ force = false } = {}) {
  const now = Date.now();
  if (!force && updateCache && (now - lastCheckTime) < CACHE_TTL_MS) {
    return updateCache;
  }

  const currentVersion = pkg.version;
  const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
  const isPackaged = Boolean(paths.isPackaged);
  const canAutoInstall = Boolean(process.env.PORTABLE_EXECUTABLE_FILE || isPackaged);

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
    isPortable,
    isPackaged,
    canAutoInstall,
    source: 'github-api',
    checkedAt: new Date().toISOString()
  };

  try {
    // 1. Try GitHub Releases API first (best for full changelog & metadata)
    try {
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
          const picked = pickReleaseAssets(result.assets);
          result.portableDownloadUrl = picked.portableDownloadUrl;
          result.setupDownloadUrl = picked.setupDownloadUrl;
        }

        updateCache = result;
        lastCheckTime = now;
        return result;
      }
    } catch {}

    // 2. Fallback to rate-limit-free GitHub Web Releases (/releases/latest + /releases/expanded_assets)
    const webRelease = await fetchLatestReleaseFromWeb();
    if (webRelease && webRelease.remoteVersion) {
      result.source = 'github-web';
      result.latestVersion = webRelease.remoteVersion;
      result.hasUpdate = compareVersions(webRelease.remoteVersion, currentVersion) > 0;
      result.releaseName = `Agiva Mod ${webRelease.remoteTag}`;
      result.releaseUrl = webRelease.releaseUrl;
      result.assets = webRelease.assets || [];

      const picked = pickReleaseAssets(result.assets);
      result.portableDownloadUrl = picked.portableDownloadUrl;
      result.setupDownloadUrl = picked.setupDownloadUrl;
      result.releaseNotes = result.hasUpdate
        ? `Rilis terbaru ${webRelease.remoteTag} tersedia di GitHub Releases dan siap dipasang otomatis.`
        : `Aplikasi sudah menggunakan versi terbaru (v${currentVersion}).`;

      updateCache = result;
      lastCheckTime = now;
      return result;
    }

    // 3. Fallback to raw package.json if releases endpoint returned nothing
    const rawRes = await fetchJson(RAW_PACKAGE_URL);
    if (rawRes.statusCode === 200 && rawRes.data && rawRes.data.version) {
      const remoteVersion = rawRes.data.version;
      result.source = 'raw-package';
      result.latestVersion = remoteVersion;
      result.hasUpdate = compareVersions(remoteVersion, currentVersion) > 0;
      result.releaseName = `Agiva Mod v${remoteVersion}`;

      const tagAssets = await fetchAssetsForTag(`v${remoteVersion}`);
      if (tagAssets.length > 0) {
        result.assets = tagAssets;
        const picked = pickReleaseAssets(tagAssets);
        result.portableDownloadUrl = picked.portableDownloadUrl;
        result.setupDownloadUrl = picked.setupDownloadUrl;
        result.releaseUrl = `${GITHUB_REPO_URL}/releases/tag/v${remoteVersion}`;
      }

      result.releaseNotes = result.hasUpdate
        ? `Versi baru v${remoteVersion} telah dirilis di GitHub repository.`
        : 'Aplikasi sudah versi terbaru.';

      updateCache = result;
      lastCheckTime = now;
      return result;
    }

    // If none found yet
    result.hasUpdate = false;
    result.releaseNotes = 'Belum ada rilis baru di repositori GitHub.';
    updateCache = result;
    lastCheckTime = now;
    return result;

  } catch (err) {
    // If offline or connection error, still return current version cleanly without crash
    return {
      ok: false,
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      isPortable,
      isPackaged,
      canAutoInstall,
      releaseUrl: `${GITHUB_REPO_URL}/releases`,
      error: err.message || 'Gagal terhubung ke GitHub',
      checkedAt: new Date().toISOString()
    };
  }
}

/**
 * Download a binary file with HTTP/HTTPS redirect support, inactivity timeout, and truncation guard
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishReject = (err) => {
      if (settled) return;
      settled = true;
      fs.unlink(destPath, () => {});
      reject(err);
    };

    function get(currentUrl, redirectCount = 0) {
      if (redirectCount > 8) {
        return finishReject(new Error('Terlalu banyak pengalihan (redirect limit exceeded)'));
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
            res.resume();
            if (!redirectUrl) return finishReject(new Error('Redirect URL kosong'));
            const nextUrl = new URL(redirectUrl, currentUrl).href;
            return get(nextUrl, redirectCount + 1);
          }

          if (res.statusCode !== 200) {
            res.resume();
            return finishReject(new Error(`Unduhan gagal dengan status HTTP ${res.statusCode}`));
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
              if (settled) return;
              if (totalBytes > 0 && receivedBytes < totalBytes) {
                return finishReject(new Error(`Unduhan terputus (${receivedBytes}/${totalBytes} bytes)`));
              }
              settled = true;
              resolve({ destPath, totalBytes: receivedBytes });
            });
          });

          res.on('error', (err) => {
            fileStream.destroy();
            finishReject(err);
          });

          fileStream.on('error', (err) => {
            fileStream.destroy();
            finishReject(err);
          });
        });

        req.setTimeout(30000, () => {
          req.destroy(new Error('Unduhan timeout karena tidak ada data masuk selama 30 detik'));
        });

        req.on('error', (err) => {
          finishReject(err);
        });
      } catch (err) {
        finishReject(err);
      }
    }

    get(url);
  });
}

/**
 * Escape single quotes inside PowerShell single-quoted string literals
 */
function escapePsSingleQuoted(str) {
  return String(str).replace(/'/g, "''");
}

/**
 * Execute hidden Windows PowerShell handoff script to replace running executable and restart cleanly
 */
function performSelfRestart(newExePath, options = {}) {
  const {
    skipExit = false,
    targetExeOverride = null,
    pidOverride = null
  } = options || {};

  const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
  const targetExe = targetExeOverride || process.env.PORTABLE_EXECUTABLE_FILE || (paths.isPackaged ? process.execPath : null);

  // If running in development (pure Node.js / non-packaged)
  if (!targetExe) {
    return {
      success: true,
      mode: 'dev',
      message: `File update berhasil diunduh ke: ${newExePath}. Silakan jalankan file tersebut secara manual.`,
      newExePath
    };
  }

  const pid = Number(pidOverride) || process.pid;
  const ps1Path = path.join(os.tmpdir(), `agiva_updater_${Date.now()}.ps1`);
  const logPath = path.join(os.tmpdir(), 'agiva_updater_last.log');

  const psLines = [
    `$ErrorActionPreference = 'SilentlyContinue'`,
    `$oldPid = ${pid}`,
    `$newExe = '${escapePsSingleQuoted(newExePath)}'`,
    `$targetExe = '${escapePsSingleQuoted(targetExe)}'`,
    `$selfScript = '${escapePsSingleQuoted(ps1Path)}'`,
    `$logPath = '${escapePsSingleQuoted(logPath)}'`,
    ``,
    `function Write-UpdaterLog([string]$msg) {`,
    `  try {`,
    `    $line = ("{0:o} {1}" -f (Get-Date), $msg)`,
    `    [System.IO.File]::AppendAllText($logPath, $line + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))`,
    `  } catch {}`,
    `}`,
    ``,
    `try { [System.IO.File]::WriteAllText($logPath, '', [System.Text.UTF8Encoding]::new($false)) } catch {}`,
    `Write-UpdaterLog "START pid=$oldPid target=$targetExe"`,
    ``,
    `$deadline = (Get-Date).AddSeconds(30)`,
    `while ((Get-Date) -lt $deadline) {`,
    `  $proc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue`,
    `  if (-not $proc) { break }`,
    `  Start-Sleep -Milliseconds 300`,
    `}`,
    `Write-UpdaterLog "WAIT_DONE pid=$oldPid"`,
    ``,
    `# Wait briefly for NSIS portable wrapper cleanup / lock release`,
    `Start-Sleep -Milliseconds 1000`,
    ``,
    `$expectedLen = (Get-Item -LiteralPath $newExe -ErrorAction SilentlyContinue).Length`,
    `$replaced = $false`,
    `for ($i = 1; $i -le 40; $i++) {`,
    `  try {`,
    `    Copy-Item -LiteralPath $newExe -Destination $targetExe -Force -ErrorAction Stop`,
    `    $actualLen = (Get-Item -LiteralPath $targetExe -ErrorAction Stop).Length`,
    `    if ($expectedLen -gt 0 -and $actualLen -eq $expectedLen) {`,
    `      $replaced = $true`,
    `      Write-UpdaterLog "COPY_OK attempt=$i bytes=$actualLen"`,
    `      break`,
    `    }`,
    `  } catch {`,
    `    if ($i -eq 40) { Write-UpdaterLog "COPY_ERR $($_.Exception.Message)" }`,
    `  }`,
    `  Start-Sleep -Milliseconds 500`,
    `}`,
    ``,
    `if (-not $replaced) {`,
    `  try {`,
    `    Move-Item -LiteralPath $newExe -Destination $targetExe -Force -ErrorAction Stop`,
    `    $actualLen = (Get-Item -LiteralPath $targetExe -ErrorAction Stop).Length`,
    `    if ($expectedLen -gt 0 -and $actualLen -eq $expectedLen) {`,
    `      $replaced = $true`,
    `      Write-UpdaterLog "MOVE_OK bytes=$actualLen"`,
    `    }`,
    `  } catch {`,
    `    Write-UpdaterLog "MOVE_ERR $($_.Exception.Message)"`,
    `  }`,
    `}`,
    ``,
    `if ($replaced -and (Test-Path -LiteralPath $newExe)) {`,
    `  Remove-Item -LiteralPath $newExe -Force -ErrorAction SilentlyContinue`,
    `}`,
    ``,
    `if ($replaced) {`,
    `  Start-Sleep -Milliseconds 500`,
    `  $workDir = [System.IO.Path]::GetDirectoryName($targetExe)`,
    `  for ($j = 1; $j -le 5; $j++) {`,
    `    try {`,
    `      $psi = New-Object System.Diagnostics.ProcessStartInfo`,
    `      $psi.FileName = $targetExe`,
    `      $psi.WorkingDirectory = $workDir`,
    `      $psi.UseShellExecute = $true`,
    `      [System.Diagnostics.Process]::Start($psi) | Out-Null`,
    `      Write-UpdaterLog "LAUNCH_OK attempt=$j"`,
    `      break`,
    `    } catch {`,
    `      Write-UpdaterLog "LAUNCH_RETRY=$j err=$($_.Exception.Message)"`,
    `      Start-Sleep -Milliseconds 800`,
    `    }`,
    `  }`,
    `} else {`,
    `  Write-UpdaterLog "ABORT_RELAUNCH replaced=false"`,
    `}`,
    ``,
    `if ($selfScript -and (Test-Path -LiteralPath $selfScript)) {`,
    `  Remove-Item -LiteralPath $selfScript -Force -ErrorAction SilentlyContinue`,
    `}`,
    ``
  ];

  // Windows PowerShell 5.1 parses UTF-8 with BOM + CRLF most reliably
  fs.writeFileSync(ps1Path, '\uFEFF' + psLines.join('\r\n'), 'utf8');

  const psExeCandidate = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const psExe = fs.existsSync(psExeCandidate) ? psExeCandidate : 'powershell.exe';
  const argStr = `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${ps1Path}"`;
  const launchScript = `Start-Process -WindowStyle Hidden -FilePath '${escapePsSingleQuoted(psExe)}' -ArgumentList '${escapePsSingleQuoted(argStr)}'`;
  const encodedCmd = Buffer.from(launchScript, 'utf16le').toString('base64');

  // Spawning powershell.exe directly with detached:true exits silently before executing -File
  // when stdio is ignored. Using a quick non-detached launcher with Start-Process -WindowStyle Hidden
  // detaches an independent hidden updater process with zero console window popup.
  const child = spawn(psExe, [
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle', 'Hidden',
    '-EncodedCommand', encodedCmd
  ], {
    detached: false,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();

  if (!skipExit) {
    let quitStarted = false;
    const triggerQuit = () => {
      if (quitStarted) return;
      quitStarted = true;
      if (global.agivaElectronBridge && typeof global.agivaElectronBridge.quit === 'function') {
        global.agivaElectronBridge.quit();
      } else {
        process.exit(0);
      }
    };

    // Quit right after launcher spawns the independent updater (with 1.5s fallback + 3s hard-exit failsafe)
    child.on('exit', () => setTimeout(triggerQuit, 200));
    setTimeout(triggerQuit, 1500);
    setTimeout(() => {
      process.exit(0);
    }, 3000);
  }

  return {
    success: true,
    mode: isPortable ? 'portable' : 'packaged',
    targetExe,
    scriptPath: ps1Path
  };
}

/**
 * Verify downloaded Windows PE executable file has valid MZ magic header and non-trivial size
 */
function assertValidWindowsExe(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error('File pembaruan tidak ditemukan setelah unduhan.');
  }
  const stat = fs.statSync(filePath);
  if (!stat || stat.size < 64) {
    throw new Error('File pembaruan rusak atau ukurannya terlalu kecil.');
  }
  const header = Buffer.alloc(2);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, header, 0, 2, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (header[0] !== 0x4D || header[1] !== 0x5A) {
    throw new Error('File yang diunduh bukan executable Windows (.exe) yang valid.');
  }
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

  if (!isAllowedDownloadUrl(targetUrl)) {
    throw new Error('URL unduhan tidak diizinkan (harus dari rilis resmi GitHub Agiva Mod).');
  }

  isDownloading = true;
  const tempDest = path.join(os.tmpdir(), `agiva_update_${Date.now()}.exe`);

  try {
    await downloadFile(targetUrl, tempDest, onProgress);
    assertValidWindowsExe(tempDest);
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
  isAllowedDownloadUrl,
  getCurrentVersion: () => pkg.version,
  getRepoUrl: () => GITHUB_REPO_URL
};
