'use strict';

const root = document.getElementById('overlay-root');
const screenStage = document.getElementById('screen-alert-stage');
const widgetStage = document.getElementById('widget-stage');

const urlParams = new URLSearchParams(window.location.search);
const activeWidget = (urlParams.get('widget') || '').toLowerCase(); // '' | 'timer' | 'wheel' | 'goal' | 'counter' | 'leaderboard' | 'poll' | 'giveaway' | 'hud'
const activeScreen = Number(urlParams.get('screen') || 1);
const goalTypeParam = (urlParams.get('type') || 'likes').toLowerCase();
const muteAudioParam = urlParams.get('mute') === '1';

const alertQueue = [];
const MAX_VISIBLE = 4;
const DISPLAY_DURATION = 4000;

let widgetsState = null;
let wheelRotationDeg = 0;
let hudEvents = [];
let hudLocked = false;
let currentViewers = 0;

// ─── Audio & Free Indonesian TTS Queue ────────────────────
const ttsQueue = [];
let isPlayingTts = false;
const activeAudioElements = new Set();

function enqueueTts(msg) {
  if (muteAudioParam) return;
  // Only play TTS on default overlay or screen 1 (avoid echo if multiple widget sources are open)
  if (activeWidget && activeWidget !== 'hud') return;
  if (activeScreen !== 1) return;

  ttsQueue.push(msg);
  processTtsQueue();
}

function processTtsQueue() {
  if (isPlayingTts || ttsQueue.length === 0) return;
  const item = ttsQueue.shift();
  isPlayingTts = true;

  const audio = new Audio(item.audioUrl);
  audio.volume = Math.max(0, Math.min(1, Number(item.volume ?? 0.9)));
  audio.playbackRate = Math.max(0.5, Math.min(2.0, Number(item.rate ?? 1.0)));
  activeAudioElements.add(audio);

  const finish = () => {
    activeAudioElements.delete(audio);
    isPlayingTts = false;
    setTimeout(processTtsQueue, 150);
  };

  audio.onended = finish;
  audio.onerror = () => {
    // Fallback to browser Web Speech API if Google TTS stream fails/offline
    activeAudioElements.delete(audio);
    if ('speechSynthesis' in window) {
      try {
        const u = new SpeechSynthesisUtterance(item.text);
        u.lang = item.lang === 'en' ? 'en-US' : item.lang === 'ja' ? 'ja-JP' : 'id-ID';
        u.rate = Number(item.rate || 1.0);
        u.pitch = Number(item.pitch || 1.0);
        u.volume = Number(item.volume ?? 0.9);
        u.onend = finish;
        u.onerror = finish;
        window.speechSynthesis.speak(u);
        return;
      } catch {}
    }
    finish();
  };

  audio.play().catch(() => {
    audio.onerror();
  });
}

function playSoundPayload(msg) {
  if (muteAudioParam) return;
  if (activeWidget) return;
  if (msg.screen && Number(msg.screen) !== activeScreen) return;

  if (!msg.overlap) {
    for (const a of activeAudioElements) {
      if (a.dataset?.isSoundboard === '1') {
        try { a.pause(); } catch {}
        activeAudioElements.delete(a);
      }
    }
  }

  const audio = new Audio(msg.file);
  audio.dataset.isSoundboard = '1';
  audio.volume = Math.max(0, Math.min(1, Number(msg.volume ?? 0.85)));
  activeAudioElements.add(audio);
  audio.onended = () => activeAudioElements.delete(audio);
  audio.onerror = () => activeAudioElements.delete(audio);
  audio.play().catch(() => activeAudioElements.delete(audio));
}

function stopAllAudio() {
  ttsQueue.length = 0;
  isPlayingTts = false;
  for (const a of activeAudioElements) {
    try { a.pause(); } catch {}
  }
  activeAudioElements.clear();
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch {}
  }
}

