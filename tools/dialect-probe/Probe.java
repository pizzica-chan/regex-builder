// Java の java.util.regex で probes.json の各正規表現を試し、結果を JSON で出す。
// 外部ライブラリを使わないよう、probes.json は簡単な読み取りで読む（各要素の "id" "p" "s" "op" だけを取り出す）
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class Probe {
    static final String[] CLASSES = {"\\d", "\\w", "\\s", ".", "(?s)."};

    static String run(String p, String s, String op) {
        Pattern rx;
        try {
            rx = Pattern.compile(p);
        } catch (Exception e) {
            return "E";
        }
        Matcher m = rx.matcher(s);
        return (op.equals("full") ? m.matches() : m.find()) ? "T" : "F";
    }

    static String ranges(String cls) {
        Pattern rx = Pattern.compile(cls);
        StringBuilder sb = new StringBuilder("[");
        int start = -1;
        boolean first = true;
        for (int cp = 0; cp <= 0x10000; cp++) {
            boolean ok = cp <= 0xFFFF && !(cp >= 0xD800 && cp <= 0xDFFF) && rx.matcher(String.valueOf((char) cp)).matches();
            if (ok && start < 0) start = cp;
            if (!ok && start >= 0) {
                sb.append(first ? "" : ",").append("[").append(start).append(",").append(cp - 1).append("]");
                first = false;
                start = -1;
            }
        }
        return sb.append("]").toString();
    }

    // JSON の文字列の中身を、エスケープを戻して取り出す
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

    static String quote(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    public static void main(String[] args) throws Exception {
        String json = Files.readString(Path.of(args[0]), StandardCharsets.UTF_8);
        Matcher m = Pattern.compile("\\{ \"id\": \"((?:[^\"\\\\]|\\\\.)*)\", \"p\": \"((?:[^\"\\\\]|\\\\.)*)\", \"s\": \"((?:[^\"\\\\]|\\\\.)*)\", \"op\": \"(\\w+)\" \\}").matcher(json);
        List<String> parts = new ArrayList<>();
        while (m.find()) {
            parts.add(quote(m.group(1)) + ":\"" + run(unescape(m.group(2)), unescape(m.group(3)), m.group(4)) + "\"");
        }
        List<String> cls = new ArrayList<>();
        for (String c : CLASSES) cls.add(quote(c) + ":" + ranges(c));
        PrintStream out = new PrintStream(System.out, true, StandardCharsets.UTF_8);
        out.print("{\"engine\":\"Java " + System.getProperty("java.version") + " java.util.regex\",\"probes\":{" +
            String.join(",", parts) + "},\"classes\":{" + String.join(",", cls) + "}}");
    }
}
