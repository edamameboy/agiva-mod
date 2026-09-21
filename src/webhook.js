// webhook.js — Emit events to external webhook endpoints
'use strict';

const crypto = require('crypto');

let axiosInstance = null;
async function getAxios() {
  if (!axiosInstance) {
    const { default: axios } = await import('axios');
    axiosInstance = axios;
  }
  return axiosInstance;
}

class WebhookEmitter {
  constructor() {
    this.url = process.env.WEBHOOK_URL || '';
    this.secret = process.env.WEBHOOK_SECRET || '';
    this.enabled = !!this.url;
  }

  _sign(body) {
    if (!this.secret) return null;
    return crypto.createHmac('sha256', this.secret).update(body).digest('hex');
  }

  async emit(payload) {
    if (!this.enabled || !this.url) return;
    const body = JSON.stringify(payload);
    const headers = {
      'Content-Type': 'application/json',
      'X-Source': 'tiktok-live-bridge',
      'X-Timestamp': Date.now().toString()
    };
    const sig = this._sign(body);
    if (sig) headers['X-Signature'] = `sha256=${sig}`;

    try {
      const axios = await getAxios();
      await axios.post(this.url, payload, { headers, timeout: 5000 });
    } catch (e) {
      console.error('[Webhook] Failed to emit:', e.message);
    }
  }

  setUrl(url, secret) {
    this.url = url;
    this.secret = secret;
    this.enabled = !!url;
    process.env.WEBHOOK_URL = url || '';
    process.env.WEBHOOK_SECRET = secret || '';
  }

  getUrl() {
    return this.url || '';
  }

  getSecret() {
    return this.secret || '';
  }
}

module.exports = new WebhookEmitter();

