package session_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/cliffom/bambustand/internal/farm"
	"github.com/cliffom/bambustand/internal/session"
)

func TestDisplaySharesOutcomeWithoutChangingRawStateOrTargets(t *testing.T) {
	s, at := fixture(t)
	report(t, &s, fmt.Sprintf(`{"print":{"gcode_state":"FAILED","print_error":%d,"hms":[]}}`, 0x0300400C), at)
	p := session.BuildDisplay(s.Farm, at, false).Printers[0]
	if p.PrintSummary != "Task canceled" || p.State != "FAILED" || len(p.Conditions) != 2 || !p.Attention {
		t.Fatal("shared summary changed underlying state/conditions", p)
	}
	retained := session.BuildDisplay(s.Farm, at.Add(time.Hour), false).Printers[0]
	if retained.PrintGuidance != "" || retained.PrintSummary == p.PrintSummary || retained.Conditions[0].ID != p.Conditions[0].ID {
		t.Fatal("freshness changed notice identity or lost qualification", retained)
	}
}

func TestDisplayDoesNotCarryCancellationIntoNextJob(t *testing.T) {
	s, at := fixture(t)
	report(t, &s, `{"print":{"task_id":"A","gcode_state":"FAILED","print_error":50348044,"hms":[]}}`, at)
	report(t, &s, `{"print":{"task_id":"B","gcode_state":"RUNNING"}}`, at.Add(time.Second))
	report(t, &s, `{"print":{"gcode_state":"FAILED"}}`, at.Add(2*time.Second))
	p := session.BuildDisplay(s.Farm, at.Add(2*time.Second), false).Printers[0]
	if p.PrintSummary != "Print stopped · reason not reported" || p.State != "FAILED" || len(p.Conditions) != 2 {
		t.Fatal("display applied retained cancellation to next job", p)
	}
}

func TestDisplayIdleFinishedRequiresReportedStateAndCurrentAvailability(t *testing.T) {
	at := time.Date(2026, 10, 29, 0, 0, 0, 0, time.UTC)
	for _, state := range []string{"IDLE", "FINISH", "RUNNING", "PAUSE", "FAILED", "PREPARE", "SLICING", "UNKNOWN", "FUTURE_STATE", ""} {
		for _, tc := range []struct {
			name          string
			age           time.Duration
			online, cloud bool
			missing       bool
		}{
			{"live", time.Second, true, true, false},
			{"idle grace", 10 * time.Minute, true, true, false},
			{"stale", 10*time.Minute + time.Second, true, true, false},
			{"offline", time.Second, false, true, false},
			{"cloud outage", time.Second, true, false, false},
			{"missing report", time.Second, true, true, true},
		} {
			t.Run(state+"/"+tc.name, func(t *testing.T) {
				f := farm.New(10)
				f.Discover([]farm.Device{{ID: "SYNTHETIC", Online: tc.online}}, at)
				f.Cloud(tc.cloud, "", at)
				// A full progress bar or zero estimate must never establish idle/done.
				if err := f.Report("SYNTHETIC", []byte(fmt.Sprintf(`{"print":{"gcode_state":%q,"mc_percent":100,"mc_remaining_time":0}}`, state)), at); err != nil {
					t.Fatal(err)
				}
				f.Printers["SYNTHETIC"].Online = tc.online
				if tc.missing {
					f.Printers["SYNTHETIC"].LastReport = time.Time{}
				}
				display := session.BuildDisplay(f, at.Add(tc.age), false)
				want := (state == "IDLE" || state == "FINISH") && tc.online && tc.cloud && !tc.missing && tc.age <= 10*time.Minute
				if got := display.Printers[0].IdleFinished; got != want {
					t.Fatalf("idle/finished=%v, want %v: %+v", got, want, display.Printers[0])
				}
				// Existing summary state totals remain last-reported, including outages.
				if (display.Summary.Printing == 1) != (state == "RUNNING") {
					t.Fatal("changed last-reported printing summary", display.Summary)
				}
			})
		}
	}
}

func TestDisplayIdleFinishedDoesNotHideAttentionOrClaimReadiness(t *testing.T) {
	s, at := fixture(t)
	for _, state := range []string{"IDLE", "FINISH"} {
		report(t, &s, fmt.Sprintf(`{"print":{"gcode_state":%q}}`, state), at)
		display := session.BuildDisplay(s.Farm, at, false)
		if p := display.Printers[0]; !p.IdleFinished || !p.Attention || len(p.Conditions) == 0 {
			t.Fatal("idle/finished lost independently reported intervention", p)
		}
	}
}