// ─── Multi-Screen Media Alert ─────────────────────────────
function showScreenAlert(msg) {
  if (activeWidget) return;
  if (Number(msg.screen || 1) !== activeScreen) return;
  if (!screenStage) return;

  if (msg.soundUrl && !muteAudioParam) {
    playSoundPayload({ file: msg.soundUrl, volume: 0.85, overlap: true, screen: activeScreen });
  }

  const card = document.createElement('div');
  card.className = 'screen-alert-card';
  let mediaHtml = '';
  if (msg.mediaUrl) {
    const lower = msg.mediaUrl.toLowerCase();
    if (lower.endsWith('.mp4') || lower.endsWith('.webm')) {
      mediaHtml = `<video src="${esc(msg.mediaUrl)}" autoplay muted playsinline></video>`;
    } else {
      mediaHtml = `<img src="${esc(msg.mediaUrl)}" alt="">`;
    }
  }
  card.innerHTML = `
    ${mediaHtml}
    <div class="screen-alert-title">${esc(msg.title || 'STREAM ALERT')}</div>
    ${msg.subtitle ? `<div class="screen-alert-sub">${esc(msg.subtitle)}</div>` : ''}
  `;
  screenStage.innerHTML = '';
  screenStage.appendChild(card);

  setTimeout(() => {
    if (card.parentNode) card.remove();
  }, Number(msg.durationMs) || 4000);
}

// ─── Interactive Widget Renderers ─────────────────────────
function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  return [h, m, rem].map(v => String(v).padStart(2, '0')).join(':');
}

