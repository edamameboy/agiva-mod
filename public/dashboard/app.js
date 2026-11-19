/* ─────────────────────────────────────────────────────────
   Agiva Universal Streamer Mod Bridge — Dashboard App v3.0
   ───────────────────────────────────────────────────────── */
'use strict';

// ─── Theme Setup ──────────────────────────────────────────
const themeBtn = document.getElementById('btn-theme');
if (localStorage.getItem('theme') === 'dark') {
  document.body.setAttribute('data-theme', 'dark');
}
themeBtn?.addEventListener('click', () => {
  if (document.body.getAttribute('data-theme') === 'dark') {
    document.body.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
  } else {
    document.body.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  }
});

// ─── WebSocket ────────────────────────────────────────────
let ws = null;
let wsReconnectTimer = null;

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    clearTimeout(wsReconnectTimer);
  };
  ws.onmessage = (e) => {
    try { handleServerMsg(JSON.parse(e.data)); } catch {}
  };
  ws.onclose = () => {
    wsReconnectTimer = setTimeout(connectWS, 3000);
  };
}

// ─── State ────────────────────────────────────────────────
let appState = {
  isConnected: false,
  connectionMode: 'eulerstream',
  activeConnectionProvider: 'none',
  currentUsername: '',
  roomStats: { viewers: 0, likes: 0, gifts: 0, followers: 0, shares: 0, donations: 0 },
  queueStatus: { queued: 0 },
  modClients: 0,
  activeGameId: 'CarJunkyard',
  activePresetId: 'default',
  masterSwitches: { all: true, wsMod: true, keystroke: true, rcon: true, webhook: true }
};

let config = null;
let games = [];
let events = [];
let giftsData = [];
let currentEffectFilter = 'all';
let ttsSoundConfig = null;
let widgetState = null;
let compatPortsStatus = null;
let actionsData = { version: 1, actions: [], events: [] };
let ttsVoices = [];
let obsResources = { connected: false, currentScene: '', scenes: [], sceneItems: {}, inputs: [], filters: {} };
let mediaFiles = [];
let activeMediaPickCallback = null;
let wheelEditorDirty = false;
let widgetsFormHydrated = false;
let pointsState = null;
let chatbotState = null;
let intervalsState = null;
let loyaltyFormHydrated = false;
let chatbotFormHydrated = false;
let miniGamesHydrated = false;

// ─── Server Message Handler ───────────────────────────────
function handleServerMsg(msg) {
  switch (msg.type) {
    case 'state':
      appState = { ...appState, ...msg };
      if (msg.masterSwitches) renderMasterSwitches(msg.masterSwitches);
      if (msg.ttsSoundConfig) { ttsSoundConfig = msg.ttsSoundConfig; renderTtsTab(); }
      if (msg.widgetState) { widgetState = msg.widgetState; renderWidgetsTab(!widgetsFormHydrated); }
      if (msg.compatPorts) { compatPortsStatus = msg.compatPorts; renderCompatPorts(); }
      if (msg.actionsData) { actionsData = msg.actionsData; renderActionsAndMatrix(); }
      if (msg.ttsVoices) { ttsVoices = msg.ttsVoices; renderTtsTab(); }
      if (msg.obsStatus) renderObsStatus(msg.obsStatus);
      renderConnectionState();
      renderStats();
      break;
    case 'points_update':
      pointsState = msg.state;
      renderLoyaltyTab(false);
      break;
    case 'points_drop':
      if (pointsState) {
        pointsState.activeDrop = msg.drop;
        renderLoyaltyTab(false);
      }
      break;
    case 'chatbot_update':
      chatbotState = msg.state;
      renderChatbotSection(false);
      break;
    case 'chatbot_message':
      if (chatbotState) {
        if (!Array.isArray(chatbotState.logs)) chatbotState.logs = [];
        chatbotState.logs.unshift({ id: msg.id, time: msg.time, text: msg.text, status: msg.status });
        if (chatbotState.logs.length > 50) chatbotState.logs.length = 50;
        renderChatbotSection(false);
      }
      break;
    case 'intervals_update':
      intervalsState = msg.state;
      renderIntervalsSection();
      break;
    case 'gift_battle_winner':
      toast(`⚔️ Pemenang Gift Battle: ${msg.winner?.label || '-'}!`, 'success');
      break;
    case 'coin_match_ended':
      toast(`🏆 Coin Match selesai!`, 'success');
      break;
    case 'stats':
      appState.roomStats = msg.roomStats;
      renderStats();
      break;
    case 'event':
      addFeedItem(msg.event);
      addEventRow(msg.event);
      break;
    case 'effect':
      showActiveEffect(msg);
      break;
    case 'tts_speak':
      handleDashboardTtsSpeak(msg.payload || msg);
      break;
    case 'tts_skip':
    case 'audio_stop':
    case 'audio_stop_all':
      stopDashboardTts();
      break;
    case 'sound_play':
    case 'soundboard_play':
      handleDashboardSoundPlay(msg.payload || msg);
      break;
    case 'widget_update':
    case 'widgets_update':
      widgetState = msg.state || msg.payload?.fullState || widgetState;
      renderWidgetsTab(false);
      break;
    case 'timer_tick':
      if (widgetState && widgetState.timer) {
        widgetState.timer.remainingSec = msg.remainingSec;
        widgetState.timer.isRunning = msg.isRunning;
        updateTimerPreviewOnly(msg.remainingSec, msg.isRunning);
      }
      break;
    case 'timer_ended':
      toast('⏱️ Subathon Timer selesai (00:00:00)!', 'info');
      break;
    case 'actions_updated':
      if (msg.actionsData) {
        actionsData = msg.actionsData;
        renderActionsAndMatrix();
        renderConfigurator();
        renderWidgetsTab(false);
      }
      break;
    case 'compat_ports':
      compatPortsStatus = msg.status;
      renderCompatPorts();
      break;
    case 'obs_status':
      renderObsStatus(msg.status);
      break;
    case 'master_switches':
      appState.masterSwitches = msg.masterSwitches;
      renderMasterSwitches(msg.masterSwitches);
      break;
    case 'game_switched':
      config = msg.config;
      games = msg.games || games;
      appState.activeGameId = msg.activeGameId;
      appState.activePresetId = msg.activePresetId;
      renderGameSelector(games);
      renderConfigurator();
      renderEffectsLib(currentEffectFilter);
      renderSettings();
      break;
    case 'error':
      toast(msg.message, 'error');
      break;
    case 'games_updated':
      if (msg.games) {
        games = msg.games;
        renderGameSelector(games);
      }
      if (msg.presetsFolder) {
        const pInput = document.getElementById('info-presets-folder');
        if (pInput) pInput.value = msg.presetsFolder;
      }
      break;
    case 'spotify_update':
      if (msg.state) {
        spotifyState = msg.state;
        renderSpotifySection(false);
      }
      break;
    case 'streamerbot_status':
      if (msg.status) {
        streamerBotState = msg.status;
        renderStreamerBotAndVoicemodSection(false);
      }
      break;
    case 'integrations_update':
      if (msg.state) {
        integrationsState = { ...integrationsState, ...msg.state };
        renderStreamerBotAndVoicemodSection(false);
        renderLanRemoteSection(false);
      }
      break;
    case 'update_available':
      if (msg.update) handleUpdateAvailable(msg.update);
      break;
    case 'update_progress': {
      isUpdateDownloading = true;
      setUpdateProgressUI({
        show: true,
        percent: msg.percent || 0,
        status: msg.status || 'Mengunduh pembaruan...',
        bytes: msg.receivedMB ? `${msg.receivedMB} MB / ${msg.totalMB || '?'} MB` : null
      });
      break;
    }
    case 'update_ready': {
      isUpdateDownloading = false;
      setUpdateProgressUI({
        show: true,
        percent: 100,
        status: '✅ Unduhan Selesai! Me-restart aplikasi...',
        bytes: null
      });
      const mIcon = document.getElementById('modal-update-status-icon');
      const mTitle = document.getElementById('modal-update-status-title');
      if (mIcon) mIcon.textContent = '✅';
      if (mTitle) mTitle.textContent = 'Unduhan Selesai! Menyiapkan Restart...';
      toast(msg.message || 'Pembaruan siap! Aplikasi akan segera me-restart.', 'success');
      break;
    }
    case 'update_error': {
      isUpdateDownloading = false;
      toast(msg.message || 'Pembaruan gagal diunduh.', 'error');
      const btnA = document.getElementById('btn-auto-update');
      if (btnA) btnA.disabled = false;
      const btnM = document.getElementById('btn-modal-apply-update');
      if (btnM) btnM.disabled = false;
      setUpdateProgressUI({
        show: true,
        percent: null,
        status: `❌ ${msg.message || 'Gagal mengunduh pembaruan'}`,
        bytes: null
      });
      break;
    }
  }
}

// ─── Tab Navigation ───────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const tab = item.dataset.tab;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(`tab-${tab}`)?.classList.add('active');
    document.getElementById('page-title').textContent = {
      dashboard: 'Dashboard',
      configurator: 'Preset & Trigger Configurator',
      tts: 'TTS Bahasa Indonesia & Soundboard',
      widgets: 'Stream Widgets & Multi-Screen Overlay',
      loyalty: 'Points, Chatbot & Interval Timers',
      integrations: 'Port Bridge, OBS, Donasi & Analytics',
      effects: 'Effects Library',
      gifts: 'TikTok Gifts Data',
      events: 'Live Events Log',
      settings: 'Settings & Drivers'
    }[tab] || tab;

    if (tab === 'configurator') { renderConfigurator(); renderActionsAndMatrix(); }
    if (tab === 'tts') { renderTtsTab(); refreshTtsLogs(); }
    if (tab === 'widgets') renderWidgetsTab(false);
    if (tab === 'loyalty') { renderLoyaltyTab(false); renderChatbotSection(false); renderIntervalsSection(); }
    if (tab === 'integrations') renderIntegrationsTab();
    if (tab === 'effects') renderEffectsLib(currentEffectFilter);
    if (tab === 'events') renderEventsTable();
    if (tab === 'settings') renderSettings();
    if (tab === 'gifts') renderGiftsTab();
  });
});

// ─── Master Kill-Switches (Sakelar Kontrol) ───────────────
function renderMasterSwitches(switches = appState.masterSwitches) {
  if (!switches) return;
  ['all', 'wsMod', 'keystroke', 'rcon', 'tts', 'obs'].forEach(key => {
    const btn = document.getElementById(`sw-${key}`);
    if (btn) {
      btn.classList.toggle('active', Boolean(switches[key]));
    }
  });
}

document.querySelectorAll('.switch-pill').forEach(btn => {
  btn.addEventListener('click', async () => {
    const key = btn.dataset.switch;
    const nextVal = !btn.classList.contains('active');
    const res = await api('POST', '/api/master-switches', { [key]: nextVal });
    if (res.success) {
      appState.masterSwitches = res.masterSwitches;
      renderMasterSwitches(res.masterSwitches);
      toast(`Sakelar ${key.toUpperCase()}: ${nextVal ? 'AKTIF (ON)' : 'MATI (OFF)'}`, nextVal ? 'success' : 'info');
    }
  });
});

// ─── TikTok Connect ───────────────────────────────────────
document.getElementById('btn-connect')?.addEventListener('click', async () => {
  const username = document.getElementById('username-input').value.trim().replace('@', '');
  if (!username) return toast('Masukkan username TikTok', 'error');

  const btn = document.getElementById('btn-connect');
  btn.textContent = 'Connecting...';
  btn.disabled = true;

  try {
    const res = await api('POST', '/api/connect', { username });
    if (res.success) toast(`Connected to @${username} (${res.provider || 'Eulerstream'})!`, 'success');
    else toast(res.error || 'Failed to connect', 'error');
  } catch (e) {
    toast(e.message, 'error');
  }
  btn.textContent = 'Connect';
  btn.disabled = false;
});

document.getElementById('btn-disconnect')?.addEventListener('click', async () => {
  await api('POST', '/api/disconnect');
  toast('Disconnected', 'info');
});

function renderConnectionState() {
  const { isConnected, currentUsername, modClients, activeConnectionProvider } = appState;
  const statusEl = document.getElementById('connect-status');
  const statusLabel = document.getElementById('status-label');
  const form = document.getElementById('connect-form');
  const btnDisc = document.getElementById('btn-disconnect');

  if (isConnected) {
    statusEl.className = 'connect-status connected';
    const provTag = activeConnectionProvider === 'connector' ? ' [Native]' : '';
    statusLabel.textContent = `@${currentUsername}${provTag}`;
    form.style.display = 'none';
    btnDisc.style.display = '';
    const giftUserInput = document.getElementById('gifts-username-input');
    if (giftUserInput && !giftUserInput.value.trim() && currentUsername) {
      giftUserInput.value = currentUsername;
    }
  } else {
    statusEl.className = 'connect-status disconnected';
    statusLabel.textContent = 'Disconnected';
    form.style.display = '';
    btnDisc.style.display = 'none';
  }

  document.getElementById('stat-modclients').textContent = modClients || 0;
}

// ─── Stats Rendering ──────────────────────────────────────
function renderStats() {
  const s = appState.roomStats || {};
  document.getElementById('stat-viewers').textContent = fmt(s.viewers);
  document.getElementById('stat-likes').textContent = fmt(s.likes);
  document.getElementById('stat-gifts').textContent = fmt(s.gifts);
  document.getElementById('stat-followers').textContent = fmt(s.followers);
  document.getElementById('stat-queue').textContent = appState.queueStatus?.queued || 0;
}

function fmt(n) {
  if (!n) return '0';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toString();
}

// ─── Live Feed ────────────────────────────────────────────
function addFeedItem(ev) {
  const feed = document.getElementById('live-feed');
  if (!feed) return;
  const empty = feed.querySelector('.feed-empty');
  if (empty) empty.remove();

  const icons = {
    gift: '🎁',
    follow: '👤',
    subscribe: '⭐',
    member: '👋',
    like: '❤️',
    share: '🔄',
    repost: '🔁',
    emote: '😄',
    envelope: '🧧',
    question: '❓',
    battle: '⚔️',
    chat: '💬',
    donation: '💸'
  };
  const details = {
    gift: `${ev.giftName} (${ev.coins}💎)`,
    follow: 'followed the stream!',
    subscribe: 'subscribed to streamer!',
    member: 'joined the stream',
    like: `sent ${ev.count} likes`,
    share: 'shared the stream!',
    repost: 'reposted the stream!',
    emote: `sent emote ${ev.emoteId || ''}`.trim(),
    envelope: `sent angpao (${ev.coins || 0}💎)`,
    question: `"${ev.question || ''}"`,
    battle: 'PK Battle dimulai!',
    chat: `"${ev.comment || ''}"`,
    donation: `Rp ${Number(ev.amount || 0).toLocaleString('id-ID')} (${ev.platform || 'Donasi'})`
  };

  const div = document.createElement('div');
  div.className = `feed-item ${ev.type}`;
  div.innerHTML = `
    <span class="feed-icon">${icons[ev.type] || '📢'}</span>
    <span class="feed-user">${esc(ev.user)}</span>
    <span class="feed-detail">${esc(details[ev.type] || '')}</span>
    <span class="feed-time">${timeAgo(ev.time)}</span>
  `;
  feed.insertBefore(div, feed.firstChild);
  if (feed.children.length > 50) feed.lastChild.remove();
}

function showActiveEffect(eff) {
  const el = document.getElementById('active-effect');
  if (!el) return;
  const driverTag = eff.driver ? ` [${eff.driver.toUpperCase()}]` : '';
  el.innerHTML = `<div class="effect-active">
    <div class="effect-name">${esc(eff.label || eff.effectId)}${esc(driverTag)}</div>
    <div class="effect-user">triggered by ${esc(eff.user)}</div>
  </div>`;
  setTimeout(() => {
    el.innerHTML = '<div class="effect-idle">No active effect</div>';
  }, 4000);
}

// ─── Queue ────────────────────────────────────────────────
document.getElementById('btn-clear-queue')?.addEventListener('click', async () => {
  await api('DELETE', '/api/queue');
  document.getElementById('queue-list').innerHTML = '<div class="queue-empty">Queue empty</div>';
  toast('Queue cleared', 'success');
});

// ─── Modular Game & Preset Selector ───────────────────────
const gameBadgeBtn = document.getElementById('active-game-badge');
const gameDropdown = document.getElementById('game-dropdown');

gameBadgeBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = gameDropdown.style.display !== 'none';
  gameDropdown.style.display = isOpen ? 'none' : 'block';
  gameBadgeBtn.setAttribute('aria-expanded', String(!isOpen));
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#game-selector')) {
    if (gameDropdown) gameDropdown.style.display = 'none';
    gameBadgeBtn?.setAttribute('aria-expanded', 'false');
  }
});

function getActiveGameObj() {
  const activeId = config?.activeGameId || appState.activeGameId || 'CarJunkyard';
  return games.find(g => g.id === activeId) || games[0] || null;
}

function renderGameSelector(gamesData) {
  games = gamesData || [];
  const activeId = config?.activeGameId || appState.activeGameId || (games[0]?.id ?? 'CarJunkyard');
  const activePresetId = config?.activePresetId || appState.activePresetId || 'default';
  const activeGame = games.find(g => g.id === activeId) || games[0];

  const list = document.getElementById('game-list');
  if (list) {
    list.innerHTML = '';
    games.forEach(g => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `game-option ${g.id === activeGame?.id ? 'active' : ''}`;
      const effectCount = Object.keys(g.effects || {}).length;
      const driverLabel = (g.driver || 'ws-mod').toUpperCase();
      btn.innerHTML = `
        <div class="game-option-left">
          <span style="font-size:20px">${esc(g.icon || '🎮')}</span>
          <div>
            <div>${esc(g.name)}</div>
            <span class="game-option-sub">${effectCount} Efek · ${(g.presets || []).length || 1} Preset</span>
          </div>
        </div>
        <span class="driver-pill ${esc(g.driver || 'ws-mod')}">${esc(driverLabel)}</span>
      `;
      btn.addEventListener('click', () => selectActiveGame(g.id, 'default'));
      list.appendChild(btn);
    });
  }

  if (activeGame) {
    document.getElementById('game-icon').textContent = activeGame.icon || '🎮';
    document.getElementById('game-name').textContent = activeGame.name;
    const pill = document.getElementById('game-driver-pill');
    if (pill) {
      pill.textContent = (activeGame.driver || 'ws-mod').toUpperCase();
      pill.className = `driver-pill ${activeGame.driver || 'ws-mod'}`;
    }

    // Update target info in Control Bar
    const targetInfo = document.getElementById('active-target-info');
    if (targetInfo) {
      const proc = activeGame.targetProcess ? ` → ${activeGame.targetProcess}` : '';
      targetInfo.textContent = `Target: ${activeGame.name} [${(activeGame.driver || 'ws-mod').toUpperCase()}${proc}]`;
    }

    // Populate Preset Selector Dropdown
    const presetSelect = document.getElementById('preset-select');
    const presetsList = config?.presets || activeGame.presets || [{ id: 'default', name: 'Default' }];
    if (presetSelect) {
      presetSelect.innerHTML = presetsList
        .map(p => `<option value="${esc(p.id)}" ${p.id === activePresetId ? 'selected' : ''}>${esc(p.name)}</option>`)
        .join('');
    }

    // Update Configurator Context Banner
    const ccbIcon = document.getElementById('ccb-icon');
    const ccbGame = document.getElementById('ccb-game-name');
    const ccbPreset = document.getElementById('ccb-preset-name');
    const ccbDesc = document.getElementById('ccb-driver-desc');
    const currentPresetObj = presetsList.find(p => p.id === activePresetId) || presetsList[0];

    if (ccbIcon) ccbIcon.textContent = activeGame.icon || '🎮';
    if (ccbGame) ccbGame.textContent = activeGame.name;
    if (ccbPreset) ccbPreset.textContent = currentPresetObj?.name || activePresetId;
    if (ccbDesc) {
      const driverDescMap = {
        'ws-mod': 'Driver: Unity / C# Mod WebSocket (:7827)',
        'keystroke': `Driver: Keystroke Macro (${(activeGame.inputMethod || 'sendinput').toUpperCase()}) → ${activeGame.targetProcess || 'Active Window'}`,
        'rcon': `Driver: Minecraft RCON / ServerTap (${activeGame.rconConfig?.host || '127.0.0.1'}:${activeGame.rconConfig?.port || 4567})`
      };
      ccbDesc.textContent = `${driverDescMap[activeGame.driver] || 'Driver: Custom'} · ${Object.keys(activeGame.effects || {}).length} Efek tersedia`;
    }
  }
}

async function selectActiveGame(gameId, presetId = 'default') {
  if (gameDropdown) gameDropdown.style.display = 'none';
  try {
    const res = await api('POST', '/api/games/select', { gameId, presetId });
    if (res.success) {
      config = res.config;
      games = res.games || games;
      appState.activeGameId = res.activeGameId;
      appState.activePresetId = res.activePresetId;
      renderGameSelector(games);
      renderConfigurator();
      renderEffectsLib(currentEffectFilter);
      renderSettings();
      toast(`Game aktif: ${getActiveGameObj()?.name || gameId} (Preset: ${res.activePresetId})`, 'success');
    } else {
      toast(res.error || 'Gagal mengganti game', 'error');
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

// Preset Dropdown Change
document.getElementById('preset-select')?.addEventListener('change', (e) => {
  const presetId = e.target.value;
  const activeId = config?.activeGameId || appState.activeGameId || 'CarJunkyard';
  selectActiveGame(activeId, presetId);
});

// Create / Duplicate Preset Button
document.getElementById('btn-new-preset')?.addEventListener('click', async () => {
  const name = prompt('Masukkan nama Preset baru (akan menyalin konfigurasi saat ini):', 'Mode Rusuh / Subathon');
  if (!name || !name.trim()) return;
  const activeId = config?.activeGameId || appState.activeGameId || 'CarJunkyard';
  collectAllConfiguratorTables();
  const res = await api('POST', `/api/games/${encodeURIComponent(activeId)}/presets`, {
    name: name.trim(),
    copyFromCurrent: true
  });
  if (res.success) {
    config = res.config;
    games = res.games;
    appState.activePresetId = res.activePresetId;
    renderGameSelector(games);
    renderConfigurator();
    toast(`Preset "${name.trim()}" berhasil dibuat!`, 'success');
  } else {
    toast(res.error || 'Gagal membuat preset', 'error');
  }
});

// Delete Preset Button
document.getElementById('btn-delete-preset')?.addEventListener('click', async () => {
  const activeId = config?.activeGameId || appState.activeGameId || 'CarJunkyard';
  const presetId = config?.activePresetId || appState.activePresetId || 'default';
  if (presetId === 'default') {
    return toast('Preset Default tidak dapat dihapus.', 'error');
  }
  if (!confirm(`Hapus preset "${presetId}"?`)) return;
  const res = await api('DELETE', `/api/games/${encodeURIComponent(activeId)}/presets/${encodeURIComponent(presetId)}`);
  if (res.success) {
    config = res.config;
    games = res.games;
    appState.activePresetId = res.activePresetId;
    renderGameSelector(games);
    renderConfigurator();
    toast('Preset dihapus, kembali ke Default.', 'info');
  } else {
    toast(res.error || 'Gagal menghapus preset', 'error');
  }
});

// Export Preset JSON
document.getElementById('btn-export-preset')?.addEventListener('click', () => {
  if (!config) return;
  collectAllConfiguratorTables();
  const activeId = config.activeGameId || 'CarJunkyard';
  const presetId = config.activePresetId || 'default';
  const exportPayload = {
    agivaPresetVersion: '3.0',
    gameId: activeId,
    id: presetId,
    name: `${activeId} - ${presetId}`,
    giftMappings: config.giftMappings || [],
    coinTiers: config.coinTiers || [],
    chatCommands: config.chatCommands || [],
    donationTiers: config.donationTiers || [],
    socialEvents: config.socialEvents || [],
    eventMappings: config.eventMappings || { like: { thresholds: [] } }
  };
  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${activeId}-${presetId}.agiva-preset.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Preset berhasil di-export!', 'success');
});

// Import Preset JSON
const presetFileInput = document.getElementById('preset-file-input');
document.getElementById('btn-import-preset')?.addEventListener('click', () => {
  presetFileInput?.click();
});
presetFileInput?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const activeId = config?.activeGameId || appState.activeGameId || 'CarJunkyard';
    const presetName = parsed.name || file.name.replace(/\.json$/i, '');
    const res = await api('POST', `/api/games/${encodeURIComponent(activeId)}/presets`, {
      name: presetName,
      presetData: parsed
    });
    if (res.success) {
      config = res.config;
      games = res.games;
      appState.activePresetId = res.activePresetId;
      renderGameSelector(games);
      renderConfigurator();
      toast(`Preset "${presetName}" berhasil di-import!`, 'success');
    } else {
      toast(res.error || 'Gagal import preset', 'error');
    }
  } catch (err) {
    toast('File JSON tidak valid: ' + err.message, 'error');
  }
  presetFileInput.value = '';
});

// ─── Modals Helper (Add Game, Add Effect, Simulator) ──────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'flex';
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.style.display = 'none';
  });
});

// Open Add Game Modal
document.getElementById('btn-open-add-game')?.addEventListener('click', () => {
  if (gameDropdown) gameDropdown.style.display = 'none';
  openModal('modal-add-game');
});

document.getElementById('btn-submit-new-game')?.addEventListener('click', async () => {
  const name = document.getElementById('new-game-name').value.trim();
  const icon = document.getElementById('new-game-icon').value.trim() || '🎮';
  const driver = document.getElementById('new-game-driver').value;
  const inputMethod = document.getElementById('new-game-input-method').value;
  const targetProcess = document.getElementById('new-game-process').value.trim();
  const description = document.getElementById('new-game-desc').value.trim();

  if (!name) return toast('Masukkan nama game terlebih dahulu', 'error');
  const id = name.replace(/[^a-zA-Z0-9_-]/g, '');

  // Create default starter effect based on driver
  const starterEffects = {};
  if (driver === 'keystroke') {
    starterEffects.jump_action = {
      id: 'jump_action',
      label: 'Lompat (HOLD SPACE)',
      description: 'Tahan tombol SPACE selama 350ms',
      category: 'player',
      duration: 400,
      driver: 'keystroke',
      macro: 'HOLD 350 SPACE'
    };
    starterEffects.forward_action = {
      id: 'forward_action',
      label: 'Maju Paksa (2 Detik)',
      description: 'Tahan tombol W selama 2000ms',
      category: 'player',
      duration: 2000,
      driver: 'keystroke',
      macro: 'HOLD 2000 W'
    };
  } else if (driver === 'rcon') {
    starterEffects.rcon_cmd_1 = {
      id: 'rcon_cmd_1',
      label: 'Say Hello Viewer',
      description: 'Kirim pesan sambutan ke server',
      category: 'world',
      duration: 500,
      driver: 'rcon',
      command: 'say Terima kasih {user} atas dukungannya!'
    };
  } else {
    starterEffects.custom_mod_effect = {
      id: 'custom_mod_effect',
      label: 'Custom Mod Effect',
      description: 'Kirim trigger ke mod WebSocket (:7827)',
      category: 'special',
      duration: 1000,
      driver: 'ws-mod'
    };
  }

  const res = await api('POST', '/api/games/create', {
    id,
    name,
    icon,
    driver,
    inputMethod,
    targetProcess,
    description,
    effects: starterEffects
  });

  if (res.success) {
    config = res.config;
    games = res.games;
    appState.activeGameId = res.activeGameId;
    appState.activePresetId = 'default';
    closeModal('modal-add-game');
    renderGameSelector(games);
    renderConfigurator();
    renderEffectsLib('all');
    renderSettings();
    toast(`Game "${name}" berhasil ditambahkan!`, 'success');
  } else {
    toast(res.error || 'Gagal membuat game', 'error');
  }
});

