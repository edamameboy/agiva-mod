using System.Collections;
using UnityEngine;

namespace TikTokLiveMod.GameEffects
{
    /// <summary>
    /// Camera shake, jerk, and flash effects using Unity's Camera component.
    /// </summary>
    public static class CameraEffects
    {
        private static Coroutine? _shakeRoutine;

        public static void Shake(float intensity, float duration)
        {
            var cam = Camera.main;
            if (cam == null) return;

            // Stop any ongoing shake
            if (_shakeRoutine != null)
                Plugin.Instance.StopCoroutine(_shakeRoutine);
            _shakeRoutine = Plugin.Instance.StartCoroutine(ShakeRoutine(cam, intensity, duration));
        }

        private static IEnumerator ShakeRoutine(Camera cam, float intensity, float duration)
        {
            var original = cam.transform.localPosition;
            float elapsed = 0f;

            while (elapsed < duration)
            {
                float t = elapsed / duration;
                float currentIntensity = intensity * (1f - t); // fade out

                cam.transform.localPosition = original + (Vector3)Random.insideUnitCircle * currentIntensity;
                elapsed += Time.deltaTime;
                yield return null;
            }

            cam.transform.localPosition = original;
            _shakeRoutine = null;
        }

        public static void Jerk()
        {
            Plugin.Instance.StartCoroutine(JerkRoutine());
        }

        private static IEnumerator JerkRoutine()
        {
            var cam = Camera.main;
            if (cam == null) yield break;

            var original = cam.transform.localPosition;
            cam.transform.localPosition = original + new Vector3(Random.Range(-0.5f, 0.5f), Random.Range(-0.3f, 0.3f), 0);
            yield return new WaitForSeconds(0.15f);
            cam.transform.localPosition = original;
        }

        public static void BlurDarken()
        {
            Plugin.Instance.StartCoroutine(BlurDarkenRoutine());
        }

        private static IEnumerator BlurDarkenRoutine()
        {
            float duration = 3f;
            float elapsed = 0f;
            
            while (elapsed < duration)
            {
                elapsed += Time.deltaTime;
                float t = elapsed / duration;
                
                // Fade in to 0.7f quickly, hold, then fade out
                if (t < 0.2f)
                    HUDOverlay.BlurDarkenAlpha = Mathf.Lerp(0f, 0.85f, t / 0.2f);
                else if (t > 0.8f)
                    HUDOverlay.BlurDarkenAlpha = Mathf.Lerp(0.85f, 0f, (t - 0.8f) / 0.2f);
                else
                    HUDOverlay.BlurDarkenAlpha = 0.85f;
                    
                yield return null;
            }
            HUDOverlay.BlurDarkenAlpha = 0f;
        }
    }
}
