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

// ─── Server Message Handler ───────────────────────────────
function handleServerMsg(msg) {
  switch (msg.type) {
    case 'state':
      appState = { ...appState, ...msg };
      if (msg.masterSwitches) renderMasterSwitches(msg.masterSwitches);
      if (msg.ttsSoundConfig) { ttsSoundConfig = msg.ttsSoundConfig; renderTtsTab(); }
      if (msg.widgetState) { widgetState = msg.widgetState; renderWidgetsTab(); }
      if (msg.compatPorts) { compatPortsStatus = msg.compatPorts; renderCompatPorts(); }
      renderConnectionState();
      renderStats();
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
      stopDashboardTts();
      break;
    case 'soundboard_play':
      handleDashboardSoundPlay(msg.payload || msg);
      break;
    case 'widget_update':
    case 'widgets_update':
      widgetState = msg.state || msg.payload?.fullState || widgetState;
      renderWidgetsTab();
      break;
    case 'timer_tick':
      if (widgetState && widgetState.timer) {
        widgetState.timer.remainingSec = msg.remainingSec;
        widgetState.timer.isRunning = msg.isRunning;
        renderWidgetsTab();
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
    case 'update_available':
      if (msg.update) handleUpdateAvailable(msg.update);
      break;
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
      integrations: 'Port Bridge, OBS, Donasi & Analytics',
      effects: 'Effects Library',
      gifts: 'TikTok Gifts Data',
      events: 'Live Events Log',
      settings: 'Settings & Drivers'
    }[tab] || tab;

    if (tab === 'configurator') renderConfigurator();
    if (tab === 'tts') renderTtsTab();
    if (tab === 'widgets') renderWidgetsTab();
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
    member: '👋',
    like: '❤️',
    share: '🔄',
    repost: '🔁',
    chat: '💬',
    donation: '💸'
  };
  const details = {
    gift: `${ev.giftName} (${ev.coins}💎)`,
    follow: 'followed the stream!',
    member: 'joined the stream',
    like: `sent ${ev.count} likes`,
    share: 'shared the stream!',
    repost: 'reposted the stream!',
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
    <option value="__random__" ${selected === '__random__' ? 'selected' : ''}>🎲 ACAK / GACHA (Semua Efek Game)</option>
    ${opts.map(o => `<option value="${esc(o.id)}" ${o.id === selected ? 'selected' : ''}>${esc(o.label)} (${esc(o.id)})</option>`).join('')}
  </select>`;
}

function buildChainCell(rowObj = {}) {
  const sounds = ttsSoundConfig?.soundboard?.items || [];
  const soundId = rowObj.soundId || '';
  const spinWheel = Boolean(rowObj.spinWheel);
  const screen = Number(rowObj.overlayScreen) || 1;
  return `
    <div class="chain-mini-wrap">
      <select class="tier-label-input" data-field="soundId" title="Putar Soundboard" style="max-width:120px">
        <option value="">🔇 Tanpa Sound</option>
        ${sounds.map(s => `<option value="${esc(s.id)}" ${s.id === soundId ? 'selected' : ''}>🎵 ${esc(s.name)}</option>`).join('')}
      </select>
      <select class="tier-label-input" data-field="overlayScreen" title="Target Layar Overlay" style="max-width:85px">
        <option value="1" ${screen === 1 ? 'selected' : ''}>Screen 1</option>
        <option value="2" ${screen === 2 ? 'selected' : ''}>Screen 2</option>
        <option value="3" ${screen === 3 ? 'selected' : ''}>Screen 3</option>
        <option value="4" ${screen === 4 ? 'selected' : ''}>Screen 4</option>
      </select>
      <label class="checkbox-label" style="margin:0;font-size:11px" title="Ikut memutar Spin Wheel">
        <input type="checkbox" data-field="spinWheel" ${spinWheel ? 'checked' : ''}> 🎡 Spin
      </label>
    </div>
  `;
}

function buildRoleCell(cmdObj = {}) {
  const role = cmdObj.requiredRole || 'everyone';
  const specUsers = Array.isArray(cmdObj.specificUsers)
    ? cmdObj.specificUsers.join(', ')
    : (cmdObj.specificUsers || '');
  return `
    <div class="chain-mini-wrap">
      <select class="tier-label-input" data-field="requiredRole" style="max-width:135px">
        <option value="everyone" ${role === 'everyone' ? 'selected' : ''}>Everyone (Semua)</option>
        <option value="follower" ${role === 'follower' ? 'selected' : ''}>Follower</option>
        <option value="subscriber" ${role === 'subscriber' ? 'selected' : ''}>Subscriber</option>
        <option value="moderator" ${role === 'moderator' ? 'selected' : ''}>Moderator</option>
        <option value="min_gifter" ${role === 'min_gifter' ? 'selected' : ''}>Min. Gifter</option>
        <option value="specific_users" ${role === 'specific_users' ? 'selected' : ''}>Specific Users</option>
      </select>
      <input class="tier-label-input" data-field="specificUsers" value="${esc(specUsers)}" placeholder="@user1, @user2" title="Whitelist Specific Users (pisahkan koma)" style="max-width:130px">
    </div>
  `;
}

function buildGiftSelect(selected) {
  const selectedGift = giftsData.find(g => String(g.id) === String(selected));
  const displayText = selectedGift
    ? `${esc(selectedGift.name)} (${selectedGift.coins}💎)`
    : (selected ? `Gift ID: ${esc(selected)}` : '-- Pilih Gift --');

  return `
    <div class="custom-select-wrap" onclick="toggleGiftSelect(this, event)">
      <input type="text" class="custom-select-input" placeholder="Cari gift..." value="${displayText}" oninput="filterGiftSelect(this)">
      <input type="hidden" class="custom-select-value" data-field="giftId" value="${selected || ''}">
      <div class="custom-select-list">
        ${giftsData.map(g => `<div class="custom-select-item" onclick="selectGift(this, '${g.id}', '${esc(g.name).replace(/'/g, "\\'")}', ${g.coins}, event)">
          <img src="${esc(g.image)}" alt="">
          <span>${esc(g.name)} (${g.coins}💎) - ID: ${g.id}</span>
        </div>`).join('')}
      </div>
    </div>
  `;
}

window.toggleGiftSelect = function(wrap, ev) {
  if (ev && ev.target.classList.contains('custom-select-input') && wrap.classList.contains('open')) return;
  document.querySelectorAll('.custom-select-wrap').forEach(el => {
    if (el !== wrap) el.classList.remove('open');
  });
  wrap.classList.toggle('open');
};

window.filterGiftSelect = function(input) {
  const wrap = input.closest('.custom-select-wrap');
  if (!wrap.classList.contains('open')) wrap.classList.add('open');
  const term = input.value.toLowerCase();
  const items = wrap.querySelectorAll('.custom-select-item');
  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(term) ? '' : 'none';
  });
};

window.selectGift = function(el, id, name, coins, ev) {
  if (ev) ev.stopPropagation();
  const wrap = el.closest('.custom-select-wrap');
  const input = wrap.querySelector('.custom-select-input');
  const hidden = wrap.querySelector('.custom-select-value');

  input.value = `${name} (${coins}💎)`;
  hidden.value = id;
  wrap.classList.remove('open');

  const items = wrap.querySelectorAll('.custom-select-item');
  items.forEach(item => { item.style.display = ''; });
};

document.addEventListener('click', (e) => {
  if (!e.target.closest('.custom-select-wrap')) {
    document.querySelectorAll('.custom-select-wrap').forEach(el => el.classList.remove('open'));
  }
});

// 1. Specific Gift Table
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
      <td><label class="checkbox-label" style="margin:0"><input type="checkbox" data-field="multiplyByRepeat" ${tier.multiplyByRepeat ? 'checked' : ''}> xCombo</label></td>
      <td>${buildChainCell(tier)}</td>
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

// 3. Chat Command Table
function renderChatCmdTable() {
  const tbody = document.getElementById('chatcmd-rows');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!config.chatCommands) config.chatCommands = [];
  config.chatCommands.forEach((cmd, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="tier-label-input" data-field="command" value="${esc(cmd.command || '!aksi')}" placeholder="!lompat" style="max-width:110px"></td>
      <td>${buildRoleCell(cmd)}</td>
      <td>
        <div class="chain-mini-wrap">
          <input class="tier-num-input" type="number" data-field="cooldown" value="${cmd.cooldown ?? 10}" min="0" style="width:62px" title="Global Cooldown (detik)">
          <input class="tier-num-input" type="number" data-field="userCooldown" value="${cmd.userCooldown ?? 30}" min="0" style="width:62px" title="Cooldown Per-User (detik)">
        </div>
      </td>
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

// Test current row's selected effect dynamically
window.testRowEffect = (btnEl, source) => {
  if (btnEl) {
    btnEl.disabled = true;
    setTimeout(() => { btnEl.disabled = false; }, 400);
  }
  const tr = btnEl?.closest('tr');
  const sel = tr?.querySelector('.tier-effect-select');
  const effectId = sel ? sel.value : getFirstEffectId();
  window.testEffect(effectId, source);
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
    const multiplyByRepeat = tr.querySelector('input[data-field="multiplyByRepeat"]')?.checked ?? false;
    const soundId = tr.querySelector('select[data-field="soundId"]')?.value || '';
    const overlayScreen = parseInt(tr.querySelector('select[data-field="overlayScreen"]')?.value) || 1;
    const spinWheel = tr.querySelector('input[data-field="spinWheel"]')?.checked ?? false;
    const enabled = tr.querySelector('input[data-field="enabled"]')?.checked ?? true;
    const rawGiftId = giftIdInput ? giftIdInput.value : '';
    config.giftMappings.push({
      id: `tier_${i + 1}`,
      label: labelInput ? labelInput.value : `Tier ${i + 1}`,
      giftId: rawGiftId && !isNaN(rawGiftId) ? Number(rawGiftId) : rawGiftId,
      effectId: effectSelect ? effectSelect.value : getFirstEffectId(),
      multiplyByRepeat,
      soundId,
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
    const overlayScreen = parseInt(tr.querySelector('select[data-field="overlayScreen"]')?.value) || 1;
    const spinWheel = tr.querySelector('input[data-field="spinWheel"]')?.checked ?? false;
    const enabled = tr.querySelector('input[data-field="enabled"]')?.checked ?? true;
    config.coinTiers.push({ id: `coin_${i + 1}`, minCoins, maxCoins, effectId, soundId, overlayScreen, spinWheel, enabled });
  });
}

function collectChatCmdData() {
  const rows = document.querySelectorAll('#chatcmd-rows tr');
  config.chatCommands = [];
  rows.forEach(tr => {
    const command = tr.querySelector('input[data-field="command"]')?.value.trim() || '!aksi';
    const requiredRole = tr.querySelector('select[data-field="requiredRole"]')?.value || 'everyone';
    const rawSpec = tr.querySelector('input[data-field="specificUsers"]')?.value || '';
    const specificUsers = rawSpec.split(',').map(s => s.trim()).filter(Boolean);
    const cooldown = parseInt(tr.querySelector('input[data-field="cooldown"]')?.value) || 0;
    const userCooldown = parseInt(tr.querySelector('input[data-field="userCooldown"]')?.value) || 0;
    const effectId = tr.querySelector('.tier-effect-select')?.value || getFirstEffectId();
    const enabled = tr.querySelector('input[data-field="enabled"]')?.checked ?? true;
    config.chatCommands.push({ command, requiredRole, specificUsers, cooldown, userCooldown, effectId, enabled });
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
window.testEffect = async (effectId, source = 'test') => {
  if (isTestingEffect) return;
  isTestingEffect = true;
  try {
    const res = await api('POST', '/api/test-effect', { effectId, user: 'dashboard-test', source });
    if (res.success) {
      toast(`Testing: ${effectId} [${(res.driver || 'ws-mod').toUpperCase()}]`, 'success');
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
function renderEventsTable() {
  const tbody = document.getElementById('events-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  events.slice(0, 100).forEach(ev => {
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
let currentDashboardTtsAudio = null;

function handleDashboardTtsSpeak(payload) {
  if (!payload || !payload.text) return;
  const playLocal = document.getElementById('tts-play-in-dashboard')?.checked ?? true;
  if (!playLocal) return;

  stopDashboardTts();
  const audio = new Audio(payload.audioUrl);
  audio.volume = Math.max(0, Math.min(1, (payload.volume || 100) / 100));
  audio.playbackRate = Math.max(0.5, Math.min(2.0, payload.speed || 1.0));
  currentDashboardTtsAudio = audio;
  audio.onerror = () => {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(payload.text);
      u.lang = payload.lang || 'id-ID';
      u.rate = payload.speed || 1.0;
      window.speechSynthesis.speak(u);
    }
  };
  audio.play().catch(() => {});
}

function stopDashboardTts() {
  if (currentDashboardTtsAudio) {
    try { currentDashboardTtsAudio.pause(); } catch {}
    currentDashboardTtsAudio = null;
  }
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch {}
  }
}

function handleDashboardSoundPlay(payload) {
  if (!payload || !payload.url) return;
  const playLocal = document.getElementById('tts-play-in-dashboard')?.checked ?? true;
  if (!playLocal) return;
  const audio = new Audio(payload.url);
  audio.volume = Math.max(0, Math.min(1, (payload.volume || 100) / 100));
  audio.play().catch(() => {});
}

function renderTtsTab() {
  if (!ttsSoundConfig) return;
  const tts = ttsSoundConfig.tts || {};
  const sb = ttsSoundConfig.soundboard || {};

  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = Boolean(v); };

  setVal('tts-enabled-select', tts.enabled !== false ? 'true' : 'false');
  setVal('tts-lang-select', tts.lang || 'id-ID');
  setVal('tts-volume-range', tts.volume ?? 100);
  setVal('tts-speed-range', tts.speed ?? 1.0);
  const volLabel = document.getElementById('tts-vol-val');
  if (volLabel) volLabel.textContent = tts.volume ?? 100;
  const spdLabel = document.getElementById('tts-speed-val');
  if (spdLabel) spdLabel.textContent = tts.speed ?? 1.0;

  setVal('tts-role-select', tts.allowedRole || 'everyone');
  setVal('tts-prefix-input', tts.commentTriggerMode === 'prefix' ? (tts.commentPrefix || '!tts') : '');
  setVal('tts-specific-users', (tts.specificUsers || []).join(', '));
  setVal('tts-min-coins', tts.minGifterCoins ?? 0);
  setVal('tts-cooldown-sec', tts.userCooldownSec ?? 8);
  setChk('tts-read-chat', tts.readChat !== false);
  setChk('tts-read-gift', tts.readGifts !== false);
  setChk('tts-read-donation', tts.readDonations !== false);
  setVal('tts-template-gift', tts.giftTemplate || 'Terima kasih {user} atas {gift} sebanyak {repeat} kali');
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
          ${!item.id.startsWith('sfx_') ? `<button type="button" class="btn-sm danger" onclick="deleteSoundItem('${esc(item.id)}')">✕</button>` : ''}
        </div>
      `;
      grid.appendChild(div);
    });
  }
}

