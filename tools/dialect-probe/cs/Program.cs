// C#（.NET）の System.Text.RegularExpressions で probes.json の各正規表現を試し、結果を JSON で出す
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

var probes = JsonDocument.Parse(File.ReadAllText(args[0], Encoding.UTF8)).RootElement;
string[] classes = { @"\d", @"\w", @"\s", ".", "(?s)." };

string Run(string p, string s, string op)
{
    try { _ = new Regex(p); } catch (ArgumentException) { return "E"; }
    var re = op == "full" ? new Regex(@"\A(?:" + p + @")\z") : new Regex(p);
    return re.IsMatch(s) ? "T" : "F";
}

List<int[]> Ranges(string cls)
{
    var re = new Regex(@"\A(?:" + cls + @")\z");
    var outList = new List<int[]>();
    int start = -1;
    for (int cp = 0; cp <= 0x10000; cp++)
    {
        bool ok = cp <= 0xFFFF && !(cp >= 0xD800 && cp <= 0xDFFF) && re.IsMatch(((char)cp).ToString());
        if (ok && start < 0) start = cp;
        if (!ok && start >= 0) { outList.Add(new[] { start, cp - 1 }); start = -1; }
    }
    return outList;
}

var result = new Dictionary<string, object>
{
    ["engine"] = $".NET {Environment.Version} System.Text.RegularExpressions",
    ["probes"] = probes.EnumerateArray().ToDictionary(
        pr => pr.GetProperty("id").GetString()!,
        pr => Run(pr.GetProperty("p").GetString()!, pr.GetProperty("s").GetString()!, pr.GetProperty("op").GetString()!)),
    ["classes"] = classes.ToDictionary(c => c, c => Ranges(c)),
};
var stdout = Console.OpenStandardOutput();
var bytes = JsonSerializer.SerializeToUtf8Bytes(result, new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
stdout.Write(bytes);