function renderActiveWidget() {
  if (!activeWidget || !widgetStage) return;
  if (root) root.style.display = 'none';
  if (!widgetsState && activeWidget !== 'hud') return;

  if (activeWidget === 'timer') {
    const t = widgetsState.timer || {};
    widgetStage.innerHTML = `
      <div class="w-card">
        <div class="w-title">${esc(t.title || '⏳ SUBATHON TIMER')}</div>
        <div class="w-timer-digits" id="w-timer-digits">${fmtTime(t.remainingSec)}</div>
        <div class="w-timer-badge" id="w-timer-badge">${t.isRunning ? '🟢 RUNNING' : '⏸️ PAUSED'}</div>
      </div>
    `;
  } else if (activeWidget === 'goal') {
    const g = widgetsState.goals?.[goalTypeParam] || widgetsState.goals?.likes || { title: 'Target Goal', current: 0, target: 100 };
    const pct = Math.min(100, Math.round(((g.current || 0) / Math.max(1, g.target || 100)) * 100));
    widgetStage.innerHTML = `
      <div class="w-card" style="min-width: 380px;">
        <div class="w-goal-header">
          <span>${esc(g.title)}</span>
          <span>${Number(g.current || 0).toLocaleString('id-ID')} / ${Number(g.target || 100).toLocaleString('id-ID')} (${pct}%)</span>
        </div>
        <div class="w-goal-track">
          <div class="w-goal-fill" style="width: ${pct}%;"></div>
        </div>
      </div>
    `;
  } else if (activeWidget === 'counter') {
    const c = widgetsState.counter || { title: '⚔️ REKOR TANTANGAN', wins: 0, loses: 0 };
    widgetStage.innerHTML = `
      <div class="w-card">
        <div class="w-title">${esc(c.title || '⚔️ WIN / LOSE COUNTER')}</div>
        <div class="w-counter-row">
          <div class="w-counter-box">
            <div class="w-counter-num win">${c.wins || 0}</div>
            <div class="w-counter-lbl">WIN</div>
          </div>
          <div style="font-size:24px;color:#475569;font-weight:900;">VS</div>
          <div class="w-counter-box">
            <div class="w-counter-num lose">${c.loses || 0}</div>
            <div class="w-counter-lbl">LOSE</div>
          </div>
        </div>
      </div>
    `;
  } else if (activeWidget === 'wheel') {
    const w = widgetsState.wheel || { title: '🎡 RODA GACHA', segments: [] };
    widgetStage.innerHTML = `
      <div class="w-card" style="min-width: 410px;">
        <div class="w-title">${esc(w.title || '🎡 RODA GACHA STREAMER')}</div>
        <div class="w-wheel-wrap">
          <div class="w-wheel-pointer">🔻</div>
          <canvas id="w-wheel-canvas" width="360" height="360" style="transition: transform 4.2s cubic-bezier(0.15, 0.85, 0.25, 1); transform: rotate(${wheelRotationDeg}deg);"></canvas>
        </div>
        <div class="w-wheel-winner" id="w-wheel-winner">
          ${w.lastWinner ? `🎉 Pemenang Terakhir: ${esc(w.lastWinner.label)}` : 'Menunggu putaran gift...'}
        </div>
      </div>
    `;
    drawWheelCanvas(w.segments || []);
  } else if (activeWidget === 'leaderboard') {
    const lb = widgetsState.leaderboard || { topGifters: [], topLikers: [] };
    const gifters = (lb.topGifters || []).slice(0, 5);
    widgetStage.innerHTML = `
      <div class="w-card" style="min-width: 340px;">
        <div class="w-title">👑 TOP GIFTER LIVE</div>
        <div class="w-list">
          ${gifters.length === 0
            ? '<div class="w-list-item" style="justify-content:center;color:#64748b;">Belum ada gifter</div>'
            : gifters.map((g, i) => `
              <div class="w-list-item">
                <span>#${i + 1} ${esc(g.user)}</span>
                <span style="color:#facc15;">${g.coins} 💎</span>
              </div>
            `).join('')}
        </div>
      </div>
    `;
  } else if (activeWidget === 'poll') {
    const p = widgetsState.poll || { question: 'Live Voting', options: [] };
    const totalVotes = (p.options || []).reduce((s, o) => s + (o.votes || 0), 0);
    widgetStage.innerHTML = `
      <div class="w-card" style="min-width: 380px;">
        <div class="w-title">${p.active ? '📊 VOTING AKTIF (KETIK ANGKA DI CHAT)' : '📊 HASIL VOTING'}</div>
        <div style="font-size:15px;font-weight:800;text-align:center;margin-bottom:8px;">${esc(p.question)}</div>
        <div class="w-list">
          ${(p.options || []).map(o => {
            const pct = totalVotes > 0 ? Math.round(((o.votes || 0) / totalVotes) * 100) : 0;
            return `
              <div class="w-list-item w-poll-bar">
                <div class="w-poll-bar-fill" style="width:${pct}%;"></div>
                <span>[${esc(o.key)}] ${esc(o.label)}</span>
                <span>${o.votes || 0} (${pct}%)</span>
              </div>
            `;
          }).join('')}
        </div>
        ${p.winner ? `<div style="margin-top:8px;text-align:center;color:#22c55e;font-weight:800;">🏆 Pemenang: ${esc(p.winner.label)}</div>` : ''}
      </div>
    `;
  } else if (activeWidget === 'giveaway') {
    const gw = widgetsState.giveaway || { title: '🎁 GIVEAWAY', keyword: '!ikut', participants: [] };
    widgetStage.innerHTML = `
      <div class="w-card" style="min-width: 350px; text-align:center;">
        <div class="w-title">${esc(gw.title)}</div>
        <div style="font-size:13px;color:#cbd5e1;margin-bottom:8px;">Ketik <b style="color:#38bdf8;">${esc(gw.keyword)}</b> di chat untuk ikut!</div>
        <div style="font-size:28px;font-weight:900;color:#a855f7;">${(gw.participants || []).length} Peserta</div>
        ${gw.winner ? `<div style="margin-top:10px;padding:8px;background:rgba(34,197,94,0.2);border:1px solid #22c55e;border-radius:8px;font-weight:800;color:#4ade80;">🎉 Pemenang: @${esc(gw.winner.user)}</div>` : ''}
      </div>
    `;
  } else if (activeWidget === 'hud') {
    renderFloatingHud();
  }
}

