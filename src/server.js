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
const ActionEngine = require('./core/actionEngine');
const PointsManager = require('./points/pointsManager');
const ChatbotDriver = require('./drivers/chatbotDriver');
const IntervalScheduler = require('./core/intervalScheduler');
const SpotifyDriver = require('./integrations/spotifyDriver');
const StreamerBotDriver = require('./integrations/streamerBotDriver');
const VoicemodDriver = require('./integrations/voicemodDriver');

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
let roomStats = { viewers: 0, likes: 0, gifts: 0, followers: 0, shares: 0, reposts: 0, subscribers: 0, donations: 0 };
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
      } else if (msg.type === 'game_event') {
        if (msg.event === 'win') {
          widgetManager.controlCounter('win_add', Math.abs(Number(msg.delta) || 1));
          pushEvent({ time: Date.now(), type: 'system', user: msg.gameId || 'Game', message: `GAME CLEARED! WIN +1 (${msg.wins}/${msg.target})` });
        } else if (msg.event === 'reset') {
          widgetManager.controlCounter('lose_add', 1);
          pushEvent({ time: Date.now(), type: 'system', user: msg.gameId || 'Game', message: `GAME RESET! WIN -1 (${msg.wins}/${msg.target})` });
        }
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

function enqueueEffectById(effectId, user = 'System', source = 'widget', extraData = {}, priority = 'normal') {
  if (!effectId) return;
  const resolved = effectMap._resolveEffect(effectId);
  if (!resolved) return;
  queue.enqueue({
    effectId: resolved.id || effectId,
    label: resolved.label || effectId,
    duration: resolved.duration || 0,
    lane: resolved.driver || 'ws-mod',
    priority,
    user,
    source,
    data: { macro: resolved.macro, command: resolved.command, ...extraData }
  });
}

let actionEngine = null;

const widgetManager = new WidgetManager({
  broadcastFn: broadcastDash,
  triggerEffectFn: enqueueEffectById,
  triggerActionFn: (actionId, vars) => actionEngine?.executeAction(actionId, vars)
});

const obsDriver = new ObsDriver(broadcastDash);

actionEngine = new ActionEngine({
  effectMap,
  audioTtsDriver,
  widgetManager,
  obsDriver,
  webhook,
  enqueueEffectFn: enqueueEffectById,
  broadcastFn: broadcastDash
});

const pointsManager = new PointsManager({ broadcastFn: broadcastDash });
const chatbotDriver = new ChatbotDriver({ broadcastFn: broadcastDash, effectMap });
const intervalScheduler = new IntervalScheduler({
  isLiveFn: () => isConnected,
  executeActionFn: (actionId, vars) => actionEngine?.executeAction(actionId, vars),
  sendChatFn: (msg, vars) => chatbotDriver.sendMessage(msg, vars, { tiktokConn: tiktokConnection }),
  startDropFn: (opts) => pointsManager.startDrop(opts),
  broadcastFn: broadcastDash
});

const compatBridge = new CompatBridgeServer({
  widgetManager,
  audioTtsDriver,
  effectMap,
  triggerEffectFn: enqueueEffectById
});

const spotifyDriver = new SpotifyDriver({ broadcastFn: broadcastDash });
const streamerBotDriver = new StreamerBotDriver({
  broadcastFn: broadcastDash,
  onInboundActionFn: (cmd) => {
    if (!cmd) return;
    if (cmd.effectId) enqueueEffectById(cmd.effectId, cmd.user || 'StreamerBot', 'streamerbot');
    if (cmd.ttsText) audioTtsDriver.speak(String(cmd.ttsText), { user: 'StreamerBot' }, true);
    if (cmd.soundId) audioTtsDriver.playSound(String(cmd.soundId));
    if (cmd.actionId && actionEngine) actionEngine.executeAction(String(cmd.actionId), cmd).catch(() => {});
  }
});
const voicemodDriver = new VoicemodDriver({ broadcastFn: broadcastDash });

const donationSocketProvider = new DonationSocketProvider((donData) => {
  handleDonation(donData);
});

// Global Hotkeys configuration
const HOTKEYS_PATH = paths.HOTKEYS_PATH;
let hotkeysConfig = {
  toggle_all: 'Alt+P',
  clear_queue: 'Alt+C',
  skip_tts: 'Alt+S',
  toggle_hud: 'Alt+H',
  toggle_hud_lock: 'Alt+L',
  spin_wheel: 'Alt+W',
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
  } else if (action === 'toggle_hud') {
    if (global.agivaElectronBridge) {
      global.agivaElectronBridge.toggleFloatingHud('toggle');
    }
  } else if (action === 'spin_wheel') {
    widgetManager.spinWheel('Hotkey');
  } else if (action === 'win_add') {
    widgetManager.controlCounter('win_add', 1);
  } else if (action === 'lose_add') {
    widgetManager.controlCounter('lose_add', 1);
  } else if (String(action).startsWith('sound:')) {
    const soundId = String(action).slice(6);
    if (soundId) {
      audioTtsDriver.playSound(soundId, {}, effectMap.masterSwitches.tts !== false);
    }
  }
}

function registerAllHotkeys() {
  if (!global.agivaElectronBridge) return;
  const merged = { ...hotkeysConfig };
  const items = audioTtsDriver.getConfig()?.soundboard?.items || [];
  for (const item of items) {
    if (item && item.id && item.hotkey) {
      merged[`sound:${item.id}`] = item.hotkey;
    }
  }
  global.agivaElectronBridge.registerHotkeys(merged, handleHotkeyTriggered);
}

