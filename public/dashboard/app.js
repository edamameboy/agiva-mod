/* ─────────────────────────────────────────────────────────
   Dashboard App JS — TikTok Live Game Bridge
   ───────────────────────────────────────────────────────── */
'use strict';

// ─── Theme Setup ──────────────────────────────────────────
const themeBtn = document.getElementById('btn-theme');
if (localStorage.getItem('theme') === 'dark') {
  document.body.setAttribute('data-theme', 'dark');
}
themeBtn.addEventListener('click', () => {
  if (document.body.getAttribute('data-theme') === 'dark') {
    document.body.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
  } else {
    document.body.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  }
});

const API = '';  // same origin

// ─── WebSocket ────────────────────────────────────────────
let ws = null;
let wsReconnectTimer = null;

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    console.log('[WS] Connected to bridge');
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
  currentUsername: '',
  roomStats: { viewers: 0, likes: 0, gifts: 0, followers: 0 },
  queueStatus: { queued: 0 },
  modClients: 0
};

let config = null;
let games = [];
let events = [];
let giftsData = [];

// ─── Server Message Handler ───────────────────────────────
function handleServerMsg(msg) {
  switch (msg.type) {
    case 'state':
      appState = { ...appState, ...msg };
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
    case 'error':
      toast(msg.message, 'error');
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
    document.getElementById(`tab-${tab}`).classList.add('active');
    document.getElementById('page-title').textContent = {
      dashboard: 'Dashboard',
      configurator: 'Gift & Event Configurator',
      effects: 'Effects Library',
      events: 'Live Events',
      settings: 'Settings'
    }[tab] || tab;

    if (tab === 'configurator') renderConfigurator();
    if (tab === 'effects') renderEffectsLib();
    if (tab === 'events') renderEventsTable();
    if (tab === 'settings') renderSettings();
    if (tab === 'gifts') renderGiftsTab();
  });
});

// ─── TikTok Connect ───────────────────────────────────────
document.getElementById('btn-connect').addEventListener('click', async () => {
  const username = document.getElementById('username-input').value.trim().replace('@', '');
  if (!username) return toast('Masukkan username TikTok', 'error');

  const btn = document.getElementById('btn-connect');
  btn.textContent = 'Connecting...'; btn.disabled = true;

  try {
    const res = await api('POST', '/api/connect', { username });
    if (res.success) toast(`Connected to @${username}!`, 'success');
    else toast(res.error || 'Failed to connect', 'error');
  } catch (e) {
    toast(e.message, 'error');
  }
  btn.textContent = 'Connect'; btn.disabled = false;
});

document.getElementById('btn-disconnect').addEventListener('click', async () => {
  await api('POST', '/api/disconnect');
  toast('Disconnected', 'success');
});

