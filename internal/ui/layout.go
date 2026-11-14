package ui

import "github.com/charmbracelet/x/ansi"

// tableColumns describes widths shared by the header and every printer row.
type tableColumns struct {
	name, link, state, progress, remaining, finish, notices int
}

// Summary columns reserve two-digit counts so ordinary telemetry does not move
// labels. Larger counts expand rather than truncate. Compact notices may span
// the otherwise unused fourth column on the second row.
func overviewColumnWidths(width int, state [4]string, attention [3]string, compact bool) [3]int {
	columns := [3]int{12, 14, 26}
	if compact {
		columns = [3]int{8, 10, 0}
	}
	for i := range columns {
		columns[i] = max(columns[i], ansi.StringWidth(state[i]), ansi.StringWidth(attention[i]))
	}
	if compact {
		columns[2] = max(ansi.StringWidth(state[2]), min(columns[2], width-columns[0]-columns[1]-9-max(12, ansi.StringWidth(state[3]))))
	}
	return columns
}

// activityColumnWidths reserves the complete longest outcome at every supported
// size. Geometry depends on the viewport, never on the current history or row.
func activityColumnWidths(width int) (printer, subject, outcome int) {
	const fixed = 2 + 8 + 1 + 3 + 3 // marker, clock, space and two separators
	outcome = 11                    // Unconfirmed
	available := max(2, width-fixed-outcome)
	printer = min(available-1, min(28, max(11, available*2/5)))
	subject = available - printer
	return printer, subject, outcome
}

func columnsFor(width int) tableColumns {
	if width < compactTableWidth {
		return tableColumns{name: 21, state: 12, progress: 12}
	}
	if width < fullTableWidth {
		return tableColumns{name: 22, link: 10, state: 12, progress: 9, remaining: 11}
	}
	return tableColumns{name: 23, link: 10, state: 12, progress: 16, remaining: 11, finish: 10, notices: 4}
}
