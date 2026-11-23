// cases.json の各正規表現を Java の java.util.regex で動かし、一致した位置（UTF-16 単位）を JSON で出す。
// cases.json は、Probe.java と同じく簡単な読み取りで読む（各要素の "p" "f" "s" だけを取り出す）
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class Match {
    static String run(String p, String f, String s) {
        int flags = 0;
        if (f.contains("i")) flags |= Pattern.CASE_INSENSITIVE;
        if (f.contains("m")) flags |= Pattern.MULTILINE;
        if (f.contains("s")) flags |= Pattern.DOTALL;
        Pattern rx;
        try {
            rx = Pattern.compile(p, flags);
        } catch (Exception e) {
            return "\"E\"";
        }
        Matcher m = rx.matcher(s);
        List<String> out = new ArrayList<>();
        while (m.find() && out.size() < 100) out.add("[" + m.start() + "," + m.end() + "]");
        return "[" + String.join(",", out) + "]";
    }

    // JSON の文字列の中身を、エスケープを戻して取り出す（Probe.java と同じ。ファイル 1 つで動かせるよう写している）
    static String unescape(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c != '\\') { sb.append(c); continue; }
            char n = s.charAt(++i);
            switch (n) {
                case 'n': sb.append('\n'); break;
                case 'r': sb.append('\r'); break;
                case 't': sb.append('\t'); break;
                case 'b': sb.append('\b'); break;
                case 'f': sb.append('\f'); break;
                case 'u': sb.append((char) Integer.parseInt(s.substring(i + 1, i + 5), 16)); i += 4; break;
                default: sb.append(n);
            }
        }
        return sb.toString();
    }

    public static void main(String[] args) throws Exception {
        String json = Files.readString(Path.of(args[0]), StandardCharsets.UTF_8);
        String str = "\"((?:[^\"\\\\]|\\\\.)*)\"";
        Matcher m = Pattern.compile("\\{ \"p\": " + str + ", \"f\": " + str + ", \"s\": " + str + " \\}").matcher(json);
        List<String> results = new ArrayList<>();
        while (m.find()) results.add(run(unescape(m.group(1)), m.group(2), unescape(m.group(3))));
        PrintStream out = new PrintStream(System.out, true, StandardCharsets.UTF_8);
        out.print("{\"unit\":\"utf16\",\"results\":[" + String.join(",", results) + "]}");
    }
}
