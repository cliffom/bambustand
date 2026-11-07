package notifications

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/cliffom/bambustand/internal/farm"
)

func outcomeFarm(at time.Time) *farm.State {
	s := farm.New(10)
	s.Cloud(true, "", at)
	s.Discover([]farm.Device{{ID: "TEST", Name: "Synthetic printer", Online: true}}, at)
	return s
}

func outcomeInput(s *farm.State, at time.Time) Input {
	allowed := map[string]bool{}
	for _, item := range s.Attention() {
		allowed[item.Key] = true
	}
	return Input{Active: true, Snapshot: s.NotificationSnapshot(at), Policies: map[string]Policy{"TEST": {PrinterName: "Synthetic printer", Desktop: true, Completion: true, Allowed: allowed}}}
}

func outcomeReport(t *testing.T, s *farm.State, at time.Time, body string) {
	t.Helper()
	if err := s.Report("TEST", []byte(`{"print":`+body+`}`), at); err != nil {
		t.Fatal(err)
	}
}

func TestDelayedSpaghettiPauseAndCancellation(t *testing.T) {
	for _, delay := range []time.Duration{5 * time.Second, 9 * time.Second} {
		t.Run(delay.String(), func(t *testing.T) {
			now := time.Unix(100, 0)
			s := outcomeFarm(now)
			var messages []Message
			w := scheduledWorker(t, testLedger(t), &now, &messages)
			outcomeReport(t, s, now, `{"task_id":"synthetic-job","gcode_state":"RUNNING","print_error":0,"hms":[]}`)
			step(t, w, outcomeInput(s, now))
			outcomeReport(t, s, now, `{"hms":[{"attr":201327360,"code":196616}]}`)
			step(t, w, outcomeInput(s, now))
			now = now.Add(3 * time.Second)
			outcomeReport(t, s, now, `{"gcode_state":"PAUSE","print_error":50364419}`)
			step(t, w, outcomeInput(s, now))
			if len(messages) != 0 {
				t.Fatal("sent before fixed window")
			}
			now = now.Add(3 * time.Second)
			step(t, w, outcomeInput(s, now))
			if len(messages) != 1 || !strings.Contains(messages[0].Body, "3 notices") {
				t.Fatal(messages)
			}
			accepted := 0
			for _, entry := range w.Status().History {
				if entry.Outcome == OutcomeAccepted {
					accepted++
					if entry.GroupSize != 3 || entry.Request != 1 {
						t.Fatal(entry)
					}
				}
			}
			if accepted != 3 {
				t.Fatal("member evidence lost", w.Status())
			}
			now = now.Add(4 * time.Hour)
			outcomeReport(t, s, now, `{"gcode_state":"FAILED","print_error":0,"hms":[]}`)
			step(t, w, outcomeInput(s, now))
			if delay > CollectionWindow {
				now = now.Add(CollectionWindow)
				step(t, w, outcomeInput(s, now))
				now = now.Add(delay - CollectionWindow)
			} else {
				now = now.Add(delay)
			}
			outcomeReport(t, s, now, `{"print_error":50348044}`)
			step(t, w, outcomeInput(s, now))
			now = now.Add(CollectionWindow)
			step(t, w, outcomeInput(s, now))
			if len(messages) != 2 {
				t.Fatal("redundant cancellation request", messages)
			}
			if delay < CollectionWindow && (!strings.Contains(messages[1].Body, "Task canceled") || strings.Contains(messages[1].Body, "needs attention")) {
				t.Fatal(messages[1])
			}
			if len(s.Active) != 2 {
				t.Fatal("merged underlying notices", s.Active)
			}
			for _, c := range s.Active {
				if c.Acknowledged || c.Dismissed {
					t.Fatal("group reviewed notice")
				}
			}
		})
	}
}

func TestCollectionDropsObsoleteMembersAndPreservesEscalation(t *testing.T) {
	for _, change := range []string{"clear", "review", "quiet", "snooze", "category", "disconnect", "job"} {
		t.Run(change, func(t *testing.T) {
			now := time.Unix(100, 0)
			s := outcomeFarm(now)
			var messages []Message
			w := scheduledWorker(t, testLedger(t), &now, &messages)
			outcomeReport(t, s, now, `{"task_id":"synthetic-a","gcode_state":"FAILED","print_error":0,"hms":[]}`)
			step(t, w, outcomeInput(s, now))
			now = now.Add(CollectionWindow)
			switch change {
			case "clear":
				outcomeReport(t, s, now, `{"gcode_state":"RUNNING"}`)
			case "review":
				s.Acknowledge("TEST/state", true)
			case "disconnect":
				s.Cloud(false, "", now)
			case "job":
				outcomeReport(t, s, now, `{"task_id":"synthetic-b","gcode_state":"RUNNING"}`)
			}
			input := outcomeInput(s, now)
			switch change {
			case "quiet":
				input.Quiet = true
			case "snooze":
				p := input.Policies["TEST"]
				p.Snoozed = true
				input.Policies["TEST"] = p
			case "category":
				input.Policies["TEST"].Allowed["TEST/state"] = false
			}
			step(t, w, input)
			if len(messages) != 0 {
				t.Fatal("obsolete member delivered", messages)
			}
		})
	}
	// A second distinct fault and a confirmed recurrence both remain eligible
	// after an earlier group was accepted. Neither shares its reservation.
	now := time.Unix(100, 0)
	s := outcomeFarm(now)
	var messages []Message
	w := scheduledWorker(t, testLedger(t), &now, &messages)
	for _, code := range []uint32{0x07008011, 0x07008003, 0, 0x07008011} {
		outcomeReport(t, s, now, fmt.Sprintf(`{"gcode_state":"RUNNING","print_error":%d,"hms":[]}`, code))
		step(t, w, outcomeInput(s, now))
		now = now.Add(CollectionWindow)
		step(t, w, outcomeInput(s, now))
	}
	if len(messages) != 3 {
		t.Fatal("lost distinct fault or recurrence", messages)
	}
}

func TestUnknownFailureAndCompletionRemainSeparate(t *testing.T) {
	now := time.Unix(100, 0)
	s := outcomeFarm(now)
	var messages []Message
	w := scheduledWorker(t, testLedger(t), &now, &messages)
	outcomeReport(t, s, now, `{"task_id":"synthetic-a","gcode_state":"RUNNING","print_error":0,"hms":[]}`)
	step(t, w, outcomeInput(s, now))
	outcomeReport(t, s, now, `{"gcode_state":"FAILED"}`)
	step(t, w, outcomeInput(s, now))
	now = now.Add(CollectionWindow)
	step(t, w, outcomeInput(s, now))
	if len(messages) != 1 {
		t.Fatal("unknown failure swallowed")
	}
	outcomeReport(t, s, now, `{"task_id":"synthetic-b","gcode_state":"RUNNING"}`)
	step(t, w, outcomeInput(s, now))
	outcomeReport(t, s, now, `{"print_error":117473297}`)
	step(t, w, outcomeInput(s, now))
	outcomeReport(t, s, now, `{"gcode_state":"FINISH"}`)
	step(t, w, outcomeInput(s, now))
	if len(messages) != 2 || !strings.Contains(messages[1].Body, "finished") {
		t.Fatal("completion waited for attention", messages)
	}
	now = now.Add(CollectionWindow)
	step(t, w, outcomeInput(s, now))
	if len(messages) != 3 {
		t.Fatal("completion swallowed independent fault", messages)
	}
}