function drawWheelCanvas(segments) {
  const canvas = document.getElementById('w-wheel-canvas');
  if (!canvas || !segments || segments.length === 0) return;
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = cx - 8;
  const sliceAngle = (2 * Math.PI) / segments.length;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  segments.forEach((seg, i) => {
    // Draw starting from -90 deg (top pointer)
    const startAngle = -Math.PI / 2 + i * sliceAngle;
    const endAngle = startAngle + sliceAngle;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = seg.color || '#6366f1';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.stroke();

    // Text label
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(startAngle + sliceAngle / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px Inter, sans-serif';
    ctx.fillText(String(seg.label || '').slice(0, 18), radius - 16, 5);
    ctx.restore();
  });
}

function animateWheelSpin(spinMsg) {
  if (activeWidget !== 'wheel') return;
  const segs = spinMsg.segments || widgetsState?.wheel?.segments || [];
  if (segs.length === 0) return;

  const sliceDeg = 360 / segs.length;
  const targetCenterDeg = spinMsg.winnerIndex * sliceDeg + sliceDeg / 2;
  const extraSpins = 360 * 5;
  wheelRotationDeg = wheelRotationDeg + extraSpins + (360 - (wheelRotationDeg % 360)) + (360 - targetCenterDeg);

  const canvas = document.getElementById('w-wheel-canvas');
  if (canvas) {
    canvas.style.transform = `rotate(${wheelRotationDeg}deg)`;
  }
  setTimeout(() => {
    const winEl = document.getElementById('w-wheel-winner');
    if (winEl && spinMsg.winner) {
      winEl.textContent = `🎉 Hasil: ${spinMsg.winner.label} (oleh ${spinMsg.user})`;
    }
  }, spinMsg.spinDurationMs || 4200);
}

function renderFloatingHud() {
  if (!widgetStage) return;
  widgetStage.style.padding = '0';
  widgetStage.innerHTML = `
    <div class="hud-window">
      <div class="hud-header">
        <span>🎮 AGIVA HUD · 👁️ ${currentViewers}</span>
        <div style="display:flex;gap:6px;">
          <button class="hud-btn" id="btn-hud-lock" onclick="toggleHudLock()">${hudLocked ? '🔒 Locked' : '🔓 Click-Through'}</button>
        </div>
      </div>
      <div class="hud-feed" id="hud-feed-list">
        ${hudEvents.length === 0
          ? '<div style="color:#64748b;text-align:center;margin-top:20px;">Menunggu chat & gift masuk...</div>'
          : hudEvents.map(ev => `<div class="hud-feed-row"><span class="hud-feed-user">@${esc(ev.user)}</span><span>${esc(ev.text)}</span></div>`).join('')}
      </div>
    </div>
  `;
}

window.toggleHudLock = async function () {
  hudLocked = !hudLocked;
  try {
    await fetch('/api/desktop/hud', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'lock', locked: hudLocked })
    });
  } catch {}
  renderFloatingHud();
};

// ─── Initial Fetch & WebSocket ────────────────────────────
async function loadInitialWidgets() {
  try {
    const res = await fetch('/api/widgets');
    widgetsState = await res.json();
    renderActiveWidget();
  } catch {}
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'event') {
        pushAlert(msg.event);
        if (activeWidget === 'hud') {
          const ev = msg.event;
          const desc = ev.type === 'gift' ? `🎁 mengirim ${ev.giftName} (${ev.coins}💎)`
            : ev.type === 'chat' ? `💬 ${ev.comment}`
            : ev.type === 'donation' ? `💸 donasi Rp ${Number(ev.amount || 0).toLocaleString('id-ID')}: ${ev.comment || ''}`
            : ev.type === 'follow' ? `👤 mulai follow!`
            : ev.type === 'like' ? `❤️ +${ev.count} like` : ev.type;
          hudEvents.unshift({ user: ev.user, text: desc });
          if (hudEvents.length > 40) hudEvents.pop();
          renderFloatingHud();
        }
      }
      if (msg.type === 'stats' && msg.roomStats) {
        currentViewers = msg.roomStats.viewers || 0;
      }
      if (msg.type === 'effect') pushEffectAlert(msg);
      if (msg.type === 'tts_speak') enqueueTts(msg);
      if (msg.type === 'sound_play') playSoundPayload(msg);
      if (msg.type === 'audio_stop_all') stopAllAudio();
      if (msg.type === 'screen_alert') showScreenAlert(msg);
      if (msg.type === 'widgets_update') {
        widgetsState = msg.state;
        renderActiveWidget();
      }
      if (msg.type === 'timer_tick' && widgetsState?.timer) {
        widgetsState.timer.remainingSec = msg.remainingSec;
        widgetsState.timer.isRunning = msg.isRunning;
        const dig = document.getElementById('w-timer-digits');
        const bdg = document.getElementById('w-timer-badge');
        if (dig) dig.textContent = fmtTime(msg.remainingSec);
        if (bdg) bdg.textContent = msg.isRunning ? '🟢 RUNNING' : '⏸️ PAUSED';
      }
      if (msg.type === 'wheel_spin') {
        animateWheelSpin(msg);
      }
    } catch {}
  };

  ws.onclose = () => setTimeout(connectWS, 3000);
}

