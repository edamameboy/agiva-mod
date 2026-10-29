// src/drivers/rconHttpDriver.js — RCON TCP & ServerTap HTTP Command Driver (Minecraft, Rust, Palworld, Roblox HTTP)
'use strict';

const net = require('net');
const http = require('http');
const https = require('https');

class RconHttpDriver {
  constructor() {
    this.config = {
      mode: 'servertap', // 'servertap' | 'rcon' | 'http'
      host: process.env.RCON_HOST || '127.0.0.1',
      port: parseInt(process.env.RCON_PORT) || 4567,
      password: process.env.RCON_PASSWORD || 'change_me'
    };
  }

  configure(opts = {}) {
    this.config = { ...this.config, ...opts };
  }

  interpolateCommand(cmdTemplate, context = {}) {
    if (!cmdTemplate) return '';
    return String(cmdTemplate)
      .replace(/\{user\}|\{nickname\}|\{username\}/gi, String(context.user || 'Viewer').replace(/["'\\]/g, ''))
      .replace(/\{giftname\}/gi, String(context.giftName || 'Gift').replace(/["'\\]/g, ''))
      .replace(/\{coins\}/gi, String(context.coins || 1))
      .replace(/\{player\}/gi, String(context.targetPlayer || '@p'));
  }

  async execute(commandString, options = {}) {
    const cfg = { ...this.config, ...(options.connection || {}) };
    const context = options.context || {};
    const commands = String(commandString || '')
      .split(/\r?\n|;/)
      .map(c => this.interpolateCommand(c.trim(), context))
      .filter(Boolean);

    if (commands.length === 0) return;

    for (const cmd of commands) {
      try {
        if (cfg.mode === 'rcon') {
          await this._sendRconPacket(cfg.host, cfg.port || 25575, cfg.password, cmd);
        } else {
          await this._sendServerTapHttp(cfg.host, cfg.port || 4567, cfg.password, cmd);
        }
        console.log(`[RconHttpDriver] Executed (${cfg.mode}): ${cmd}`);
      } catch (e) {
        console.error(`[RconHttpDriver] Error executing "${cmd}":`, e.message);
      }
    }
  }

  _sendServerTapHttp(host, port, key, command) {
    return new Promise((resolve, reject) => {
      const postData = `command=${encodeURIComponent(command)}`;
      const isHttps = String(host).startsWith('https://');
      const cleanHost = String(host).replace(/^https?:\/\//, '').split('/')[0];
      const client = isHttps ? https : http;

      const req = client.request({
        hostname: cleanHost,
        port: port,
        path: '/v1/server/exec',
        method: 'POST',
        timeout: 4000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'key': key || ''
        }
      }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(res.statusCode));
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('ServerTap timeout')); });
      req.write(postData);
      req.end();
    });
  }

  _sendRconPacket(host, port, password, command) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let authenticated = false;

      const encodePacket = (id, type, body) => {
        const bodyBuf = Buffer.from(body, 'utf8');
        const len = 4 + 4 + bodyBuf.length + 2;
        const buf = Buffer.alloc(4 + len);
        buf.writeInt32LE(len, 0);
        buf.writeInt32LE(id, 4);
        buf.writeInt32LE(type, 8);
        bodyBuf.copy(buf, 12);
        buf.writeInt16LE(0, 12 + bodyBuf.length);
        return buf;
      };

      socket.setTimeout(4000);
      socket.connect(port, host, () => {
        socket.write(encodePacket(1, 3, password || '')); // SERVERDATA_AUTH = 3
      });

      socket.on('data', (data) => {
        if (data.length < 12) return;
        const reqId = data.readInt32LE(4);
        if (reqId === -1) {
          socket.destroy();
          return reject(new Error('RCON Authentication failed'));
        }
        if (!authenticated) {
          authenticated = true;
          socket.write(encodePacket(2, 2, command)); // SERVERDATA_EXECCOMMAND = 2
          setTimeout(() => {
            socket.destroy();
            resolve(true);
          }, 100);
        }
      });

      socket.on('error', (err) => {
        socket.destroy();
        reject(err);
      });
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('RCON connection timeout'));
      });
    });
  }
}

module.exports = new RconHttpDriver();
