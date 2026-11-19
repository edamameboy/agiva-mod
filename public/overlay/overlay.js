'use strict';

const root = document.getElementById('overlay-root');
const screenStage = document.getElementById('screen-alert-stage');
const widgetStage = document.getElementById('widget-stage');

const urlParams = new URLSearchParams(window.location.search);
const rawWidgetParam = (urlParams.get('widget') || '').toLowerCase(); // '' | 'timer' | 'wheel' | 'goal' | 'counter' | 'winlose' | 'leaderboard' | 'poll' | 'giveaway' | 'all' | 'hud'
const activeWidget = rawWidgetParam === 'winlose' ? 'counter' : rawWidgetParam;
const activeScreen = Number(urlParams.get('screen') || 1);
const goalTypeParam = (urlParams.get('type') || 'coins').toLowerCase();
const lastTypeParam = (urlParams.get('type') || 'follower').toLowerCase();
const muteAudioParam = urlParams.get('mute') === '1';

const alertQueue = [];
const MAX_VISIBLE = 4;
const DISPLAY_DURATION = 4000;

let widgetsState = null;
let wheelRotationDeg = 0;
let hudEvents = [];
let hudLocked = false;
let currentViewers = 0;
let currentFollowers = 0;
let overlayChatFeed = [];
let overlayGiftFeed = [];
let sliderMappings = [];
let activePointsDrop = null;
let masterPausedState = false;
let spotifyState = null;
let activeSongAudio = null;
let activeSongTrackId = '';
const coinJarCoins = [];
let coinJarLoopRunning = false;
const fxCanvasParticles = [];
let fxCanvasLoopRunning = false;

// ─── Audio & Free Indonesian TTS Queue ────────────────────
const ttsQueue = [];
let isPlayingTts = false;
const activeAudioElements = new Set();

function enqueueTts(msg) {
  if (muteAudioParam) return;
  // Only play TTS on default overlay or screen 1 (avoid echo if multiple widget sources are open)
  if (activeWidget && activeWidget !== 'hud') return;
  if (activeScreen !== 1) return;

  const maxQueue = Math.max(1, Number(msg.maxQueueLength) || 10);
  while (ttsQueue.length >= maxQueue) {
    ttsQueue.shift();
  }
  ttsQueue.push(msg);
  processTtsQueue();
}

function processTtsQueue() {
  if (isPlayingTts || ttsQueue.length === 0) return;
  const item = ttsQueue.shift();
  isPlayingTts = true;

  const urls = Array.isArray(item.audioUrls) && item.audioUrls.length > 0
    ? item.audioUrls
    : (item.audioUrl ? [item.audioUrl] : []);

  const finish = () => {
    isPlayingTts = false;
    setTimeout(processTtsQueue, 150);
  };

  const fallbackSpeech = (textToSpeak) => {
    if ('speechSynthesis' in window && textToSpeak) {
      try {
        const u = new SpeechSynthesisUtterance(textToSpeak);
        u.lang = item.speechLang || (item.lang === 'en' ? 'en-US' : item.lang === 'ja' ? 'ja-JP' : 'id-ID');
        u.rate = Number(item.rate || 1.0);
        u.pitch = Number(item.pitch || 1.0);
        u.volume = Math.max(0, Math.min(1, Number(item.volume ?? 0.9)));
        u.onend = finish;
        u.onerror = finish;
        window.speechSynthesis.speak(u);
        return;
      } catch {}
    }
    finish();
  };

  if (urls.length === 0) {
    fallbackSpeech(item.text);
    return;
  }

  let chunkIdx = 0;
  const playNextChunk = () => {
    if (chunkIdx >= urls.length) {
      finish();
      return;
    }
    const url = urls[chunkIdx];
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, Number(item.volume ?? 0.9)));
    audio.playbackRate = Math.max(0.5, Math.min(2.0, Number(item.rate ?? 1.0)));
    activeAudioElements.add(audio);

    let settled = false;
    const onChunkDone = () => {
      if (settled) return;
      settled = true;
      activeAudioElements.delete(audio);
      chunkIdx++;
      playNextChunk();
    };
    const onChunkError = () => {
      if (settled) return;
      settled = true;
      activeAudioElements.delete(audio);
      const remainingText = Array.isArray(item.chunks) && item.chunks.length > chunkIdx
        ? item.chunks.slice(chunkIdx).join(' ')
        : item.text;
      fallbackSpeech(remainingText);
    };

    audio.onended = onChunkDone;
    audio.onerror = onChunkError;
    audio.play().catch(onChunkError);
  };

  playNextChunk();
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

// ─── Dynamic Theme Customizer ─────────────────────────────
function hexToRgba(hex, alpha = 0.9) {
  const clean = String(hex || '#0b0f19').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return `rgba(11, 15, 25, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, Number(alpha) ?? 0.9))})`;
}

