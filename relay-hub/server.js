// relay-hub/server.js — Agiva Multi-Creator Relay Hub (Standalone ZimaOS Custom App & Attachable Express/WS Module)
'use strict';

const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

function sanitizeSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

/**
 * Checks whether a proxied subpath under /c/:creatorId/<subPath> is permitted on the public internet.
 * Maps convenience aliases like /webhook/:platform -> /api/webhook/donation/:platform
 * and /overlay.css -> /overlay/overlay.css so /c/:creatorId/overlay works with or without trailing slash.
 */
function resolveSafeCreatorTarget(method, rawSubPath, rawSearch = '') {
  const m = String(method || 'GET').toUpperCase();
  let p = String(rawSubPath || '/').trim();
  if (!p.startsWith('/')) p = '/' + p;

  if (m === 'OPTIONS') {
    return { allowed: true, targetPath: p + rawSearch, isOptions: true };
  }

  // Root of creator (/c/:creatorId or /c/:creatorId/) -> serve /overlay/
  if (p === '/' || p === '/overlay') {
    p = '/overlay/';
  } else if (p === '/overlay.css' || p === '/overlay.js') {
    p = '/overlay' + p;
  } else if (p === '/remote') {
    p = '/remote/';
  } else if (p.startsWith('/webhook/')) {
    // Short alias: /c/:creatorId/webhook/saweria -> /api/webhook/donation/saweria
    const plat = p.slice('/webhook/'.length);
    p = `/api/webhook/donation/${plat}`;
  }

  if (m === 'GET' || m === 'HEAD') {
    const okGet =
      p.startsWith('/overlay/') ||
      p.startsWith('/remote/') ||
      p.startsWith('/sounds/') ||
      p.startsWith('/media/') ||
      p.startsWith('/api/tts/audio/') ||
      p === '/api/widgets' ||
      p === '/api/spotify' ||
      p === '/api/config' ||
      p === '/api/status' ||
      p === '/api/remote/deck' ||
      p === '/favicon.ico';
    if (okGet) {
      return { allowed: true, targetPath: p + rawSearch };
    }
  }

  if (m === 'POST') {
    const okPost =
      p.startsWith('/api/webhook/donation/') ||
      p === '/api/remote/auth' ||
      p === '/api/remote/action' ||
      p === '/api/spotify/skip';
    if (okPost) {
      return { allowed: true, targetPath: p + rawSearch };
    }
  }

  return { allowed: false, targetPath: p + rawSearch };
}

