package farm

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestObservedSpaghettiCancellationTrail(t *testing.T) {
	s, _, at := setup(t, "x2d")
	s.LowFilament = 0
	report(t, s, fmt.Sprintf(`{"hms":[{"attr":%d,"code":%d}],"print_error":%d,"gcode_state":"PAUSE"}`, 0x0C000300, 0x00030008, 0x03008003), at)
	p := s.Printers["TEST"]
	before := s.Active["TEST/state"]
	if o := p.PrintOutcome(at, true); !strings.Contains(o.Text, "spaghetti") || !strings.HasPrefix(o.Text, "Print paused") || len(s.Active) != 3 {
		t.Fatal("pause explanation or independent notices lost", o, s.Active)
	}
	// FAILED and cancellation may arrive separately; no reconstruction of fault
	// start time or inference that a physical fault has been repaired.
	report(t, s, `{"hms":[],"print_error":0,"gcode_state":"FAILED"}`, at.Add(4*time.Hour))
	failed := s.Active["TEST/state"]
	if SameOccurrence("TEST/state", before, failed) {
		t.Fatal("failure did not replace pause occurrence")
	}
	report(t, s, fmt.Sprintf(`{"print_error":%d}`, 0x0300400C), at.Add(4*time.Hour+5*time.Second))
	o := p.PrintOutcome(at.Add(4*time.Hour+5*time.Second), true)
	if o.Text != "Task canceled" || p.State != StateFailed || strings.Contains(o.NextStep(), "resolve it") {
		t.Fatal("cancellation is presented as physical repair", o)
	}
	if !SameOccurrence("TEST/state", failed, s.Active["TEST/state"]) || len(s.Active) != 2 || len(s.Attention()) != 2 {
		t.Fatal("presentation changed notice identity or existing alert eligibility")
	}
	if last := p.PrintOutcome(at.Add(5*time.Hour), true); !strings.Contains(last.Text, "current state unconfirmed") || len(last.Guidance) != 0 {
		t.Fatal("stale outcome presented as current", last)
	}
	p.Online = false
	if p.PrintOutcome(at.Add(4*time.Hour+5*time.Second), true).Current {
		t.Fatal("offline outcome claimed current")
	}
}

func TestExpandedMappingPreservesFallbackAndClassification(t *testing.T) {
	for _, tc := range []struct{ code, text string }{
		{"0C00_0100_0002_0017", "camera lens"},
		{"0C00_0300_0003_0008", "spaghetti"},
		{"03008003", "spaghetti"},
		{"0300400C", "canceled"},
		{"07FF8010", "stuck"},
	} {
		text := printErrors[tc.code]
		if len(tc.code) > 8 {
			text = hmsMessages[tc.code]
		}
		if !strings.Contains(text, tc.text) {
			t.Fatalf("%s: %q", tc.code, text)
		}
		code := tc.code
		if len(code) == 8 {
			code = code[:4] + "_" + code[4:]
		}
		if action := classifyFaultAction(Fault{Code: code, Text: text, Level: LevelError}); action.known {
			t.Fatal("description expansion silently changed classification", code)
		}
	}
	s, _, at := setup(t, "x2d")
	s.LowFilament = 0
	report(t, s, fmt.Sprintf(`{"hms":[{"attr":%d,"code":%d,"message":"Printer supplied detail"},{"attr":%d,"code":%d}],"print_error":4294967295,"gcode_state":"PAUSE"}`, 0x0C000300, 0x00030008, 0x05000200, 0x0003000A), at)
	p := s.Printers["TEST"]
	if len(p.Faults) != 2 || p.Faults[1].Text != "Printer supplied detail" || p.Faults[0].Code != "FFFF_FFFF" {
		t.Fatal("supplied message, internal suppression or unknown fallback lost", p.Faults)
	}
}

func TestCompletionRequiresConfirmedState(t *testing.T) {
	at := time.Now()
	p := &Printer{Device: Device{Online: true}, LastReport: at, State: StateRunning, Progress: ptr(100), Remaining: ptr(0)}
	if p.PrintOutcome(at, true).Text != "" {
		t.Fatal("estimates inferred completion")
	}
	p.State = StateFinished
	if p.PrintOutcome(at, true).Text != "Print finished" {
		t.Fatal("confirmed finish omitted")
	}
}

func TestMaintenanceDoesNotExplainAPause(t *testing.T) {
	at := time.Now()
	p := &Printer{Device: Device{Online: true}, LastReport: at, State: StatePaused, Faults: []Fault{{Code: "0501_0400_0003_0002", Text: hmsMessages["0501_0400_0003_0002"], Level: LevelWarning}}}
	if o := p.PrintOutcome(at, true); !strings.Contains(o.Text, "reason not reported") || strings.Contains(o.Text, "Maintenance") {
		t.Fatal("maintenance inferred as pause cause", o)
	}
}

func TestOutcomeRespectsLocalVisibilityAndReview(t *testing.T) {
	s, _, at := setup(t, "x2d")
	s.LowFilament = 0
	report(t, s, fmt.Sprintf(`{"gcode_state":"PAUSE","print_error":%d,"hms":[]}`, 0x03008003), at)
	key := "TEST/fault/0300_8003"
	s.Dismiss(key)
	if o := s.PrintOutcome("TEST", at); strings.Contains(o.Text, "spaghetti") || !strings.Contains(o.Text, "no visible fault explanation") {
		t.Fatal("summary redisplayed a hidden fault", o)
	}
	s.Acknowledge("TEST/state", true)
	if o := s.PrintOutcome("TEST", at); len(o.Guidance) != 0 {
		t.Fatal("fully reviewed outcome retained intervention guidance", o)
	}
	report(t, s, fmt.Sprintf(`{"gcode_state":"FAILED","print_error":%d}`, 0x0300400C), at.Add(time.Second))
	s.Dismiss("TEST/fault/0300_400C")
	if o := s.PrintOutcome("TEST", at.Add(time.Second)); o.Text != "Task canceled" || s.Printers["TEST"].State != StateFailed {
		t.Fatal("hiding cancellation falsified reported outcome/state", o)
	}
}

func TestNewDescriptionsPreserveSavedReviews(t *testing.T) {
	at := time.Now().Add(-time.Hour)
	key := "TEST/fault/0300_8003"
	s := restart(t, map[string]Review{key: {Level: LevelError, Code: "0300_8003", Since: at, Dismissed: true}}, at.Add(time.Hour))
	report(t, s, fmt.Sprintf(`{"gcode_state":"PAUSE","print_error":%d,"hms":[]}`, 0x03008003), at.Add(time.Hour))
	c := s.Active[key]
	if !c.Dismissed || !c.Since.Equal(at) || !strings.Contains(c.Text, "spaghetti") {
		t.Fatal("new catalogue wording reset a restored review", c)
	}
}