registerAllHotkeys();

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

  // 6. Broadcast to Compatibility Ports (:62024 / :62025 / :21213), Streamer.bot & Session Analytics
  compatBridge.broadcastEvent('interaksi', {
    effectId: item.effectId,
    label: item.label || resolved?.label || item.effectId,
    user: item.user,
    source: item.source,
    gameId: resolved?.gameId
  });
  streamerBotDriver.onStreamEvent('effect', {
    effectId: item.effectId,
    user: item.user,
    gameId: resolved?.gameId || effectMap.getConfig().activeGameId
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
  const avatar = u.profilePictureUrl || data?.profilePictureUrl || u.avatarThumb?.urlList?.[0] || '';
  return { uniqueId, user: uniqueId, nickname, avatar, followRole, isFollower, isSubscribe, isModerator, isAdmin: isModerator, gifterLevel };
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

  const chainedAction = chain.actionId && actionEngine
    ? actionEngine.data?.actions?.find(a => a.id === chain.actionId)
    : null;
  const actionHandlesScreen = Boolean(chainedAction?.steps?.some(s => s && s.type === 'screen_alert'));

  if (
    chain.overlayScreen &&
    chain.overlayScreen >= 1 &&
    (!actionHandlesScreen || chain.overlayMediaUrl) &&
    (!effect.skipGameEffect || chain.overlayMediaUrl)
  ) {
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
  if (chain.actionId && actionEngine) {
    actionEngine.executeAction(chain.actionId, vars).catch(() => {});
  }
}

function enqueueGameEffect(effect, queuePayload = {}) {
  if (!effect || effect.skipGameEffect || !effect.id || effect.id === '__none__') {
    return false;
  }
  return queue.enqueue({
    effectId: effect.id,
    label: effect.label,
    duration: effect.duration || 0,
    lane: effect.driver || 'ws-mod',
    ...queuePayload
  });
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
  const giftImage = knownGift?.image || data.giftPictureUrl || '';
  const event = { time: Date.now(), type: 'gift', user, giftName, coins, giftId: data.giftId, repeatCount, avatar: userMeta.avatar, giftImage };
  pushEvent(event);
  broadcastDash({ type: 'stats', roomStats });
  broadcastDash({
    type: 'gift_fx',
    user,
    nickname: userMeta.nickname,
    giftName,
    giftId: data.giftId,
    coins,
    repeatCount,
    avatar: userMeta.avatar,
    giftImage
  });

  // Update Widgets, Points, Chatbot, Session Analytics & Compat Bridge
  widgetManager.onGift({ user, coins, giftName, giftId: data.giftId, repeatCount, avatar: userMeta.avatar });
  pointsManager.onGift({ user, nickname: userMeta.nickname, coins, isSub: userMeta.isSubscribe });
  chatbotDriver.onGift({ user, nickname: userMeta.nickname, giftName, coins }, { tiktokConn: tiktokConnection });
  sessionStore.recordGift({ user, giftName, giftId: data.giftId, coins, repeatCount });
  compatBridge.broadcastEvent('gift', event);
  streamerBotDriver.onStreamEvent('gift', { user, nickname: userMeta.nickname, giftName, giftId: data.giftId, coins, repeatCount });

  // Automatic Gift TTS if enabled in TTS config
  const ttsCfg = audioTtsDriver.config.tts;
  if (ttsCfg.enabled && ttsCfg.readGifts && coins >= (Number(ttsCfg.minGiftCoinsForTts) || 1)) {
    const msg = audioTtsDriver.formatTemplate(ttsCfg.giftTemplate, { nickname: userMeta.nickname, user, giftName, coins, repeatCount });
    audioTtsDriver.speak(msg, { user }, effectMap.masterSwitches.tts !== false);
  }

  const vars = { user, nickname: userMeta.nickname, giftName, giftId: data.giftId, coins, repeatCount };
  if (actionEngine) {
    actionEngine.dispatchEvent('gift', vars, userMeta);
    actionEngine.dispatchEvent('coin_range', vars, userMeta);
  }

  const effect = effectMap.resolveGiftById(data.giftId, coins, userMeta);
  if (!effect) {
    console.log(`[Gift] No mapping for gift ID ${data.giftId} (${giftName}, ${coins}💎)`);
    return;
  }

  executeChainedActions(effect, vars);

  const times = effect.chainActions?.multiplyByRepeat ? Math.min(10, Math.max(1, repeatCount)) : 1;
  if (effect.skipGameEffect) {
    console.log(`[Gift] ${user} → ${giftName} (${coins}💎) → [Multi-Action Only]`);
  } else {
    console.log(`[Gift] ${user} → ${giftName} (${coins}💎) → ${effect.id}${times > 1 ? ` (x${times})` : ''}`);
    for (let i = 0; i < times; i++) {
      enqueueGameEffect(effect, {
        user,
        source: 'gift',
        priority: coins >= 100 ? 'high' : 'normal',
        data: { giftName, coins, giftId: data.giftId, repeatCount }
      });
    }
  }
}

function handleFollow(data) {
  const userMeta = extractUserMeta(data);
  const user = userMeta.uniqueId;
  roomStats.followers++;
  const ev = { time: Date.now(), type: 'follow', user };
  pushEvent(ev);
  broadcastDash({ type: 'stats', roomStats });

  widgetManager.onFollow({ user, avatar: userMeta.avatar });
  pointsManager.onFollow({ user, nickname: userMeta.nickname, isSub: userMeta.isSubscribe });
  chatbotDriver.onFollow({ user, nickname: userMeta.nickname }, { tiktokConn: tiktokConnection });
  sessionStore.recordFollow();
  compatBridge.broadcastEvent('follow', ev);

  if (audioTtsDriver.config.tts.enabled && audioTtsDriver.config.tts.readFollows) {
    const msg = audioTtsDriver.formatTemplate(audioTtsDriver.config.tts.followTemplate, { nickname: userMeta.nickname, user });
    audioTtsDriver.speak(msg, { user }, effectMap.masterSwitches.tts !== false);
  }

  const vars = { user, nickname: userMeta.nickname };
  if (actionEngine) actionEngine.dispatchEvent('follow', vars, userMeta);

  const effects = effectMap.resolveEvent('follow', userMeta);
  for (const effect of effects) {
    executeChainedActions(effect, vars);
    if (!effect.skipGameEffect) {
      console.log(`[Follow] ${user} → ${effect.id}`);
      enqueueGameEffect(effect, { user, source: 'follow' });
    }
  }
}

function handleShare(data) {
  const userMeta = extractUserMeta(data);
  const user = userMeta.uniqueId;
  roomStats.shares++;
  const ev = { time: Date.now(), type: 'share', user };
  pushEvent(ev);
  broadcastDash({ type: 'stats', roomStats });

  widgetManager.onShare({ user, avatar: userMeta.avatar });
  pointsManager.onShare({ user, nickname: userMeta.nickname, isSub: userMeta.isSubscribe });
  sessionStore.recordShare();
  compatBridge.broadcastEvent('share', ev);

  const vars = { user, nickname: userMeta.nickname };
  if (actionEngine) actionEngine.dispatchEvent('share', vars, userMeta);

  const effects = effectMap.resolveEvent('share', userMeta);
  for (const effect of effects) {
    executeChainedActions(effect, vars);
    if (!effect.skipGameEffect) {
      console.log(`[Share] ${user} → ${effect.id}`);
      enqueueGameEffect(effect, { user, source: 'share' });
    }
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

  const vars = { user, nickname: userMeta.nickname };
  if (actionEngine) actionEngine.dispatchEvent('repost', vars, userMeta);

  const effects = effectMap.resolveEvent('repost', userMeta);
  for (const effect of effects) {
    executeChainedActions(effect, vars);
    if (!effect.skipGameEffect) {
      console.log(`[Repost] ${user} → ${effect.id}`);
      enqueueGameEffect(effect, { user, source: 'repost' });
    }
  }
}

function handleMember(data) {
  const userMeta = extractUserMeta(data);
  const user = userMeta.uniqueId;
  const ev = { time: Date.now(), type: 'member', user };
  pushEvent(ev);
  compatBridge.broadcastEvent('member', ev);

  const vars = { user, nickname: userMeta.nickname };
  chatbotDriver.onMember(vars, { tiktokConn: tiktokConnection });
  if (actionEngine) actionEngine.dispatchEvent('member', vars, userMeta);

  const effects = effectMap.resolveEvent('member', userMeta);
  for (const effect of effects) {
    executeChainedActions(effect, vars);
    enqueueGameEffect(effect, { user, source: 'member' });
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
  broadcastDash({ type: 'like_fx', user, nickname: userMeta.nickname, count });

  widgetManager.onLike({ user, count, avatar: userMeta.avatar });
  pointsManager.onLike({ user, nickname: userMeta.nickname, count, isSub: userMeta.isSubscribe });
  sessionStore.recordLike({ user, count });
  compatBridge.broadcastEvent('like', ev);

  const vars = { user, nickname: userMeta.nickname, count };
  if (actionEngine) actionEngine.dispatchEvent('like', vars, userMeta);

  // Resolve Like Goal Incremental Thresholds
  const effects = effectMap.resolveLikes(count);
  for (const effect of effects) {
    executeChainedActions(effect, vars);
    enqueueGameEffect(effect, { user, source: 'like', data: { count } });
  }

  // Resolve standard 'like' social event (triggers on every like batch)
  const socialEffects = effectMap.resolveEvent('like', userMeta);
  for (const effect of socialEffects) {
    executeChainedActions(effect, vars);
    enqueueGameEffect(effect, { user, source: 'like_event', data: { count } });
  }
}

function handleChat(data) {
  const userMeta = extractUserMeta(data);
  const user = userMeta.uniqueId;
  const comment = data.comment || data.content || data.text || '';
  if (!comment) return;

  const ev = { time: Date.now(), type: 'chat', user, comment, role: userMeta, avatar: userMeta.avatar };
  pushEvent(ev);

  const emojiMatches = comment.match(/\p{Extended_Pictographic}/gu);
  if (emojiMatches && emojiMatches.length > 0) {
    broadcastDash({ type: 'emoji_fx', user, emojis: emojiMatches.slice(0, 8), emoteUrl: '' });
  }

  widgetManager.onChat({ user, comment, avatar: userMeta.avatar });
  pointsManager.onChat({ user, nickname: userMeta.nickname, isSub: userMeta.isSubscribe });
  sessionStore.recordChat();
  compatBridge.broadcastEvent('chat', ev);

  const vars = { user, nickname: userMeta.nickname, comment };

  // Economy Commands (!score, !transfer, !gamble, !spin, !get, !help)
  pointsManager.handleEconomyCommand(comment, userMeta, {
    spinWheelFn: (u) => widgetManager.spinWheel(u),
    replyFn: (msg) => chatbotDriver.sendMessage(msg, vars, { tiktokConn: tiktokConnection })
  });

  // Active Chatbot custom commands
  chatbotDriver.handleIncomingChat(comment, userMeta, vars, pointsManager, { tiktokConn: tiktokConnection }).catch(() => {});

  // Spotify & Standalone Song Request Commands (!play, !sr, !skip, !revoke, !song)
  spotifyDriver.handleChatCommand(comment, userMeta, {
    pointsManager,
    replyFn: (msg) => chatbotDriver.sendMessage(msg, vars, { tiktokConn: tiktokConnection })
  }).catch(() => {});
  streamerBotDriver.onStreamEvent('chat', { user, nickname: userMeta.nickname, comment });

  // Check Chat TTS (!tts or all chat mode) with optional Points cost
  audioTtsDriver.handleChatTts({ ...userMeta, comment }, effectMap.masterSwitches.tts !== false, {
    beforeSpeak: () => {
      const ttsCost = Number(pointsManager.config.ttsCostPoints) || 0;
      if (ttsCost <= 0) return true;
      const spent = pointsManager.spendPoints(user, ttsCost, 'tts_chat', { nickname: userMeta.nickname });
      if (!spent.ok) {
        chatbotDriver.sendMessage(`@${userMeta.nickname || user} ${spent.error}`, vars, { tiktokConn: tiktokConnection }).catch(() => {});
        return false;
      }
      return true;
    }
  });

  if (actionEngine) actionEngine.dispatchEvent('chat', vars, userMeta);

  const effect = effectMap.resolveChatCommand(comment, userMeta);
  if (effect) {
    const cmdCost = Number(effect.chainActions?.costPoints) || 0;
    if (cmdCost > 0) {
      const spent = pointsManager.spendPoints(user, cmdCost, `chat_cmd_${effect.id}`, { nickname: userMeta.nickname });
      if (!spent.ok) {
        chatbotDriver.sendMessage(`@${userMeta.nickname || user} ${spent.error}`, vars, { tiktokConn: tiktokConnection }).catch(() => {});
        return;
      }
    }
    executeChainedActions(effect, vars);
    if (!effect.skipGameEffect) {
      console.log(`[ChatCmd] ${user} ("${comment}") → ${effect.id}`);
      enqueueGameEffect(effect, { user, source: 'chat', data: { comment } });
    }
  }
}

function handleSubscribe(data) {
  const userMeta = extractUserMeta(data);
  const user = userMeta.uniqueId;
  const subMonth = Number(data.subMonth || data.months || 1);
  roomStats.subscribers = (roomStats.subscribers || 0) + 1;
  const ev = { time: Date.now(), type: 'subscribe', user, subMonth };
  pushEvent(ev);
  broadcastDash({ type: 'stats', roomStats });

  widgetManager.onSubscribe({ user, avatar: userMeta.avatar });
  pointsManager.onSubscribe({ user, nickname: userMeta.nickname });
  compatBridge.broadcastEvent('subscribe', ev);

  const vars = { user, nickname: userMeta.nickname, subMonth };
  if (actionEngine) actionEngine.dispatchEvent('subscribe', vars, userMeta);

  const effects = effectMap.resolveEvent('subscribe', userMeta);
  for (const effect of effects) {
    executeChainedActions(effect, vars);
    enqueueGameEffect(effect, { user, source: 'subscribe', priority: 'high' });
  }
}

function handleEmote(data) {
  const userMeta = extractUserMeta(data);
  const user = userMeta.uniqueId;
  const emoteId = data.emoteId || data.emote?.emoteId || '';
  const emoteUrl = data.emoteImageUrl || data.emote?.image?.url_list?.[0] || '';
  const ev = { time: Date.now(), type: 'emote', user, emoteId, emoteUrl };
  pushEvent(ev);
  broadcastDash({ type: 'emoji_fx', user, emoteUrl, emojis: [] });
  compatBridge.broadcastEvent('emote', ev);

  const vars = { user, nickname: userMeta.nickname, emoteId, emoteUrl };
  if (actionEngine) actionEngine.dispatchEvent('emote', vars, userMeta);

  const effects = effectMap.resolveEvent('emote', userMeta);
  for (const effect of effects) {
    executeChainedActions(effect, vars);
    enqueueGameEffect(effect, { user, source: 'emote' });
  }
}

function handleEnvelope(data) {
  const userMeta = extractUserMeta(data);
  const user = userMeta.uniqueId;
  const coins = Number(data.envelopeInfo?.businessType || data.coins || 1);
  const ev = { time: Date.now(), type: 'envelope', user, coins };
  pushEvent(ev);
  compatBridge.broadcastEvent('envelope', ev);

  const vars = { user, nickname: userMeta.nickname, coins };
  if (actionEngine) actionEngine.dispatchEvent('envelope', vars, userMeta);

  const effects = effectMap.resolveEvent('envelope', userMeta);
  for (const effect of effects) {
    executeChainedActions(effect, vars);
    enqueueGameEffect(effect, { user, source: 'envelope' });
  }
}

function handleQuestion(data) {
  const userMeta = extractUserMeta(data);
  const user = userMeta.uniqueId;
  const comment = data.questionText || data.content || '';
  const ev = { time: Date.now(), type: 'question', user, comment };
  pushEvent(ev);
  compatBridge.broadcastEvent('questionNew', ev);
  if (actionEngine) actionEngine.dispatchEvent('questionNew', { user, nickname: userMeta.nickname, comment }, userMeta);
}

function handleBattle(data) {
  const user = data?.anchorInfo?.nickname || 'PK Battle';
  const ev = { time: Date.now(), type: 'battle', user, battleId: data?.battleId || '' };
  pushEvent(ev);
  compatBridge.broadcastEvent('linkMicBattle', ev);
  if (actionEngine) actionEngine.dispatchEvent('linkMicBattle', { user, nickname: user }, { uniqueId: user });
}

function emitLiveStatus(status, username) {
  const ev = { time: Date.now(), type: 'live_status', user: username || currentUsername || 'Streamer', status };
  pushEvent(ev);
  compatBridge.broadcastEvent('liveStatusChange', { status, username: ev.user });
  if (actionEngine) {
    actionEngine.dispatchEvent('liveStatusChange', { user: ev.user, nickname: ev.user, status }, { uniqueId: ev.user });
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
  pointsManager.onDonation({ user, nickname: user, amount });
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

  const vars = { user, nickname: user, amount, platform, comment: message };
  if (actionEngine) actionEngine.dispatchEvent('donation', vars, { uniqueId: user });

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

  executeChainedActions(effect, vars);
  if (effect.skipGameEffect) {
    console.log(`[Donation] ${user} (${platform}: Rp ${amount}) → [Multi-Action Only]`);
  } else {
    console.log(`[Donation] ${user} (${platform}: Rp ${amount}) → ${effect.id}`);
    enqueueGameEffect(effect, {
      user,
      source: platform,
      priority: amount >= 25000 ? 'high' : 'normal',
      data: { amount, platform, message }
    });
  }
}

function handleRoomUser(data) {
  const viewers = data.viewerCount ?? data.total;
  if (viewers !== undefined) {
    roomStats.viewers = Number(viewers);
    sessionStore.recordViewers(roomStats.viewers);
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
      tiktokConnection.on?.('error', () => {});
      if (typeof tiktokConnection.disconnect === 'function') tiktokConnection.disconnect();
      else if (tiktokConnection.readyState === WebSocket.OPEN && typeof tiktokConnection.close === 'function') tiktokConnection.close();
      else if (typeof tiktokConnection.terminate === 'function') tiktokConnection.terminate();
    } catch {}
    tiktokConnection = null;
  }
  isConnected = false;
  currentUsername = username;
  if (requestedMode) connectionMode = requestedMode;
  sendToMod({ type: 'auth', username: currentUsername });
  roomStats = { viewers: 0, likes: 0, gifts: 0, followers: 0, shares: 0, reposts: 0, subscribers: 0, donations: roomStats.donations || 0 };
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
    emitLiveStatus('connected', username);

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
            handleLike({ ...msg.data, uniqueId: msg.data.user?.uniqueId, likeCount: likes });
          } else if (msg.type === 'WebcastSocialMessage' && msg.data) {
            hasEstablishedConnection = true;
            if (String(msg.data.action) === '1') {
              handleFollow({ ...msg.data, uniqueId: msg.data.user?.uniqueId });
            } else if (String(msg.data.action) === '3') {
              handleShare({ ...msg.data, uniqueId: msg.data.user?.uniqueId });
            } else {
              handleRepost({ ...msg.data, uniqueId: msg.data.user?.uniqueId });
            }
          } else if (msg.type === 'WebcastMemberMessage' && msg.data) {
            hasEstablishedConnection = true;
            handleMember({ ...msg.data, uniqueId: msg.data.user?.uniqueId });
          } else if (msg.type === 'WebcastChatMessage' && msg.data) {
            hasEstablishedConnection = true;
            handleChat({ ...msg.data, uniqueId: msg.data.user?.uniqueId, comment: msg.data.comment });
          } else if (msg.type === 'WebcastRoomUserSeqMessage' && msg.data) {
            hasEstablishedConnection = true;
            handleRoomUser({ viewerCount: msg.data.total || msg.data.viewerCount });
          } else if (msg.type === 'WebcastSubNotifyMessage' && msg.data) {
            hasEstablishedConnection = true;
            handleSubscribe({ ...msg.data, uniqueId: msg.data.user?.uniqueId });
          } else if (msg.type === 'WebcastEmoteChatMessage' && msg.data) {
            hasEstablishedConnection = true;
            handleEmote({ ...msg.data, uniqueId: msg.data.user?.uniqueId });
          } else if (msg.type === 'WebcastEnvelopeMessage' && msg.data) {
            hasEstablishedConnection = true;
            handleEnvelope({ ...msg.data, uniqueId: msg.data.user?.uniqueId });
          } else if (msg.type === 'WebcastQuestionNewMessage' && msg.data) {
            hasEstablishedConnection = true;
            handleQuestion({ ...msg.data, uniqueId: msg.data.user?.uniqueId });
          } else if ((msg.type === 'WebcastLinkMicBattle' || msg.type === 'WebcastLinkMicArmies') && msg.data) {
            hasEstablishedConnection = true;
            handleBattle(msg.data);
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
        emitLiveStatus('disconnected', currentUsername);
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
    conn.on('subscribe', (data) => handleSubscribe(data));
    conn.on('emote', (data) => handleEmote(data));
    conn.on('envelope', (data) => handleEnvelope(data));
    conn.on('questionNew', (data) => handleQuestion(data));
    conn.on('linkMicBattle', (data) => handleBattle(data));
    conn.on('linkMicArmies', (data) => handleBattle(data));
    emitLiveStatus('connected', username);
    conn.on('streamEnd', () => {
      if (tiktokConnection !== conn) return;
      isConnected = false;
      emitLiveStatus('streamEnd', currentUsername);
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
      tiktokConnection.on?.('error', () => {});
      if (typeof tiktokConnection.disconnect === 'function') tiktokConnection.disconnect();
      else if (tiktokConnection.readyState === WebSocket.OPEN && typeof tiktokConnection.close === 'function') tiktokConnection.close();
      else if (typeof tiktokConnection.terminate === 'function') tiktokConnection.terminate();
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
app.use('/remote', express.static(path.join(__dirname, '../public/remote')));
app.use('/sounds', express.static(paths.SOUNDS_DIR));
if (paths.BUNDLED_SOUNDS_DIR !== paths.SOUNDS_DIR) {
  app.use('/sounds', express.static(paths.BUNDLED_SOUNDS_DIR));
}
app.use('/media', express.static(paths.MEDIA_DIR));
if (paths.BUNDLED_MEDIA_DIR !== paths.MEDIA_DIR) {
  app.use('/media', express.static(paths.BUNDLED_MEDIA_DIR));
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
    ttsVoices: audioTtsDriver.getAvailableVoices(),
    actionsData: actionEngine.getAll(),
    pointsSummary: pointsManager.getState(),
    chatbotConfig: chatbotDriver.getState(),
    intervalsData: intervalScheduler.getState(),
    widgetState: widgetManager.getState(),
    compatPorts: compatBridge.getStatus(),
    obsStatus: obsDriver.getStatus(),
    spotifyState: spotifyDriver.getState(),
    streamerBotStatus: streamerBotDriver.getStatus(),
    integrationsState: {
      ...voicemodDriver.getState(),
      lanUrls: voicemodDriver.getLanUrls(DASHBOARD_PORT)
    },
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
    if (effectMap.config.queueSettings) {
      queue.updateSettings(effectMap.config.queueSettings);
    }
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
// Test fire an effect manually (with optional Multi-Action / standalone __none__ execution)
app.post('/api/test-effect', (req, res) => {
  const { effectId, user, source, chainActions, label, giftName, coins } = req.body;
  const chainRule = {
    ...(chainActions && typeof chainActions === 'object' ? chainActions : {}),
    ...(label ? { label } : {})
  };
  const hasChain = Boolean(
    chainRule.actionId ||
    chainRule.soundId ||
    chainRule.spinWheel ||
    chainRule.ttsTemplate ||
    chainRule.obsScene ||
    chainRule.overlayMediaUrl ||
    Number(chainRule.timerAddSec) ||
    Number(chainRule.overlayScreen) >= 1
  );

  if (!effectId && !hasChain) {
    return res.status(400).json({ error: 'effectId or multi-action required' });
  }

  const testUser = user || 'dashboard-test';
  const pickedId = effectId === '__random__'
    ? effectMap._pickEffectId({ effectId: '__random__' })
    : (effectId || '__none__');
  const effect = effectMap._resolveEffect(pickedId, {}, chainRule) || {
    id: pickedId,
    effectId: pickedId,
    label: chainRule.label || pickedId,
    skipGameEffect: pickedId === '__none__',
    duration: 0,
    driver: pickedId === '__none__' ? 'none' : 'ws-mod',
    chainActions: chainRule
  };

  executeChainedActions(effect, {
    user: testUser,
    nickname: testUser,
    giftName: giftName || chainRule.label || 'Test Gift',
    coins: Number(coins) || 1,
    repeatCount: 1,
    source: source || 'test'
  });

  enqueueGameEffect(effect, {
    user: testUser,
    source: source || 'test',
    data: { macro: effect.macro, command: effect.command }
  });

  res.json({
    success: true,
    effectId: effect.id,
    skipGameEffect: Boolean(effect.skipGameEffect),
    driver: effect.driver,
    chainExecuted: hasChain
  });
});

// Built-in Live Event Simulator (Test Gift, Like, Follow, Share, Chat, Donation, Subscribe, Emote, Envelope, Battle)
app.post('/api/simulate', (req, res) => {
  const { type, user = 'AgivaTester', giftId = 5655, giftName = 'Rose', coins = 1, count = 100, comment = '!lompat', amount = 10000, platform = 'saweria', subMonth = 1 } = req.body;
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
    case 'subscribe':
      handleSubscribe({ uniqueId: user, subMonth: Number(subMonth) || 1 });
      break;
    case 'emote':
      handleEmote({ uniqueId: user, emoteId: 'sub_emote_1' });
      break;
    case 'envelope':
      handleEnvelope({ uniqueId: user, coins: Number(coins) || 10 });
      break;
    case 'battle':
      handleBattle({ anchorInfo: { nickname: user }, battleId: 'sim_battle_1' });
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
    lane: effect.driver || 'ws-mod',
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
  registerAllHotkeys();
  res.json({ success: true, config: updated });
});

app.get('/api/tts/stream', (req, res) => {
  audioTtsDriver.streamTts(req.query || {}, res);
});

app.get('/api/tts/voices', (req, res) => {
  res.json(audioTtsDriver.getAvailableVoices());
});

app.get('/api/tts/logs', (req, res) => {
  res.json(audioTtsDriver.getLogs());
});

app.delete('/api/tts/logs', (req, res) => {
  res.json({ success: true, logs: audioTtsDriver.clearLogs() });
});

app.post(['/api/tts/test', '/api/tts/speak'], (req, res) => {
  const text = req.body.text || 'Halo penonton Agiva, ini adalah tes suara Text to Speech Bahasa Indonesia gratis!';
  const spoken = audioTtsDriver.speak(text, {
    voicePreset: req.body.voicePreset,
    voice: req.body.voice,
    engine: req.body.engine,
    lang: req.body.lang,
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
    registerAllHotkeys();
    res.json({ success: true, item, config: audioTtsDriver.getConfig() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/soundboard/:id', (req, res) => {
  const ok = audioTtsDriver.deleteSound(req.params.id);
  registerAllHotkeys();
  res.json({ success: ok, config: audioTtsDriver.getConfig() });
});

// ─── Batch A/B: Multi-Screen Overlay & 7 Interactive Stream Widgets Endpoints ─
app.get('/api/widgets', (req, res) => {
  res.json(widgetManager.getState());
});

app.post('/api/widgets/timer', (req, res) => {
  const body = req.body || {};
  const { action, value, seconds, title, secondsPerCoin } = body;
  let val = value !== undefined ? value : seconds;
  if (action === 'config' && (!val || typeof val !== 'object')) {
    val = {
      ...(title !== undefined ? { title } : {}),
      ...(body.defaultSec !== undefined ? { defaultSec: body.defaultSec } : {}),
      ...(body.boostEnabled !== undefined ? { boostEnabled: body.boostEnabled } : {}),
      ...(body.boostMultiplier !== undefined ? { boostMultiplier: body.boostMultiplier } : {}),
      ...(body.randomBonusEnabled !== undefined ? { randomBonusEnabled: body.randomBonusEnabled } : {}),
      ...(body.randomMinSec !== undefined ? { randomMinSec: body.randomMinSec } : {}),
      ...(body.randomMaxSec !== undefined ? { randomMaxSec: body.randomMaxSec } : {}),
      ...(body.hideWhenZero !== undefined ? { hideWhenZero: body.hideWhenZero } : {}),
      ...(body.endEffectId !== undefined ? { endEffectId: body.endEffectId } : {}),
      ...(body.endActionId !== undefined ? { endActionId: body.endActionId } : {}),
      autoAdd: {
        ...(body.autoAdd || {}),
        ...(secondsPerCoin !== undefined ? { secPerCoin: Number(secondsPerCoin) } : {})
      }
    };
  }
  const timer = widgetManager.controlTimer(action || 'toggle', val, 'Dashboard');
  res.json({ success: true, timer });
});

app.post('/api/widgets/theme', (req, res) => {
  const theme = widgetManager.updateTheme(req.body || {});
  res.json({ success: true, theme });
});

app.post('/api/widgets/screen/:id', (req, res) => {
  const screen = widgetManager.updateScreenConfig(req.params.id, req.body || {});
  res.json({ success: true, screen });
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

// ─── Phase 3: Mini-Games, PRO Overlays, Points, Chatbot & Intervals REST APIs ─
app.post('/api/widgets/gift-counters', (req, res) => {
  const slots = Array.isArray(req.body?.slots) ? req.body.slots : req.body;
  const giftCounters = widgetManager.configureGiftCounters(slots);
  res.json({ success: true, giftCounters });
});

app.post('/api/widgets/gift-battle', (req, res) => {
  const { action = 'config', ...rest } = req.body || {};
  const giftBattle = widgetManager.controlGiftBattle(action, rest);
  res.json({ success: true, giftBattle });
});

app.post('/api/widgets/coin-match', (req, res) => {
  const { action = 'config', ...rest } = req.body || {};
  const coinMatch = widgetManager.controlCoinMatch(action, rest);
  res.json({ success: true, coinMatch });
});

app.post('/api/widgets/likeathon', (req, res) => {
  const { action = 'config', ...rest } = req.body || {};
  const likeathon = widgetManager.controlLikeathon(action, rest);
  res.json({ success: true, likeathon });
});

app.post('/api/widgets/coin-jar', (req, res) => {
  const { action = 'config', ...rest } = req.body || {};
  const coinJar = widgetManager.controlCoinJar(action, rest);
  res.json({ success: true, coinJar });
});

app.post('/api/widgets/records/reset', (req, res) => {
  const result = widgetManager.resetRecords();
  res.json({ success: true, ...result });
});

app.post('/api/widgets/stream-buddies', (req, res) => {
  const streamBuddies = widgetManager.updateStreamBuddies(req.body || {});
  res.json({ success: true, streamBuddies });
});

app.post('/api/widgets/penalty-battle', (req, res) => {
  const { action = 'config', ...rest } = req.body || {};
  const result = widgetManager.controlPenaltyBattle(action, rest);
  res.json({ success: true, result, penaltyBattle: widgetManager.state.penaltyBattle });
});

app.post('/api/widgets/socials', (req, res) => {
  const socials = widgetManager.updateSocials(req.body || {});
  res.json({ success: true, socials });
});

app.post('/api/widgets/seasonal-fx', (req, res) => {
  const seasonalFx = widgetManager.updateSeasonalFx(req.body || {});
  res.json({ success: true, seasonalFx });
});

// Points & Loyalty APIs
app.get('/api/points', (req, res) => {
  res.json(pointsManager.getState());
});

app.put('/api/points/config', (req, res) => {
  res.json({ success: true, state: pointsManager.updateConfig(req.body || {}) });
});

app.post('/api/points/adjust', (req, res) => {
  const { user, delta, reason } = req.body || {};
  if (!user || delta === undefined) return res.status(400).json({ error: 'user and delta required' });
  const record = pointsManager.adjustPoints(user, delta, reason || 'admin_adjust');
  if (!record) return res.status(400).json({ error: 'Invalid user or zero delta' });
  res.json({ success: true, user: record, state: pointsManager.getState() });
});

app.post('/api/points/drop', (req, res) => {
  const action = req.body?.action || 'start';
  const drop = action === 'stop' || action === 'end'
    ? pointsManager.endDrop()
    : pointsManager.startDrop(req.body || {});
  res.json({ success: true, drop, state: pointsManager.getState() });
});

app.post('/api/points/challenge', (req, res) => {
  const { action = 'start', mode = 'discard' } = req.body || {};
  const challenge = action === 'end' || action === 'stop'
    ? pointsManager.endChallenge(mode)
    : pointsManager.startChallenge();
  res.json({ success: true, challenge, state: pointsManager.getState() });
});

app.post('/api/points/halving', (req, res) => {
  const percent = Number(req.body?.percent ?? 50);
  const result = pointsManager.halveAllPoints(percent);
  res.json({ success: true, ...result, state: pointsManager.getState() });
});

// Active Chatbot APIs
app.get('/api/chatbot', (req, res) => {
  res.json(chatbotDriver.getState());
});

app.put('/api/chatbot/config', (req, res) => {
  res.json({ success: true, state: chatbotDriver.updateConfig(req.body || {}) });
});

app.post('/api/chatbot/command', (req, res) => {
  try {
    const command = chatbotDriver.upsertCommand(req.body || {});
    res.json({ success: true, command, state: chatbotDriver.getState() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/chatbot/command/:id', (req, res) => {
  const ok = chatbotDriver.deleteCommand(req.params.id);
  res.json({ success: ok, state: chatbotDriver.getState() });
});

app.post('/api/chatbot/send', async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  const result = await chatbotDriver.sendMessage(text, { user: currentUsername || 'Streamer', nickname: currentUsername || 'Streamer' }, { tiktokConn: tiktokConnection, force: true });
  res.json({ success: result.sent, ...result, state: chatbotDriver.getState() });
});

app.delete('/api/chatbot/logs', (req, res) => {
  res.json({ success: true, logs: chatbotDriver.clearLogs() });
});

// Interval Timers Scheduler APIs
app.get('/api/intervals', (req, res) => {
  res.json(intervalScheduler.getState());
});

app.put('/api/intervals/settings', (req, res) => {
  res.json({ success: true, state: intervalScheduler.updateSettings(req.body || {}) });
});

app.post('/api/intervals', (req, res) => {
  const timer = intervalScheduler.upsertTimer(req.body || {});
  res.json({ success: true, timer, state: intervalScheduler.getState() });
});

app.delete('/api/intervals/:id', (req, res) => {
  const ok = intervalScheduler.deleteTimer(req.params.id);
  res.json({ success: ok, state: intervalScheduler.getState() });
});

app.post('/api/intervals/:id/trigger', (req, res) => {
  const ok = intervalScheduler.triggerNow(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Timer not found' });
  res.json({ success: true, state: intervalScheduler.getState() });
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
  registerAllHotkeys();
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

// ─── Reusable Actions & Events Matrix + Media Library Endpoints (Phase 2) ────
app.get('/api/actions', (req, res) => {
  res.json(actionEngine.getAll());
});

app.post('/api/actions', (req, res) => {
  try {
    const action = actionEngine.upsertAction(req.body || {});
    res.json({ success: true, action, data: actionEngine.getAll() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/actions/:id', (req, res) => {
  const ok = actionEngine.deleteAction(req.params.id);
  res.json({ success: ok, data: actionEngine.getAll() });
});

app.post('/api/actions/:id/test', async (req, res) => {
  const ok = await actionEngine.executeAction(req.params.id, {
    user: req.body?.user || 'StreamerTest',
    nickname: req.body?.nickname || req.body?.user || 'StreamerTest',
    giftName: req.body?.giftName || 'Galaxy',
    coins: req.body?.coins || 1000,
    repeatCount: req.body?.repeatCount || 1,
    amount: req.body?.amount || 50000,
    comment: req.body?.comment || 'Tes Action!',
    source: 'action_test'
  });
  if (!ok) return res.status(404).json({ error: 'Action not found or Master Switch OFF' });
  res.json({ success: true });
});

app.post('/api/actions/import', (req, res) => {
  try {
    const data = actionEngine.importBundle(req.body || {});
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/events-matrix', (req, res) => {
  try {
    const eventRule = actionEngine.upsertEvent(req.body || {});
    res.json({ success: true, eventRule, data: actionEngine.getAll() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/events-matrix/:id', (req, res) => {
  const ok = actionEngine.deleteEvent(req.params.id);
  res.json({ success: ok, data: actionEngine.getAll() });
});

app.get('/api/media', (req, res) => {
  try {
    if (!fs.existsSync(paths.MEDIA_DIR)) return res.json([]);
    const allowed = new Set(['.gif', '.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm']);
    const files = fs.readdirSync(paths.MEDIA_DIR)
      .filter(f => allowed.has(path.extname(f).toLowerCase()))
      .map(f => {
        const stat = fs.statSync(path.join(paths.MEDIA_DIR, f));
        return { filename: f, url: `/media/${encodeURIComponent(f)}`, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/media/upload', (req, res) => {
  try {
    const filename = req.body?.filename || req.body?.fileName;
    const dataBase64 = req.body?.dataBase64 || req.body?.base64Data;
    if (!filename || !dataBase64) return res.status(400).json({ error: 'filename dan dataBase64 diperlukan' });
    const ext = path.extname(filename).toLowerCase();
    if (!['.gif', '.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm'].includes(ext)) {
      return res.status(400).json({ error: 'Format media harus .gif, .png, .jpg, .webp, .mp4, atau .webm' });
    }
    const safeBase = path.basename(filename, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || `media_${Date.now()}`;
    const finalName = `${safeBase}_${Date.now().toString(36)}${ext}`;
    if (!fs.existsSync(paths.MEDIA_DIR)) fs.mkdirSync(paths.MEDIA_DIR, { recursive: true });
    const rawBase64 = String(dataBase64).replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(rawBase64, 'base64');
    if (buf.length > 15 * 1024 * 1024) {
      return res.status(400).json({ error: 'Ukuran file media maksimal 15 MB' });
    }
    fs.writeFileSync(path.join(paths.MEDIA_DIR, finalName), buf);
    res.json({ success: true, item: { filename: finalName, url: `/media/${encodeURIComponent(finalName)}`, size: buf.length } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/media/:filename', (req, res) => {
  try {
    const safeName = path.basename(String(req.params.filename || ''));
    const mediaRoot = path.resolve(paths.MEDIA_DIR);
    const targetPath = path.resolve(mediaRoot, safeName);
    if (!safeName || !targetPath.startsWith(mediaRoot + path.sep) || !fs.existsSync(targetPath)) {
      return res.status(404).json({ error: 'Media tidak ditemukan' });
    }
    fs.unlinkSync(targetPath);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── Batch C: OBS Studio WebSocket v5 Endpoints ──────────────────────────────
app.get('/api/obs/status', (req, res) => {
  res.json(obsDriver.getStatus());
});

app.get('/api/obs/resources', (req, res) => {
  const st = obsDriver.getStatus();
  res.json({
    isConnected: st.isConnected,
    currentScene: st.currentScene,
    scenes: st.scenes,
    sceneItems: st.sceneItems,
    inputs: st.inputs,
    filters: st.filters
  });
});

app.post('/api/obs/refresh', async (req, res) => {
  try {
    const resources = await obsDriver.refreshResources();
    res.json({ success: true, ...resources });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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
    const { type, sceneName, sourceName, filterName, inputName, enabled = true, text = '', durationSec = 5 } = req.body || {};
    if (type === 'scene') {
      await obsDriver.switchSceneTemporary(sceneName, Number(durationSec) || 0, true);
    } else if (type === 'source') {
      await obsDriver.setSceneItemVisibilityTemporary(sceneName, sourceName, Boolean(enabled), Number(durationSec) || 0, true);
    } else if (type === 'filter') {
      await obsDriver.toggleFilterTemporary(sourceName, filterName, Number(durationSec) || 8, true);
    } else if (type === 'mute') {
      await obsDriver.toggleMuteTemporary(inputName, Number(durationSec) || 10, true);
    } else if (type === 'text') {
      await obsDriver.setInputText(inputName, text, true);
    } else if (type === 'replay') {
      await obsDriver.saveReplayBuffer(true);
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
  let { downloadUrl } = req.body || {};
  if (!downloadUrl) {
    try {
      const info = await updater.checkForUpdates({ force: true });
      downloadUrl = info.portableDownloadUrl || info.setupDownloadUrl || info.assets?.[0]?.downloadUrl || '';
    } catch {}
  }

  if (!downloadUrl) {
    return res.status(400).json({
      success: false,
      error: 'File pembaruan (.exe) tidak ditemukan pada rilis GitHub terbaru.'
    });
  }

  if (!updater.isAllowedDownloadUrl(downloadUrl)) {
    return res.status(400).json({
      success: false,
      error: 'URL unduhan tidak valid atau tidak berasal dari GitHub resmi Agiva Mod.'
    });
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

// ─── Phase 4: TikFinity Event API (:21213) Example Script Downloads ──────────
app.get('/api/compat-ports/example.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="agiva-tikfinity-21213-client.js"');
  res.send(compatBridge.getExampleScript('js'));
});

app.get('/api/compat-ports/example.py', (req, res) => {
  res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="agiva-tikfinity-21213-client.py"');
  res.send(compatBridge.getExampleScript('py'));
});

// ─── Phase 4: Spotify & Standalone Song Requests (!play, !skip, !revoke) ─────
app.get('/api/spotify', (req, res) => {
  res.json(spotifyDriver.getState());
});

app.put('/api/spotify/config', (req, res) => {
  const state = spotifyDriver.updateConfig(req.body || {});
  res.json({ success: true, state });
});

app.get('/api/spotify/auth-url', (req, res) => {
  try {
    const url = spotifyDriver.getAuthUrl();
    res.json({ success: true, url });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

app.get('/api/spotify/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Spotify OAuth Error: ${error}`);
  try {
    await spotifyDriver.exchangeCode(code);
    res.redirect('/dashboard?spotify=connected');
  } catch (e) {
    res.status(400).send(`Gagal menghubungkan Spotify: ${e.message}`);
  }
});

app.post('/api/spotify/request', async (req, res) => {
  const { query, user = 'Streamer', force = true } = req.body || {};
  const result = await spotifyDriver.requestSong(query, { uniqueId: user, nickname: user, isModerator: true }, { pointsManager, force: Boolean(force) });
  if (!result.ok) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true, ...result, state: spotifyDriver.getState() });
});

app.post('/api/spotify/skip', (req, res) => {
  const result = spotifyDriver.skipTrack(req.body?.user || 'Streamer');
  res.json({ success: true, ...result, state: spotifyDriver.getState() });
});

app.post('/api/spotify/clear', (req, res) => {
  const state = spotifyDriver.clearQueue();
  res.json({ success: true, state });
});

app.delete('/api/spotify/queue/:id', (req, res) => {
  const result = spotifyDriver.removeTrack(req.params.id);
  res.json({ success: result.ok, state: spotifyDriver.getState() });
});

// ─── Phase 4: Streamer.bot (:8080), Voicemod, IFTTT & Elgato Stream Deck ─────
app.get('/api/integrations/streamerbot', (req, res) => {
  res.json(streamerBotDriver.getStatus());
});

app.put('/api/integrations/streamerbot', (req, res) => {
  const status = streamerBotDriver.updateConfig(req.body || {});
  res.json({ success: true, status });
});

app.post('/api/integrations/streamerbot/test', (req, res) => {
  const actionName = req.body?.actionName || streamerBotDriver.config.defaultActionName || 'AgivaTikTokEvent';
  const vars = streamerBotDriver.buildStandardVariables('gift', {
    user: 'Sultan_Agiva',
    nickname: 'Sultan Agiva',
    giftName: 'Lion',
    giftId: 5827,
    coins: 29999,
    repeatCount: 1,
    gameId: effectMap.getConfig().activeGameId
  });
  const result = streamerBotDriver.doAction(actionName, vars);
  res.json({ success: true, ...result });
});

app.get('/api/integrations/voicemod', (req, res) => {
  res.json({
    ...voicemodDriver.getState(),
    lanUrls: voicemodDriver.getLanUrls(DASHBOARD_PORT)
  });
});

app.put('/api/integrations/voicemod', (req, res) => {
  const voicemod = voicemodDriver.updateVoicemodConfig(req.body || {});
  res.json({ success: true, voicemod });
});

app.post('/api/integrations/voicemod/action', (req, res) => {
  const { type = 'loadVoice', value = 'nofx' } = req.body || {};
  const result = voicemodDriver.executeVoicemodAction(type, value);
  res.json({ success: true, ...result });
});

app.put('/api/integrations/ifttt', (req, res) => {
  const presets = voicemodDriver.updateIftttPresets(req.body?.presets || []);
  res.json({ success: true, presets });
});

app.post('/api/integrations/ifttt/trigger', async (req, res) => {
  const { presetId, vars = {} } = req.body || {};
  const result = await voicemodDriver.triggerIftttPreset(presetId, {
    user: 'Sultan_Agiva',
    giftName: 'Universe',
    coins: 34999,
    amount: 100000,
    ...vars
  });
  res.json({ success: result.ok, ...result });
});

app.get('/api/streamdeck/profile.json', (req, res) => {
  const activeGame = effectMap.getActiveGameConfig();
  const baseUrl = `http://127.0.0.1:${DASHBOARD_PORT}`;
  const actions = [
    { name: 'Pause / Resume Interaksi', method: 'POST', url: `${baseUrl}/api/streamdeck/trigger`, body: { action: 'toggle_master' } },
    { name: 'Clear Effect Queue', method: 'POST', url: `${baseUrl}/api/streamdeck/trigger`, body: { action: 'clear_queue' } },
    { name: 'Skip Active TTS / Audio', method: 'POST', url: `${baseUrl}/api/streamdeck/trigger`, body: { action: 'skip_tts' } },
    { name: 'Spin Gacha Wheel', method: 'POST', url: `${baseUrl}/api/streamdeck/trigger`, body: { action: 'spin_wheel' } },
    { name: 'Subathon Timer +60s', method: 'POST', url: `${baseUrl}/api/streamdeck/trigger`, body: { action: 'timer_add', value: 60 } },
    { name: 'Win Counter +1', method: 'POST', url: `${baseUrl}/api/streamdeck/trigger`, body: { action: 'win_add' } },
    { name: 'Lose Counter +1', method: 'POST', url: `${baseUrl}/api/streamdeck/trigger`, body: { action: 'lose_add' } },
    { name: 'Skip Lagu Spotify', method: 'POST', url: `${baseUrl}/api/streamdeck/trigger`, body: { action: 'spotify_skip' } }
  ];
  const gameEffects = Object.entries(activeGame?.effects || {}).slice(0, 16).map(([id, ef]) => ({
    name: `Effect: ${ef.label || id}`,
    method: 'POST',
    url: `${baseUrl}/api/streamdeck/trigger`,
    body: { action: 'trigger_effect', effectId: id }
  }));

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="agiva-elgato-streamdeck-actions.json"');
  res.send(JSON.stringify({
    profileName: `Agiva Mod — ${activeGame?.name || 'Universal'}`,
    version: updater.getCurrentVersion(),
    baseUrl,
    quickActions: actions,
    gameEffects
  }, null, 2));
});

function executeDeckQuickAction(body = {}, sourceLabel = 'StreamDeck') {
  const { action, effectId, soundId, text, query, value } = body;
  if (action === 'toggle_master') {
    const next = !effectMap.masterSwitches.all;
    const sw = effectMap.setMasterSwitches({ all: next });
    broadcastDash({ type: 'master_switches', masterSwitches: sw });
    return { ok: true, message: next ? 'Interaksi Diaktifkan (ON)' : 'Interaksi Dijeda (PAUSED)', masterSwitches: sw };
  }
  if (action === 'clear_queue') {
    queue.clear();
    return { ok: true, message: 'Antrean efek dibersihkan!' };
  }
  if (action === 'skip_tts') {
    audioTtsDriver.stopAllAudio();
    return { ok: true, message: 'Audio & TTS di-skip!' };
  }
  if (action === 'spin_wheel') {
    const spin = widgetManager.spinWheel(sourceLabel);
    return { ok: true, message: 'Spin Wheel diputar!', spin };
  }
  if (action === 'win_add') {
    const counter = widgetManager.controlCounter('win_add', Number(value) || 1);
    return { ok: true, message: 'Win +1', counter };
  }
  if (action === 'lose_add') {
    const counter = widgetManager.controlCounter('lose_add', Number(value) || 1);
    return { ok: true, message: 'Lose +1', counter };
  }
  if (action === 'timer_add') {
    const sec = Number(value) || 60;
    const timer = widgetManager.controlTimer('add', sec, sourceLabel);
    return { ok: true, message: `Timer +${sec}s`, timer };
  }
  if (action === 'play_sound' && soundId) {
    audioTtsDriver.playSound(String(soundId));
    return { ok: true, message: `Memutar suara: ${soundId}` };
  }
  if (action === 'trigger_effect' && effectId) {
    enqueueEffectById(String(effectId), sourceLabel, 'remote_deck');
    return { ok: true, message: `Trigger efek: ${effectId}` };
  }
  if (action === 'speak_tts' && text) {
    audioTtsDriver.speak(String(text), { user: sourceLabel }, true);
    return { ok: true, message: 'Suara TTS dikirim!' };
  }
  if (action === 'spotify_skip') {
    const res = spotifyDriver.skipTrack(sourceLabel);
    return { ok: true, message: 'Lagu di-skip!', ...res };
  }
  if (action === 'spotify_request' && query) {
    spotifyDriver.requestSong(String(query), { uniqueId: sourceLabel, nickname: sourceLabel, isModerator: true }, { pointsManager, force: true }).catch(() => {});
    return { ok: true, message: `Request lagu: ${query}` };
  }
  return { ok: false, error: 'Aksi tidak dikenali' };
}

app.post('/api/streamdeck/trigger', (req, res) => {
  const result = executeDeckQuickAction(req.body || {}, 'StreamDeck');
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

// ─── Phase 4: Mobile Companion / LAN Remote Endpoints ────────────────────────
app.get('/api/remote/info', (req, res) => {
  res.json({
    ok: true,
    lanRemote: voicemodDriver.lanRemote,
    urls: voicemodDriver.getLanUrls(DASHBOARD_PORT)
  });
});

app.put('/api/remote/config', (req, res) => {
  const lanRemote = voicemodDriver.updateLanRemote(req.body || {});
  res.json({
    success: true,
    lanRemote,
    urls: voicemodDriver.getLanUrls(DASHBOARD_PORT)
  });
});

app.post('/api/remote/auth', (req, res) => {
  const pin = req.body?.pin || req.headers['x-agiva-pin'] || '';
  if (!voicemodDriver.lanRemote.enabled) {
    return res.status(403).json({ ok: false, error: 'Mobile LAN Remote sedang dinonaktifkan di Dashboard.' });
  }
  if (!voicemodDriver.verifyPin(pin)) {
    return res.status(401).json({ ok: false, error: 'PIN LAN Remote tidak sesuai.' });
  }
  res.json({ ok: true });
});

function requireRemotePin(req, res, next) {
  const pin = req.headers['x-agiva-pin'] || req.query.pin || req.body?.pin || '';
  if (!voicemodDriver.verifyPin(pin)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: PIN LAN Remote salah atau nonaktif.' });
  }
  next();
}

app.get('/api/remote/deck', requireRemotePin, (req, res) => {
  const cfg = effectMap.getConfig();
  const activeGame = effectMap.getActiveGameConfig();
  const effects = Object.entries(activeGame?.effects || {}).map(([id, ef]) => ({
    id,
    label: ef.label || id,
    category: ef.category || 'general'
  }));
  const sounds = audioTtsDriver.getConfig()?.soundboard?.items || [];
  res.json({
    ok: true,
    activeGameId: cfg.activeGameId,
    activeGameName: activeGame?.name || cfg.activeGameId,
    masterSwitches: effectMap.masterSwitches,
    roomStats,
    queueStatus: queue.status,
    effects,
    sounds
  });
});

app.post('/api/remote/action', requireRemotePin, (req, res) => {
  const result = executeDeckQuickAction(req.body || {}, 'MobileRemote');
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

// ─── Phase 4: Full Config Backup & Restore (.agiva-backup.json) ──────────────
app.get('/api/backup/export', (req, res) => {
  flushPendingStores();
  const gamesDir = gameDetect.getGamesDir();
  const gamesCustom = {};
  try {
    if (fs.existsSync(gamesDir)) {
      for (const entry of fs.readdirSync(gamesDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const gFile = path.join(gamesDir, entry.name, 'game.json');
          if (fs.existsSync(gFile)) {
            try { gamesCustom[entry.name] = JSON.parse(fs.readFileSync(gFile, 'utf8')); } catch {}
          }
        }
      }
    }
  } catch {}

  const bundle = {
    schema: 'agiva-full-backup-v1',
    appVersion: updater.getCurrentVersion(),
    exportedAt: new Date().toISOString(),
    effectsConfig: effectMap.getConfig(),
    gamesPresets: gamesCustom,
    actionsData: actionEngine.getAll(),
    widgetsConfig: widgetManager.getState(),
    ttsSoundConfig: audioTtsDriver.getConfig(),
    pointsConfig: pointsManager.config,
    chatbotConfig: chatbotDriver.config,
    intervalsData: intervalScheduler.getState(),
    compatConfig: compatBridge.config,
    hotkeysConfig,
    spotifyConfig: spotifyDriver.exportRawConfig(),
    streamerBotConfig: streamerBotDriver.config,
    voicemodState: voicemodDriver.getState()
  };

  const dateStr = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="agiva-backup-${dateStr}.agiva-backup.json"`);
  res.send(JSON.stringify(bundle, null, 2));
});

app.post('/api/backup/import', (req, res) => {
  const bundle = req.body || {};
  if (bundle.schema !== 'agiva-full-backup-v1' || typeof bundle !== 'object') {
    return res.status(400).json({ success: false, error: 'File backup tidak valid (bukan format agiva-full-backup-v1).' });
  }

  try {
    if (bundle.gamesPresets && typeof bundle.gamesPresets === 'object') {
      const gamesDir = gameDetect.getGamesDir();
      for (const [gameFolder, gameJson] of Object.entries(bundle.gamesPresets)) {
        const safeFolder = String(gameFolder).replace(/[^a-zA-Z0-9_-]/g, '');
        if (!safeFolder || !gameJson || typeof gameJson !== 'object') continue;
        const targetDir = path.join(gamesDir, safeFolder);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, 'game.json'), JSON.stringify(gameJson, null, 2), 'utf8');
      }
      gameDetect.scan();
    }

    if (bundle.effectsConfig && typeof bundle.effectsConfig === 'object') {
      effectMap.config = {
        ...effectMap.config,
        ...bundle.effectsConfig
      };
      effectMap.save();
      if (effectMap.config.queueSettings) {
        queue.updateSettings(effectMap.config.queueSettings);
      }
    }
    if (bundle.actionsData && typeof bundle.actionsData === 'object') {
      actionEngine.importBundle(bundle.actionsData);
    }
    if (bundle.ttsSoundConfig && typeof bundle.ttsSoundConfig === 'object') {
      audioTtsDriver.saveConfig(bundle.ttsSoundConfig);
    }
    if (bundle.pointsConfig && typeof bundle.pointsConfig === 'object') {
      pointsManager.updateConfig(bundle.pointsConfig);
    }
    if (bundle.chatbotConfig && typeof bundle.chatbotConfig === 'object') {
      chatbotDriver.updateConfig(bundle.chatbotConfig);
    }
    if (bundle.intervalsData && typeof bundle.intervalsData === 'object') {
      if (bundle.intervalsData.settings) intervalScheduler.updateSettings(bundle.intervalsData.settings);
    }
    if (bundle.hotkeysConfig && typeof bundle.hotkeysConfig === 'object') {
      hotkeysConfig = { ...hotkeysConfig, ...bundle.hotkeysConfig };
      try {
        fs.writeFileSync(HOTKEYS_PATH, JSON.stringify(hotkeysConfig, null, 2), 'utf8');
      } catch {}
      registerAllHotkeys();
    }
    if (bundle.spotifyConfig?.config) {
      spotifyDriver.updateConfig(bundle.spotifyConfig.config);
    }
    if (bundle.streamerBotConfig) {
      streamerBotDriver.updateConfig(bundle.streamerBotConfig);
    }
    if (bundle.voicemodState?.iftttPresets) {
      voicemodDriver.updateIftttPresets(bundle.voicemodState.iftttPresets);
    }

    res.json({
      success: true,
      message: 'Seluruh konfigurasi Agiva Mod berhasil dipulihkan dari file backup!'
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Redirect root to dashboard ───────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/dashboard'));

// ─── Start Servers ────────────────────────────────────────────────────────────
httpServer.listen(DASHBOARD_PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║   🎮 Agiva Universal Streamer Mod Bridge — v1.7.0      ║');
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

function flushPendingStores() {
  try { intervalScheduler?.destroy(); } catch {}
  try { widgetManager.flushSaveSync(); } catch {}
  try { sessionStore.flushSaveSync(); } catch {}
  try { actionEngine?.flushSaveSync(); } catch {}
  try { pointsManager?.flushSaveSync(); } catch {}
  try { chatbotDriver?.flushSaveSync(); } catch {}
  try { intervalScheduler?.flushSaveSync(); } catch {}
  try { spotifyDriver?.flushSaveSync(); } catch {}
  try { streamerBotDriver?.flushSaveSync(); } catch {}
  try { voicemodDriver?.flushSaveSync(); } catch {}
}
process.on('beforeExit', flushPendingStores);
process.on('SIGINT', () => {
  flushPendingStores();
  process.exit(0);
});
process.on('SIGTERM', () => {
  flushPendingStores();
  process.exit(0);
});
