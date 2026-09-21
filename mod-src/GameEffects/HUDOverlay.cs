using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace TikTokLiveMod.GameEffects
{
    /// <summary>
    /// In-game IMGUI overlay: shows viewer notifications and effect toasts.
    /// </summary>
    public class HUDOverlay : MonoBehaviour
    {
        public static float BlurDarkenAlpha = 0f;

        private static readonly Queue<Toast> _toasts = new();
        private static readonly Queue<Toast> _notifs = new();
        private static Toast? _currentToast;
        private static float _toastExpiry;
        private static Texture2D? _flashTex;
        private static Texture2D? _notifBg;
        private GUIStyle? _toastStyle;
        private GUIStyle? _notifStyle;
        private GUIStyle? _userStyle;

        private void Awake()
        {
            _flashTex = new Texture2D(1, 1);
            _flashTex.SetPixel(0, 0, new Color(0, 0, 0, 1f)); // Black texture, alpha applied in OnGUI
            _flashTex.Apply();

            _notifBg = new Texture2D(1, 1);
            _notifBg.SetPixel(0, 0, new Color(0, 0, 0, 0.7f));
            _notifBg.Apply();
        }

        private void OnGUI()
        {
            if (_toastStyle == null) InitStyles();

            // Screen Blur/Darken
            if (BlurDarkenAlpha > 0f && _flashTex != null)
            {
                var oldColor = GUI.color;
                GUI.color = new Color(1, 1, 1, BlurDarkenAlpha);
                GUI.DrawTexture(new Rect(0, 0, Screen.width, Screen.height), _flashTex, ScaleMode.StretchToFill);
                GUI.color = oldColor;
            }

            // Effect toast (top center)
            if (_currentToast != null && Time.time < _toastExpiry)
            {
                float alpha = Mathf.Clamp01((_toastExpiry - Time.time) / 0.5f);
                DrawToast(_currentToast, alpha);
            }
            else if (_toasts.Count > 0)
            {
                _currentToast = _toasts.Dequeue();
                _toastExpiry = Time.time + 2.5f;
            }
            else
            {
                _currentToast = null;
            }

            // Notification stack (top-right)
            DrawNotifications();
        }

        private void DrawToast(Toast toast, float alpha)
        {
            if (_toastStyle == null) return;
            var oldAlpha = GUI.color.a;
            GUI.color = new Color(1, 1, 1, alpha);

            float w = 360f, h = 52f;
            float x = (Screen.width - w) / 2f;
            float y = 24f;

            // Background
            if (_notifBg != null)
                GUI.DrawTexture(new Rect(x - 8, y - 4, w + 16, h + 8), _notifBg, ScaleMode.StretchToFill);

            _toastStyle!.normal.textColor = new Color(1, 0.9f, 0.3f, alpha);
            GUI.Label(new Rect(x, y, w, h / 2), toast.Title, _toastStyle);

            _userStyle!.normal.textColor = new Color(0.85f, 0.85f, 0.85f, alpha);
            GUI.Label(new Rect(x, y + h / 2 - 4, w, h / 2), $"by {toast.Sub}", _userStyle);

            GUI.color = new Color(1, 1, 1, oldAlpha);
        }

        private static readonly List<(Toast t, float expiry)> _activeNotifs = new();

        private void DrawNotifications()
        {
            _activeNotifs.RemoveAll(n => Time.time > n.expiry);
            while (_notifs.Count > 0 && _activeNotifs.Count < 5)
            {
                _activeNotifs.Add((_notifs.Dequeue(), Time.time + 3f));
            }

            float startY = 80f;
            for (int i = 0; i < _activeNotifs.Count; i++)
            {
                var (notif, exp) = _activeNotifs[i];
                float alpha = Mathf.Clamp01((exp - Time.time) / 0.6f);
                float w = 260f, h = 38f;
                float x = Screen.width - w - 16f;
                float y = startY + i * (h + 6f);

                GUI.color = new Color(1, 1, 1, alpha * 0.85f);
                if (_notifBg != null)
                    GUI.DrawTexture(new Rect(x, y, w, h), _notifBg);

                _notifStyle!.normal.textColor = new Color(0.6f, 1f, 0.85f, alpha);
                GUI.Label(new Rect(x + 8, y + 4, w - 16, h / 2), notif.Title, _notifStyle);

                _userStyle!.normal.textColor = new Color(0.75f, 0.75f, 0.75f, alpha);
                GUI.Label(new Rect(x + 8, y + 20, w - 16, h / 2), notif.Sub, _userStyle);
                GUI.color = Color.white;
            }
        }

        private void InitStyles()
        {
            _toastStyle = new GUIStyle(GUI.skin.label)
            {
                fontSize = 18,
                fontStyle = FontStyle.Bold,
                alignment = TextAnchor.MiddleCenter
            };
            _notifStyle = new GUIStyle(GUI.skin.label)
            {
                fontSize = 13,
                fontStyle = FontStyle.Bold
            };
            _userStyle = new GUIStyle(GUI.skin.label)
            {
                fontSize = 11
            };
        }

        // ─── Static API ───────────────────────────────────────────────────────────

        public static void ShowEffectToast(string user, string effectLabel)
        {
            _toasts.Enqueue(new Toast { Title = $"⚡ {effectLabel}", Sub = user });
        }

        public static void ShowNotification(string user, string message)
        {
            _notifs.Enqueue(new Toast { Title = user, Sub = message });
        }

        private class Toast
        {
            public string Title = "";
            public string Sub = "";
        }
    }
}
