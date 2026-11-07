package farm

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"maps"
	"strings"
)

// The inventory lists exact reviewed addresses, including model-dependent and
// empty manufacturer entries. It supplies descriptions, never alert policy.
//
//go:embed fault_catalogue.json
var faultCatalogueJSON []byte

type (
	catalogueInventory struct {
		Commit  string           `json:"commit"`
		Models  []string         `json:"models"`
		Entries []catalogueEntry `json:"entries"`
	}

	catalogueEntry struct {
		Family      string   `json:"family"`
		Disposition string   `json:"disposition"`
		Text        string   `json:"text"`
		Codes       []string `json:"codes"`
	}
)

var faultCatalogue = loadFaultCatalogue()

func loadFaultCatalogue() catalogueInventory {
	var inventory catalogueInventory
	if err := json.Unmarshal(faultCatalogueJSON, &inventory); err != nil {
		panic(fmt.Sprintf("invalid bundled fault catalogue: %v", err))
	}
	return inventory
}

func catalogueMessages(family string, curated map[string]string) map[string]string {
	messages := map[string]string{}
	for _, entry := range faultCatalogue.Entries {
		if entry.Family != family {
			continue
		}
		text := entry.Text
		if entry.Disposition == "model-dependent" {
			text += "; details vary by printer model"
		}
		for _, code := range entry.Codes {
			if family == "device_hms" {
				code = strings.Join([]string{code[:4], code[4:8], code[8:12], code[12:]}, "_")
			}
			messages[code] = text
		}
	}
	maps.Copy(messages, curated)
	return messages
}
