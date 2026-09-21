using System;
using System.Collections;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using UnityEngine;
using TikTokLiveMod.GameEffects;

namespace TikTokLiveMod
{
    /// <summary>
    /// WebSocket client that connects to the Node.js bridge server
    /// and dispatches incoming commands to the appropriate game effect.
    /// </summary>
    public class TikTokWebSocketClient : MonoBehaviour
    {
        private ClientWebSocket? _ws;
        private CancellationTokenSource _cts = new();
        private string _url = "";
        private bool _shouldRun;
        private bool _hasConnectedOnce = false;
        private readonly byte[] _receiveBuffer = new byte[8192];

        // Commands queued from background thread → dispatched on Unity main thread
        private readonly System.Collections.Concurrent.ConcurrentQueue<Dictionary<string, string>> _commandQueue = new();

        private async void Start()
        {
            // Optional: Start could be used, but Connect is called explicitly.
        }

        public void Connect(string url)
        {
            _url = url;
            _shouldRun = true;
            // Fire and forget the async loop instead of a Coroutine
            _ = ConnectLoopAsync();
        }

        public void Disconnect()
        {
            _shouldRun = false;
            _cts.Cancel();
            try { _ws?.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None); } catch { }
        }

        private async System.Threading.Tasks.Task ConnectLoopAsync()
        {
            while (_shouldRun)
            {
                if (_hasConnectedOnce)
                {
                    Plugin.Log.LogInfo($"[WS] Connecting to {_url}...");
                }
                
                _cts = new CancellationTokenSource();

                await ReceiveLoopAsync();

                if (_shouldRun)
                {
                    if (_hasConnectedOnce)
                    {
                        Plugin.Log.LogWarning("[WS] Disconnected — retrying in 3s...");
                    }
                    await System.Threading.Tasks.Task.Delay(3000);
                }
            }
        }

        private async System.Threading.Tasks.Task ReceiveLoopAsync()
        {
            try
            {
                _ws = new ClientWebSocket();
                await _ws.ConnectAsync(new Uri(_url), _cts.Token);
                
                if (!_hasConnectedOnce)
                {
                    Plugin.Log.LogInfo("[WS] Connected to TikTok Live Bridge!");
                    _hasConnectedOnce = true;
                }
                else
                {
                    Plugin.Log.LogInfo("[WS] Reconnected to TikTok Live Bridge!");
                }

                // Identify as game mod
                var hello = Encoding.UTF8.GetBytes("{\"type\":\"hello\",\"client\":\"game-mod\",\"game\":\"CarJunkyard\"}");
                await _ws.SendAsync(new ArraySegment<byte>(hello), WebSocketMessageType.Text, true, _cts.Token);

                while (_ws.State == WebSocketState.Open && !_cts.IsCancellationRequested)
                {
                    var result = await _ws.ReceiveAsync(new ArraySegment<byte>(_receiveBuffer), _cts.Token);
                    if (result.MessageType == WebSocketMessageType.Close) break;
                    if (result.Count == 0) continue;

                    var json = Encoding.UTF8.GetString(_receiveBuffer, 0, result.Count);
                    var parsed = ParseJson(json);
                    if (parsed.Count > 0)
                        _commandQueue.Enqueue(parsed);
                }
            }
            catch (OperationCanceledException) { /* normal shutdown */ }
            catch (Exception e)
            {
                if (_hasConnectedOnce)
                {
                    Plugin.Log.LogWarning($"[WS] Error: {e.Message}");
                }
            }
            finally
            {
                try { _ws?.Dispose(); } catch { }
                _ws = null;
            }
        }

        private void Update()
        {
            while (_commandQueue.TryDequeue(out var cmd))
                ProcessCommand(cmd);
        }

