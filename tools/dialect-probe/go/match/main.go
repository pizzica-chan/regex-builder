// cases.json の各正規表現を Go の regexp で動かし、一致した位置（UTF-8 のバイト単位）を JSON で出す
package main

import (
	"encoding/json"
	"os"
	"regexp"
)

type tcase struct {
	P string `json:"p"`
	F string `json:"f"`
	S string `json:"s"`
}

func main() {
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	var cases []tcase
	if err := json.Unmarshal(data, &cases); err != nil {
		panic(err)
	}
	results := []any{}
	for _, c := range cases {
		p := c.P
		if c.F != "" {
			p = "(?" + c.F + ")" + p
		}
		re, err := regexp.Compile(p)
		if err != nil {
			results = append(results, "E")
			continue
		}
		list := re.FindAllStringIndex(c.S, 100)
		if list == nil {
			list = [][]int{}
		}
		results = append(results, list)
	}
	enc := json.NewEncoder(os.Stdout)
	if err := enc.Encode(map[string]any{"unit": "utf8", "results": results}); err != nil {
		panic(err)
	}
}
