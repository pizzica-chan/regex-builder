// Go の regexp（RE2）で probes.json の各正規表現を試し、結果を JSON で出す
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"runtime"
)

type probe struct {
	ID string `json:"id"`
	P  string `json:"p"`
	S  string `json:"s"`
	Op string `json:"op"`
}

func run(p, s, op string) string {
	if _, err := regexp.Compile(p); err != nil {
		return "E"
	}
	pat := p
	if op == "full" {
		pat = `\A(?:` + p + `)\z`
	}
	re, err := regexp.Compile(pat)
	if err != nil {
		return "E"
	}
	if re.MatchString(s) {
		return "T"
	}
	return "F"
}

func ranges(cls string) [][2]int {
	re := regexp.MustCompile(`\A(?:` + cls + `)\z`)
	out := [][2]int{}
	start := -1
	for cp := 0; cp <= 0x10000; cp++ {
		ok := cp <= 0xFFFF && !(cp >= 0xD800 && cp <= 0xDFFF) && re.MatchString(string(rune(cp)))
		if ok && start < 0 {
			start = cp
		}
		if !ok && start >= 0 {
			out = append(out, [2]int{start, cp - 1})
			start = -1
		}
	}
	return out
}

func main() {
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	var probes []probe
	if err := json.Unmarshal(data, &probes); err != nil {
		panic(err)
	}
	res := map[string]any{
		"engine":  fmt.Sprintf("Go %s regexp (RE2)", runtime.Version()),
		"probes":  map[string]string{},
		"classes": map[string][][2]int{},
	}
	for _, pr := range probes {
		res["probes"].(map[string]string)[pr.ID] = run(pr.P, pr.S, pr.Op)
	}
	for _, c := range []string{`\d`, `\w`, `\s`, `.`, `(?s).`} {
		res["classes"].(map[string][][2]int)[c] = ranges(c)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(res); err != nil {
		panic(err)
	}
}
