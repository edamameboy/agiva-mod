using System;
using System.IO;
using UnityEngine;

namespace TikTokLiveMod
{
    [Serializable]
    public class ModConfigData
    {
        // Nominal Parameters
        public int GachaAddJunkAmount = 50;
        public int GachaRemoveJunkAmount = 10;
        public int GachaAutoJumpCount = 10;
        public int GachaEnergyDrinkAmount = 5;
        public int GiftJunkMultiplier = 3;
        public int LikeAddJunkAmount = 10;
        public int SpawnCarGachaAmount = 1;
        public int SpawnCarGiftAmount = 1;
        public int GachaJackpotAmount = 5000;
        public int GachaBankruptAmount = -1000;

        // Gacha Percentages (10 Options)
        public float OddsMaxStamina = 10f;
        public float OddsZeroStamina = 10f;
        public float OddsJackpot = 5f;
        public float OddsBankrupt = 5f;
        public float OddsAddJunk = 15f;
        public float OddsRemoveJunk = 15f;
        public float OddsForceClose = 1f;
        public float OddsAutoJump = 19f;
        public float OddsEnergyDrink = 20f;
        public float OddsSpawnCar = 5f;
    }

    public static class ModConfig
    {
        public static ModConfigData Data = new ModConfigData();
        private static string ConfigPath => Path.Combine(Application.dataPath, "../BepInEx/config/TikTokLiveMod.json");

        public static void Load()
        {
            try
            {
                if (File.Exists(ConfigPath))
                {
                    string json = File.ReadAllText(ConfigPath);
                    Data = JsonUtility.FromJson<ModConfigData>(json);
                    Plugin.Log.LogInfo("[ModConfig] Configuration loaded.");
                }
                else
                {
                    Save();
                }
                NormalizeOdds();
            }
            catch (Exception ex)
            {
                Plugin.Log.LogError($"[ModConfig] Failed to load config: {ex.Message}");
            }
        }

        public static void Save()
        {
            try
            {
                NormalizeOdds();
                string json = JsonUtility.ToJson(Data, true);
                
                string dir = Path.GetDirectoryName(ConfigPath);
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                
                File.WriteAllText(ConfigPath, json);
                Plugin.Log.LogInfo("[ModConfig] Configuration saved.");
            }
            catch (Exception ex)
            {
                Plugin.Log.LogError($"[ModConfig] Failed to save config: {ex.Message}");
            }
        }

        public static void NormalizeOdds()
        {
            float total = Data.OddsMaxStamina + Data.OddsZeroStamina + Data.OddsJackpot + Data.OddsBankrupt +
                          Data.OddsAddJunk + Data.OddsRemoveJunk + Data.OddsForceClose + Data.OddsAutoJump + 
                          Data.OddsEnergyDrink + Data.OddsSpawnCar;

            if (total <= 0) total = 1f; // Prevent division by zero

            Data.OddsMaxStamina = (Data.OddsMaxStamina / total) * 100f;
            Data.OddsZeroStamina = (Data.OddsZeroStamina / total) * 100f;
            Data.OddsJackpot = (Data.OddsJackpot / total) * 100f;
            Data.OddsBankrupt = (Data.OddsBankrupt / total) * 100f;
            Data.OddsAddJunk = (Data.OddsAddJunk / total) * 100f;
            Data.OddsRemoveJunk = (Data.OddsRemoveJunk / total) * 100f;
            Data.OddsForceClose = (Data.OddsForceClose / total) * 100f;
            Data.OddsAutoJump = (Data.OddsAutoJump / total) * 100f;
            Data.OddsEnergyDrink = (Data.OddsEnergyDrink / total) * 100f;
            Data.OddsSpawnCar = (Data.OddsSpawnCar / total) * 100f;
        }
    }
}
