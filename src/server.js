// server.js — Main TikTok Live Bridge Server
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
// Native ws implementation for Eulerstream

const EventQueue = require('./queue');
const effectMap = require('./effectMap');
const gameDetect = require('./gameDetect');
const webhook = require('./webhook');

// ─── Configuration ────────────────────────────────────────────────────────────
const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT) || 3000;
const MOD_WS_PORT = parseInt(process.env.MOD_WS_PORT) || 7827;

// ─── State ────────────────────────────────────────────────────────────────────
let tiktokConnection = null;
let isConnected = false;
let currentUsername = process.env.TIKTOK_USERNAME || '';
let roomStats = { viewers: 0, likes: 0, gifts: 0, followers: 0, shares: 0, reposts: 0 };
let recentEvents = []; // circular buffer for dashboard
let reconnectTimer = null;
let manualDisconnect = false;

// ─── Event Queue ──────────────────────────────────────────────────────────────
const config = effectMap.getConfig();
const queue = new EventQueue(config.queueSettings);

// ─── WebSocket Server (Game Mod) ──────────────────────────────────────────────
const modWss = new WebSocket.Server({ port: MOD_WS_PORT });
const modClients = new Set();

modWss.on('connection', (ws) => {
  console.log('[ModWS] Game mod connected');
  modClients.add(ws);
  ws.send(JSON.stringify({ type: 'welcome', message: 'TikTok Live Bridge connected' }));
  ws.on('close', () => {
    modClients.delete(ws);
    console.log('[ModWS] Game mod disconnected');
  });
  ws.on('error', (e) => console.error('[ModWS] Error:', e.message));
});