document.getElementById('tts-volume-range')?.addEventListener('input', (e) => {
  const el = document.getElementById('tts-vol-val');
  if (el) el.textContent = e.target.value;
});
document.getElementById('tts-speed-range')?.addEventListener('input', (e) => {
  const el = document.getElementById('tts-speed-val');
  if (el) el.textContent = e.target.value;
});

document.getElementById('btn-tts-save')?.addEventListener('click', async () => {
  const prefixRaw = document.getElementById('tts-prefix-input')?.value.trim() || '';
  const specUsers = (document.getElementById('tts-specific-users')?.value || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const badwords = (document.getElementById('tts-badwords')?.value || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const payload = {
    tts: {
      enabled: document.getElementById('tts-enabled-select')?.value === 'true',
      lang: document.getElementById('tts-lang-select')?.value || 'id-ID',
      volume: Number(document.getElementById('tts-volume-range')?.value ?? 100),
      speed: Number(document.getElementById('tts-speed-range')?.value ?? 1.0),
      allowedRole: document.getElementById('tts-role-select')?.value || 'everyone',
      specificUsers: specUsers,
      minGifterCoins: Number(document.getElementById('tts-min-coins')?.value || 0),
      userCooldownSec: Number(document.getElementById('tts-cooldown-sec')?.value || 8),
      commentTriggerMode: prefixRaw ? 'prefix' : 'all',
      commentPrefix: prefixRaw || '!tts',
      readChat: document.getElementById('tts-read-chat')?.checked ?? true,
      readGifts: document.getElementById('tts-read-gift')?.checked ?? true,
      readDonations: document.getElementById('tts-read-donation')?.checked ?? true,
      giftTemplate: document.getElementById('tts-template-gift')?.value || '',
      badwords
    }
  };
  const res = await api('PUT', '/api/tts-sound/config', payload);
  if (res.success) {
    ttsSoundConfig = res.config;
    toast('Pengaturan TTS Bahasa Indonesia disimpan!', 'success');
  }
});

document.getElementById('btn-tts-test')?.addEventListener('click', async () => {
  const text = document.getElementById('tts-test-input')?.value.trim() || 'Halo streamer Agiva!';
  const lang = document.getElementById('tts-lang-select')?.value || 'id-ID';
  await api('POST', '/api/tts/speak', { text, lang, user: 'Dashboard-Test' });
  toast('Memutar suara TTS Bahasa Indonesia...', 'success');
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
      fileName: file.name,
      base64Data: reader.result,
      volume: 100
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

function renderWidgetsTab() {
  if (!widgetState) return;
  const timer = widgetState.timer || widgetState.subathonTimer || {};
  const rem = Number(timer.remainingSec ?? timer.remainingSeconds ?? 0);
  const h = String(Math.floor(rem / 3600)).padStart(2, '0');
  const m = String(Math.floor((rem % 3600) / 60)).padStart(2, '0');
  const s = String(rem % 60).padStart(2, '0');
  const isRun = Boolean(timer.isRunning ?? timer.running);
  const timerPreview = document.getElementById('widget-timer-preview');
  if (timerPreview) timerPreview.textContent = `${h}:${m}:${s} ${isRun ? '🟢' : '⏸️'}`;

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

  const wheelObj = widgetState.wheel || widgetState.spinWheel;
  const segInput = document.getElementById('wheel-segments-input');
  if (segInput && !segInput.dataset.edited && wheelObj?.segments) {
    segInput.value = wheelObj.segments
      .map(seg => `${seg.label} | ${seg.effectId || ''} | ${seg.color || '#ff6b35'}`)
      .join('\n');
  }
}

document.getElementById('wheel-segments-input')?.addEventListener('input', (e) => {
  e.target.dataset.edited = 'true';
});

document.getElementById('btn-timer-start')?.addEventListener('click', () => api('POST', '/api/widgets/timer', { action: 'start' }));
document.getElementById('btn-timer-pause')?.addEventListener('click', () => api('POST', '/api/widgets/timer', { action: 'pause' }));
document.getElementById('btn-timer-add60')?.addEventListener('click', () => api('POST', '/api/widgets/timer', { action: 'add', seconds: 60 }));
document.getElementById('btn-timer-add300')?.addEventListener('click', () => api('POST', '/api/widgets/timer', { action: 'add', seconds: 300 }));
document.getElementById('btn-timer-reset')?.addEventListener('click', () => api('POST', '/api/widgets/timer', { action: 'reset', seconds: 3600 }));
document.getElementById('btn-timer-save')?.addEventListener('click', async () => {
  const title = document.getElementById('timer-title-input')?.value || 'SUBATHON TIMER';
  const secondsPerCoin = Number(document.getElementById('timer-sec-per-coin')?.value ?? 2);
  await api('POST', '/api/widgets/timer', { action: 'config', title, secondsPerCoin });
  toast('Konfigurasi Subathon Timer disimpan!', 'success');
});

document.getElementById('btn-wheel-spin')?.addEventListener('click', async () => {
  const res = await api('POST', '/api/widgets/wheel/spin', { triggeredBy: 'Streamer' });
  if (res.success && res.result?.winner) {
    toast(`🎡 Roda Berputar! Hasil: ${res.result.winner.label}`, 'success');
  }
});

document.getElementById('btn-wheel-save')?.addEventListener('click', async () => {
  const raw = document.getElementById('wheel-segments-input')?.value || '';
  const segments = raw.split('\n').map((line, idx) => {
    const parts = line.split('|').map(p => p.trim());
    if (!parts[0]) return null;
    return {
      id: `seg_${idx + 1}`,
      label: parts[0],
      effectId: parts[1] || '',
      color: parts[2] || ['#ff6b35', '#ef4444', '#3b82f6', '#a855f7', '#10b981', '#eab308'][idx % 6]
    };
  }).filter(Boolean);
  await api('PUT', '/api/widgets/wheel', { segments });
  toast(`Disimpan ${segments.length} segmen Spin Wheel!`, 'success');
});

document.getElementById('btn-goal-save')?.addEventListener('click', async () => {
  const title = document.getElementById('goal-coins-title')?.value || 'Target Koin';
  const target = Number(document.getElementById('goal-coins-target')?.value || 1000);
  await api('POST', '/api/widgets/goals', { type: 'coins', title, target });
  toast('Target Goal Bar diperbarui!', 'success');
});
document.getElementById('btn-goal-reset')?.addEventListener('click', async () => {
  await api('POST', '/api/widgets/goals', { type: 'coins', reset: true });
  toast('Progress Goal di-reset ke 0!', 'info');
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
  ['wsRaw62024', 'wsSocket62025', 'httpApi62030'].forEach(key => {
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
    httpApi62030: { enabled: document.getElementById('compat-port-62030')?.checked ?? true }
  };
  const res = await api('PUT', '/api/compat-ports', { enabled, ports });
  if (res.success) {
    compatPortsStatus = res.status;
    renderCompatPorts();
    toast('Status Port Kompatibilitas (:62024/:62025/:62030) berhasil diperbarui!', 'success');
  }
});

document.getElementById('btn-save-donation-config')?.addEventListener('click', async () => {
  const idrPerCoin = Number(document.getElementById('donation-idr-per-coin')?.value || 250);
  const saweriaEnabled = document.getElementById('saweria-enabled-select')?.value === 'true';
  const streamKey = document.getElementById('saweria-stream-key')?.value.trim() || '';
  const res = await api('PUT', '/api/donations/config', {
    idrPerCoin,
    saweria: { enabled: saweriaEnabled, streamKey }
  });
  if (res.success) {
    const badge = document.getElementById('saweria-socket-badge');
    if (badge) badge.textContent = res.status?.saweria?.connected ? 'CONNECTED' : (saweriaEnabled ? 'CONNECTING' : 'OFF');
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
  if (badge) {
    badge.textContent = st.connected ? 'CONNECTED' : 'DISCONNECTED';
    badge.style.background = st.connected ? '#55efc4' : '#dfe6e9';
  }
}

document.getElementById('btn-obs-connect')?.addEventListener('click', async () => {
  const url = document.getElementById('obs-url-input')?.value.trim() || 'ws://127.0.0.1:4455';
  const password = document.getElementById('obs-password-input')?.value || '';
  const res = await api('POST', '/api/obs/connect', { enabled: true, url, password });
  renderObsStatus(res.status);
  toast(res.status?.connected ? 'Terhubung ke OBS Studio WebSocket!' : 'Mencoba menghubungkan ke OBS Studio...', 'info');
});

document.getElementById('btn-obs-disconnect')?.addEventListener('click', async () => {
  const res = await api('POST', '/api/obs/disconnect');
  renderObsStatus(res.status);
  toast('Koneksi OBS Studio diputuskan.', 'info');
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

async function renderIntegrationsTab() {
  try {
    compatPortsStatus = await api('GET', '/api/compat-ports');
    renderCompatPorts();
    const don = await api('GET', '/api/donations/config');
    if (don?.config) {
      const idrEl = document.getElementById('donation-idr-per-coin');
      if (idrEl) idrEl.value = don.config.idrPerCoin || 250;
      const sawEn = document.getElementById('saweria-enabled-select');
      if (sawEn) sawEn.value = don.config.saweria?.enabled ? 'true' : 'false';
      const sawKey = document.getElementById('saweria-stream-key');
      if (sawKey && don.config.saweria?.streamKey) sawKey.value = don.config.saweria.streamKey;
    }
    const obsSt = await api('GET', '/api/obs/status');
    renderObsStatus(obsSt);
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
    setTxt('an-total-idr', 'Rp ' + (totals.donationIdr ?? 0).toLocaleString('id-ID'));
    setTxt('an-total-gifts', (totals.giftsCount ?? totals.gifts ?? 0).toLocaleString('id-ID'));
    setTxt('an-peak-viewers', (cur.peakViewers ?? appState.roomStats?.viewers ?? 0).toLocaleString('id-ID'));

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

async function checkAppUpdates(force = false) {
  const iconEl = document.getElementById('update-status-icon');
  const titleEl = document.getElementById('update-status-title');
  const descEl = document.getElementById('update-status-desc');
  const btnCheck = document.getElementById('btn-check-updates');

  if (iconEl) iconEl.textContent = '⏳';
  if (titleEl) titleEl.textContent = 'Memeriksa Pembaruan...';
  if (descEl) descEl.textContent = 'Menghubungi server GitHub...';
  if (btnCheck) btnCheck.disabled = true;

  try {
    const res = await api('GET', `/api/update/check${force ? '?force=1' : ''}`);
    currentUpdateInfo = res;
    if (btnCheck) btnCheck.disabled = false;

    if (res && res.hasUpdate) {
      handleUpdateAvailable(res);
      toast(`Update baru tersedia: v${res.latestVersion}!`, 'info');
    } else {
      if (iconEl) iconEl.textContent = '✅';
      if (titleEl) titleEl.textContent = 'Aplikasi Up-to-Date';
      if (descEl) descEl.textContent = res.releaseNotes || `Anda menggunakan versi terbaru (v${res.currentVersion || '1.3.0'}).`;
      const banner = document.getElementById('update-banner');
      if (banner) banner.style.display = 'none';
      const topbarBtn = document.getElementById('btn-topbar-update');
      if (topbarBtn) topbarBtn.style.display = 'none';
    }
  } catch (err) {
    if (btnCheck) btnCheck.disabled = false;
    if (iconEl) iconEl.textContent = '⚠️';
    if (titleEl) titleEl.textContent = 'Pengecekan Gagal';
    if (descEl) descEl.textContent = err.message || 'Tidak dapat terhubung ke GitHub.';
  }
}

function handleUpdateAvailable(update) {
  currentUpdateInfo = update;
  const topbarBtn = document.getElementById('btn-topbar-update');
  const topbarText = document.getElementById('topbar-update-text');
  if (topbarBtn && topbarText) {
    topbarText.textContent = `✨ Update v${update.latestVersion}`;
    topbarBtn.style.display = 'inline-flex';
    topbarBtn.onclick = () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      const settingsNav = document.querySelector('.nav-item[data-tab="settings"]');
      if (settingsNav) settingsNav.classList.add('active');
      const settingsTab = document.getElementById('tab-settings');
      if (settingsTab) settingsTab.classList.add('active');
      document.getElementById('card-app-updates')?.scrollIntoView({ behavior: 'smooth' });
    };
  }

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
  renderConnectionState();
  renderStats();
  renderMasterSwitches(appState.masterSwitches);
  renderTtsTab();
  renderWidgetsTab();
  renderCompatPorts();

  // Populate App Info in Settings Card
  const verBadge = document.getElementById('app-version-badge');
  const curVer = document.getElementById('info-current-ver');
  const appMode = document.getElementById('info-app-mode');
  const storagePath = document.getElementById('info-storage-path');
  const presetsFolderInput = document.getElementById('info-presets-folder');
  const curVerStr = `v${status.appVersion || '1.3.0'}`;

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

  // Wire App Update Buttons
  document.getElementById('btn-check-updates')?.addEventListener('click', () => checkAppUpdates(true));
  document.getElementById('btn-visit-github')?.addEventListener('click', () => {
    openExternalUrl(status.repoUrl || 'https://github.com/edamameboy/agiva-mod');
  });

  config = await api('GET', '/api/config');
  const gamesData = await api('GET', '/api/games');
  renderGameSelector(gamesData);

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

init();
