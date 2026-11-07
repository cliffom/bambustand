package notifications

import (
	"time"

	"github.com/cliffom/bambustand/internal/farm"
	"github.com/cliffom/bambustand/internal/notification_state"
)

// CollectionWindow bounds latency for separately reported attention reasons.
// Completion never waits for this window. Later reports do not extend it.
const CollectionWindow = 6 * time.Second

type (
	Collection      struct{ members map[string]collectionMember }
	burstCollection struct {
		due     time.Time
		members map[string]collectionMember
	}
	collectionMember struct {
		printer, task, subtask string
		due                    time.Time
	}
)

// Ready retains only current candidates and returns the due members. Call only
// on the serial delivery owner with its newest immutable snapshot. No timer may
// send from cached values. Separate occurrence IDs survive presentation grouping.
func (c *Collection) Ready(candidates []notification_state.Candidate, input Input, now time.Time) []notification_state.Candidate {
	next := make(map[string]collectionMember, len(candidates))
	// Index only still-current members, keeping the scan linear in ledger size.
	deadlines := map[collectionMember]time.Time{}
	for _, candidate := range candidates {
		if previous, ok := c.members[candidate.ID]; ok {
			key := previous
			key.due = time.Time{}
			if due, exists := deadlines[key]; !exists || previous.due.Before(due) {
				deadlines[key] = previous.due
			}
		}
	}
	var ready []notification_state.Candidate
	for _, candidate := range candidates {
		p := input.Snapshot[candidate.PrinterID]
		condition := p.Conditions[candidate.ConditionKey]
		if candidate.Kind == notification_state.Completion || condition.Class == "" {
			ready = append(ready, candidate)
			continue
		}
		member := collectionMember{printer: candidate.PrinterID, task: p.Job.Task, subtask: p.Job.Subtask, due: now.Add(CollectionWindow)}
		if previous, ok := c.members[candidate.ID]; ok && sameCollection(previous, member) {
			member.due = previous.due
		} else {
			// Join only a still-pending occurrence on this printer/job. An
			// already consumed group cannot absorb a later independent fault.
			key := member
			key.due = time.Time{}
			if due, ok := deadlines[key]; ok && due.Before(member.due) {
				member.due = due
			}
		}
		next[candidate.ID] = member
		if !now.Before(member.due) {
			ready = append(ready, candidate)
		}
	}
	c.members = next
	return ready
}

func sameCollection(a, b collectionMember) bool {
	return a.printer == b.printer && a.task == b.task && a.subtask == b.subtask
}

// ready preserves each pending member's original burst deadline, even when a
// completion sends before attention collection finishes. New occurrences join
// only an unelapsed burst window; otherwise they start a new one. Like attention
// collection, this is bounded scheduling metadata on the serial native owner.
func (b *burstCollection) ready(candidates []notification_state.Candidate, input Input, now time.Time, window time.Duration) []notification_state.Candidate {
	if window <= 0 || len(candidates) == 0 {
		*b = burstCollection{}
		return candidates
	}
	next := make(map[string]collectionMember, len(candidates))
	// A disappeared occurrence/job cannot keep an open window alive.
	var retained bool
	for _, candidate := range candidates {
		p := input.Snapshot[candidate.PrinterID]
		member := collectionMember{printer: candidate.PrinterID, task: p.Job.Task, subtask: p.Job.Subtask}
		if previous, ok := b.members[candidate.ID]; ok && sameCollection(previous, member) {
			next[candidate.ID] = previous
			retained = retained || previous.due.Equal(b.due)
		}
	}
	if !retained {
		b.due = time.Time{}
	}
	var ready []notification_state.Candidate
	for _, candidate := range candidates {
		member, exists := next[candidate.ID]
		if !exists {
			if !now.Before(b.due) {
				b.due = now.Add(window)
			}
			p := input.Snapshot[candidate.PrinterID]
			member = collectionMember{printer: candidate.PrinterID, task: p.Job.Task, subtask: p.Job.Subtask, due: b.due}
			next[candidate.ID] = member
		}
		if !now.Before(member.due) {
			ready = append(ready, candidate)
		}
	}
	b.members = next
	return ready
}

// AttentionBody uses fixed prose rather than private job names or report text.
func AttentionBody(group []notification_state.Candidate, input Input) string {
	for _, candidate := range group {
		c := input.Snapshot[candidate.PrinterID].Conditions[candidate.ConditionKey]
		if c.Family == farm.NotificationStateFamily && c.Class == farm.NotificationCancellation {
			if len(group) > 1 {
				return "Task canceled; other reported conditions need attention. Open BambuStand to inspect them."
			}
			return "Task canceled. Check the print before restarting using the printer or Bambu app."
		}
	}
	for _, candidate := range group {
		condition := input.Snapshot[candidate.PrinterID].Conditions[candidate.ConditionKey]
		if condition.Class == farm.NotificationSpaghetti {
			return "Possible spaghetti detected. Inspect print quality and the printer's reported instructions before continuing."
		}
	}
	for _, candidate := range group {
		condition := input.Snapshot[candidate.PrinterID].Conditions[candidate.ConditionKey]
		if condition.Class == farm.NotificationFailure {
			return "Print stopped. Open BambuStand to inspect reported conditions. Physical resolution is unconfirmed."
		}
	}
	return "Needs attention. Open BambuStand to inspect reported conditions. Physical resolution is unconfirmed."
}

// DeliveryGroups groups pending attention members on one printer; completion
// retains a separate delivery and identity. Cross-printer native burst grouping
// is an independent opt-in policy.
func DeliveryGroups(candidates []notification_state.Candidate) [][]notification_state.Candidate {
	return deliveryGroups(candidates)
}
