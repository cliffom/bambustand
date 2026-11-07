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

func TestOutcomePrintErrorEvidenceEndsAtJobBoundary(t *testing.T) {
	for _, boundary := range []string{
		`{"task_id":"B","gcode_state":"RUNNING"}`,
		`{"subtask_id":"B","gcode_state":"RUNNING"}`,
		`{"task_id":"B"}`,
		`{"gcode_state":"SLICING"}`,
		`{"gcode_state":"PREPARE"}`,
		`{"gcode_state":"RUNNING"}`,
	} {
		t.Run(boundary, func(t *testing.T) {
			s, _, at := setup(t, "x2d")
			s.LowFilament = 0
			report(t, s, `{"task_id":"A","subtask_id":"A","gcode_state":"FAILED","print_error":50348044,"hms":[]}`, at)
			key := "TEST/fault/0300_400C"
			s.Acknowledge(key, true)
			previous := s.Active[key]
			if o := s.PrintOutcome("TEST", at); o.Text != "Task canceled" {
				t.Fatal("initial cancellation not recognized", o)
			}
			report(t, s, boundary, at.Add(time.Second))
			report(t, s, `{"gcode_state":"FAILED"}`, at.Add(2*time.Second))
			if o := s.PrintOutcome("TEST", at.Add(2*time.Second)); o.Text != "Print stopped · reason not reported" || strings.Contains(o.NextStep(), "restarting") {
				t.Fatal("retained error explained a different job", o)
			}
			if current := s.Active[key]; !SameOccurrence(key, previous, current) || !current.Acknowledged {
				t.Fatal("outcome boundary changed independent notice lifetime", current)
			}
			report(t, s, `{"print_error":50348044}`, at.Add(3*time.Second))
			if o := s.PrintOutcome("TEST", at.Add(3*time.Second)); o.Text != "Task canceled" {
				t.Fatal("current-job cancellation not recognized", o)
			}
		})
	}
}

func TestOutcomeUsesPrintErrorSuppliedAtJobBoundary(t *testing.T) {
	s, _, at := setup(t, "x2d")
	report(t, s, `{"task_id":"A","gcode_state":"FAILED","print_error":50348044,"hms":[]}`, at)
	report(t, s, `{"task_id":"B","gcode_state":"FAILED","print_error":50364419}`, at.Add(time.Second))
	if o := s.PrintOutcome("TEST", at.Add(time.Second)); !strings.Contains(o.Text, "spaghetti") || strings.Contains(o.Text, "canceled") {
		t.Fatal("new error supplied at boundary was ignored", o)
	}
}

func TestOutcomeJobEvidenceSurvivesPlaceholderIDs(t *testing.T) {
	for _, field := range []string{"task_id", "subtask_id"} {
		for _, placeholder := range []string{`0`, `"0"`, `" 0 "`, `null`, `""`} {
			for _, printError := range []int{50348044, 50364419} {
				t.Run(fmt.Sprintf("%s/%s/%d", field, placeholder, printError), func(t *testing.T) {
					s, _, at := setup(t, "x2d")
					s.LowFilament = 0
					report(t, s, fmt.Sprintf(`{%q:"A","gcode_state":"FAILED","print_error":%d,"hms":[]}`, field, printError), at)
					initial := s.PrintOutcome("TEST", at)
					code := fmt.Sprintf("%04X_%04X", printError>>16, printError&0xffff)
					key := "TEST/fault/" + code
					s.Acknowledge(key, true)
					previous := s.Active[key]
					report(t, s, fmt.Sprintf(`{%q:%s}`, field, placeholder), at.Add(time.Second))
					report(t, s, fmt.Sprintf(`{%q:"A","gcode_state":"FAILED"}`, field), at.Add(2*time.Second))
					if o := s.PrintOutcome("TEST", at.Add(2*time.Second)); o.Text != initial.Text {
						t.Fatal("placeholder lost same-job fault evidence", o, initial)
					}
					report(t, s, fmt.Sprintf(`{%q:%s}`, field, placeholder), at.Add(3*time.Second))
					report(t, s, fmt.Sprintf(`{%q:"B","gcode_state":"FAILED"}`, field), at.Add(4*time.Second))
					if o := s.PrintOutcome("TEST", at.Add(4*time.Second)); o.Text != "Print stopped · reason not reported" {
						t.Fatal("placeholder let a prior error explain the new job", o)
					}
					if current := s.Active[key]; !SameOccurrence(key, previous, current) || !current.Acknowledged {
						t.Fatal("outcome association changed the independent notice review", current)
					}
					report(t, s, fmt.Sprintf(`{"print_error":%d}`, printError), at.Add(5*time.Second))
					if o := s.PrintOutcome("TEST", at.Add(5*time.Second)); o.Text != initial.Text {
						t.Fatal("explicit new-job error was ignored", o, initial)
					}
				})
			}
		}
	}
}

func TestOutcomeJobEvidenceRejectsInvalidMerge(t *testing.T) {
	s, _, at := setup(t, "x2d")
	report(t, s, `{"task_id":"A","gcode_state":"FAILED","print_error":50348044,"hms":[]}`, at)
	report(t, s, `{"task_id":0}`, at)
	for i := range maxTelemetryCollection {
		report(t, s, fmt.Sprintf(`{"extension":{"key_%d":0}}`, i), at)
	}
	// This valid envelope exceeds the cumulative collection limit only after
	// merging. Its new identity must not alter the accepted job association.
	if err := s.Report("TEST", []byte(`{"print":{"task_id":"B","gcode_state":"FAILED","extension":{"new_key":0}}}`), at.Add(time.Second)); err == nil {
		t.Fatal("oversized merge was accepted")
	}
	report(t, s, `{"task_id":"A","gcode_state":"FAILED"}`, at.Add(2*time.Second))
	if o := s.PrintOutcome("TEST", at.Add(2*time.Second)); o.Text != "Task canceled" {
		t.Fatal("rejected report changed the confirmed job association", o)
	}
}

func TestCameraFailuresAndWindowPauseMeanings(t *testing.T) {
	for _, tc := range []struct {
		attr, code uint32
		meaning    string
	}{
		{0x0C000100, 0x00020008, "image unavailable"},
		{0x0C000400, 0x00020026, "initialization failed"},
	} {
		s, _, at := setup(t, "x2d")
		report(t, s, fmt.Sprintf(`{"gcode_state":"PAUSE","print_error":0,"hms":[{"attr":%d,"code":%d}]}`, tc.attr, tc.code), at)
		p := s.Printers["TEST"]
		if len(p.Faults) != 1 || p.Faults[0].Level != LevelError || !strings.Contains(p.Faults[0].Text, tc.meaning) {
			t.Fatal("camera meaning or wire severity lost", p.Faults)
		}
		if o := s.PrintOutcome("TEST", at); !strings.Contains(o.Text, tc.meaning) || strings.Contains(o.Text, "spaghetti detected") {
			t.Fatal("unavailable monitoring presented as a print defect", o)
		}
	}
	s, _, at := setup(t, "x2d")
	report(t, s, `{"gcode_state":"PAUSE","print_error":50364491,"hms":[]}`, at)
	if o := s.PrintOutcome("TEST", at); !strings.Contains(o.Text, "Laser Safety Window is open") {
		t.Fatal("pause reason omitted", o)
	}
}
