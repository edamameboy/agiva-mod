// server.js — Main Agiva Universal Streamer Mod Bridge Server
'use strict';

const path = require('path');
const paths = require('./paths');
const updater = require('./updater');

const fs = require('fs');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const EventQueue = require('./queue');
const effectMap = require('./effectMap');
const gameDetect = require('./gameDetect');
const webhook = require('./webhook');
const keystrokeDriver = require('./drivers/keystrokeDriver');
const rconHttpDriver = require('./drivers/rconHttpDriver');
const AudioTtsDriver = require('./drivers/audioTtsDriver');
const WidgetManager = require('./widgets/widgetManager');
const CompatBridgeServer = require('./drivers/compatBridgeServer');
const ObsDriver = require('./drivers/obsDriver');
const DonationSocketProvider = require('./providers/donationSocketProvider');
const sessionStore = require('./storage/sessionStore');

// ─── Configuration ────────────────────────────────────────────────────────────
const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT) || 3000;
const MOD_WS_PORT = parseInt(process.env.MOD_WS_PORT) || 7827;

// ─── State ────────────────────────────────────────────────────────────────────
let tiktokConnection = null;
let isConnected = false;
let isConnecting = false;
let currentRoomId = '';
let connectionMode = process.env.TIKTOK_CONNECTION_MODE || 'eulerstream'; // 'eulerstream' | 'connector' | 'hybrid'
let activeConnectionProvider = 'none';
let currentUsername = process.env.TIKTOK_USERNAME || '';
let roomStats = { viewers: 0, likes: 0, gifts: 0, followers: 0, shares: 0, reposts: 0, donations: 0 };
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
  ws.send(JSON.stringify({ type: 'welcome', message: 'TikTok Live Bridge connected', activeGameId: effectMap.getConfig().activeGameId }));
  if (currentUsername) {
    ws.send(JSON.stringify({ type: 'auth', username: currentUsername }));
  }
  broadcastDash({ type: 'state', isConnected, currentUsername, roomStats, modClients: modClients.size, queueStatus: queue.status });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'hello' && msg.gameId) {
        ws.gameId = msg.gameId;
        console.log(`[ModWS] Handshake from game mod: ${msg.gameId}`);
      }
    } catch {}
  });

  ws.on('close', () => {
    modClients.delete(ws);
    console.log('[ModWS] Game mod disconnected');
    broadcastDash({ type: 'state', isConnected, currentUsername, roomStats, modClients: modClients.size, queueStatus: queue.status });
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
  const cfg = effectMap.getConfig();
  ws.send(JSON.stringify({
    type: 'state',
    isConnected,
    connectionMode,
    activeConnectionProvider,
    currentUsername,
    roomStats,
    modClients: modClients.size,
    queueStatus: queue.status,
    activeGameId: cfg.activeGameId,
    activePresetId: cfg.activePresetId,
    masterSwitches: effectMap.masterSwitches
  }));
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

// ─── Initialize Advanced Feature Engines (TTS, Widgets, OBS, Compat Ports, Donations) ──
const audioTtsDriver = new AudioTtsDriver(broadcastDash);

function enqueueEffectById(effectId, user = 'System', source = 'widget', extraData = {}) {
  if (!effectId) return;
  const resolved = effectMap._resolveEffect(effectId);
  if (!resolved) return;
  queue.enqueue({
    effectId: resolved.id || effectId,
    label: resolved.label || effectId,
    duration: resolved.duration || 0,
    user,
    source,
    data: { macro: resolved.macro, command: resolved.command, ...extraData }
  });
}

const widgetManager = new WidgetManager({
  broadcastFn: broadcastDash,
  triggerEffectFn: enqueueEffectById
});

const obsDriver = new ObsDriver(broadcastDash);

const compatBridge = new CompatBridgeServer({
  widgetManager,
  audioTtsDriver,
  effectMap,
  triggerEffectFn: enqueueEffectById
});

const donationSocketProvider = new DonationSocketProvider((donData) => {
  handleDonation(donData);
});

// Global Hotkeys configuration
const HOTKEYS_PATH = paths.HOTKEYS_PATH;
let hotkeysConfig = {
  toggle_all: 'Alt+P',
  clear_queue: 'Alt+C',
  skip_tts: 'Alt+S',
  toggle_hud_lock: 'Alt+L',
  win_add: 'Alt+1',
  lose_add: 'Alt+2'
};
try {
  if (fs.existsSync(HOTKEYS_PATH)) {
    hotkeysConfig = { ...hotkeysConfig, ...JSON.parse(fs.readFileSync(HOTKEYS_PATH, 'utf8')) };
  }
} catch {}

function handleHotkeyTriggered(action) {
  if (action === 'toggle_all') {
    const next = !effectMap.masterSwitches.all;
    const sw = effectMap.setMasterSwitches({ all: next });
    broadcastDash({ type: 'master_switches', masterSwitches: sw });
  } else if (action === 'clear_queue') {
    queue.clear();
  } else if (action === 'skip_tts') {
    audioTtsDriver.stopAllAudio();
  } else if (action === 'win_add') {
    widgetManager.controlCounter('win_add', 1);
  } else if (action === 'lose_add') {
    widgetManager.controlCounter('lose_add', 1);
  }
}

if (global.agivaElectronBridge) {
  global.agivaElectronBridge.registerHotkeys(hotkeysConfig, handleHotkeyTriggered);
}

// ─── Multi-Driver Effect Queue Processor ──────────────────────────────────────
queue.setProcessor(async (item) => {
  const switches = effectMap.masterSwitches;
  if (!switches.all) {
    console.log(`[Queue] Skipped ${item.effectId} (Master Switch ALL is OFF)`);
    return;
  }

  const resolved = effectMap._resolveEffect(item.effectId, item.params || {});
  const driver = resolved?.driver || 'ws-mod';
  console.log(`[Queue] Processing: ${item.effectId} [Driver: ${driver}] (from ${item.user})`);

  // 1. WebSocket Mod Driver (Unity BepInEx / Lua / Unreal)
  if ((driver === 'ws-mod' || !driver) && switches.wsMod) {
    sendToMod({
      type: 'effect',
      effectId: item.effectId,
      label: item.label || resolved?.label || item.effectId,
      user: item.user,
      data: { ...(item.data || {}), params: resolved?.params || {} }
    });
  }

  // 2. Keystroke & Mouse Macro Driver (Win32 SendInput ScanCode / AutoIt)
  if (driver === 'keystroke' && switches.keystroke) {
    const macro = item.data?.macro || resolved?.macro;
    if (macro) {
      await keystrokeDriver.execute(macro, {
        inputMethod: resolved?.inputMethod || 'sendinput',
        targetProcess: resolved?.targetProcess || '',
        context: { user: item.user, ...(item.data || {}) }
      });
    }
  }

  // 3. RCON / ServerTap HTTP Driver (Minecraft / Rust / Palworld)
  if (driver === 'rcon' && switches.rcon) {
    const command = item.data?.command || resolved?.command;
    if (command) {
      await rconHttpDriver.execute(command, {
        connection: resolved?.rconConfig || {},
        context: {
          user: item.user,
          targetPlayer: resolved?.rconConfig?.targetPlayer || '@a',
          ...(item.data || {})
        }
      });
    }
  }

  // 4. Broadcast to Dashboard & OBS Overlay
  broadcastDash({
    type: 'effect',
    effectId: item.effectId,
    user: item.user,
    label: item.label || resolved?.label || item.effectId,
    driver,
    gameId: resolved?.gameId || effectMap.getConfig().activeGameId
  });

  // 5. Outgoing Webhook
  if (switches.webhook) {
    await webhook.emit({
      type: 'effect',
      effectId: item.effectId,
      label: item.label || resolved?.label || item.effectId,
      user: item.user,
      source: item.source,
      gameId: resolved?.gameId
    });
  }

  // 6. Broadcast to Compatibility Ports (:62024 / :62025) & Session Analytics
  compatBridge.broadcastEvent('interaksi', {
    effectId: item.effectId,
    label: item.label || resolved?.label || item.effectId,
    user: item.user,
    source: item.source,
    gameId: resolved?.gameId
  });
  sessionStore.recordEffectTriggered();
});

// ─── Stream & Platform Event Handlers ─────────────────────────────────────────
let availableGifts = [];
try {
  const giftsPath = paths.GIFTS_DATA_PATH;
  if (fs.existsSync(giftsPath)) {
    availableGifts = JSON.parse(fs.readFileSync(giftsPath, 'utf8'));
  }
} catch (e) {}

function extractUser(data) {
  return data?.uniqueId || data?.displayId || data?.user?.uniqueId || data?.user?.displayId || data?.nickname || data?.user?.nickname || 'anonymous';
}

function extractUserMeta(data) {
  const u = data?.user || data || {};
  const uniqueId = extractUser(data);
  const nickname = u.nickname || data?.nickname || uniqueId;
  const followRole = Number(u.followInfo?.followStatus ?? u.followRole ?? data?.followRole ?? 0);
  const isFollower = Boolean(u.isFollower || followRole >= 1);
  const isSubscribe = Boolean(u.isSubscribe || data?.isSubscribe || data?.isSuperFan);
  const isModerator = Boolean(u.userAttr?.isAdmin || u.userAttr?.isSuperAdmin || u.isAdmin || data?.isModerator);
  let gifterLevel = Number(data?.gifterLevel || 0);
  if (!gifterLevel && Array.isArray(u.badgeList)) {
    for (const b of u.badgeList) {
      const lvl = parseInt(b?.privilegeLogExtra?.level || b?.combine?.str || '0', 10);
      if (lvl > gifterLevel) gifterLevel = lvl;
    }
  }
  return { uniqueId, user: uniqueId, nickname, followRole, isFollower, isSubscribe, isModerator, isAdmin: isModerator, gifterLevel };
}

/**
 * Execute Multi-Action Chaining attached to a resolved trigger (TTS, Soundboard, Multi-Screen Alert, Timer, Wheel, OBS)
 */
function executeChainedActions(effect, vars = {}) {
  const chain = effect?.chainActions;
  if (!chain) return;
  const switches = effectMap.masterSwitches;

  if (chain.soundId && switches.tts !== false) {
    audioTtsDriver.playSound(chain.soundId, { screen: chain.overlayScreen || 1 }, switches.tts !== false);
  }
  if (chain.ttsTemplate && switches.tts !== false) {
    const text = audioTtsDriver.formatTemplate(chain.ttsTemplate, vars);
    audioTtsDriver.speak(text, { user: vars.user }, switches.tts !== false);
  }
  if (chain.overlayScreen && chain.overlayScreen >= 1) {
    widgetManager.triggerScreenAlert(chain.overlayScreen, {
      title: effect.label || effect.id,
      subtitle: `${vars.user || 'Penonton'} ${vars.giftName ? `(${vars.giftName})` : ''}`,
      mediaUrl: chain.overlayMediaUrl || ''
    });
  }
  if (chain.timerAddSec && chain.timerAddSec !== 0) {
    widgetManager.controlTimer('add', chain.timerAddSec, vars.user);
  }
  if (chain.spinWheel) {
    widgetManager.spinWheel(vars.user || 'Penonton');
  }
  if (chain.obsScene && switches.obs !== false) {
    obsDriver.switchSceneTemporary(chain.obsScene, chain.obsDurationSec || 5, switches.obs !== false).catch(() => {});
  }
}

function handleGift(data) {
  let fallbackCoins = 0;
  let knownGift = null;
  if (data.giftId) {
    knownGift = availableGifts.find(g => g.id === data.giftId || String(g.id) === String(data.giftId));
    if (knownGift) fallbackCoins = knownGift.coins || knownGift.diamondCount || knownGift.diamond_count || 0;
  }

  const unitCoins = data.diamondCount || data.giftValue || data.giftDetails?.diamondCount || data.gift?.diamondCount || data.gift?.diamond_count || fallbackCoins || 1;
  const repeatCount = Number(data.repeatCount || data.repeat_count || 1);
  const coins = data.totalCoins || (unitCoins * repeatCount);
  const userMeta = extractUserMeta(data);
  const user = userMeta.uniqueId;
  const giftName = data.giftName || data.giftDetails?.giftName || data.gift?.name || knownGift?.name || `Gift #${data.giftId}`;

  // Only trigger on streak end (or if not streakable)
  const giftType = data.giftType ?? data.giftDetails?.giftType ?? data.gift?.gift_type;
  if (giftType === 1 && !data.repeatEnd && !data.repeat_end) return;
  if (giftType === undefined && (data.repeatEnd === false || data.repeat_end === 0)) return;

  roomStats.gifts++;
  const event = { time: Date.now(), type: 'gift', user, giftName, coins, giftId: data.giftId, repeatCount };
  pushEvent(event);
  broadcastDash({ type: 'stats', roomStats });

  // Update Widgets, Session Analytics & Compat Bridge
  widgetManager.onGift({ user, coins, giftName, repeatCount });
  sessionStore.recordGift({ user, giftName, giftId: data.giftId, coins, repeatCount });
  compatBridge.broadcastEvent('gift', event);

  // Automatic Gift TTS if enabled in TTS config
  const ttsCfg = audioTtsDriver.config.tts;
  if (ttsCfg.enabled && ttsCfg.readGifts && coins >= (Number(ttsCfg.minGiftCoinsForTts) || 1)) {
    const msg = audioTtsDriver.formatTemplate(ttsCfg.giftTemplate, { nickname: userMeta.nickname, user, giftName, coins, repeatCount });
    audioTtsDriver.speak(msg, { user }, effectMap.masterSwitches.tts !== false);
  }

  const effect = effectMap.resolveGiftById(data.giftId, coins, userMeta);
  if (!effect) {
    console.log(`[Gift] No mapping for gift ID ${data.giftId} (${giftName}, ${coins}💎)`);
    return;
  }

  const vars = { user, nickname: userMeta.nickname, giftName, coins, repeatCount };
  executeChainedActions(effect, vars);

  const times = effect.chainActions?.multiplyByRepeat ? Math.min(10, Math.max(1, repeatCount)) : 1;
  console.log(`[Gift] ${user} → ${giftName} (${coins}💎) → ${effect.id}${times > 1 ? ` (x${times})` : ''}`);
  for (let i = 0; i < times; i++) {
    queue.enqueue({
      effectId: effect.id,
      label: effect.label,
      duration: effect.duration || 0,
      user,
      source: 'gift',
      data: { giftName, coins, giftId: data.giftId, repeatCount }
    });
  }
}

function handleFollow(data) {
  const userMeta = extractUserMeta(data);
  const user = userMeta.uniqueId;
  roomStats.followers++;
  const ev = { time: Date.now(), type: 'follow', user };
  pushEvent(ev);
  broadcastDash({ type: 'stats', roomStats });

  widgetManager.onFollow({ user });
  sessionStore.recordFollow();
  compatBridge.broadcastEvent('follow', ev);

  if (audioTtsDriver.config.tts.enabled && audioTtsDriver.config.tts.readFollows) {
    const msg = audioTtsDriver.formatTemplate(audioTtsDriver.config.tts.followTemplate, { nickname: userMeta.nickname, user });
    audioTtsDriver.speak(msg, { user }, effectMap.masterSwitches.tts !== false);
  }

  const effects = effectMap.resolveEvent('follow', userMeta);
  for (const effect of effects) {
    executeChainedActions(effect, { user, nickname: userMeta.nickname });
    console.log(`[Follow] ${user} → ${effect.id}`);
    queue.enqueue({ effectId: effect.id, label: effect.label, duration: effect.duration || 0, user, source: 'follow' });
  }
}

function handleShare(data) {
  const userMeta = extractUserMeta(data);
  const user = userMeta.uniqueId;
  roomStats.shares++;
  const ev = { time: Date.now(), type: 'share', user };
  pushEvent(ev);
  broadcastDash({ type: 'stats', roomStats });

  sessionStore.recordShare();
  compatBridge.broadcastEvent('share', ev);

  const effects = effectMap.resolveEvent('share', userMeta);
  for (const effect of effects) {
    executeChainedActions(effect, { user, nickname: userMeta.nickname });
    console.log(`[Share] ${user} → ${effect.id}`);
    queue.enqueue({ effectId: effect.id, label: effect.label, duration: effect.duration || 0, user, source: 'share' });
  }
}

function handleRepost(data) {
  const userMeta = extractUserMeta(data);
  const user = userMeta.uniqueId;
  roomStats.reposts++;
  const ev = { time: Date.now(), type: 'repost', user };
  pushEvent(ev);
  broadcastDash({ type: 'stats', roomStats });
  compatBridge.broadcastEvent('repost', ev);

  const effects = effectMap.resolveEvent('repost', userMeta);
  for (const effect of effects) {
    executeChainedActions(effect, { user, nickname: userMeta.nickname });
    console.log(`[Repost] ${user} → ${effect.id}`);
    queue.enqueue({ effectId: effect.id, label: effect.label, duration: effect.duration || 0, user, source: 'repost' });
  }
}

function handleMember(data) {
  const userMeta = extractUserMeta(data);
  const user = userMeta.uniqueId;
  const ev = { time: Date.now(), type: 'member', user };
  pushEvent(ev);
  compatBridge.broadcastEvent('member', ev);

  const effects = effectMap.resolveEvent('member', userMeta);
  for (const effect of effects) {
    executeChainedActions(effect, { user, nickname: userMeta.nickname });
    queue.enqueue({ effectId: effect.id, label: effect.label, duration: effect.duration || 0, user, source: 'member' });
  }
}

function handleLike(data) {
  const userMeta = extractUserMeta(data);
  const user = userMeta.uniqueId;
  const count = Number(data.likeCount || data.count || 1);
  roomStats.likes += count;
  const ev = { time: Date.now(), type: 'like', user, count };
  pushEvent(ev);
  broadcastDash({ type: 'stats', roomStats });

  widgetManager.onLike({ user, count });
  sessionStore.recordLike({ user, count });
  compatBridge.broadcastEvent('like', ev);

  // Resolve Like Goal Incremental Thresholds
  const effects = effectMap.resolveLikes(count);
  for (const effect of effects) {
    executeChainedActions(effect, { user, nickname: userMeta.nickname, count });
    queue.enqueue({ effectId: effect.id, label: effect.label, duration: effect.duration || 0, user, source: 'like', data: { count } });
  }

  // Resolve standard 'like' social event (triggers on every like batch)
  const socialEffects = effectMap.resolveEvent('like', userMeta);
  for (const effect of socialEffects) {
    executeChainedActions(effect, { user, nickname: userMeta.nickname, count });
    queue.enqueue({ effectId: effect.id, label: effect.label, duration: effect.duration || 0, user, source: 'like_event', data: { count } });
  }
}

function handleChat(data) {
  const userMeta = extractUserMeta(data);
  const user = userMeta.uniqueId;
  const comment = data.comment || data.content || data.text || '';
  if (!comment) return;

  const ev = { time: Date.now(), type: 'chat', user, comment, role: userMeta };
  pushEvent(ev);

  widgetManager.onChat({ user, comment });
  sessionStore.recordChat();
  compatBridge.broadcastEvent('chat', ev);

  // Check Chat TTS (!tts or all chat mode)
  audioTtsDriver.handleChatTts({ ...userMeta, comment }, effectMap.masterSwitches.tts !== false);

  const effect = effectMap.resolveChatCommand(comment, userMeta);
  if (effect) {
    executeChainedActions(effect, { user, nickname: userMeta.nickname, comment });
    console.log(`[ChatCmd] ${user} ("${comment}") → ${effect.id}`);
    queue.enqueue({
      effectId: effect.id,
      label: effect.label,
      duration: effect.duration || 0,
      user,
      source: 'chat',
      data: { comment }
    });
  }
}

function handleDonation(data) {
  const user = data.user || data.donator_name || data.supporter_name || data.name || 'Supporter';
  const amount = Number(data.amount || data.amount_raw || data.price || 0);
  const platform = data.platform || 'donation';
  const message = data.message || data.comment || '';

  roomStats.donations = (roomStats.donations || 0) + 1;
  const ev = { time: Date.now(), type: 'donation', user, amount, platform, comment: message };
  pushEvent(ev);
  broadcastDash({ type: 'stats', roomStats });

  widgetManager.onDonation({ user, amount });
  sessionStore.recordDonation({ user, platform, amount, message });
  compatBridge.broadcastEvent('donation', ev);

  if (audioTtsDriver.config.tts.enabled && audioTtsDriver.config.tts.readDonations) {
    const spoken = audioTtsDriver.formatTemplate(audioTtsDriver.config.tts.donationTemplate, {
      nickname: user,
      user,
      amount,
      comment: message
    });
    audioTtsDriver.speak(spoken, { user }, effectMap.masterSwitches.tts !== false);
  }

  let effect = effectMap.resolveDonation(amount);
  // Fallback to Coin Tiers using IDR-to-Coin conversion if enabled
  if (!effect && donationSocketProvider.config.autoTriggerCoinTiers && amount > 0) {
    const equivCoins = donationSocketProvider.convertIdrToCoins(amount);
    effect = effectMap.resolveGiftById(null, equivCoins, { uniqueId: user });
  }

  if (!effect) {
    console.log(`[Donation] No tier matched for Rp ${amount} from ${user} (${platform})`);
    return;
  }

  executeChainedActions(effect, { user, nickname: user, amount, comment: message });
  console.log(`[Donation] ${user} (${platform}: Rp ${amount}) → ${effect.id}`);
  queue.enqueue({
    effectId: effect.id,
    label: effect.label,
    duration: effect.duration || 0,
    user,
    source: platform,
    data: { amount, platform, message }
  });
}

function handleRoomUser(data) {
  const viewers = data.viewerCount ?? data.total;
  if (viewers !== undefined) {
    roomStats.viewers = Number(viewers);
    broadcastDash({ type: 'stats', roomStats });
  }
}

// ─── TikTok Connection (Preserving Eulerstream 100% + Hybrid Connector) ───────
async function connectTikTok(username, requestedMode) {
  if (isConnecting && currentUsername === username) {
    console.log(`[TikTok] Already connecting to @${username}, skipping duplicate call.`);
    return { roomId: currentRoomId || username, provider: activeConnectionProvider };
  }
  manualDisconnect = false;
  isConnecting = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (tiktokConnection) {
    try {
      tiktokConnection.removeAllListeners?.();
      if (typeof tiktokConnection.disconnect === 'function') tiktokConnection.disconnect();
      else if (typeof tiktokConnection.close === 'function') tiktokConnection.close();
    } catch {}
    tiktokConnection = null;
  }
  isConnected = false;
  currentUsername = username;
  if (requestedMode) connectionMode = requestedMode;
  sendToMod({ type: 'auth', username: currentUsername });
  roomStats = { viewers: 0, likes: 0, gifts: 0, followers: 0, shares: 0, reposts: 0, donations: roomStats.donations || 0 };
  effectMap.resetLikeCounter();

  const apiKey = process.env.EULERSTREAM_API_KEY;

  // If mode is 'connector' OR ('hybrid' without Eulerstream key), use tiktok-live-connector
  if (connectionMode === 'connector' || (connectionMode === 'hybrid' && !apiKey)) {
    return connectTikTokConnector(username);
  }

  // ── EXACT EULERSTREAM CONNECTION LOGIC (UNTOUCHED) ──
  if (!apiKey) {
    isConnecting = false;
    const msg = "Eulerstream API Key is required. Please add it in Settings (atau ubah Mode Koneksi ke Hybrid/Connector Gratis).";
    console.error('[TikTok] Error:', msg);
    broadcastDash({ type: 'error', message: msg });
    throw new Error(msg);
  }

  activeConnectionProvider = 'eulerstream';
  const url = `wss://ws.eulerstream.com?uniqueId=${username}&apiKey=${apiKey}`;
  const wsInstance = new WebSocket(url);
  tiktokConnection = wsInstance;

  let hasEstablishedConnection = false;
  let roomReportedLive = false;

  wsInstance.on('open', () => {
    if (tiktokConnection !== wsInstance) return;
    isConnecting = false;
    isConnected = true;
    console.log(`[TikTok] Connected to ${username} via Eulerstream WS`);
    broadcastDash({ type: 'state', isConnected, activeConnectionProvider, currentUsername, roomStats, roomId: currentRoomId || username });

    // Eulerstream closes immediately if offline. If we stay connected for 5s, we consider it established.
    setTimeout(() => {
      if (isConnected && tiktokConnection === wsInstance) {
        hasEstablishedConnection = true;
      }
    }, 5000);
  });

  wsInstance.on('message', (data) => {
    if (tiktokConnection !== wsInstance) return;
    try {
      const json = JSON.parse(data.toString());
      if (json.messages) {
        for (const msg of json.messages) {
          if (msg.type === 'roomInfo' && msg.data?.roomInfo) {
            if (msg.data.roomInfo.id) currentRoomId = String(msg.data.roomInfo.id);
            if (msg.data.roomInfo.isLive) roomReportedLive = true;
          } else if (msg.type === 'WebcastGiftMessage' && msg.data) {
            hasEstablishedConnection = true;
            handleGift(msg.data);
          } else if (msg.type === 'WebcastLikeMessage' && msg.data) {
            hasEstablishedConnection = true;
            const likes = msg.data.count || msg.data.likeCount || 1;
            handleLike({ uniqueId: msg.data.user?.uniqueId, likeCount: likes });
          } else if (msg.type === 'WebcastSocialMessage' && msg.data) {
            hasEstablishedConnection = true;
            if (String(msg.data.action) === '1') {
              handleFollow({ uniqueId: msg.data.user?.uniqueId });
            } else if (String(msg.data.action) === '3') {
              handleShare({ uniqueId: msg.data.user?.uniqueId });
            } else {
              handleRepost({ uniqueId: msg.data.user?.uniqueId });
            }
          } else if (msg.type === 'WebcastMemberMessage' && msg.data) {
            hasEstablishedConnection = true;
            handleMember({ uniqueId: msg.data.user?.uniqueId });
          } else if (msg.type === 'WebcastChatMessage' && msg.data) {
            hasEstablishedConnection = true;
            handleChat({ uniqueId: msg.data.user?.uniqueId, comment: msg.data.comment });
          } else if (msg.type === 'WebcastRoomUserSeqMessage' && msg.data) {
            hasEstablishedConnection = true;
            handleRoomUser({ viewerCount: msg.data.total || msg.data.viewerCount });
          }
        }
      }
    } catch (err) {
      // ignore parse err
    }
  });

  wsInstance.on('close', (code, reasonBuf) => {
    if (tiktokConnection !== wsInstance) return;
    const reason = reasonBuf ? reasonBuf.toString() : '';
    isConnecting = false;
    isConnected = false;
    broadcastDash({ type: 'state', isConnected, activeConnectionProvider, currentUsername: manualDisconnect ? '' : currentUsername, roomStats });
    console.log(`[TikTok] Disconnected${reason ? ` (${code}: ${reason})` : ''}`);

    if (!manualDisconnect && currentUsername) {
      if (hasEstablishedConnection) {
        console.log(`[TikTok] Connection lost. Attempting to reconnect in 3 seconds...`);
        reconnectTimer = setTimeout(() => {
          connectTikTok(currentUsername).catch(e => console.error('[TikTok] Reconnect failed:', e.message));
        }, 3000);
      } else if (roomReportedLive || code === 1011 || connectionMode === 'hybrid') {
        console.log(`[TikTok] Eulerstream cloud WS closed early (${code || '1011'}) while @${currentUsername} is live; switching to Direct Signed WebSocket (Eulerstream Sign API)...`);
        connectTikTokConnector(currentUsername).catch(e => {
          console.error('[TikTok] Direct Signed WebSocket fallback failed:', e.message);
          currentUsername = '';
          broadcastDash({ type: 'state', isConnected: false, currentUsername: '', roomStats });
        });
      } else {
        console.log(`[TikTok] Account appears to be offline. Stopping auto-reconnect to prevent spam.`);
        currentUsername = '';
        broadcastDash({ type: 'state', isConnected, currentUsername: '', roomStats });
      }
    }
  });

  wsInstance.on('error', (err) => {
    if (tiktokConnection !== wsInstance) return;
    isConnecting = false;
    console.error('[TikTok] WS Error:', err.message);
    broadcastDash({ type: 'error', message: err.message });
  });

  return { roomId: currentRoomId || username, provider: 'eulerstream' };
}

async function connectTikTokConnector(username) {
  try {
    const { TikTokLiveConnection } = require('tiktok-live-connector');
    // Note: enableExtendedGiftInfo MUST be false in v2.4.4 because v2.4.4 attempts URL signing via Eulerstream Business Plan
    const opts = {
      processInitialData: false,
      enableExtendedGiftInfo: false
    };
    if (process.env.EULERSTREAM_API_KEY) {
      opts.signApiKey = process.env.EULERSTREAM_API_KEY;
    }

    activeConnectionProvider = 'connector';
    const conn = new TikTokLiveConnection(username, opts);
    tiktokConnection = conn;

    conn.on('error', (err) => {
      console.error('[TikTokConnector] Error:', err?.exception?.message || err?.message || err);
    });

    const state = await conn.connect();
    if (tiktokConnection !== conn) return { roomId: state?.roomId || username, provider: 'connector' };
    isConnecting = false;
    isConnected = true;
    if (state?.roomId) currentRoomId = String(state.roomId);
    console.log(`[TikTok] Connected to @${username} via Eulerstream Signed Direct WS (Room: ${state.roomId})`);
    broadcastDash({ type: 'state', isConnected, activeConnectionProvider, currentUsername: username, roomStats, roomId: state.roomId });

    conn.on('gift', (data) => handleGift(data));
    conn.on('like', (data) => handleLike(data));
    conn.on('follow', (data) => handleFollow(data));
    conn.on('share', (data) => handleShare(data));
    conn.on('social', (data) => {
      const action = String(data.action ?? '');
      const displayType = String(data.common?.displayType || data.displayType || '').toLowerCase();
      if (action === '1' || displayType.includes('follow')) handleFollow(data);
      else if (action === '3' || displayType.includes('share')) handleShare(data);
      else handleRepost(data);
    });
    conn.on('member', (data) => handleMember(data));
    conn.on('chat', (data) => handleChat(data));
    conn.on('roomUser', (data) => handleRoomUser(data));
    conn.on('streamEnd', () => {
      if (tiktokConnection !== conn) return;
      isConnected = false;
      currentUsername = '';
      broadcastDash({ type: 'state', isConnected: false, currentUsername: '', roomStats });
    });
    conn.on('disconnected', () => {
      if (tiktokConnection !== conn) return;
      isConnected = false;
      broadcastDash({ type: 'state', isConnected: false, currentUsername: manualDisconnect ? '' : currentUsername, roomStats });
      if (!manualDisconnect && currentUsername) {
        console.log(`[TikTok] Direct WS disconnected. Reconnecting to @${currentUsername} in 3s...`);
        reconnectTimer = setTimeout(() => {
          connectTikTokConnector(currentUsername).catch(e => console.error('[TikTok] Reconnect failed:', e.message));
        }, 3000);
      }
    });

    return { roomId: state.roomId, provider: 'connector' };
  } catch (err) {
    isConnecting = false;
    throw err;
  }
}

function disconnectTikTok() {
  manualDisconnect = true;
  isConnecting = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (tiktokConnection) {
    try {
      tiktokConnection.removeAllListeners?.();
      if (typeof tiktokConnection.disconnect === 'function') tiktokConnection.disconnect();
      else if (typeof tiktokConnection.close === 'function') tiktokConnection.close();
    } catch {}
    tiktokConnection = null;
  }
  isConnected = false;
  activeConnectionProvider = 'none';
  sendToMod({ type: 'auth', username: '' });
  broadcastDash({ type: 'state', isConnected, activeConnectionProvider, currentUsername: '', roomStats });
}

function saveEnvVar(key, value) {
  process.env[key] = value || '';
  try {
    const envPath = paths.ENV_PATH;
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const regex = new RegExp(`^${key}=.*`, 'gm');
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value || ''}`);
    } else {
      envContent += `\n${key}=${value || ''}\n`;
    }
    fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
  } catch (e) {
    console.error(`Failed to save ${key} to .env:`, e.message);
  }
}

// ─── Express Middleware ───────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use('/dashboard', express.static(path.join(__dirname, '../public/dashboard')));
app.use('/overlay', express.static(path.join(__dirname, '../public/overlay')));
app.use('/sounds', express.static(paths.SOUNDS_DIR));
if (paths.BUNDLED_SOUNDS_DIR !== paths.SOUNDS_DIR) {
  app.use('/sounds', express.static(paths.BUNDLED_SOUNDS_DIR));
}

// ─── REST API ─────────────────────────────────────────────────────────────────
// Status
app.get('/api/status', (req, res) => {
  const cfg = effectMap.getConfig();
  res.json({
    isConnected,
    connectionMode,
    activeConnectionProvider,
    currentUsername,
    roomStats,
    modClients: modClients.size,
    queueStatus: queue.status,
    webhookUrl: webhook.getUrl(),
    webhookSecret: webhook.getSecret(),
    eulerstreamKey: process.env.EULERSTREAM_API_KEY || '',
    tiktokSessionId: process.env.TIKTOK_SESSION_ID || '',
    activeGameId: cfg.activeGameId,
    activePresetId: cfg.activePresetId,
    masterSwitches: effectMap.masterSwitches,
    games: gameDetect.getDetected(),
    ttsSoundConfig: audioTtsDriver.getConfig(),
    widgetState: widgetManager.getState(),
    compatPorts: compatBridge.getStatus(),
    obsStatus: obsDriver.getStatus(),
    desktopStatus: global.agivaElectronBridge ? global.agivaElectronBridge.getStatus() : { isElectron: false, hudOpen: false, hudLocked: false },
    appVersion: updater.getCurrentVersion(),
    storagePath: paths.WRITABLE_ROOT,
    presetsFolder: gameDetect.getGamesDir(),
    isPackaged: paths.isPackaged,
    isPortable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
    repoUrl: updater.getRepoUrl()
  });
});

// Connect to TikTok live
app.post('/api/connect', async (req, res) => {
  const { username, mode } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  try {
    const cleanUser = username.replace('@', '').trim();
    if (mode) {
      connectionMode = mode;
      saveEnvVar('TIKTOK_CONNECTION_MODE', mode);
    }
    const state = await connectTikTok(cleanUser, connectionMode);
    saveEnvVar('TIKTOK_USERNAME', cleanUser);
    res.json({ success: true, roomId: state.roomId, provider: state.provider });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Disconnect
app.post('/api/disconnect', (req, res) => {
  disconnectTikTok();
  res.json({ success: true });
});

// Set Connection Mode ('eulerstream' | 'hybrid' | 'connector')
app.post('/api/connection-mode', (req, res) => {
  const { mode } = req.body;
  if (!['eulerstream', 'hybrid', 'connector'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }
  connectionMode = mode;
  saveEnvVar('TIKTOK_CONNECTION_MODE', mode);
  res.json({ success: true, connectionMode });
});

// Master Kill-Switches
app.post('/api/master-switches', (req, res) => {
  const switches = effectMap.setMasterSwitches(req.body || {});
  broadcastDash({ type: 'master_switches', masterSwitches: switches });
  res.json({ success: true, masterSwitches: switches });
});

// Get stored gifts data
app.get('/api/gifts', (req, res) => {
  try {
    const giftsPath = paths.GIFTS_DATA_PATH;
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

// Update gifts data from local HTML file or Direct Unsigned TikTok Webcast HTTP API (without opening a second WebSocket!)
app.post('/api/gifts/update', async (req, res) => {
  const rawUser = (req.body?.username || currentUsername || 'tiktok').replace('@', '').trim();

  try {
    const giftHtmlPath = path.join(__dirname, '../gift/index.html');
    if (fs.existsSync(giftHtmlPath)) {
      const html = fs.readFileSync(giftHtmlPath, 'utf8');
      const regex = /<img[^>]*alt="([^"]+)"[^>]*src="(data:image\/[^"]+)"[^>]*>[\s\S]*?<div class="text-center">[^<]*<\/div>\s*<div class="[^"]*">([\d,]+) Coins?<\/div>\s*<div class="[^"]*">ID: (\d+)<\/div>/gi;

      let matches;
      const gifts = [];
      while ((matches = regex.exec(html)) !== null) {
        const name = matches[1];
        const image = matches[2];
        const coins = parseInt(matches[3].replace(/,/g, ''), 10);
        const id = parseInt(matches[4], 10);
        if (!gifts.find(g => g.id === id)) {
          gifts.push({ id, name, coins, image });
        }
      }

      if (gifts.length > 0) {
        const giftsPath = paths.GIFTS_DATA_PATH;
        fs.writeFileSync(giftsPath, JSON.stringify(gifts, null, 2), 'utf8');
        availableGifts = gifts;
        console.log('[API] Successfully extracted ' + gifts.length + ' gifts from local HTML file.');
        return res.json({ success: true, gifts });
      }
    }

    // Fetch directly via Webcast HTTP API (signRequest = false) without calling connect()
    // This prevents opening a second WebSocket session that would disconnect the active Eulerstream/TikTok connection!
    const { TikTokLiveConnection } = require('tiktok-live-connector');
    const tempClient = new TikTokLiveConnection(rawUser || 'tiktok', {
      fetchRoomInfoOnConnect: false,
      enableExtendedGiftInfo: false
    });
    tempClient.on('error', () => {}); // Prevent unhandled error event crashes

    let roomIdToUse = '';
    if (rawUser && rawUser.toLowerCase() === String(currentUsername).toLowerCase() && currentRoomId) {
      roomIdToUse = currentRoomId;
    } else if (rawUser && rawUser !== 'tiktok') {
      try {
        roomIdToUse = await tempClient.fetchRoomId(rawUser);
      } catch {
        roomIdToUse = '';
      }
    }

    const queryParams = {
      ...tempClient.webClient.clientParams,
      ...(roomIdToUse ? { room_id: roomIdToUse } : {})
    };

    let giftResp = await tempClient.webClient.getJsonObjectFromWebcastApi('gift/list/', queryParams, false);
    let fetchedGifts = giftResp?.data?.gifts || [];

    // Fallback: if room_id caused an empty list, fetch the global TikTok gift catalog without room_id
    if ((!fetchedGifts || fetchedGifts.length === 0) && roomIdToUse) {
      giftResp = await tempClient.webClient.getJsonObjectFromWebcastApi('gift/list/', tempClient.webClient.clientParams, false);
      fetchedGifts = giftResp?.data?.gifts || [];
    }

    if (!fetchedGifts || fetchedGifts.length === 0) {
      return res.status(500).json({ error: 'Tidak dapat mengambil daftar gift dari server TikTok saat ini.' });
    }

    const giftsPath = paths.GIFTS_DATA_PATH;
    const formattedGifts = fetchedGifts.map(g => ({
      id: g.id,
      name: g.name,
      coins: g.diamond_count,
      image: g.image?.url_list?.[0] || g.icon?.url_list?.[0] || ''
    }));

    fs.writeFileSync(giftsPath, JSON.stringify(formattedGifts, null, 2), 'utf8');
    availableGifts = formattedGifts;
    console.log(`[API] Successfully fetched ${formattedGifts.length} gifts via HTTP Webcast API (roomId: ${roomIdToUse || 'global'})`);
    res.json({ success: true, gifts: formattedGifts });
  } catch (e) {
    console.error('[API] Failed to fetch gifts:', e.message);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Get full config
app.get('/api/config', (req, res) => {
  res.json(effectMap.getConfig());
});

// Save full config (and persist into active game preset)
app.put('/api/config', (req, res) => {
  try {
    effectMap.config = {
      ...effectMap.config,
      ...req.body
    };
    effectMap.save();
    res.json({ success: true, config: effectMap.getConfig() });
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

// ─── Modular Game & Preset Management APIs ────────────────────────────────────
// List all games
app.get('/api/games', (req, res) => {
  res.json(gameDetect.scan());
});

// Switch active game & preset
app.post('/api/games/select', (req, res) => {
  try {
    const { gameId, presetId } = req.body;
    if (!gameId) return res.status(400).json({ error: 'gameId required' });
    const result = effectMap.switchGameAndPreset(gameId, presetId || 'default');
    const fullConfig = effectMap.getConfig();
    const games = gameDetect.scan();
    broadcastDash({
      type: 'game_switched',
      activeGameId: result.activeGameId,
      activePresetId: result.activePresetId,
      config: fullConfig,
      games
    });
    res.json({
      success: true,
      activeGameId: result.activeGameId,
      activePresetId: result.activePresetId,
      config: fullConfig,
      games
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create or update a game manifest
app.post('/api/games/create', (req, res) => {
  try {
    const { id, name, icon, category, driver, inputMethod, targetProcess, rconConfig, description, effects } = req.body;
    const gameId = (id || name || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!gameId || !name) return res.status(400).json({ error: 'Game ID and Name are required' });

    const manifest = gameDetect.saveGameManifest(gameId, {
      id: gameId,
      name,
      icon: icon || '🎮',
      category: category || (driver === 'keystroke' ? 'Keystroke / Macro' : driver === 'rcon' ? 'RCON / Command' : 'Unity Mod (BepInEx)'),
      driver: driver || 'keystroke',
      inputMethod: inputMethod || 'sendinput',
      targetProcess: targetProcess || '',
      rconConfig: rconConfig || null,
      description: description || '',
      effects: effects || {}
    });

    const result = effectMap.switchGameAndPreset(gameId, 'default');
    res.json({
      success: true,
      manifest,
      activeGameId: result.activeGameId,
      config: effectMap.getConfig(),
      games: gameDetect.scan()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a custom game
app.delete('/api/games/:id', (req, res) => {
  try {
    gameDetect.deleteGame(req.params.id);
    if (effectMap.config.activeGameId === req.params.id) {
      effectMap.switchGameAndPreset('CarJunkyard', 'default');
    }
    res.json({
      success: true,
      config: effectMap.getConfig(),
      games: gameDetect.scan()
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Add or update an effect inside a game
app.post('/api/games/:id/effects', (req, res) => {
  try {
    const gameId = req.params.id;
    const manifest = gameDetect.getGameManifest(gameId);
    if (!manifest) return res.status(404).json({ error: 'Game not found' });

    const { id, label, description, category, duration, driver, macro, command } = req.body;
    const effectId = String(id || label || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (!effectId || !label) return res.status(400).json({ error: 'Effect ID and Label required' });

    if (!manifest.effects) manifest.effects = {};
    manifest.effects[effectId] = {
      id: effectId,
      label,
      description: description || '',
      category: category || 'player',
      duration: parseInt(duration) || 0,
      driver: driver || manifest.driver || 'ws-mod',
      macro: macro || '',
      command: command || ''
    };

    gameDetect.saveGameManifest(gameId, manifest);
    effectMap.reload();
    res.json({
      success: true,
      effect: manifest.effects[effectId],
      config: effectMap.getConfig(),
      games: gameDetect.scan()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete an effect from a game
app.delete('/api/games/:id/effects/:effectId', (req, res) => {
  try {
    const gameId = req.params.id;
    const effectId = req.params.effectId;
    const manifest = gameDetect.getGameManifest(gameId);
    if (!manifest || !manifest.effects?.[effectId]) {
      return res.status(404).json({ error: 'Effect not found' });
    }
    delete manifest.effects[effectId];
    gameDetect.saveGameManifest(gameId, manifest);
    effectMap.reload();
    res.json({
      success: true,
      config: effectMap.getConfig(),
      games: gameDetect.scan()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create / Save / Import a Preset for a game
app.post('/api/games/:id/presets', (req, res) => {
  try {
    const gameId = req.params.id;
    const { presetId, name, description, copyFromCurrent, presetData } = req.body;
    const cleanId = String(presetId || name || 'custom').toLowerCase().replace(/[^a-z0-9_-]/g, '-');

    let payload = {};
    if (presetData && typeof presetData === 'object') {
      payload = {
        ...presetData,
        id: cleanId,
        name: name || presetData.name || cleanId,
        gameId
      };
    } else if (copyFromCurrent !== false) {
      const cfg = effectMap.getConfig();
      payload = {
        id: cleanId,
        name: name || cleanId,
        gameId,
        description: description || '',
        giftMappings: cfg.giftMappings || [],
        coinTiers: cfg.coinTiers || [],
        socialEvents: cfg.socialEvents || [],
        eventMappings: cfg.eventMappings || { like: { thresholds: [] } },
        chatCommands: cfg.chatCommands || [],
        donationTiers: cfg.donationTiers || []
      };
    } else {
      payload = {
        id: cleanId,
        name: name || cleanId,
        gameId,
        description: description || '',
        giftMappings: [],
        coinTiers: [],
        socialEvents: [],
        eventMappings: { like: { thresholds: [] } },
        chatCommands: [],
        donationTiers: []
      };
    }

    gameDetect.savePreset(gameId, cleanId, payload);
    const switched = effectMap.switchGameAndPreset(gameId, cleanId);
    res.json({
      success: true,
      activePresetId: switched.activePresetId,
      config: effectMap.getConfig(),
      games: gameDetect.scan()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a preset
app.delete('/api/games/:id/presets/:presetId', (req, res) => {
  try {
    gameDetect.deletePreset(req.params.id, req.params.presetId);
    const switched = effectMap.switchGameAndPreset(req.params.id, 'default');
    res.json({
      success: true,
      activePresetId: switched.activePresetId,
      config: effectMap.getConfig(),
      games: gameDetect.scan()
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Scan running Windows desktop processes (for Keystroke target window picker)
app.get('/api/windows', async (req, res) => {
  const windows = await keystrokeDriver.scanRunningWindows();
  res.json(windows);
});

// ─── Test & Simulation Endpoints ──────────────────────────────────────────────
// Test fire an effect manually
app.post('/api/test-effect', (req, res) => {
  const { effectId, user, source } = req.body;
  if (!effectId) return res.status(400).json({ error: 'effectId required' });

  const effect = effectMap._resolveEffect(effectId) || { id: effectId, effectId, label: effectId, duration: 0 };
  queue.enqueue({
    effectId: effect.id || effectId,
    label: effect.label || effectId,
    duration: effect.duration || 0,
    user: user || 'dashboard-test',
    source: source || 'test',
    data: { macro: effect.macro, command: effect.command }
  });
  res.json({ success: true, effectId, driver: effect.driver });
});

// Built-in Live Event Simulator (Test Gift, Like, Follow, Share, Chat, Donation)
app.post('/api/simulate', (req, res) => {
  const { type, user = 'AgivaTester', giftId = 5655, giftName = 'Rose', coins = 1, count = 100, comment = '!lompat', amount = 10000, platform = 'saweria' } = req.body;
  switch (type) {
    case 'gift':
      handleGift({ uniqueId: user, giftId: Number(giftId), giftName, diamondCount: Number(coins), repeatCount: 1, repeatEnd: true });
      break;
    case 'like':
      handleLike({ uniqueId: user, likeCount: Number(count) || 50 });
      break;
    case 'follow':
      handleFollow({ uniqueId: user });
      break;
    case 'share':
      handleShare({ uniqueId: user });
      break;
    case 'repost':
      handleRepost({ uniqueId: user });
      break;
    case 'chat':
      handleChat({ uniqueId: user, comment });
      break;
    case 'donation':
      handleDonation({ user, amount: Number(amount) || 10000, platform, message: comment });
      break;
    default:
      return res.status(400).json({ error: 'Unknown simulation type' });
  }
  res.json({ success: true, simulated: type });
});

// ─── External Donation Platform Webhooks (Saweria, Sociabuzz, Trakteer, BagiBagi) ──
app.post('/api/webhook/donation/:platform?', (req, res) => {
  const platform = req.params.platform || req.body.platform || 'saweria';
  const body = req.body || {};
  const user = body.donator_name || body.supporter_name || body.supporter || body.name || body.user || 'Anonim';
  const amount = Number(body.amount_raw || body.amount || body.price || body.nominal || 0);
  const message = body.message || body.supporter_message || body.comment || '';

  handleDonation({ user, amount, platform, message });
  res.json({ success: true, platform, user, amount });
});

// Local Interaksi REST API (IndoFinity/StreamDeck compatible trigger)
app.post('/api/v1/interaksi', (req, res) => {
  const { effectId, user = 'LocalAPI' } = req.body;
  if (!effectId) return res.status(400).json({ error: 'effectId required' });
  const effect = effectMap._resolveEffect(effectId);
  queue.enqueue({
    effectId: effect.id || effectId,
    label: effect.label || effectId,
    duration: effect.duration || 0,
    user,
    source: 'local_api'
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
  saveEnvVar('WEBHOOK_URL', url || '');
  saveEnvVar('WEBHOOK_SECRET', secret || '');
  res.json({ success: true, enabled: !!url });
});

// Set API Key (Eulerstream)
app.post('/api/apikey', (req, res) => {
  const { key } = req.body;
  saveEnvVar('EULERSTREAM_API_KEY', key || '');
  res.json({ success: true });
});

// Set Session ID
app.post('/api/sessionid', (req, res) => {
  const { session } = req.body;
  saveEnvVar('TIKTOK_SESSION_ID', session || '');
  res.json({ success: true });
});

// Queue status & clear
app.get('/api/queue', (req, res) => res.json(queue.status));
app.delete('/api/queue', (req, res) => { queue.clear(); res.json({ success: true }); });

// ─── Batch A: Free Indonesian TTS & Soundboard Endpoints ──────────────────────
app.get('/api/tts-sound/config', (req, res) => {
  res.json(audioTtsDriver.getConfig());
});

app.put('/api/tts-sound/config', (req, res) => {
  const updated = audioTtsDriver.saveConfig(req.body || {});
  res.json({ success: true, config: updated });
});

app.get('/api/tts/stream', (req, res) => {
  audioTtsDriver.streamGoogleTts(req.query.text || '', req.query.lang || 'id', res);
});

app.post(['/api/tts/test', '/api/tts/speak'], (req, res) => {
  const text = req.body.text || 'Halo penonton Agiva, ini adalah tes suara Text to Speech Bahasa Indonesia gratis!';
  const spoken = audioTtsDriver.speak(text, {
    voicePreset: req.body.voicePreset || req.body.lang,
    user: req.body.user || 'Streamer'
  }, true);
  res.json({ success: Boolean(spoken), spoken });
});

app.post('/api/soundboard/play', (req, res) => {
  const soundId = req.body.soundId || req.body.id;
  const { screen } = req.body;
  if (!soundId) return res.status(400).json({ error: 'soundId required' });
  const played = audioTtsDriver.playSound(soundId, { screen }, true);
  res.json({ success: Boolean(played), played });
});

app.post(['/api/soundboard/stop', '/api/tts/skip'], (req, res) => {
  audioTtsDriver.stopAllAudio();
  res.json({ success: true });
});

app.post('/api/soundboard/upload', (req, res) => {
  try {
    const item = audioTtsDriver.uploadSound(req.body || {});
    res.json({ success: true, item, config: audioTtsDriver.getConfig() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/soundboard/:id', (req, res) => {
  const ok = audioTtsDriver.deleteSound(req.params.id);
  res.json({ success: ok, config: audioTtsDriver.getConfig() });
});

// ─── Batch A/B: Multi-Screen Overlay & 7 Interactive Stream Widgets Endpoints ─
app.get('/api/widgets', (req, res) => {
  res.json(widgetManager.getState());
});

app.post('/api/widgets/timer', (req, res) => {
  const { action, value, seconds, title, secondsPerCoin } = req.body || {};
  let val = value !== undefined ? value : seconds;
  if (action === 'config' && (!val || typeof val !== 'object')) {
    val = {
      title,
      autoAdd: secondsPerCoin !== undefined ? { secPerCoin: Number(secondsPerCoin) } : undefined
    };
  }
  const timer = widgetManager.controlTimer(action || 'toggle', val, 'Dashboard');
  res.json({ success: true, timer });
});

app.post('/api/widgets/wheel', (req, res) => {
  const wheel = widgetManager.updateWheelConfig(req.body || {});
  res.json({ success: true, wheel });
});
app.put('/api/widgets/wheel', (req, res) => {
  const wheel = widgetManager.updateWheelConfig(req.body || {});
  res.json({ success: true, wheel });
});

app.post('/api/widgets/wheel/spin', (req, res) => {
  const spin = widgetManager.spinWheel(req.body?.user || req.body?.triggeredBy || 'Streamer');
  res.json({ success: true, spin, result: spin });
});

app.post('/api/widgets/goal/:type', (req, res) => {
  const goal = widgetManager.updateGoal(req.params.type, req.body || {});
  if (!goal) return res.status(404).json({ error: 'Invalid goal type' });
  res.json({ success: true, goal });
});
app.post('/api/widgets/goals', (req, res) => {
  const { type = 'coins', reset, ...rest } = req.body || {};
  if (reset) rest.current = 0;
  const goal = widgetManager.updateGoal(type, rest);
  if (!goal) return res.status(404).json({ error: 'Invalid goal type' });
  res.json({ success: true, goal });
});

app.post(['/api/widgets/counter', '/api/widgets/winlose'], (req, res) => {
  const { action, value } = req.body || {};
  const actionMap = {
    add_win: 'win_add',
    sub_win: 'win_sub',
    add_loss: 'lose_add',
    sub_loss: 'lose_sub'
  };
  const counter = widgetManager.controlCounter(actionMap[action] || action || 'win_add', value);
  res.json({ success: true, counter });
});

app.post('/api/widgets/poll', (req, res) => {
  const { action, options, ...rest } = req.body || {};
  if (action === 'stop' || action === 'end') {
    const poll = widgetManager.endPoll();
    return res.json({ success: true, poll });
  }
  const normalizedOptions = Array.isArray(options)
    ? options.map((o, idx) => (typeof o === 'string' ? { key: String(idx + 1), label: o } : o))
    : undefined;
  const poll = widgetManager.startPoll({ ...rest, options: normalizedOptions });
  res.json({ success: true, poll });
});

app.post('/api/widgets/poll/start', (req, res) => {
  const poll = widgetManager.startPoll(req.body || {});
  res.json({ success: true, poll });
});

app.post('/api/widgets/poll/end', (req, res) => {
  const poll = widgetManager.endPoll();
  res.json({ success: true, poll });
});

app.post('/api/widgets/giveaway', (req, res) => {
  const { action, ...rest } = req.body || {};
  const mappedAction = action === 'open' ? 'start' : (action || 'draw');
  const giveaway = widgetManager.controlGiveaway(mappedAction, rest);
  if (giveaway?.error) return res.status(400).json(giveaway);
  res.json({ success: true, giveaway, winner: giveaway.winner });
});

app.post('/api/widgets/leaderboard/reset', (req, res) => {
  widgetManager.resetLeaderboard();
  res.json({ success: true, leaderboard: widgetManager.getLeaderboard() });
});

app.post('/api/overlay/screen/:id/test', (req, res) => {
  const screenId = Number(req.params.id) || 1;
  const alert = widgetManager.triggerScreenAlert(screenId, {
    title: req.body.title || `⚡ Tes Alert Screen ${screenId}`,
    subtitle: req.body.subtitle || 'Agiva Multi-Screen Overlay Ready!',
    mediaUrl: req.body.mediaUrl || '',
    soundUrl: req.body.soundUrl || '/sounds/coin_jackpot.wav',
    durationMs: req.body.durationMs || 4000
  });
  res.json({ success: true, alert });
});

// ─── Batch B: Compatibility Ports (:62024 WS, :62025 Socket, :62030 API) ─────
app.get('/api/compat-ports', (req, res) => {
  res.json(compatBridge.getStatus());
});

app.post('/api/compat-ports', async (req, res) => {
  try {
    const status = await compatBridge.setEnabled(req.body.enabled, req.body.ports);
    broadcastDash({ type: 'compat_ports', status });
    res.json({ success: true, status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.put('/api/compat-ports', async (req, res) => {
  try {
    const status = await compatBridge.setEnabled(req.body.enabled, req.body.ports);
    broadcastDash({ type: 'compat_ports', status });
    res.json({ success: true, status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Batch B: Direct Donation Stream Keys & Kurs Rupiah-ke-Koin ──────────────
app.get('/api/donations/config', (req, res) => {
  res.json(donationSocketProvider.getStatus());
});

app.put('/api/donations/config', (req, res) => {
  const status = donationSocketProvider.saveConfig(req.body || {});
  res.json({ success: true, status });
});

app.post('/api/donations/test', (req, res) => {
  const { platform = 'saweria', user = 'Sultan_Saweria', amount = 25000, message = 'Semangat live-nya!' } = req.body || {};
  const coinsEquivalent = donationSocketProvider.convertIdrToCoins(Number(amount) || 25000);
  handleDonation({ platform, user, amount: Number(amount) || 25000, message, coinsEquivalent });
  res.json({
    success: true,
    donation: { platform, user, amount: Number(amount) || 25000, message, coinsEquivalent }
  });
});

// ─── Batch B/C: Desktop HUD, Global Hotkeys & One-Click TikTok Login ─────────
app.get('/api/desktop/status', (req, res) => {
  const desk = global.agivaElectronBridge
    ? global.agivaElectronBridge.getStatus()
    : { isElectron: false, hudOpen: false, hudLocked: false };
  res.json({ ...desk, hotkeys: hotkeysConfig });
});

app.post(['/api/desktop/hud', '/api/electron/hud'], (req, res) => {
  const { action, locked } = req.body || {};
  if (global.agivaElectronBridge) {
    let status;
    if (action === 'lock') {
      status = global.agivaElectronBridge.setHudLock(locked !== undefined ? locked : true);
    } else {
      status = global.agivaElectronBridge.toggleFloatingHud(action || 'toggle');
    }
    return res.json({ success: true, ...status });
  }
  res.json({
    success: false,
    isElectron: false,
    fallbackUrl: `/overlay?widget=hud`
  });
});

app.post('/api/desktop/hotkeys', (req, res) => {
  hotkeysConfig = { ...hotkeysConfig, ...(req.body || {}) };
  try {
    const dir = path.dirname(HOTKEYS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HOTKEYS_PATH, JSON.stringify(hotkeysConfig, null, 2), 'utf8');
  } catch {}
  if (global.agivaElectronBridge) {
    global.agivaElectronBridge.registerHotkeys(hotkeysConfig, handleHotkeyTriggered);
  }
  res.json({ success: true, hotkeys: hotkeysConfig });
});

app.post(['/api/desktop/ttlogin', '/api/electron/tiktok-login'], (req, res) => {
  if (global.agivaElectronBridge) {
    global.agivaElectronBridge.openTikTokLogin((sessionId) => {
      saveEnvVar('TIKTOK_SESSION_ID', sessionId);
      broadcastDash({ type: 'tiktok_session_captured', sessionId });
    });
    return res.json({ success: true, mode: 'electron' });
  }
  res.json({ success: false, mode: 'browser', error: 'Fitur Auto-Login Window memerlukan aplikasi dijalankan via Electron (npm run app).' });
});

// ─── Batch C: OBS Studio WebSocket v5 Endpoints ──────────────────────────────
app.get('/api/obs/status', (req, res) => {
  res.json(obsDriver.getStatus());
});

app.post('/api/obs/connect', async (req, res) => {
  try {
    const status = await obsDriver.connect(req.body || {});
    res.json({ success: true, status });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/obs/disconnect', (req, res) => {
  obsDriver.disconnect();
  res.json({ success: true, status: obsDriver.getStatus() });
});

app.post('/api/obs/action', async (req, res) => {
  try {
    const { type, sceneName, sourceName, filterName, inputName, durationSec = 5 } = req.body || {};
    if (type === 'scene') {
      await obsDriver.switchSceneTemporary(sceneName, Number(durationSec) || 0, true);
    } else if (type === 'filter') {
      await obsDriver.toggleFilterTemporary(sourceName, filterName, Number(durationSec) || 8, true);
    } else if (type === 'mute') {
      await obsDriver.toggleMuteTemporary(inputName, Number(durationSec) || 10, true);
    }
    res.json({ success: true, status: obsDriver.getStatus() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── Batch C: Persistent Session Analytics & CSV Export ───────────────────────
app.get('/api/analytics', (req, res) => {
  res.json(sessionStore.getSummary());
});

app.post(['/api/analytics/reset', '/api/analytics/new-session'], (req, res) => {
  res.json({ success: true, analytics: sessionStore.resetSession() });
});

app.get('/api/analytics/export.csv', (req, res) => {
  const csv = sessionStore.exportCsv();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="agiva_session_${sessionStore.data.date}.csv"`);
  res.send(csv);
});

