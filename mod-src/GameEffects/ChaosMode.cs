using System.Collections;
using UnityEngine;

namespace TikTokLiveMod.GameEffects
{
    /// <summary>
    /// CHAOS MODE — fires all effects simultaneously for a duration.
    /// </summary>
    public static class ChaosMode
    {
        private static bool _active;

        public static void Activate(string triggeredBy)
        {
            if (_active) return;
            Plugin.Instance.StartCoroutine(ChaosRoutine(triggeredBy));
        }

        private static IEnumerator ChaosRoutine(string user)
        {
            _active = true;
            Plugin.Log.LogInfo($"[CHAOS] Activated by {user}!");
            HUDOverlay.ShowEffectToast(user, "⚡⚡ CHAOS MODE ⚡⚡");

            float duration = 5f;
            float elapsed = 0f;
            float interval = 0.8f;
            float nextAt = 0f;

            while (elapsed < duration)
            {
                if (elapsed >= nextAt)
                {
                    // Fire random combo of effects
                    CameraEffects.Shake(0.5f, 0.6f);

                    var roll = Random.Range(0, 5);
                    switch (roll)
                    {
                        case 0: PlayerEffects.Slip(); break;
                        case 1: PlayerEffects.SwitchTool(); break;
                        case 2: MiniGameEffects.ResetCurrent(); break;
                        case 3: SpawnEffects.SpawnJunk(); break;
                        case 4: ParameterEffects.DrainEnergy(0.08f); break;
                    }

                    CameraEffects.BlurDarken();
                    nextAt += interval;
                    interval = Mathf.Max(0.4f, interval - 0.05f); // speed up over time
                }

                elapsed += Time.deltaTime;
                yield return null;
            }

            Plugin.Log.LogInfo("[CHAOS] Done.");
            _active = false;
        }
    }
}
