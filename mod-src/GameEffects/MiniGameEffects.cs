using System.Reflection;
using UnityEngine;

namespace TikTokLiveMod.GameEffects
{
    /// <summary>
    /// Mini-game disruption: reset current active mini-game progress.
    /// </summary>
    public static class MiniGameEffects
    {
        private static System.Type? _miniGameControllerType;
        private static System.Type? _tiresType;
        private static System.Type? _engineType;
        private static System.Type? _steeringType;
        private static System.Type? _transmissionType;

        static MiniGameEffects()
        {
            foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies())
            {
                if (asm.GetName().Name == "Project")
                {
                    _miniGameControllerType = asm.GetType("Project.Code.Gameplay.Controllers.MiniGamesController");
                    _tiresType       = asm.GetType("Project.Code.Gameplay.Interactions.TiresMiniGame");
                    _engineType      = asm.GetType("Project.Code.Gameplay.Interactions.EngineMiniGame");
                    _steeringType    = asm.GetType("Project.Code.Gameplay.Interactions.SteeringWheelMiniGame");
                    _transmissionType = asm.GetType("Project.Code.Gameplay.Interactions.TransmissionMiniGame");
                    break;
                }
            }
        }

        /// <summary>Reset whichever mini-game is currently active.</summary>
        public static void ResetCurrent()
        {
            // Try MiniGamesController first
            if (_miniGameControllerType != null)
            {
                var ctrl = Object.FindObjectOfType(_miniGameControllerType);
                if (ctrl != null)
                {
                    TryInvoke(ctrl, _miniGameControllerType, "ResetMiniGame", "Reset", "InternalEndManualMiniGame");
                    Plugin.Log.LogInfo("[MiniGame] Reset via MiniGamesController");
                    return;
                }
            }

            // Try individual mini-game types
            System.Type?[] types = { _tiresType, _engineType, _steeringType, _transmissionType };
            foreach (var t in types)
            {
                if (t == null) continue;
                var obj = Object.FindObjectOfType(t);
                if (obj != null)
                {
                    TryInvoke(obj, t, "Reset", "ResetGame", "StartOver", "Cancel");
                    Plugin.Log.LogInfo($"[MiniGame] Reset {t.Name}");
                    break;
                }
            }
        }

        private static void TryInvoke(object target, System.Type type, params string[] methodNames)
        {
            foreach (var name in methodNames)
            {
                var m = type.GetMethod(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (m != null) { m.Invoke(target, null); return; }
            }
        }
    }
}