function applyOverlayTheme(theme = {}) {
  if (!theme || typeof theme !== 'object') return;
  document.body.dataset.pack = theme.pack || 'default';
  const rootStyle = document.documentElement.style;
  const font = theme.fontFamily || 'Inter';
  rootStyle.setProperty('--ov-font', `'${font}', 'Inter', sans-serif`);
  rootStyle.setProperty('--ov-scale', String(Number(theme.fontSizeScale) || 1.0));
  rootStyle.setProperty('--ov-text', theme.textColor || '#f8fafc');
  rootStyle.setProperty('--ov-accent', theme.accentColor || '#6366f1');
  rootStyle.setProperty('--ov-bg', hexToRgba(theme.bgColor || '#0b0f19', theme.bgOpacity ?? 0.9));
  rootStyle.setProperty('--ov-radius', `${Number(theme.borderRadius ?? 16)}px`);

  const loadableFonts = ['Space Grotesk', 'Exo 2', 'Poppins', 'Orbitron', 'Fredoka', 'Comic Neue', 'JetBrains Mono'];
  if (loadableFonts.includes(font)) {
    let link = document.getElementById('agiva-dyn-font');
    if (!link) {
      link = document.createElement('link');
      link.id = 'agiva-dyn-font';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, '+')}:wght@600;700;800;900&display=swap`;
    if (link.href !== href) link.href = href;
  }

  let customEl = document.getElementById('agiva-custom-css');
  if (!customEl) {
    customEl = document.createElement('style');
    customEl.id = 'agiva-custom-css';
    document.head.appendChild(customEl);
  }
  customEl.textContent = theme.customCss || '';
}

// ─── Multi-Screen Media Alert (Per-Screen Queue) ──────────
const screenAlertQueue = [];
let isShowingScreenAlert = false;

function showScreenAlert(msg) {
  if (activeWidget) return;
  if (Number(msg.screen || 1) !== activeScreen) return;
  if (!screenStage) return;

  const maxLen = Math.max(1, Number(msg.maxQueueLength) || 10);
  while (screenAlertQueue.length >= maxLen) {
    screenAlertQueue.shift();
  }
  screenAlertQueue.push(msg);
  processScreenAlertQueue();
}

function processScreenAlertQueue() {
  if (isShowingScreenAlert || screenAlertQueue.length === 0 || !screenStage) return;
  const msg = screenAlertQueue.shift();
  isShowingScreenAlert = true;

  if (msg.soundUrl && !muteAudioParam) {
    playSoundPayload({ file: msg.soundUrl, volume: 0.85, overlap: true, screen: activeScreen });
  }

  screenStage.className = `screen-alert-stage pos-${msg.position || 'center'}`;

  const anim = widgetsState?.theme?.animation || 'pop';
  const card = document.createElement('div');
  card.className = `screen-alert-card anim-${anim}`;
  if (msg.color) {
    card.style.borderColor = msg.color;
  }
  let mediaHtml = '';
  if (msg.mediaUrl) {
    const cleanMedia = msg.mediaUrl.split('?')[0].split('#')[0].toLowerCase();
    if (cleanMedia.endsWith('.mp4') || cleanMedia.endsWith('.webm')) {
      mediaHtml = `<video src="${esc(msg.mediaUrl)}" autoplay ${muteAudioParam ? 'muted ' : ''}playsinline></video>`;
    } else if (cleanMedia.endsWith('.mp3') || cleanMedia.endsWith('.wav') || cleanMedia.endsWith('.ogg') || cleanMedia.endsWith('.m4a')) {
      if (!muteAudioParam) {
        playSoundPayload({ file: msg.mediaUrl, volume: 0.85, overlap: true, screen: activeScreen });
      }
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
  const vid = card.querySelector('video');
  if (vid) vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); });

  const dur = Math.max(800, Number(msg.durationMs) || 4000);
  setTimeout(() => {
    card.classList.add('exit');
    setTimeout(() => {
      if (card.parentNode) card.remove();
      isShowingScreenAlert = false;
      processScreenAlertQueue();
    }, 300);
  }, dur);
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
    if (t.hideWhenZero && Number(t.remainingSec) <= 0) {
      widgetStage.innerHTML = '';
      return;
    }
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
    const remSec = g.deadlineAt > Date.now() ? Math.ceil((g.deadlineAt - Date.now()) / 1000) : 0;
    const deadlineBadge = g.deadlineAt > 0
      ? `<div id="w-goal-countdown" style="margin-top:6px;text-align:right;font-size:12px;font-weight:800;color:${remSec > 0 ? '#facc15' : '#ef4444'};">${remSec > 0 ? `⏳ Sisa ${fmtTime(remSec)}` : '⌛ WAKTU HABIS'}</div>`
      : '';
    widgetStage.innerHTML = `
      <div class="w-card" style="min-width: 380px;">
        <div class="w-goal-header">
          <span>${esc(g.title)}</span>
          <span>${Number(g.current || 0).toLocaleString('id-ID')} / ${Number(g.target || 100).toLocaleString('id-ID')} (${pct}%)</span>
        </div>
        <div class="w-goal-track">
          <div class="w-goal-fill" style="width: ${pct}%;"></div>
        </div>
        ${deadlineBadge}
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
  } else if (activeWidget === 'all') {
    const t = widgetsState.timer || {};
    const g = widgetsState.goals?.[goalTypeParam] || widgetsState.goals?.coins || { title: 'Target Goal', current: 0, target: 500 };
    const pct = Math.min(100, Math.round(((g.current || 0) / Math.max(1, g.target || 100)) * 100));
    const c = widgetsState.counter || { title: '⚔️ REKOR TANTANGAN', wins: 0, loses: 0 };
    const lb = widgetsState.leaderboard || { topGifters: [] };
    const gifters = (lb.topGifters || []).slice(0, 5);
    const p = widgetsState.poll || {};
    const gw = widgetsState.giveaway || {};

    let pollHtml = '';
    if (p.active) {
      const totalVotes = (p.options || []).reduce((s, o) => s + (o.votes || 0), 0);
      pollHtml = `
        <div class="w-card w-all-card">
          <div class="w-title">📊 LIVE VOTING</div>
          <div style="font-size:13px;font-weight:800;text-align:center;margin-bottom:6px;">${esc(p.question)}</div>
          <div class="w-list">
            ${(p.options || []).map(o => {
              const opct = totalVotes > 0 ? Math.round(((o.votes || 0) / totalVotes) * 100) : 0;
              return `<div class="w-list-item w-poll-bar"><div class="w-poll-bar-fill" style="width:${opct}%;"></div><span>[${esc(o.key)}] ${esc(o.label)}</span><span>${o.votes || 0} (${opct}%)</span></div>`;
            }).join('')}
          </div>
        </div>
      `;
    }

    let gwHtml = '';
    if (gw.active) {
      gwHtml = `
        <div class="w-card w-all-card" style="text-align:center;">
          <div class="w-title">${esc(gw.title || '🎁 GIVEAWAY')}</div>
          <div style="font-size:12px;color:#cbd5e1;">Ketik <b style="color:#38bdf8;">${esc(gw.keyword || '!ikut')}</b> di chat</div>
          <div style="font-size:24px;font-weight:900;color:#a855f7;margin-top:4px;">${(gw.participants || []).length} Peserta</div>
        </div>
      `;
    }

    widgetStage.innerHTML = `
      <div class="w-all-grid">
        <div class="w-card w-all-card">
          <div class="w-title">${esc(t.title || '⏳ SUBATHON TIMER')}</div>
          <div class="w-timer-digits" id="w-timer-digits" style="font-size:36px;">${fmtTime(t.remainingSec)}</div>
          <div class="w-timer-badge" id="w-timer-badge">${t.isRunning ? '🟢 RUNNING' : '⏸️ PAUSED'}</div>
        </div>
        <div class="w-card w-all-card">
          <div class="w-title">🎯 GOAL BAR</div>
          <div class="w-goal-header" style="font-size:13px;">
            <span>${esc(g.title)}</span>
            <span>${Number(g.current || 0).toLocaleString('id-ID')} / ${Number(g.target || 100).toLocaleString('id-ID')} (${pct}%)</span>
          </div>
          <div class="w-goal-track"><div class="w-goal-fill" style="width:${pct}%;"></div></div>
        </div>
        <div class="w-card w-all-card">
          <div class="w-title">${esc(c.title || '⚔️ WIN / LOSE')}</div>
          <div class="w-counter-row">
            <div class="w-counter-box"><div class="w-counter-num win" style="font-size:32px;">${c.wins || 0}</div><div class="w-counter-lbl">WIN</div></div>
            <div style="font-size:18px;color:#475569;font-weight:900;">VS</div>
            <div class="w-counter-box"><div class="w-counter-num lose" style="font-size:32px;">${c.loses || 0}</div><div class="w-counter-lbl">LOSE</div></div>
          </div>
        </div>
        <div class="w-card w-all-card">
          <div class="w-title">👑 TOP GIFTER</div>
          <div class="w-list">
            ${gifters.length === 0
              ? '<div class="w-list-item" style="justify-content:center;color:#64748b;">Belum ada gifter</div>'
              : gifters.map((gf, i) => `<div class="w-list-item"><span>#${i + 1} ${esc(gf.user)}</span><span style="color:#facc15;">${gf.coins} 💎</span></div>`).join('')}
          </div>
        </div>
        ${pollHtml}
        ${gwHtml}
      </div>
    `;
  } else if (activeWidget === 'hud') {
    renderFloatingHud();
  } else if (activeWidget === 'last') {
    const entry = widgetsState.lastX?.[lastTypeParam] || null;
    const labels = {
      follower: '👤 LAST FOLLOWER',
      gifter: '🎁 LAST GIFTER',
      subscriber: '⭐ LAST SUBSCRIBER',
      share: '🔄 LAST SHARE',
      like: '❤️ LAST LIKE',
      chatter: '💬 LAST CHATTER'
    };
    const sub = entry
      ? (entry.giftName ? `${entry.giftName} (${entry.coins}💎)` : entry.comment ? `"${entry.comment}"` : entry.count ? `${entry.count} likes` : 'Baru saja')
      : 'Menunggu event...';
    widgetStage.innerHTML = `
      <div class="w-card" style="min-width:340px; text-align:center;">
        <div class="w-title">${labels[lastTypeParam] || '✨ LAST EVENT'}</div>
        <div style="font-size:22px;font-weight:900;">${entry ? `@${esc(entry.user)}` : '—'}</div>
        <div style="font-size:13px;color:var(--ov-accent);font-weight:700;margin-top:4px;">${esc(sub)}</div>
      </div>
    `;
  } else if (activeWidget === 'chatbox') {
    widgetStage.innerHTML = `
      <div class="w-card w-feed-box">
        <div class="w-title">💬 LIVE CHAT</div>
        ${overlayChatFeed.length === 0
          ? '<div class="w-feed-row" style="color:#64748b;text-align:center;">Menunggu chat masuk...</div>'
          : overlayChatFeed.slice(0, 12).map(m => `
            <div class="w-feed-row ${m.bot ? 'bot' : ''}">
              <strong style="color:${m.bot ? '#4ade80' : 'var(--ov-accent)'};">@${esc(m.user)}:</strong> ${esc(m.text)}
            </div>
          `).join('')}
      </div>
    `;
  } else if (activeWidget === 'giftfeed') {
    widgetStage.innerHTML = `
      <div class="w-card w-feed-box">
        <div class="w-title">🎁 GIFT &amp; DONASI FEED</div>
        ${overlayGiftFeed.length === 0
          ? '<div class="w-feed-row" style="color:#64748b;text-align:center;">Belum ada gift atau donasi...</div>'
          : overlayGiftFeed.slice(0, 12).map(g => `
            <div class="w-feed-row">
              <strong>${esc(g.user)}</strong> <span style="color:#facc15;">${esc(g.detail)}</span>
            </div>
          `).join('')}
      </div>
    `;
  } else if (activeWidget === 'viewers') {
    widgetStage.innerHTML = `
      <div class="w-card" style="min-width:220px;text-align:center;">
        <div class="w-title">👁️ VIEWERS LIVE</div>
        <div style="font-size:38px;font-weight:900;color:#38bdf8;">${Number(currentViewers || 0).toLocaleString('id-ID')}</div>
      </div>
    `;
  } else if (activeWidget === 'followers') {
    const fCount = currentFollowers || widgetsState.goals?.followers?.current || 0;
    widgetStage.innerHTML = `
      <div class="w-card" style="min-width:220px;text-align:center;">
        <div class="w-title">👤 FOLLOWERS</div>
        <div style="font-size:38px;font-weight:900;color:#22c55e;">${Number(fCount).toLocaleString('id-ID')}</div>
      </div>
    `;
  } else if (activeWidget === 'slider') {
    const enabledMaps = (sliderMappings || []).filter(m => m.enabled);
    const chips = enabledMaps.length > 0
      ? enabledMaps.map(m => `<span class="w-slider-chip">🎁 ${esc(m.label || `Gift #${m.giftId}`)} → ⚡ ${esc(m.effectId === '__none__' ? 'Action' : m.effectId)}</span>`).join('')
      : '<span class="w-slider-chip">🎁 Kirim Gift untuk Memicu Efek Live!</span>';
    widgetStage.innerHTML = `
      <div class="w-card w-slider-wrap">
        <div class="w-title">🎯 INTERACTION SLIDER</div>
        <div class="w-slider-track">${chips}${chips}</div>
      </div>
    `;
  } else if (activeWidget === 'dock') {
    widgetStage.style.padding = '8px';
    widgetStage.innerHTML = `
      <div class="w-dock-panel">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>🎮 AGIVA OBS DOCK</strong>
          <span style="font-size:12px;color:#38bdf8;">👁️ ${currentViewers} · 👤 ${currentFollowers}</span>
        </div>
        <div class="w-dock-btns">
          <button class="w-dock-btn" onclick="dockAction('toggle_all')">${masterPausedState ? '▶️ Resume All' : '⏸️ Pause All'}</button>
          <button class="w-dock-btn" onclick="dockAction('clear_queue')">🧹 Clear Queue</button>
          <button class="w-dock-btn" onclick="dockAction('skip_tts')">🔇 Skip TTS</button>
          <button class="w-dock-btn" onclick="dockAction('spin_wheel')">🎡 Spin Wheel</button>
          <button class="w-dock-btn" onclick="dockAction('points_drop')">🎁 Points Drop</button>
          <button class="w-dock-btn" onclick="dockAction('win_add')">🏆 +1 Win</button>
        </div>
        <div style="font-size:11px;font-weight:800;color:#94a3b8;">RECENT FEED</div>
        <div style="display:flex;flex-direction:column;gap:4px;max-height:260px;overflow-y:auto;">
          ${overlayGiftFeed.slice(0, 6).map(g => `<div class="w-feed-row">🎁 <strong>${esc(g.user)}</strong>: ${esc(g.detail)}</div>`).join('')}
          ${overlayChatFeed.slice(0, 6).map(c => `<div class="w-feed-row">💬 <strong>${esc(c.user)}</strong>: ${esc(c.text)}</div>`).join('')}
        </div>
      </div>
    `;
  } else if (activeWidget === 'topgift') {
    const tg = widgetsState.records?.topGift;
    widgetStage.innerHTML = `
      <div class="w-card" style="min-width:320px;text-align:center;">
        <div class="w-title">💎 TOP GIFT SESI INI</div>
        <div style="font-size:22px;font-weight:900;">${tg ? esc(tg.user) : '—'}</div>
        <div style="font-size:14px;color:#facc15;font-weight:800;margin-top:4px;">${tg ? `${esc(tg.giftName)} (${tg.coins} 💎)` : 'Belum ada gift'}</div>
      </div>
    `;
  } else if (activeWidget === 'topstreak') {
    const ts = widgetsState.records?.topStreak;
    widgetStage.innerHTML = `
      <div class="w-card" style="min-width:320px;text-align:center;">
        <div class="w-title">🔥 TOP COMBO STREAK</div>
        <div style="font-size:22px;font-weight:900;">${ts ? esc(ts.user) : '—'}</div>
        <div style="font-size:14px;color:#fb923c;font-weight:800;margin-top:4px;">${ts ? `${esc(ts.giftName)} x${ts.repeatCount} (${ts.coins} 💎)` : 'Belum ada streak'}</div>
      </div>
    `;
  } else if (activeWidget === 'giftcounter') {
    const slots = (widgetsState.giftCounters || []).filter(s => s.enabled);
    widgetStage.innerHTML = `
      <div class="w-card" style="min-width:340px;">
        <div class="w-title">🎁 GIFT COUNTER</div>
        <div class="w-list">
          ${slots.length === 0
            ? '<div class="w-list-item">Tidak ada slot aktif</div>'
            : slots.map(s => `<div class="w-list-item"><span>${esc(s.label)}</span><span style="color:#facc15;">${s.count || 0}${s.target ? ` / ${s.target}` : ''}</span></div>`).join('')}
        </div>
      </div>
    `;
  } else if (activeWidget === 'giftbattle') {
    const gb = widgetsState.giftBattle || {};
    const lScore = Number(gb.left?.score) || 0;
    const rScore = Number(gb.right?.score) || 0;
    const total = lScore + rScore;
    const lPct = total > 0 ? Math.round((lScore / total) * 100) : 50;
    const rPct = 100 - lPct;
    widgetStage.innerHTML = `
      <div class="w-card" style="min-width:420px;">
        <div class="w-title">${esc(gb.title || '⚔️ GIFT BATTLE')} (Target ${gb.target || 50})</div>
        <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:800;">
          <span style="color:${esc(gb.left?.color || '#3b82f6')};">${esc(gb.left?.label || 'LEFT')}: ${lScore}</span>
          <span style="color:${esc(gb.right?.color || '#ef4444')};">${rScore} :${esc(gb.right?.label || 'RIGHT')}</span>
        </div>
        <div class="w-battle-bar">
          <div class="w-battle-left" style="width:${lPct}%;background:${esc(gb.left?.color || '#3b82f6')};">${lPct}%</div>
          <div class="w-battle-right" style="width:${rPct}%;background:${esc(gb.right?.color || '#ef4444')};">${rPct}%</div>
        </div>
        ${gb.winner ? `<div style="text-align:center;color:#facc15;font-weight:900;font-size:15px;">🏆 PEMENANG: ${esc(gb.winner.label)}!</div>` : ''}
      </div>
    `;
  } else if (activeWidget === 'coinmatch') {
    const cm = widgetsState.coinMatch || {};
    const list = widgetsState.coinMatchLeaderboard || [];
    widgetStage.innerHTML = `
      <div class="w-card" style="min-width:360px;">
        <div class="w-title">${esc(cm.title || '🏆 COIN MATCH')} · ⏳ ${fmtTime(cm.remainingSec)}</div>
        <div class="w-list">
          ${list.length === 0
            ? '<div class="w-list-item" style="justify-content:center;color:#64748b;">Menunggu penawaran gift...</div>'
            : list.slice(0, 5).map((e, i) => `<div class="w-list-item"><span>#${i + 1} ${esc(e.user)}</span><span style="color:#facc15;">${e.coins} 💎</span></div>`).join('')}
        </div>
      </div>
    `;
  } else if (activeWidget === 'likeathon') {
    const lk = widgetsState.likeathon || {};
    const list = widgetsState.likeathonLeaderboard || [];
    widgetStage.innerHTML = `
      <div class="w-card" style="min-width:360px;">
        <div class="w-title">${esc(lk.title || '🔥 LIKEATHON')} (-${lk.decayPercent || 10}% / ${lk.decayIntervalSec || 10}s)</div>
        <div class="w-list">
          ${list.length === 0
            ? '<div class="w-list-item" style="justify-content:center;color:#64748b;">Tap layar untuk masuk leaderboard!</div>'
            : list.slice(0, 5).map((e, i) => `<div class="w-list-item"><span>#${i + 1} ${esc(e.user)}</span><span style="color:#fb7185;">${e.likes} ❤️</span></div>`).join('')}
        </div>
      </div>
    `;
  } else if (activeWidget === 'coinjar') {
    const cj = widgetsState.coinJar || { title: '🪙 COIN JAR', totalCoins: 0, capacityCoins: 500 };
    if (!document.getElementById('w-coinjar-canvas')) {
      widgetStage.innerHTML = `
        <div class="w-card" style="text-align:center;min-width:310px;">
          <div class="w-title" id="w-coinjar-title">${esc(cj.title || '🪙 COIN JAR')}</div>
          <canvas id="w-coinjar-canvas" width="260" height="300" style="display:block;margin:0 auto;"></canvas>
          <div id="w-coinjar-total" style="margin-top:6px;font-weight:900;color:#facc15;">${cj.totalCoins || 0} / ${cj.capacityCoins || 500} 💎</div>
        </div>
      `;
      startCoinJarPhysicsLoop();
    } else {
      const totEl = document.getElementById('w-coinjar-total');
      if (totEl) totEl.textContent = `${cj.totalCoins || 0} / ${cj.capacityCoins || 500} 💎`;
    }
  } else if (['firework', 'cannon', 'likefountain', 'emojify'].includes(activeWidget)) {
    if (!document.getElementById('w-fx-stage')) {
      widgetStage.style.padding = '0';
      widgetStage.innerHTML = `<div class="w-fx-stage" id="w-fx-stage"><canvas id="w-fx-canvas" style="width:100%;height:100%;display:block;"></canvas></div>`;
      startFxCanvasLoop();
    }
  } else if (activeWidget === 'frame') {
    widgetStage.innerHTML = `
      <div class="w-frame-box">
        <div class="w-frame-banner">🎮 AGIVA LIVE STREAM</div>
      </div>
    `;
  } else if (activeWidget === 'song-request' || activeWidget === 'spotify') {
    const cur = spotifyState?.currentTrack || null;
    const q = (spotifyState?.queue || []).slice(0, 4);
    const cmd = spotifyState?.config?.commandPlay || '!play';
    const coverHtml = cur?.coverUrl
      ? `<img src="${esc(cur.coverUrl)}" alt="" style="width:68px;height:68px;border-radius:12px;object-fit:cover;border:2px solid var(--ov-accent, #10b981);flex-shrink:0;">`
      : `<div style="width:68px;height:68px;border-radius:12px;background:rgba(16,185,129,0.2);border:2px solid #10b981;display:flex;align-items:center;justify-content:center;font-size:30px;flex-shrink:0;">🎵</div>`;

    widgetStage.innerHTML = `
      <div class="w-card" style="min-width: 390px; max-width: 460px;">
        <div class="w-title" style="display:flex;justify-content:space-between;align-items:center;">
          <span>🎵 SONG REQUEST LIVE</span>
          <span style="font-size:11px;color:#4ade80;">Ketik ${esc(cmd)} &lt;judul&gt;</span>
        </div>
        ${cur ? `
          <div style="display:flex;gap:12px;align-items:center;background:rgba(15,23,42,0.65);padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,0.12);">
            ${coverHtml}
            <div style="min-width:0;flex:1;">
              <div style="font-size:15px;font-weight:900;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(cur.title)}</div>
              <div style="font-size:12px;font-weight:700;color:#38bdf8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">${esc(cur.artist)}</div>
              <div style="font-size:11px;color:#cbd5e1;margin-top:4px;">🎧 Req by <strong style="color:#facc15;">@${esc(cur.requestedByName || cur.requestedBy || 'Viewer')}</strong></div>
            </div>
          </div>
        ` : `
          <div style="text-align:center;padding:14px 8px;color:#94a3b8;font-size:13px;">
            Belum ada lagu diputar.<br>Ketik <strong style="color:#4ade80;">${esc(cmd)} Judul Lagu</strong> di Live Chat!
          </div>
        `}
        ${q.length > 0 ? `
          <div style="margin-top:10px;">
            <div style="font-size:11px;font-weight:800;color:#94a3b8;text-transform:uppercase;margin-bottom:6px;">Antrean Berikutnya (${spotifyState.queue.length})</div>
            <div class="w-list">
              ${q.map((item, idx) => `
                <div class="w-list-item" style="font-size:12px;padding:6px 10px;">
                  <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:250px;">#${idx + 1} ${esc(item.title)} — ${esc(item.artist)}</span>
                  <span style="color:#facc15;font-size:11px;">@${esc(item.requestedByName || item.requestedBy)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    // Optional preview audio playback on song-request widget
    if (cur && cur.id !== activeSongTrackId) {
      activeSongTrackId = cur.id;
      if (activeSongAudio) {
        try { activeSongAudio.pause(); } catch {}
        activeSongAudio = null;
      }
      if (!muteAudioParam && spotifyState?.config?.autoPlayOverlayAudio !== false && cur.previewUrl) {
        try {
          const aud = new Audio(cur.previewUrl);
          aud.volume = 0.8;
          activeSongAudio = aud;
          aud.onended = () => {
            fetch('/api/spotify/skip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'AutoNext' }) }).catch(() => {});
          };
          aud.play().catch(() => {});
        } catch {}
      }
    } else if (!cur && activeSongAudio) {
      activeSongTrackId = '';
      try { activeSongAudio.pause(); } catch {}
      activeSongAudio = null;
    }
  }
}

window.dockAction = async (kind) => {
  try {
    if (kind === 'toggle_all') {
      masterPausedState = !masterPausedState;
      await fetch('/api/master-switches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: !masterPausedState })
      });
      renderActiveWidget();
    } else if (kind === 'clear_queue') {
      await fetch('/api/queue', { method: 'DELETE' });
    } else if (kind === 'skip_tts') {
      await fetch('/api/tts/skip', { method: 'POST' });
    } else if (kind === 'spin_wheel') {
      await fetch('/api/widgets/wheel/spin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'OBS Dock' }) });
    } else if (kind === 'points_drop') {
      await fetch('/api/points/drop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start' }) });
    } else if (kind === 'win_add') {
      await fetch('/api/widgets/winlose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add_win' }) });
    }
  } catch {}
};