function renderConnectionState() {
  const { isConnected, currentUsername, modClients } = appState;
  const statusEl = document.getElementById('connect-status');
  const statusLabel = document.getElementById('status-label');
  const form = document.getElementById('connect-form');
  const btnDisc = document.getElementById('btn-disconnect');

  if (isConnected) {
    statusEl.className = 'connect-status connected';
    statusLabel.textContent = `@${currentUsername}`;
    form.style.display = 'none';
    btnDisc.style.display = '';
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

function fmt(n) { if (!n) return '0'; if (n >= 1000) return (n/1000).toFixed(1) + 'k'; return n.toString(); }

// ─── Live Feed ────────────────────────────────────────────
function addFeedItem(ev) {
  const feed = document.getElementById('live-feed');
  const empty = feed.querySelector('.feed-empty');
  if (empty) empty.remove();

  const icons = { gift: '🎁', follow: '👤', member: '👋', like: '❤️' };
  const details = {
    gift: `${ev.giftName} (${ev.coins}💎)`,
    follow: 'followed!',
    member: 'joined the stream',
    like: `sent ${ev.count} likes`
  };

  const div = document.createElement('div');
  div.className = `feed-item ${ev.type}`;
  div.innerHTML = `
    <span class="feed-icon">${icons[ev.type] || '📢'}</span>
    <span class="feed-user">${esc(ev.user)}</span>
    <span class="feed-detail">${details[ev.type] || ''}</span>
    <span class="feed-time">${timeAgo(ev.time)}</span>
  `;
  feed.insertBefore(div, feed.firstChild);
  if (feed.children.length > 50) feed.lastChild.remove();
}

function showActiveEffect(eff) {
  const el = document.getElementById('active-effect');
  el.innerHTML = `<div class="effect-active">
    <div class="effect-name">${esc(eff.label || eff.effectId)}</div>
    <div class="effect-user">triggered by ${esc(eff.user)}</div>
  </div>`;
  setTimeout(() => { el.innerHTML = '<div class="effect-idle">No active effect</div>'; }, 4000);
}

// ─── Queue ────────────────────────────────────────────────
document.getElementById('btn-clear-queue').addEventListener('click', async () => {
  await api('DELETE', '/api/queue');
  document.getElementById('queue-list').innerHTML = '<div class="queue-empty">Queue empty</div>';
  toast('Queue cleared', 'success');
});

// ─── Gifts Data ───────────────────────────────────────────
async function renderGiftsTab() {
  const grid = document.getElementById('gifts-data-grid');
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

document.getElementById('btn-update-gifts').addEventListener('click', async () => {
  const username = document.getElementById('gifts-username-input').value.trim().replace('@', '');
  if (!username) return toast('Masukkan username TikTok', 'error');

  const btn = document.getElementById('btn-update-gifts');
  btn.textContent = 'Updating...'; btn.disabled = true;

  try {
    const res = await api('POST', '/api/gifts/update', { username });
    if (res.success) {
      giftsData = res.gifts;
      renderGiftsTab();
      if (document.getElementById('tab-configurator').classList.contains('active')) {
        renderConfigurator(); // Re-render if we are in configurator
      }
      toast('Berhasil memperbarui data gift!', 'success');
    } else {
      toast(res.error || 'Gagal memperbarui data', 'error');
    }
  } catch (e) {
    toast(e.message, 'error');
  }
  btn.innerHTML = '🔄 Update Gift'; btn.disabled = false;
});

// ─── Game Selector ────────────────────────────────────────
document.getElementById('active-game-badge').addEventListener('click', () => {
  const dd = document.getElementById('game-dropdown');
  dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#game-selector')) {
    document.getElementById('game-dropdown').style.display = 'none';
  }
});

function renderGameSelector(gamesData) {
  games = gamesData;
  const list = document.getElementById('game-list');
  list.innerHTML = '';
  gamesData.forEach(g => {
    const div = document.createElement('div');
    div.className = 'game-option';
    div.innerHTML = `<span>${g.icon}</span><span>${g.name}</span>`;
    div.addEventListener('click', () => {
      document.getElementById('game-icon').textContent = g.icon;
      document.getElementById('game-name').textContent = g.name;
      document.getElementById('game-dropdown').style.display = 'none';
    });
    list.appendChild(div);
  });
  if (gamesData.length > 0) {
    document.getElementById('game-icon').textContent = gamesData[0].icon;
    document.getElementById('game-name').textContent = gamesData[0].name;
  }
}

// ─── Configurator ─────────────────────────────────────────
function renderConfigurator() {
  if (!config) return;
  renderGiftTable();
  renderEventRows();
  renderLikeTable();
}

function getEffectOptions() {
  const options = [];
  for (const game of Object.values(config.games || {})) {
    for (const [id, eff] of Object.entries(game.effects || {})) {
      options.push({ id, label: eff.label });
    }
  }
  return options;
}

function buildEffectSelect(selected, name) {
  const opts = getEffectOptions();
  return `<select class="tier-effect-select" name="${name}">
    ${opts.map(o => `<option value="${o.id}" ${o.id === selected ? 'selected' : ''}>${o.label}</option>`).join('')}
  </select>`;
}

function buildGiftSelect(selected) {
  let selectedGift = giftsData.find(g => String(g.id) === String(selected));
  let displayText = selectedGift ? esc(selectedGift.name) + ' (' + selectedGift.coins + '💎)' : '-- Select Gift --';
  
  return `
    <div class="custom-select-wrap" onclick="toggleGiftSelect(this)">
      <input type="text" class="custom-select-input" placeholder="Search gift..." value="${displayText}" oninput="filterGiftSelect(this, event)">
      <input type="hidden" class="custom-select-value" data-field="giftId" value="${selected || ''}">
      <div class="custom-select-list">
        ${giftsData.map(g => `<div class="custom-select-item" onclick="selectGift(this, '${g.id}', '${esc(g.name).replace(/'/g, "\'")}', ${g.coins})">
          <img src="${esc(g.image)}">
          <span>${esc(g.name)} (${g.coins}💎) - ID: ${g.id}</span>
        </div>`).join('')}
      </div>
    </div>
  `;
}

window.toggleGiftSelect = function(wrap) {
  if (event.target.classList.contains('custom-select-input') && wrap.classList.contains('open')) return;
  document.querySelectorAll('.custom-select-wrap').forEach(el => {
    if (el !== wrap) el.classList.remove('open');
  });
  wrap.classList.toggle('open');
};

window.filterGiftSelect = function(input, e) {
  const wrap = input.closest('.custom-select-wrap');
  if (!wrap.classList.contains('open')) wrap.classList.add('open');
  const term = input.value.toLowerCase();
  const items = wrap.querySelectorAll('.custom-select-item');
  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(term) ? '' : 'none';
  });
};

