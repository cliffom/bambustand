package farm

import (
	"strings"
	"testing"
)

func TestNotificationClassificationsUseVerifiedSemantics(t *testing.T) {
	for _, tc := range []struct {
		name, body, class string
		eligible          bool
	}{
		{"manual", `{"gcode_state":"PAUSE","print_error":50364435,"hms":[]}`, NotificationManualPause, false},
		{"recovery", `{"gcode_state":"PAUSE","print_error":0,"hms":[{"attr":117448704,"code":196610}]}`, NotificationRecovery, false},
		{"spaghetti", `{"gcode_state":"PAUSE","print_error":201359426,"hms":[]}`, NotificationSpaghetti, true},
		{"failure", `{"gcode_state":"FAILED","print_error":0,"hms":[]}`, NotificationFailure, true},
		{"canceled", `{"gcode_state":"FAILED","print_error":50348044,"hms":[]}`, NotificationCancellation, true},
		{"unknown pause", `{"gcode_state":"PAUSE","print_error":0,"hms":[]}`, NotificationUnknownPause, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, at := notificationFarm(t)
			report(t, s, tc.body, at)
			p := s.NotificationSnapshot(at)["TEST"]
			c := p.Conditions["TEST/state"]
			if c.Class != tc.class || c.Eligible != tc.eligible {
				t.Fatal(c)
			}
			if tc.name == "canceled" {
				code := p.Conditions["TEST/fault/0300_400C"]
				if code.Eligible || code.Class != NotificationCancellation {
					t.Fatal("cancellation code independently eligible", code)
				}
				if strings.Contains(s.Attention()[0].Guidance, "resolve it") {
					t.Fatal("cancellation requests physical repair")
				}
				before := s.Active["TEST/state"]
				s.Acknowledge("TEST/state", true)
				if s.NotificationSnapshot(at)["TEST"].Conditions["TEST/state"].Eligible || !SameOccurrence("TEST/state", before, s.Active["TEST/state"]) {
					t.Fatal("review changed identity or eligibility")
				}
			}
		})
	}
}
