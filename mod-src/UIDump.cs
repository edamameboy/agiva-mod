using System.IO;
using System.Linq;
using UnityEngine;

namespace TikTokLiveMod
{
    public class UIDump : MonoBehaviour
    {
        private void Update()
        {
            if (Input.GetKeyDown(KeyCode.F8))
            {
                DumpUIRoot();
            }
        }

        private void DumpUIRoot()
        {
            var roots = Resources.FindObjectsOfTypeAll<GameObject>().Where(x => x.name == "UIRoot(Clone)" || x.name == "UIRoot").ToList();
            
            string path = Path.Combine(Application.dataPath, "..", "ui_root_dump.txt");
            using (StreamWriter sw = new StreamWriter(path))
            {
                // Dump JunkZoneController methods
                sw.WriteLine("--- JUNK ZONE CONTROLLER ---");
                foreach (var asm in System.AppDomain.CurrentDomain.GetAssemblies()) {
                    if (asm.GetName().Name == "Project") {
                        var t = asm.GetType("Project.Code.Gameplay.Controllers.JunkZoneController");
                        if (t != null) {
                            foreach (var p in t.GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)) {
                                sw.WriteLine($"Prop: {p.Name} ({p.PropertyType.Name})");
                            }
                            foreach (var f in t.GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)) {
                                sw.WriteLine($"Field: {f.Name} ({f.FieldType.Name})");
                            }
                            foreach (var m in t.GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)) {
                                if (m.DeclaringType == t) {
                                    var pars = string.Join(", ", m.GetParameters().Select(px => px.ParameterType.Name));
                                    sw.WriteLine($"Method: {m.Name}({pars})");
                                }
                            }
                        }
                        break;
                    }
                }

                if (roots.Count == 0) {
                    sw.WriteLine("NO UIRoot FOUND!");
                }
                foreach (var root in roots) {
                    sw.WriteLine("--- Root: " + root.name + " ---");
                    DumpTransform(root.transform, 0, sw);
                }
            }
            
            Plugin.Log.LogInfo($"[UIDump] Dumped UIRoot hierarchy to ui_root_dump.txt");
        }

        private void DumpTransform(Transform t, int indent, StreamWriter sw)
        {
            string ind = new string(' ', indent * 2);
            string active = t.gameObject.activeInHierarchy ? "[A]" : "[I]";
            
            string components = "";
            var mono = t.GetComponents<MonoBehaviour>();
            foreach (var m in mono)
            {
                if (m != null) components += m.GetType().Name + " ";
            }
            
            sw.WriteLine($"{ind}{t.name} {active} Pos:{t.position} - {components}");
            for (int i = 0; i < t.childCount; i++)
            {
                DumpTransform(t.GetChild(i), indent + 1, sw);
            }
        }
    }
}
