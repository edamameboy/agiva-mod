using System.Collections.Generic;
using UnityEngine;

namespace TikTokLiveMod
{
    public class UIDumper : MonoBehaviour
    {
        private bool _dumped = false;
        
        private void Update()
        {
            if (Input.GetKeyDown(KeyCode.F8) && !_dumped)
            {
                _dumped = true;
                Plugin.Log.LogInfo("=== DUMPING UI HIERARCHY ===");
                var canvases = FindObjectsOfType<Canvas>();
                foreach (var c in canvases)
                {
                    DumpTransform(c.transform, 0);
                }
                Plugin.Log.LogInfo("=== DONE DUMPING ===");
            }
        }

        private void DumpTransform(Transform t, int indent)
        {
            if (!t.gameObject.activeInHierarchy && indent > 1) return;
            string ind = new string(' ', indent * 2);
            string components = "";
            var p = t.GetComponent("Project.Code.Gameplay.UI.Game.PlayerParamWidget");
            if (p != null) components += " [PlayerParamWidget]";
            
            Plugin.Log.LogInfo($"{ind}{t.name}{components}");
            for (int i = 0; i < t.childCount; i++)
            {
                DumpTransform(t.GetChild(i), indent + 1);
            }
        }
    }
}
