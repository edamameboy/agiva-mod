using BepInEx;
using BepInEx.Logging;
using BepInEx.Unity.Mono;
using HarmonyLib;
using TikTokLiveMod.GameEffects;

namespace TikTokLiveMod
{
    [BepInPlugin("com.liveMod.tiktoklive", "TikTok Live Mod", "1.0.0")]
    public class Plugin : BaseUnityPlugin
    {
        internal static ManualLogSource Log = null!;
        internal static Plugin Instance = null!;
        private Harmony _harmony = null!;

        private void Awake()
        {
            Instance = this;
            Log = Logger;
            Log.LogInfo("[TikTokLiveMod] Loading v1.0.0...");
            Log.LogMessage("[TikTokLiveMod] ✨ PLUGIN MADE BY MAMEBOII ✨");

            ModConfig.Load();

            _harmony = new Harmony("com.liveMod.tiktoklive");
            _harmony.PatchAll();
            Log.LogInfo("[TikTokLiveMod] Harmony patches applied");
        }

        private void Start()
        {
            // Add HUD overlay component
            if (gameObject.GetComponent<HUDOverlay>() == null)
                gameObject.AddComponent<HUDOverlay>();
                
            // Add UI Patcher
            if (gameObject.GetComponent<UIPatcher>() == null)
                gameObject.AddComponent<UIPatcher>();
                
            if (gameObject.GetComponent<UIDump>() == null)
                gameObject.AddComponent<UIDump>();
            
            // Add Mod Settings UI
            if (gameObject.GetComponent<ModSettingsUI>() == null)
                gameObject.AddComponent<ModSettingsUI>();

            // Start WebSocket client
            if (gameObject.GetComponent<TikTokWebSocketClient>() == null)
            {
                var wsClient = gameObject.AddComponent<TikTokWebSocketClient>();
                wsClient.Connect("ws://localhost:7827");
                Log.LogInfo("[TikTokLiveMod] Ready — connecting to TikTok bridge at ws://localhost:7827");
            }
        }

        private void OnDestroy()
        {
            _harmony?.UnpatchSelf();
        }
    }
}
