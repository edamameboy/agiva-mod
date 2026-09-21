using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

class Program
{
    static void Main()
    {
        string json = "{\"type\":\"effect\",\"effectId\":\"spawn_junk\",\"user\":\"anonymous\",\"source\":\"gift\",\"data\":{\"giftName\":\"Rose\",\"coins\":100}}";
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        var pattern = new Regex(@"""([^""]+)""\s*:\s*(?:""([^""]*)""|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|true|false|null)");
        foreach (Match m in pattern.Matches(json))
        {
            var key = m.Groups[1].Value;
            var val = m.Groups[2].Success ? m.Groups[2].Value
                    : m.Groups[3].Success ? m.Groups[3].Value
                    : m.Value.Substring(m.Value.IndexOf(':') + 1).Trim();
            result[key] = val;
            Console.WriteLine(key + " => " + val);
        }
    }
}
