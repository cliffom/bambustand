package farm

import (
	"slices"
	"sort"
	"strings"
	"time"
)

// PrintOutcome is shared presentation of a reported print outcome. It does not
// reconcile notices, classify notifications, or change occurrence identities.
type PrintOutcome struct {
	Text     string
	Guidance []string
	Current  bool
}

func (p *Printer) PrintOutcome(now time.Time, connected bool) PrintOutcome {
	return p.printOutcome(now, connected, p.Faults, false)
}

// PrintOutcome applies local visibility to the shared presentation without
// altering reported state. Cancellation remains a reported outcome when its
// notice is hidden; other hidden fault descriptions stay hidden.
func (s *State) PrintOutcome(id string, now time.Time) PrintOutcome {
	p := s.Printers[id]
	if p == nil {
		return PrintOutcome{}
	}
	visible := make([]Fault, 0, len(p.Faults))
	unreviewed := false
	if c, ok := s.Active[id+"/"+ConditionState]; ok {
		unreviewed = !c.Acknowledged && !c.Dismissed
	}
	for _, f := range p.Faults {
		c := s.Active[id+"/"+ConditionFaultPrefix+f.Code]
		if c.Dismissed {
			continue
		}
		visible = append(visible, f)
		unreviewed = unreviewed || !c.Acknowledged
	}
	out := p.printOutcome(now, s.Connected, visible, len(visible) < len(p.Faults))
	if !unreviewed {
		out.Guidance = nil
	}
	return out
}

func (p *Printer) printOutcome(now time.Time, connected bool, visible []Fault, hasHiddenFaults bool) PrintOutcome {
	out := PrintOutcome{Current: p.TelemetryCurrent(now, connected)}
	stopped := p.State == StatePaused || p.State == StateFailed
	canceled := p.State == StateFailed && p.printErrorCurrentJob && slices.ContainsFunc(p.Faults, func(f Fault) bool { return f.Code == "0300_400C" })
	switch {
	case canceled:
		out.Text = "Task canceled"
	case stopped:
		out.Text = "Print paused"
		if p.State == StateFailed {
			out.Text = "Print stopped"
		}
		// Prefer a described non-informational print error, then HMS; stable
		// ordering keeps partial reports from changing the reason arbitrarily.
		faults := slices.Clone(visible)
		sort.SliceStable(faults, func(i, j int) bool {
			if len(faults[i].Code) != len(faults[j].Code) {
				return len(faults[i].Code) < len(faults[j].Code)
			}
			return faults[i].Code < faults[j].Code
		})
		reason := "reason not reported"
		if hasHiddenFaults {
			reason = "no visible fault explanation"
		}
		for _, f := range faults {
			if len(f.Code) == printCodeHexDigits+1 && !p.printErrorCurrentJob {
				continue
			}
			if f.Level == LevelInfo || f.Text == "Printer error" || f.Text == "Unrecognized HMS notice" || f.Text == "" {
				continue
			}
			action := classifyFaultAction(f)
			if action.known && action.guidance == "" && !action.userPause && !action.recovering {
				continue // Maintenance and advisory notices are not verified pause reasons.
			}
			reason = f.Text
			if len(f.Code) > printCodeHexDigits+1 && !action.known && f.Code != "0C00_0300_0003_0008" {
				reason = "reported notice: " + reason // Association does not establish causality.
			}
			break
		}
		out.Text += " · " + reason
	case p.State == StateFinished:
		out.Text = "Print finished"
	default:
		return out
	}
	if !out.Current {
		out.Text = "Last-known: " + out.Text + "; current state unconfirmed"
		return out
	}
	if canceled {
		out.Guidance = append(out.Guidance, "Check the print before restarting using the printer or Bambu app.")
	}
	for _, f := range visible {
		if len(f.Code) == printCodeHexDigits+1 && !p.printErrorCurrentJob {
			continue
		}
		if canceled && f.Code == "0300_400C" {
			continue
		}
		action := classifyFaultAction(f)
		guidance := action.guidance
		if stopped && !action.known && f.Level != LevelInfo {
			guidance = reviewPrinter
		}
		if stopped && (f.Code == "0300_8003" || f.Code == "0C00_0300_0003_0008") {
			guidance = "Inspect print quality for possible spaghetti; follow the printer's instructions before continuing."
		}
		if guidance != "" && !slices.Contains(out.Guidance, guidance) {
			out.Guidance = append(out.Guidance, guidance)
		}
	}
	if stopped && !canceled && len(out.Guidance) == 0 {
		out.Guidance = append(out.Guidance, "Check the printer's reported reason and follow its instructions before continuing.")
	}
	// Stable, distinct instructions consolidate presentation only.
	if !canceled {
		slices.Sort(out.Guidance)
	}
	return out
}

func (o PrintOutcome) NextStep() string { return strings.Join(o.Guidance, " ") }