function createRelayHub({ relaySecret = process.env.RELAY_SECRET || '' } = {}) {
  // creatorId -> { ws, creatorId, connectedAt, lastSeenAt, appVersion, lastState, viewers: Set<WebSocket>, pendingHttp: Map<reqId, { res, timer }> }
  const creators = new Map();
  const agentWss = new WebSocket.Server({ noServer: true });
  const viewerWss = new WebSocket.Server({ noServer: true });

  function notifyViewerCount(entry) {
    if (!entry || !entry.ws || entry.ws.readyState !== WebSocket.OPEN) return;
    try {
      entry.ws.send(JSON.stringify({
        type: 'viewer_count',
        viewers: entry.viewers.size
      }));
    } catch {}
  }

  function cleanupCreatorEntry(entry, wsToMatch) {
    if (!entry) return;
    if (wsToMatch && entry.ws !== wsToMatch) return;
    for (const [, pending] of entry.pendingHttp.entries()) {
      clearTimeout(pending.timer);
      try {
        if (!pending.res.headersSent) {
          pending.res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          pending.res.end(JSON.stringify({ ok: false, error: 'Creator disconnected during request' }));
        }
      } catch {}
    }
    entry.pendingHttp.clear();
    if (entry.creatorId && creators.get(entry.creatorId) === entry) {
      creators.delete(entry.creatorId);
    }
  }

  agentWss.on('connection', (ws) => {
    let currentEntry = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'register') {
          if (relaySecret && String(msg.secret || '') !== String(relaySecret)) {
            ws.send(JSON.stringify({ type: 'registered', ok: false, error: 'Relay Secret tidak sesuai.' }));
            return;
          }
          const slug = sanitizeSlug(msg.creatorId);
          if (!slug || slug.length < 2) {
            ws.send(JSON.stringify({ type: 'registered', ok: false, error: 'Creator ID / Username tidak valid.' }));
            return;
          }

          // If this socket was previously registered under a different slug, migrate viewers
          let existingViewers = new Set();
          if (currentEntry && currentEntry.creatorId && currentEntry.creatorId !== slug) {
            existingViewers = currentEntry.viewers;
            if (creators.get(currentEntry.creatorId) === currentEntry) {
              creators.delete(currentEntry.creatorId);
            }
          }

          const prevForSlug = creators.get(slug);
          if (prevForSlug && prevForSlug.ws !== ws) {
            for (const v of prevForSlug.viewers) existingViewers.add(v);
            try {
              prevForSlug.ws.removeAllListeners();
              prevForSlug.ws.on('error', () => {});
              prevForSlug.ws.close();
            } catch {}
            cleanupCreatorEntry(prevForSlug, prevForSlug.ws);
          }

          currentEntry = {
            ws,
            creatorId: slug,
            connectedAt: currentEntry?.connectedAt || Date.now(),
            lastSeenAt: Date.now(),
            appVersion: String(msg.appVersion || '1.7.5'),
            lastState: msg.initialState || currentEntry?.lastState || null,
            viewers: existingViewers,
            pendingHttp: currentEntry?.pendingHttp || new Map()
          };
          creators.set(slug, currentEntry);

          ws.send(JSON.stringify({
            type: 'registered',
            ok: true,
            creatorId: slug
          }));
          notifyViewerCount(currentEntry);
          return;
        }

        if (!currentEntry) return;
        currentEntry.lastSeenAt = Date.now();

        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', viewers: currentEntry.viewers.size }));
          return;
        }

        if (msg.type === 'broadcast' && msg.data) {
          if (msg.data.type === 'state') {
            currentEntry.lastState = msg.data;
          }
          const payload = JSON.stringify(msg.data);
          for (const viewer of currentEntry.viewers) {
            if (viewer.readyState === WebSocket.OPEN) {
              try { viewer.send(payload); } catch {}
            }
          }
          return;
        }

        if (msg.type === 'http_proxy_res' && msg.reqId) {
          const pending = currentEntry.pendingHttp.get(msg.reqId);
          if (!pending) return;
          currentEntry.pendingHttp.delete(msg.reqId);
          clearTimeout(pending.timer);

          const statusCode = Number(msg.statusCode) || 200;
          const headers = {
            'Access-Control-Allow-Origin': '*',
            ...(msg.headers || {})
          };
          const bodyBuf = msg.bodyBase64 ? Buffer.from(msg.bodyBase64, 'base64') : Buffer.alloc(0);
          headers['Content-Length'] = Buffer.byteLength(bodyBuf);
          try {
            if (!pending.res.headersSent) {
              pending.res.writeHead(statusCode, headers);
              pending.res.end(bodyBuf);
            }
          } catch {}
        }
      } catch {}
    });

    ws.on('close', () => {
      if (currentEntry) cleanupCreatorEntry(currentEntry, ws);
    });
    ws.on('error', () => {});
  });

  viewerWss.on('connection', (ws, req, creatorId) => {
    const slug = sanitizeSlug(creatorId);
    const entry = creators.get(slug);
    if (!entry) {
      try {
        ws.send(JSON.stringify({ type: 'relay_status', online: false, creatorId: slug }));
        ws.close();
      } catch {}
      return;
    }

    entry.viewers.add(ws);
    notifyViewerCount(entry);

    if (entry.lastState) {
      try { ws.send(JSON.stringify(entry.lastState)); } catch {}
    }

    ws.on('close', () => {
      entry.viewers.delete(ws);
      notifyViewerCount(entry);
    });
    ws.on('error', () => {});
  });

  function handleUpgrade(req, socket, head) {
    let pathname = '/';
    try {
      const u = new URL(req.url || '/', 'http://localhost');
      pathname = u.pathname;
    } catch {}

    if (pathname === '/relay-agent') {
      agentWss.handleUpgrade(req, socket, head, (ws) => {
        agentWss.emit('connection', ws, req);
      });
      return true;
    }

    const match = pathname.match(/^\/c\/([^/]+)\/ws$/);
    if (match) {
      const creatorId = decodeURIComponent(match[1]);
      viewerWss.handleUpgrade(req, socket, head, (ws) => {
        viewerWss.emit('connection', ws, req, creatorId);
      });
      return true;
    }

    return false;
  }

  function handleCreatorHttpRequest(req, res, creatorId, subPath, searchStr = '', preParsedBodyBuf = null) {
    const slug = sanitizeSlug(creatorId);
    const check = resolveSafeCreatorTarget(req.method, subPath, searchStr);

    if (check.isOptions) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Agiva-Pin'
      });
      return res.end();
    }

    if (!check.allowed) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: false,
        error: 'Forbidden: Demi keamanan creator, akses /dashboard dan Admin API diblokir di Relay Hub publik.'
      }));
    }

    const entry = creators.get(slug);
    if (!entry || !entry.ws || entry.ws.readyState !== WebSocket.OPEN) {
      const isOverlayHtml = check.targetPath.startsWith('/overlay/');
      if (isOverlayHtml && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="5">
  <title>Agiva Overlay — Menunggu Creator @${slug}</title>
  <style>body{margin:0;background:transparent;font-family:system-ui,sans-serif;color:rgba(255,255,255,0.65);display:flex;align-items:center;justify-content:center;height:100vh;font-size:12px}</style>
</head>
<body>
  <div>⏳ Menunggu aplikasi Agiva Mod milik <strong>@${slug}</strong> aktif... (Auto-connect dalam 5 detik)</div>
</body>
</html>`);
      }

      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: false,
        error: `Creator "${slug}" sedang offline (aplikasi Agiva Mod belum terbuka di PC creator).`
      }));
    }

    const dispatchProxy = (bodyBuf) => {
      const reqId = crypto.randomBytes(8).toString('hex');
      const timer = setTimeout(() => {
        entry.pendingHttp.delete(reqId);
        if (!res.headersSent) {
          res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Relay request timeout dari PC creator.' }));
        }
      }, 12000);

      entry.pendingHttp.set(reqId, { res, timer });

      const forwardHeaders = {};
      for (const k of ['content-type', 'accept', 'x-agiva-pin', 'user-agent', 'x-signature', 'saweria-callback-signature']) {
        if (req.headers[k]) forwardHeaders[k] = req.headers[k];
      }

      try {
        entry.ws.send(JSON.stringify({
          type: 'http_proxy_req',
          reqId,
          method: req.method,
          path: check.targetPath,
          headers: forwardHeaders,
          clientIp: req.headers['cf-connecting-ip'] || req.socket?.remoteAddress || '',
          bodyBase64: bodyBuf && bodyBuf.length > 0 ? bodyBuf.toString('base64') : ''
        }));
      } catch (e) {
        clearTimeout(timer);
        entry.pendingHttp.delete(reqId);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      }
    };

    if (preParsedBodyBuf !== null) {
      dispatchProxy(preParsedBodyBuf);
    } else if (req.body && typeof req.body === 'object' && !(req.body instanceof Buffer)) {
      // Express json middleware already parsed req.body
      const buf = Object.keys(req.body).length > 0 ? Buffer.from(JSON.stringify(req.body), 'utf8') : Buffer.alloc(0);
      dispatchProxy(buf);
    } else {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => dispatchProxy(Buffer.concat(chunks)));
    }
  }

  function getHubSummary() {
    const list = [];
    for (const [id, entry] of creators.entries()) {
      list.push({
        creatorId: id,
        connectedAt: entry.connectedAt,
        lastSeenAt: entry.lastSeenAt,
        appVersion: entry.appVersion,
        overlayViewers: entry.viewers.size
      });
    }
    return {
      ok: true,
      service: 'agiva-multi-creator-relay-hub',
      onlineCreators: list.length,
      creators: list
    };
  }

  function renderStatusHtml(hostHeader = 'widget.cornermoji.site') {
    const summary = getHubSummary();
    return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>🌐 Agiva Multi-Creator Relay Hub — ZimaOS</title>
  <style>
    body{margin:0;min-height:100vh;background:#0b0f19;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{max-width:640px;width:100%;background:#131b2e;border:2px solid #26324d;border-radius:18px;padding:28px;box-shadow:0 20px 50px rgba(0,0,0,.5)}
    .badge{display:inline-block;background:#10b981;color:#042f2e;font-weight:800;font-size:12px;padding:4px 12px;border-radius:999px;margin-bottom:12px}
    h1{margin:0 0 8px;font-size:22px}
    p{margin:0 0 18px;color:#94a3b8;font-size:14px;line-height:1.5}
    .box{background:#0b0f19;border:1px solid #1e293b;border-radius:12px;padding:14px;margin-bottom:14px;font-size:13px}
    code{color:#38bdf8;font-family:ui-monospace,monospace}
    .creator-pill{display:inline-flex;align-items:center;gap:6px;background:#1e293b;padding:6px 12px;border-radius:8px;margin:4px;font-size:12px;font-weight:700}
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">● RELAY HUB ONLINE (${summary.onlineCreators} CREATOR AKTIF)</span>
    <h1>🌐 Agiva Multi-Creator Relay Hub</h1>
    <p>Server Relay ZimaOS aktif. Semua creator yang membuka aplikasi <strong>Agiva Mod</strong> otomatis tersambung ke domain ini tanpa perlu setting Cloudflare Tunnel di PC masing-masing.</p>
    <div class="box">
      <strong>📌 Format URL Otomatis Per Creator:</strong><br><br>
      • <strong>Overlay OBS / TikTok Live Studio:</strong><br>
      <code>https://${hostHeader}/c/&lt;username_tiktok&gt;/overlay?widget=timer</code><br><br>
      • <strong>Webhook Saweria / SociaBuzz / Trakteer / BagiBagi:</strong><br>
      <code>https://${hostHeader}/c/&lt;username_tiktok&gt;/api/webhook/donation/saweria</code><br><br>
      • <strong>Mobile Touch Stream Deck (PIN):</strong><br>
      <code>https://${hostHeader}/c/&lt;username_tiktok&gt;/remote</code>
    </div>
    <div class="box">
      <strong>🟢 Creator yang Sedang Online (${summary.onlineCreators}):</strong><br>
      ${summary.creators.length === 0
        ? '<span style="color:#64748b">Belum ada PC creator yang terhubung saat ini.</span>'
        : summary.creators.map(c => `<a class="creator-pill" href="/c/${encodeURIComponent(c.creatorId)}/overlay" style="color:#fff;text-decoration:none;">🟢 @${c.creatorId} <span style="color:#94a3b8;font-weight:400;">(${c.overlayViewers} overlay)</span></a>`).join('')}
    </div>
  </div>
</body>
</html>`;
  }

  return {
    creators,
    handleUpgrade,
    handleCreatorHttpRequest,
    getHubSummary,
    renderStatusHtml
  };
}

