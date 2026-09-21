using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using UnityEngine;
using UnityEngine.UI;

namespace TikTokLiveMod.GameEffects
{
    public static class GachaEffects
    {
        private static Texture2D _gridTex;

        private static string[] GetOptions()
        {
            var d = ModConfig.Data;
            return new string[] {
                "🔋 MAX STAMINA",
                "🔴 0 STAMINA",
                "💸 +$5000 JACKPOT",
                "📉 -$1000 BANKRUPT",
                $"🗑️ +{d.GachaAddJunkAmount} JUNK",
                $"🧹 -{d.GachaRemoveJunkAmount} JUNK",
                "💀 FORCE CLOSE",
                $"🦘 AUTO JUMP x{d.GachaAutoJumpCount}",
                (d.GachaEnergyDrinkAmount >= 0 ? $"🥤 +{d.GachaEnergyDrinkAmount} ENERGY DRINK" : $"🥤 {d.GachaEnergyDrinkAmount} ENERGY DRINK"),
                $"🚗 +{d.SpawnCarGachaAmount} JUNK CAR"
            };
        }

        private static int GetWeightedRandomIndex()
        {
            var d = ModConfig.Data;
            float[] weights = new float[] {
                d.OddsMaxStamina, d.OddsZeroStamina, d.OddsJackpot, d.OddsBankrupt,
                d.OddsAddJunk, d.OddsRemoveJunk, d.OddsForceClose, d.OddsAutoJump, d.OddsEnergyDrink,
                d.OddsSpawnCar
            };
            
            float total = 0;
            foreach (var w in weights) total += w;
            
            float rand = UnityEngine.Random.Range(0, total);
            float current = 0;
            
            for (int i = 0; i < weights.Length; i++)
            {
                current += weights[i];
                if (rand <= current) return i;
            }
            return 0;
        }

        public static void RollGacha(string user)
        {
            Plugin.Instance.StartCoroutine(GachaRoutine(user));
        }

        private static IEnumerator GachaRoutine(string user)
        {
            // Setup Neo-Brutalism UI Canvas
            var canvasObj = NeoUIBuilder.CreateCanvas("GachaCanvas", 9999);
            
            // Transparent container
            var box = new GameObject("Box");
            box.transform.SetParent(canvasObj.transform, false);
            var boxRect = box.AddComponent<RectTransform>();
            boxRect.anchorMin = new Vector2(0.2f, 0.3f);
            boxRect.anchorMax = new Vector2(0.8f, 0.7f);
            boxRect.offsetMin = Vector2.zero;
            boxRect.offsetMax = Vector2.zero;
            
            // Scale down by 20%
            boxRect.localScale = new Vector3(0.8f, 0.8f, 0.8f);
            
            var title = NeoUIBuilder.CreateText(box.transform, "Title", $"<b>{user}'s Gacha Spin!</b>", 36, Color.white, TextAnchor.UpperCenter);
            title.GetComponent<Text>().supportRichText = true;
            title.GetComponent<RectTransform>().anchoredPosition = new Vector2(0, -20);
            var titleShadow = title.gameObject.AddComponent<UnityEngine.UI.Shadow>();
            titleShadow.effectColor = Color.black;
            titleShadow.effectDistance = new Vector2(4, -4);
            
            var text = NeoUIBuilder.CreateText(box.transform, "SpinText", "", 48, Color.white, TextAnchor.MiddleCenter);
            var textShadow = text.AddComponent<UnityEngine.UI.Shadow>();
            textShadow.effectColor = Color.black;
            textShadow.effectDistance = new Vector2(6, -6);
            
            // Spin Animation
            float duration = 3f;
            float elapsed = 0f;
            
            var options = GetOptions();
            int finalIndex = GetWeightedRandomIndex();
            
            while (elapsed < duration)
            {
                elapsed += Time.deltaTime;
                float t = elapsed / duration;
                
                int currentDisplay = UnityEngine.Random.Range(0, options.Length);
                text.GetComponent<Text>().text = options[currentDisplay];
                
                float delay = Mathf.Lerp(0.02f, 0.4f, t * t * t);
                yield return new WaitForSeconds(delay);
                elapsed += delay;
            }

            // Reveal
            var tComp = text.GetComponent<Text>();
            tComp.text = options[finalIndex];
            tComp.color = new Color(0.2f, 0.9f, 0.2f); // Neo Green
            tComp.fontSize = 64;
            
            // Punch scale effect
            var rect = text.GetComponent<RectTransform>();
            rect.localScale = new Vector3(1.2f, 1.2f, 1.2f);
            
            yield return new WaitForSeconds(2.0f);
            
            // Apply Effect
            ApplyEffect(finalIndex);

            // Fade out UI
            GameObject.Destroy(canvasObj);
        }

