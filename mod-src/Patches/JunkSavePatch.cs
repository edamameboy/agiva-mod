using HarmonyLib;
using System;
using UnityEngine;
using System.Collections;
using System.Reflection;

namespace TikTokLiveMod.Patches
{
    [HarmonyPatch(typeof(Project.Code.Gameplay.Interactions.Pickups.Pickup))]
    public class Pickup_SetPickupParent_Patch
    {
        private static Project.Code.Gameplay.Controllers.JunkZoneController _cachedController;
        private static FieldInfo _listField;
        private static FieldInfo _pickupParentField;

        [HarmonyPatch("SetPickupParent")]
        [HarmonyPostfix]
        static void Postfix(Project.Code.Gameplay.Interactions.Pickups.Pickup __instance, Project.Code.Gameplay.Interactions.Pickups.IPickupParent newPickupParent, ref bool __result)
        {
            if (!__result) return;
            if (newPickupParent != null) return; // Only care about dropping

            if (!(__instance is Project.Code.Gameplay.Interactions.Pickups.JunkPickup)) return;

            InjectToJunkZone(__instance);
        }

        public static void InjectToJunkZone(Project.Code.Gameplay.Interactions.Pickups.Pickup pickup)
        {
            try
            {
                if (_cachedController == null)
                {
                    _cachedController = UnityEngine.Object.FindObjectOfType<Project.Code.Gameplay.Controllers.JunkZoneController>();
                    if (_cachedController != null)
                    {
                        _listField = _cachedController.GetType().GetField("_junkPickups", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                        _pickupParentField = typeof(Project.Code.Gameplay.Interactions.Pickups.Pickup).GetField("_pickupParent", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                    }
                }

                if (_cachedController != null && _listField != null)
                {
                    var list = _listField.GetValue(_cachedController) as IList;
                    if (list != null && !list.Contains(pickup))
                    {
                        list.Add(pickup);
                        // Re-parent it to the zone so localPosition saves correctly
                        pickup.transform.SetParent(_cachedController.transform, true);
                        _pickupParentField?.SetValue(pickup, _cachedController);
                    }
                }
            }
            catch (Exception ex)
            {
                Plugin.Log.LogError($"[PickupPatch] Error injecting junk: {ex.Message}");
            }
        }
    }

    [HarmonyPatch(typeof(Project.Code.Gameplay.Interactions.Pickups.JunkPickup), "Start")]
    public class JunkPickup_Start_Patch
    {
        static void Postfix(Project.Code.Gameplay.Interactions.Pickups.JunkPickup __instance)
        {
            if (__instance.transform.parent != null)
                return; // Skip normal loading

            Pickup_SetPickupParent_Patch.InjectToJunkZone(__instance);
        }
    }

    [HarmonyPatch(typeof(Project.Code.Gameplay.Controllers.JunkZoneController), "Save")]
    public class JunkZoneController_Save_Patch
    {
        static void Prefix(Project.Code.Gameplay.Controllers.JunkZoneController __instance)
        {
            var listField = __instance.GetType().GetField("_junkPickups", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            if (listField != null)
            {
                var list = listField.GetValue(__instance) as IList;
                if (list != null)
                {
                    for (int i = list.Count - 1; i >= 0; i--)
                    {
                        var item = list[i];
                        // In Unity, destroyed objects evaluate to null when compared, or return true for Equals(null)
                        if (item == null || item.Equals(null))
                        {
                            list.RemoveAt(i);
                        }
                        else if (item is UnityEngine.Component comp && comp == null)
                        {
                            list.RemoveAt(i);
                        }
                    }
                }
            }
        }
    }
}
