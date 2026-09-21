using System;
using System.Reflection;
using UnityEngine;
using System.Diagnostics;
using System.Collections;

namespace TikTokLiveMod.GameEffects
{
    public static class SystemEffects
    {
        private static Type _parametersServiceType;
        private static Type _parameterTypeEnum;
        private static Type _saveServiceType;

        static SystemEffects()
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                if (asm.GetName().Name == "Project")
                {
                    _parametersServiceType = asm.GetType("Project.Code.Core.Services.ParametersService");
                    _parameterTypeEnum = asm.GetType("Project.Code.Gameplay.Controllers.ParameterType");
                    _saveServiceType = asm.GetType("Project.Code.Core.Saves.SaveService");
                    break;
                }
            }
        }

        public static void RefillStamina()
        {
            if (_parametersServiceType == null || _parameterTypeEnum == null) return;
            var service = GetServiceInstance(_parametersServiceType);
            if (service == null) return;

            var setParam = _parametersServiceType.GetMethod("SetParameter", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            var getMaxEnergy = _parametersServiceType.GetMethod("GetMaxEnergy", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            
            if (setParam != null && getMaxEnergy != null)
            {
                float maxEnergy = (int)getMaxEnergy.Invoke(service, null);
                object energyEnum = Enum.Parse(_parameterTypeEnum, "Energy");
                setParam.Invoke(service, new object[] { energyEnum, maxEnergy });
            }
        }

        public static void AddStaminaDrink()
        {
            if (_parametersServiceType == null || _parameterTypeEnum == null) return;
            var service = GetServiceInstance(_parametersServiceType);
            if (service == null) return;

            var sumParam = _parametersServiceType.GetMethod("SumParameter", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            if (sumParam != null)
            {
                object drinkEnum = Enum.Parse(_parameterTypeEnum, "EnergyBottle");
                sumParam.Invoke(service, new object[] { drinkEnum, 1f });
            }
        }

        public static void ResetProgress()
        {
            Plugin.Instance.StartCoroutine(ResetProgressRoutine());
        }

        private static IEnumerator ResetProgressRoutine()
        {
            if (_saveServiceType != null)
            {
                var saveService = GetServiceInstance(_saveServiceType);
                if (saveService != null)
                {
                    var deleteMethod = _saveServiceType.GetMethod("DeleteGlobalSave", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                    deleteMethod?.Invoke(saveService, null);
                    Plugin.Log.LogInfo("[SystemEffects] Save wiped.");
                }
            }

            yield return new WaitForSeconds(1f);

            try
            {
                string exePath = Application.dataPath.Replace("_Data", ".exe");
                Process.Start(exePath);
                Application.Quit();
            }
            catch (Exception e)
            {
                Plugin.Log.LogError($"[SystemEffects] Failed to restart: {e.Message}");
                Application.Quit();
            }
        }

        public static void ForceClose()
        {
            Application.Quit();
        }

        private static object GetServiceInstance(Type serviceType)
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
                Plugin.Log.LogError($"[SystemEffects] Error getting service {serviceType.Name}: {ex.Message}");
                return null;
            }
        }
    }
}
