package webserver

import (
	"strings"
	"testing"
	"time"

	"github.com/cliffom/bambustand/internal/farm"
	"github.com/cliffom/bambustand/internal/notifications"
)

func browserOutcomeInput(t *testing.T, s *farm.State, now time.Time, body string) notifications.Input {
	t.Helper()
	if err := s.Report(syntheticPrinter, []byte(`{"print":`+body+`}`), now); err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{}
	for _, item := range s.Attention() {
		allowed[item.Key] = true
	}
	return notifications.Input{Active: true, Snapshot: s.NotificationSnapshot(now), Policies: map[string]notifications.Policy{syntheticPrinter: {PrinterName: "Synthetic printer", Completion: true, Allowed: allowed}}}
}

func TestBrowserDelayedCancellationAndCursor(t *testing.T) {
	for _, late := range []bool{false, true} {
		t.Run(map[bool]string{false: "within window", true: "after window"}[late], func(t *testing.T) {
			b, _, at := browserFixture(t)
			s := farm.New(10)
			s.Cloud(true, "", *at)
			s.Discover([]farm.Device{{ID: syntheticPrinter, Online: true}}, *at)
			observeBrowser(b, browserOutcomeInput(t, s, *at, `{"task_id":"synthetic-job","gcode_state":"RUNNING","print_error":0,"hms":[]}`))
			cursor := b.claim(browserRequest{Baseline: true}).Cursor
			observeBrowser(b, browserOutcomeInput(t, s, *at, `{"gcode_state":"FAILED"}`))
			waiting := b.claim(browserRequest{After: cursor})
			if len(waiting.Events) != 0 || waiting.Cursor != cursor {
				t.Fatal("deferred outcome skipped by cursor", waiting)
			}
			if late {
				*at = at.Add(notifications.CollectionWindow)
				result := b.claim(browserRequest{After: cursor})
				if len(result.Events) != 1 {
					t.Fatal(result)
				}
				cursor = result.Cursor
			}
			*at = at.Add(5 * time.Second)
			observeBrowser(b, browserOutcomeInput(t, s, *at, `{"print_error":50348044}`))
			*at = at.Add(time.Second)
			result := b.claim(browserRequest{After: cursor})
			if late {
				if len(result.Events) != 0 {
					t.Fatal("late cancellation replayed", result)
				}
			} else if len(result.Events) != 1 || !strings.Contains(result.Events[0].Body, "Task canceled") {
				t.Fatal(result)
			}
			if len(b.claim(browserRequest{}).Events) != 0 {
				t.Fatal("second tab replayed group")
			}
		})
	}
}

func TestBrowserGroupsDelayedFaultsAndPause(t *testing.T) {
	b, _, at := browserFixture(t)
	s := farm.New(10)
	s.Cloud(true, "", *at)
	s.Discover([]farm.Device{{ID: syntheticPrinter, Online: true}}, *at)
	observeBrowser(b, browserOutcomeInput(t, s, *at, `{"task_id":"synthetic-job","gcode_state":"RUNNING","print_error":0,"hms":[{"attr":201327360,"code":196635}]}`))
	cursor := uint64(0)
	*at = at.Add(2 * time.Second)
	observeBrowser(b, browserOutcomeInput(t, s, *at, `{"gcode_state":"PAUSE","print_error":201359426}`))
	result := b.claim(browserRequest{After: cursor})
	if len(result.Events) != 0 || result.Cursor != 0 {
		t.Fatal(result)
	}
	*at = at.Add(4 * time.Second)
	result = b.claim(browserRequest{After: result.Cursor})
	if len(result.Events) != 1 {
		t.Fatal("separate events for grouped notices", result)
	}
	if len(b.claim(browserRequest{}).Events) != 0 {
		t.Fatal("group member replayed")
	}
	if len(s.Active) != 3 {
		t.Fatal("notice identities merged", s.Active)
	}
}

func TestNewerBrowserCursorCannotResetOtherTabsDeadline(t *testing.T) {
	b, _, at := browserFixture(t)
	s := farm.New(10)
	s.Cloud(true, "", *at)
	s.Discover([]farm.Device{{ID: syntheticPrinter, Online: true}}, *at)
	observeBrowser(b, browserOutcomeInput(t, s, *at, `{"task_id":"synthetic-job","gcode_state":"FAILED","print_error":0,"hms":[]}`))
	newerCursor := b.claim(browserRequest{Baseline: true}).Cursor
	*at = at.Add(3 * time.Second)
	if result := b.claim(browserRequest{After: newerCursor}); len(result.Events) != 0 {
		t.Fatal("new tab replayed its baseline", result)
	}
	*at = at.Add(3 * time.Second)
	result := b.claim(browserRequest{After: 0})
	if len(result.Events) != 1 {
		t.Fatal("another tab extended the fixed window", result)
	}
	if len(b.claim(browserRequest{After: newerCursor}).Events) != 0 {
		t.Fatal("second claimant replayed consumed outcome")
	}
}

func TestBrowserDifferentBaselinesCannotSplitDueGroup(t *testing.T) {
	b, _, at := browserFixture(t)
	s := farm.New(10)
	s.Cloud(true, "", *at)
	s.Discover([]farm.Device{{ID: syntheticPrinter, Online: true}}, *at)
	observeBrowser(b, browserOutcomeInput(t, s, *at, `{"task_id":"synthetic-job","gcode_state":"RUNNING","print_error":0,"hms":[{"attr":201327360,"code":196635}]}`))
	newerCursor := b.claim(browserRequest{Baseline: true}).Cursor
	*at = at.Add(2 * time.Second)
	observeBrowser(b, browserOutcomeInput(t, s, *at, `{"gcode_state":"PAUSE","print_error":201359426}`))
	*at = at.Add(4 * time.Second)
	result := b.claim(browserRequest{After: newerCursor})
	if len(result.Events) != 1 {
		t.Fatal(result)
	}
	if len(b.claim(browserRequest{After: 0}).Events) != 0 {
		t.Fatal("older tab received a leftover member of the same group")
	}
}