window.selectGift = function(el, id, name, coins) {
  event.stopPropagation();
  const wrap = el.closest('.custom-select-wrap');
  const input = wrap.querySelector('.custom-select-input');
  const hidden = wrap.querySelector('.custom-select-value');
  
  input.value = name + ' (' + coins + '💎)';
  hidden.value = id;
  wrap.classList.remove('open');
  
  // Reset filter
  const items = wrap.querySelectorAll('.custom-select-item');
  items.forEach(item => item.style.display = '');
};

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.custom-select-wrap')) {
    document.querySelectorAll('.custom-select-wrap').forEach(el => el.classList.remove('open'));
  }
});

function renderGiftTable() {
  const tbody = document.getElementById('gift-rows');
  tbody.innerHTML = '';
  (config.giftMappings || []).forEach((tier, i) => {
    const tr = document.createElement('tr');
    tr.dataset.idx = i;
    tr.innerHTML = `
      <td><input class="tier-label-input" value="${esc(tier.label)}" data-field="label"></td>
      <td>${buildGiftSelect(tier.giftId)}</td>
      <td>${buildEffectSelect(tier.effectId, 'effectId')}</td>
      <td><label class="toggle-switch"><input type="checkbox" ${tier.enabled ? 'checked' : ''}><span class="toggle-slider"></span></label></td>
      <td><button class="btn-sm success" onclick="testEffect('${tier.effectId}', 'gift')">▶ Test</button></td>
      <td><button class="btn-sm danger" onclick="deleteTier(${i})">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderEventRows() {
  const container = document.getElementById('event-rows');
  
  if (!config.socialEvents) {
    config.socialEvents = [];
    if (config.eventMappings?.follow) config.socialEvents.push({ eventType: 'follow', ...config.eventMappings.follow });
  }
  
  const evList = config.socialEvents; // new array structure
  
  const options = ['follow', 'share', 'repost', 'like'];
  
  let html = '<table class="config-table" style="width:100%"><thead><tr><th>Event Type</th><th>Effect</th><th>Enabled</th><th>Test</th><th></th></tr></thead><tbody>';
  
  evList.forEach((ev, i) => {
    html += `<tr>
      <td>
        <select class="tier-label-input" data-field="eventType">
          ${options.map(o => `<option value="${o}" ${o === ev.eventType ? 'selected' : ''}>${o.toUpperCase()}</option>`).join('')}
        </select>
      </td>
      <td>${buildEffectSelect(ev.effectId, 'effectId')}</td>
      <td><label class="toggle-switch"><input type="checkbox" ${ev.enabled ? 'checked' : ''}><span class="toggle-slider"></span></label></td>
      <td><button class="btn-sm success" onclick="testEffect('${ev.effectId}', 'social')">▶ Test</button></td>
      <td><button class="btn-sm danger" onclick="deleteEventRow(${i})">✕</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

window.deleteEventRow = (i) => { config.socialEvents.splice(i, 1); renderEventRows(); };

document.getElementById('btn-add-event')?.addEventListener('click', () => {
  if (!config.socialEvents) config.socialEvents = [];
  config.socialEvents.push({ eventType: 'follow', effectId: 'screen_flash', enabled: true });
  renderEventRows();
});



function renderLikeTable() {
  const tbody = document.getElementById('like-rows');
  tbody.innerHTML = '';
  if (!config.eventMappings) config.eventMappings = {};
  if (!config.eventMappings.like) config.eventMappings.like = { thresholds: [] };
  const thresholds = config.eventMappings.like.thresholds || [];
  thresholds.forEach((t, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="tier-num-input" type="number" value="${t.count}" style="width:80px"></td>
      <td>${buildEffectSelect(t.effectId, 'like_' + i)}</td>
      <td><label class="toggle-switch"><input type="checkbox" ${t.enabled ? 'checked' : ''}><span class="toggle-slider"></span></label></td>
      <td><button class="btn-sm success" onclick="testEffect('${t.effectId}', 'like')">▶ Test</button></td>
      <td><button class="btn-sm danger" onclick="deleteLikeRow(${i})">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
}

window.deleteLikeRow = (i) => {
  config.eventMappings.like.thresholds.splice(i, 1);
  renderLikeTable();
};

document.getElementById('btn-save-config').addEventListener('click', async () => {
  // Collect all form data back into config
  collectGiftTableData();
  collectEventRows();
  collectLikeTable();
  await api('PUT', '/api/config', config);
  toast('Config saved!', 'success');
});

function collectGiftTableData() {
  const rows = document.querySelectorAll('#gift-rows tr');
  config.giftMappings = [];
  rows.forEach((tr, i) => {
    const inputs = tr.querySelectorAll('input[data-field]');
    const select = tr.querySelector('select[data-field="giftId"]');
    const entry = { id: `tier_${i+1}`, enabled: tr.querySelector('input[type=checkbox]').checked };
    inputs.forEach(inp => { entry[inp.dataset.field] = isNaN(inp.value) ? inp.value : Number(inp.value); });
    if (select) {
      entry.giftId = select.value;
    }
    entry.effectId = tr.querySelector('.tier-effect-select').value;
    config.giftMappings.push(entry);
  });
}

function collectEventRows() {
  const rows = document.querySelectorAll('#event-rows tr');
  config.socialEvents = [];
  rows.forEach((tr, i) => {
    if (i === 0 && tr.closest('thead')) return; // skip header
    const typeSelect = tr.querySelector('select[data-field="eventType"]');
    const effectSelect = tr.querySelector('.tier-effect-select');
    const enabled = tr.querySelector('input[type="checkbox"]').checked;
    
    if (typeSelect && effectSelect) {
      config.socialEvents.push({
        eventType: typeSelect.value,
        effectId: effectSelect.value,
        enabled: enabled
      });
    }
  });
}

function collectLikeTable() {
  const rows = document.querySelectorAll('#like-rows tr');
  config.eventMappings.like.thresholds = [];
  rows.forEach((tr, i) => {
    const count = parseInt(tr.querySelector('input[type=number]').value);
    const effectId = tr.querySelector('.tier-effect-select').value;
    const enabled = tr.querySelector('input[type=checkbox]').checked;
    config.eventMappings.like.thresholds.push({ count, effectId, enabled });
  });
}

document.getElementById('btn-add-tier').addEventListener('click', () => {
  config.giftMappings.push({ id: `tier_${Date.now()}`, label: 'New Tier', giftId: null, effectId: 'cam_shake_sm', enabled: true });
  renderGiftTable();
});

document.getElementById('btn-add-threshold').addEventListener('click', () => {
  config.eventMappings.like.thresholds.push({ count: 10, effectId: 'screen_flash', enabled: true });
  renderLikeTable();
});

window.deleteTier = (i) => { config.giftMappings.splice(i, 1); renderGiftTable(); };
window.testEffect = async (effectId, source = 'test') => {
  await api('POST', '/api/test-effect', { effectId, user: 'dashboard-test', source });
  toast(`Testing: ${effectId}`, 'success');
};

// ─── Effects Library ──────────────────────────────────────
function renderEffectsLib(filterCat = 'all') {
  if (!config) return;
  const grid = document.getElementById('effects-grid');
  grid.innerHTML = '';
  const catIcons = { camera: '📷', player: '🏃', minigame: '🎮', world: '🌍', visual: '✨', special: '⚡', ui: '🖥️' };

  for (const game of Object.values(config.games || {})) {
    for (const eff of Object.values(game.effects || {})) {
      if (filterCat !== 'all' && eff.category !== filterCat) continue;
      const card = document.createElement('div');
      card.className = 'effect-card-item';
      card.innerHTML = `
        <div class="ec-icon">${catIcons[eff.category] || '✨'}</div>
        <div class="ec-name">${esc(eff.label)}</div>
        <div class="ec-desc">${esc(eff.description)}</div>
        <div class="ec-meta">
          <span class="ec-cat">${eff.category}</span>
          <span class="ec-dur">${eff.duration ? eff.duration+'ms' : '—'}</span>
        </div>
        <button class="btn-sm success mt" style="width:100%;margin-top:10px" onclick="testEffect('${eff.id}')">▶ Test Effect</button>
      `;
      grid.appendChild(card);
    }
  }
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === filterCat);
  });
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => renderEffectsLib(btn.dataset.cat));
});