// Open Add Effect Modal
function openAddEffectModal() {
  const activeGame = getActiveGameObj();
  if (activeGame) {
    document.getElementById('new-eff-driver').value = activeGame.driver || 'keystroke';
    toggleEffectDriverFields();
  }
  openModal('modal-add-effect');
}
document.getElementById('btn-open-add-effect')?.addEventListener('click', openAddEffectModal);
document.getElementById('btn-cfg-add-effect')?.addEventListener('click', openAddEffectModal);

function toggleEffectDriverFields() {
  const drv = document.getElementById('new-eff-driver').value;
  document.getElementById('new-eff-macro-box').style.display = drv === 'keystroke' ? 'block' : 'none';
  document.getElementById('new-eff-cmd-box').style.display = drv === 'rcon' ? 'block' : 'none';
}
document.getElementById('new-eff-driver')?.addEventListener('change', toggleEffectDriverFields);

document.getElementById('new-eff-label')?.addEventListener('input', (e) => {
  const idInput = document.getElementById('new-eff-id');
  if (idInput && !idInput.dataset.touched) {
    idInput.value = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }
});
document.getElementById('new-eff-id')?.addEventListener('input', (e) => {
  e.target.dataset.touched = 'true';
});

document.getElementById('btn-submit-new-effect')?.addEventListener('click', async () => {
  const activeId = config?.activeGameId || appState.activeGameId || 'CarJunkyard';
  const label = document.getElementById('new-eff-label').value.trim();
  const id = document.getElementById('new-eff-id').value.trim();
  const category = document.getElementById('new-eff-cat').value;
  const duration = parseInt(document.getElementById('new-eff-duration').value) || 0;
  const driver = document.getElementById('new-eff-driver').value;
  const macro = document.getElementById('new-eff-macro').value.trim();
  const command = document.getElementById('new-eff-cmd').value.trim();
  const description = document.getElementById('new-eff-desc').value.trim();

  if (!label || !id) return toast('Nama dan ID Efek wajib diisi', 'error');

  const res = await api('POST', `/api/games/${encodeURIComponent(activeId)}/effects`, {
    id,
    label,
    category,
    duration,
    driver,
    macro,
    command,
    description
  });

  if (res.success) {
    config = res.config;
    games = res.games;
    closeModal('modal-add-effect');
    renderGameSelector(games);
    renderConfigurator();
    renderEffectsLib(currentEffectFilter);
    toast(`Efek "${label}" berhasil ditambahkan ke ${activeId}!`, 'success');
  } else {
    toast(res.error || 'Gagal menyimpan efek', 'error');
  }
});

// ─── Live Event Simulator Modal ───────────────────────────
function openSimulatorModal() {
  const simSelect = document.getElementById('sim-gift-select');
  if (simSelect) {
    const sampleGifts = giftsData.length > 0
      ? giftsData.slice(0, 40)
      : [
          { id: 5655, name: 'Rose', coins: 1 },
          { id: 5487, name: 'Finger Heart', coins: 5 },
          { id: 5879, name: 'Doughnut', coins: 30 },
          { id: 8913, name: 'RosaNebula', coins: 99 },
          { id: 19447, name: 'Galaxy', coins: 1000 }
        ];
    simSelect.innerHTML = sampleGifts
      .map(g => `<option value="${g.id}" data-name="${esc(g.name)}" data-coins="${g.coins}">${esc(g.name)} (${g.coins}💎 - ID: ${g.id})</option>`)
      .join('');
  }
  openModal('modal-simulator');
}
document.getElementById('btn-open-simulator')?.addEventListener('click', openSimulatorModal);
document.getElementById('btn-quick-sim')?.addEventListener('click', openSimulatorModal);

document.getElementById('btn-sim-gift')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const user = document.getElementById('sim-user').value.trim() || 'Budi_Agiva';
    const sel = document.getElementById('sim-gift-select');
    const opt = sel.options[sel.selectedIndex];
    const giftId = Number(sel.value) || 5655;
    const giftName = opt?.dataset.name || 'Rose';
    const coins = Number(opt?.dataset.coins) || 1;
    await api('POST', '/api/simulate', { type: 'gift', user, giftId, giftName, coins });
    toast(`Simulasi Gift: ${giftName} (${coins}💎) dari ${user}`, 'success');
  } finally {
    setTimeout(() => { btn.disabled = false; }, 400);
  }
});

document.querySelectorAll('[data-sim]').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    const button = e.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    try {
      const user = document.getElementById('sim-user').value.trim() || 'Budi_Agiva';
      const type = button.dataset.sim;
      const count = Number(button.dataset.count) || 50;
      await api('POST', '/api/simulate', { type, user, count });
      toast(`Simulasi ${type.toUpperCase()} dikirim!`, 'success');
    } finally {
      setTimeout(() => { button.disabled = false; }, 400);
    }
  });
});

document.getElementById('btn-sim-chat')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const user = document.getElementById('sim-user').value.trim() || 'Budi_Agiva';
    const comment = document.getElementById('sim-chat-input').value.trim() || '!lompat';
    await api('POST', '/api/simulate', { type: 'chat', user, comment });
    toast(`Simulasi Chat "${comment}" dikirim!`, 'success');
  } finally {
    setTimeout(() => { btn.disabled = false; }, 400);
  }
});

document.getElementById('btn-sim-donation')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const user = document.getElementById('sim-user').value.trim() || 'Budi_Agiva';
    const amount = Number(document.getElementById('sim-donation-amount').value) || 10000;
    await api('POST', '/api/simulate', { type: 'donation', user, amount, platform: 'saweria' });
    toast(`Simulasi Donasi Rp ${amount.toLocaleString('id-ID')} dikirim!`, 'success');
  } finally {
    setTimeout(() => { btn.disabled = false; }, 400);
  }
});

// ─── Gifts Data Tab ───────────────────────────────────────
async function renderGiftsTab() {
  const grid = document.getElementById('gifts-data-grid');
  if (!grid) return;
  if (giftsData.length === 0) {
    grid.innerHTML = '<div class="feed-empty">Belum ada data gift. Silakan update.</div>';
    return;
  }

  grid.innerHTML = '';
  giftsData.forEach(g => {
    const card = document.createElement('div');
    card.className = 'gift-card';
    card.innerHTML = `
      <img src="${esc(g.image)}" alt="${esc(g.name)}" class="gift-image" onerror="this.style.display='none'">
      <div class="gift-name">${esc(g.name)}</div>
      <div class="gift-coins">${g.coins} Coin${g.coins !== 1 ? 's' : ''}</div>
      <div class="gift-id">ID: ${g.id}</div>
    `;
    grid.appendChild(card);
  });
}

document.getElementById('btn-update-gifts')?.addEventListener('click', async () => {
  const inputEl = document.getElementById('gifts-username-input');
  const username = (inputEl?.value || appState.currentUsername || '').trim().replace(/^@/, '');

  const btn = document.getElementById('btn-update-gifts');
  btn.textContent = 'Updating...';
  btn.disabled = true;

  try {
    const res = await api('POST', '/api/gifts/update', { username });
    if (res.success) {
      giftsData = res.gifts;
      renderGiftsTab();
      if (document.getElementById('tab-configurator').classList.contains('active')) {
        renderConfigurator();
      }
      toast(`Berhasil memperbarui ${res.count || res.gifts.length} data gift!`, 'success');
    } else {
      toast(res.error || 'Gagal memperbarui data', 'error');
    }
  } catch (e) {
    toast(e.message, 'error');
  }
  btn.innerHTML = '🔄 Update Gift';
  btn.disabled = false;
});

// ─── Configurator (Filtered Strictly by Active Game) ──────
function renderConfigurator() {
  if (!config) return;
  renderGiftTable();
  renderCoinTierTable();
  renderChatCmdTable();
  renderDonationTable();
  renderEventRows();
  renderLikeTable();
}

/**
 * Only return effects belonging to the ACTIVE game so effects from other games never mix!
 */
function getEffectOptions() {
  const activeId = config?.activeGameId || appState.activeGameId || 'CarJunkyard';
  const activeGame = config?.games?.[activeId] || Object.values(config?.games || {})[0];
  const options = [];
  if (activeGame && activeGame.effects) {
    for (const [id, eff] of Object.entries(activeGame.effects)) {
      options.push({ id, label: eff.label || id, category: eff.category || 'general' });
    }
  }
  return options;
}

function getFirstEffectId() {
  const opts = getEffectOptions();
  return opts[0]?.id || '';
}

function buildEffectSelect(selected, name) {
  const opts = getEffectOptions();
  return `<select class="tier-effect-select" name="${esc(name)}">
    <option value="__none__" ${selected === '__none__' ? 'selected' : ''}>🚫 Nonaktif / Tanpa Efek Game (Hanya Multi-Action)</option>
    <option value="__random__" ${selected === '__random__' ? 'selected' : ''}>🎲 ACAK / GACHA (Semua Efek Game)</option>
    ${opts.map(o => `<option value="${esc(o.id)}" ${o.id === selected ? 'selected' : ''}>${esc(o.label)} (${esc(o.id)})</option>`).join('')}
  </select>`;
}

function buildChainCell(rowObj = {}) {
  const sounds = ttsSoundConfig?.soundboard?.items || [];
  const actions = actionsData?.actions || [];
  const soundId = rowObj.soundId || '';
  const actionId = rowObj.actionId || '';
  const spinWheel = Boolean(rowObj.spinWheel);
  const screen = rowObj.overlayScreen !== undefined ? Number(rowObj.overlayScreen) : 1;
  return `
    <div class="chain-mini-wrap">
      <select class="tier-label-input" data-field="soundId" title="Putar Soundboard" style="max-width:120px">
        <option value="">🔇 Tanpa Sound</option>
        ${sounds.map(s => `<option value="${esc(s.id)}" ${s.id === soundId ? 'selected' : ''}>🎵 ${esc(s.name)}</option>`).join('')}
      </select>
      <select class="tier-label-input" data-field="actionId" title="Jalankan Multi-Step Action" style="max-width:130px">
        <option value="">⚡ Tanpa Action</option>
        ${actions.map(a => `<option value="${esc(a.id)}" ${a.id === actionId ? 'selected' : ''}>⚡ ${esc(a.name)}</option>`).join('')}
      </select>
      <select class="tier-label-input" data-field="overlayScreen" title="Target Layar Overlay" style="max-width:105px">
        <option value="0" ${screen === 0 ? 'selected' : ''}>🖥️ Tanpa Screen</option>
        <option value="1" ${screen === 1 ? 'selected' : ''}>Screen 1</option>
        <option value="2" ${screen === 2 ? 'selected' : ''}>Screen 2</option>
        <option value="3" ${screen === 3 ? 'selected' : ''}>Screen 3</option>
        <option value="4" ${screen === 4 ? 'selected' : ''}>Screen 4</option>
        <option value="5" ${screen === 5 ? 'selected' : ''}>Screen 5</option>
      </select>
      <label class="checkbox-label" style="margin:0;font-size:11px" title="Ikut memutar Spin Wheel">
        <input type="checkbox" data-field="spinWheel" ${spinWheel ? 'checked' : ''}> 🎡 Spin
      </label>
    </div>
  `;
}

function buildRoleCell(ruleObj = {}) {
  const role = ruleObj.allowedRole || ruleObj.requiredRole || 'everyone';
  const specUsers = ruleObj.allowedUsers !== undefined
    ? ruleObj.allowedUsers
    : (Array.isArray(ruleObj.specificUsers)
      ? ruleObj.specificUsers.join(', ')
      : (ruleObj.specificUsers || ''));
  return `
    <div class="chain-mini-wrap">
      <select class="tier-label-input" data-field="allowedRole" style="max-width:135px">
        <option value="everyone" ${role === 'everyone' ? 'selected' : ''}>Everyone (Semua)</option>
        <option value="follower" ${role === 'follower' ? 'selected' : ''}>Follower</option>
        <option value="subscriber" ${role === 'subscriber' ? 'selected' : ''}>Subscriber</option>
        <option value="moderator" ${role === 'moderator' ? 'selected' : ''}>Moderator</option>
        <option value="min_gifter" ${role === 'min_gifter' ? 'selected' : ''}>Min. Gifter</option>
        <option value="specific_users" ${role === 'specific_users' ? 'selected' : ''}>Specific Users</option>
      </select>
      <input class="tier-label-input" data-field="allowedUsers" value="${esc(specUsers)}" placeholder="@user1, @user2" title="Whitelist Specific Users (pisahkan koma)" style="max-width:130px">
    </div>
  `;
}

let activeGiftPickerRow = null;

function buildGiftSelect(selected) {
  const selectedGift = giftsData.find(g => String(g.id) === String(selected));
  const displayText = selectedGift
    ? `${selectedGift.name} (${selectedGift.coins}💎)`
    : (selected ? `Gift ID: ${selected}` : '-- Pilih Gift --');
  const thumbHtml = selectedGift?.image
    ? `<img src="${esc(selectedGift.image)}" alt="" class="gift-picker-thumb" loading="lazy">`
    : '<span class="gift-picker-emoji">🎁</span>';

  return `
    <div class="gift-picker-cell">
      <input type="hidden" data-field="giftId" value="${esc(selected ?? '')}">
      <button type="button" class="gift-picker-btn" onclick="openGiftPicker(this)">
        ${thumbHtml}
        <span class="gift-picker-text">${esc(displayText)}</span>
        <span class="gift-picker-caret">▾</span>
      </button>
    </div>
  `;
}

function getGiftCatalogForPicker() {
  if (Array.isArray(giftsData) && giftsData.length > 0) return giftsData;
  return [
    { id: 5655, name: 'Rose', coins: 1, image: '' },
    { id: 5487, name: 'Finger Heart', coins: 5, image: '' },
    { id: 5879, name: 'Doughnut', coins: 30, image: '' },
    { id: 8913, name: 'RosaNebula', coins: 99, image: '' },
    { id: 19447, name: 'Galaxy', coins: 1000, image: '' }
  ];
}

function renderGiftPickerGrid() {
  const grid = document.getElementById('gift-picker-grid');
  if (!grid) return;
  const term = (document.getElementById('gift-picker-search')?.value || '').trim().toLowerCase();
  const sortMode = document.getElementById('gift-picker-sort')?.value || 'coins-asc';
  const currentId = activeGiftPickerRow?.querySelector('input[data-field="giftId"]')?.value || '';

  let list = [...getGiftCatalogForPicker()];
  if (term) {
    list = list.filter(g =>
      String(g.name || '').toLowerCase().includes(term) ||
      String(g.id || '').includes(term) ||
      String(g.coins || '').includes(term)
    );
  }
  if (sortMode === 'coins-asc') list.sort((a, b) => (a.coins || 0) - (b.coins || 0));
  else if (sortMode === 'coins-desc') list.sort((a, b) => (b.coins || 0) - (a.coins || 0));
  else if (sortMode === 'name') list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  if (list.length === 0) {
    grid.innerHTML = '<div class="feed-empty" style="grid-column:1/-1;">Gift tidak ditemukan. Coba kata kunci lain atau update katalog gift.</div>';
    return;
  }

  grid.innerHTML = list.map(g => `
    <button type="button" class="gift-picker-item ${String(g.id) === String(currentId) ? 'selected' : ''}" data-gift-id="${esc(g.id)}">
      ${g.image ? `<img src="${esc(g.image)}" alt="${esc(g.name)}" loading="lazy">` : '<span style="font-size:28px;">🎁</span>'}
      <span class="gift-picker-item-name">${esc(g.name)}</span>
      <span class="gift-picker-item-meta">${g.coins}💎 · ID ${g.id}</span>
    </button>
  `).join('');
}

window.openGiftPicker = function(btnEl) {
  activeGiftPickerRow = btnEl?.closest('tr') || null;
  const searchEl = document.getElementById('gift-picker-search');
  if (searchEl) searchEl.value = '';
  renderGiftPickerGrid();
  openModal('modal-gift-picker');
  setTimeout(() => searchEl?.focus(), 40);
};

document.getElementById('gift-picker-search')?.addEventListener('input', renderGiftPickerGrid);
document.getElementById('gift-picker-sort')?.addEventListener('change', renderGiftPickerGrid);
document.getElementById('gift-picker-grid')?.addEventListener('click', (e) => {
  const itemBtn = e.target.closest('.gift-picker-item');
  if (!itemBtn || !activeGiftPickerRow) return;
  const id = itemBtn.dataset.giftId;
  const gift = getGiftCatalogForPicker().find(g => String(g.id) === String(id));
  if (!gift) return;

  const hidden = activeGiftPickerRow.querySelector('input[data-field="giftId"]');
  const pickerBtn = activeGiftPickerRow.querySelector('.gift-picker-btn');
  if (hidden) hidden.value = gift.id;
  if (pickerBtn) {
    const thumbHtml = gift.image
      ? `<img src="${esc(gift.image)}" alt="" class="gift-picker-thumb" loading="lazy">`
      : '<span class="gift-picker-emoji">🎁</span>';
    pickerBtn.innerHTML = `
      ${thumbHtml}
      <span class="gift-picker-text">${esc(gift.name)} (${gift.coins}💎)</span>
      <span class="gift-picker-caret">▾</span>
    `;
  }
  closeModal('modal-gift-picker');
});

