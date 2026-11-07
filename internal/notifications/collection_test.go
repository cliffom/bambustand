package notifications

import (
	"testing"
	"time"

	"github.com/cliffom/bambustand/internal/farm"
	"github.com/cliffom/bambustand/internal/notification_state"
)

func TestCollectionKeepsPrinterJobAndRecurrenceBoundaries(t *testing.T) {
	at := time.Unix(100, 0)
	input := Input{Snapshot: farm.NotificationSnapshot{
		"A": {Job: farm.NotificationJob{Task: "synthetic-a"}, Conditions: map[string]farm.NotificationCondition{"fault": {Class: farm.NotificationIntervention}, "state": {Class: farm.NotificationFailure}}},
		"B": {Job: farm.NotificationJob{Task: "synthetic-b"}, Conditions: map[string]farm.NotificationCondition{"fault": {Class: farm.NotificationIntervention}}},
	}}
	a := notification_state.Candidate{ID: "a-first", PrinterID: "A", ConditionKey: "fault", Kind: notification_state.Intervention}
	aState := notification_state.Candidate{ID: "a-state", PrinterID: "A", ConditionKey: "state", Kind: notification_state.Intervention}
	b := notification_state.Candidate{ID: "b-first", PrinterID: "B", ConditionKey: "fault", Kind: notification_state.Intervention}
	var collection Collection
	if ready := collection.Ready([]notification_state.Candidate{a}, input, at); len(ready) != 0 {
		t.Fatal(ready)
	}
	all := []notification_state.Candidate{a, aState, b}
	if ready := collection.Ready(all, input, at.Add(3*time.Second)); len(ready) != 0 {
		t.Fatal(ready)
	}
	ready := collection.Ready(all, input, at.Add(CollectionWindow))
	if len(ready) != 2 || ready[0] != a || ready[1] != aState {
		t.Fatal("extended A deadline or merged B", ready)
	}
	// A was consumed; its replacement must not join the old due window.
	a.ID = "a-recurrence"
	remaining := []notification_state.Candidate{a, b}
	ready = collection.Ready(remaining, input, at.Add(CollectionWindow))
	if len(ready) != 0 {
		t.Fatal("recurrence absorbed by consumed group", ready)
	}
	ready = collection.Ready(remaining, input, at.Add(9*time.Second))
	if len(ready) != 1 || ready[0] != b {
		t.Fatal(ready)
	}
	// Even a still-pending condition cannot use the previous job's deadline.
	p := input.Snapshot["A"]
	p.Job.Task = "synthetic-new-job"
	input.Snapshot["A"] = p
	ready = collection.Ready([]notification_state.Candidate{a}, input, at.Add(12*time.Second))
	if len(ready) != 0 {
		t.Fatal("new job inherited old window", ready)
	}
	ready = collection.Ready([]notification_state.Candidate{a}, input, at.Add(18*time.Second))
	if len(ready) != 1 {
		t.Fatal("new job was swallowed", ready)
	}
}

func TestBurstWindowForNewJobsAndClearedOccurrences(t *testing.T) {
	at := time.Unix(100, 0)
	input := Input{Snapshot: farm.NotificationSnapshot{"A": {Job: farm.NotificationJob{Task: "synthetic-a"}}}}
	a := notification_state.Candidate{ID: "first", PrinterID: "A", Kind: notification_state.Intervention}
	var burst burstCollection
	if ready := burst.ready([]notification_state.Candidate{a}, input, at, 5*time.Second); len(ready) != 0 {
		t.Fatal(ready)
	}
	// The old occurrence clears; its replacement cannot inherit the t=5
	// deadline, even without an intervening empty candidate frame.
	a.ID = "replacement"
	if ready := burst.ready([]notification_state.Candidate{a}, input, at.Add(4*time.Second), 5*time.Second); len(ready) != 0 {
		t.Fatal(ready)
	}
	if ready := burst.ready([]notification_state.Candidate{a}, input, at.Add(5*time.Second), 5*time.Second); len(ready) != 0 {
		t.Fatal("replacement inherited cleared burst deadline", ready)
	}
	// A still-present fault on a new job also starts a new burst window.
	p := input.Snapshot["A"]
	p.Job.Task = "synthetic-next"
	input.Snapshot["A"] = p
	if ready := burst.ready([]notification_state.Candidate{a}, input, at.Add(9*time.Second), 5*time.Second); len(ready) != 0 {
		t.Fatal("new job inherited an old burst deadline", ready)
	}
	if ready := burst.ready([]notification_state.Candidate{a}, input, at.Add(14*time.Second), 5*time.Second); len(ready) != 1 {
		t.Fatal("new job missed its burst deadline", ready)
	}
	if ready := burst.ready(nil, input, at.Add(14*time.Second), 5*time.Second); len(ready) != 0 || len(burst.members) != 0 || !burst.due.IsZero() {
		t.Fatal("empty candidate set retained burst state", burst)
	}
}