// ─── Events Table ─────────────────────────────────────────
function renderEventsTable() {
  const tbody = document.getElementById('events-body');
  tbody.innerHTML = '';
  events.slice(0, 100).forEach(ev => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-family:var(--font-mono);font-size:11px">${new Date(ev.time).toLocaleTimeString()}</td>
      <td><span class="type-badge ${ev.type}">${ev.type}</span></td>
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
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td style="font-family:var(--font-mono);font-size:11px">${new Date(ev.time).toLocaleTimeString()}</td>
    <td><span class="type-badge ${ev.type}">${ev.type}</span></td>
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
  return '—';
}

// ─── Settings ─────────────────────────────────────────────
function renderSettings() {
  const gamesList = document.getElementById('settings-games');
  gamesList.innerHTML = '';
  games.forEach(g => {
    const div = document.createElement('div');
    div.style = 'display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--border);';
    div.innerHTML = `<span style="font-size:20px">${g.icon}</span><div><div style="font-weight:600;font-size:13px">${esc(g.name)}</div><div style="font-size:11px;color:var(--text-muted)">${g.id}</div></div>`;
    gamesList.appendChild(div);
  });
}

document.getElementById('btn-show-key').addEventListener('click', () => {
  const inp = document.getElementById('api-key-input');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

document.getElementById('btn-save-key').addEventListener('click', async () => {
  const key = document.getElementById('api-key-input').value;
  await api('POST', '/api/apikey', { key });
  toast('API Key saved!', 'success');
});

document.getElementById('btn-show-session').addEventListener('click', () => {
  const inp = document.getElementById('session-id-input');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

document.getElementById('btn-save-session').addEventListener('click', async () => {
  const session = document.getElementById('session-id-input').value;
  await api('POST', '/api/sessionid', { session });
  toast('Session ID saved!', 'success');
});

document.getElementById('btn-save-webhook').addEventListener('click', async () => {
  const url = document.getElementById('webhook-url').value;
  const secret = document.getElementById('webhook-secret').value;
  await api('POST', '/api/webhook', { url, secret });
  toast('Webhook saved!', 'success');
});

document.getElementById('btn-save-queue').addEventListener('click', async () => {
  config.queueSettings.maxQueueSize = parseInt(document.getElementById('queue-size').value);
  config.queueSettings.minDelayBetweenEffects = parseInt(document.getElementById('queue-delay').value);
  config.queueSettings.dropOnFull = document.getElementById('queue-drop').value === 'true';
  await api('PUT', '/api/config', config);
  toast('Queue settings saved!', 'success');
});

// ─── API Helper ───────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(path, {
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
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${esc(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── Helpers ──────────────────────────────────────────────
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s/60)}m ago`;
}

// ─── Init ─────────────────────────────────────────────────
async function init() {
  // Load status
  const status = await api('GET', '/api/status');
  appState = { ...appState, ...status };
  renderConnectionState();
  renderStats();

  // Load config
  config = await api('GET', '/api/config');

  // Load games
  const gamesData = await api('GET', '/api/games');
  renderGameSelector(gamesData);

  // Load gifts data
  giftsData = await api('GET', '/api/gifts');

  // Load recent events
  events = await api('GET', '/api/events');
  events.forEach(ev => addFeedItem(ev));

  // Pre-fill queue settings
  if (config?.queueSettings) {
    const qs = config.queueSettings;
    const qsEl = document.getElementById('queue-size');
    const qdEl = document.getElementById('queue-delay');
    const dropEl = document.getElementById('queue-drop');
    if (qsEl) qsEl.value = qs.maxQueueSize || 10;
    if (qdEl) qdEl.value = qs.minDelayBetweenEffects || 500;
    if (dropEl) dropEl.value = qs.dropOnFull ? 'true' : 'false';
  }

  // Pre-fill webhook URL and secret
  if (appState?.webhookUrl) {
    const hookEl = document.getElementById('webhook-url');
    if (hookEl) hookEl.value = appState.webhookUrl;
  }
  if (appState?.webhookSecret) {
    const secEl = document.getElementById('webhook-secret');
    if (secEl) secEl.value = appState.webhookSecret;
  }

  // Pre-fill Username and Auto-Connect if available
  if (appState?.currentUsername) {
    const userEl = document.getElementById('username-input');
    if (userEl) userEl.value = appState.currentUsername;
    if (!appState.isConnected) {
      setTimeout(() => {
        document.getElementById('btn-connect')?.click();
      }, 500);
    }
  }

  // Pre-fill API Key
  if (appState?.eulerstreamKey) {
    const keyEl = document.getElementById('api-key-input');
    if (keyEl) keyEl.value = appState.eulerstreamKey;
  }

  // Pre-fill Session ID
  if (appState?.tiktokSessionId) {
    const sessEl = document.getElementById('session-id-input');
    if (sessEl) sessEl.value = appState.tiktokSessionId;
  }

  // Connect WS
  connectWS();

  // Auto-poll queue status
  setInterval(async () => {
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
  }, 1500);
}

init();
