using System.Reflection;
using UnityEngine;

namespace TikTokLiveMod.GameEffects
{
    /// <summary>
    /// Parameter (stamina/energy) effects.
    /// </summary>
    public static class ParameterEffects
    {
        private static System.Type? _paramControllerType;

        static ParameterEffects()
        {
            foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies())
            {
                if (asm.GetName().Name == "Project")
                {
                    _paramControllerType = asm.GetType("Project.Code.Gameplay.Controllers.ParametersController");
                    break;
                }
            }
        }

        /// <summary>Drain a percentage of the player's energy (0.0 - 1.0).</summary>
        public static void DrainEnergy(float percentage)
        {
            if (_paramControllerType == null) { Plugin.Log.LogWarning("[Param] ParametersController not found"); return; }

            var ctrl = Object.FindObjectOfType(_paramControllerType);
            if (ctrl == null) return;

            // Try to find an energy/stamina field
            var energyField = _paramControllerType.GetField("energy",
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                ?? _paramControllerType.GetField("_energy",
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                ?? _paramControllerType.GetField("stamina",
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);

            if (energyField != null)
            {
                var val = (float)energyField.GetValue(ctrl);
                var newVal = Mathf.Max(0f, val - val * percentage);
                energyField.SetValue(ctrl, newVal);
                Plugin.Log.LogInfo($"[Param] Energy: {val:F1} → {newVal:F1}");
                return;
            }

            // Try a method approach
            var drainMethod = _paramControllerType.GetMethod("DrainEnergy",
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                ?? _paramControllerType.GetMethod("ReduceEnergy",
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            drainMethod?.Invoke(ctrl, new object[] { percentage });
        }
    }
}