function sendToMod(command) {
  const msg = JSON.stringify(command);
  for (const client of modClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// ─── Dashboard WebSocket (Live Updates) ───────────────────────────────────────
const app = express();
const httpServer = http.createServer(app);
const dashWss = new WebSocket.Server({ server: httpServer, path: '/ws' });
const dashClients = new Set();

dashWss.on('connection', (ws) => {
  dashClients.add(ws);
  // Send current state immediately
  ws.send(JSON.stringify({ type: 'state', isConnected, currentUsername, roomStats, queueStatus: queue.status }));
  ws.on('close', () => dashClients.delete(ws));
});

function broadcastDash(data) {
  const msg = JSON.stringify(data);
  for (const client of dashClients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function pushEvent(event) {
  recentEvents.unshift(event);
  if (recentEvents.length > 100) recentEvents.pop();
  broadcastDash({ type: 'event', event });
}

// ─── Effect Queue Processor ───────────────────────────────────────────────────
queue.setProcessor(async (item) => {
  console.log(`[Queue] Processing: ${item.effectId} (from ${item.user})`);
  sendToMod({
    type: 'effect',
    effectId: item.effectId,
    label: item.label,
    user: item.user,
    data: item.data || {}
  });
  broadcastDash({ type: 'effect', effectId: item.effectId, user: item.user, label: item.label });
  await webhook.emit({ type: 'effect', effectId: item.effectId, user: item.user, source: item.source });
  // Wait for the effect duration
  if (item.duration > 0) {
    await new Promise(r => setTimeout(r, item.duration));
  }
});

// ─── TikTok Event Handlers ────────────────────────────────────────────────────
let availableGifts = [];
try {
  const fs = require('fs');
  const giftsPath = path.join(__dirname, '../gifts-data.json');
  if (fs.existsSync(giftsPath)) {
    availableGifts = JSON.parse(fs.readFileSync(giftsPath, 'utf8'));
  }
} catch (e) {}

function handleGift(data) {
  let fallbackCoins = 0;
  if (data.giftId) {
    const known = availableGifts.find(g => g.id === data.giftId || String(g.id) === String(data.giftId));
    if (known) fallbackCoins = known.diamondCount || known.diamond_count || 0;
  }
  
  const coins = data.diamondCount || data.giftValue || data.gift?.diamondCount || data.gift?.diamond_count || fallbackCoins || 1;
  const user = data.uniqueId || data.nickname || data.user?.uniqueId || 'anonymous';
  const giftName = data.giftName || data.gift?.name || `Gift #${data.giftId}`;

  roomStats.gifts++;
  const event = { time: Date.now(), type: 'gift', user, giftName, coins };
  pushEvent(event);

  // Only trigger on streak end (or if not streakable)
  if (data.repeatEnd === false || data.repeat_end === 0 || data.repeatEnd === 0) return; // still streaking

  const effect = effectMap.resolveGiftById(data.giftId);
  if (!effect) {
    console.log(`[Gift] No mapping for gift ID ${data.giftId} (${giftName})`);
    return;
  }

  console.log(`[Gift] ${user} → ${giftName} (${coins}💎) → ${effect.id}`);
  queue.enqueue({
    effectId: effect.id,
    label: effect.label,
    duration: effect.duration || 0,
    user,
    source: 'gift',
    data: { giftName, coins }
  });
}

function handleFollow(data) {
  const user = data.uniqueId || data.nickname || 'anonymous';
  roomStats.followers++;
  pushEvent({ time: Date.now(), type: 'follow', user });

  const effects = effectMap.resolveEvent('follow');
  for (const effect of effects) {
    console.log(`[Follow] ${user} → ${effect.id}`);
    queue.enqueue({ effectId: effect.id, label: effect.label, duration: effect.duration || 0, user, source: 'follow' });
  }
}

function handleShare(data) {
  const user = data.uniqueId || data.nickname || 'anonymous';
  roomStats.shares++;
  pushEvent({ time: Date.now(), type: 'share', user });

  const effects = effectMap.resolveEvent('share');
  for (const effect of effects) {
    console.log(`[Share] ${user} → ${effect.id}`);
    queue.enqueue({ effectId: effect.id, label: effect.label, duration: effect.duration || 0, user, source: 'share' });
  }
}

function handleRepost(data) {
  const user = data.uniqueId || data.nickname || 'anonymous';
  roomStats.reposts++;
  pushEvent({ time: Date.now(), type: 'repost', user });

  const effects = effectMap.resolveEvent('repost');
  for (const effect of effects) {
    console.log(`[Repost] ${user} → ${effect.id}`);
    queue.enqueue({ effectId: effect.id, label: effect.label, duration: effect.duration || 0, user, source: 'repost' });
  }
}

function handleMember(data) {
  // Ignored for effects per user request, but keeping stats/feed
  const user = data.uniqueId || data.nickname || 'anonymous';
  pushEvent({ time: Date.now(), type: 'member', user });
}


function handleLike(data) {
  const user = data.uniqueId || data.nickname || 'anonymous';
  const count = data.likeCount || 1;
  roomStats.likes += count;
  pushEvent({ time: Date.now(), type: 'like', user, count });

  // Resolve Like Goal Incremental Thresholds
  const effects = effectMap.resolveLikes(count);
  for (const effect of effects) {
    queue.enqueue({ effectId: effect.id, label: effect.label, duration: effect.duration || 0, user, source: 'like' });
  }

  // Resolve standard 'like' social event (triggers on every like batch)
  const socialEffects = effectMap.resolveEvent('like');
  for (const effect of socialEffects) {
    queue.enqueue({ effectId: effect.id, label: effect.label, duration: effect.duration || 0, user, source: 'like_event' });
  }
}

function handleRoomUser(data) {
  if (data.viewerCount !== undefined) {
    roomStats.viewers = data.viewerCount;
    broadcastDash({ type: 'stats', roomStats });
  }
}

// ─── TikTok Connection ────────────────────────────────────────────────────────
async function connectTikTok(username) {
  manualDisconnect = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (tiktokConnection) {
    try { tiktokConnection.close(); } catch {}
    tiktokConnection = null;
  }
  isConnected = false;
  currentUsername = username;
  roomStats = { viewers: 0, likes: 0, gifts: 0, followers: 0 };
  effectMap.resetLikeCounter();
  const apiKey = process.env.EULERSTREAM_API_KEY;
  if (!apiKey) {
    const msg = "Eulerstream API Key is required. Please add it in Settings.";
    console.error('[TikTok] Error:', msg);
    broadcastDash({ type: 'error', message: msg });
    throw new Error(msg);
  }

  const url = `wss://ws.eulerstream.com?uniqueId=${username}&apiKey=${apiKey}`;
  tiktokConnection = new WebSocket(url);

  tiktokConnection.on('open', () => {
    isConnected = true;
    console.log(`[TikTok] Connected to ${username} via Eulerstream WS`);
    broadcastDash({ type: 'state', isConnected, currentUsername, roomStats, roomId: username });
  });

  tiktokConnection.on('message', (data) => {
    try {
      const json = JSON.parse(data.toString());
      if (json.messages) {
        for (const msg of json.messages) {
          if (msg.type === 'WebcastGiftMessage' && msg.data) {
            handleGift(msg.data);
          } else if (msg.type === 'WebcastLikeMessage' && msg.data) {
            const likes = msg.data.count || msg.data.likeCount || 1;
            handleLike({ uniqueId: msg.data.user?.uniqueId, likeCount: likes });
          } else if (msg.type === 'WebcastSocialMessage' && msg.data) {
            if (String(msg.data.action) === '1') {
              handleFollow({ uniqueId: msg.data.user?.uniqueId });
            } else if (String(msg.data.action) === '3') {
              handleShare({ uniqueId: msg.data.user?.uniqueId });
            } else {
              // Sometimes reposts come through as different actions, or just map them to share
              handleRepost({ uniqueId: msg.data.user?.uniqueId });
            }
          } else if (msg.type === 'WebcastMemberMessage' && msg.data) {
            handleMember({ uniqueId: msg.data.user?.uniqueId });
          }
        }
      }
    } catch (err) {
      // ignore parse err
    }
  });

  tiktokConnection.on('close', () => {
    isConnected = false;
    broadcastDash({ type: 'state', isConnected, currentUsername: manualDisconnect ? '' : currentUsername, roomStats });
    console.log('[TikTok] Disconnected');

    if (!manualDisconnect && currentUsername) {
      console.log(`[TikTok] Connection lost. Attempting to reconnect in 3 seconds...`);
      reconnectTimer = setTimeout(() => {
        connectTikTok(currentUsername).catch(e => console.error('[TikTok] Reconnect failed:', e.message));
      }, 3000);
    }
  });

  tiktokConnection.on('error', (err) => {
    console.error('[TikTok] WS Error:', err.message);
    broadcastDash({ type: 'error', message: err.message });
  });
  
  // Return fake state to satisfy API response
  return { roomId: username };
}

function disconnectTikTok() {
  manualDisconnect = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (tiktokConnection) {
    try { tiktokConnection.close(); } catch {}
    tiktokConnection = null;
  }
  isConnected = false;
  broadcastDash({ type: 'state', isConnected, currentUsername: '', roomStats });
}

// ─── Express Middleware ───────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use('/dashboard', express.static(path.join(__dirname, '../public/dashboard')));
app.use('/overlay', express.static(path.join(__dirname, '../public/overlay')));

// ─── REST API ─────────────────────────────────────────────────────────────────
// Status
app.get('/api/status', (req, res) => {
  res.json({
    isConnected,
    currentUsername,
    roomStats,
    modClients: modClients.size,
    queueStatus: queue.status,
    webhookUrl: webhook.getUrl(),
    webhookSecret: webhook.getSecret(),
    eulerstreamKey: process.env.EULERSTREAM_API_KEY || '',
    tiktokSessionId: process.env.TIKTOK_SESSION_ID || '',
    games: gameDetect.getDetected()
  });
});

// Connect to TikTok live
app.post('/api/connect', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  try {
    const state = await connectTikTok(username.replace('@', ''));
    
    // Save username to .env
    const savedUser = username.replace('@', '');
    process.env.TIKTOK_USERNAME = savedUser;
    try {
      const fs = require('fs');
      const envPath = path.join(__dirname, '../.env');
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      if (envContent.includes('TIKTOK_USERNAME=')) {
        envContent = envContent.replace(/TIKTOK_USERNAME=.*/g, `TIKTOK_USERNAME=${savedUser}`);
      } else {
        envContent += `\nTIKTOK_USERNAME=${savedUser}\n`;
      }
      fs.writeFileSync(envPath, envContent, 'utf8');
    } catch (e) {
      console.error('Failed to save username to .env:', e.message);
    }

    res.json({ success: true, roomId: state.roomId });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Disconnect
app.post('/api/disconnect', (req, res) => {
  disconnectTikTok();
  res.json({ success: true });
});

// Get stored gifts data
app.get('/api/gifts', (req, res) => {
  try {
    const fs = require('fs');
    const giftsPath = path.join(__dirname, '../gifts-data.json');
    if (fs.existsSync(giftsPath)) {
      const data = fs.readFileSync(giftsPath, 'utf8');
      res.json(JSON.parse(data));
    } else {
      res.json([]);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update gifts data from local HTML file or TikTok Live Connector
app.post('/api/gifts/update', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  
  try {
    const fs = require('fs');
    const path = require('path');
    
    // First, try to parse from the user-provided gift/index.html file
    const giftHtmlPath = path.join(__dirname, '../gift/index.html');
    if (fs.existsSync(giftHtmlPath)) {
        const html = fs.readFileSync(giftHtmlPath, 'utf8');
        const regex = /<img[^>]*alt="([^"]+)"[^>]*src="(data:image\/[^"]+)"[^>]*>[\s\S]*?<div class="text-center">[^<]*<\/div>\s*<div class="[^"]*">([\d,]+) Coins?<\/div>\s*<div class="[^"]*">ID: (\d+)<\/div>/gi;
        
        let matches;
        let gifts = [];
        while ((matches = regex.exec(html)) !== null) {
            let name = matches[1];
            let image = matches[2];
            let coins = parseInt(matches[3].replace(/,/g, ''), 10);
            let id = parseInt(matches[4], 10);
            if (!gifts.find(g => g.id === id)) {
                gifts.push({ id, name, coins, image });
            }
        }
        
        if (gifts.length > 0) {
            const giftsPath = path.join(__dirname, '../gifts-data.json');
            fs.writeFileSync(giftsPath, JSON.stringify(gifts, null, 2), 'utf8');
            console.log('[API] Successfully extracted ' + gifts.length + ' gifts from local HTML file.');
            return res.json({ success: true, gifts: gifts });
        }
    }

    // Fallback: Use tiktok-live-connector if no local file or parsing failed
    const { TikTokLiveConnection } = require('tiktok-live-connector');
    const tiktokLiveConnection = new TikTokLiveConnection(username, {});
    
    await tiktokLiveConnection.connect();
    const availableGifts = tiktokLiveConnection.availableGifts || [];
    tiktokLiveConnection.disconnect();
    
    if (!availableGifts || availableGifts.length === 0) {
        return res.status(500).json({ error: 'No gifts found or user is not live.' });
    }
    
    const giftsPath = path.join(__dirname, '../gifts-data.json');
    const formattedGifts = availableGifts.map(g => ({
      id: g.id,
      name: g.name,
      coins: g.diamond_count,
      image: g.image?.url_list?.[0] || ''
    }));
    
    fs.writeFileSync(giftsPath, JSON.stringify(formattedGifts, null, 2), 'utf8');
    res.json({ success: true, gifts: formattedGifts });
  } catch (e) {
    console.error('[API] Failed to fetch gifts:', e.message);
    if (e.message.includes('offline')) {
        res.status(500).json({ error: 'User is offline. Silakan mulai Live terlebih dahulu di TikTok untuk mengambil data gift.' });
    } else {
        res.status(500).json({ error: e.message || String(e) });
    }
  }
});

// Get full config
app.get('/api/config', (req, res) => {
  res.json(effectMap.getConfig());
});

// Save full config
app.put('/api/config', (req, res) => {
  try {
    effectMap.config = req.body;
    effectMap.save();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update gift tier mapping
app.patch('/api/config/gift/:id', (req, res) => {
  const ok = effectMap.updateGiftMapping(req.params.id, req.body);
  if (ok) { effectMap.reload(); res.json({ success: true }); }
  else res.status(404).json({ error: 'Not found' });
});

// Test fire an effect manually
app.post('/api/test-effect', (req, res) => {
  const { effectId, user, source } = req.body;
  if (!effectId) return res.status(400).json({ error: 'effectId required' });

  const cfg = effectMap.getConfig();
  let effect = { id: effectId, effectId, label: effectId, duration: 0 };
  for (const game of Object.values(cfg.games || {})) {
    if (game.effects?.[effectId]) { effect = game.effects[effectId]; break; }
  }

  queue.enqueue({
    effectId: effect.id || effectId,
    label: effect.label || effectId,
    duration: effect.duration || 0,
    user: user || 'dashboard-test',
    source: source || 'test'
  });
  res.json({ success: true, effectId });
});

// Get recent events
app.get('/api/events', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(recentEvents.slice(0, limit));
});

// Set webhook URL
app.post('/api/webhook', (req, res) => {
  const { url, secret } = req.body;
  webhook.setUrl(url || '', secret || '');
  
  // Save to .env
  try {
    const fs = require('fs');
    const envPath = path.join(__dirname, '../.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    
    if (envContent.includes('WEBHOOK_URL=')) envContent = envContent.replace(/WEBHOOK_URL=.*/g, `WEBHOOK_URL=${url || ''}`);
    else envContent += `\nWEBHOOK_URL=${url || ''}\n`;
    
    if (envContent.includes('WEBHOOK_SECRET=')) envContent = envContent.replace(/WEBHOOK_SECRET=.*/g, `WEBHOOK_SECRET=${secret || ''}`);
    else envContent += `\nWEBHOOK_SECRET=${secret || ''}\n`;
    
    fs.writeFileSync(envPath, envContent, 'utf8');
  } catch (e) {
    console.error('Failed to save webhook to .env:', e.message);
  }

  res.json({ success: true, enabled: !!url });
});

// Set API Key
app.post('/api/apikey', (req, res) => {
  const { key } = req.body;
  process.env.EULERSTREAM_API_KEY = key || '';
  
  // Try to save to .env file
  try {
    const fs = require('fs');
    const envPath = path.join(__dirname, '../.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    if (envContent.includes('EULERSTREAM_API_KEY=')) {
      envContent = envContent.replace(/EULERSTREAM_API_KEY=.*/g, `EULERSTREAM_API_KEY=${key || ''}`);
    } else {
      envContent += `\nEULERSTREAM_API_KEY=${key || ''}\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');
  } catch (e) {
    console.error('Failed to save API key to .env:', e.message);
  }
  
  res.json({ success: true });
});

// Set Session ID
app.post('/api/sessionid', (req, res) => {
  const { session } = req.body;
  process.env.TIKTOK_SESSION_ID = session || '';
  
  // Try to save to .env file
  try {
    const fs = require('fs');
    const envPath = path.join(__dirname, '../.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    if (envContent.includes('TIKTOK_SESSION_ID=')) {
      envContent = envContent.replace(/TIKTOK_SESSION_ID=.*/g, `TIKTOK_SESSION_ID=${session || ''}`);
    } else {
      envContent += `\nTIKTOK_SESSION_ID=${session || ''}\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');
  } catch (e) {
    console.error('Failed to save session ID to .env:', e.message);
  }
  
  res.json({ success: true });
});

// Game detection
app.get('/api/games', (req, res) => {
  res.json(gameDetect.scan());
});

// Queue status & clear
app.get('/api/queue', (req, res) => res.json(queue.status));
app.delete('/api/queue', (req, res) => { queue.clear(); res.json({ success: true }); });

// ─── Redirect root to dashboard ───────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/dashboard'));

// ─── Start Servers ────────────────────────────────────────────────────────────
httpServer.listen(DASHBOARD_PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   🎮 TikTok Live Bridge — Game Mod Integration   ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  📊 Dashboard:   http://localhost:${DASHBOARD_PORT}/dashboard`);
  console.log(`  📺 OBS Overlay: http://localhost:${DASHBOARD_PORT}/overlay`);
  console.log(`  🔌 Mod WS:      ws://localhost:${MOD_WS_PORT}`);
  console.log('');
  const detected = gameDetect.scan();
  console.log(`  🎯 Detected games: ${detected.map(g => g.name).join(', ')}`);
  console.log('');

  // Auto-connect if username is set in .env
  if (currentUsername) {
    console.log(`  🔗 Auto-connecting to @${currentUsername}...`);
    connectTikTok(currentUsername).catch(e => console.error('Auto-connect failed:', e.message));
  }
});
