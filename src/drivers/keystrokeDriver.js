// src/drivers/keystrokeDriver.js — Dual-Mode Keystroke & Mouse Macro Engine (Win32 SendInput ScanCode + AutoIt)
'use strict';

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// Virtual-Key map for common game keys
const VK_MAP = {
  BACKSPACE: 0x08, TAB: 0x09, ENTER: 0x0D, RETURN: 0x0D, SHIFT: 0x10, CTRL: 0x11, CONTROL: 0x11,
  ALT: 0x12, PAUSE: 0x13, CAPSLOCK: 0x14, ESC: 0x1B, ESCAPE: 0x1B, SPACE: 0x20,
  PAGEUP: 0x21, PAGEDOWN: 0x22, END: 0x23, HOME: 0x24,
  LEFT: 0x25, UP: 0x26, RIGHT: 0x27, DOWN: 0x28,
  INSERT: 0x2D, DELETE: 0x2E,
  0: 0x30, 1: 0x31, 2: 0x32, 3: 0x33, 4: 0x34, 5: 0x35, 6: 0x36, 7: 0x37, 8: 0x38, 9: 0x39,
  A: 0x41, B: 0x42, C: 0x43, D: 0x44, E: 0x45, F: 0x46, G: 0x47, H: 0x48, I: 0x49, J: 0x4A,
  K: 0x4B, L: 0x4C, M: 0x4D, N: 0x4E, O: 0x4F, P: 0x50, Q: 0x51, R: 0x52, S: 0x53, T: 0x54,
  U: 0x55, V: 0x56, W: 0x57, X: 0x58, Y: 0x59, Z: 0x5A,
  F1: 0x70, F2: 0x71, F3: 0x72, F4: 0x73, F5: 0x74, F6: 0x75,
  F7: 0x76, F8: 0x77, F9: 0x78, F10: 0x79, F11: 0x7A, F12: 0x7B,
  SEMICOLON: 0xBA, EQUALS: 0xBB, PLUS: 0xBB, COMMA: 0xBC, MINUS: 0xBD, PERIOD: 0xBE
};

class KeystrokeDriver {
  constructor() {
    this.psWorker = null;
    this.workerReady = false;
    this.mutexQueue = Promise.resolve();
    this.autoItPath = this._findAutoItBinary();
    this._initPersistentWorker();
  }