// 1. Specific Gift Table (9 columns matching index.html thead)
function renderGiftTable() {
  const tbody = document.getElementById('gift-rows');
  if (!tbody) return;
  tbody.innerHTML = '';
  (config.giftMappings || []).forEach((tier, i) => {
    const tr = document.createElement('tr');
    tr.dataset.idx = i;
    tr.innerHTML = `
      <td><input class="tier-label-input" value="${esc(tier.label)}" data-field="label"></td>
      <td>${buildGiftSelect(tier.giftId)}</td>
      <td>${buildEffectSelect(tier.effectId, 'effectId')}</td>
      <td>${buildRoleCell(tier)}</td>
      <td>${buildChainCell(tier)}</td>
      <td><label class="checkbox-label" style="margin:0"><input type="checkbox" data-field="multiplyByRepeat" ${tier.multiplyByRepeat ? 'checked' : ''}> xCombo</label></td>
      <td><label class="toggle-switch"><input type="checkbox" data-field="enabled" ${tier.enabled ? 'checked' : ''}><span class="toggle-slider"></span></label></td>
      <td><button type="button" class="btn-sm success" onclick="testRowEffect(this, 'gift')">▶ Test</button></td>
      <td><button type="button" class="btn-sm danger" onclick="deleteTier(${i})">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
}

// 2. Coin Range Tiers Table
function renderCoinTierTable() {
  const tbody = document.getElementById('coin-rows');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!config.coinTiers) config.coinTiers = [];
  config.coinTiers.forEach((tier, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="tier-num-input" type="number" data-field="minCoins" value="${tier.minCoins ?? 1}" min="1" style="width:90px"></td>
      <td><input class="tier-num-input" type="number" data-field="maxCoins" value="${tier.maxCoins ?? 99}" min="1" style="width:105px"></td>
      <td>${buildEffectSelect(tier.effectId, 'coin_eff_' + i)}</td>
      <td>${buildChainCell(tier)}</td>
      <td><label class="toggle-switch"><input type="checkbox" data-field="enabled" ${tier.enabled ? 'checked' : ''}><span class="toggle-slider"></span></label></td>
      <td><button type="button" class="btn-sm success" onclick="testRowEffect(this, 'coin_tier')">▶ Test</button></td>
      <td><button type="button" class="btn-sm danger" onclick="deleteCoinTier(${i})">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
}

// 3. Chat Command Table (9 columns matching index.html thead)
function renderChatCmdTable() {
  const tbody = document.getElementById('chatcmd-rows');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!config.chatCommands) config.chatCommands = [];
  config.chatCommands.forEach((cmd, i) => {
    const role = cmd.allowedRole || cmd.requiredRole || 'everyone';
    const specUsers = cmd.allowedUsers !== undefined
      ? cmd.allowedUsers
      : (Array.isArray(cmd.specificUsers)
        ? cmd.specificUsers.join(', ')
        : (cmd.specificUsers || ''));
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="tier-label-input" data-field="command" value="${esc(cmd.command || '!aksi')}" placeholder="!lompat" style="max-width:110px"></td>
      <td>
        <select class="tier-label-input" data-field="allowedRole" style="max-width:135px">
          <option value="everyone" ${role === 'everyone' ? 'selected' : ''}>Everyone (Semua)</option>
          <option value="follower" ${role === 'follower' ? 'selected' : ''}>Follower</option>
          <option value="subscriber" ${role === 'subscriber' ? 'selected' : ''}>Subscriber</option>
          <option value="moderator" ${role === 'moderator' ? 'selected' : ''}>Moderator</option>
          <option value="min_gifter" ${role === 'min_gifter' ? 'selected' : ''}>Min. Gifter</option>
          <option value="specific_users" ${role === 'specific_users' ? 'selected' : ''}>Specific Users</option>
        </select>
      </td>
      <td>
        <div class="chain-mini-wrap">
          <input class="tier-label-input" data-field="allowedUsers" value="${esc(specUsers)}" placeholder="@user1, @user2" title="Whitelist Specific Users (pisahkan koma)" style="max-width:130px">
          <input class="tier-num-input" type="number" data-field="minGifterLevel" value="${cmd.minGifterLevel ?? 1}" min="0" title="Min. Gifter Level" style="width:54px">
        </div>
      </td>
      <td><input class="tier-num-input" type="number" data-field="cooldown" value="${cmd.cooldown ?? 10}" min="0" style="width:68px" title="Global Cooldown (detik)"></td>
      <td><input class="tier-num-input" type="number" data-field="userCooldown" value="${cmd.userCooldown ?? 30}" min="0" style="width:68px" title="Cooldown Per-User (detik)"></td>
      <td>${buildEffectSelect(cmd.effectId, 'cmd_eff_' + i)}</td>
      <td><label class="toggle-switch"><input type="checkbox" data-field="enabled" ${cmd.enabled ? 'checked' : ''}><span class="toggle-slider"></span></label></td>
      <td><button type="button" class="btn-sm success" onclick="testRowEffect(this, 'chat')">▶ Test</button></td>
      <td><button type="button" class="btn-sm danger" onclick="deleteChatCmd(${i})">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
}

// 4. Donation Platform Tiers Table
function renderDonationTable() {
  const tbody = document.getElementById('donation-rows');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!config.donationTiers) config.donationTiers = [];
  config.donationTiers.forEach((tier, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="tier-label-input" data-field="label" value="${esc(tier.label || 'Donasi Rp 10rb+')}"></td>
      <td><input class="tier-num-input" type="number" data-field="minAmount" value="${tier.minAmount ?? 10000}" step="1000" style="width:140px"></td>
      <td>${buildEffectSelect(tier.effectId, 'don_eff_' + i)}</td>
      <td><label class="toggle-switch"><input type="checkbox" ${tier.enabled ? 'checked' : ''}><span class="toggle-slider"></span></label></td>
      <td><button type="button" class="btn-sm success" onclick="testRowEffect(this, 'donation')">▶ Test</button></td>
      <td><button type="button" class="btn-sm danger" onclick="deleteDonationTier(${i})">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
}

// 5. Social Event Rows
function renderEventRows() {
  const container = document.getElementById('event-rows');
  if (!container) return;

  if (!config.socialEvents) {
    config.socialEvents = [];
    if (config.eventMappings?.follow) config.socialEvents.push({ eventType: 'follow', ...config.eventMappings.follow });
  }

  const evList = config.socialEvents;
  const options = ['follow', 'share', 'repost', 'member', 'like'];

  let html = '<table class="config-table" style="width:100%"><thead><tr><th>Event Type</th><th>Effect (Game Aktif)</th><th>Enabled</th><th>Test</th><th></th></tr></thead><tbody>';

  evList.forEach((ev, i) => {
    html += `<tr>
      <td>
        <select class="tier-label-input" data-field="eventType">
          ${options.map(o => `<option value="${o}" ${o === ev.eventType ? 'selected' : ''}>${o.toUpperCase()}</option>`).join('')}
        </select>
      </td>
      <td>${buildEffectSelect(ev.effectId, 'effectId')}</td>
      <td><label class="toggle-switch"><input type="checkbox" ${ev.enabled ? 'checked' : ''}><span class="toggle-slider"></span></label></td>
      <td><button type="button" class="btn-sm success" onclick="testRowEffect(this, 'social')">▶ Test</button></td>
      <td><button type="button" class="btn-sm danger" onclick="deleteEventRow(${i})">✕</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

// 6. Like Threshold Table
function renderLikeTable() {
  const tbody = document.getElementById('like-rows');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!config.eventMappings) config.eventMappings = {};
  if (!config.eventMappings.like) config.eventMappings.like = { thresholds: [] };
  const thresholds = config.eventMappings.like.thresholds || [];
  thresholds.forEach((t, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="tier-num-input" type="number" value="${t.count}" style="width:100px"></td>
      <td>${buildEffectSelect(t.effectId, 'like_' + i)}</td>
      <td><label class="toggle-switch"><input type="checkbox" ${t.enabled ? 'checked' : ''}><span class="toggle-slider"></span></label></td>
      <td><button type="button" class="btn-sm success" onclick="testRowEffect(this, 'like')">▶ Test</button></td>
      <td><button type="button" class="btn-sm danger" onclick="deleteLikeRow(${i})">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
}

// Test current row's selected effect dynamically (including Multi-Action Chain)
window.testRowEffect = (btnEl, source) => {
  if (btnEl) {
    btnEl.disabled = true;
    setTimeout(() => { btnEl.disabled = false; }, 400);
  }
  const tr = btnEl?.closest('tr');
  const sel = tr?.querySelector('.tier-effect-select');
  const effectId = sel ? sel.value : getFirstEffectId();
  const rawScreen = tr?.querySelector('select[data-field="overlayScreen"]')?.value;
  const parsedScreen = parseInt(rawScreen, 10);
  const chainActions = {
    label: tr?.querySelector('input[data-field="label"]')?.value.trim() || '',
    soundId: tr?.querySelector('select[data-field="soundId"]')?.value || '',
    actionId: tr?.querySelector('select[data-field="actionId"]')?.value || '',
    overlayScreen: Number.isNaN(parsedScreen) ? 0 : parsedScreen,
    spinWheel: Boolean(tr?.querySelector('input[data-field="spinWheel"]')?.checked)
  };
  window.testEffect(effectId, source, chainActions);
};

// Row Deletions & Additions
window.deleteTier = (i) => { collectAllConfiguratorTables(); config.giftMappings.splice(i, 1); renderGiftTable(); };
window.deleteCoinTier = (i) => { collectAllConfiguratorTables(); config.coinTiers.splice(i, 1); renderCoinTierTable(); };
window.deleteChatCmd = (i) => { collectAllConfiguratorTables(); config.chatCommands.splice(i, 1); renderChatCmdTable(); };
window.deleteDonationTier = (i) => { collectAllConfiguratorTables(); config.donationTiers.splice(i, 1); renderDonationTable(); };
window.deleteEventRow = (i) => { collectAllConfiguratorTables(); config.socialEvents.splice(i, 1); renderEventRows(); };
window.deleteLikeRow = (i) => { collectAllConfiguratorTables(); config.eventMappings.like.thresholds.splice(i, 1); renderLikeTable(); };

document.getElementById('btn-add-tier')?.addEventListener('click', () => {
  collectAllConfiguratorTables();
  config.giftMappings.push({ id: `tier_${Date.now()}`, label: 'New Gift Tier', giftId: 5655, effectId: getFirstEffectId(), enabled: true });
  renderGiftTable();
});
document.getElementById('btn-add-cointier')?.addEventListener('click', () => {
  collectAllConfiguratorTables();
  config.coinTiers.push({ id: `coin_${Date.now()}`, minCoins: 1, maxCoins: 10, effectId: getFirstEffectId(), enabled: true });
  renderCoinTierTable();
});
document.getElementById('btn-add-chatcmd')?.addEventListener('click', () => {
  collectAllConfiguratorTables();
  config.chatCommands.push({ command: '!aksi', cooldown: 10, effectId: getFirstEffectId(), enabled: true });
  renderChatCmdTable();
});
document.getElementById('btn-add-donation')?.addEventListener('click', () => {
  collectAllConfiguratorTables();
  config.donationTiers.push({ label: 'Donasi Rp 10.000+', minAmount: 10000, effectId: getFirstEffectId(), enabled: true });
  renderDonationTable();
});
document.getElementById('btn-add-event')?.addEventListener('click', () => {
  collectAllConfiguratorTables();
  config.socialEvents.push({ eventType: 'follow', effectId: getFirstEffectId(), enabled: true });
  renderEventRows();
});
document.getElementById('btn-add-threshold')?.addEventListener('click', () => {
  collectAllConfiguratorTables();
  config.eventMappings.like.thresholds.push({ count: 100, effectId: getFirstEffectId(), enabled: true });
  renderLikeTable();
});

function collectAllConfiguratorTables() {
  if (!config) return;
  collectGiftTableData();
  collectCoinTierData();
  collectChatCmdData();
  collectDonationData();
  collectEventRows();
  collectLikeTable();
}

document.getElementById('btn-save-config')?.addEventListener('click', async () => {
  collectAllConfiguratorTables();
  const res = await api('PUT', '/api/config', config);
  if (res.success) {
    config = res.config || config;
    toast(`Preset "${config.activePresetId}" untuk ${config.activeGameId} berhasil disimpan!`, 'success');
  } else {
    toast(res.error || 'Gagal menyimpan konfigurasi', 'error');
  }
});

function collectGiftTableData() {
  const rows = document.querySelectorAll('#gift-rows tr');
  config.giftMappings = [];
  rows.forEach((tr, i) => {
    const labelInput = tr.querySelector('input[data-field="label"]');
    const giftIdInput = tr.querySelector('input[data-field="giftId"]');
    const effectSelect = tr.querySelector('.tier-effect-select');
    const allowedRole = tr.querySelector('select[data-field="allowedRole"]')?.value || 'everyone';
    const allowedUsers = tr.querySelector('input[data-field="allowedUsers"]')?.value.trim() || '';
    const multiplyByRepeat = tr.querySelector('input[data-field="multiplyByRepeat"]')?.checked ?? false;
    const soundId = tr.querySelector('select[data-field="soundId"]')?.value || '';
    const actionId = tr.querySelector('select[data-field="actionId"]')?.value || '';
    const rawScreen = tr.querySelector('select[data-field="overlayScreen"]')?.value;
    const parsedScreen = parseInt(rawScreen, 10);
    const overlayScreen = Number.isNaN(parsedScreen) ? 0 : parsedScreen;
    const spinWheel = tr.querySelector('input[data-field="spinWheel"]')?.checked ?? false;
    const enabled = tr.querySelector('input[data-field="enabled"]')?.checked ?? true;
    const rawGiftId = giftIdInput ? giftIdInput.value : '';
    config.giftMappings.push({
      id: `tier_${i + 1}`,
      label: labelInput ? labelInput.value : `Tier ${i + 1}`,
      giftId: rawGiftId && !isNaN(rawGiftId) ? Number(rawGiftId) : rawGiftId,
      effectId: effectSelect ? effectSelect.value : getFirstEffectId(),
      allowedRole,
      allowedUsers,
      multiplyByRepeat,
      soundId,
      actionId,
      overlayScreen,
      spinWheel,
      enabled
    });
  });
}

function collectCoinTierData() {
  const rows = document.querySelectorAll('#coin-rows tr');
  config.coinTiers = [];
  rows.forEach((tr, i) => {
    const minCoins = parseInt(tr.querySelector('input[data-field="minCoins"]')?.value) || 1;
    const maxCoins = parseInt(tr.querySelector('input[data-field="maxCoins"]')?.value) || 99;
    const effectId = tr.querySelector('.tier-effect-select')?.value || getFirstEffectId();
    const soundId = tr.querySelector('select[data-field="soundId"]')?.value || '';
    const actionId = tr.querySelector('select[data-field="actionId"]')?.value || '';
    const rawScreen = tr.querySelector('select[data-field="overlayScreen"]')?.value;
    const parsedScreen = parseInt(rawScreen, 10);
    const overlayScreen = Number.isNaN(parsedScreen) ? 0 : parsedScreen;
    const spinWheel = tr.querySelector('input[data-field="spinWheel"]')?.checked ?? false;
    const enabled = tr.querySelector('input[data-field="enabled"]')?.checked ?? true;
    config.coinTiers.push({ id: `coin_${i + 1}`, minCoins, maxCoins, effectId, soundId, actionId, overlayScreen, spinWheel, enabled });
  });
}

function collectChatCmdData() {
  const rows = document.querySelectorAll('#chatcmd-rows tr');
  config.chatCommands = [];
  rows.forEach(tr => {
    const command = tr.querySelector('input[data-field="command"]')?.value.trim() || '!aksi';
    const allowedRole = tr.querySelector('select[data-field="allowedRole"]')?.value || 'everyone';
    const allowedUsers = tr.querySelector('input[data-field="allowedUsers"]')?.value.trim() || '';
    const specificUsers = allowedUsers.split(',').map(s => s.trim()).filter(Boolean);
    const minGifterLevel = parseInt(tr.querySelector('input[data-field="minGifterLevel"]')?.value) || 1;
    const cooldown = parseInt(tr.querySelector('input[data-field="cooldown"]')?.value) || 0;
    const userCooldown = parseInt(tr.querySelector('input[data-field="userCooldown"]')?.value) || 0;
    const effectId = tr.querySelector('.tier-effect-select')?.value || getFirstEffectId();
    const enabled = tr.querySelector('input[data-field="enabled"]')?.checked ?? true;
    config.chatCommands.push({
      command,
      allowedRole,
      allowedUsers,
      specificUsers,
      minGifterLevel,
      cooldown,
      userCooldown,
      effectId,
      enabled
    });
  });
}

function collectDonationData() {
  const rows = document.querySelectorAll('#donation-rows tr');
  config.donationTiers = [];
  rows.forEach(tr => {
    const label = tr.querySelector('input[data-field="label"]')?.value || 'Donasi';
    const minAmount = parseInt(tr.querySelector('input[data-field="minAmount"]')?.value) || 10000;
    const effectId = tr.querySelector('.tier-effect-select')?.value || getFirstEffectId();
    const enabled = tr.querySelector('input[type="checkbox"]')?.checked ?? true;
    config.donationTiers.push({ label, minAmount, effectId, enabled });
  });
}

function collectEventRows() {
  const rows = document.querySelectorAll('#event-rows tbody tr');
  config.socialEvents = [];
  rows.forEach(tr => {
    const typeSelect = tr.querySelector('select[data-field="eventType"]');
    const effectSelect = tr.querySelector('.tier-effect-select');
    const enabled = tr.querySelector('input[type="checkbox"]')?.checked ?? true;
    if (typeSelect && effectSelect) {
      config.socialEvents.push({
        eventType: typeSelect.value,
        effectId: effectSelect.value,
        enabled
      });
    }
  });
}

function collectLikeTable() {
  const rows = document.querySelectorAll('#like-rows tr');
  if (!config.eventMappings) config.eventMappings = {};
  if (!config.eventMappings.like) config.eventMappings.like = { thresholds: [] };
  config.eventMappings.like.thresholds = [];
  rows.forEach(tr => {
    const count = parseInt(tr.querySelector('input[type="number"]')?.value) || 100;
    const effectId = tr.querySelector('.tier-effect-select')?.value || getFirstEffectId();
    const enabled = tr.querySelector('input[type="checkbox"]')?.checked ?? true;
    config.eventMappings.like.thresholds.push({ count, effectId, enabled });
  });
}

let isTestingEffect = false;
window.testEffect = async (effectId, source = 'test', chainActions = null) => {
  if (isTestingEffect) return;
  isTestingEffect = true;
  try {
    const res = await api('POST', '/api/test-effect', { effectId, user: 'dashboard-test', source, chainActions });
    if (res.success) {
      if (res.skipGameEffect) {
        toast(res.chainExecuted ? 'Testing Multi-Action (Tanpa Efek Game)!' : 'Efek Nonaktif — pilih Action/Sound/Wheel terlebih dahulu!', res.chainExecuted ? 'success' : 'info');
      } else {
        toast(`Testing: ${res.effectId || effectId} [${(res.driver || 'ws-mod').toUpperCase()}]${res.chainExecuted ? ' + Multi-Action' : ''}`, 'success');
      }
    } else {
      toast(res.error || 'Failed to test effect', 'error');
    }
  } catch (err) {
    toast(err.message || 'Failed to test effect', 'error');
  } finally {
    setTimeout(() => { isTestingEffect = false; }, 350);
  }
};

// ─── Effects Library (Filtered Strictly to Active Game) ───
function renderEffectsLib(filterCat = 'all') {
  currentEffectFilter = filterCat;
  if (!config) return;
  const grid = document.getElementById('effects-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const catIcons = { camera: '📷', player: '🏃', minigame: '🎮', world: '🌍', visual: '✨', special: '⚡', system: '🛑', ui: '🖥️' };
  const activeId = config.activeGameId || appState.activeGameId || 'CarJunkyard';
  const activeGame = config.games?.[activeId] || Object.values(config.games || {})[0];

  if (!activeGame || !activeGame.effects) {
    grid.innerHTML = '<div class="feed-empty">Belum ada efek untuk game ini. Klik "+ Tambah Efek Baru".</div>';
    return;
  }

  for (const eff of Object.values(activeGame.effects)) {
    if (filterCat !== 'all' && eff.category !== filterCat) continue;
    const driver = eff.driver || activeGame.driver || 'ws-mod';
    const codeSnippet = eff.macro
      ? `Macro: ${eff.macro}`
      : eff.command
        ? `RCON: ${eff.command}`
        : `Mod ID: ${eff.id}`;

    const card = document.createElement('div');
    card.className = 'effect-card-item';
    card.innerHTML = `
      <div class="ec-top">
        <div class="ec-icon">${catIcons[eff.category] || '✨'}</div>
        <span class="driver-pill ${esc(driver)}">${esc(driver)}</span>
      </div>
      <div class="ec-name">${esc(eff.label)}</div>
      <div class="ec-desc">${esc(eff.description || '')}</div>
      <div class="ec-code">${esc(codeSnippet)}</div>
      <div class="ec-meta">
        <span class="ec-cat">${esc(eff.category || 'general')}</span>
        <span class="ec-dur">${eff.duration ? eff.duration + 'ms' : 'Instant'}</span>
      </div>
      <div class="ec-actions">
        <button type="button" class="btn-sm success" style="flex:1" onclick="testEffect('${esc(eff.id)}')">▶ Test Effect</button>
        <button type="button" class="btn-sm danger" title="Hapus Efek" onclick="deleteGameEffect('${esc(eff.id)}')">✕</button>
      </div>
    `;
    grid.appendChild(card);
  }

  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === filterCat);
  });
}

window.deleteGameEffect = async (effectId) => {
  const activeId = config?.activeGameId || appState.activeGameId || 'CarJunkyard';
  if (!confirm(`Hapus efek "${effectId}" dari game ${activeId}?`)) return;
  const res = await api('DELETE', `/api/games/${encodeURIComponent(activeId)}/effects/${encodeURIComponent(effectId)}`);
  if (res.success) {
    config = res.config;
    games = res.games;
    renderGameSelector(games);
    renderEffectsLib(currentEffectFilter);
    renderConfigurator();
    toast(`Efek "${effectId}" dihapus.`, 'info');
  } else {
    toast(res.error || 'Gagal menghapus efek', 'error');
  }
};

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => renderEffectsLib(btn.dataset.cat));
});

// ─── Events Table ─────────────────────────────────────────
function isEventTypeVisible(type) {
  const chk = document.getElementById(`filter-${type}`);
  return chk ? chk.checked : true;
}

['gift', 'follow', 'subscribe', 'member', 'like', 'share', 'emote', 'chat', 'donation'].forEach(t => {
  document.getElementById(`filter-${t}`)?.addEventListener('change', renderEventsTable);
});

function renderEventsTable() {
  const tbody = document.getElementById('events-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  events.filter(ev => isEventTypeVisible(ev.type)).slice(0, 100).forEach(ev => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-family:var(--font-mono);font-size:11px">${new Date(ev.time).toLocaleTimeString()}</td>
      <td><span class="type-badge ${esc(ev.type)}">${esc(ev.type)}</span></td>
      <td><strong>${esc(ev.user)}</strong></td>
      <td>${formatEventDetail(ev)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function addEventRow(ev) {
  events.unshift(ev);
  if (events.length > 500) events.pop();
  if (!isEventTypeVisible(ev.type)) return;
  const tbody = document.getElementById('events-body');
  if (!tbody) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td style="font-family:var(--font-mono);font-size:11px">${new Date(ev.time).toLocaleTimeString()}</td>
    <td><span class="type-badge ${esc(ev.type)}">${esc(ev.type)}</span></td>
    <td><strong>${esc(ev.user)}</strong></td>
    <td>${formatEventDetail(ev)}</td>
  `;
  tr.style.animation = 'slideIn 0.2s ease';
  tbody.insertBefore(tr, tbody.firstChild);
  if (tbody.children.length > 100) tbody.lastChild.remove();
}

function formatEventDetail(ev) {
  if (ev.type === 'gift') return `<span>${esc(ev.giftName)} · <strong>${ev.coins}💎</strong></span>`;
  if (ev.type === 'like') return `${ev.count} likes`;
  if (ev.type === 'chat') return `"${esc(ev.comment || '')}"`;
  if (ev.type === 'donation') return `Rp ${Number(ev.amount || 0).toLocaleString('id-ID')} (${esc(ev.platform || 'Donasi')})`;
  if (ev.type === 'subscribe') return 'Subscribed!';
  if (ev.type === 'emote') return `Emote ${esc(ev.emoteId || '')}`;
  if (ev.type === 'envelope') return `Angpao ${ev.coins || 0}💎`;
  if (ev.type === 'battle') return 'PK Battle!';
  return '—';
}

// ─── Settings & Drivers Tab ───────────────────────────────
function renderSettings() {
  const activeGame = getActiveGameObj();
  if (activeGame) {
    const methodEl = document.getElementById('driver-input-method');
    const procEl = document.getElementById('driver-target-process');
    if (methodEl) methodEl.value = activeGame.inputMethod || 'sendinput';
    if (procEl) procEl.value = activeGame.targetProcess || '';
  }

  const incomingUrlEl = document.getElementById('incoming-webhook-url');
  if (incomingUrlEl) {
    incomingUrlEl.value = `${location.origin}/api/webhook/donation/saweria`;
  }

  const countLabel = document.getElementById('games-count-label');
  if (countLabel) countLabel.textContent = games.length;

  const gamesList = document.getElementById('settings-games');
  if (!gamesList) return;
  gamesList.innerHTML = '';
  games.forEach(g => {
    const div = document.createElement('div');
    div.style = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:2px solid var(--line);border-radius:var(--radius);margin-bottom:8px;';
    const deleteBtn = g.id !== 'CarJunkyard'
      ? `<button type="button" class="btn-sm danger" onclick="removeCustomGame('${esc(g.id)}')">Hapus</button>`
      : '';
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:20px">${esc(g.icon)}</span>
        <div>
          <div style="font-weight:800;font-size:13px">${esc(g.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono)">ID: ${esc(g.id)} · Driver: ${esc(g.driver || 'ws-mod')}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;">
        <button type="button" class="btn-sm" onclick="selectActiveGame('${esc(g.id)}', 'default')">Pilih</button>
        ${deleteBtn}
      </div>
    `;
    gamesList.appendChild(div);
  });
}

window.removeCustomGame = async (gameId) => {
  if (!confirm(`Hapus game "${gameId}" beserta semua presetnya?`)) return;
  const res = await api('DELETE', `/api/games/${encodeURIComponent(gameId)}`);
  if (res.success) {
    config = res.config;
    games = res.games;
    renderGameSelector(games);
    renderSettings();
    renderConfigurator();
    toast(`Game "${gameId}" dihapus.`, 'info');
  } else {
    toast(res.error || 'Gagal menghapus game', 'error');
  }
};

document.getElementById('connection-mode-select')?.addEventListener('change', async (e) => {
  const mode = e.target.value;
  const res = await api('POST', '/api/connection-mode', { mode });
  if (res.success) {
    appState.connectionMode = mode;
    toast(`Mode Koneksi diubah ke: ${mode.toUpperCase()}`, 'success');
  }
});

document.getElementById('btn-scan-windows')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-scan-windows');
  btn.textContent = 'Scanning...';
  const windows = await api('GET', '/api/windows');
  btn.textContent = '🔄 Scan';
  const sel = document.getElementById('running-windows-select');
  if (Array.isArray(windows) && windows.length > 0) {
    sel.style.display = 'block';
    sel.innerHTML = `<option value="">-- Pilih Jendela Aplikasi yang Sedang Berjalan (${windows.length}) --</option>` +
      windows.map(w => `<option value="${esc(w.processName)}">${esc(w.processName)} — ${esc(w.windowTitle)}</option>`).join('');
    sel.onchange = () => {
      if (sel.value) document.getElementById('driver-target-process').value = sel.value;
    };
    toast(`Ditemukan ${windows.length} proses window aktif`, 'success');
  } else {
    toast('Tidak ada proses window yang terdeteksi', 'info');
  }
});

document.getElementById('btn-save-driver-settings')?.addEventListener('click', async () => {
  const activeGame = getActiveGameObj();
  if (!activeGame) return;
  const inputMethod = document.getElementById('driver-input-method').value;
  const targetProcess = document.getElementById('driver-target-process').value.trim();

  const res = await api('POST', '/api/games/create', {
    ...activeGame,
    inputMethod,
    targetProcess
  });
  if (res.success) {
    config = res.config;
    games = res.games;
    renderGameSelector(games);
    toast(`Pengaturan driver untuk ${activeGame.name} disimpan!`, 'success');
  }
});

document.getElementById('btn-copy-webhook')?.addEventListener('click', () => {
  const val = document.getElementById('incoming-webhook-url').value;
  navigator.clipboard?.writeText(val);
  toast('URL Webhook disalin ke clipboard!', 'success');
});

document.getElementById('btn-show-key')?.addEventListener('click', () => {
  const inp = document.getElementById('api-key-input');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

document.getElementById('btn-save-key')?.addEventListener('click', async () => {
  const key = document.getElementById('api-key-input').value;
  await api('POST', '/api/apikey', { key });
  toast('Eulerstream API Key saved!', 'success');
});

document.getElementById('btn-show-session')?.addEventListener('click', () => {
  const inp = document.getElementById('session-id-input');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

document.getElementById('btn-save-session')?.addEventListener('click', async () => {
  const session = document.getElementById('session-id-input').value;
  await api('POST', '/api/sessionid', { session });
  toast('Session ID saved!', 'success');
});

document.getElementById('btn-save-webhook')?.addEventListener('click', async () => {
  const url = document.getElementById('webhook-url').value;
  const secret = document.getElementById('webhook-secret').value;
  await api('POST', '/api/webhook', { url, secret });
  toast('Outgoing Webhook saved!', 'success');
});

document.getElementById('btn-save-queue')?.addEventListener('click', async () => {
  if (!config.queueSettings) config.queueSettings = {};
  config.queueSettings.maxQueueSize = parseInt(document.getElementById('queue-size').value) || 100;
  config.queueSettings.minDelayBetweenEffects = parseInt(document.getElementById('queue-delay').value) || 500;
  config.queueSettings.dropOnFull = document.getElementById('queue-drop').value === 'true';
  await api('PUT', '/api/config', config);
  toast('Queue settings saved!', 'success');
});

// ─── Batch A: Free Indonesian TTS & Soundboard ────────────
const BUILT_IN_SOUNDS = new Set([
  'horn_basuri',
  'siren_police',
  'coin_jackpot',
  'explosion_boom',
  'jump_boing',
  'alert_danger',
  'victory_fanfare',
  'laser_zap'
]);

const dashTtsQueue = [];
let isPlayingDashTts = false;
let currentDashboardTtsAudio = null;

function handleDashboardTtsSpeak(payload) {
  if (!payload || !payload.text) return;
  const playLocal = document.getElementById('tts-play-in-dashboard')?.checked ?? true;
  if (!playLocal) return;

  const maxQueue = Math.max(1, Number(payload.maxQueueLength) || 10);
  while (dashTtsQueue.length >= maxQueue) {
    dashTtsQueue.shift();
  }
  dashTtsQueue.push(payload);
  processDashboardTtsQueue();
}

function processDashboardTtsQueue() {
  if (isPlayingDashTts || dashTtsQueue.length === 0) return;
  const payload = dashTtsQueue.shift();
  isPlayingDashTts = true;

  const urls = Array.isArray(payload.audioUrls) && payload.audioUrls.length > 0
    ? payload.audioUrls
    : (payload.audioUrl ? [payload.audioUrl] : []);
  const rawVol = Number(payload.volume ?? 0.9);
  const normVol = Math.max(0, Math.min(1, rawVol > 1 ? rawVol / 100 : rawVol));
  const playbackRate = Math.max(0.5, Math.min(2.0, Number(payload.rate ?? payload.speed ?? 1.0)));

  const finish = () => {
    currentDashboardTtsAudio = null;
    isPlayingDashTts = false;
    setTimeout(processDashboardTtsQueue, 120);
  };

  const fallbackSpeech = (textToSpeak) => {
    if ('speechSynthesis' in window && textToSpeak) {
      try {
        const u = new SpeechSynthesisUtterance(textToSpeak);
        u.lang = payload.speechLang || payload.lang || 'id-ID';
        u.rate = playbackRate;
        u.pitch = Number(payload.pitch || 1.0);
        u.volume = normVol;
        u.onend = finish;
        u.onerror = finish;
        window.speechSynthesis.speak(u);
        return;
      } catch {}
    }
    finish();
  };

  if (urls.length === 0) {
    fallbackSpeech(payload.text);
    return;
  }

  let chunkIdx = 0;
  const playNextChunk = () => {
    if (chunkIdx >= urls.length) {
      finish();
      return;
    }
    const audio = new Audio(urls[chunkIdx]);
    audio.volume = normVol;
    audio.playbackRate = playbackRate;
    currentDashboardTtsAudio = audio;

    let settled = false;
    const onDone = () => {
      if (settled) return;
      settled = true;
      chunkIdx++;
      playNextChunk();
    };
    const onErr = () => {
      if (settled) return;
      settled = true;
      const remainingText = Array.isArray(payload.chunks) && payload.chunks.length > chunkIdx
        ? payload.chunks.slice(chunkIdx).join(' ')
        : payload.text;
      fallbackSpeech(remainingText);
    };

    audio.onended = onDone;
    audio.onerror = onErr;
    audio.play().catch(onErr);
  };

  playNextChunk();
}

function stopDashboardTts() {
  dashTtsQueue.length = 0;
  isPlayingDashTts = false;
  if (currentDashboardTtsAudio) {
    try { currentDashboardTtsAudio.pause(); } catch {}
    currentDashboardTtsAudio = null;
  }
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch {}
  }
}

function handleDashboardSoundPlay(payload) {
  const src = payload?.file || payload?.url;
  if (!src) return;
  const playLocal = document.getElementById('tts-play-in-dashboard')?.checked ?? true;
  if (!playLocal) return;
  const rawVol = Number(payload.volume ?? 0.85);
  const audio = new Audio(src);
  audio.volume = Math.max(0, Math.min(1, rawVol > 1 ? rawVol / 100 : rawVol));
  audio.play().catch(() => {});
}

function renderTtsTab() {
  if (!ttsSoundConfig) return;
  const tts = ttsSoundConfig.tts || {};
  const sb = ttsSoundConfig.soundboard || {};

  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = v;
  };
  const setChk = (id, v) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.checked = Boolean(v);
  };

  // Populate Edge Neural Voice options from backend catalog
  const voiceSel = document.getElementById('tts-edge-voice-select');
  if (voiceSel) {
    const curVoice = tts.edgeVoice || '';
    const voicesList = Array.isArray(ttsVoices) ? ttsVoices : [];
    const expectedHtml = `<option value="">✨ Otomatis Ikuti Bahasa Utama</option>` +
      voicesList.map(v => `<option value="${esc(v.id)}">${esc(v.name)} (${esc(v.lang)} · ${esc(v.gender || 'Neutral')})</option>`).join('');
    if (voiceSel.innerHTML !== expectedHtml) {
      voiceSel.innerHTML = expectedHtml;
    }
    if (document.activeElement !== voiceSel) voiceSel.value = curVoice;
  }

  const rawVol = Number(tts.volume ?? 0.9);
  const volPct = rawVol <= 1 ? Math.round(rawVol * 100) : Math.round(rawVol);
  const rateVal = tts.rate ?? tts.speed ?? 1.0;
  const usersStr = tts.allowedUsers || (Array.isArray(tts.specificUsers) ? tts.specificUsers.join(', ') : '');
  const cdSec = tts.cooldownSec ?? tts.userCooldownSec ?? 3;
  const minLevel = tts.minGifterLevel ?? tts.minGifterCoins ?? 1;
  const readChatEnabled = tts.readChat !== false && tts.chatMode !== 'off';

  setVal('tts-enabled-select', tts.enabled !== false ? 'true' : 'false');
  setVal('tts-engine-select', tts.engine || 'auto');
  setVal('tts-lang-select', tts.lang || 'id-ID');
  setChk('tts-random-voice', tts.randomVoice);
  setVal('tts-max-queue', tts.maxQueueLength || 10);
  setVal('tts-volume-range', volPct);
  setVal('tts-speed-range', rateVal);
  const volLabel = document.getElementById('tts-vol-val');
  if (volLabel) volLabel.textContent = volPct;
  const spdLabel = document.getElementById('tts-speed-val');
  if (spdLabel) spdLabel.textContent = rateVal;

  setVal('tts-role-select', tts.allowedRole || 'everyone');
  setVal('tts-prefix-input', tts.chatMode === 'all' ? '' : (tts.chatCommand || tts.commentPrefix || '!tts'));
  setVal('tts-specific-users', usersStr);
  setVal('tts-min-coins', minLevel);
  setVal('tts-cooldown-sec', cdSec);
  setChk('tts-read-chat', readChatEnabled);
  setChk('tts-read-gift', tts.readGifts !== false);
  setChk('tts-read-donation', tts.readDonations !== false);
  setVal('tts-template-gift', tts.giftTemplate || 'Terima kasih {nickname} atas {repeatcount} {giftname}!');
  setVal('tts-badwords', (tts.badwords || []).join(', '));

  const grid = document.getElementById('soundboard-grid');
  if (grid) {
    grid.innerHTML = '';
    (sb.items || []).forEach(item => {
      const div = document.createElement('div');
      div.className = 'sound-card';
      div.innerHTML = `
        <div class="sound-card-title">${esc(item.name)}</div>
        <div class="sound-card-actions">
          <button type="button" class="btn-sm success" style="flex:1" onclick="playSoundItem('${esc(item.id)}')">▶ Play</button>
          ${!BUILT_IN_SOUNDS.has(item.id) ? `<button type="button" class="btn-sm danger" onclick="deleteSoundItem('${esc(item.id)}')">✕</button>` : ''}
        </div>
      `;
      grid.appendChild(div);
    });
  }
}

async function refreshTtsLogs() {
  const listEl = document.getElementById('tts-logs-list');
  if (!listEl) return;
  try {
    const logs = await api('GET', '/api/tts/logs');
    if (!Array.isArray(logs) || logs.length === 0) {
      listEl.innerHTML = '<div class="form-hint">Belum ada riwayat TTS pada sesi ini.</div>';
      return;
    }
    listEl.innerHTML = logs.slice(0, 50).map(l => `
      <div class="tts-log-item">
        <div class="tts-log-info">
          <div class="action-card-title">
            <span>@${esc(l.user || 'Anon')}</span>
            <span class="badge-pill">${esc((l.engine || 'auto').toUpperCase())}</span>
            <span class="action-card-meta">${esc(l.voice || l.lang || '-')} · ${new Date(l.time || Date.now()).toLocaleTimeString()}</span>
          </div>
          <div style="font-size:12px;">"${esc(l.text || '')}"</div>
        </div>
        <span class="badge-pill" style="background:${l.status === 'failed' ? '#ff7675' : '#55efc4'}">${esc(l.status || 'ok')}</span>
      </div>
    `).join('');
  } catch {}
}

document.getElementById('btn-tts-logs-refresh')?.addEventListener('click', refreshTtsLogs);
document.getElementById('btn-tts-logs-clear')?.addEventListener('click', async () => {
  await api('DELETE', '/api/tts/logs');
  await refreshTtsLogs();
  toast('Riwayat log TTS dihapus.', 'info');
});

document.getElementById('tts-volume-range')?.addEventListener('input', (e) => {
  const el = document.getElementById('tts-vol-val');
  if (el) el.textContent = e.target.value;
});
document.getElementById('tts-speed-range')?.addEventListener('input', (e) => {
  const el = document.getElementById('tts-speed-val');
  if (el) el.textContent = e.target.value;
});

document.getElementById('btn-tts-save')?.addEventListener('click', async () => {
  const readChat = document.getElementById('tts-read-chat')?.checked ?? true;
  const prefixRaw = document.getElementById('tts-prefix-input')?.value.trim() || '';
  const specUsers = (document.getElementById('tts-specific-users')?.value || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const badwords = (document.getElementById('tts-badwords')?.value || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const volPct = Number(document.getElementById('tts-volume-range')?.value ?? 90);
  const rateVal = Number(document.getElementById('tts-speed-range')?.value ?? 1.0);
  const minLevel = Number(document.getElementById('tts-min-coins')?.value ?? 1);
  const cdSec = Number(document.getElementById('tts-cooldown-sec')?.value ?? 3);

  const payload = {
    tts: {
      enabled: document.getElementById('tts-enabled-select')?.value === 'true',
      engine: document.getElementById('tts-engine-select')?.value || 'auto',
      lang: document.getElementById('tts-lang-select')?.value || 'id-ID',
      edgeVoice: document.getElementById('tts-edge-voice-select')?.value || '',
      randomVoice: document.getElementById('tts-random-voice')?.checked ?? false,
      maxQueueLength: Math.max(1, Math.min(100, Number(document.getElementById('tts-max-queue')?.value ?? 10))),
      volume: Math.min(1, Math.max(0, volPct / 100)),
      rate: rateVal,
      speed: rateVal,
      allowedRole: document.getElementById('tts-role-select')?.value || 'everyone',
      allowedUsers: specUsers.join(', '),
      specificUsers: specUsers,
      minGifterLevel: minLevel,
      cooldownSec: cdSec,
      userCooldownSec: cdSec,
      readChat,
      chatMode: !readChat ? 'off' : (prefixRaw ? 'command' : 'all'),
      chatCommand: prefixRaw || '!tts',
      readGifts: document.getElementById('tts-read-gift')?.checked ?? true,
      readDonations: document.getElementById('tts-read-donation')?.checked ?? true,
      giftTemplate: document.getElementById('tts-template-gift')?.value || '',
      badwords
    }
  };
  const res = await api('PUT', '/api/tts-sound/config', payload);
  if (res.success) {
    ttsSoundConfig = res.config;
    toast('Pengaturan TTS diperbarui!', 'success');
  }
});

document.getElementById('btn-tts-test')?.addEventListener('click', async () => {
  const text = document.getElementById('tts-test-input')?.value.trim() || 'Halo streamer Agiva!';
  const lang = document.getElementById('tts-lang-select')?.value || 'id-ID';
  const voice = document.getElementById('tts-edge-voice-select')?.value || '';
  const engine = document.getElementById('tts-engine-select')?.value || 'auto';
  await api('POST', '/api/tts/speak', { text, lang, voice, engine, user: 'Dashboard-Test' });
  toast('Memutar suara TTS...', 'success');
  setTimeout(refreshTtsLogs, 500);
});

document.getElementById('btn-tts-skip')?.addEventListener('click', async () => {
  stopDashboardTts();
  await api('POST', '/api/tts/skip');
  toast('Suara TTS di-skip!', 'info');
});

window.playSoundItem = async (id) => {
  const res = await api('POST', '/api/soundboard/play', { id });
  if (!res.success) toast(res.error || 'Gagal memutar suara', 'error');
};

window.deleteSoundItem = async (id) => {
  const res = await api('DELETE', `/api/soundboard/${encodeURIComponent(id)}`);
  if (res.success) {
    ttsSoundConfig = await api('GET', '/api/tts-sound/config');
    renderTtsTab();
    toast('Efek suara dihapus', 'info');
  }
};

document.getElementById('soundboard-upload-input')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const res = await api('POST', '/api/soundboard/upload', {
      name: file.name.replace(/\.[^.]+$/, ''),
      filename: file.name,
      dataBase64: reader.result
    });
    if (res.success) {
      ttsSoundConfig = await api('GET', '/api/tts-sound/config');
      renderTtsTab();
      toast(`Sound "${res.item.name}" berhasil di-upload!`, 'success');
    } else {
      toast(res.error || 'Gagal upload audio', 'error');
    }
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

// ─── Batch B: Stream Widgets & Multi-Screen Overlay ───────
document.querySelectorAll('[data-copy-overlay]').forEach(btn => {
  btn.addEventListener('click', () => {
    const pathPart = btn.dataset.copyOverlay;
    const fullUrl = `${location.origin}${pathPart}`;
    navigator.clipboard?.writeText(fullUrl);
    toast(`Disalin: ${fullUrl}`, 'success');
  });
});

function updateTimerPreviewOnly(remSec, isRun) {
  const rem = Math.max(0, Number(remSec ?? 0));
  const h = String(Math.floor(rem / 3600)).padStart(2, '0');
  const m = String(Math.floor((rem % 3600) / 60)).padStart(2, '0');
  const s = String(rem % 60).padStart(2, '0');
  const timerPreview = document.getElementById('widget-timer-preview');
  if (timerPreview) timerPreview.textContent = `${h}:${m}:${s} ${isRun ? '🟢' : '⏸️'}`;
}

function setWidgetInputIfIdle(id, val, force = false) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!force && document.activeElement === el) return;
  el.value = val ?? '';
}

function setWidgetCheckIfIdle(id, val, force = false) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!force && document.activeElement === el) return;
  el.checked = Boolean(val);
}

