// src/drivers/edgeTtsProvider.js — Free Microsoft Edge Neural TTS over WebSocket (zero external deps)
'use strict';

const crypto = require('crypto');
const WebSocket = require('ws');

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WIN_EPOCH_SEC = 11644473600n;
const SEC_MS_GEC_VERSION = '1-130.0.2849.68';
const EDGE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

const EDGE_ENDPOINTS = [
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1',
  'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1'
];

const EDGE_VOICES = [
  { id: 'id-ID-GadisNeural', name: '🇮🇩 Gadis (Indonesia Wanita)', lang: 'id-ID', gender: 'Female' },
  { id: 'id-ID-ArdiNeural', name: '🇮🇩 Ardi (Indonesia Pria)', lang: 'id-ID', gender: 'Male' },
  { id: 'jv-ID-SitiNeural', name: '🇮🇩 Siti (Jawa Wanita)', lang: 'jv-ID', gender: 'Female' },
  { id: 'jv-ID-DimasNeural', name: '🇮🇩 Dimas (Jawa Pria)', lang: 'jv-ID', gender: 'Male' },
  { id: 'su-ID-TutiNeural', name: '🇮🇩 Tuti (Sunda Wanita)', lang: 'su-ID', gender: 'Female' },
  { id: 'su-ID-JajangNeural', name: '🇮🇩 Jajang (Sunda Pria)', lang: 'su-ID', gender: 'Male' },
  { id: 'ms-MY-YasminNeural', name: '🇲🇾 Yasmin (Melayu Wanita)', lang: 'ms-MY', gender: 'Female' },
  { id: 'ms-MY-OsmanNeural', name: '🇲🇾 Osman (Melayu Pria)', lang: 'ms-MY', gender: 'Male' },
  { id: 'en-US-JennyNeural', name: '🇺🇸 Jenny (English US Female)', lang: 'en-US', gender: 'Female' },
  { id: 'en-US-GuyNeural', name: '🇺🇸 Guy (English US Male)', lang: 'en-US', gender: 'Male' },
  { id: 'ja-JP-NanamiNeural', name: '🇯🇵 Nanami (Japanese Female)', lang: 'ja-JP', gender: 'Female' },
  { id: 'ja-JP-KeitaNeural', name: '🇯🇵 Keita (Japanese Male)', lang: 'ja-JP', gender: 'Male' },
  { id: 'ko-KR-SunHiNeural', name: '🇰🇷 SunHi (Korean Female)', lang: 'ko-KR', gender: 'Female' }
];

const LANG_TO_DEFAULT_EDGE_VOICE = {
  'id-ID': 'id-ID-GadisNeural',
  'jv-ID': 'jv-ID-SitiNeural',
  'su-ID': 'su-ID-TutiNeural',
  'ms-MY': 'ms-MY-YasminNeural',
  'en-US': 'en-US-JennyNeural',
  'ja-JP': 'ja-JP-NanamiNeural',
  'ko-KR': 'ko-KR-SunHiNeural'
};

let clockSkewMs = 0;

/**
 * Compute Sec-MS-GEC token using BigInt (avoids IEEE-754 precision loss on 100ns ticks).
 */
