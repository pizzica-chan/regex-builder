// cases.json の各正規表現を C#（.NET）の Regex で動かし、一致した位置（UTF-16 単位）を JSON で出す
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

var cases = JsonDocument.Parse(File.ReadAllText(args[0], Encoding.UTF8)).RootElement;
var results = new List<object>();
foreach (var c in cases.EnumerateArray())
{
    var p = c.GetProperty("p").GetString()!;
    var f = c.GetProperty("f").GetString()!;
    var s = c.GetProperty("s").GetString()!;
    var opts = RegexOptions.None;
    if (f.Contains('i')) opts |= RegexOptions.IgnoreCase;
    if (f.Contains('m')) opts |= RegexOptions.Multiline;
    if (f.Contains('s')) opts |= RegexOptions.Singleline;
    Regex re;
    try { re = new Regex(p, opts); } catch (ArgumentException) { results.Add("E"); continue; }
    results.Add(re.Matches(s).Take(100).Select(m => new[] { m.Index, m.Index + m.Length }).ToList());
}
Console.OpenStandardOutput().Write(JsonSerializer.SerializeToUtf8Bytes(new { unit = "utf16", results }));