        private static void ApplyEffect(int index)
        {
            Type paramServiceType = null;
            Type paramTypeEnum = null;

            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                if (asm.GetName().Name == "Project")
                {
                    paramServiceType = asm.GetType("Project.Code.Core.Services.ParametersService");
                    paramTypeEnum = asm.GetType("Project.Code.Gameplay.Controllers.ParameterType");
                    break;
                }
            }

            var pService = GetServiceInstance(paramServiceType);
            var setParam = paramServiceType?.GetMethod("SetParameter", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            var sumParam = paramServiceType?.GetMethod("SumParameter", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            var getMaxE = paramServiceType?.GetMethod("GetMaxEnergy", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);

            var d = ModConfig.Data;

            switch (index)
            {
                case 0: // +100% Stamina
                    if (pService != null && setParam != null && getMaxE != null)
                    {
                        float maxE = (int)getMaxE.Invoke(pService, null);
                        setParam.Invoke(pService, new object[] { Enum.Parse(paramTypeEnum, "Energy"), maxE });
                    }
                    break;
                case 1: // 0 Stamina
                    if (pService != null && setParam != null)
                        setParam.Invoke(pService, new object[] { Enum.Parse(paramTypeEnum, "Energy"), 0f });
                    break;
                case 2: // Jackpot
                    if (pService != null && sumParam != null)
                        sumParam.Invoke(pService, new object[] { Enum.Parse(paramTypeEnum, "Money"), (float)d.GachaJackpotAmount });
                    break;
                case 3: // Bankrupt
                    if (pService != null && sumParam != null)
                        sumParam.Invoke(pService, new object[] { Enum.Parse(paramTypeEnum, "Money"), (float)d.GachaBankruptAmount });
                    break;
                case 4: // +Junk
                    SpawnEffects.SpawnJunkManual(d.GachaAddJunkAmount);
                    break;
                case 5: // -Junk
                    SpawnEffects.RemoveJunk(d.GachaRemoveJunkAmount);
                    break;
                case 6: // Force Close
                    Application.Quit();
                    break;
                case 7: // Auto Jump
                    PlayerEffects.AutoJump(d.GachaAutoJumpCount);
                    break;
                case 8: // +/- Energy Drink (Inventory)
                    PlayerEffects.ModifyEnergyDrink(d.GachaEnergyDrinkAmount);
                    break;
                case 9: // Spawn Junk Car
                    SpawnEffects.SpawnCarGacha();
                    break;
            }

            // Force the game to save the updated parameters (money, energy, inventory)
            if (pService != null)
            {
                var saveMethod = pService.GetType().GetMethod("Save", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                saveMethod?.Invoke(pService, null);
            }
        }

        public static object GetServiceInstance(Type serviceType)
        {
            if (serviceType == null) return null;
            try {
                var instProp = serviceType.GetProperty("Instance", BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy);
                if (instProp != null) return instProp.GetValue(null);
                
                var instField = serviceType.GetField("Instance", BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy);
                if (instField != null) return instField.GetValue(null);
                
                Type pickupControllerType = null;
                foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                {
                    if (asm.GetName().Name == "Project") {
                        pickupControllerType = asm.GetType("Project.Code.Gameplay.Player.PlayerPickupController");
                        break;
                    }
                }
                if (pickupControllerType != null) {
                    var pickupController = UnityEngine.Object.FindObjectOfType(pickupControllerType);
                    if (pickupController != null) {
                        foreach (var f in pickupControllerType.GetFields(BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance)) {
                            if (f.FieldType == serviceType) return f.GetValue(pickupController);
                        }
                    }
                }
                
                if (serviceType.IsSubclassOf(typeof(UnityEngine.Object)))
                    return UnityEngine.Object.FindObjectOfType(serviceType);
                    
                return null;
            } catch (Exception ex) {
                Plugin.Log.LogError($"[GachaEffects] Error getting service {serviceType.Name}: {ex.Message}");
                return null;
            }
        }
    }
}
