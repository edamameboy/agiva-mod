using System.Reflection;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace TikTokLiveMod.GameEffects
{
    /// <summary>
    /// World spawn effects: junk, customer cars, dog.
    /// </summary>
    public static class SpawnEffects
    {
        private static System.Type? _spawnControllerType;
        private static System.Type? _dogBrainType;
        private static System.Type? _junkZoneType;
        private static System.Type? _junkPickupType;
        private static System.Type? _interactableType;
        private static System.Type? _trashCarType;
        
        private static List<Component> _cachedCarTemplates = new List<Component>();
        private static List<Component> _cachedJunkTemplates = new List<Component>();
        private static Component _cachedJunkZone;

        static SpawnEffects()
        {
            foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies())
            {
                if (asm.GetName().Name == "Project")
                {
                    _spawnControllerType = asm.GetType("Project.Code.Gameplay.Controllers.SpawnController");
                    _dogBrainType        = asm.GetType("Project.Code.Gameplay.Interactions.DogBrain");
                    _junkZoneType        = asm.GetType("Project.Code.Gameplay.Controllers.JunkZoneController");
                    _junkPickupType      = asm.GetType("Project.Code.Gameplay.Interactions.Pickups.JunkPickup");
                    _interactableType    = asm.GetType("Project.Code.Core.Player.Interaction.Interactable");
                    _trashCarType        = asm.GetTypes().FirstOrDefault(t => t.Name == "TrashCar");
                    break;
                }
            }
        }

        /// <summary>Spawn junk near the player based on coins.</summary>
        public static void SpawnJunk(int coins = 1, string source = "")
        {
            int totalSpawns;

            if (source == "gift")
            {
                // Jika dari gift, gunakan multiplier gift
                totalSpawns = Mathf.Max(1, coins * ModConfig.Data.GiftJunkMultiplier);
            }
            else if (source == "like" || source == "like_event")
            {
                // Jika dari likes, gunakan LikeAddJunkAmount
                totalSpawns = ModConfig.Data.LikeAddJunkAmount;
            }
            else
            {
                // Jika gacha (atau default)
                totalSpawns = ModConfig.Data.GachaAddJunkAmount;
            }
            
            Plugin.Instance.StartCoroutine(SpawnJunkRoutine(totalSpawns));
        }

        public static void SpawnJunkManual(int amount)
        {
            Plugin.Instance.StartCoroutine(SpawnJunkRoutine(amount));
        }

        public static void SpawnCarGacha()
        {
            int amount = ModConfig.Data.SpawnCarGachaAmount;
            SpawnCarInternal(amount);
        }

        public static void SpawnCarGift(int coins = 1)
        {
            int amount = ModConfig.Data.SpawnCarGiftAmount * coins;
            SpawnCarInternal(amount);
        }

        private static void SpawnCarInternal(int amount)
        {
            // Cap at a reasonable amount to avoid freezing
            amount = Mathf.Clamp(amount, 1, 5); 
            Plugin.Instance.StartCoroutine(SpawnCarRoutine(amount));
        }

        private static System.Collections.IEnumerator SpawnCarRoutine(int amount)
        {
            if (Plugin.Instance == null) yield break;

            Plugin.Log.LogInfo($"[Spawn] Starting to drop {amount} junk cars via Dummy Physics Drop!");

            var player = UnityEngine.GameObject.FindGameObjectWithTag("Player");
            if (player == null)
            {
                Plugin.Log.LogError("[Spawn] Player not found!");
                yield break;
            }

            _cachedCarTemplates.RemoveAll(t => t == null || !t.gameObject.activeInHierarchy);
            if (_cachedCarTemplates.Count == 0)
            {
                if (_trashCarType == null)
                {
                    Plugin.Log.LogError("[Spawn] Could not find TrashCar type in Project assembly!");
                    yield break;
                }

                var allTrashCars = UnityEngine.Object.FindObjectsOfType(_trashCarType);
                foreach (var t in allTrashCars)
                {
                    var comp = t as UnityEngine.Component;
                    if (comp != null && comp.gameObject.activeInHierarchy)
                    {
                        _cachedCarTemplates.Add(comp);
                    }
                }
            }

            if (_cachedCarTemplates.Count == 0)
            {
                Plugin.Log.LogError("[Spawn] Could not find any active TrashCar templates in the scene!");
                yield break;
            }

            Plugin.Log.LogInfo($"[Spawn] Found {_cachedCarTemplates.Count} TrashCar templates.");
            var rnd = new System.Random();
            var fallingDummies = new System.Collections.Generic.Dictionary<UnityEngine.GameObject, UnityEngine.Component>();

            for (int i = 0; i < amount; i++)
            {
                var template = _cachedCarTemplates[rnd.Next(_cachedCarTemplates.Count)];
                Vector3 spawnPos = player.transform.position + player.transform.forward * 5f + Vector3.up * (8f + (i * 4f));
                
                // 1. Create a physical dummy
                var dummy = UnityEngine.Object.Instantiate(template.gameObject, spawnPos, UnityEngine.Random.rotation);
                dummy.SetActive(true);

                // Strip complex logic so it's just a pure physics object
                foreach (var comp in dummy.GetComponents<UnityEngine.Component>())
                {
                    if (comp == null || comp is UnityEngine.Transform || comp is UnityEngine.MeshFilter || comp is UnityEngine.MeshRenderer || comp is UnityEngine.Collider || comp is UnityEngine.Rigidbody)
                        continue;
                    
                    UnityEngine.Object.DestroyImmediate(comp);
                }

                // Ensure visibility and physics
                var renderers = dummy.GetComponentsInChildren<UnityEngine.Renderer>();
                foreach (var r in renderers) r.enabled = true;

                var colliders = dummy.GetComponentsInChildren<UnityEngine.Collider>();
                foreach (var c in colliders) c.enabled = true;

                var rb = dummy.GetComponent<UnityEngine.Rigidbody>();
                if (rb == null) rb = dummy.AddComponent<UnityEngine.Rigidbody>();
                rb.isKinematic = false;
                rb.useGravity = true;
                rb.mass = 50f;
                rb.constraints = UnityEngine.RigidbodyConstraints.None;
                rb.WakeUp();

                fallingDummies.Add(dummy, template);
                
                yield return new UnityEngine.WaitForSeconds(0.2f);
            }

            Plugin.Log.LogInfo($"[Spawn] Car dummies are falling... waiting 4 seconds for them to settle.");
            
            // 2. Wait for physics to settle on the floor
            yield return new UnityEngine.WaitForSeconds(4f);

            // 3. Replace dummies with real cars exactly at their final floor positions!
            foreach (var kvp in fallingDummies)
            {
                var dummy = kvp.Key;
                var template = kvp.Value;
                if (dummy == null) continue;

                Vector3 finalPos = dummy.transform.position;
                UnityEngine.Quaternion finalRot = dummy.transform.rotation;
                
                UnityEngine.Object.Destroy(dummy);

                var clone = UnityEngine.Object.Instantiate(template, finalPos, finalRot);
                clone.gameObject.SetActive(true);

                // Parent to DisassemblyZoneRoot so it gets saved correctly!
                var dzType = System.AppDomain.CurrentDomain.GetAssemblies()
                    .SelectMany(a => a.GetTypes())
                    .FirstOrDefault(t => t.Name == "DisassemblyZoneController");
                if (dzType != null) {
                    var dz = UnityEngine.Object.FindObjectOfType(dzType);
                    if (dz != null) {
                        var rootF = dzType.GetField("_disassemblyZoneRoot", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                        if (rootF != null && rootF.GetValue(dz) is UnityEngine.Transform dzRoot) {
                            clone.transform.SetParent(dzRoot, true);
                        } else {
                            clone.transform.SetParent(template.transform.parent, true);
                        }
                    } else {
                        clone.transform.SetParent(template.transform.parent, true);
                    }
                } else {
                    clone.transform.SetParent(template.transform.parent, true);
                }

                // Manually inject Zenject services for ALL components (including DisassemblyTrashSpawner)
                var origComps = template.GetComponentsInChildren<UnityEngine.MonoBehaviour>(true);
                var cloneComps = clone.GetComponentsInChildren<UnityEngine.MonoBehaviour>(true);
                
                var groupedOrig = System.Linq.Enumerable.ToDictionary(
                    System.Linq.Enumerable.GroupBy(System.Linq.Enumerable.Where(origComps, c => c != null), c => c.GetType()),
                    g => g.Key, g => System.Linq.Enumerable.ToList(g));
                var groupedClone = System.Linq.Enumerable.ToDictionary(
                    System.Linq.Enumerable.GroupBy(System.Linq.Enumerable.Where(cloneComps, c => c != null), c => c.GetType()),
                    g => g.Key, g => System.Linq.Enumerable.ToList(g));

                foreach (var typeGroup in groupedOrig)
                {
                    var type = typeGroup.Key;
                    if (!groupedClone.ContainsKey(type)) continue;
                    
                    var origList = typeGroup.Value;
                    var cloneList = groupedClone[type];
                    
                    for (int i = 0; i < origList.Count && i < cloneList.Count; i++)
                    {
                        var oC = origList[i];
                        var cC = cloneList[i];
                        
                        var fields = type.GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                        foreach (var f in fields)
                        {
                            try {
                                object cloneVal = f.GetValue(cC);
                                if (cloneVal == null) {
                                    object origVal = f.GetValue(oC);
                                    if (origVal is UnityEngine.Component || origVal is UnityEngine.GameObject || origVal is UnityEngine.Transform) continue;
                                    f.SetValue(cC, origVal);
                                }
                            } catch {}
                        }
                    }
                }

                var cloneComp = clone.GetComponent(_trashCarType);

                var rb = clone.GetComponent<UnityEngine.Rigidbody>();
                if (rb != null)
                {
                    rb.isKinematic = false;
                    rb.useGravity = true;
                }
                
                // Optional: Wake up physics via native method if it exists
                var tcMethod = _trashCarType.GetMethod("EnablePhysics", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                if (tcMethod != null) tcMethod.Invoke(cloneComp, null);
                
                var initMethod = _trashCarType.GetMethod("Initialize", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                if (initMethod != null) initMethod.Invoke(cloneComp, null);
                
                var setDisMethod = _trashCarType.GetMethod("SetDisassamblebal", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                if (setDisMethod != null) setDisMethod.Invoke(cloneComp, new object[] { true });

                var touchingField = _trashCarType.GetField("_touchingCars", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                if (touchingField != null) touchingField.SetValue(cloneComp, false);

                var deadField = _trashCarType.GetField("_dead", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                if (deadField != null) deadField.SetValue(cloneComp, false);

                var healthField = _trashCarType.GetField("_health", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                if (healthField != null) {
                    float currentHealth = (float)healthField.GetValue(cloneComp);
                    if (currentHealth <= 0f) {
                        healthField.SetValue(cloneComp, 100f);
                    }
                }
            }

            Plugin.Log.LogInfo("[Spawn] Finished spawning junk cars.");
        }

        private static System.Collections.IEnumerator SpawnJunkRoutine(int totalSpawns)
        {
            if (Plugin.Instance == null) yield break;

            if (totalSpawns <= 0)
            {
                totalSpawns = ModConfig.Data.GachaAddJunkAmount;
            }
            Plugin.Log.LogInfo($"[Spawn] Starting to drop {totalSpawns} junks via Dummy Physics Drop!");

            var player = UnityEngine.GameObject.FindGameObjectWithTag("Player");
            if (player == null)
            {
                Plugin.Log.LogError("[Spawn] Player not found!");
                yield break;
            }

            Vector3 spawnPos = player.transform.position + player.transform.forward * 2f;
            
            if (_junkZoneType == null)
            {
                foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies())
                {
                    if (asm.GetName().Name == "Assembly-CSharp")
                    {
                        _junkZoneType = asm.GetTypes().FirstOrDefault(t => t.Name == "JunkZoneController");
                        _junkPickupType = asm.GetTypes().FirstOrDefault(t => t.Name == "JunkPickup");
                        break;
                    }
                }
            }

            if (_cachedJunkZone == null)
            {
                _cachedJunkZone = UnityEngine.Object.FindObjectOfType(_junkZoneType) as UnityEngine.Component;
            }
            var junkZone = _cachedJunkZone;
            
            _cachedJunkTemplates.RemoveAll(t => t == null || !t.gameObject.activeInHierarchy);
            if (_cachedJunkTemplates.Count == 0 && _junkPickupType != null)
            {
                var allJunks = UnityEngine.Object.FindObjectsOfType(_junkPickupType);
                foreach (var j in allJunks)
                {
                    var comp = j as UnityEngine.Component;
                    if (comp != null && comp.gameObject.activeInHierarchy)
                    {
                        var mesh = comp.GetComponentInChildren<UnityEngine.MeshRenderer>();
                        if (mesh != null && comp.transform.localScale.magnitude > 0.5f)
                        {
                            _cachedJunkTemplates.Add(comp);
                        }
                    }
                }
            }
            
            if (junkZone == null || _cachedJunkTemplates.Count == 0)
            {
                Plugin.Log.LogError($"[Spawn] Could not find JunkZone ({junkZone != null}) or valid templates (Found: {_cachedJunkTemplates.Count})!");
                yield break;
            }
            
            Plugin.Log.LogInfo($"[Spawn] Found {_cachedJunkTemplates.Count} valid templates to clone!");

            var jiwType = _junkZoneType?.GetNestedType("JunkInWorld", BindingFlags.Public | BindingFlags.NonPublic) 
                       ?? _junkZoneType?.Assembly.GetTypes().FirstOrDefault(t => t.Name.Contains("JunkInWorld"));
            var spawnMethod = _junkZoneType?.GetMethod("Spawn", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic, null, new System.Type[] { jiwType }, null);
            var dataProp = _junkPickupType?.GetProperty("Data", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);

            if (jiwType == null || spawnMethod == null || dataProp == null)
            {
                Plugin.Log.LogError("[Spawn] Native spawn methods not found!");
                yield break;
            }

            // List to hold our falling dummies and their corresponding template IDs
            var fallingDummies = new System.Collections.Generic.Dictionary<UnityEngine.GameObject, int>();

            for (int i = 0; i < totalSpawns; i++)
            {
                var template = _cachedJunkTemplates[UnityEngine.Random.Range(0, _cachedJunkTemplates.Count)];
                if (template == null) continue;

                var scatterPos = spawnPos + new Vector3(UnityEngine.Random.Range(-3f, 3f), UnityEngine.Random.Range(2f, 5f), UnityEngine.Random.Range(-3f, 3f));
                
                // 1. Create a physical dummy
                var dummy = UnityEngine.Object.Instantiate(template.gameObject, scatterPos, UnityEngine.Random.rotation);
                dummy.SetActive(true);

                // Strip complex logic so it's just a pure physics object
                foreach (var comp in dummy.GetComponents<UnityEngine.Component>())
                {
                    if (comp == null || comp is UnityEngine.Transform || comp is UnityEngine.MeshFilter || comp is UnityEngine.MeshRenderer || comp is UnityEngine.Collider || comp is UnityEngine.Rigidbody)
                        continue;
                    
                    UnityEngine.Object.DestroyImmediate(comp);
                }

                // Ensure visibility and physics
                var renderers = dummy.GetComponentsInChildren<UnityEngine.Renderer>();
                foreach (var r in renderers) r.enabled = true;

                var colliders = dummy.GetComponentsInChildren<UnityEngine.Collider>();
                foreach (var c in colliders) c.enabled = true;

                var rb = dummy.GetComponent<UnityEngine.Rigidbody>();
                if (rb == null) rb = dummy.AddComponent<UnityEngine.Rigidbody>();
                rb.isKinematic = false;
                rb.useGravity = true;
                rb.mass = 0.5f;
                rb.constraints = UnityEngine.RigidbodyConstraints.None;
                rb.WakeUp();

                // Extract template ID
                int templateId = 0;
                var jp = template.GetComponent(_junkPickupType);
                if (jp != null)
                {
                    var data = dataProp.GetValue(jp);
                    if (data != null)
                    {
                        var idProp = data.GetType().GetProperty("Id", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance) 
                                  ?? data.GetType().BaseType?.GetProperty("Id", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                        if (idProp != null) templateId = (int)idProp.GetValue(data);
                        else
                        {
                            var idField = data.GetType().GetField("_id", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)
                                       ?? data.GetType().BaseType?.GetField("_id", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                            if (idField != null) templateId = (int)idField.GetValue(data);
                        }
                    }
                }

                fallingDummies.Add(dummy, templateId);
                
                if (i % 10 == 0) yield return null;
            }

            Plugin.Log.LogInfo($"[Spawn] Dummies are falling... waiting 4 seconds for them to settle.");
            
            // 2. Wait for physics to settle on the floor
            yield return new UnityEngine.WaitForSeconds(4f);

            // 3. Replace dummies with native GPUI spawns exactly at their final floor positions!
            int successCount = 0;
            foreach (var kvp in fallingDummies)
            {
                var dummy = kvp.Key;
                int tId = kvp.Value;
                if (dummy == null) continue;

                try
                {
                    object jiw = System.Activator.CreateInstance(jiwType);
                    var idf = jiwType.GetField("pickupDataID", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                    var posf = jiwType.GetField("position", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                    var rotf = jiwType.GetField("rotation", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                    var actf = jiwType.GetField("active", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                    
                    idf?.SetValue(jiw, tId);
                    
                    // Convert grounded world position to JunkZone local position
                    Vector3 localPos = dummy.transform.position;
                    if (junkZone is UnityEngine.Component jzComp)
                        localPos = jzComp.transform.InverseTransformPoint(dummy.transform.position);
                    
                    posf?.SetValue(jiw, localPos);
                    rotf?.SetValue(jiw, dummy.transform.rotation); 
                    actf?.SetValue(jiw, true);
                    
                    // Native Spawn at the settled grounded position!
                    spawnMethod.Invoke(junkZone, new object[] { jiw });
                    successCount++;
                }
                catch { }

                // Destroy the dummy
                UnityEngine.Object.Destroy(dummy);
            }

            Plugin.Log.LogInfo($"[Spawn] Successfully replaced {successCount} dummies with native saved junks!");
        }

        /// <summary>Spawn a customer car (if SpawnController supports it).</summary>
        public static void SpawnCustomerCar()
        {
            if (_spawnControllerType == null) return;
            var ctrl = Object.FindObjectOfType(_spawnControllerType);
            if (ctrl == null) return;

            foreach (var name in new[] { "SpawnCar", "SpawnCustomerCar", "SpawnTrashCar", "RespawnTrashCar" })
            {
                var m = _spawnControllerType.GetMethod(name,
                    BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (m != null)
                {
                    m.Invoke(ctrl, null);
                    Plugin.Log.LogInfo($"[Spawn] Called {name}");
                    return;
                }
            }
        }

        /// <summary>Call the dog to the player's position.</summary>
        public static void CallDog()
        {
            if (_dogBrainType == null) return;
            var dog = Object.FindObjectOfType(_dogBrainType);
            if (dog == null) { Plugin.Log.LogWarning("[Spawn] Dog not found"); return; }

            var player = GameObject.FindGameObjectWithTag("Player");
            if (player == null) return;

            // Try setting dog target/destination
            var mb = dog as MonoBehaviour;
            if (mb == null) return;

            // Set position directly as fallback
            var navAgent = mb.GetComponent<UnityEngine.AI.NavMeshAgent>();
            if (navAgent != null)
            {
                navAgent.SetDestination(player.transform.position);
                Plugin.Log.LogInfo("[Spawn] Dog called to player");
            }
        }

        /// <summary>Remove junk from the scene.</summary>
        public static void RemoveJunk(int amount)
        {
            if (_junkPickupType == null) return;
            var junks = Object.FindObjectsOfType(_junkPickupType);
            int count = 0;
            foreach (var j in junks)
            {
                if (count >= amount) break;
                var comp = j as Component;
                if (comp != null && comp.gameObject.activeInHierarchy)
                {
                    Object.Destroy(comp.gameObject);
                    count++;
                }
            }
            Plugin.Log.LogInfo($"[Spawn] Removed {count} junks.");
        }
    }
}
