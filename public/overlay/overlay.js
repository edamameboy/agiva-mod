'use strict';

const root = document.getElementById('overlay-root');
const alertQueue = [];
let isShowing = false;
const MAX_VISIBLE = 4;
const DISPLAY_DURATION = 4000;

// ─── WebSocket ────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'event') pushAlert(msg.event);
      if (msg.type === 'effect') pushEffectAlert(msg);
    } catch {}
  };

  ws.onclose = () => setTimeout(connectWS, 3000);
}

// ─── Alert Types ──────────────────────────────────────────
const configs = {
  gift: (ev) => ({
    icon: '🎁',
    type: ev.coins >= 5000 ? 'chaos' : 'gift',
    title: `${ev.user}`,
    sub: `sent ${ev.giftName} · ${ev.coins}💎`,
    tag: 'GIFT',
    duration: ev.coins >= 5000 ? 6000 : DISPLAY_DURATION
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
  const cfg = configs[ev.type]?.(ev);
  if (!cfg) return;
  alertQueue.push(cfg);
  processQueue();
}

function pushEffectAlert(msg) {
  if (!msg.effectId || msg.effectId === 'hud_notify') return; // skip generic notif
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

// ─── Display Queue ────────────────────────────────────────
function processQueue() {
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

  // Remove after duration
  setTimeout(() => {
    div.classList.add('exit');
    setTimeout(() => {
      div.remove();
      processQueue(); // try showing next
    }, 350);
  }, cfg.duration);
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

connectWS();