  _findAutoItBinary() {
    const candidates = [
      path.join(__dirname, '../../bin/keystroke.exe'),
      path.join(process.env.APPDATA || '', 'IndoFinity', 'keystroke.exe'),
      'C:\\Program Files (x86)\\AutoIt3\\AutoIt3.exe',
      'C:\\Program Files\\AutoIt3\\AutoIt3.exe'
    ];
    for (const p of candidates) {
      if (p && fs.existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Persistent PowerShell C# P/Invoke worker for sub-5ms Hardware ScanCode SendInput
   */
  _initPersistentWorker() {
    if (process.platform !== 'win32') return;
    try {
      this.psWorker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      const csharpInit = `
$code = @"
using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Threading;

public static class AgivaWinInput {
    [DllImport("user32.dll")]
    public static extern uint SendInput(uint nInputs, [MarshalAs(UnmanagedType.LPArray), In] INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    public static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    public static void FocusProcess(string procName) {
        if (string.IsNullOrEmpty(procName)) return;
        string clean = procName.Replace(".exe", "");
        Process[] procs = Process.GetProcessesByName(clean);
        foreach (var p in procs) {
            if (p.MainWindowHandle != IntPtr.Zero) {
                if (GetForegroundWindow() != p.MainWindowHandle) {
                    SetForegroundWindow(p.MainWindowHandle);
                    Thread.Sleep(30);
                }
                break;
            }
        }
    }

    public static void KeyDown(ushort vk) {
        ushort scan = (ushort)MapVirtualKey(vk, 0);
        INPUT[] inputs = new INPUT[1];
        inputs[0].type = 1; // INPUT_KEYBOARD
        inputs[0].U.ki.wVk = vk;
        inputs[0].U.ki.wScan = scan;
        inputs[0].U.ki.dwFlags = 0x0008; // KEYEVENTF_SCANCODE
        SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void KeyUp(ushort vk) {
        ushort scan = (ushort)MapVirtualKey(vk, 0);
        INPUT[] inputs = new INPUT[1];
        inputs[0].type = 1;
        inputs[0].U.ki.wVk = vk;
        inputs[0].U.ki.wScan = scan;
        inputs[0].U.ki.dwFlags = 0x0008 | 0x0002; // SCANCODE | KEYUP
        SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void KeyHold(ushort vk, int durationMs) {
        KeyDown(vk);
        Thread.Sleep(Math.Max(25, durationMs));
        KeyUp(vk);
    }

    public static void MouseHold(string btn, int durationMs) {
        uint down = 0x0002; uint up = 0x0004;
        if (btn == "RIGHT") { down = 0x0008; up = 0x0010; }
        else if (btn == "MIDDLE") { down = 0x0020; up = 0x0040; }
        mouse_event(down, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(Math.Max(25, durationMs));
        mouse_event(up, 0, 0, 0, UIntPtr.Zero);
    }

    public static void MouseScroll(int delta) {
        mouse_event(0x0800, 0, 0, delta, UIntPtr.Zero);
    }
}
"@
Add-Type -TypeDefinition $code -Language CSharp
Write-Output "AGIVA_INPUT_READY"
`;

      this.psWorker.stdout.on('data', (chunk) => {
        if (chunk.toString().includes('AGIVA_INPUT_READY')) {
          this.workerReady = true;
          console.log('[KeystrokeDriver] Native Win32 SendInput (ScanCode) worker ready');
        }
      });

      this.psWorker.on('exit', () => {
        this.workerReady = false;
        setTimeout(() => this._initPersistentWorker(), 3000);
      });

      this.psWorker.stdin.write(csharpInit + '\n');
    } catch (e) {
      console.error('[KeystrokeDriver] Failed to init Win32 worker:', e.message);
    }
  }

  /**
   * Parse macro script DSL into structured commands:
   * Examples:
   *   "HOLD 300 W"
   *   "PRESS SPACE"
   *   "HOLD 500 MOUSELEFT"
   *   "DELAY 1000"
   *   "CTRL+S"
   *   Multi-line or semicolon-separated: "HOLD 400 W; DELAY 200; PRESS SPACE"
   */
  parseMacro(macroString, context = {}) {
    if (!macroString || typeof macroString !== 'string') return [];
    const interpolated = macroString
      .replace(/\{user\}|\{nickname\}|\{username\}/gi, String(context.user || 'Viewer'))
      .replace(/\{giftname\}/gi, String(context.giftName || 'Gift'))
      .replace(/\{coins\}/gi, String(context.coins || 1));

    const lines = interpolated
      .split(/\r?\n|;/)
      .map(l => l.trim())
      .filter(Boolean);

    const steps = [];
    for (const line of lines) {
      const parts = line.split(/\s+/);
      const cmd = parts[0].toUpperCase();

      if (cmd === 'DELAY' || cmd === 'WAIT' || cmd === 'SLEEP') {
        steps.push({ type: 'delay', ms: Math.min(30000, Math.max(10, parseInt(parts[1]) || 500)) });
      } else if (cmd === 'HOLD') {
        const ms = Math.min(15000, Math.max(25, parseInt(parts[1]) || 300));
        const key = (parts[2] || 'SPACE').toUpperCase();
        if (key.startsWith('MOUSE')) {
          steps.push({ type: 'mouse', button: key.replace('MOUSE', '') || 'LEFT', ms });
        } else {
          steps.push({ type: 'key', key, ms });
        }
      } else if (cmd === 'PRESS' || cmd === 'KEY') {
        const key = (parts[1] || 'SPACE').toUpperCase();
        const ms = parseInt(parts[2]) || 60;
        if (key.startsWith('MOUSE')) {
          steps.push({ type: 'mouse', button: key.replace('MOUSE', '') || 'LEFT', ms });
        } else {
          steps.push({ type: 'key', key, ms });
        }
      } else if (cmd === 'MOUSELEFT' || cmd === 'MOUSERIGHT' || cmd === 'MOUSEMIDDLE') {
        const ms = parseInt(parts[1]) || 60;
        steps.push({ type: 'mouse', button: cmd.replace('MOUSE', ''), ms });
      } else if (cmd === 'SCROLLUP' || cmd === 'SCROLLDOWN') {
        const clicks = parseInt(parts[1]) || 3;
        steps.push({ type: 'scroll', delta: cmd === 'SCROLLUP' ? 120 * clicks : -120 * clicks });
      } else if (line.includes('+')) {
        // Combo like CTRL+S or SHIFT+W
        const comboKeys = line.split('+').map(k => k.trim().toUpperCase());
        steps.push({ type: 'combo', keys: comboKeys, ms: 80 });
      } else {
        // Single key shorthand like "SPACE" or "W"
        steps.push({ type: 'key', key: cmd, ms: parseInt(parts[1]) || 80 });
      }
    }
    return steps;
  }

  /**
   * Enqueue macro execution inside the Unified Input Mutex so methods never collide
   */
  execute(macroString, options = {}) {
    const {
      inputMethod = 'sendinput', // 'sendinput' | 'autoit'
      targetProcess = '',
      context = {}
    } = options;

    this.mutexQueue = this.mutexQueue
      .then(() => this._runMacro(macroString, inputMethod, targetProcess, context))
      .catch(err => console.error('[KeystrokeDriver] Queue error:', err.message));

    return this.mutexQueue;
  }

  async _runMacro(macroString, inputMethod, targetProcess, context) {
    const steps = this.parseMacro(macroString, context);
    if (steps.length === 0) return;

    console.log(`[KeystrokeDriver] Executing (${inputMethod}) -> "${macroString}" [Target: ${targetProcess || 'Active Window'}]`);

    for (const step of steps) {
      if (step.type === 'delay') {
        await new Promise(r => setTimeout(r, step.ms));
        continue;
      }

      if (inputMethod === 'autoit' && this.autoItPath) {
        await this._execStepAutoIt(step, targetProcess);
      } else {
        await this._execStepSendInput(step, targetProcess);
      }
      // Small breathing gap between sequential keys
      await new Promise(r => setTimeout(r, 25));
    }
  }

  async _execStepSendInput(step, targetProcess) {
    if (!this.psWorker || !this.workerReady) {
      return this._execStepAutoIt(step, targetProcess);
    }

    const lines = [];
    if (targetProcess) {
      const safeProc = targetProcess.replace(/[^a-zA-Z0-9._ -]/g, '');
      lines.push(`[AgivaWinInput]::FocusProcess("${safeProc}")`);
    }

    if (step.type === 'key') {
      const vk = VK_MAP[step.key] || step.key.charCodeAt(0);
      lines.push(`[AgivaWinInput]::KeyHold(${vk}, ${step.ms || 60})`);
    } else if (step.type === 'combo') {
      const vks = step.keys.map(k => VK_MAP[k] || k.charCodeAt(0));
      vks.forEach(vk => lines.push(`[AgivaWinInput]::KeyDown(${vk})`));
      lines.push(`Start-Sleep -Milliseconds ${step.ms || 80}`);
      vks.slice().reverse().forEach(vk => lines.push(`[AgivaWinInput]::KeyUp(${vk})`));
    } else if (step.type === 'mouse') {
      lines.push(`[AgivaWinInput]::MouseHold("${step.button}", ${step.ms || 60})`);
    } else if (step.type === 'scroll') {
      lines.push(`[AgivaWinInput]::MouseScroll(${step.delta})`);
    }

    this.psWorker.stdin.write(lines.join('; ') + '\n');
    await new Promise(r => setTimeout(r, (step.ms || 60) + 20));
  }

  async _execStepAutoIt(step, targetProcess) {
    if (this.autoItPath) {
      let au3Cmd = '';
      if (step.type === 'key') {
        const k = step.key.length === 1 ? step.key.toLowerCase() : step.key;
        au3Cmd = `Opt("SendKeyDownDelay", ${step.ms || 60}) + Send("{${k}}")`;
      } else if (step.type === 'mouse') {
        const btn = step.button === 'RIGHT' ? 'right' : step.button === 'MIDDLE' ? 'middle' : 'left';
        au3Cmd = `Opt("MouseClickDownDelay", ${step.ms || 60}) + MouseClick("${btn}")`;
      } else if (step.type === 'scroll') {
        const dir = step.delta > 0 ? 'up' : 'down';
        au3Cmd = `MouseWheel("${dir}", ${Math.max(1, Math.abs(Math.round(step.delta / 120)))})`;
      }

      if (au3Cmd) {
        await new Promise((resolve) => {
          execFile(this.autoItPath, ['/AutoIt3ExecuteLine', au3Cmd], { windowsHide: true }, () => resolve());
        });
      }
      return;
    }

    // Fallback if keystroke.exe is not installed: use SendInput worker
    if (this.psWorker && this.workerReady) {
      return this._execStepSendInput(step, targetProcess);
    }
  }

  /**
   * Scan currently running desktop applications with visible windows
   */
  async scanRunningWindows() {
    if (process.platform !== 'win32') return [];
    return new Promise((resolve) => {
      const psCmd = `Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress`;
      execFile('powershell.exe', ['-NoProfile', '-Command', psCmd], { windowsHide: true, timeout: 4000 }, (err, stdout) => {
        if (err || !stdout) return resolve([]);
        try {
          const parsed = JSON.parse(stdout.trim());
          const list = Array.isArray(parsed) ? parsed : [parsed];
          resolve(list.map(p => ({
            pid: p.Id,
            processName: `${p.ProcessName}.exe`,
            windowTitle: p.MainWindowTitle
          })));
        } catch {
          resolve([]);
        }
      });
    });
  }
}

module.exports = new KeystrokeDriver();