// ─── Update Checker & System Integrations ────────────────────────────────────
app.get('/api/update/check', async (req, res) => {
  try {
    const info = await updater.checkForUpdates({ force: req.query.force === '1' });
    res.json(info);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Trigger In-App Download and Auto-Update
app.post('/api/update/apply', async (req, res) => {
  const { downloadUrl } = req.body || {};
  if (!downloadUrl) {
    return res.status(400).json({ error: 'downloadUrl is required' });
  }

  res.json({ success: true, message: 'Proses unduhan dimulai...' });

  try {
    broadcastDash({
      type: 'update_progress',
      percent: 0,
      receivedMB: '0.0',
      totalMB: '...',
      status: 'Memulai unduhan...'
    });

    const result = await updater.downloadAndApplyUpdate(downloadUrl, (progress) => {
      broadcastDash({
        type: 'update_progress',
        ...progress,
        status: `Mengunduh (${progress.percent}%)...`
      });
    });

    broadcastDash({
      type: 'update_ready',
      message: 'Unduhan selesai! Menyiapkan aplikasi dan me-restart...',
      ...result
    });
  } catch (err) {
    console.error('[Updater] Auto-update failed:', err.message);
    broadcastDash({
      type: 'update_error',
      message: 'Gagal mengunduh atau memasang pembaruan: ' + err.message
    });
  }
});

// Set custom presets / games directory
app.post('/api/settings/presets-folder', (req, res) => {
  const { folderPath } = req.body || {};
  if (!folderPath || typeof folderPath !== 'string') {
    return res.status(400).json({ error: 'folderPath string required' });
  }
  try {
    const cleanPath = path.resolve(folderPath.trim());
    gameDetect.setGamesDir(cleanPath);
    saveEnvVar('GAMES_DIR', cleanPath);
    const scannedGames = gameDetect.scan();
    broadcastDash({ type: 'games_updated', games: scannedGames, presetsFolder: cleanPath });
    res.json({ success: true, folderPath: cleanPath, games: scannedGames });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Dialog to select folder (Electron)
app.post('/api/dialog/select-folder', async (req, res) => {
  if (global.agivaElectronBridge && typeof global.agivaElectronBridge.selectFolder === 'function') {
    const result = await global.agivaElectronBridge.selectFolder(req.body?.defaultPath);
    return res.json({ success: true, ...result, mode: 'electron' });
  }
  res.json({ success: false, mode: 'web', error: 'Dialog folder hanya aktif saat aplikasi dijalankan via Desktop/Portable.' });
});

app.post('/api/open-external', (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });
  if (global.agivaElectronBridge && typeof global.agivaElectronBridge.openExternal === 'function') {
    const opened = global.agivaElectronBridge.openExternal(url);
    return res.json({ success: true, opened, mode: 'electron' });
  }
  res.json({ success: true, opened: false, mode: 'browser', url });
});

// ─── Redirect root to dashboard ───────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/dashboard'));

// ─── Start Servers ────────────────────────────────────────────────────────────
httpServer.listen(DASHBOARD_PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║   🎮 Agiva Universal Streamer Mod Bridge — v1.3.1      ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log(`  📊 Dashboard:   http://localhost:${DASHBOARD_PORT}/dashboard`);
  console.log(`  📺 OBS Overlay: http://localhost:${DASHBOARD_PORT}/overlay`);
  console.log(`  🔌 Mod WS:      ws://localhost:${MOD_WS_PORT}`);
  console.log(`  💸 Webhook In:  http://localhost:${DASHBOARD_PORT}/api/webhook/donation/saweria`);
  console.log('');
  const detected = gameDetect.scan();
  console.log(`  🎯 Available games (${detected.length}): ${detected.map(g => g.name).join(', ')}`);
  console.log(`  🗂️  Active Game:     ${effectMap.getConfig().activeGameId} [Preset: ${effectMap.getConfig().activePresetId}]`);
  console.log('');

  // Auto-connect if username is set in .env
  if (currentUsername) {
    console.log(`  🔗 Auto-connecting to @${currentUsername} (${connectionMode})...`);
    connectTikTok(currentUsername, connectionMode).catch(e => console.error('Auto-connect failed:', e.message));
  }

  // Background check for updates after launch
  setTimeout(async () => {
    try {
      const updateInfo = await updater.checkForUpdates();
      if (updateInfo && updateInfo.hasUpdate) {
        console.log(`[Updater] ✨ Update available: v${updateInfo.latestVersion} (Current: v${updateInfo.currentVersion})`);
        broadcastDash({ type: 'update_available', update: updateInfo });
      }
    } catch {}
  }, 4000);
});