// ─── Standalone ZimaOS Server Mode ────────────────────────────────────────────
if (require.main === module) {
  const PORT = parseInt(process.env.PORT || process.env.DASHBOARD_PORT) || 7030;
  const hub = createRelayHub();

  const server = http.createServer((req, res) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    } catch {
      res.writeHead(400);
      return res.end('Bad Request');
    }

    const pathname = parsedUrl.pathname;
    const search = parsedUrl.search || '';

    if (pathname === '/health' || pathname === '/api/relay/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(hub.getHubSummary()));
    }

    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(hub.renderStatusHtml(req.headers.host || 'widget.cornermoji.site'));
    }

    const cMatch = pathname.match(/^\/c\/([^/]+)(\/.*)?$/);
    if (cMatch) {
      const creatorId = decodeURIComponent(cMatch[1]);
      const subPath = cMatch[2] || '/';
      return hub.handleCreatorHttpRequest(req, res, creatorId, subPath, search);
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Route tidak ditemukan. Gunakan /c/<username_creator>/overlay atau /c/<username_creator>/api/webhook/donation/saweria' }));
  });

  server.on('upgrade', (req, socket, head) => {
    const handled = hub.handleUpgrade(req, socket, head);
    if (!handled) {
      socket.destroy();
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║   🌐 Agiva Multi-Creator Relay Hub (ZimaOS) — Port :' + PORT + '     ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log(`  🔗 Status Page:   http://0.0.0.0:${PORT}/`);
    console.log(`  🔌 Agent WS:      ws://0.0.0.0:${PORT}/relay-agent`);
    console.log(`  📺 Creator Path:  http://0.0.0.0:${PORT}/c/<username>/overlay`);
  });
}

module.exports = {
  createRelayHub,
  sanitizeSlug,
  resolveSafeCreatorTarget
};