function populateSelectOptionsPreservingValue(selectEl, optionsHtml, selectedValue, force = false) {
  if (!selectEl) return;
  if (selectEl.innerHTML !== optionsHtml) {
    selectEl.innerHTML = optionsHtml;
  }
  if (force || document.activeElement !== selectEl) {
    selectEl.value = selectedValue || '';
  }
}

function buildWheelSegRowHtml(seg = {}, idx = 0) {
  const effOpts = getEffectOptions();
  const actList = actionsData?.actions || [];
  const defColors = ['#ff6b35', '#ef4444', '#3b82f6', '#a855f7', '#10b981', '#eab308'];
  const color = seg.color || defColors[idx % defColors.length];
  return `
    <div class="wheel-seg-row" data-seg-id="${esc(seg.id || `seg_${idx + 1}`)}">
      <input type="color" class="wheel-seg-color" data-wfield="color" value="${esc(color)}" title="Warna Segmen">
      <input type="text" class="form-input" data-wfield="label" value="${esc(seg.label || '')}" placeholder="Label Hadiah" style="flex:2; min-width:110px;">
      <input type="number" class="form-input" data-wfield="weight" value="${Number(seg.weight) || 10}" min="1" max="100" title="Bobot Probabilitas (%)" style="width:68px;">
      <select class="form-input" data-wfield="effectId" title="Efek Game" style="flex:1; min-width:105px;">
        <option value="">-- Efek Game --</option>
        ${effOpts.map(o => `<option value="${esc(o.id)}" ${o.id === seg.effectId ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>
      <select class="form-input" data-wfield="actionId" title="Action" style="flex:1; min-width:105px;">
        <option value="">-- Action --</option>
        ${actList.map(a => `<option value="${esc(a.id)}" ${a.id === seg.actionId ? 'selected' : ''}>⚡ ${esc(a.name)}</option>`).join('')}
      </select>
      <button type="button" class="btn-sm danger btn-wheel-del-seg" title="Hapus Segmen">✕</button>
    </div>
  `;
}

function renderWheelEditor(wheelObj, force = false) {
  if (!wheelObj) return;
  setWidgetInputIfIdle('wheel-title-input', wheelObj.title || '🎡 RODA GACHA STREAMER', force);
  setWidgetCheckIfIdle('wheel-auto-trigger', wheelObj.autoTriggerEffect !== false, force);

  const editor = document.getElementById('wheel-segments-editor');
  if (!editor) return;
  if (wheelEditorDirty && !force) return;

  const segs = Array.isArray(wheelObj.segments) ? wheelObj.segments : [];
  editor.innerHTML = segs.slice(0, 24).map((seg, idx) => buildWheelSegRowHtml(seg, idx)).join('');
}

function syncGoalFormFromState(force = false) {
  if (!widgetState?.goals) return;
  const type = document.getElementById('goal-type-select')?.value || 'coins';
  const g = widgetState.goals[type] || widgetState.goals.coins || {};

  const badge = document.getElementById('goal-current-progress');
  if (badge) {
    badge.textContent = `${Number(g.current || 0).toLocaleString('id-ID')} / ${Number(g.target || 0).toLocaleString('id-ID')}`;
  }

  const effOptsHtml = '<option value="">-- Tanpa Efek Otomatis --</option>' +
    getEffectOptions().map(o => `<option value="${esc(o.id)}">${esc(o.label)} (${esc(o.id)})</option>`).join('');
  populateSelectOptionsPreservingValue(document.getElementById('goal-reward-effect'), effOptsHtml, g.rewardEffectId || '', force);

  if (force || !widgetsFormHydrated) {
    setWidgetInputIfIdle('goal-coins-title', g.title || 'Target Goal', force);
    setWidgetInputIfIdle('goal-coins-target', g.target ?? 100, force);
    setWidgetCheckIfIdle('goal-auto-scale', g.autoScale !== false, force);
    const remMins = g.deadlineAt > Date.now() ? Math.ceil((g.deadlineAt - Date.now()) / 60000) : 0;
    setWidgetInputIfIdle('goal-countdown-mins', remMins, force);
  }
}

function syncThemeFormFromState(force = false) {
  const th = widgetState?.theme;
  if (!th) return;
  if (!force && widgetsFormHydrated) return;
  setWidgetInputIfIdle('theme-pack-select', th.pack || 'default', force);
  setWidgetInputIfIdle('theme-font-family', th.fontFamily || 'Inter', force);
  setWidgetInputIfIdle('theme-font-scale', th.fontSizeScale ?? 1.0, force);
  setWidgetInputIfIdle('theme-text-color', th.textColor || '#f8fafc', force);
  setWidgetInputIfIdle('theme-accent-color', th.accentColor || '#6366f1', force);
  setWidgetInputIfIdle('theme-bg-color', th.bgColor || '#0b0f19', force);
  setWidgetInputIfIdle('theme-bg-opacity', th.bgOpacity ?? 0.9, force);
  setWidgetInputIfIdle('theme-border-radius', th.borderRadius ?? 16, force);
  setWidgetInputIfIdle('theme-animation', th.animation || 'pop', force);
  setWidgetInputIfIdle('theme-custom-css', th.customCss || '', force);
}

function syncScreenFormFromState(force = false) {
  const sid = document.getElementById('screen-config-select')?.value || '1';
  const sc = widgetState?.screens?.[sid];
  if (!sc) return;
  if (!force && widgetsFormHydrated) return;
  setWidgetInputIfIdle('screen-pos-select', sc.position || 'center', force);
  setWidgetInputIfIdle('screen-duration-ms', sc.defaultDurationMs ?? 4000, force);
  setWidgetInputIfIdle('screen-max-queue', sc.maxQueueLength ?? 10, force);
}

function renderWidgetsTab(forceForm = false) {
  if (!widgetState) return;
  const timer = widgetState.timer || widgetState.subathonTimer || {};
  const isRun = Boolean(timer.isRunning ?? timer.running);
  updateTimerPreviewOnly(timer.remainingSec ?? timer.remainingSeconds ?? 0, isRun);

  const wl = widgetState.counter || widgetState.winLose || { wins: 0, loses: 0 };
  const wlPrev = document.getElementById('winlose-preview');
  if (wlPrev) wlPrev.textContent = `WIN ${wl.wins || 0} - ${wl.loses ?? wl.losses ?? 0} LOSE`;

  const gw = widgetState.giveaway || {};
  const entries = gw.participants || gw.entries || [];
  const gwCount = document.getElementById('giveaway-count-label');
  if (gwCount) gwCount.textContent = `${entries.length} Peserta`;
  const gwKw = document.getElementById('giveaway-kw-preview');
  if (gwKw) gwKw.textContent = gw.keyword || '!ikut';
  const gwWin = document.getElementById('giveaway-winner-banner');
  if (gwWin) {
    gwWin.textContent = gw.winner ? `🎉 Pemenang Terakhir: @${gw.winner.nickname || gw.winner.user}` : '';
  }

  // Action & Effect dropdowns inside Timer widget
  const actOptsHtml = '<option value="">-- Tanpa Action --</option>' +
    (actionsData?.actions || []).map(a => `<option value="${esc(a.id)}">⚡ ${esc(a.name)}</option>`).join('');
  const effOptsHtml = '<option value="">-- Tanpa Efek Game --</option>' +
    getEffectOptions().map(o => `<option value="${esc(o.id)}">${esc(o.label)} (${esc(o.id)})</option>`).join('');
  populateSelectOptionsPreservingValue(document.getElementById('timer-end-action'), actOptsHtml, timer.endActionId || '', forceForm || !widgetsFormHydrated);
  populateSelectOptionsPreservingValue(document.getElementById('timer-end-effect'), effOptsHtml, timer.endEffectId || '', forceForm || !widgetsFormHydrated);

  if (forceForm || !widgetsFormHydrated) {
    const auto = timer.autoAdd || {};
    setWidgetInputIfIdle('timer-title-input', timer.title || 'SUBATHON TIMER', forceForm);
    setWidgetInputIfIdle('timer-sec-per-coin', auto.secPerCoin ?? 2, forceForm);
    setWidgetInputIfIdle('timer-sec-per-100likes', auto.secPer100Likes ?? 5, forceForm);
    setWidgetInputIfIdle('timer-sec-per-follow', auto.secPerFollow ?? 10, forceForm);
    setWidgetInputIfIdle('timer-sec-per-sub', auto.secPerSub ?? 60, forceForm);
    setWidgetInputIfIdle('timer-sec-per-chat', auto.secPerChat ?? 0, forceForm);
    setWidgetInputIfIdle('timer-sec-per-10kidr', auto.secPer10kIdr ?? 60, forceForm);
    setWidgetInputIfIdle('timer-boost-mult', timer.boostMultiplier ?? 2, forceForm);
    setWidgetCheckIfIdle('timer-boost-enabled', timer.boostEnabled, forceForm);
    setWidgetCheckIfIdle('timer-random-enabled', timer.randomBonusEnabled, forceForm);
    setWidgetCheckIfIdle('timer-hide-zero', timer.hideWhenZero, forceForm);
  }

  renderWheelEditor(widgetState.wheel || widgetState.spinWheel, forceForm || !widgetsFormHydrated);
  syncGoalFormFromState(forceForm);
  syncThemeFormFromState(forceForm);
  syncScreenFormFromState(forceForm);
  if (typeof syncMiniGamesUi === 'function') syncMiniGamesUi(forceForm || !miniGamesHydrated);
  widgetsFormHydrated = true;
}

document.getElementById('wheel-segments-editor')?.addEventListener('input', () => {
  wheelEditorDirty = true;
});
document.getElementById('wheel-segments-editor')?.addEventListener('change', () => {
  wheelEditorDirty = true;
});
document.getElementById('wheel-segments-editor')?.addEventListener('click', (e) => {
  const delBtn = e.target.closest('.btn-wheel-del-seg');
  if (!delBtn) return;
  const row = delBtn.closest('.wheel-seg-row');
  if (row) {
    row.remove();
    wheelEditorDirty = true;
  }
});

document.getElementById('btn-wheel-add-seg')?.addEventListener('click', () => {
  const editor = document.getElementById('wheel-segments-editor');
  if (!editor) return;
  const count = editor.querySelectorAll('.wheel-seg-row').length;
  if (count >= 24) return toast('Maksimal 24 segmen Spin Wheel!', 'error');
  editor.insertAdjacentHTML('beforeend', buildWheelSegRowHtml({ label: `Hadiah ${count + 1}`, weight: 10 }, count));
  wheelEditorDirty = true;
});

document.getElementById('btn-timer-start')?.addEventListener('click', () => api('POST', '/api/widgets/timer', { action: 'start' }));
document.getElementById('btn-timer-pause')?.addEventListener('click', () => api('POST', '/api/widgets/timer', { action: 'pause' }));
document.getElementById('btn-timer-add60')?.addEventListener('click', () => api('POST', '/api/widgets/timer', { action: 'add', seconds: 60 }));
document.getElementById('btn-timer-add300')?.addEventListener('click', () => api('POST', '/api/widgets/timer', { action: 'add', seconds: 300 }));
document.getElementById('btn-timer-reset')?.addEventListener('click', () => api('POST', '/api/widgets/timer', { action: 'reset', seconds: 3600 }));
document.getElementById('btn-timer-save')?.addEventListener('click', async () => {
  const title = document.getElementById('timer-title-input')?.value || 'SUBATHON TIMER';
  const payload = {
    action: 'config',
    title,
    boostEnabled: document.getElementById('timer-boost-enabled')?.checked ?? false,
    boostMultiplier: Math.max(1, Number(document.getElementById('timer-boost-mult')?.value ?? 2)),
    randomBonusEnabled: document.getElementById('timer-random-enabled')?.checked ?? false,
    hideWhenZero: document.getElementById('timer-hide-zero')?.checked ?? false,
    endActionId: document.getElementById('timer-end-action')?.value || '',
    endEffectId: document.getElementById('timer-end-effect')?.value || '',
    autoAdd: {
      enabled: true,
      secPerCoin: Number(document.getElementById('timer-sec-per-coin')?.value ?? 2),
      secPer100Likes: Number(document.getElementById('timer-sec-per-100likes')?.value ?? 5),
      secPerFollow: Number(document.getElementById('timer-sec-per-follow')?.value ?? 10),
      secPerSub: Number(document.getElementById('timer-sec-per-sub')?.value ?? 60),
      secPerChat: Number(document.getElementById('timer-sec-per-chat')?.value ?? 0),
      secPer10kIdr: Number(document.getElementById('timer-sec-per-10kidr')?.value ?? 60)
    }
  };
  const res = await api('POST', '/api/widgets/timer', payload);
  if (res.timer && widgetState) widgetState.timer = res.timer;
  toast('Konfigurasi Subathon Timer disimpan!', 'success');
});

document.getElementById('btn-wheel-spin')?.addEventListener('click', async () => {
  const res = await api('POST', '/api/widgets/wheel/spin', { triggeredBy: 'Streamer' });
  if (res.success && res.result?.winner) {
    toast(`🎡 Roda Berputar! Hasil: ${res.result.winner.label}`, 'success');
  }
});

document.getElementById('btn-wheel-save')?.addEventListener('click', async () => {
  const editor = document.getElementById('wheel-segments-editor');
  const rows = editor ? Array.from(editor.querySelectorAll('.wheel-seg-row')) : [];
  const segments = rows.slice(0, 24).map((row, idx) => {
    const label = row.querySelector('[data-wfield="label"]')?.value.trim();
    if (!label) return null;
    return {
      id: row.dataset.segId || `seg_${idx + 1}`,
      label,
      color: row.querySelector('[data-wfield="color"]')?.value || '#ff6b35',
      weight: Math.max(1, Number(row.querySelector('[data-wfield="weight"]')?.value) || 10),
      effectId: row.querySelector('[data-wfield="effectId"]')?.value || '',
      actionId: row.querySelector('[data-wfield="actionId"]')?.value || ''
    };
  }).filter(Boolean);
  const title = document.getElementById('wheel-title-input')?.value.trim() || '🎡 RODA GACHA STREAMER';
  const autoTriggerEffect = document.getElementById('wheel-auto-trigger')?.checked ?? true;
  const res = await api('PUT', '/api/widgets/wheel', { title, autoTriggerEffect, segments });
  if (res.wheel && widgetState) widgetState.wheel = res.wheel;
  wheelEditorDirty = false;
  toast(`Disimpan ${segments.length} segmen Spin Wheel!`, 'success');
});

document.getElementById('goal-type-select')?.addEventListener('change', () => {
  syncGoalFormFromState(true);
});

document.getElementById('btn-copy-selected-goal')?.addEventListener('click', () => {
  const type = document.getElementById('goal-type-select')?.value || 'coins';
  const fullUrl = `${location.origin}/overlay?widget=goal&type=${encodeURIComponent(type)}`;
  navigator.clipboard?.writeText(fullUrl);
  toast(`Disalin URL Goal "${type}": ${fullUrl}`, 'success');
});

document.getElementById('btn-goal-save')?.addEventListener('click', async () => {
  const type = document.getElementById('goal-type-select')?.value || 'coins';
  const title = document.getElementById('goal-coins-title')?.value || 'Target Goal';
  const target = Number(document.getElementById('goal-coins-target')?.value || 100);
  const autoScale = document.getElementById('goal-auto-scale')?.checked ?? true;
  const rewardEffectId = document.getElementById('goal-reward-effect')?.value || '';
  const countdownMinutes = Number(document.getElementById('goal-countdown-mins')?.value || 0);
  const res = await api('POST', '/api/widgets/goals', { type, title, target, autoScale, rewardEffectId, countdownMinutes });
  if (res.goal && widgetState?.goals) widgetState.goals[type] = res.goal;
  syncGoalFormFromState(true);
  toast(`Goal "${type}" diperbarui!`, 'success');
});

document.getElementById('btn-goal-reset')?.addEventListener('click', async () => {
  const type = document.getElementById('goal-type-select')?.value || 'coins';
  const res = await api('POST', '/api/widgets/goals', { type, reset: true });
  if (res.goal && widgetState?.goals) widgetState.goals[type] = res.goal;
  syncGoalFormFromState(true);
  toast(`Progress Goal "${type}" di-reset ke 0!`, 'info');
});

document.getElementById('btn-theme-save')?.addEventListener('click', async () => {
  const payload = {
    pack: document.getElementById('theme-pack-select')?.value || 'default',
    fontFamily: document.getElementById('theme-font-family')?.value || 'Inter',
    fontSizeScale: Number(document.getElementById('theme-font-scale')?.value ?? 1.0),
    textColor: document.getElementById('theme-text-color')?.value || '#f8fafc',
    accentColor: document.getElementById('theme-accent-color')?.value || '#6366f1',
    bgColor: document.getElementById('theme-bg-color')?.value || '#0b0f19',
    bgOpacity: Number(document.getElementById('theme-bg-opacity')?.value ?? 0.9),
    borderRadius: Number(document.getElementById('theme-border-radius')?.value ?? 16),
    animation: document.getElementById('theme-animation')?.value || 'pop',
    customCss: document.getElementById('theme-custom-css')?.value || ''
  };
  const res = await api('POST', '/api/widgets/theme', payload);
  if (res.theme && widgetState) widgetState.theme = res.theme;
  toast('Tema Overlay Live diterapkan ke semua Browser Source!', 'success');
});

document.getElementById('screen-config-select')?.addEventListener('change', () => {
  syncScreenFormFromState(true);
});

document.getElementById('btn-screen-save')?.addEventListener('click', async () => {
  const id = document.getElementById('screen-config-select')?.value || '1';
  const payload = {
    position: document.getElementById('screen-pos-select')?.value || 'center',
    defaultDurationMs: Math.max(500, Number(document.getElementById('screen-duration-ms')?.value ?? 4000)),
    maxQueueLength: Math.max(1, Number(document.getElementById('screen-max-queue')?.value ?? 10))
  };
  const res = await api('POST', `/api/widgets/screen/${encodeURIComponent(id)}`, payload);
  if (res.screen && widgetState?.screens) widgetState.screens[id] = res.screen;
  toast(`Konfigurasi Screen ${id} disimpan!`, 'success');
});

document.getElementById('btn-win-plus')?.addEventListener('click', () => api('POST', '/api/widgets/winlose', { action: 'add_win' }));
document.getElementById('btn-win-minus')?.addEventListener('click', () => api('POST', '/api/widgets/winlose', { action: 'sub_win' }));
document.getElementById('btn-lose-plus')?.addEventListener('click', () => api('POST', '/api/widgets/winlose', { action: 'add_loss' }));
document.getElementById('btn-lose-minus')?.addEventListener('click', () => api('POST', '/api/widgets/winlose', { action: 'sub_loss' }));
document.getElementById('btn-winlose-reset')?.addEventListener('click', () => api('POST', '/api/widgets/winlose', { action: 'reset' }));

document.getElementById('btn-poll-start')?.addEventListener('click', async () => {
  const question = document.getElementById('poll-question-input')?.value || 'Vote Sekarang!';
  const options = (document.getElementById('poll-options-input')?.value || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  await api('POST', '/api/widgets/poll', { action: 'start', question, options });
  toast('Live Voting Poll dimulai!', 'success');
});
document.getElementById('btn-poll-stop')?.addEventListener('click', async () => {
  await api('POST', '/api/widgets/poll', { action: 'stop' });
  toast('Poll ditutup.', 'info');
});

document.getElementById('btn-giveaway-open')?.addEventListener('click', async () => {
  const keyword = document.getElementById('giveaway-keyword-input')?.value.trim() || '!ikut';
  await api('POST', '/api/widgets/giveaway', { action: 'open', keyword });
  toast(`Pendaftaran Giveaway dibuka (Ketik ${keyword} di chat)!`, 'success');
});
document.getElementById('btn-giveaway-draw')?.addEventListener('click', async () => {
  const res = await api('POST', '/api/widgets/giveaway', { action: 'draw' });
  if (res.winner) {
    toast(`🎉 Pemenang Giveaway: @${res.winner.nickname || res.winner.user}!`, 'success');
  } else {
    toast('Belum ada peserta giveaway yang terdaftar.', 'error');
  }
});
document.getElementById('btn-giveaway-clear')?.addEventListener('click', () => api('POST', '/api/widgets/giveaway', { action: 'clear' }));

// ─── Batch C: Ports (On/Off), Donations, OBS, HUD & Analytics ──
function renderCompatPorts() {
  if (!compatPortsStatus) return;
  const masterChk = document.getElementById('compat-enabled-master');
  if (masterChk) masterChk.checked = Boolean(compatPortsStatus.enabled);
  const badge = document.getElementById('compat-master-badge');
  if (badge) {
    badge.textContent = compatPortsStatus.enabled ? 'ACTIVE' : 'OFF';
    badge.style.background = compatPortsStatus.enabled ? '#55efc4' : '#dfe6e9';
  }
  const ports = compatPortsStatus.ports || {};
  ['wsRaw62024', 'wsSocket62025', 'httpApi62030', 'wsTikFinity21213'].forEach(key => {
    const p = ports[key];
    if (!p) return;
    const chk = document.getElementById(`compat-port-${p.port}`);
    if (chk) chk.checked = Boolean(p.enabled);
    const st = document.getElementById(`port-status-${p.port}`);
    if (st) {
      st.textContent = p.listening
        ? `🟢 Listening di 127.0.0.1:${p.port} (${p.clients || 0} client)`
        : (p.lastError ? `🔴 Error: ${p.lastError}` : '⚪ Nonaktif (Off)');
    }
  });
}

document.getElementById('btn-save-compat-ports')?.addEventListener('click', async () => {
  const enabled = document.getElementById('compat-enabled-master')?.checked ?? true;
  const ports = {
    wsRaw62024: { enabled: document.getElementById('compat-port-62024')?.checked ?? true },
    wsSocket62025: { enabled: document.getElementById('compat-port-62025')?.checked ?? true },
    httpApi62030: { enabled: document.getElementById('compat-port-62030')?.checked ?? true },
    wsTikFinity21213: { enabled: document.getElementById('compat-port-21213')?.checked ?? true }
  };
  const res = await api('PUT', '/api/compat-ports', { enabled, ports });
  if (res.success) {
    compatPortsStatus = res.status;
    renderCompatPorts();
    toast('Status Port Kompatibilitas (:62024/:62025/:62030/:21213) berhasil diperbarui!', 'success');
  }
});

function updateSaweriaBadge(saw) {
  const badge = document.getElementById('saweria-socket-badge');
  if (!badge) return;
  const st = String(saw?.status || (saw?.connected ? 'connected' : (saw?.enabled ? 'connecting' : 'disconnected'))).toUpperCase();
  badge.textContent = st === 'DISCONNECTED' && !saw?.enabled ? 'OFF' : st;
  badge.style.background = st === 'CONNECTED' ? '#55efc4' : (st === 'ERROR' ? '#ff7675' : '#dfe6e9');
}

document.getElementById('btn-save-donation-config')?.addEventListener('click', async () => {
  const idrPerCoin = Number(document.getElementById('donation-idr-per-coin')?.value || 250);
  const saweriaEnabled = document.getElementById('saweria-enabled-select')?.value === 'true';
  const streamKey = document.getElementById('saweria-stream-key')?.value.trim() || '';
  const res = await api('PUT', '/api/donations/config', {
    idrPerCoin,
    platforms: {
      saweria: { enabled: saweriaEnabled, streamKey }
    }
  });
  if (res.success) {
    const saw = res.status?.platforms?.saweria || res.status?.saweria;
    updateSaweriaBadge(saw);
    toast('Konfigurasi Direct Donation & Kurs Koin disimpan!', 'success');
  }
});

document.getElementById('btn-test-donation')?.addEventListener('click', async () => {
  const res = await api('POST', '/api/donations/test', {
    platform: 'saweria',
    user: 'Sultan_Saweria',
    amount: 25000,
    message: 'Semangat terus bang live streamingnya!'
  });
  if (res.success) {
    toast(`Simulasi Saweria Rp 25.000 → Otomatis Konversi ${res.donation?.coinsEquivalent || 100} Koin!`, 'success');
  }
});

function renderObsStatus(st) {
  if (!st) return;
  const badge = document.getElementById('obs-status-badge');
  const isConn = Boolean(st.isConnected ?? st.connected);
  obsResources = {
    connected: isConn,
    currentScene: st.currentScene || '',
    scenes: Array.isArray(st.scenes) ? st.scenes : [],
    sceneItems: st.sceneItems && typeof st.sceneItems === 'object' ? st.sceneItems : {},
    inputs: Array.isArray(st.inputs) ? st.inputs : [],
    filters: st.filters && typeof st.filters === 'object' ? st.filters : {}
  };

  if (badge) {
    badge.textContent = isConn ? (st.currentScene ? `CONNECTED (${st.currentScene})` : 'CONNECTED') : 'DISCONNECTED';
    badge.style.background = isConn ? '#55efc4' : '#dfe6e9';
  }
  const urlEl = document.getElementById('obs-url-input');
  if (urlEl && st.url && document.activeElement !== urlEl) {
    urlEl.value = st.url;
  }

  const sumEl = document.getElementById('obs-resources-summary');
  if (sumEl) {
    if (!isConn) {
      sumEl.textContent = 'OBS belum terhubung — hubungkan OBS Studio v28+ (WebSocket v5 :4455) untuk otomatis mendeteksi Scenes, Sources, Audio Inputs, dan Filters ke Action Builder.';
    } else {
      const sourceCount = Object.values(obsResources.sceneItems).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
      const filterCount = Object.values(obsResources.filters).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
      sumEl.innerHTML = `✅ <strong>OBS Terhubung</strong> · Scene aktif: <code>${esc(obsResources.currentScene || '-')}</code> · <strong>${obsResources.scenes.length}</strong> Scenes, <strong>${sourceCount}</strong> Sources, <strong>${obsResources.inputs.length}</strong> Inputs, <strong>${filterCount}</strong> Filters siap di Action Builder.`;
    }
  }

  updateObsDatalists();
}

function updateObsDatalists() {
  const fillDl = (id, vals) => {
    const dl = document.getElementById(id);
    if (!dl) return;
    const uniq = [...new Set(vals.filter(Boolean))];
    dl.innerHTML = uniq.map(v => `<option value="${esc(v)}"></option>`).join('');
  };
  fillDl('dl-obs-scenes', obsResources.scenes || []);
  const allSources = [];
  for (const list of Object.values(obsResources.sceneItems || {})) {
    if (Array.isArray(list)) {
      list.forEach(item => allSources.push(typeof item === 'string' ? item : item?.sourceName));
    }
  }
  const allInputs = (obsResources.inputs || []).map(i => typeof i === 'string' ? i : i?.inputName);
  fillDl('dl-obs-sources', [...allSources, ...allInputs]);
  fillDl('dl-obs-inputs', allInputs);
  const allFilters = [];
  for (const list of Object.values(obsResources.filters || {})) {
    if (Array.isArray(list)) {
      list.forEach(f => allFilters.push(typeof f === 'string' ? f : f?.filterName));
    }
  }
  fillDl('dl-obs-filters', allFilters);
}

document.getElementById('btn-obs-connect')?.addEventListener('click', async () => {
  const url = document.getElementById('obs-url-input')?.value.trim() || 'ws://127.0.0.1:4455';
  const password = document.getElementById('obs-password-input')?.value || '';
  const res = await api('POST', '/api/obs/connect', { enabled: true, url, password });
  if (res.status) renderObsStatus(res.status);
  const isConn = Boolean(res.status?.isConnected ?? res.status?.connected);
  if (res.error) {
    toast(res.error, 'error');
  } else {
    toast(isConn ? 'Terhubung ke OBS Studio WebSocket!' : 'Mencoba menghubungkan ke OBS Studio...', isConn ? 'success' : 'info');
  }
});

document.getElementById('btn-obs-disconnect')?.addEventListener('click', async () => {
  const res = await api('POST', '/api/obs/disconnect');
  renderObsStatus(res.status);
  toast('Koneksi OBS Studio diputuskan.', 'info');
});

document.getElementById('btn-obs-refresh')?.addEventListener('click', async () => {
  const res = await api('POST', '/api/obs/refresh');
  if (res.status) renderObsStatus(res.status);
  if (res.success === false && res.error) toast(res.error, 'error');
  else toast('Daftar Scenes, Sources & Filters OBS diperbarui!', 'success');
});

document.getElementById('btn-obs-test-replay')?.addEventListener('click', async () => {
  const res = await api('POST', '/api/obs/action', { type: 'replay' });
  if (res.success === false || res.error) toast(res.error || 'Gagal Save Replay Buffer OBS (pastikan aktif di OBS)', 'error');
  else toast('🎬 Perintah Save Replay Buffer dikirim ke OBS!', 'success');
});

async function toggleFloatingHud() {
  const res = await api('POST', '/api/electron/hud', { visible: true });
  if (res.success) {
    toast('Floating In-Game HUD (Always-on-Top) ditampilkan!', 'success');
  } else {
    window.open('/overlay?widget=hud', 'AgivaFloatingHUD', 'width=420,height=640,menubar=no,toolbar=no');
  }
}
document.getElementById('btn-open-floating-hud')?.addEventListener('click', toggleFloatingHud);
document.getElementById('btn-topbar-hud')?.addEventListener('click', toggleFloatingHud);

document.getElementById('btn-open-tt-login')?.addEventListener('click', async () => {
  const res = await api('POST', '/api/electron/tiktok-login');
  if (res.success) {
    toast('Jendela Login TikTok dibuka! Silakan login untuk mengambil SessionID otomatis.', 'info');
  } else {
    toast(res.error || 'Fitur ini khusus mode Aplikasi Desktop (Electron).', 'info');
  }
});

function renderHotkeysInfo(hotkeys = {}) {
  const hint = document.getElementById('hotkeys-info-hint');
  if (hint) {
    hint.innerHTML = `Global Hotkeys Aktif: <code>${esc(hotkeys.toggle_all || 'Alt+P')}</code> (Pause/Resume), <code>${esc(hotkeys.clear_queue || 'Alt+C')}</code> (Clear Queue), <code>${esc(hotkeys.skip_tts || 'Alt+S')}</code> (Skip Audio), <code>${esc(hotkeys.toggle_hud || 'Alt+H')}</code> (Toggle HUD), <code>${esc(hotkeys.toggle_hud_lock || 'Alt+L')}</code> (Lock HUD), <code>${esc(hotkeys.spin_wheel || 'Alt+W')}</code> (Spin Wheel), <code>${esc(hotkeys.win_add || 'Alt+1')}</code>/<code>${esc(hotkeys.lose_add || 'Alt+2')}</code> (+Win/+Lose).`;
  }
  const map = {
    'hk-toggle-all': hotkeys.toggle_all,
    'hk-clear-queue': hotkeys.clear_queue,
    'hk-skip-tts': hotkeys.skip_tts,
    'hk-toggle-hud': hotkeys.toggle_hud,
    'hk-toggle-hud-lock': hotkeys.toggle_hud_lock,
    'hk-spin-wheel': hotkeys.spin_wheel
  };
  for (const [id, val] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el && val) el.value = val;
  }
}

document.getElementById('btn-save-hotkeys')?.addEventListener('click', async () => {
  const payload = {
    toggle_all: document.getElementById('hk-toggle-all')?.value.trim() || 'Alt+P',
    clear_queue: document.getElementById('hk-clear-queue')?.value.trim() || 'Alt+C',
    skip_tts: document.getElementById('hk-skip-tts')?.value.trim() || 'Alt+S',
    toggle_hud: document.getElementById('hk-toggle-hud')?.value.trim() || 'Alt+H',
    toggle_hud_lock: document.getElementById('hk-toggle-hud-lock')?.value.trim() || 'Alt+L',
    spin_wheel: document.getElementById('hk-spin-wheel')?.value.trim() || 'Alt+W'
  };
  const res = await api('POST', '/api/desktop/hotkeys', payload);
  if (res.success) {
    renderHotkeysInfo(res.hotkeys);
    toast('Global Hotkeys diperbarui!', 'success');
  }
});

async function renderIntegrationsTab() {
  try {
    compatPortsStatus = await api('GET', '/api/compat-ports');
    renderCompatPorts();
    const don = await api('GET', '/api/donations/config');
    const donCfg = don?.config || don;
    if (donCfg) {
      const idrEl = document.getElementById('donation-idr-per-coin');
      if (idrEl) idrEl.value = donCfg.idrPerCoin || 250;
      const saw = donCfg.platforms?.saweria || donCfg.saweria;
      if (saw) {
        const sawEn = document.getElementById('saweria-enabled-select');
        if (sawEn) sawEn.value = saw.enabled ? 'true' : 'false';
        const sawKey = document.getElementById('saweria-stream-key');
        if (sawKey && saw.streamKey) sawKey.value = saw.streamKey;
        updateSaweriaBadge(saw);
      }
    }
    const obsSt = await api('GET', '/api/obs/status');
    renderObsStatus(obsSt);
    const deskSt = await api('GET', '/api/desktop/status');
    if (deskSt?.hotkeys) renderHotkeysInfo(deskSt.hotkeys);
    await refreshAnalytics();
  } catch {}
}

async function refreshAnalytics() {
  try {
    const data = await api('GET', '/api/analytics');
    const cur = data?.current || data;
    if (!cur) return;
    const totals = cur.totals || {};
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setTxt('an-total-coins', (totals.coinsCount ?? totals.coins ?? 0).toLocaleString('id-ID'));
    setTxt('an-total-idr', 'Rp ' + (totals.donationsIdr ?? totals.donationIdr ?? 0).toLocaleString('id-ID'));
    setTxt('an-total-gifts', (totals.giftsCount ?? totals.gifts ?? 0).toLocaleString('id-ID'));
    setTxt('an-peak-viewers', (cur.peakViewers ?? totals.peakViewers ?? appState.roomStats?.viewers ?? 0).toLocaleString('id-ID'));

    const topEl = document.getElementById('analytics-top-gifters');
    if (topEl) {
      if ((cur.topGifters || []).length === 0) {
        topEl.textContent = 'Belum ada data gift pada sesi ini.';
      } else {
        topEl.innerHTML = cur.topGifters.slice(0, 5)
          .map((g, i) => `<div>#${i + 1} <strong>${esc(g.nickname || g.user)}</strong> — ${g.coins} 💎 (${g.giftsCount ?? g.gifts ?? 1}x gift)</div>`)
          .join('');
      }
    }
  } catch {}
}

