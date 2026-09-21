using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace TikTokLiveMod
{
    public class UIPatcher : MonoBehaviour
    {
        private HashSet<int> _patchedInstances = new HashSet<int>();

        private void Start()
        {
            StartCoroutine(PatchRoutine());
        }

        private System.Collections.IEnumerator PatchRoutine()
        {
            while (true)
            {
                yield return new WaitForSeconds(2f);

                Canvas targetCanvas = null;
                var canvases = Resources.FindObjectsOfTypeAll<Canvas>();
                foreach (var c in canvases) {
                    if (c.name == "CanvasOverlay" && c.gameObject.activeInHierarchy) {
                        targetCanvas = c;
                        break;
                    }
                }
                if (targetCanvas == null) {
                    targetCanvas = FindObjectOfType<Canvas>();
                }
                if (targetCanvas == null) continue;

                GameObject uiContainer = GameObject.Find("TikTokUIContainer");
                bool hasMoney = false, hasCard = false, hasStamina = false, hasBox = false;

                if (uiContainer != null)
                {
                    foreach (Transform child in uiContainer.transform)
                    {
                        string n = child.name.ToLower();
                        if (n.Contains("money")) hasMoney = true;
                        if (n.Contains("card")) hasCard = true;
                        if (n.Contains("stamina") || n.Contains("energy")) hasStamina = true;
                        if (n.Contains("box")) hasBox = true;
                    }
                }

                var allWidgets = targetCanvas.GetComponentsInChildren<MonoBehaviour>(false).ToList();
                var paramWidgets = allWidgets.Where(x => x.GetType().Name == "PlayerParamWidget").ToList();
                var sliders = allWidgets.Where(x => x.GetType().Name.Contains("ProgressBar")).ToList();

                List<Transform> moneyCards = new List<Transform>();
                List<Transform> staminaBox = new List<Transform>();

                foreach (var w in paramWidgets)
                {
                    if (_patchedInstances.Contains(w.GetInstanceID())) continue;
                    
                    string path = GetHierarchyPath(w.transform).ToLower();
                    if (path.Contains("pause") || path.Contains("menu") || path.Contains("tool") || path.Contains("wheel") || path.Contains("inventory") || path.Contains("tablet") || path.Contains("setting")) continue;

                    string n = w.name.ToLower();
                    if (n.Contains("money") || path.Contains("money")) {
                        if (!hasMoney) {
                            moneyCards.Add(w.transform);
                            _patchedInstances.Add(w.GetInstanceID());
                            hasMoney = true;
                        }
                    } 
                    else if (n.Contains("card") || path.Contains("card")) {
                        if (!hasCard) {
                            moneyCards.Add(w.transform);
                            _patchedInstances.Add(w.GetInstanceID());
                            hasCard = true;
                        }
                    }
                }
                
                foreach (var s in sliders)
                {
                    if (_patchedInstances.Contains(s.GetInstanceID())) continue;

                    string path = GetHierarchyPath(s.transform).ToLower();
                    if (path.Contains("pause") || path.Contains("menu") || path.Contains("tool") || path.Contains("wheel") || path.Contains("inventory") || path.Contains("tablet") || path.Contains("setting")) continue;

                    string n = s.name.ToLower();
                    if (n.Contains("energy") || n.Contains("stamina")) {
                        if (!hasStamina) {
                            staminaBox.Insert(0, s.transform);
                            _patchedInstances.Add(s.GetInstanceID());
                            hasStamina = true;
                        }
                    }
                    else if (n.Contains("box")) {
                        if (!hasBox) {
                            staminaBox.Add(s.transform);
                            _patchedInstances.Add(s.GetInstanceID());
                            hasBox = true;
                        }
                    }
                }

            // Ensure correct order: Cards first, Money second
            moneyCards.Sort((a, b) => {
                bool aCard = a.name.ToLower().Contains("card") || GetHierarchyPath(a).ToLower().Contains("card");
                return aCard ? -1 : 1;
            });

            // Ensure correct order: Stamina first, Box second
            staminaBox.Sort((a, b) => {
                bool aStam = a.name.ToLower().Contains("stamina") || a.name.ToLower().Contains("energy") || a.name.ToLower().Contains("slider");
                return aStam ? -1 : 1;
            });

            if (moneyCards.Count > 0 || staminaBox.Count > 0)
            {
                if (uiContainer == null) {
                    uiContainer = new GameObject("TikTokUIContainer");
                    uiContainer.transform.SetParent(targetCanvas.transform, false);
                    
                    var rt = uiContainer.AddComponent<RectTransform>();
                    rt.anchorMin = new Vector2(0.5f, 0f);
                    rt.anchorMax = new Vector2(0.5f, 0f);
                    rt.pivot = new Vector2(0.5f, 0f);
                    rt.anchoredPosition = new Vector2(0, 100f); // Higher to avoid 'Hold to throw'
                    rt.sizeDelta = new Vector2(800f, 45f);

                    var hlg = uiContainer.AddComponent<HorizontalLayoutGroup>();
                    hlg.childAlignment = TextAnchor.MiddleCenter;
                    hlg.spacing = 25f;
                    hlg.childControlHeight = true;
                    hlg.childControlWidth = false;
                    hlg.childForceExpandHeight = false;
                    hlg.childForceExpandWidth = false;
                }

                var combinedWidgets = new List<Transform>();
                combinedWidgets.AddRange(staminaBox); // Stamina, Box first
                combinedWidgets.AddRange(moneyCards); // Then Cards, Money

                foreach (var w in combinedWidgets)
                {
                    w.SetParent(uiContainer.transform, false);

                    if (w.name.Contains("ProgressBarWidget"))
                    {
                        var textObj = w.Find("Text");
                        if (textObj != null) textObj.gameObject.SetActive(true);

                        // Ensure they have a layout element so they take up space in the horizontal group
                        var le = w.gameObject.GetComponent<LayoutElement>();
                        if (le == null) {
                            le = w.gameObject.AddComponent<LayoutElement>();
                            le.preferredWidth = 160f; // Width of the progress bar + icon
                            le.preferredHeight = 40f;
                        }
                        
                        // We do NOT add HorizontalLayoutGroup to the widget itself, 
                        // because that breaks the native overlapping of the background and foreground bar!
                    }
                    
                    var childImages = w.GetComponentsInChildren<Image>(true);
                    foreach (var img in childImages)
                    {
                        string n = img.gameObject.name.ToLower();
                        if (n == "bg" || n == "background" || img.gameObject == w.gameObject)
                        {
                            img.color = new Color(1f, 1f, 1f, 1f); // Solid pure white
                        }
                        else if (n == "icon")
                        {
                            // Make ALL icons (Cards, Money, Stamina, Box) pure black
                            img.color = new Color(0.1f, 0.1f, 0.1f, 1f); 
                        }
                        else if (n == "foreground")
                        {
                            if (w.name.Contains("Box")) {
                                img.color = new Color(0.3f, 0.3f, 0.3f, 1f); // Dark grey for the Box slider
                            }
                        }
                    }
                    
                    var components = w.GetComponentsInChildren<MonoBehaviour>(true);
                    foreach (var comp in components)
                    {
                        if (comp.GetType().Name == "TextMeshProUGUI")
                        {
                            var prop = comp.GetType().GetProperty("color");
                            if (prop != null)
                                prop.SetValue(comp, new Color(0f, 0f, 0f, 1f)); // Pure black text
                                
                            var shadow = comp.gameObject.GetComponent<Shadow>();
                            if (shadow != null) Destroy(shadow);
                            var outline = comp.gameObject.GetComponent<Outline>();
                            if (outline != null) Destroy(outline);
                            
                            // Strip TextMeshPro material underlays and outlines
                            var matProp = comp.GetType().GetProperty("fontMaterial");
                            if (matProp != null) {
                                var mat = matProp.GetValue(comp) as Material;
                                if (mat != null) {
                                    mat.DisableKeyword("UNDERLAY_ON");
                                    mat.DisableKeyword("OUTLINE_ON");
                                    if (mat.HasProperty("_UnderlayOffsetX")) mat.SetFloat("_UnderlayOffsetX", 0f);
                                    if (mat.HasProperty("_UnderlayOffsetY")) mat.SetFloat("_UnderlayOffsetY", 0f);
                                    if (mat.HasProperty("_UnderlayDilate")) mat.SetFloat("_UnderlayDilate", 0f);
                                    if (mat.HasProperty("_OutlineWidth")) mat.SetFloat("_OutlineWidth", 0f);
                                    if (mat.HasProperty("_OutlineSoftness")) mat.SetFloat("_OutlineSoftness", 0f);
                                }
                            }
                        }
                    }
                }
            }

            if (moneyCards.Count > 0 || staminaBox.Count > 0)
            {
                Plugin.Log.LogInfo("[UIPatcher] Successfully patched UI instances!");
            }
            } // close while loop
        }
        
        private string GetHierarchyPath(Transform t) {
            string path = t.name;
            while (t.parent != null) {
                t = t.parent;
                path = t.name + "/" + path;
            }
            return path;
        }
    }
}