// ─── Default Alert Types ──────────────────────────────────
const configs = {
  gift: (ev) => ({
    icon: '🎁',
    type: ev.coins >= 5000 ? 'chaos' : 'gift',
    title: `${ev.user}`,
    sub: `sent ${ev.giftName} · ${ev.coins}💎`,
    tag: 'GIFT',
    duration: ev.coins >= 5000 ? 6000 : DISPLAY_DURATION
  }),
  donation: (ev) => ({
    icon: '💸',
    type: 'gift',
    title: `${ev.user} (${ev.platform || 'Donasi'})`,
    sub: `Rp ${Number(ev.amount || 0).toLocaleString('id-ID')} · ${ev.comment || ''}`,
    tag: 'DONASI',
    duration: 5000
  }),
  follow: (ev) => ({
    icon: '👤', type: 'follow',
    title: ev.user, sub: 'is now following!',
    tag: 'FOLLOW', duration: DISPLAY_DURATION
  }),
  member: (ev) => ({
    icon: '👋', type: 'member',
    title: ev.user, sub: 'joined the stream',
    tag: 'JOIN', duration: 3000
  }),
  like: (ev) => ({
    icon: '❤️', type: 'like',
    title: ev.user, sub: `sent ${ev.count} likes`,
    tag: 'LIKES', duration: 2500
  })
};

function pushAlert(ev) {
  if (activeWidget || activeScreen !== 1) return;
  const cfg = configs[ev.type]?.(ev);
  if (!cfg) return;
  alertQueue.push(cfg);
  processQueue();
}

function pushEffectAlert(msg) {
  if (activeWidget || activeScreen !== 1) return;
  if (!msg.effectId || msg.effectId === 'hud_notify') return;
  alertQueue.push({
    icon: '⚡',
    type: 'effect',
    title: msg.label || msg.effectId,
    sub: `by ${msg.user}`,
    tag: 'EFFECT',
    duration: 3000
  });
  processQueue();
}

function processQueue() {
  if (!root) return;
  const visible = root.querySelectorAll('.alert:not(.exit)').length;
  if (visible >= MAX_VISIBLE || alertQueue.length === 0) return;

  const cfg = alertQueue.shift();
  showAlert(cfg);
}

function showAlert(cfg) {
  const div = document.createElement('div');
  div.className = `alert ${cfg.type}`;
  div.style.setProperty('--duration', `${cfg.duration}ms`);
  div.innerHTML = `
    <span class="alert-icon">${cfg.icon}</span>
    <div class="alert-body">
      <div class="alert-title">${esc(cfg.title)}</div>
      <div class="alert-sub">${esc(cfg.sub)}</div>
    </div>
    <span class="alert-tag">${cfg.tag}</span>
  `;

  root.insertBefore(div, root.firstChild);

  setTimeout(() => {
    div.classList.add('exit');
    setTimeout(() => {
      div.remove();
      processQueue();
    }, 350);
  }, cfg.duration);
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

loadInitialWidgets();
connectWS();
