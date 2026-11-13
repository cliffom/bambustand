package webserver

import "strings"

// Content-versioned local assets are decorative hardware depictions, never
// telemetry. Only known model names resolve; unknown models keep the fallback.
var printerImages = map[string]string{
	"a1mini": "/printers/a1-mini-0c99b467f25e.svg",
	"h2d":    "/printers/h2d-cb2ed23f6432.svg",
	"p1s":    "/printers/p1s-da09bdd74076.svg",
	"x1c":    "/printers/x1c-2b13b073f31a.svg",
	"x2d":    "/printers/x2d-0c7870c28cef.svg",
}

func printerImage(model string) string {
	model = strings.NewReplacer(" ", "", "-", "", "_", "").Replace(strings.ToLower(strings.TrimSpace(model)))
	model = strings.TrimPrefix(model, "bambulab")
	if model == "x1carbon" {
		model = "x1c"
	}
	return printerImages[model]
}

func isPrinterImage(path string) bool {
	for _, image := range printerImages {
		if path == image {
			return true
		}
	}
	return false
}
