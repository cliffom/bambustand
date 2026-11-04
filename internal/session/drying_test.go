package session_test

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/cliffom/bambustand/internal/farm"
	"github.com/cliffom/bambustand/internal/session"
	"github.com/cliffom/bambustand/internal/webserver"
)

func TestDryingDisplayIsDetachedAndAllowlisted(t *testing.T) {
	now := time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC)
	s := farm.New(10)
	s.Cloud(true, "", now)
	s.Discover([]farm.Device{{ID: "PRIVATE", Name: "Synthetic", Online: true}}, now)
	if err := s.Report("PRIVATE", []byte(`{"print":{"ams":{"ams":[{"id":128,"dry_time":95,"dry_setting":{"dry_temperature":70,"dry_duration":4,"private":"SECRET"}}]}},"info":{"command":"get_version","module":[{"name":"n3s/128","sn":"SERIAL"}]}}`), now); err != nil {
		t.Fatal(err)
	}
	display := session.BuildDisplay(s, now, true)
	*s.Printers["PRIVATE"].AMS[0].DryingMinutes = 0
	encoded := webserver.EncodeDisplay(display)
	for _, excluded := range []string{"PRIVATE", "SERIAL", "SECRET", "dry_setting"} {
		if strings.Contains(string(encoded), excluded) {
			t.Fatal("private data in display", excluded)
		}
	}
	var dto struct {
		Printers []struct {
			AMS []struct {
				Model, Drying string
				DryingCurrent bool   `json:"drying_current"`
				Settings      string `json:"drying_settings"`
			}
		}
	}
	if err := json.Unmarshal(encoded, &dto); err != nil {
		t.Fatal(err)
	}
	a := dto.Printers[0].AMS[0]
	if !a.DryingCurrent || a.Model != "AMS HT" || a.Drying != "Drying · 95 min remaining" || a.Settings != "70°C target · 4 h duration" {
		t.Fatalf("%+v", a)
	}
	s.Cloud(false, "", now)
	if got := session.BuildDisplay(s, now, true).Printers[0].AMS[0].Drying; !strings.HasPrefix(got, "Last-known") {
		t.Fatal(got)
	}
}

func TestDryingDisplayAfterUnitReplacement(t *testing.T) {
	now := time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC)
	s := farm.New(10)
	s.Cloud(true, "", now)
	s.Discover([]farm.Device{{ID: "TEST", Online: true}}, now)
	for _, payload := range []string{
		`{"print":{"ams":{"ams":[{"id":0}]}},"info":{"command":"get_version","module":[{"name":"ams/0"}]}}`,
		`{"print":{"ams":{"ams":[]}}}`,
		`{"print":{"ams":{"ams":[{"id":0,"dry_time":95,"dry_setting":{"dry_temperature":55,"dry_duration":4}}]}}}`,
	} {
		if err := s.Report("TEST", []byte(payload), now); err != nil {
			t.Fatal(err)
		}
	}
	display := session.BuildDisplay(s, now, true)
	a := display.Printers[0].AMS[0]
	if a.ID != 0 || a.Model != "" || !a.DryingCurrent || a.Drying != "Drying · 95 min remaining" || a.DryingSettings != "55°C target · 4 h duration" {
		t.Fatalf("replacement display: %+v", a)
	}
	encoded := string(webserver.EncodeDisplay(display))
	if !strings.Contains(encoded, `"drying":"Drying · 95 min remaining"`) || strings.Contains(encoded, "Unsupported") {
		t.Fatal(encoded)
	}
}