document.getElementById('btn-new-analytics-session')?.addEventListener('click', async () => {
  await api('POST', '/api/analytics/new-session');
  await refreshAnalytics();
  toast('Sesi baru dimulai!', 'success');
});

// ─── API Helper ───────────────────────────────────────────
async function api(method, pathUrl, body) {
  const res = await fetch(pathUrl, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

// ─── Toast ────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${esc(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── Helpers ──────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${Math.max(0, s)}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

// ─── App Updates & GitHub Integration ────────────────────
let currentUpdateInfo = null;
let isUpdateDownloading = false;

async function openExternalUrl(url) {
  if (!url) return;
  try {
    const res = await api('POST', '/api/open-external', { url });
    if (!res || !res.opened) {
      window.open(url, '_blank');
    }
  } catch {
    window.open(url, '_blank');
  }
}

function getTargetDownloadUrl(update) {
  return update?.portableDownloadUrl || update?.setupDownloadUrl || (update?.assets && update.assets[0]?.downloadUrl) || '';
}

function formatUpdateModeLabel(update) {
  const isPortable = update?.isPortable ?? appState?.isPortable;
  const isPackaged = update?.isPackaged ?? update?.canAutoInstall ?? appState?.desktopStatus?.isElectron;
  if (isPortable) return 'Portable (.exe) — Timpa Otomatis Tanpa Install Ulang';
  if (isPackaged) return 'Desktop App (Auto-Replace & Restart)';
  return 'Web / Dev Mode (Unduh ke Temp)';
}

function setUpdateProgressUI({ show, percent, status, bytes }) {
  const prefixes = ['', 'modal-'];
  for (const pre of prefixes) {
    const box = document.getElementById(`${pre}update-progress-box`);
    const bar = document.getElementById(`${pre}update-progress-bar`);
    const pct = document.getElementById(`${pre}update-progress-percent`);
    const st = document.getElementById(`${pre}update-progress-status`);
    const bt = document.getElementById(`${pre}update-progress-bytes`);

    if (box && typeof show === 'boolean') box.style.display = show ? 'block' : 'none';
    if (bar && typeof percent === 'number') bar.style.width = `${percent}%`;
    if (pct && typeof percent === 'number') pct.textContent = `${percent}%`;
    if (st && typeof status === 'string') st.textContent = status;
    if (bt && typeof bytes === 'string') bt.textContent = bytes;
  }
}

function setTopbarUpdateBadge(update, state) {
  const topbarBtn = document.getElementById('btn-topbar-update');
  const topbarDot = document.getElementById('topbar-update-dot');
  const topbarText = document.getElementById('topbar-update-text');
  if (!topbarBtn || !topbarText) return;

  topbarBtn.style.display = 'inline-flex';
  if (state === 'available' && update?.latestVersion) {
    topbarBtn.classList.remove('is-idle');
    if (topbarDot) topbarDot.style.display = 'inline-block';
    topbarText.textContent = `✨ Update v${update.latestVersion}`;
  } else {
    topbarBtn.classList.add('is-idle');
    if (topbarDot) topbarDot.style.display = 'none';
    topbarText.textContent = '🔄 Auto Update';
  }
}

function renderUpdateModal(update, state = 'idle') {
  const curVerEl = document.getElementById('modal-update-current-ver');
  const latestVerEl = document.getElementById('modal-update-latest-ver');
  const modeEl = document.getElementById('modal-update-mode-label');
  const iconEl = document.getElementById('modal-update-status-icon');
  const titleEl = document.getElementById('modal-update-status-title');
  const descEl = document.getElementById('modal-update-status-desc');
  const notesEl = document.getElementById('modal-update-notes');
  const btnCheck = document.getElementById('btn-modal-check-update');
  const btnApply = document.getElementById('btn-modal-apply-update');

  const curVer = update?.currentVersion || appState?.appVersion || '1.6.0';
  if (curVerEl) curVerEl.textContent = `v${curVer}`;
  if (modeEl) modeEl.textContent = formatUpdateModeLabel(update);

  if (state === 'checking') {
    if (latestVerEl) latestVerEl.textContent = 'Memeriksa...';
    if (iconEl) iconEl.textContent = '⏳';
    if (titleEl) titleEl.textContent = 'Memeriksa Pembaruan...';
    if (descEl) descEl.textContent = 'Menghubungi GitHub Releases untuk mengecek rilis terbaru.';
    if (notesEl) notesEl.style.display = 'none';
    if (btnCheck) btnCheck.disabled = true;
    if (btnApply) btnApply.disabled = true;
    return;
  }

  if (btnCheck) btnCheck.disabled = false;

  if (state === 'available' && update) {
    const targetUrl = getTargetDownloadUrl(update);
    if (latestVerEl) latestVerEl.textContent = `v${update.latestVersion}`;
    if (iconEl) iconEl.textContent = '🚀';
    if (titleEl) titleEl.textContent = `Versi Baru Tersedia: v${update.latestVersion}`;
    if (descEl) {
      const dateStr = update.publishedAt ? new Date(update.publishedAt).toLocaleDateString() : 'Terbaru';
      descEl.textContent = targetUrl
        ? `Rilis ${dateStr} siap diunduh dan dipasang otomatis.`
        : `Rilis v${update.latestVersion} ditemukan, namun file .exe belum dilampirkan di GitHub Releases.`;
    }
    if (notesEl) {
      if (update.releaseNotes) {
        notesEl.textContent = update.releaseNotes;
        notesEl.style.display = 'block';
      } else {
        notesEl.style.display = 'none';
      }
    }
    if (btnApply) {
      if (targetUrl) {
        btnApply.style.display = 'inline-block';
        btnApply.disabled = isUpdateDownloading;
        btnApply.onclick = () => startAutoUpdateDownload(update);
      } else {
        btnApply.style.display = 'none';
      }
    }
    return;
  }

  if (state === 'error') {
    if (latestVerEl) latestVerEl.textContent = 'Gagal cek';
    if (iconEl) iconEl.textContent = '⚠️';
    if (titleEl) titleEl.textContent = 'Pengecekan Pembaruan Gagal';
    if (descEl) descEl.textContent = update?.error || 'Tidak dapat terhubung ke GitHub Releases.';
    if (notesEl) notesEl.style.display = 'none';
    if (btnApply) btnApply.style.display = 'none';
    return;
  }

  // Up-to-date
  const latestVer = update?.latestVersion || curVer;
  if (latestVerEl) latestVerEl.textContent = `v${latestVer}`;
  if (iconEl) iconEl.textContent = '✅';
  if (titleEl) titleEl.textContent = 'Aplikasi Sudah Versi Terbaru';
  if (descEl) descEl.textContent = update?.releaseNotes || `Anda sudah menjalankan Agiva Mod v${curVer}.`;
  if (notesEl) notesEl.style.display = 'none';
  if (btnApply) btnApply.style.display = 'none';
}

async function startAutoUpdateDownload(update) {
  if (isUpdateDownloading) {
    toast('Proses unduhan pembaruan sedang berjalan.', 'info');
    return;
  }
  const targetDownloadUrl = getTargetDownloadUrl(update);
  if (!targetDownloadUrl) {
    toast('File .exe pembaruan tidak ditemukan pada rilis GitHub terbaru.', 'error');
    return;
  }

  const curVer = update?.currentVersion || appState?.appVersion || '1.6.0';
  const nextVer = update?.latestVersion || 'terbaru';
  const confirmMsg = `Unduh dan pasang Agiva Mod v${nextVer} (dari v${curVer}) secara otomatis sekarang?\n\nDi mode Portable, file .exe akan otomatis ditimpa dan aplikasi langsung me-restart tanpa perlu install ulang.`;
  if (!confirm(confirmMsg)) return;

  const btnAuto = document.getElementById('btn-auto-update');
  const btnModalApply = document.getElementById('btn-modal-apply-update');
  if (btnAuto) btnAuto.disabled = true;
  if (btnModalApply) btnModalApply.disabled = true;

  isUpdateDownloading = true;
  setUpdateProgressUI({
    show: true,
    percent: 0,
    status: 'Memulai unduhan...',
    bytes: '0.0 MB / ... MB'
  });

  try {
    const res = await api('POST', '/api/update/apply', { downloadUrl: targetDownloadUrl });
    if (!res || !res.success) {
      isUpdateDownloading = false;
      toast(res?.error || 'Gagal memulai proses unduh pembaruan', 'error');
      if (btnAuto) btnAuto.disabled = false;
      if (btnModalApply) btnModalApply.disabled = false;
      setUpdateProgressUI({
        show: true,
        status: `❌ ${res?.error || 'Gagal memulai proses unduh'}`
      });
    }
  } catch (err) {
    isUpdateDownloading = false;
    toast('Error update: ' + err.message, 'error');
    if (btnAuto) btnAuto.disabled = false;
    if (btnModalApply) btnModalApply.disabled = false;
    setUpdateProgressUI({
      show: true,
      status: `❌ ${err.message || 'Gagal memulai proses unduh'}`
    });
  }
}

async function checkAppUpdates(force = false) {
  const iconEl = document.getElementById('update-status-icon');
  const titleEl = document.getElementById('update-status-title');
  const descEl = document.getElementById('update-status-desc');
  const btnCheck = document.getElementById('btn-check-updates');

  if (iconEl) iconEl.textContent = '⏳';
  if (titleEl) titleEl.textContent = 'Memeriksa Pembaruan...';
  if (descEl) descEl.textContent = 'Menghubungi server GitHub...';
  if (btnCheck) btnCheck.disabled = true;

  renderUpdateModal(currentUpdateInfo || { currentVersion: appState?.appVersion }, 'checking');

  try {
    const res = await api('GET', `/api/update/check${force ? '?force=1' : ''}`);
    currentUpdateInfo = res;
    if (btnCheck) btnCheck.disabled = false;

    if (res && res.ok === false && res.error) {
      if (iconEl) iconEl.textContent = '⚠️';
      if (titleEl) titleEl.textContent = 'Pengecekan Gagal';
      if (descEl) descEl.textContent = res.error;
      setTopbarUpdateBadge(res, 'idle');
      renderUpdateModal(res, 'error');
      return;
    }

    if (res && res.hasUpdate) {
      handleUpdateAvailable(res);
      toast(`Update baru tersedia: v${res.latestVersion}!`, 'info');
    } else {
      if (iconEl) iconEl.textContent = '✅';
      if (titleEl) titleEl.textContent = 'Aplikasi Up-to-Date';
      if (descEl) descEl.textContent = res.releaseNotes || `Anda menggunakan versi terbaru (v${res.currentVersion || '1.6.0'}).`;
      const banner = document.getElementById('update-banner');
      if (banner) banner.style.display = 'none';
      setTopbarUpdateBadge(res, 'idle');
      renderUpdateModal(res, 'up-to-date');
    }
  } catch (err) {
    if (btnCheck) btnCheck.disabled = false;
    if (iconEl) iconEl.textContent = '⚠️';
    if (titleEl) titleEl.textContent = 'Pengecekan Gagal';
    if (descEl) descEl.textContent = err.message || 'Tidak dapat terhubung ke GitHub.';
    setTopbarUpdateBadge(currentUpdateInfo, 'idle');
    renderUpdateModal({ currentVersion: appState?.appVersion, error: err.message }, 'error');
  }
}

function handleUpdateAvailable(update) {
  currentUpdateInfo = update;
  setTopbarUpdateBadge(update, 'available');
  renderUpdateModal(update, 'available');

  const iconEl = document.getElementById('update-status-icon');
  const titleEl = document.getElementById('update-status-title');
  const descEl = document.getElementById('update-status-desc');
  const banner = document.getElementById('update-banner');
  const badgeEl = document.getElementById('update-new-ver-badge');
  const releaseTitleEl = document.getElementById('update-release-title');
  const notesEl = document.getElementById('update-release-notes');

  if (iconEl) iconEl.textContent = '🚀';
  if (titleEl) titleEl.textContent = `Versi Baru Ditemukan: v${update.latestVersion}`;
  if (descEl) descEl.textContent = `Dirilis pada: ${update.publishedAt ? new Date(update.publishedAt).toLocaleDateString() : 'Terbaru'}`;

  if (banner) banner.style.display = 'block';
  if (badgeEl) badgeEl.textContent = `v${update.latestVersion}`;
  if (releaseTitleEl) releaseTitleEl.textContent = update.releaseName || `Agiva Mod v${update.latestVersion}`;
  if (notesEl) notesEl.textContent = update.releaseNotes || 'Pembaruan stabilitas dan fitur baru.';

  const btnAuto = document.getElementById('btn-auto-update');
  const targetDownloadUrl = getTargetDownloadUrl(update);
  if (btnAuto) {
    if (targetDownloadUrl) {
      btnAuto.style.display = 'inline-block';
      btnAuto.disabled = isUpdateDownloading;
      btnAuto.onclick = () => startAutoUpdateDownload(update);
    } else {
      btnAuto.style.display = 'none';
    }
  }

  const btnPortable = document.getElementById('btn-download-portable');
  if (btnPortable) {
    if (update.portableDownloadUrl) {
      btnPortable.style.display = 'inline-block';
      btnPortable.onclick = () => openExternalUrl(update.portableDownloadUrl);
    } else {
      btnPortable.style.display = 'none';
    }
  }

  const btnSetup = document.getElementById('btn-download-setup');
  if (btnSetup) {
    if (update.setupDownloadUrl) {
      btnSetup.style.display = 'inline-block';
      btnSetup.onclick = () => openExternalUrl(update.setupDownloadUrl);
    } else {
      btnSetup.style.display = 'none';
    }
  }

  const btnRelease = document.getElementById('btn-open-release-page');
  if (btnRelease) {
    btnRelease.onclick = () => openExternalUrl(update.releaseUrl || 'https://github.com/edamameboy/agiva-mod/releases');
  }
}

// ─── Init ─────────────────────────────────────────────────
async function init() {
  const status = await api('GET', '/api/status');
  appState = { ...appState, ...status };
  if (status.ttsSoundConfig) ttsSoundConfig = status.ttsSoundConfig;
  if (status.widgetState) widgetState = status.widgetState;
  if (status.compatPorts) compatPortsStatus = status.compatPorts;
  if (Array.isArray(status.ttsVoices) && status.ttsVoices.length > 0) {
    ttsVoices = status.ttsVoices;
  } else {
    ttsVoices = await api('GET', '/api/tts/voices').catch(() => []);
  }
  if (status.actionsData) {
    actionsData = status.actionsData;
  } else {
    actionsData = await api('GET', '/api/actions').catch(() => ({ version: 1, actions: [], events: [] }));
  }
  pointsState = status.pointsSummary || await api('GET', '/api/points').catch(() => null);
  chatbotState = status.chatbotConfig || await api('GET', '/api/chatbot').catch(() => null);
  intervalsState = status.intervalsData || await api('GET', '/api/intervals').catch(() => null);
  spotifyState = status.spotifyState || await api('GET', '/api/spotify').catch(() => null);
  streamerBotState = status.streamerBotStatus || await api('GET', '/api/integrations/streamerbot').catch(() => null);
  integrationsState = status.integrationsState || await api('GET', '/api/integrations/voicemod').catch(() => null);
  renderConnectionState();
  renderStats();
  renderMasterSwitches(appState.masterSwitches);
  renderTtsTab();
  renderWidgetsTab(true);
  renderCompatPorts();
  renderActionsAndMatrix();
  renderLoyaltyTab(true);
  renderChatbotSection(true);
  renderIntervalsSection();
  renderSpotifySection(true);
  renderStreamerBotAndVoicemodSection(true);
  renderLanRemoteSection(true);
  if (status.obsStatus) renderObsStatus(status.obsStatus);

  // Populate App Info in Settings Card
  const verBadge = document.getElementById('app-version-badge');
  const curVer = document.getElementById('info-current-ver');
  const appMode = document.getElementById('info-app-mode');
  const storagePath = document.getElementById('info-storage-path');
  const presetsFolderInput = document.getElementById('info-presets-folder');
  const curVerStr = `v${status.appVersion || '1.6.0'}`;

  if (verBadge) verBadge.textContent = curVerStr;
  if (curVer) curVer.textContent = curVerStr;
  if (appMode) {
    if (status.isPortable) appMode.textContent = 'Portable (.exe) standalone';
    else if (status.desktopStatus?.isElectron) appMode.textContent = 'Desktop App (Electron)';
    else appMode.textContent = 'Web Node.js Server';
  }
  if (storagePath) storagePath.textContent = status.storagePath || '-';
  if (presetsFolderInput) presetsFolderInput.value = status.presetsFolder || '';

  // Wire Presets Folder Selector
  document.getElementById('btn-browse-presets-folder')?.addEventListener('click', async () => {
    try {
      const res = await api('POST', '/api/dialog/select-folder', { defaultPath: presetsFolderInput?.value });
      if (res && !res.canceled && res.folderPath) {
        if (presetsFolderInput) presetsFolderInput.value = res.folderPath;
      } else if (res && !res.folderPath && res.mode !== 'electron') {
        const manual = prompt('Masukkan direktori folder presets game:', presetsFolderInput?.value || '');
        if (manual && presetsFolderInput) {
          presetsFolderInput.value = manual.trim();
        }
      }
    } catch (err) {
      toast('Gagal membuka dialog folder: ' + err.message, 'error');
    }
  });

  document.getElementById('btn-save-presets-folder')?.addEventListener('click', async () => {
    const folderPath = presetsFolderInput?.value?.trim();
    if (!folderPath) {
      toast('Path folder tidak boleh kosong!', 'error');
      return;
    }
    try {
      const res = await api('POST', '/api/settings/presets-folder', { folderPath });
      if (res && res.success) {
        toast(`Folder preset berhasil diubah! Memuat ${res.games?.length || 0} game.`, 'success');
        if (res.games) {
          games = res.games;
          renderGameSelector(games);
        }
      } else {
        toast(res?.error || 'Gagal mengubah folder preset', 'error');
      }
    } catch (err) {
      toast('Gagal menyimpan folder: ' + err.message, 'error');
    }
  });

  // Wire App Update Buttons (Settings Card + Always-Visible Topbar Auto-Update Modal)
  document.getElementById('btn-topbar-update')?.addEventListener('click', () => {
    openModal('modal-auto-update');
    if (isUpdateDownloading) {
      renderUpdateModal(currentUpdateInfo || { currentVersion: appState?.appVersion }, currentUpdateInfo?.hasUpdate ? 'available' : 'up-to-date');
    } else {
      checkAppUpdates(true);
    }
  });
  document.getElementById('btn-modal-check-update')?.addEventListener('click', () => checkAppUpdates(true));
  document.getElementById('btn-modal-open-release')?.addEventListener('click', () => {
    openExternalUrl(currentUpdateInfo?.releaseUrl || `${status.repoUrl || 'https://github.com/edamameboy/agiva-mod'}/releases`);
  });
  document.getElementById('btn-check-updates')?.addEventListener('click', () => checkAppUpdates(true));
  document.getElementById('btn-visit-github')?.addEventListener('click', () => {
    openExternalUrl(status.repoUrl || 'https://github.com/edamameboy/agiva-mod');
  });

  config = await api('GET', '/api/config');
  const gamesData = await api('GET', '/api/games');
  renderGameSelector(gamesData);
  renderConfigurator();
  renderWidgetsTab(true);
  refreshTtsLogs();

  giftsData = await api('GET', '/api/gifts');

  events = await api('GET', '/api/events');
  events.slice().reverse().forEach(ev => addFeedItem(ev));

  // Run initial background update check
  setTimeout(() => checkAppUpdates(false), 2000);

  if (config?.queueSettings) {
    const qs = config.queueSettings;
    const qsEl = document.getElementById('queue-size');
    const qdEl = document.getElementById('queue-delay');
    const dropEl = document.getElementById('queue-drop');
    if (qsEl) qsEl.value = qs.maxQueueSize || 100;
    if (qdEl) qdEl.value = qs.minDelayBetweenEffects || 500;
    if (dropEl) dropEl.value = qs.dropOnFull ? 'true' : 'false';
  }

  if (appState?.connectionMode) {
    const modeSel = document.getElementById('connection-mode-select');
    if (modeSel) modeSel.value = appState.connectionMode;
  }

  if (appState?.webhookUrl) {
    const hookEl = document.getElementById('webhook-url');
    if (hookEl) hookEl.value = appState.webhookUrl;
  }
  if (appState?.webhookSecret) {
    const secEl = document.getElementById('webhook-secret');
    if (secEl) secEl.value = appState.webhookSecret;
  }

  if (appState?.currentUsername) {
    const userEl = document.getElementById('username-input');
    if (userEl) userEl.value = appState.currentUsername;
    const giftUserEl = document.getElementById('gifts-username-input');
    if (giftUserEl && !giftUserEl.value.trim()) giftUserEl.value = appState.currentUsername;
  }

  if (appState?.eulerstreamKey) {
    const keyEl = document.getElementById('api-key-input');
    if (keyEl) keyEl.value = appState.eulerstreamKey;
  }

  if (appState?.tiktokSessionId) {
    const sessEl = document.getElementById('session-id-input');
    if (sessEl) sessEl.value = appState.tiktokSessionId;
  }

  connectWS();

  setInterval(async () => {
    try {
      const q = await api('GET', '/api/queue');
      document.getElementById('stat-queue').textContent = q.queued || 0;
      const ql = document.getElementById('queue-list');
      if (q.queued === 0) {
        ql.innerHTML = '<div class="queue-empty">Queue empty</div>';
      } else {
        ql.innerHTML = (q.items || []).map(i =>
          `<div class="queue-item"><span class="qi-effect">${esc(i.effectId)}</span><span class="qi-user">${esc(i.user)}</span></div>`
        ).join('');
      }
    } catch {}
  }, 1500);
}

// ─── Phase 2: Actions Engine, Event Matrix & Media Library ─
const STEP_TYPES = [
  { id: 'game_effect', label: '🎮 Jalankan Efek Game' },
  { id: 'delay', label: '⏳ Jeda Waktu (Delay ms)' },
  { id: 'sound', label: '🎵 Putar Soundboard' },
  { id: 'tts', label: '🗣️ Baca Teks TTS' },
  { id: 'screen_alert', label: '🖼️ Tampilkan Screen Alert / GIF' },
  { id: 'obs_scene', label: '🎥 OBS Ganti Scene' },
  { id: 'obs_source', label: '👁️ OBS Show/Hide Source' },
  { id: 'obs_filter', label: '✨ OBS Toggle Filter' },
  { id: 'obs_mute', label: '🎙️ OBS Mute/Unmute Input' },
  { id: 'obs_text', label: '📝 OBS Ubah Text Source' },
  { id: 'obs_replay', label: '🎬 OBS Save Replay Buffer' },
  { id: 'timer_add', label: '⏱️ Tambah/Kurang Subathon Timer' },
  { id: 'spin_wheel', label: '🎡 Putar Spin Wheel' },
  { id: 'custom_goal', label: '🎯 Tambah Progress Goal' },
  { id: 'webhook', label: '🌐 Kirim Webhook Event' }
];

function formatRuleConditionSummary(ev) {
  const parts = [];
  if (ev.giftId) parts.push(`Gift:${ev.giftId}`);
  if (ev.minCoins > 0) parts.push(`>=${ev.minCoins}💎`);
  if (ev.maxCoins > 0) parts.push(`<=${ev.maxCoins}💎`);
  if (ev.minAmount > 0) parts.push(`>=Rp${Number(ev.minAmount).toLocaleString('id-ID')}`);
  if (ev.command) parts.push(`Cmd:${ev.command}`);
  if (ev.allowedRole && ev.allowedRole !== 'everyone') parts.push(`Role:${ev.allowedRole}`);
  if (ev.cooldownSec > 0) parts.push(`CD:${ev.cooldownSec}s`);
  return parts.join(' · ') || 'Semua event ini';
}

function renderActionsAndMatrix() {
  const actions = Array.isArray(actionsData?.actions) ? actionsData.actions : [];
  const rules = Array.isArray(actionsData?.events) ? actionsData.events : [];

  const actListEl = document.getElementById('actions-list');
  if (actListEl) {
    if (actions.length === 0) {
      actListEl.innerHTML = '<div class="form-hint">Belum ada Action dibuat. Klik <strong>+ Buat Action Baru</strong> untuk membuat workflow multi-step.</div>';
    } else {
      actListEl.innerHTML = actions.map(a => `
        <div class="action-card">
          <div class="action-card-info">
            <div class="action-card-title">
              <span>⚡ ${esc(a.name)}</span>
              <span class="badge-pill">${(a.steps || []).length} Steps</span>
              ${a.priority === 'high' ? '<span class="badge-pill" style="background:#ffeaa7;">🔥 HIGH</span>' : ''}
            </div>
            <div class="action-card-meta">${esc(a.description || a.id)}</div>
          </div>
          <div class="action-card-actions">
            <button type="button" class="btn-sm success" onclick="testActionById('${esc(a.id)}')">▶ Test</button>
            <button type="button" class="btn-sm" onclick="openActionBuilder('${esc(a.id)}')">✏️ Edit</button>
            <button type="button" class="btn-sm danger" onclick="deleteActionById('${esc(a.id)}')">✕</button>
          </div>
        </div>
      `).join('');
    }
  }

  const ruleListEl = document.getElementById('events-matrix-list');
  if (ruleListEl) {
    if (rules.length === 0) {
      ruleListEl.innerHTML = '<div class="form-hint">Belum ada Event Rule Matrix. Klik <strong>+ Tambah Event Rule</strong> untuk menghubungkan event TikTok ke Action.</div>';
    } else {
      ruleListEl.innerHTML = rules.map(r => {
        const names = (r.actionIds || []).map(aid => actions.find(a => a.id === aid)?.name || aid);
        return `
          <div class="event-rule-card">
            <div class="event-rule-info">
              <div class="action-card-title">
                <span>${r.enabled ? '🟢' : '⚪'} ${esc(r.name || r.eventType)}</span>
                <span class="badge-pill">${esc(String(r.eventType || '').toUpperCase())}</span>
                <span class="action-card-meta">→ ${esc(names.join(', ') || '(Belum ada action)')}</span>
              </div>
              <div class="action-card-meta">${esc(formatRuleConditionSummary(r))}</div>
            </div>
            <div class="action-card-actions">
              <button type="button" class="btn-sm" onclick="editEventRule('${esc(r.id)}')">✏️ Edit</button>
              <button type="button" class="btn-sm danger" onclick="deleteEventRule('${esc(r.id)}')">✕</button>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

window.testActionById = async (id) => {
  const res = await api('POST', `/api/actions/${encodeURIComponent(id)}/test`, { user: 'Streamer_Test' });
  if (res.success) toast('Action dijalankan!', 'success');
  else toast(res.error || 'Gagal menjalankan action', 'error');
};

window.deleteActionById = async (id) => {
  const res = await api('DELETE', `/api/actions/${encodeURIComponent(id)}`);
  if (res.success) {
    actionsData = await api('GET', '/api/actions');
    renderActionsAndMatrix();
    renderConfigurator();
    renderWidgetsTab(false);
    toast('Action dihapus.', 'info');
  }
};

function renderStepFieldsHtml(step = {}) {
  const type = step.type || 'game_effect';
  const effOpts = getEffectOptions();
  const sounds = ttsSoundConfig?.soundboard?.items || [];
  const voices = Array.isArray(ttsVoices) ? ttsVoices : [];
  const goals = ['custom_1', 'custom_2', 'custom_3', 'coins', 'likes', 'followers', 'donations', 'shares', 'subscribers'];

  switch (type) {
    case 'game_effect':
      return `
        <select class="form-input" data-sfield="effectId" style="flex:2; min-width:160px;">
          ${effOpts.map(o => `<option value="${esc(o.id)}" ${o.id === step.effectId ? 'selected' : ''}>${esc(o.label)} (${esc(o.id)})</option>`).join('')}
        </select>
        <label class="checkbox-label" style="margin:0;"><input type="checkbox" data-sfield="multiplyByRepeat" ${step.multiplyByRepeat ? 'checked' : ''}> xCombo</label>
      `;
    case 'delay':
      return `<input type="number" class="form-input" data-sfield="ms" value="${Number(step.ms) || 500}" min="50" max="30000" placeholder="Durasi ms" style="max-width:140px;"> <span class="action-card-meta">ms</span>`;
    case 'sound':
      return `
        <select class="form-input" data-sfield="soundId" style="flex:2;">
          ${sounds.map(s => `<option value="${esc(s.id)}" ${s.id === step.soundId ? 'selected' : ''}>🎵 ${esc(s.name)}</option>`).join('')}
        </select>
        <input type="number" class="form-input" data-sfield="screen" value="${Number(step.screen) || 1}" min="1" max="5" title="Screen 1-5" style="max-width:75px;">
      `;
    case 'tts':
      return `
        <input type="text" class="form-input" data-sfield="template" value="${esc(step.template || 'Halo {nickname}, terima kasih!')}" placeholder="Teks / {nickname}, {comment}, {giftname}" style="flex:2; min-width:180px;">
        <select class="form-input" data-sfield="voice" style="flex:1; min-width:130px;">
          <option value="">Suara Default</option>
          ${voices.map(v => `<option value="${esc(v.id)}" ${v.id === step.voice ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}
        </select>
      `;
    case 'screen_alert':
      return `
        <input type="number" class="form-input" data-sfield="screen" value="${Number(step.screen) || 1}" min="1" max="5" title="Screen 1-5" style="max-width:65px;">
        <input type="text" class="form-input" data-sfield="title" value="${esc(step.title || '{nickname}')}" placeholder="Judul Alert" style="flex:1; min-width:110px;">
        <input type="text" class="form-input" data-sfield="subtitle" value="${esc(step.subtitle || '')}" placeholder="Subjudul" style="flex:1; min-width:110px;">
        <input type="text" class="form-input" data-sfield="mediaUrl" value="${esc(step.mediaUrl || '')}" placeholder="URL /media/..." style="flex:1; min-width:120px;">
        <button type="button" class="btn-sm btn-pick-step-media">🗂️</button>
        <input type="number" class="form-input" data-sfield="durationMs" value="${Number(step.durationMs) || 4000}" min="500" max="30000" title="Durasi ms" style="max-width:85px;">
      `;
    case 'obs_scene':
      return `
        <input type="text" class="form-input" list="dl-obs-scenes" data-sfield="sceneName" value="${esc(step.sceneName || '')}" placeholder="Nama Scene OBS" style="flex:2;">
        <input type="number" class="form-input" data-sfield="durationSec" value="${Number(step.durationSec) || 0}" min="0" placeholder="Revert (dtk, 0=permanen)" style="max-width:130px;">
      `;
    case 'obs_source':
      return `
        <input type="text" class="form-input" list="dl-obs-scenes" data-sfield="sceneName" value="${esc(step.sceneName || '')}" placeholder="Scene (kosong=aktif)" style="flex:1;">
        <input type="text" class="form-input" list="dl-obs-sources" data-sfield="sourceName" value="${esc(step.sourceName || '')}" placeholder="Nama Source OBS" style="flex:1;">
        <select class="form-input" data-sfield="enabled" style="max-width:110px;">
          <option value="true" ${step.enabled !== false ? 'selected' : ''}>👁️ Tampilkan</option>
          <option value="false" ${step.enabled === false ? 'selected' : ''}>🙈 Sembunyikan</option>
        </select>
        <input type="number" class="form-input" data-sfield="durationSec" value="${Number(step.durationSec) || 0}" min="0" placeholder="Revert (dtk)" style="max-width:95px;">
      `;
    case 'obs_filter':
      return `
        <input type="text" class="form-input" list="dl-obs-sources" data-sfield="sourceName" value="${esc(step.sourceName || '')}" placeholder="Source / Scene" style="flex:1;">
        <input type="text" class="form-input" list="dl-obs-filters" data-sfield="filterName" value="${esc(step.filterName || '')}" placeholder="Nama Filter OBS" style="flex:1;">
        <input type="number" class="form-input" data-sfield="durationSec" value="${Number(step.durationSec) || 8}" min="1" placeholder="Durasi dtk" style="max-width:95px;">
      `;
    case 'obs_mute':
      return `
        <input type="text" class="form-input" list="dl-obs-inputs" data-sfield="inputName" value="${esc(step.inputName || 'Mic/Aux')}" placeholder="Audio Input OBS" style="flex:2;">
        <input type="number" class="form-input" data-sfield="durationSec" value="${Number(step.durationSec) || 10}" min="1" placeholder="Durasi dtk" style="max-width:110px;">
      `;
    case 'obs_text':
      return `
        <input type="text" class="form-input" list="dl-obs-inputs" data-sfield="inputName" value="${esc(step.inputName || '')}" placeholder="Nama Text GDI+/FreeType Input" style="flex:1;">
        <input type="text" class="form-input" data-sfield="textTemplate" value="${esc(step.textTemplate || 'Top Gifter: {nickname}')}" placeholder="Teks Template ({nickname}, {giftname})" style="flex:2;">
      `;
    case 'obs_replay':
      return `<span class="action-card-meta">Menyimpan klip terakhir dari OBS Replay Buffer (memerlukan Replay Buffer aktif di OBS Studio).</span>`;
    case 'timer_add':
      return `<input type="number" class="form-input" data-sfield="seconds" value="${Number(step.seconds) || 30}" placeholder="Detik (+/-)" style="max-width:140px;"> <span class="action-card-meta">detik ke Subathon Timer</span>`;
    case 'spin_wheel':
      return `<span class="action-card-meta">Memutar Spin Wheel / Roda Gacha di Overlay &amp; menjalankan efek pemenang.</span>`;
    case 'custom_goal':
      return `
        <select class="form-input" data-sfield="goalType" style="flex:1;">
          ${goals.map(g => `<option value="${g}" ${g === (step.goalType || 'custom_1') ? 'selected' : ''}>${g}</option>`).join('')}
        </select>
        <input type="number" class="form-input" data-sfield="delta" value="${Number(step.delta) || 1}" placeholder="Tambah Nilai" style="max-width:120px;">
      `;
    case 'webhook':
      return `<input type="text" class="form-input" data-sfield="note" value="${esc(step.payload?.note || '')}" placeholder="Kirim event 'action' ke Outgoing Webhook URL" style="flex:1;">`;
    default:
      return '';
  }
}

function appendActionStepRow(step = { type: 'game_effect' }) {
  const container = document.getElementById('action-steps-container');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'action-step-row';
  row.innerHTML = `
    <select class="form-input" data-sfield="type" style="max-width:210px; margin-bottom:0;">
      ${STEP_TYPES.map(t => `<option value="${t.id}" ${t.id === (step.type || 'game_effect') ? 'selected' : ''}>${t.label}</option>`).join('')}
    </select>
    <div class="action-step-fields">${renderStepFieldsHtml(step)}</div>
    <button type="button" class="btn-sm danger btn-del-step" title="Hapus Step">✕</button>
  `;
  container.appendChild(row);
}

window.openActionBuilder = (actionId = '') => {
  const act = actionId ? (actionsData?.actions || []).find(a => a.id === actionId) : null;
  document.getElementById('action-edit-id').value = act?.id || '';
  document.getElementById('action-edit-name').value = act?.name || '';
  document.getElementById('action-edit-desc').value = act?.description || '';
  document.getElementById('action-edit-priority').value = act?.priority || 'normal';

  const container = document.getElementById('action-steps-container');
  if (container) {
    container.innerHTML = '';
    const steps = act?.steps?.length ? act.steps : [{ type: 'game_effect', effectId: getFirstEffectId() }];
    steps.forEach(s => appendActionStepRow(s));
  }
  updateObsDatalists();
  openModal('modal-action-builder');
};

document.getElementById('btn-new-action')?.addEventListener('click', () => window.openActionBuilder(''));
document.getElementById('btn-action-add-step')?.addEventListener('click', () => appendActionStepRow({ type: 'delay', ms: 500 }));

document.getElementById('action-steps-container')?.addEventListener('change', (e) => {
  if (e.target.dataset.sfield === 'type') {
    const row = e.target.closest('.action-step-row');
    const fieldsEl = row?.querySelector('.action-step-fields');
    if (fieldsEl) fieldsEl.innerHTML = renderStepFieldsHtml({ type: e.target.value });
  }
});

document.getElementById('action-steps-container')?.addEventListener('click', (e) => {
  const delBtn = e.target.closest('.btn-del-step');
  if (delBtn) {
    delBtn.closest('.action-step-row')?.remove();
    return;
  }
  const pickBtn = e.target.closest('.btn-pick-step-media');
  if (pickBtn) {
    const input = pickBtn.closest('.action-step-fields')?.querySelector('[data-sfield="mediaUrl"]');
    openMediaLibraryModal((url) => {
      if (input) input.value = url;
    });
  }
});

document.getElementById('btn-action-save')?.addEventListener('click', async () => {
  const name = document.getElementById('action-edit-name')?.value.trim();
  if (!name) return toast('Nama Action wajib diisi!', 'error');
  const id = document.getElementById('action-edit-id')?.value.trim() || undefined;
  const description = document.getElementById('action-edit-desc')?.value.trim() || '';
  const priority = document.getElementById('action-edit-priority')?.value || 'normal';

  const rows = Array.from(document.querySelectorAll('#action-steps-container .action-step-row'));
  const steps = rows.map(row => {
    const type = row.querySelector('[data-sfield="type"]')?.value || 'delay';
    const get = (f) => row.querySelector(`[data-sfield="${f}"]`);
    switch (type) {
      case 'game_effect':
        return { type, effectId: get('effectId')?.value || '', multiplyByRepeat: Boolean(get('multiplyByRepeat')?.checked) };
      case 'delay':
        return { type, ms: Number(get('ms')?.value) || 500 };
      case 'sound':
        return { type, soundId: get('soundId')?.value || '', screen: Number(get('screen')?.value) || 1 };
      case 'tts':
        return { type, template: get('template')?.value || '', voice: get('voice')?.value || '' };
      case 'screen_alert':
        return {
          type,
          screen: Number(get('screen')?.value) || 1,
          title: get('title')?.value || '',
          subtitle: get('subtitle')?.value || '',
          mediaUrl: get('mediaUrl')?.value || '',
          durationMs: Number(get('durationMs')?.value) || 4000
        };
      case 'obs_scene':
        return { type, sceneName: get('sceneName')?.value.trim() || '', durationSec: Number(get('durationSec')?.value) || 0 };
      case 'obs_source':
        return {
          type,
          sceneName: get('sceneName')?.value.trim() || '',
          sourceName: get('sourceName')?.value.trim() || '',
          enabled: get('enabled')?.value !== 'false',
          durationSec: Number(get('durationSec')?.value) || 0
        };
      case 'obs_filter':
        return { type, sourceName: get('sourceName')?.value.trim() || '', filterName: get('filterName')?.value.trim() || '', durationSec: Number(get('durationSec')?.value) || 8 };
      case 'obs_mute':
        return { type, inputName: get('inputName')?.value.trim() || '', durationSec: Number(get('durationSec')?.value) || 10 };
      case 'obs_text':
        return { type, inputName: get('inputName')?.value.trim() || '', textTemplate: get('textTemplate')?.value || '' };
      case 'timer_add':
        return { type, seconds: Number(get('seconds')?.value) || 0 };
      case 'custom_goal':
        return { type, goalType: get('goalType')?.value || 'custom_1', delta: Number(get('delta')?.value) || 1 };
      case 'webhook':
        return { type, payload: { note: get('note')?.value || '' } };
      default:
        return { type };
    }
  });

  const res = await api('POST', '/api/actions', { id, name, description, priority, steps });
  if (res.success && res.data) {
    actionsData = res.data;
    renderActionsAndMatrix();
    renderConfigurator();
    renderWidgetsTab(false);
    closeModal('modal-action-builder');
    toast(`Action "${name}" disimpan!`, 'success');
  } else {
    toast(res.error || 'Gagal menyimpan Action', 'error');
  }
});

// Event Rules Matrix Editor
function openEventRuleEditor(rule = null) {
  const editor = document.getElementById('event-rule-editor');
  if (!editor) return;
  document.getElementById('rule-edit-id').value = rule?.id || '';
  document.getElementById('rule-name').value = rule?.name || '';
  document.getElementById('rule-event-type').value = rule?.eventType || 'gift';
  document.getElementById('rule-gift-id').value = rule?.giftId || '';
  document.getElementById('rule-min-coins').value = rule?.minCoins ?? 0;
  document.getElementById('rule-min-amount').value = rule?.minAmount ?? 0;
  document.getElementById('rule-command').value = rule?.command || '';
  document.getElementById('rule-role').value = rule?.allowedRole || 'everyone';
  document.getElementById('rule-cooldown').value = rule?.cooldownSec ?? 0;
  document.getElementById('rule-allowed-users').value = rule?.allowedUsers || '';
  document.getElementById('rule-enabled').checked = rule ? rule.enabled !== false : true;

  const checksEl = document.getElementById('rule-actions-checks');
  const selectedIds = new Set(Array.isArray(rule?.actionIds) ? rule.actionIds : []);
  const actions = actionsData?.actions || [];
  if (checksEl) {
    checksEl.innerHTML = actions.length === 0
      ? '<span class="action-card-meta">Buat Action terlebih dahulu di atas.</span>'
      : actions.map(a => `<label class="checkbox-label" style="margin:0; font-size:12px;"><input type="checkbox" value="${esc(a.id)}" ${selectedIds.has(a.id) ? 'checked' : ''}> ⚡ ${esc(a.name)}</label>`).join('');
  }
  editor.style.display = 'flex';
}

document.getElementById('btn-add-event-rule')?.addEventListener('click', () => openEventRuleEditor(null));
document.getElementById('btn-cancel-event-rule')?.addEventListener('click', () => {
  const editor = document.getElementById('event-rule-editor');
  if (editor) editor.style.display = 'none';
});

window.editEventRule = (id) => {
  const rule = (actionsData?.events || []).find(r => r.id === id);
  if (rule) openEventRuleEditor(rule);
};

window.deleteEventRule = async (id) => {
  const res = await api('DELETE', `/api/events-matrix/${encodeURIComponent(id)}`);
  if (res.success) {
    actionsData = await api('GET', '/api/actions');
    renderActionsAndMatrix();
    toast('Event Rule dihapus.', 'info');
  }
};

document.getElementById('btn-save-event-rule')?.addEventListener('click', async () => {
  const actionIds = Array.from(document.querySelectorAll('#rule-actions-checks input:checked')).map(c => c.value);
  const payload = {
    id: document.getElementById('rule-edit-id')?.value.trim() || undefined,
    name: document.getElementById('rule-name')?.value.trim() || undefined,
    eventType: document.getElementById('rule-event-type')?.value || 'gift',
    giftId: document.getElementById('rule-gift-id')?.value.trim() || '',
    minCoins: Number(document.getElementById('rule-min-coins')?.value) || 0,
    minAmount: Number(document.getElementById('rule-min-amount')?.value) || 0,
    command: document.getElementById('rule-command')?.value.trim() || '',
    allowedRole: document.getElementById('rule-role')?.value || 'everyone',
    cooldownSec: Number(document.getElementById('rule-cooldown')?.value) || 0,
    allowedUsers: document.getElementById('rule-allowed-users')?.value.trim() || '',
    enabled: document.getElementById('rule-enabled')?.checked ?? true,
    actionIds
  };
  const res = await api('POST', '/api/events-matrix', payload);
  if (res.success && res.data) {
    actionsData = res.data;
    document.getElementById('event-rule-editor').style.display = 'none';
    renderActionsAndMatrix();
    toast('Event Rule Matrix disimpan!', 'success');
  } else {
    toast(res.error || 'Gagal menyimpan Event Rule', 'error');
  }
});

// Export & Import Actions Bundle
document.getElementById('btn-export-actions')?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(actionsData || { version: 1, actions: [], events: [] }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `agiva-actions-bundle-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('btn-import-actions')?.addEventListener('click', () => {
  document.getElementById('actions-import-file')?.click();
});

document.getElementById('actions-import-file')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const res = await api('POST', '/api/actions/import', parsed);
    if (res.success && res.data) {
      actionsData = res.data;
      renderActionsAndMatrix();
      renderConfigurator();
      renderWidgetsTab(false);
      toast('Bundle Actions & Event Matrix berhasil di-import!', 'success');
    } else {
      toast(res.error || 'Gagal import actions bundle', 'error');
    }
  } catch (err) {
    toast('File JSON tidak valid: ' + err.message, 'error');
  }
  e.target.value = '';
});

// Media Library Modal
async function refreshMediaLibrary() {
  const grid = document.getElementById('media-library-grid');
  if (!grid) return;
  try {
    mediaFiles = await api('GET', '/api/media');
    if (!Array.isArray(mediaFiles) || mediaFiles.length === 0) {
      grid.innerHTML = '<div class="form-hint">Belum ada file di Media Library. Klik <strong>+ Upload Media</strong> di kanan atas.</div>';
      return;
    }
    grid.innerHTML = mediaFiles.map(item => {
      const ext = (item.filename.split('.').pop() || '').toLowerCase();
      const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
      const isVid = ['mp4', 'webm'].includes(ext);
      const preview = isImg
        ? `<img class="media-thumb" src="${esc(item.url)}" alt="" loading="lazy">`
        : `<div class="media-thumb">${isVid ? '🎬' : '🔊'}</div>`;
      return `
        <div class="media-card">
          ${preview}
          <div class="media-name" title="${esc(item.filename)}">${esc(item.filename)}</div>
          <div class="action-card-meta">${Math.max(1, Math.round((item.size || 0) / 1024))} KB</div>
          <div class="input-row">
            ${activeMediaPickCallback
              ? `<button type="button" class="btn-sm success" style="flex:1" onclick="pickMediaUrl('${esc(item.url)}')">✔ Pilih</button>`
              : `<button type="button" class="btn-sm" style="flex:1" onclick="copyMediaUrl('${esc(item.url)}')">📋 Copy</button>`}
            <button type="button" class="btn-sm danger" onclick="deleteMediaFile('${esc(item.filename)}')">✕</button>
          </div>
        </div>
      `;
    }).join('');
  } catch {}
}

function openMediaLibraryModal(pickCb = null) {
  activeMediaPickCallback = pickCb;
  const hint = document.getElementById('media-library-hint');
  if (hint) {
    hint.textContent = pickCb
      ? 'Klik "✔ Pilih" pada gambar/GIF/video/audio untuk langsung memasangnya ke step Screen Alert.'
      : 'Upload file media sekali (maks 10MB) lalu salin URL /media/... atau pilih langsung ke Screen Alert di Action Builder.';
  }
  openModal('modal-media-library');
  refreshMediaLibrary();
}

window.pickMediaUrl = (url) => {
  if (typeof activeMediaPickCallback === 'function') {
    activeMediaPickCallback(url);
  }
  activeMediaPickCallback = null;
  closeModal('modal-media-library');
};

window.copyMediaUrl = (url) => {
  const full = `${location.origin}${url}`;
  navigator.clipboard?.writeText(full);
  toast(`URL disalin: ${url}`, 'success');
};

window.deleteMediaFile = async (filename) => {
  const res = await api('DELETE', `/api/media/${encodeURIComponent(filename)}`);
  if (res.success) {
    await refreshMediaLibrary();
    toast('File media dihapus.', 'info');
  }
};

document.getElementById('btn-open-media-library')?.addEventListener('click', () => openMediaLibraryModal(null));
document.getElementById('btn-open-media-from-tts')?.addEventListener('click', () => openMediaLibraryModal(null));

document.getElementById('media-upload-input')?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const res = await api('POST', '/api/media/upload', { filename: file.name, dataBase64: reader.result });
    if (res.success) {
      await refreshMediaLibrary();
      toast(`Media "${res.item.filename}" di-upload!`, 'success');
    } else {
      toast(res.error || 'Gagal upload media', 'error');
    }
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

// ─── Phase 3: Mini-Games, Points Economy, Chatbot & Interval Timers ─
document.getElementById('btn-copy-lastx')?.addEventListener('click', () => {
  const type = document.getElementById('lastx-type-select')?.value || 'follower';
  const fullUrl = `${location.origin}/overlay?widget=last&type=${encodeURIComponent(type)}`;
  navigator.clipboard?.writeText(fullUrl);
  toast(`Disalin URL Last "${type}": ${fullUrl}`, 'success');
});

function syncMiniGamesUi(force = false) {
  if (!widgetState) return;
  const gb = widgetState.giftBattle || {};
  const gbBadge = document.getElementById('gb-status-badge');
  if (gbBadge) {
    const l = gb.left?.score || 0;
    const r = gb.right?.score || 0;
    gbBadge.textContent = gb.active ? `LIVE (${l} vs ${r})` : (gb.winner ? `🏆 ${gb.winner.label}` : `IDLE (${l} vs ${r})`);
  }
  if (force || !miniGamesHydrated) {
    setWidgetInputIfIdle('gb-title', gb.title || '⚔️ GIFT BATTLE', force);
    setWidgetInputIfIdle('gb-target', gb.target || 50, force);
    setWidgetInputIfIdle('gb-left-label', gb.left?.label || 'TEAM A (Rose)', force);
    setWidgetInputIfIdle('gb-left-gift', gb.left?.giftId || 5655, force);
    setWidgetInputIfIdle('gb-right-label', gb.right?.label || 'TEAM B (Doughnut)', force);
    setWidgetInputIfIdle('gb-right-gift', gb.right?.giftId || 5879, force);
  }

  const cm = widgetState.coinMatch || {};
  const cmBadge = document.getElementById('cm-status-badge');
  if (cmBadge) {
    cmBadge.textContent = cm.active ? `LIVE (${cm.remainingSec}s)` : `IDLE (${cm.durationSec || 120}s)`;
  }
  if (force || !miniGamesHydrated) {
    setWidgetInputIfIdle('cm-duration', cm.durationSec || 120, force);
  }

  const lk = widgetState.likeathon || {};
  const lkBadge = document.getElementById('lk-status-badge');
  if (lkBadge) {
    lkBadge.textContent = lk.active ? `LIVE (-${lk.decayPercent}%/${lk.decayIntervalSec}s)` : 'IDLE';
  }
  if (force || !miniGamesHydrated) {
    setWidgetInputIfIdle('lk-decay-pct', lk.decayPercent ?? 10, force);
    setWidgetInputIfIdle('lk-decay-sec', lk.decayIntervalSec ?? 10, force);
  }

  if (force || !miniGamesHydrated) {
    const slots = widgetState.giftCounters || [];
    [1, 2, 3].forEach((n, idx) => {
      const s = slots[idx] || {};
      setWidgetCheckIfIdle(`gc-${n}-en`, s.enabled, force);
      setWidgetInputIfIdle(`gc-${n}-label`, s.label || '', force);
      setWidgetInputIfIdle(`gc-${n}-gift`, s.giftId || '', force);
      setWidgetInputIfIdle(`gc-${n}-target`, s.target ?? 0, force);
    });
    const cj = widgetState.coinJar || {};
    setWidgetInputIfIdle('cj-capacity', cj.capacityCoins || 500, force);
  }
  miniGamesHydrated = true;
}

function readGiftBattlePayload(action) {
  return {
    action,
    title: document.getElementById('gb-title')?.value || '⚔️ GIFT BATTLE',
    target: Number(document.getElementById('gb-target')?.value) || 50,
    left: {
      label: document.getElementById('gb-left-label')?.value || 'TEAM A',
      giftId: document.getElementById('gb-left-gift')?.value || 5655
    },
    right: {
      label: document.getElementById('gb-right-label')?.value || 'TEAM B',
      giftId: document.getElementById('gb-right-gift')?.value || 5879
    }
  };
}
document.getElementById('btn-gb-start')?.addEventListener('click', () => api('POST', '/api/widgets/gift-battle', readGiftBattlePayload('start')));
document.getElementById('btn-gb-stop')?.addEventListener('click', () => api('POST', '/api/widgets/gift-battle', { action: 'stop' }));
document.getElementById('btn-gb-reset')?.addEventListener('click', () => api('POST', '/api/widgets/gift-battle', { action: 'reset' }));

document.getElementById('btn-cm-start')?.addEventListener('click', () => api('POST', '/api/widgets/coin-match', { action: 'start', durationSec: Number(document.getElementById('cm-duration')?.value) || 120 }));
document.getElementById('btn-cm-end')?.addEventListener('click', () => api('POST', '/api/widgets/coin-match', { action: 'end' }));
document.getElementById('btn-cm-winners')?.addEventListener('click', () => api('POST', '/api/widgets/coin-match', { action: 'show_winners' }));
document.getElementById('btn-cm-reset')?.addEventListener('click', () => api('POST', '/api/widgets/coin-match', { action: 'reset' }));

document.getElementById('btn-lk-start')?.addEventListener('click', () => api('POST', '/api/widgets/likeathon', {
  action: 'start',
  decayPercent: Number(document.getElementById('lk-decay-pct')?.value) || 10,
  decayIntervalSec: Number(document.getElementById('lk-decay-sec')?.value) || 10
}));
document.getElementById('btn-lk-stop')?.addEventListener('click', () => api('POST', '/api/widgets/likeathon', { action: 'stop' }));
document.getElementById('btn-lk-reset')?.addEventListener('click', () => api('POST', '/api/widgets/likeathon', { action: 'reset' }));

document.getElementById('btn-gc-save')?.addEventListener('click', async () => {
  const slots = [1, 2, 3].map(n => ({
    id: `slot_${n}`,
    enabled: Boolean(document.getElementById(`gc-${n}-en`)?.checked),
    label: document.getElementById(`gc-${n}-label`)?.value || `Slot ${n}`,
    giftId: document.getElementById(`gc-${n}-gift`)?.value || '',
    target: Number(document.getElementById(`gc-${n}-target`)?.value) || 0
  }));
  await api('POST', '/api/widgets/gift-counters', { slots });
  toast('Gift Counters disimpan!', 'success');
});

document.getElementById('btn-cj-save')?.addEventListener('click', async () => {
  const capacityCoins = Number(document.getElementById('cj-capacity')?.value) || 500;
  await api('POST', '/api/widgets/coin-jar', { action: 'config', capacityCoins, enabled: true });
  toast('Kapasitas Coin Jar diperbarui!', 'success');
});
document.getElementById('btn-cj-reset')?.addEventListener('click', () => api('POST', '/api/widgets/coin-jar', { action: 'reset' }));
document.getElementById('btn-records-reset')?.addEventListener('click', async () => {
  await api('POST', '/api/widgets/records/reset');
  toast('Top Gift, Top Streak & Last X di-reset!', 'info');
});

// Loyalty Points Rendering & Controls
function renderLoyaltyTab(force = false) {
  if (!pointsState) return;
  const cfg = pointsState.config || {};
  if (force || !loyaltyFormHydrated) {
    setWidgetCheckIfIdle('pts-enabled', cfg.enabled !== false, force);
    setWidgetInputIfIdle('pts-currency-name', cfg.currencyName || 'Agiva Points', force);
    setWidgetInputIfIdle('pts-currency-symbol', cfg.currencySymbol || '⭐', force);
    setWidgetInputIfIdle('pts-per-coin', cfg.pointsPerCoin ?? 10, force);
    setWidgetInputIfIdle('pts-per-likes', cfg.pointsPer100Likes ?? 5, force);
    setWidgetInputIfIdle('pts-per-follow', cfg.pointsPerFollow ?? 25, force);
    setWidgetInputIfIdle('pts-per-share', cfg.pointsPerShare ?? 15, force);
    setWidgetInputIfIdle('pts-per-sub', cfg.pointsPerSub ?? 200, force);
    setWidgetInputIfIdle('pts-per-chat', cfg.pointsPerChat ?? 2, force);
    setWidgetInputIfIdle('pts-sub-bonus', cfg.subBonusPercent ?? 50, force);
    setWidgetInputIfIdle('pts-spin-cost', cfg.spinCostPoints ?? 50, force);
    setWidgetInputIfIdle('pts-tts-cost', cfg.ttsCostPoints ?? 0, force);
    loyaltyFormHydrated = true;
  }

  const dropBadge = document.getElementById('pts-drop-badge');
  if (dropBadge) {
    const d = pointsState.activeDrop;
    dropBadge.textContent = d?.active ? `🎁 DROP ${d.keyword} (${d.winners?.length || 0}/${d.maxWinners || 5})` : 'DROP IDLE';
  }
  const chBadge = document.getElementById('pts-challenge-badge');
  if (chBadge) {
    chBadge.textContent = pointsState.challenge?.active ? '🏁 CHALLENGE AKTIF' : 'NORMAL';
  }

  const lbEl = document.getElementById('pts-leaderboard-list');
  if (lbEl) {
    const lb = pointsState.leaderboard || [];
    const sym = cfg.currencySymbol || '⭐';
    lbEl.innerHTML = lb.length === 0
      ? '<div class="form-hint">Belum ada penonton tercatat.</div>'
      : lb.slice(0, 15).map((u, i) => `
        <div class="loyalty-row">
          <span><strong>#${i + 1} @${esc(u.user)}</strong> · Lv.${u.level || 1}${u.isSub ? ' ⭐SUB' : ''}</span>
          <strong>${Number(u.points || 0).toLocaleString('id-ID')} ${esc(sym)}</strong>
        </div>
      `).join('');
  }

  const txEl = document.getElementById('pts-transactions-list');
  if (txEl) {
    const txs = pointsState.transactions || [];
    txEl.innerHTML = txs.length === 0
      ? '<div class="form-hint">Belum ada transaksi poin.</div>'
      : txs.slice(0, 20).map(tx => `
        <div class="loyalty-row">
          <span>@${esc(tx.user)} <span class="action-card-meta">(${esc(tx.reason || tx.type)})</span></span>
          <strong style="color:${tx.delta >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'};">${tx.delta >= 0 ? '+' : ''}${tx.delta}</strong>
        </div>
      `).join('');
  }
}

document.getElementById('btn-pts-save')?.addEventListener('click', async () => {
  const payload = {
    enabled: Boolean(document.getElementById('pts-enabled')?.checked),
    currencyName: document.getElementById('pts-currency-name')?.value || 'Agiva Points',
    currencySymbol: document.getElementById('pts-currency-symbol')?.value || '⭐',
    pointsPerCoin: Number(document.getElementById('pts-per-coin')?.value) || 0,
    pointsPer100Likes: Number(document.getElementById('pts-per-likes')?.value) || 0,
    pointsPerFollow: Number(document.getElementById('pts-per-follow')?.value) || 0,
    pointsPerShare: Number(document.getElementById('pts-per-share')?.value) || 0,
    pointsPerSub: Number(document.getElementById('pts-per-sub')?.value) || 0,
    pointsPerChat: Number(document.getElementById('pts-per-chat')?.value) || 0,
    subBonusPercent: Number(document.getElementById('pts-sub-bonus')?.value) || 0,
    spinCostPoints: Number(document.getElementById('pts-spin-cost')?.value) || 0,
    ttsCostPoints: Number(document.getElementById('pts-tts-cost')?.value) || 0
  };
  const res = await api('PUT', '/api/points/config', payload);
  if (res.state) { pointsState = res.state; renderLoyaltyTab(true); }
  toast('Aturan Loyalty Points disimpan!', 'success');
});

document.getElementById('btn-pts-drop-start')?.addEventListener('click', async () => {
  const keyword = document.getElementById('pts-drop-keyword')?.value.trim() || '!get';
  const amount = Number(document.getElementById('pts-drop-amount')?.value) || 50;
  const res = await api('POST', '/api/points/drop', { action: 'start', keyword, amount });
  if (res.state) { pointsState = res.state; renderLoyaltyTab(false); }
  toast(`🎁 Points Drop "${keyword}" (+${amount}) dimulai!`, 'success');
});
document.getElementById('btn-pts-drop-stop')?.addEventListener('click', async () => {
  const res = await api('POST', '/api/points/drop', { action: 'stop' });
  if (res.state) { pointsState = res.state; renderLoyaltyTab(false); }
  toast('Points Drop dihentikan.', 'info');
});
document.getElementById('btn-pts-challenge-start')?.addEventListener('click', async () => {
  const res = await api('POST', '/api/points/challenge', { action: 'start' });
  if (res.state) { pointsState = res.state; renderLoyaltyTab(false); }
  toast('🏁 Challenge Mode dimulai (poin sementara direset ke 0)!', 'success');
});
document.getElementById('btn-pts-challenge-merge')?.addEventListener('click', async () => {
  const res = await api('POST', '/api/points/challenge', { action: 'end', mode: 'merge' });
  if (res.state) { pointsState = res.state; renderLoyaltyTab(false); }
  toast('✅ Poin Challenge digabungkan ke saldo awal!', 'success');
});
document.getElementById('btn-pts-challenge-discard')?.addEventListener('click', async () => {
  const res = await api('POST', '/api/points/challenge', { action: 'end', mode: 'discard' });
  if (res.state) { pointsState = res.state; renderLoyaltyTab(false); }
  toast('↩️ Poin dikembalikan seperti sebelum Challenge.', 'info');
});
document.getElementById('btn-pts-halving')?.addEventListener('click', async () => {
  const percent = Number(document.getElementById('pts-halving-pct')?.value) || 50;
  const res = await api('POST', '/api/points/halving', { percent });
  if (res.state) { pointsState = res.state; renderLoyaltyTab(false); }
  toast(`✂️ Halving -${percent}% diterapkan (${res.affected || 0} user)!`, 'info');
});
document.getElementById('btn-pts-adjust')?.addEventListener('click', async () => {
  const user = document.getElementById('pts-adj-user')?.value.trim();
  const delta = Number(document.getElementById('pts-adj-delta')?.value) || 0;
  if (!user || delta === 0) return toast('Masukkan username & jumlah +/- poin!', 'error');
  const res = await api('POST', '/api/points/adjust', { user, delta });
  if (res.state) { pointsState = res.state; renderLoyaltyTab(false); }
  toast(`Saldo @${user} diubah (${delta > 0 ? '+' : ''}${delta})!`, 'success');
});

// Active Chatbot Rendering & Controls
function renderChatbotSection(force = false) {
  if (!chatbotState) return;
  const cfg = chatbotState.config || {};
  if (force || !chatbotFormHydrated) {
    setWidgetCheckIfIdle('bot-enabled', cfg.enabled !== false, force);
    setWidgetCheckIfIdle('bot-send-tiktok', cfg.sendToTikTok, force);
    setWidgetInputIfIdle('bot-rate-limit', cfg.maxMessagesPer15Sec ?? 3, force);
    setWidgetCheckIfIdle('bot-welcome-enabled', cfg.welcomeEnabled, force);
    setWidgetInputIfIdle('bot-welcome-tpl', cfg.welcomeTemplate || '', force);
    setWidgetCheckIfIdle('bot-gift-enabled', cfg.thankGiftEnabled, force);
    setWidgetInputIfIdle('bot-gift-tpl', cfg.thankGiftTemplate || '', force);
    setWidgetCheckIfIdle('bot-follow-enabled', cfg.followReplyEnabled, force);
    setWidgetInputIfIdle('bot-follow-tpl', cfg.followTemplate || '', force);
    chatbotFormHydrated = true;
  }

  const cmdsEl = document.getElementById('bot-cmds-list');
  if (cmdsEl) {
    const cmds = cfg.customCommands || [];
    cmdsEl.innerHTML = cmds.length === 0
      ? '<div class="form-hint">Belum ada custom command chatbot.</div>'
      : cmds.map(c => `
        <div class="loyalty-row">
          <span><code>${esc(c.trigger)}</code> → ${esc(c.response)} ${c.costPoints > 0 ? `(${c.costPoints}⭐)` : ''}</span>
          <button type="button" class="btn-sm danger" onclick="deleteChatbotCmd('${esc(c.id)}')">✕</button>
        </div>
      `).join('');
  }

  const logsEl = document.getElementById('bot-logs-list');
  if (logsEl) {
    const logs = chatbotState.logs || [];
    logsEl.innerHTML = logs.length === 0
      ? '<div class="form-hint">Belum ada log pesan chatbot.</div>'
      : logs.slice(0, 15).map(l => `
        <div class="loyalty-row">
          <span>${esc(l.text)}</span>
          <span class="badge-pill">${esc(l.status || 'ok')}</span>
        </div>
      `).join('');
  }
}

window.deleteChatbotCmd = async (id) => {
  const res = await api('DELETE', `/api/chatbot/command/${encodeURIComponent(id)}`);
  if (res.state) { chatbotState = res.state; renderChatbotSection(false); }
};

document.getElementById('btn-bot-save')?.addEventListener('click', async () => {
  const payload = {
    enabled: Boolean(document.getElementById('bot-enabled')?.checked),
    sendToTikTok: Boolean(document.getElementById('bot-send-tiktok')?.checked),
    maxMessagesPer15Sec: Number(document.getElementById('bot-rate-limit')?.value) || 3,
    welcomeEnabled: Boolean(document.getElementById('bot-welcome-enabled')?.checked),
    welcomeTemplate: document.getElementById('bot-welcome-tpl')?.value || '',
    thankGiftEnabled: Boolean(document.getElementById('bot-gift-enabled')?.checked),
    thankGiftTemplate: document.getElementById('bot-gift-tpl')?.value || '',
    followReplyEnabled: Boolean(document.getElementById('bot-follow-enabled')?.checked),
    followTemplate: document.getElementById('bot-follow-tpl')?.value || ''
  };
  const res = await api('PUT', '/api/chatbot/config', payload);
  if (res.state) { chatbotState = res.state; renderChatbotSection(true); }
  toast('Pengaturan Active Chatbot disimpan!', 'success');
});

document.getElementById('btn-bot-cmd-add')?.addEventListener('click', async () => {
  const trigger = document.getElementById('bot-cmd-trigger')?.value.trim();
  const response = document.getElementById('bot-cmd-response')?.value.trim();
  if (!trigger || !response) return toast('Isi trigger & balasan command!', 'error');
  const res = await api('POST', '/api/chatbot/command', {
    trigger,
    response,
    costPoints: Number(document.getElementById('bot-cmd-cost')?.value) || 0,
    cooldownSec: Number(document.getElementById('bot-cmd-cd')?.value) || 5
  });
  if (res.state) {
    chatbotState = res.state;
    document.getElementById('bot-cmd-trigger').value = '';
    document.getElementById('bot-cmd-response').value = '';
    renderChatbotSection(false);
    toast(`Command "${trigger}" ditambahkan!`, 'success');
  }
});

document.getElementById('btn-bot-send')?.addEventListener('click', async () => {
  const text = document.getElementById('bot-test-msg')?.value.trim();
  if (!text) return;
  const res = await api('POST', '/api/chatbot/send', { text });
  if (res.state) { chatbotState = res.state; renderChatbotSection(false); }
  document.getElementById('bot-test-msg').value = '';
  toast('Pesan chatbot dikirim ke Chat Overlay / TikTok!', 'success');
});

document.getElementById('btn-bot-logs-clear')?.addEventListener('click', async () => {
  await api('DELETE', '/api/chatbot/logs');
  if (chatbotState) chatbotState.logs = [];
  renderChatbotSection(false);
});

// Interval Timers Rendering & Controls
function renderIntervalsSection() {
  if (!intervalsState) return;
  setWidgetCheckIfIdle('iv-only-live', intervalsState.onlyWhenLive !== false, false);

  const actSel = document.getElementById('iv-action-id');
  if (actSel) {
    const cur = actSel.value;
    actSel.innerHTML = '<option value="">-- Pilih Action --</option>' +
      (actionsData?.actions || []).map(a => `<option value="${esc(a.id)}">⚡ ${esc(a.name)}</option>`).join('');
    if (cur) actSel.value = cur;
  }

  const listEl = document.getElementById('intervals-list');
  if (listEl) {
    const timers = intervalsState.timers || [];
    listEl.innerHTML = timers.length === 0
      ? '<div class="form-hint">Belum ada Interval Timer.</div>'
      : timers.map(t => `
        <div class="loyalty-row">
          <span><strong>⏰ ${esc(t.name)}</strong> · tiap ${t.intervalMinutes} menit (${esc(t.mode)})</span>
          <div class="input-row" style="margin:0;">
            <button type="button" class="btn-sm success" onclick="triggerIntervalNow('${esc(t.id)}')">▶ Jalankan</button>
            <button type="button" class="btn-sm danger" onclick="deleteIntervalTimer('${esc(t.id)}')">✕</button>
          </div>
        </div>
      `).join('');
  }
}

window.triggerIntervalNow = async (id) => {
  await api('POST', `/api/intervals/${encodeURIComponent(id)}/trigger`);
  toast('Interval timer dijalankan manual!', 'success');
};
window.deleteIntervalTimer = async (id) => {
  const res = await api('DELETE', `/api/intervals/${encodeURIComponent(id)}`);
  if (res.state) { intervalsState = res.state; renderIntervalsSection(); }
};

document.getElementById('iv-only-live')?.addEventListener('change', async (e) => {
  const res = await api('PUT', '/api/intervals/settings', { onlyWhenLive: Boolean(e.target.checked) });
  if (res.state) intervalsState = res.state;
});

document.getElementById('btn-iv-add')?.addEventListener('click', async () => {
  const name = document.getElementById('iv-name')?.value.trim() || 'Interval Timer';
  const intervalMinutes = Number(document.getElementById('iv-minutes')?.value) || 5;
  const mode = document.getElementById('iv-mode')?.value || 'chat';
  const actionId = document.getElementById('iv-action-id')?.value || '';
  const chatMessage = document.getElementById('iv-chat-msg')?.value.trim() || '';
  const dropAmount = Number(document.getElementById('iv-drop-amt')?.value) || 50;
  const res = await api('POST', '/api/intervals', { name, intervalMinutes, mode, actionId, chatMessage, dropAmount, enabled: true });
  if (res.state) {
    intervalsState = res.state;
    document.getElementById('iv-name').value = '';
    renderIntervalsSection();
    toast(`Interval "${name}" ditambahkan!`, 'success');
  }
});

// ─── Phase 4: Spotify Song Requests, Streamer.bot, Voicemod, IFTTT, LAN Remote & Ctrl+K ──
let spotifyState = null;
let streamerBotState = null;
let integrationsState = null;

function renderSpotifySection(populateInputs = true) {
  if (!spotifyState) return;
  const cfg = spotifyState.config || {};
  const badge = document.getElementById('spotify-status-badge');
  if (badge) {
    const label = !cfg.enabled
      ? 'OFF'
      : (cfg.mode === 'spotify' ? (cfg.hasSpotifyToken ? 'SPOTIFY OAUTH' : 'OAUTH NEEDED') : 'STANDALONE ACTIVE');
    badge.textContent = label;
    badge.style.background = cfg.enabled ? '#55efc4' : '#dfe6e9';
  }

  if (populateInputs) {
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    setVal('sp-enabled-select', cfg.enabled ? 'true' : 'false');
    setVal('sp-mode-select', cfg.mode || 'standalone');
    setVal('sp-cost-points', cfg.costPoints ?? 0);
    setVal('sp-allowed-role', cfg.allowedRole || 'all');
    setVal('sp-max-queue', cfg.maxQueueSize ?? 20);
    setVal('sp-max-user', cfg.maxPerUser ?? 3);
    setVal('sp-client-id', cfg.clientId || '');
    setVal('sp-client-secret', cfg.clientSecret || '');
    const expEl = document.getElementById('sp-allow-explicit');
    if (expEl) expEl.checked = Boolean(cfg.allowExplicit);
    const autoEl = document.getElementById('sp-autoplay-overlay');
    if (autoEl) autoEl.checked = cfg.autoPlayOverlayAudio !== false;
  }

  const npEl = document.getElementById('sp-now-playing');
  if (npEl) {
    const cur = spotifyState.currentTrack;
    if (cur) {
      npEl.innerHTML = `🎶 <strong>Sedang Diputar:</strong> ${esc(cur.title)} — <em>${esc(cur.artist)}</em> · Req by <code>@${esc(cur.requestedByName || cur.requestedBy)}</code>`;
    } else {
      npEl.textContent = 'Belum ada lagu yang sedang diputar. Ketik !play <judul lagu> di chat atau tambah manual di atas.';
    }
  }

  const qEl = document.getElementById('sp-queue-list');
  if (qEl) {
    const q = spotifyState.queue || [];
    qEl.innerHTML = q.length === 0
      ? '<div class="form-hint">Antrean lagu kosong.</div>'
      : q.map((item, idx) => `
        <div class="loyalty-row">
          <div>
            <strong>#${idx + 1} ${esc(item.title)}</strong> — <span class="form-hint">${esc(item.artist)}</span>
            <span class="badge-pill" style="margin-left:6px;">@${esc(item.requestedByName || item.requestedBy)}</span>
          </div>
          <button type="button" class="btn-sm danger" onclick="removeSpotifyQueueItem('${esc(item.id)}')">✕</button>
        </div>
      `).join('');
  }
}

window.removeSpotifyQueueItem = async (id) => {
  const res = await api('DELETE', `/api/spotify/queue/${encodeURIComponent(id)}`);
  if (res.state) {
    spotifyState = res.state;
    renderSpotifySection(false);
  }
};

document.getElementById('btn-sp-save')?.addEventListener('click', async () => {
  const patch = {
    enabled: document.getElementById('sp-enabled-select')?.value === 'true',
    mode: document.getElementById('sp-mode-select')?.value || 'standalone',
    costPoints: Number(document.getElementById('sp-cost-points')?.value) || 0,
    allowedRole: document.getElementById('sp-allowed-role')?.value || 'all',
    maxQueueSize: Number(document.getElementById('sp-max-queue')?.value) || 20,
    maxPerUser: Number(document.getElementById('sp-max-user')?.value) || 3,
    allowExplicit: Boolean(document.getElementById('sp-allow-explicit')?.checked),
    autoPlayOverlayAudio: Boolean(document.getElementById('sp-autoplay-overlay')?.checked),
    clientId: document.getElementById('sp-client-id')?.value.trim() || '',
    clientSecret: document.getElementById('sp-client-secret')?.value.trim() || ''
  };
  const res = await api('PUT', '/api/spotify/config', patch);
  if (res.state) {
    spotifyState = res.state;
    renderSpotifySection(true);
    toast('Pengaturan Spotify Song Request disimpan!', 'success');
  }
});

document.getElementById('btn-sp-oauth')?.addEventListener('click', async () => {
  const clientId = document.getElementById('sp-client-id')?.value.trim() || '';
  const clientSecret = document.getElementById('sp-client-secret')?.value.trim() || '';
  await api('PUT', '/api/spotify/config', { clientId, clientSecret, mode: 'spotify' });
  const res = await api('GET', '/api/spotify/auth-url');
  if (res.success && res.url) {
    openExternalUrl(res.url);
  } else {
    toast(res.error || 'Isi Spotify Client ID terlebih dahulu.', 'error');
  }
});

document.getElementById('btn-sp-copy-overlay')?.addEventListener('click', () => {
  const url = `${location.origin}/overlay?widget=song-request`;
  navigator.clipboard?.writeText(url);
  toast(`URL Overlay Song Request disalin: ${url}`, 'success');
});

document.getElementById('btn-sp-add')?.addEventListener('click', async () => {
  const inp = document.getElementById('sp-manual-query');
  const query = inp?.value.trim() || '';
  if (!query) return toast('Masukkan judul lagu terlebih dahulu.', 'error');
  const res = await api('POST', '/api/spotify/request', { query, user: 'Streamer', force: true });
  if (res.success) {
    inp.value = '';
    spotifyState = res.state;
    renderSpotifySection(false);
    toast(`Ditambahkan: ${res.track?.title} — ${res.track?.artist}`, 'success');
  } else {
    toast(res.error || 'Gagal menambahkan lagu', 'error');
  }
});

document.getElementById('btn-sp-skip')?.addEventListener('click', async () => {
  const res = await api('POST', '/api/spotify/skip', { user: 'Streamer' });
  if (res.state) {
    spotifyState = res.state;
    renderSpotifySection(false);
    toast('Lagu di-skip!', 'info');
  }
});

document.getElementById('btn-sp-clear')?.addEventListener('click', async () => {
  const res = await api('POST', '/api/spotify/clear');
  if (res.state) {
    spotifyState = res.state;
    renderSpotifySection(false);
    toast('Antrean lagu dibersihkan.', 'info');
  }
});

function renderStreamerBotAndVoicemodSection(populateInputs = true) {
  const sb = streamerBotState || {};
  const vm = integrationsState?.voicemod || {};
  const presets = integrationsState?.iftttPresets || [];

  const sbBadge = document.getElementById('sb-status-badge');
  if (sbBadge) {
    const sbTxt = sb.isConnected ? 'SB CONNECTED' : (sb.enabled ? 'SB CONNECTING' : 'SB OFF');
    const vmTxt = vm.isConnected ? ' · VM ON' : '';
    sbBadge.textContent = `${sbTxt}${vmTxt}`;
    sbBadge.style.background = (sb.isConnected || vm.isConnected) ? '#55efc4' : '#dfe6e9';
  }

  if (populateInputs) {
    const sbEn = document.getElementById('sb-enabled-select');
    if (sbEn) sbEn.value = sb.enabled ? 'true' : 'false';
    const sbUrl = document.getElementById('sb-url-input');
    if (sbUrl && sb.url) sbUrl.value = sb.url;
    const sbAct = document.getElementById('sb-action-name');
    if (sbAct && sb.defaultActionName) sbAct.value = sb.defaultActionName;

    const vmEn = document.getElementById('vm-enabled-select');
    if (vmEn) vmEn.value = vm.enabled ? 'true' : 'false';
    const vmKey = document.getElementById('vm-apikey-input');
    if (vmKey && vm.apiKey) vmKey.value = vm.apiKey;
    const vmVoice = document.getElementById('vm-voice-select');
    if (vmVoice && vm.activeVoice) vmVoice.value = vm.activeVoice;
  }

  const iftttEl = document.getElementById('ifttt-presets-list');
  if (iftttEl && populateInputs) {
    iftttEl.innerHTML = presets.map((p, idx) => `
      <div class="loyalty-row" style="flex-wrap:wrap; gap:6px;">
        <div style="min-width:180px; font-weight:700; font-size:12px;">${esc(p.name)}</div>
        <input type="text" class="form-input ifttt-url-in" data-idx="${idx}" value="${esc(p.url || '')}" placeholder="https://maker.ifttt.com/trigger/.../with/key/..." style="flex:1; min-width:180px; margin-bottom:0; padding:5px 8px; font-size:11px;">
        <button type="button" class="btn-sm success" onclick="testIftttPreset('${esc(p.id)}')">▶ Tes</button>
      </div>
    `).join('');
  }
}

window.testIftttPreset = async (presetId) => {
  const res = await api('POST', '/api/integrations/ifttt/trigger', { presetId });
  if (res.ok) {
    toast(res.message || `Webhook IFTTT "${res.preset}" berhasil dipicu!`, 'success');
  } else {
    toast(res.error || 'Gagal memicu IFTTT webhook', 'error');
  }
};

document.getElementById('btn-sb-save')?.addEventListener('click', async () => {
  const enabled = document.getElementById('sb-enabled-select')?.value === 'true';
  const url = document.getElementById('sb-url-input')?.value.trim() || 'ws://127.0.0.1:8080/';
  const defaultActionName = document.getElementById('sb-action-name')?.value.trim() || 'AgivaTikTokEvent';
  const res = await api('PUT', '/api/integrations/streamerbot', { enabled, url, defaultActionName });
  if (res.status) {
    streamerBotState = res.status;
    renderStreamerBotAndVoicemodSection(false);
    toast('Konfigurasi Streamer.bot disimpan!', 'success');
  }
});

document.getElementById('btn-sb-test')?.addEventListener('click', async () => {
  const actionName = document.getElementById('sb-action-name')?.value.trim() || 'AgivaTikTokEvent';
  const res = await api('POST', '/api/integrations/streamerbot/test', { actionName });
  toast(
    res.sent
      ? `DoAction "${actionName}" dikirim ke Streamer.bot (:8080)!`
      : `Payload DoAction "${actionName}" (14 variabel) disiapkan (Streamer.bot WS belum aktif).`,
    res.sent ? 'success' : 'info'
  );
});

document.getElementById('btn-vm-save')?.addEventListener('click', async () => {
  const enabled = document.getElementById('vm-enabled-select')?.value === 'true';
  const apiKey = document.getElementById('vm-apikey-input')?.value.trim() || 'agiva-voicemod-key';
  const res = await api('PUT', '/api/integrations/voicemod', { enabled, apiKey });
  if (res.voicemod) {
    if (!integrationsState) integrationsState = {};
    integrationsState.voicemod = res.voicemod;
    renderStreamerBotAndVoicemodSection(false);
    toast('Pengaturan Voicemod Control API disimpan!', 'success');
  }
});

document.getElementById('btn-vm-apply-voice')?.addEventListener('click', async () => {
  const voice = document.getElementById('vm-voice-select')?.value || 'nofx';
  const res = await api('POST', '/api/integrations/voicemod/action', { type: 'loadVoice', value: voice });
  toast(`Voicemod voice diubah ke: ${voice}${res.sent ? '' : ' (Mode Pratinjau)'}`, 'success');
});

document.getElementById('btn-vm-toggle-hearmyself')?.addEventListener('click', async () => {
  await api('POST', '/api/integrations/voicemod/action', { type: 'toggleHearMyVoice' });
  toast('Toggle Hear Myself dikirim ke Voicemod!', 'info');
});

document.getElementById('btn-ifttt-save')?.addEventListener('click', async () => {
  const presets = (integrationsState?.iftttPresets || []).map((p, idx) => {
    const inp = document.querySelector(`.ifttt-url-in[data-idx="${idx}"]`);
    const url = inp ? inp.value.trim() : p.url;
    return { ...p, url, enabled: Boolean(url) };
  });
  const res = await api('PUT', '/api/integrations/ifttt', { presets });
  if (res.presets) {
    if (!integrationsState) integrationsState = {};
    integrationsState.iftttPresets = res.presets;
    toast('Preset Webhook IFTTT / Smart Home disimpan!', 'success');
  }
});

// ─── Compact Pure-JS ISO QR Code SVG Generator (Offline, Version 1–6 Byte Mode, ECC-L) ──
const QR_CAP_L = [0, 17, 32, 53, 78, 106, 134];
const QR_EC_CODEWORDS_L = [0, 7, 10, 15, 20, 26, 18];
const QR_BLOCKS_L = [0, 1, 1, 1, 1, 1, 2];
const QR_ALIGN_POS = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

function qrGfMul(a, b, exp, log) {
  return (a === 0 || b === 0) ? 0 : exp[(log[a] + log[b]) % 255];
}

function qrReedSolomon(data, ecLen) {
  const exp = new Uint8Array(512);
  const log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];

  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= qrGfMul(gen[j], exp[i], exp, log);
    }
    gen = next;
  }

  const msg = new Uint8Array(data.length + ecLen);
  msg.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= qrGfMul(gen[j], coef, exp, log);
      }
    }
  }
  return msg.slice(data.length);
}

function generateQrSvg(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  let ver = 1;
  while (ver <= 6 && bytes.length > QR_CAP_L[ver]) ver++;
  if (ver > 6) return `<div style="color:#000;font-size:10px;text-align:center;padding:8px;">URL terlalu panjang untuk QR</div>`;

  const size = 17 + ver * 4;
  const ecPerBlock = QR_EC_CODEWORDS_L[ver];
  const numBlocks = QR_BLOCKS_L[ver];
  const totalDataBytes = QR_CAP_L[ver] + 2;

  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (const b of bytes) pushBits(b, 8);
  for (let i = 0; i < 4 && bits.length < totalDataBytes * 8; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCw = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    dataCw.push(byte);
  }
  const pads = [0xec, 0x11];
  let padIdx = 0;
  while (dataCw.length < totalDataBytes) {
    dataCw.push(pads[padIdx++ % 2]);
  }

  const blockSize = Math.floor(totalDataBytes / numBlocks);
  const dataBlocks = [];
  const ecBlocks = [];
  for (let b = 0; b < numBlocks; b++) {
    const slice = Uint8Array.from(dataCw.slice(b * blockSize, (b + 1) * blockSize));
    dataBlocks.push(slice);
    ecBlocks.push(qrReedSolomon(slice, ecPerBlock));
  }

  const finalCw = [];
  for (let i = 0; i < blockSize; i++) {
    for (let b = 0; b < numBlocks; b++) finalCw.push(dataBlocks[b][i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < numBlocks; b++) finalCw.push(ecBlocks[b][i]);
  }

  const grid = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const placeFinder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r, cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                   (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                   (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        grid[rr][cc] = on ? 1 : 0;
        reserved[rr][cc] = 1;
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  const align = QR_ALIGN_POS[ver];
  if (align.length > 0) {
    for (const r of align) {
      for (const c of align) {
        if (reserved[r][c]) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            grid[r + dr][c + dc] = on ? 1 : 0;
            reserved[r + dr][c + dc] = 1;
          }
        }
      }
    }
  }

  for (let i = 8; i < size - 8; i++) {
    grid[6][i] = grid[i][6] = (i % 2 === 0) ? 1 : 0;
    reserved[6][i] = reserved[i][6] = 1;
  }

  for (let i = 0; i < 9; i++) {
    if (i !== 6) { reserved[8][i] = 1; reserved[i][8] = 1; }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = 1;
    reserved[size - 1 - i][8] = 1;
  }
  grid[size - 8][8] = 1;
  reserved[size - 8][8] = 1;

  const streamBits = [];
  for (const cw of finalCw) {
    for (let i = 7; i >= 0; i--) streamBits.push((cw >> i) & 1);
  }

  let bitPtr = 0;
  let upward = true;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? (size - 1 - step) : step;
      for (let dx = 0; dx < 2; dx++) {
        const cc = col - dx;
        if (!reserved[row][cc]) {
          const bit = bitPtr < streamBits.length ? streamBits[bitPtr++] : 0;
          const masked = ((row + cc) % 2 === 0) ? (bit ^ 1) : bit;
          grid[row][cc] = masked;
        }
      }
    }
    upward = !upward;
  }

  // Format bits for ECC-L (01) + Mask 0 (000) -> 0x77c4
  const fmt = 0x77c4;
  const fBits = [];
  for (let i = 0; i < 15; i++) fBits.push((fmt >> i) & 1);
  const fCoords1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
  for (let i = 0; i < 15; i++) {
    grid[fCoords1[i][0]][fCoords1[i][1]] = fBits[14 - i];
  }
  for (let i = 0; i < 7; i++) grid[size - 1 - i][8] = fBits[14 - i];
  for (let i = 7; i < 15; i++) grid[8][size - 15 + i] = fBits[14 - i];

  let rects = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === 1) {
        rects += `<rect x="${c}" y="${r}" width="1" height="1"/>`;
      }
    }
  }
  return `<svg viewBox="-1 -1 ${size + 2} ${size + 2}" width="152" height="152" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><rect x="-1" y="-1" width="${size + 2}" height="${size + 2}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

function renderLanRemoteSection(populateInputs = true) {
  const lan = integrationsState?.lanRemote || { enabled: true, pin: '2486' };
  const urls = integrationsState?.lanUrls || [`${location.origin}/remote`];

  const badge = document.getElementById('lan-remote-badge');
  if (badge) {
    badge.textContent = lan.enabled ? 'ACTIVE' : 'OFF';
    badge.style.background = lan.enabled ? '#55efc4' : '#dfe6e9';
  }

  if (populateInputs) {
    const enEl = document.getElementById('lan-remote-enabled');
    if (enEl) enEl.value = lan.enabled ? 'true' : 'false';
    const pinEl = document.getElementById('lan-remote-pin');
    if (pinEl) pinEl.value = lan.pin || '2486';
  }

  const primaryUrl = urls[0] || `${location.origin}/remote`;
  const qrUrlWithPin = `${primaryUrl}?pin=${encodeURIComponent(lan.pin || '2486')}`;

  const urlsBox = document.getElementById('lan-remote-urls');
  if (urlsBox) {
    urlsBox.innerHTML = urls.map(u => `<div>🔗 <a href="${esc(u)}?pin=${encodeURIComponent(lan.pin || '')}" target="_blank" style="color:var(--accent-blue);font-weight:700;">${esc(u)}</a> (PIN: <code>${esc(lan.pin || '2486')}</code>)</div>`).join('');
  }

  const qrBox = document.getElementById('lan-qr-box');
  if (qrBox) {
    qrBox.innerHTML = generateQrSvg(qrUrlWithPin);
  }
  const qrCap = document.getElementById('lan-qr-caption');
  if (qrCap) {
    qrCap.textContent = `PIN: ${lan.pin || '2486'}`;
  }
}

document.getElementById('btn-lan-save')?.addEventListener('click', async () => {
  const enabled = document.getElementById('lan-remote-enabled')?.value === 'true';
  const pin = document.getElementById('lan-remote-pin')?.value.trim() || '2486';
  const res = await api('PUT', '/api/remote/config', { enabled, pin });
  if (res.success) {
    if (!integrationsState) integrationsState = {};
    integrationsState.lanRemote = res.lanRemote;
    integrationsState.lanUrls = res.urls;
    renderLanRemoteSection(true);
    toast('Pengaturan Mobile LAN Remote & QR Code diperbarui!', 'success');
  }
});

document.getElementById('btn-lan-regen')?.addEventListener('click', async () => {
  const res = await api('PUT', '/api/remote/config', { regenerate: true });
  if (res.success) {
    if (!integrationsState) integrationsState = {};
    integrationsState.lanRemote = res.lanRemote;
    integrationsState.lanUrls = res.urls;
    renderLanRemoteSection(true);
    toast(`PIN baru dibuat: ${res.lanRemote?.pin}`, 'success');
  }
});

// ─── Full Config Backup & Restore (.agiva-backup.json) ───
document.getElementById('btn-export-full-backup')?.addEventListener('click', () => {
  window.open('/api/backup/export', '_blank');
  toast('Mengunduh file Full Backup (.agiva-backup.json)...', 'success');
});

document.getElementById('input-import-full-backup')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const bundle = JSON.parse(text);
    const res = await api('POST', '/api/backup/import', bundle);
    if (res.success) {
      toast(res.message || 'Full Backup berhasil dipulihkan!', 'success');
      setTimeout(() => location.reload(), 900);
    } else {
      toast(res.error || 'Gagal memulihkan file backup', 'error');
    }
  } catch (err) {
    toast('File backup rusak atau bukan JSON valid: ' + err.message, 'error');
  }
  e.target.value = '';
});

// ─── Global Search & Command Palette (Ctrl+K) ────────────
function buildCommandPaletteItems(query = '') {
  const q = String(query || '').toLowerCase().trim();
  const items = [];

  // 1. Navigation Tabs
  const tabs = [
    { id: 'dashboard', title: '📊 Buka Tab: Dashboard Utama' },
    { id: 'configurator', title: '⚙️ Buka Tab: Actions & Triggers Configurator' },
    { id: 'tts', title: '🔊 Buka Tab: TTS Bahasa Indonesia & Soundboard' },
    { id: 'widgets', title: '🎡 Buka Tab: Stream Widgets & Multi-Screen Overlay' },
    { id: 'loyalty', title: '💎 Buka Tab: Loyalty Points, Chatbot & Interval Timers' },
    { id: 'effects', title: '✨ Buka Tab: Effects Library' },
    { id: 'integrations', title: '🔌 Buka Tab: OBS, Ports, Spotify, Streamer.bot & Mobile QR' },
    { id: 'gifts', title: '🎁 Buka Tab: TikTok Gifts Data' },
    { id: 'events', title: '📋 Buka Tab: Live Events Log' },
    { id: 'settings', title: '🔧 Buka Tab: Settings, Backup & Auto Update' }
  ];
  for (const t of tabs) {
    items.push({
      badge: 'TAB',
      title: t.title,
      sub: `Navigasi cepat ke tab ${t.id}`,
      run: () => {
        document.querySelector(`.nav-item[data-tab="${t.id}"]`)?.click();
      }
    });
  }

  // 2. Quick System Actions
  items.push(
    {
      badge: 'COMMAND',
      title: '⏯️ Pause / Resume Semua Interaksi (Master Switch)',
      sub: 'Toggle Master Switch On/Off',
      run: () => document.getElementById('sw-all')?.click()
    },
    {
      badge: 'COMMAND',
      title: '🧪 Buka Live Event Simulator',
      sub: 'Simulasi Gift, Like, Chat, Follow & Donasi tanpa harus Live',
      run: () => openModal('modal-simulator')
    },
    {
      badge: 'COMMAND',
      title: '🔄 Cek & Pasang Auto Update Aplikasi',
      sub: 'Buka modal Auto Update GitHub Releases',
      run: () => document.getElementById('btn-topbar-update')?.click()
    },
    {
      badge: 'COMMAND',
      title: '📥 Export Full Config Backup (.agiva-backup.json)',
      sub: 'Unduh seluruh konfigurasi game, actions, widgets & TTS',
      run: () => document.getElementById('btn-export-full-backup')?.click()
    }
  );

  // 3. Active Game Effects
  const activeGame = games.find(g => g.id === appState.activeGameId);
  if (activeGame && activeGame.effects) {
    for (const [effId, ef] of Object.entries(activeGame.effects)) {
      items.push({
        badge: 'EFFECT',
        title: `⚡ Test Efek: ${ef.label || effId}`,
        sub: `Game: ${activeGame.name} · ID: ${effId} · Driver: ${ef.driver || 'ws-mod'}`,
        run: async () => {
          await api('POST', '/api/test-effect', { effectId: effId });
          toast(`Test efek "${ef.label || effId}" dikirim!`, 'success');
        }
      });
    }
  }

  // 4. Reusable Multi-Step Actions
  for (const act of (actionsData?.actions || [])) {
    items.push({
      badge: 'ACTION',
      title: `🎬 Jalankan Action: ${act.name}`,
      sub: `${(act.steps || []).length} steps · ID: ${act.id}`,
      run: async () => {
        await api('POST', `/api/actions/${encodeURIComponent(act.id)}/test`);
        toast(`Action "${act.name}" dijalankan!`, 'success');
      }
    });
  }

  // 5. Soundboard Sounds
  for (const snd of (ttsSoundConfig?.soundboard?.items || [])) {
    items.push({
      badge: 'SOUND',
      title: `🔊 Putar Soundboard: ${snd.name || snd.id}`,
      sub: `File: ${snd.file || snd.id}`,
      run: async () => {
        await api('POST', '/api/soundboard/play', { id: snd.id });
        toast(`Memutar suara "${snd.name || snd.id}"`, 'info');
      }
    });
  }

  if (!q) return items.slice(0, 25);
  return items.filter(it =>
    it.title.toLowerCase().includes(q) ||
    it.sub.toLowerCase().includes(q) ||
    it.badge.toLowerCase().includes(q)
  ).slice(0, 30);
}

let currentPaletteItems = [];

function renderCommandPaletteResults(query = '') {
  const box = document.getElementById('cmd-palette-results');
  if (!box) return;
  currentPaletteItems = buildCommandPaletteItems(query);
  if (currentPaletteItems.length === 0) {
    box.innerHTML = '<div class="form-hint" style="padding:12px;text-align:center;">Tidak ada hasil yang cocok.</div>';
    return;
  }
  box.innerHTML = currentPaletteItems.map((it, idx) => `
    <div class="loyalty-row" style="cursor:pointer;" onclick="runCommandPaletteItem(${idx})">
      <div>
        <span class="badge-pill" style="margin-right:6px;">${esc(it.badge)}</span>
        <strong>${esc(it.title)}</strong>
        <div class="form-hint">${esc(it.sub)}</div>
      </div>
      <span class="btn-sm primary">↵ Jalankan</span>
    </div>
  `).join('');
}

window.runCommandPaletteItem = (idx) => {
  const item = currentPaletteItems[idx];
  closeModal('modal-cmd-palette');
  if (item && typeof item.run === 'function') {
    item.run();
  }
};

function openCommandPalette() {
  openModal('modal-cmd-palette');
  const inp = document.getElementById('cmd-palette-input');
  if (inp) {
    inp.value = '';
    renderCommandPaletteResults('');
    setTimeout(() => inp.focus(), 40);
  }
}

document.getElementById('btn-open-cmd-palette')?.addEventListener('click', openCommandPalette);

document.getElementById('cmd-palette-input')?.addEventListener('input', (e) => {
  renderCommandPaletteResults(e.target.value);
});

document.getElementById('cmd-palette-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && currentPaletteItems.length > 0) {
    e.preventDefault();
    window.runCommandPaletteItem(0);
  } else if (e.key === 'Escape') {
    closeModal('modal-cmd-palette');
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const modal = document.getElementById('modal-cmd-palette');
    if (modal && modal.style.display === 'flex') {
      closeModal('modal-cmd-palette');
    } else {
      openCommandPalette();
    }
  }
});

init();
