using System;
using System.Collections.Generic;
using UnityEngine.Networking;
using System.Threading.Tasks;
using UnityEngine;

namespace TikTokLiveMod
{
    public static class AuthManager
    {
        public static bool IsAuthorized { get; private set; } = false;
        public static bool HasChecked { get; private set; } = false;
        private static HashSet<string> _whitelist = new HashSet<string>();

        // URL encrypted with XOR 0x42
        private static readonly byte[] EncryptedUrl = new byte[] 
        {
            0x2A, 0x36, 0x36, 0x32, 0x31, 0x78, 0x6D, 0x6D, 0x30, 0x23, 0x35, 0x6C, 0x25, 0x2B, 0x36, 0x2A, 
            0x37, 0x20, 0x37, 0x31, 0x27, 0x30, 0x21, 0x2D, 0x2C, 0x36, 0x27, 0x2C, 0x36, 0x6C, 0x21, 0x2D, 
            0x2F, 0x6D, 0x27, 0x26, 0x23, 0x2F, 0x23, 0x2F, 0x27, 0x20, 0x2D, 0x3B, 0x6D, 0x23, 0x25, 0x2B, 
            0x34, 0x23, 0x6F, 0x2F, 0x2D, 0x26, 0x6D, 0x2F, 0x23, 0x2B, 0x2C, 0x6D, 0x35, 0x2A, 0x2B, 0x36, 
            0x27, 0x2E, 0x2B, 0x31, 0x36, 0x6C, 0x36, 0x3A, 0x36
        };

        private static string GetUrl()
        {
            char[] chars = new char[EncryptedUrl.Length];
            for (int i = 0; i < EncryptedUrl.Length; i++)
            {
                chars[i] = (char)(EncryptedUrl[i] ^ 0x42);
            }
            return new string(chars);
        }

        public static async Task CheckAuthorizationAsync(string username)
        {
            HasChecked = true;
            if (string.IsNullOrEmpty(username)) 
            {
                IsAuthorized = false;
                return;
            }

            try
            {
                using (var www = UnityWebRequest.Get(GetUrl()))
                {
                    www.timeout = 10;
                    var operation = www.SendWebRequest();
                    
                    while (!operation.isDone)
                    {
                        await Task.Yield();
                    }

                    if (www.isNetworkError || www.isHttpError)
                    {
                        throw new Exception(www.error);
                    }

                    string content = www.downloadHandler.text;
                    
                    _whitelist.Clear();
                    foreach (var line in content.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
                    {
                        _whitelist.Add(line.Trim().ToLowerInvariant());
                    }

                    string cleanUser = username.Replace("@", "").Trim().ToLowerInvariant();
                    IsAuthorized = _whitelist.Contains(cleanUser);
                    
                    if (IsAuthorized)
                    {
                        Plugin.Log.LogInfo($"[Auth] Account '{cleanUser}' verified successfully.");
                    }
                    else
                    {
                        Plugin.Log.LogWarning($"[Auth] UNREGISTERED ACCOUNT '{cleanUser}'! Mod is disabled.");
                    }
                }
            }
            catch (Exception ex)
            {
                Plugin.Log.LogError($"[Auth] Failed to verify account: {ex.Message}");
                IsAuthorized = false; // Fail secure
            }
        }
    }
}