function renderPointsDropBanner() {
  if (activeWidget && activeWidget !== 'all') return;
  if (!activeWidget && activeScreen !== 1) return;
  let el = document.getElementById('points-drop-banner');
  if (!activePointsDrop || !activePointsDrop.active) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'points-drop-banner';
    el.className = 'points-drop-banner';
    document.body.appendChild(el);
  }
  el.textContent = `🎁 POINTS DROP! Ketik ${activePointsDrop.keyword} untuk +${activePointsDrop.amount} ⭐ (${activePointsDrop.winners?.length || 0}/${activePointsDrop.maxWinners || 5})`;
}

function startCoinJarPhysicsLoop() {
  if (coinJarLoopRunning) return;
  coinJarLoopRunning = true;
  const step = () => {
    const canvas = document.getElementById('w-coinjar-canvas');
    if (!canvas) { coinJarLoopRunning = false; return; }
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Liquid fill background inside jar
    const cj = widgetsState?.coinJar || { totalCoins: 0, capacityCoins: 500 };
    const ratio = Math.min(1, (Number(cj.totalCoins) || 0) / Math.max(1, Number(cj.capacityCoins) || 500));
    const fillH = Math.round((h - 48) * ratio);
    if (fillH > 0) {
      ctx.fillStyle = 'rgba(250, 204, 21, 0.25)';
      ctx.fillRect(34, h - 18 - fillH, w - 68, fillH);
    }

    // Update falling coins
    for (const c of coinJarCoins) {
      c.vy += 0.45;
      c.x += c.vx;
      c.y += c.vy;
      if (c.x < 44) { c.x = 44; c.vx *= -0.6; }
      if (c.x > w - 44) { c.x = w - 44; c.vx *= -0.6; }
      const floorY = h - 26 - Math.min(fillH * 0.4, 90);
      if (c.y >= floorY) {
        c.y = floorY;
        c.vy *= -0.35;
        c.vx *= 0.85;
      }
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fillStyle = c.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#92400e';
      ctx.stroke();
    }
    if (coinJarCoins.length > 90) coinJarCoins.splice(0, coinJarCoins.length - 90);

    // Draw Glass Jar Outline
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 4;
    ctx.strokeRect(30, 32, w - 60, h - 46);
    ctx.strokeRect(58, 12, w - 116, 20);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function startFxCanvasLoop() {
  if (fxCanvasLoopRunning) return;
  fxCanvasLoopRunning = true;
  const step = () => {
    const canvas = document.getElementById('w-fx-canvas');
    if (!canvas) { fxCanvasLoopRunning = false; return; }
    if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = fxCanvasParticles.length - 1; i >= 0; i--) {
      const p = fxCanvasParticles[i];
      p.vy += p.g ?? 0.14;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.015;
      if (p.life <= 0) {
        fxCanvasParticles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function spawnGiftFirework() {
  const w = window.innerWidth || 800;
  const h = window.innerHeight || 600;
  const cx = w * (0.25 + Math.random() * 0.5);
  const cy = h * (0.2 + Math.random() * 0.4);
  const cols = ['#facc15', '#38bdf8', '#f472b6', '#4ade80', '#a855f7'];
  for (let i = 0; i < 36; i++) {
    const ang = (Math.PI * 2 * i) / 36;
    const spd = 2 + Math.random() * 5;
    fxCanvasParticles.push({ x: cx, y: cy, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, size: 4 + Math.random() * 4, color: cols[i % cols.length], life: 1, g: 0.08 });
  }
}

function spawnGiftCannon() {
  const w = window.innerWidth || 800;
  const h = window.innerHeight || 600;
  const fromLeft = Math.random() < 0.5;
  const sx = fromLeft ? 20 : w - 20;
  const cols = ['#f59e0b', '#ef4444', '#22c55e', '#3b82f6'];
  for (let i = 0; i < 24; i++) {
    fxCanvasParticles.push({
      x: sx,
      y: h - 30,
      vx: (fromLeft ? 1 : -1) * (4 + Math.random() * 7),
      vy: -(9 + Math.random() * 6),
      size: 6,
      color: cols[i % cols.length],
      life: 1.2,
      g: 0.22
    });
  }
}

function spawnDomParticleBurst(symbols = ['❤️']) {
  const stage = document.getElementById('w-fx-stage');
  if (!stage) return;
  for (let i = 0; i < Math.min(8, symbols.length * 3); i++) {
    const sp = document.createElement('div');
    sp.className = 'w-fx-particle';
    sp.textContent = symbols[i % symbols.length];
    sp.style.left = `${10 + Math.random() * 80}%`;
    sp.style.bottom = `${10 + Math.random() * 35}px`;
    stage.appendChild(sp);
    setTimeout(() => sp.remove(), 2600);
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
    applyOverlayTheme(widgetsState?.theme);

    if (activeWidget === 'slider') {
      const cfg = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
      sliderMappings = cfg.giftMappings || [];
    }
    if (['dock', 'viewers', 'followers'].includes(activeWidget)) {
      const st = await fetch('/api/status').then(r => r.json()).catch(() => ({}));
      currentViewers = st.roomStats?.viewers || currentViewers;
      currentFollowers = st.roomStats?.followers || currentFollowers;
      masterPausedState = st.masterSwitches?.all === false;
    }
    if (activeWidget === 'song-request' || activeWidget === 'spotify') {
      spotifyState = await fetch('/api/spotify').then(r => r.json()).catch(() => ({ queue: [], currentTrack: null }));
    }

    renderActiveWidget();

    if (activeWidget === 'goal') {
      setInterval(() => {
        const g = widgetsState?.goals?.[goalTypeParam] || widgetsState?.goals?.likes;
        const cdEl = document.getElementById('w-goal-countdown');
        if (cdEl && g?.deadlineAt > 0) {
          const remSec = g.deadlineAt > Date.now() ? Math.ceil((g.deadlineAt - Date.now()) / 1000) : 0;
          cdEl.textContent = remSec > 0 ? `⏳ Sisa ${fmtTime(remSec)}` : '⌛ WAKTU HABIS';
          cdEl.style.color = remSec > 0 ? '#facc15' : '#ef4444';
        }
      }, 1000);
    }
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
        const ev = msg.event;
        if (ev.type === 'chat' && ev.comment) {
          overlayChatFeed.unshift({ user: ev.user, text: ev.comment, bot: false });
          if (overlayChatFeed.length > 30) overlayChatFeed.pop();
          if (activeWidget === 'chatbox' || activeWidget === 'dock') renderActiveWidget();
        }
        if (ev.type === 'gift' || ev.type === 'donation') {
          const detail = ev.type === 'gift' ? `${ev.giftName} (${ev.coins}💎)` : `Rp ${Number(ev.amount || 0).toLocaleString('id-ID')}`;
          overlayGiftFeed.unshift({ user: ev.user, detail });
          if (overlayGiftFeed.length > 30) overlayGiftFeed.pop();
          if (activeWidget === 'giftfeed' || activeWidget === 'dock') renderActiveWidget();
        }
        if (activeWidget === 'hud') {
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
      if (msg.type === 'chatbot_message') {
        overlayChatFeed.unshift({ user: msg.user || 'AgivaBot', text: msg.text, bot: true });
        if (overlayChatFeed.length > 30) overlayChatFeed.pop();
        if (activeWidget === 'chatbox' || activeWidget === 'dock') renderActiveWidget();
      }
      if (msg.type === 'stats' && msg.roomStats) {
        currentViewers = msg.roomStats.viewers || 0;
        currentFollowers = msg.roomStats.followers || currentFollowers;
        if (['viewers', 'followers', 'dock'].includes(activeWidget)) renderActiveWidget();
      }
      if (msg.type === 'gift_fx') {
        if (activeWidget === 'firework') spawnGiftFirework();
        if (activeWidget === 'cannon') spawnGiftCannon();
      }
      if (msg.type === 'like_fx' && activeWidget === 'likefountain') {
        spawnDomParticleBurst(['❤️', '💖', '🩷', '💕']);
      }
      if (msg.type === 'emoji_fx' && activeWidget === 'emojify') {
        const syms = Array.isArray(msg.emojis) && msg.emojis.length > 0 ? msg.emojis : ['😄', '🔥', '✨'];
        spawnDomParticleBurst(syms);
      }
      if (msg.type === 'coin_jar_drop') {
        const count = Math.min(12, Math.max(1, Math.ceil((Number(msg.coins) || 1) / 10)));
        for (let i = 0; i < count; i++) {
          coinJarCoins.push({
            x: 65 + Math.random() * 130,
            y: 10 - i * 14,
            vx: (Math.random() - 0.5) * 3,
            vy: 1,
            r: 8 + Math.min(6, Math.floor((Number(msg.coins) || 1) / 50)),
            color: (Number(msg.coins) || 1) >= 100 ? '#f472b6' : '#facc15'
          });
        }
      }
      if (msg.type === 'points_drop') {
        activePointsDrop = msg.drop;
        renderPointsDropBanner();
      }
      if (msg.type === 'master_switches' && msg.masterSwitches) {
        masterPausedState = msg.masterSwitches.all === false;
        if (activeWidget === 'dock') renderActiveWidget();
      }
      if (msg.type === 'effect') pushEffectAlert(msg);
      if (msg.type === 'tts_speak') enqueueTts(msg);
      if (msg.type === 'sound_play') playSoundPayload(msg);
      if (msg.type === 'audio_stop_all') stopAllAudio();
      if (msg.type === 'screen_alert') showScreenAlert(msg);
      if (msg.type === 'widgets_update') {
        widgetsState = msg.state;
        applyOverlayTheme(widgetsState?.theme);
        renderActiveWidget();
      }
      if (msg.type === 'timer_tick' && widgetsState?.timer) {
        const wasZero = Number(widgetsState.timer.remainingSec) <= 0;
        widgetsState.timer.remainingSec = msg.remainingSec;
        widgetsState.timer.isRunning = msg.isRunning;
        if (widgetsState.timer.hideWhenZero && activeWidget === 'timer' && (Number(msg.remainingSec) <= 0 || wasZero)) {
          renderActiveWidget();
        } else {
          const dig = document.getElementById('w-timer-digits');
          const bdg = document.getElementById('w-timer-badge');
          if (dig) dig.textContent = fmtTime(msg.remainingSec);
          if (bdg) bdg.textContent = msg.isRunning ? '🟢 RUNNING' : '⏸️ PAUSED';
        }
      }
      if (msg.type === 'timer_ended' && widgetsState?.timer) {
        widgetsState.timer.remainingSec = 0;
        widgetsState.timer.isRunning = false;
        if (widgetsState.timer.hideWhenZero && activeWidget === 'timer') {
          renderActiveWidget();
        }
      }
      if (msg.type === 'wheel_spin') {
        animateWheelSpin(msg);
      }
      if (msg.type === 'spotify_update' && msg.state) {
        spotifyState = msg.state;
        if (activeWidget === 'song-request' || activeWidget === 'spotify') {
          renderActiveWidget();
        }
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
  if (!msg.effectId || msg.effectId === 'hud_notify' || msg.effectId === '__none__') return;
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