function generateSecMsGec(skewMs = clockSkewMs) {
  const unixSec = BigInt(Math.floor((Date.now() + skewMs) / 1000));
  const winSec = unixSec + WIN_EPOCH_SEC;
  const rounded = winSec - (winSec % 300n);
  const ticks = rounded * 10000000n;
  const payload = `${ticks}${TRUSTED_CLIENT_TOKEN}`;
  return crypto.createHash('sha256').update(payload, 'ascii').digest('hex').toUpperCase();
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatProsodyRate(rate = 1.0) {
  const r = Math.max(0.5, Math.min(2.0, Number(rate) || 1.0));
  const pct = Math.round((r - 1) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

function formatProsodyPitch(pitch = 1.0) {
  const p = Math.max(0.5, Math.min(2.0, Number(pitch) || 1.0));
  const hz = Math.round((p - 1) * 50);
  return `${hz >= 0 ? '+' : ''}${hz}Hz`;
}

function extractAudioBody(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 2) return null;
  const headerLen = buf.readUInt16BE(0);
  if (headerLen > 0 && 2 + headerLen <= buf.length) {
    const header = buf.subarray(2, 2 + headerLen).toString('utf8');
    if (header.includes('Path:audio')) {
      return buf.subarray(2 + headerLen);
    }
  }
  const marker = Buffer.from('Path:audio\r\n');
  const idx = buf.indexOf(marker);
  if (idx !== -1) {
    return buf.subarray(idx + marker.length);
  }
  return null;
}

function synthesizeOnce(endpoint, { text, voice, rate, pitch, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomBytes(16).toString('hex');
    const secMsGec = generateSecMsGec(clockSkewMs);
    const url = `${endpoint}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${requestId}`;

    const ws = new WebSocket(url, {
      headers: {
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent': EDGE_USER_AGENT
      },
      handshakeTimeout: Math.min(4000, timeoutMs)
    });

    const audioChunks = [];
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      try {
        ws.removeAllListeners();
        // Always keep a no-op error listener so async abortHandshake errors never become uncaughtException
        ws.on('error', () => {});
      } catch {}
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        } else if (ws.readyState === WebSocket.CONNECTING) {
          ws.terminate();
        }
      } catch {}
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const timer = setTimeout(() => {
      fail(new Error('Edge TTS timeout'));
    }, timeoutMs);

    ws.on('unexpected-response', (_req, res) => {
      if (res?.headers?.date) {
        const serverMs = new Date(res.headers.date).getTime();
        if (Number.isFinite(serverMs)) {
          clockSkewMs = serverMs - Date.now();
        }
      }
      fail(new Error(`Edge TTS HTTP ${res?.statusCode || 403}`));
    });

    ws.on('open', () => {
      const ts = new Date().toISOString();
      const safeVoice = EDGE_VOICES.some(v => v.id === voice) ? voice : 'id-ID-GadisNeural';
      const langAttr = safeVoice.split('-').slice(0, 2).join('-') || 'id-ID';
      const rateStr = formatProsodyRate(rate);
      const pitchStr = formatProsodyPitch(pitch);
      const escapedText = escapeXml(text);

      const cfgMsg =
        `X-Timestamp:${ts}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`;

      const ssmlMsg =
        `X-RequestId:${requestId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${ts}Z\r\n` +
        `Path:ssml\r\n\r\n` +
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${langAttr}'>` +
        `<voice name='${safeVoice}'><prosody pitch='${pitchStr}' rate='${rateStr}'>${escapedText}</prosody></voice></speak>`;

      try {
        ws.send(cfgMsg);
        ws.send(ssmlMsg);
      } catch (e) {
        fail(e);
      }
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const body = extractAudioBody(Buffer.isBuffer(data) ? data : Buffer.from(data));
        if (body && body.length > 0) {
          audioChunks.push(body);
        }
      } else {
        const msgStr = data.toString('utf8');
        if (msgStr.includes('Path:turn.end')) {
          if (settled) return;
          settled = true;
          cleanup();
          const out = Buffer.concat(audioChunks);
          if (out.length === 0) {
            reject(new Error('Edge TTS returned empty audio'));
          } else {
            resolve(out);
          }
        }
      }
    });

    ws.on('error', (err) => fail(err));
    ws.on('close', () => {
      if (!settled) {
        if (audioChunks.length > 0) {
          settled = true;
          cleanup();
          resolve(Buffer.concat(audioChunks));
        } else {
          fail(new Error('Edge TTS WebSocket closed before audio completed'));
        }
      }
    });
  });
}

async function synthesize({ text, voice = 'id-ID-GadisNeural', rate = 1.0, pitch = 1.0, timeoutMs = 5500 }) {
  let lastErr = null;
  for (const endpoint of EDGE_ENDPOINTS) {
    try {
      return await synthesizeOnce(endpoint, { text, voice, rate, pitch, timeoutMs });
    } catch (err) {
      lastErr = err;
      // Retry once if HTTP 403 updated clockSkewMs
      if (String(err.message).includes('403')) {
        try {
          return await synthesizeOnce(endpoint, { text, voice, rate, pitch, timeoutMs });
        } catch (retryErr) {
          lastErr = retryErr;
        }
      }
    }
  }
  throw lastErr || new Error('Edge TTS failed');
}

module.exports = {
  EDGE_VOICES,
  LANG_TO_DEFAULT_EDGE_VOICE,
  generateSecMsGec,
  synthesize
};
