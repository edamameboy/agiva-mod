using System;
using System.Reflection;
using System.Collections;
using UnityEngine;

namespace TikTokLiveMod.GameEffects
{
    /// <summary>
    /// Player-related disruption effects: slip, tool switch, teleport, powerwash burst.
    /// Uses reflection to access game classes since they are in Project.dll.
    /// </summary>
    public static class PlayerEffects
    {
        // Cache reflected types
        private static System.Type? _playerMovementType;
        private static System.Type? _playerToolsType;
        private static System.Type? _powerwashType;

        static PlayerEffects()
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                var name = asm.GetName().Name;
                if (name == "Project")
                {
                    _playerMovementType = asm.GetType("Project.Code.Gameplay.Player.Controllers.PlayerMovementController");
                    _playerToolsType    = asm.GetType("Project.Code.Gameplay.Player.Controllers.PlayerToolsController");
                    _powerwashType      = asm.GetType("Project.Code.Gameplay.Player.Tools.PowerWashTool");
                    break;
                }
            }
        }

        /// <summary>Apply a brief knockdown force to the player character.</summary>
        public static void Slip()
        {
            Plugin.Instance.StartCoroutine(SlipRoutine());
        }

        private static IEnumerator SlipRoutine()
        {
            // Find player via tag or CharacterController
            var player = GameObject.FindGameObjectWithTag("Player");
            if (player == null)
            {
                Plugin.Log.LogWarning("[PlayerEffects] Player not found");
                yield break;
            }

            var rb = player.GetComponentInChildren<Rigidbody>();
            var cc = player.GetComponentInChildren<CharacterController>();

            if (rb != null)
            {
                Plugin.Log.LogInfo("[PlayerEffects] Slipping via Rigidbody");
                rb.isKinematic = false;
                rb.AddForce(new Vector3(UnityEngine.Random.Range(-5f, 5f), 3f, UnityEngine.Random.Range(-5f, 5f)), ForceMode.Impulse);
                rb.AddTorque(new Vector3(UnityEngine.Random.Range(-5f, 5f), UnityEngine.Random.Range(-5f, 5f), UnityEngine.Random.Range(-5f, 5f)), ForceMode.Impulse);
            }
            else if (cc != null)
            {
                Plugin.Log.LogInfo("[PlayerEffects] Slipping via CharacterController");
                // Move CC directly
                var slipDir = new Vector3(UnityEngine.Random.Range(-2f, 2f), 0.5f, UnityEngine.Random.Range(-2f, 2f));
                for(int i = 0; i < 10; i++) 
                {
                    cc.Move(slipDir * Time.deltaTime * 10f);
                    yield return null;
                }
            }
            else
            {
                Plugin.Log.LogInfo("[PlayerEffects] Slipping via Transform fallback");
                // Manual transform jitter/slip
                var startPos = player.transform.position;
                var slipDir = new Vector3(UnityEngine.Random.Range(-2f, 2f), 0.5f, UnityEngine.Random.Range(-2f, 2f));
                for(int i = 0; i < 15; i++)
                {
                    player.transform.position += slipDir * Time.deltaTime * 5f;
                    yield return null;
                }
            }
            yield return null;
        }

        /// <summary>Switch the player's active tool to a random one.</summary>
        public static void SwitchTool()
        {
            // Try to find PlayerToolsController and invoke tool switch
            var toolsObj = GameObject.FindObjectOfType<MonoBehaviour>(); // broad search
            if (_playerToolsType == null) { Plugin.Log.LogWarning("[PlayerEffects] PlayerToolsController type not found"); return; }

            var toolsController = UnityEngine.Object.FindObjectOfType(_playerToolsType);
            if (toolsController == null) return;

            // Try invoking a random tool index (typical pattern: SetTool(int index))
            var setToolMethod = _playerToolsType.GetMethod("SetTool",
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            if (setToolMethod != null)
            {
                int randomTool = UnityEngine.Random.Range(0, 3); // 0=wrench, 1=wash, 2=powerwash
                setToolMethod.Invoke(toolsController, new object[] { randomTool });
            }
        }

        public static void DropItem()
        {
            if (_playerToolsType == null) return;
            var toolsController = UnityEngine.Object.FindObjectOfType(_playerToolsType);
            if (toolsController != null)
            {
                var dropToolMethod = _playerToolsType.GetMethod("DropTool", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                                  ?? _playerToolsType.GetMethod("DeselectTool", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                dropToolMethod?.Invoke(toolsController, null);
            }

            // Also try PlayerPickupController to drop held boxes
            System.Type? pickupType = null;
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                if (asm.GetName().Name == "Project")
                {
                    pickupType = asm.GetType("Project.Code.Gameplay.Player.PlayerPickupController");
                    break;
                }
            }

            if (pickupType != null)
            {
                var pickupController = UnityEngine.Object.FindObjectOfType(pickupType);
                if (pickupController != null)
                {
                    var dropMethod = pickupType.GetMethod("DropByPlayer", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                                  ?? pickupType.GetMethod("Drop", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                    dropMethod?.Invoke(pickupController, new object[] { 0f });
                }
            }
        }

        public static void Teleport()
        {
            var player = GameObject.FindGameObjectWithTag("Player");
            if (player == null) return;

            var cc = player.GetComponent<CharacterController>();
            if (cc != null) cc.enabled = false;
            
            float angle = UnityEngine.Random.Range(0f, Mathf.PI * 2);
            float distance = UnityEngine.Random.Range(10f, 25f);
            var offset = new Vector3(Mathf.Cos(angle) * distance, 0, Mathf.Sin(angle) * distance);
            
            player.transform.position += offset;
            
            if (cc != null) cc.enabled = true;
        }

        public static void AutoJump(int count = 10)
        {
            Plugin.Instance.StartCoroutine(AutoJumpRoutine(count));
        }

        private static IEnumerator AutoJumpRoutine(int count)
        {
            var player = GameObject.FindGameObjectWithTag("Player");
            if (player == null) yield break;
            var cc = player.GetComponent<CharacterController>();

            for (int i = 0; i < count; i++)
            {
                float jumpTime = 0.25f;
                float elapsed = 0f;
                while (elapsed < jumpTime)
                {
                    if (cc != null) cc.Move(Vector3.up * Time.deltaTime * 8f);
                    else player.transform.position += Vector3.up * Time.deltaTime * 8f;
                    elapsed += Time.deltaTime;
                    yield return null;
                }
                
                yield return new WaitForSeconds(UnityEngine.Random.Range(0.4f, 0.8f));
            }
        }

        public static void ModifyEnergyDrink(int amount)
        {
            try
            {
                System.Type? paramServiceType = null;
                System.Type? paramTypeEnum = null;

                foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                {
                    if (asm.GetName().Name == "Project")
                    {
                        paramServiceType = asm.GetType("Project.Code.Core.Services.ParametersService");
                        paramTypeEnum = asm.GetType("Project.Code.Gameplay.Controllers.ParameterType");
                        break;
                    }
                }

                if (paramServiceType == null || paramTypeEnum == null) return;

                object pService = GachaEffects.GetServiceInstance(paramServiceType);

                if (pService == null) return;

                var sumParam = paramServiceType.GetMethod("SumParameter", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                var getValue = paramServiceType.GetMethod("GetValue", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                
                if (sumParam != null && getValue != null)
                {
                    var energyBottleEnum = Enum.Parse(paramTypeEnum, "EnergyBottle");
                    
                    if (amount < 0)
                    {
                        // Check current value so we don't go below 0
                        float current = (float)getValue.Invoke(pService, new object[] { energyBottleEnum });
                        if (current + amount < 0) amount = (int)-current;
                    }

                    if (amount != 0)
                    {
                        sumParam.Invoke(pService, new object[] { energyBottleEnum, (float)amount });
                        Plugin.Log.LogInfo($"[PlayerEffects] Modified EnergyBottle by {amount}");
                        
                        var saveMethod = paramServiceType.GetMethod("Save", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                        saveMethod?.Invoke(pService, null);
                    }
                }
            }
            catch (Exception ex)
            {
                Plugin.Log.LogError($"[PlayerEffects] ModifyEnergyDrink Error: {ex.Message}");
            }
        }
    }
}
