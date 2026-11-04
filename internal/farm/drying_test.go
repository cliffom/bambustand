package farm

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestDryingReportsAndFreshness(t *testing.T) {
	s, p, now := setup(t, "h2d")
	report(t, s, `{"ams":{"ams":[{"id":"0","dry_time":"95","dry_setting":{"dry_temperature":55,"dry_duration":4}},{"id":128,"dry_time":0}]}}`, now)
	if got := p.AMS[0].DryingStatus(now, true); got != "Drying · 95 min remaining" {
		t.Fatal(got)
	}
	if got := p.AMS[1].DryingStatus(now, true); got != "Not drying · 0 min remaining" {
		t.Fatal(got)
	}
	if got := p.AMS[0].DryingSettings(); got != "55°C target · 4 h duration" {
		t.Fatal(got)
	}
	// An unrelated unit update preserves the reading and its original age.
	later := now.Add(3 * time.Minute)
	report(t, s, `{"ams":{"ams":[{"id":0,"humidity_raw":20},{"id":128,"dry_time":30}]}}`, later)
	if !p.AMS[0].DryingReported.Equal(now) || !strings.HasPrefix(p.AMS[0].DryingStatus(later, true), "Last-known") {
		t.Fatal("unrelated telemetry refreshed drying", p.AMS[0])
	}
	if strings.HasPrefix(p.AMS[1].DryingStatus(later, true), "Last-known") {
		t.Fatal("HT report not fresh")
	}
	for _, current := range []bool{false, true} {
		at := later
		if current {
			at = later.Add(3 * time.Minute)
		}
		if !strings.HasPrefix(p.AMS[1].DryingStatus(at, current), "Last-known") {
			t.Fatal("unavailable or expired reading claimed current")
		}
	}
	report(t, s, `{"ams":{"ams":[]}}`, later)
	report(t, s, `{"ams":{"ams":[{"id":0,"temp":55}]}}`, later)
	if p.AMS[0].DryingMinutes != nil || !p.AMS[0].DryingReported.IsZero() {
		t.Fatal("cleared inventory retained drying")
	}
}

func TestDryingInvalidAndMissing(t *testing.T) {
	for _, value := range []string{`null`, `-1`, `0.5`, `"NaN"`, `""`, `true`, `{}`, `65536`, `"0.0"`} {
		t.Run(value, func(t *testing.T) {
			s, p, now := setup(t, "h2d")
			report(t, s, `{"ams":{"ams":[{"id":0,"dry_time":80}]}}`, now)
			report(t, s, fmt.Sprintf(`{"ams":{"ams":[{"id":0,"dry_time":%s}]}}`, value), now)
			if got := p.AMS[0].DryingStatus(now, true); got != "Unknown" {
				t.Fatal(got)
			}
		})
	}
	s, p, now := setup(t, "h2d")
	report(t, s, `{"ams":{"ams":[{"id":0,"temp":55,"dry_setting":{"dry_temperature":55,"dry_duration":4}}]}}`, now)
	if got := p.AMS[0].DryingStatus(now, true); got != "Unknown" {
		t.Fatal("settings/heat established active drying", got)
	}
}

func TestAMSVersionIdentificationDoesNotRefreshTelemetry(t *testing.T) {
	s, p, now := setup(t, "h2d")
	later := now.Add(3 * time.Minute)
	body := `{"info":{"command":"get_version","module":[{"name":"ams/0","sn":"PRIVATE"},{"name":"ams_f1/1"},{"name":"n3f/2"},{"name":"n3s/128"},{"name":"n3f/999"}]}}`
	if err := s.Report("TEST", []byte(body), later); err != nil {
		t.Fatal(err)
	}
	if !p.LastReport.Equal(now) || p.Firmware.Version != "" || len(p.amsModels) != 4 {
		t.Fatal("module metadata contaminated printer OTA/freshness", p.amsModels)
	}
	if p.AMS[0].Model != "AMS" || p.AMS[0].DryingStatus(later, false) != "Unsupported (no active dryer)" || p.AMS[1].Model != "AMS HT" {
		t.Fatal("existing inventory not updated", p.AMS)
	}
	report(t, s, `{"ams":{"ams":[{"id":1,"dry_time":0},{"id":2,"dry_time":60}]}}`, later)
	if p.AMS[1].Model != "AMS Lite" || p.AMS[1].DryingStatus(later, true) != "Unsupported (no active dryer)" || p.AMS[2].Model != "AMS 2 Pro" {
		t.Fatal("metadata before inventory lost", p.AMS)
	}
}