        private void ProcessCommand(Dictionary<string, string> cmd)
        {
            if (!cmd.TryGetValue("type", out var type)) return;

            if (type == "auth")
            {
                if (cmd.TryGetValue("username", out var username))
                {
                    _ = AuthManager.CheckAuthorizationAsync(username);
                }
                return;
            }

            if (type != "effect") return;
            
            // SECURITY: Block all effects if not authorized
            if (!AuthManager.IsAuthorized)
            {
                Plugin.Log.LogWarning("[Security] Unauthorized! Effect dropped.");
                return;
            }

            cmd.TryGetValue("effectId", out var effectId); effectId ??= "";
            cmd.TryGetValue("user", out var user); user ??= "anonymous";
            cmd.TryGetValue("label", out var label); label = string.IsNullOrEmpty(label) ? effectId : label;
            cmd.TryGetValue("message", out var message); message ??= "";
            
            // Extract coins from the JSON (gift value)
            int coins = 1;
            if (cmd.TryGetValue("coins", out var coinsStr) && int.TryParse(coinsStr, out var parsedCoins))
            {
                coins = parsedCoins;
            }

            Plugin.Log.LogInfo($"[Effect] {effectId} ← {user} (Coins: {coins})");
            try
            {
                DispatchEffect(effectId, user, label, cmd, coins);
            }
            catch (Exception e)
            {
                Plugin.Log.LogError($"[Effect] Error in {effectId}: {e.Message}");
            }
        }

        private static void DispatchEffect(string effectId, string user, string label, Dictionary<string, string> cmd, int coins)
        {
            switch (effectId)
            {
                // Visual / Camera
                case "screen_blur": CameraEffects.BlurDarken(); break;

                // Player
                case "auto_drop":       PlayerEffects.DropItem(); break;
                case "refill_stamina":  SystemEffects.RefillStamina(); break;
                case "add_stamina_drink": PlayerEffects.ModifyEnergyDrink(ModConfig.Data.GachaEnergyDrinkAmount); break;
                case "remove_stamina_drink": PlayerEffects.ModifyEnergyDrink(-ModConfig.Data.GachaEnergyDrinkAmount); break;
                case "random_teleport": PlayerEffects.Teleport(); break;
                case "auto_jump":       PlayerEffects.AutoJump(); break;

                // World
                case "spawn_junk":
                    cmd.TryGetValue("source", out var source);
                    SpawnEffects.SpawnJunk(coins, source ?? "");
                    break;
                case "spawn_junk_gift":
                    SpawnEffects.SpawnJunk(coins, "gift");
                    break;
                case "spawn_junk_like":
                    SpawnEffects.SpawnJunk(coins, "like");
                    break;
                case "spawn_junk_car_gacha":
                    SpawnEffects.SpawnCarGacha();
                    break;
                case "spawn_junk_car_gift":
                    SpawnEffects.SpawnCarGift(coins);
                    break;
                case "remove_junk": SpawnEffects.RemoveJunk(ModConfig.Data.GachaRemoveJunkAmount); break;

                // Special
                case "gacha": GachaEffects.RollGacha(user); break;

                // System
                case "reset_progress": SystemEffects.ResetProgress(); break;
                case "force_close":    SystemEffects.ForceClose(); break;

                default:
                    Plugin.Log.LogWarning($"[Effect] Unknown: {effectId}");
                    break;
            }

            HUDOverlay.ShowEffectToast(user, label);
        }

        /// <summary>Minimal flat-key JSON parser (no nested objects needed).</summary>
        private static Dictionary<string, string> ParseJson(string json)
        {
            var result = new Dictionary<string, string>(StringComparer.Ordinal);
            // Match "key": "value" or "key": number/true/false/null
            var pattern = new Regex(@"""([^""]+)""\s*:\s*(?:""([^""]*)""|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|true|false|null)");
            foreach (Match m in pattern.Matches(json))
            {
                var key = m.Groups[1].Value;
                var val = m.Groups[2].Success ? m.Groups[2].Value
                        : m.Groups[3].Success ? m.Groups[3].Value
                        : m.Value.Substring(m.Value.IndexOf(':') + 1).Trim();
                result[key] = val;
            }
            return result;
        }
    }
}
