using System;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.Events;

namespace TikTokLiveMod
{
    public static class NeoUIBuilder
    {
        public static Font MainFont => Resources.GetBuiltinResource<Font>("Arial.ttf");

        public static GameObject CreateCanvas(string name, int sortOrder = 10000)
        {
            var go = new GameObject(name);
            var canvas = go.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = sortOrder;
            
            var scaler = go.AddComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920, 1080);
            
            go.AddComponent<GraphicRaycaster>();
            return go;
        }

        public static GameObject CreatePanel(Transform parent, string name, Color bgColor, Vector2 anchorMin, Vector2 anchorMax)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var rect = go.AddComponent<RectTransform>();
            rect.anchorMin = anchorMin;
            rect.anchorMax = anchorMax;
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;
            
            var img = go.AddComponent<Image>();
            img.color = bgColor;
            
            var outline = go.AddComponent<Outline>();
            outline.effectColor = Color.black;
            outline.effectDistance = new Vector2(4, -4); // Neo-Brutalism shadow/outline hybrid
            return go;
        }
        
        public static GameObject CreateShadow(Transform parent, string name, Vector2 offset)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var rect = go.AddComponent<RectTransform>();
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = offset;
            rect.offsetMax = offset;
            
            var img = go.AddComponent<Image>();
            img.color = Color.black;
            return go;
        }

        public static GameObject CreateText(Transform parent, string name, string text, int fontSize, Color color, TextAnchor alignment)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var rect = go.AddComponent<RectTransform>();
            rect.anchorMin = Vector2.zero;
            rect.anchorMax = Vector2.one;
            rect.offsetMin = Vector2.zero;
            rect.offsetMax = Vector2.zero;
            
            var t = go.AddComponent<Text>();
            t.text = text;
            t.font = MainFont;
            t.fontSize = fontSize;
            t.color = color;
            t.alignment = alignment;
            
            var outline = go.AddComponent<Outline>();
            outline.effectColor = Color.black;
            outline.effectDistance = new Vector2(2, -2);
            
            return go;
        }

        public static Slider CreateSlider(Transform parent, string name, float min, float max, float current)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var rect = go.AddComponent<RectTransform>();
            rect.sizeDelta = new Vector2(300, 30);
            
            // BG
            var bgObj = new GameObject("Background");
            bgObj.transform.SetParent(go.transform, false);
            var bgRect = bgObj.AddComponent<RectTransform>();
            bgRect.anchorMin = new Vector2(0, 0.25f);
            bgRect.anchorMax = new Vector2(1, 0.75f);
            bgRect.offsetMin = Vector2.zero;
            bgRect.offsetMax = Vector2.zero;
            var bgImg = bgObj.AddComponent<Image>();
            bgImg.color = Color.white;
            var bgOutline = bgObj.AddComponent<Outline>();
            bgOutline.effectColor = Color.black;
            bgOutline.effectDistance = new Vector2(2, -2);

            // Fill Area
            var fillArea = new GameObject("Fill Area");
            fillArea.transform.SetParent(go.transform, false);
            var fillAreaRect = fillArea.AddComponent<RectTransform>();
            fillAreaRect.anchorMin = new Vector2(0, 0.25f);
            fillAreaRect.anchorMax = new Vector2(1, 0.75f);
            fillAreaRect.offsetMin = Vector2.zero;
            fillAreaRect.offsetMax = Vector2.zero;
            
            var fill = new GameObject("Fill");
            fill.transform.SetParent(fillArea.transform, false);
            var fillRect = fill.AddComponent<RectTransform>();
            fillRect.offsetMin = Vector2.zero;
            fillRect.offsetMax = Vector2.zero;
            var fillImg = fill.AddComponent<Image>();
            fillImg.color = new Color(0.2f, 0.8f, 0.2f);

            // Handle Slide Area
            var handleArea = new GameObject("Handle Slide Area");
            handleArea.transform.SetParent(go.transform, false);
            var handleAreaRect = handleArea.AddComponent<RectTransform>();
            handleAreaRect.anchorMin = Vector2.zero;
            handleAreaRect.anchorMax = Vector2.one;
            handleAreaRect.offsetMin = new Vector2(10, 0);
            handleAreaRect.offsetMax = new Vector2(-10, 0);
            
            var handle = new GameObject("Handle");
            handle.transform.SetParent(handleArea.transform, false);
            var handleRect = handle.AddComponent<RectTransform>();
            handleRect.sizeDelta = new Vector2(20, 0);
            var handleImg = handle.AddComponent<Image>();
            handleImg.color = Color.yellow;
            var handleOutline = handle.AddComponent<Outline>();
            handleOutline.effectColor = Color.black;
            handleOutline.effectDistance = new Vector2(2, -2);

            // Slider Component
            var slider = go.AddComponent<Slider>();
            slider.fillRect = fillRect;
            slider.handleRect = handleRect;
            slider.targetGraphic = handleImg;
            slider.direction = Slider.Direction.LeftToRight;
            slider.minValue = min;
            slider.maxValue = max;
            slider.value = current;
            
            return slider;
        }
        
        public static InputField CreateInputField(Transform parent, string name, string defaultText)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var rect = go.AddComponent<RectTransform>();
            rect.sizeDelta = new Vector2(100, 40);
            var img = go.AddComponent<Image>();
            img.color = Color.white;
            
            var outline = go.AddComponent<Outline>();
            outline.effectColor = Color.black;
            outline.effectDistance = new Vector2(2, -2);

            var textObj = new GameObject("Text");
            textObj.transform.SetParent(go.transform, false);
            var textRect = textObj.AddComponent<RectTransform>();
            textRect.anchorMin = Vector2.zero;
            textRect.anchorMax = Vector2.one;
            textRect.offsetMin = new Vector2(10, 0);
            textRect.offsetMax = new Vector2(-10, 0);
            var t = textObj.AddComponent<Text>();
            t.font = MainFont;
            t.fontSize = 24;
            t.color = Color.black;
            t.alignment = TextAnchor.MiddleLeft;

            var input = go.AddComponent<InputField>();
            input.textComponent = t;
            input.text = defaultText;
            
            return input;
        }

        public static Button CreateButton(Transform parent, string name, string label, Color bgColor, UnityAction onClick)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var rect = go.AddComponent<RectTransform>();
            rect.sizeDelta = new Vector2(200, 60);
            
            var img = go.AddComponent<Image>();
            img.color = bgColor;
            var outline = go.AddComponent<Outline>();
            outline.effectColor = Color.black;
            outline.effectDistance = new Vector2(4, -4);
            
            var textObj = new GameObject("Text");
            textObj.transform.SetParent(go.transform, false);
            var textRect = textObj.AddComponent<RectTransform>();
            textRect.anchorMin = Vector2.zero;
            textRect.anchorMax = Vector2.one;
            textRect.offsetMin = Vector2.zero;
            textRect.offsetMax = Vector2.zero;
            var t = textObj.AddComponent<Text>();
            t.text = label;
            t.font = MainFont;
            t.fontSize = 28;
            t.color = Color.white;
            t.alignment = TextAnchor.MiddleCenter;
            var textOutline = textObj.AddComponent<Outline>();
            textOutline.effectColor = Color.black;
            textOutline.effectDistance = new Vector2(2, -2);

            var btn = go.AddComponent<Button>();
            btn.targetGraphic = img;
            btn.onClick.AddListener(onClick);
            
            return btn;
        }
    }

    public class ModSettingsUI : MonoBehaviour
    {
        private GameObject _canvasObj;
        
        // Sliders
        private Slider _sMaxStamina, _sZeroStamina, _sJackpot, _sBankrupt, _sAddJunk, _sRemoveJunk, _sForceClose, _sAutoJump, _sEnergyDrink, _sSpawnCar;
        // Inputs
        private InputField _iAddJunk, _iRemoveJunk, _iAutoJump, _iEnergyDrink, _iGiftMult, _iLikeJunk, _iSpawnCarGacha, _iSpawnCarGift, _iJackpot, _iBankrupt;

        private void Update()
        {
            if (Input.GetKey(KeyCode.LeftControl) && Input.GetKeyDown(KeyCode.Equals))
            {
                ToggleSettings();
            }
        }

        private void ToggleSettings()
        {
            if (_canvasObj != null)
            {
                Destroy(_canvasObj);
                _canvasObj = null;
            }
            else
            {
                BuildUI();
            }
        }

        private void BuildUI()
        {
            _canvasObj = NeoUIBuilder.CreateCanvas("ModSettingsCanvas");
            
            // BG Overlay
            var bg = NeoUIBuilder.CreatePanel(_canvasObj.transform, "BG", new Color(0, 0, 0, 0.8f), Vector2.zero, Vector2.one);
            var bgOutline = bg.GetComponent<Outline>();
            if (bgOutline != null) Destroy(bgOutline); // Remove outline for full bg

            // Main Window Shadow & Panel
            var windowShadow = NeoUIBuilder.CreateShadow(_canvasObj.transform, "WindowShadow", new Vector2(20, -20));
            windowShadow.GetComponent<RectTransform>().anchorMin = new Vector2(0.2f, 0.1f);
            windowShadow.GetComponent<RectTransform>().anchorMax = new Vector2(0.8f, 0.9f);
            
            var window = NeoUIBuilder.CreatePanel(_canvasObj.transform, "Window", new Color(0.95f, 0.95f, 0.9f), new Vector2(0.2f, 0.1f), new Vector2(0.8f, 0.9f));
            
            // Title
            var title = NeoUIBuilder.CreateText(window.transform, "Title", "MOD SETTINGS", 48, Color.white, TextAnchor.UpperCenter);
            title.GetComponent<RectTransform>().anchoredPosition = new Vector2(0, -20);
            
            // Container for layout
            var content = new GameObject("Content");
            content.transform.SetParent(window.transform, false);
            var contentRect = content.AddComponent<RectTransform>();
            contentRect.anchorMin = new Vector2(0, 0);
            contentRect.anchorMax = new Vector2(1, 1);
            contentRect.offsetMin = new Vector2(40, 100);
            contentRect.offsetMax = new Vector2(-40, -100);
            
            // Let's use simple manual positioning for rows to avoid complex LayoutGroup bugs
            float startY = -20;
            float rowHeight = 40;
            
            // Helper to add row
            void AddRow(string labelText, ref Slider sRef, float val, float y)
            {
                var label = NeoUIBuilder.CreateText(content.transform, "Label", labelText, 20, Color.black, TextAnchor.MiddleLeft);
                var lRect = label.GetComponent<RectTransform>();
                lRect.anchorMin = new Vector2(0, 1);
                lRect.anchorMax = new Vector2(0, 1);
                lRect.pivot = new Vector2(0, 0.5f);
                lRect.sizeDelta = new Vector2(200, 40);
                lRect.anchoredPosition = new Vector2(0, y);
                if (label.GetComponent<Outline>() != null) Destroy(label.GetComponent<Outline>());
                
                sRef = NeoUIBuilder.CreateSlider(content.transform, "Slider", 0, 100, val);
                var sRect = sRef.GetComponent<RectTransform>();
                sRect.anchorMin = new Vector2(0, 1);
                sRect.anchorMax = new Vector2(0, 1);
                sRect.pivot = new Vector2(0, 0.5f);
                sRect.anchoredPosition = new Vector2(210, y);
            }
            
            void AddInputRow(string labelText, ref InputField iRef, int val, float y)
            {
                var label = NeoUIBuilder.CreateText(content.transform, "Label", labelText, 20, Color.black, TextAnchor.MiddleLeft);
                var lRect = label.GetComponent<RectTransform>();
                lRect.anchorMin = new Vector2(0, 1);
                lRect.anchorMax = new Vector2(0, 1);
                lRect.sizeDelta = new Vector2(300, 40);
                lRect.anchoredPosition = new Vector2(150, y);
                if (label.GetComponent<Outline>() != null) Destroy(label.GetComponent<Outline>());
                
                iRef = NeoUIBuilder.CreateInputField(content.transform, "Input", val.ToString());
                var iRect = iRef.GetComponent<RectTransform>();
                iRect.anchorMin = new Vector2(0, 1);
                iRect.anchorMax = new Vector2(0, 1);
                iRect.anchoredPosition = new Vector2(300 + 50 + 20, y); // half input width is 50
            }

            // Gacha Probabilities
            var h1 = NeoUIBuilder.CreateText(content.transform, "H1", "Gacha Probabilities (%)", 24, Color.white, TextAnchor.MiddleLeft);
            var h1Rect = h1.GetComponent<RectTransform>();
            h1Rect.anchorMin = new Vector2(0, 1);
            h1Rect.anchorMax = new Vector2(0, 1);
            h1Rect.pivot = new Vector2(0, 0.5f);
            h1Rect.sizeDelta = new Vector2(400, 40);
            h1Rect.anchoredPosition = new Vector2(0, startY);
            startY -= 40;

            var d = ModConfig.Data;
            AddRow("Max Stamina", ref _sMaxStamina, d.OddsMaxStamina, startY -= rowHeight);
            AddRow("0 Stamina", ref _sZeroStamina, d.OddsZeroStamina, startY -= rowHeight);
            AddRow("Jackpot", ref _sJackpot, d.OddsJackpot, startY -= rowHeight);
            AddRow("Bankrupt", ref _sBankrupt, d.OddsBankrupt, startY -= rowHeight);
            AddRow("Add Junk", ref _sAddJunk, d.OddsAddJunk, startY -= rowHeight);
            AddRow("Remove Junk", ref _sRemoveJunk, d.OddsRemoveJunk, startY -= rowHeight);
            AddRow("Force Close", ref _sForceClose, d.OddsForceClose, startY -= rowHeight);
            AddRow("Auto Jump", ref _sAutoJump, d.OddsAutoJump, startY -= rowHeight);
            AddRow("Energy Drink", ref _sEnergyDrink, d.OddsEnergyDrink, startY -= rowHeight);
            AddRow("Spawn Car", ref _sSpawnCar, d.OddsSpawnCar, startY -= rowHeight);

            // Settings 2nd Column (Using same canvas space but offset x)
            float col2X = 700;
            float startY2 = -20;
            
            var h2 = NeoUIBuilder.CreateText(content.transform, "H2", "Nominal Parameters", 24, Color.white, TextAnchor.MiddleLeft);
            var h2Rect = h2.GetComponent<RectTransform>();
            h2Rect.anchorMin = new Vector2(0, 1);
            h2Rect.anchorMax = new Vector2(0, 1);
            h2Rect.pivot = new Vector2(0, 0.5f);
            h2Rect.sizeDelta = new Vector2(400, 40);
            h2Rect.anchoredPosition = new Vector2(col2X, startY2);
            startY2 -= 40;

            void AddInputRowCol2(string labelText, ref InputField iRef, int val, float y)
            {
                var label = NeoUIBuilder.CreateText(content.transform, "Label", labelText, 20, Color.black, TextAnchor.MiddleLeft);
                var lRect = label.GetComponent<RectTransform>();
                lRect.anchorMin = new Vector2(0, 1);
                lRect.anchorMax = new Vector2(0, 1);
                lRect.pivot = new Vector2(0, 0.5f);
                lRect.sizeDelta = new Vector2(250, 40);
                lRect.anchoredPosition = new Vector2(col2X, y);
                if (label.GetComponent<Outline>() != null) Destroy(label.GetComponent<Outline>());
                
                iRef = NeoUIBuilder.CreateInputField(content.transform, "Input", val.ToString());
                var iRect = iRef.GetComponent<RectTransform>();
                iRect.anchorMin = new Vector2(0, 1);
                iRect.anchorMax = new Vector2(0, 1);
                iRect.pivot = new Vector2(0, 0.5f);
                iRect.anchoredPosition = new Vector2(col2X + 260, y);
            }

            AddInputRowCol2("Gacha Add Junk Amt", ref _iAddJunk, d.GachaAddJunkAmount, startY2 -= rowHeight);
            AddInputRowCol2("Gacha Remove Junk Amt", ref _iRemoveJunk, d.GachaRemoveJunkAmount, startY2 -= rowHeight);
            AddInputRowCol2("Gacha Auto Jump Cnt", ref _iAutoJump, d.GachaAutoJumpCount, startY2 -= rowHeight);
            AddInputRowCol2("Gacha Energy Drink Amt", ref _iEnergyDrink, d.GachaEnergyDrinkAmount, startY2 -= rowHeight);
            AddInputRowCol2("Gift Junk Multiplier", ref _iGiftMult, d.GiftJunkMultiplier, startY2 -= rowHeight);
            AddInputRowCol2("Like Add Junk Amt", ref _iLikeJunk, d.LikeAddJunkAmount, startY2 -= rowHeight);
            AddInputRowCol2("Spawn Car (Gacha) Amt", ref _iSpawnCarGacha, d.SpawnCarGachaAmount, startY2 -= rowHeight);
            AddInputRowCol2("Spawn Car (Gift) Amt", ref _iSpawnCarGift, d.SpawnCarGiftAmount, startY2 -= rowHeight);
            AddInputRowCol2("Gacha Jackpot Amt", ref _iJackpot, d.GachaJackpotAmount, startY2 -= rowHeight);
            AddInputRowCol2("Gacha Bankrupt Amt", ref _iBankrupt, d.GachaBankruptAmount, startY2 -= rowHeight);

            // Save & Close Button
            var saveBtn = NeoUIBuilder.CreateButton(window.transform, "SaveBtn", "SAVE", new Color(0.2f, 0.8f, 0.2f), OnSaveClicked);
            var sBtnRect = saveBtn.GetComponent<RectTransform>();
            sBtnRect.anchorMin = new Vector2(0.5f, 0);
            sBtnRect.anchorMax = new Vector2(0.5f, 0);
            sBtnRect.anchoredPosition = new Vector2(0, 60);
        }

        private void OnSaveClicked()
        {
            var d = ModConfig.Data;
            d.OddsMaxStamina = _sMaxStamina.value;
            d.OddsZeroStamina = _sZeroStamina.value;
            d.OddsJackpot = _sJackpot.value;
            d.OddsBankrupt = _sBankrupt.value;
            d.OddsAddJunk = _sAddJunk.value;
            d.OddsRemoveJunk = _sRemoveJunk.value;
            d.OddsForceClose = _sForceClose.value;
            d.OddsAutoJump = _sAutoJump.value;
            d.OddsEnergyDrink = _sEnergyDrink.value;
            d.OddsSpawnCar = _sSpawnCar.value;

            if (int.TryParse(_iAddJunk.text, out int a)) d.GachaAddJunkAmount = a;
            if (int.TryParse(_iRemoveJunk.text, out int r)) d.GachaRemoveJunkAmount = r;
            if (int.TryParse(_iAutoJump.text, out int j)) d.GachaAutoJumpCount = j;
            if (int.TryParse(_iEnergyDrink.text, out int e)) d.GachaEnergyDrinkAmount = e;
            if (int.TryParse(_iGiftMult.text, out int g)) d.GiftJunkMultiplier = g;
            if (int.TryParse(_iLikeJunk.text, out int l)) d.LikeAddJunkAmount = l;
            if (int.TryParse(_iSpawnCarGacha.text, out int scga)) d.SpawnCarGachaAmount = scga;
            if (int.TryParse(_iSpawnCarGift.text, out int scgi)) d.SpawnCarGiftAmount = scgi;
            if (int.TryParse(_iJackpot.text, out int jk)) d.GachaJackpotAmount = jk;
            if (int.TryParse(_iBankrupt.text, out int bnk)) d.GachaBankruptAmount = bnk;

            ModConfig.Save();
            ToggleSettings();
        }
    }
}
