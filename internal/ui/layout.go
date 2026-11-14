package ui

// tableColumns describes widths shared by the header and every printer row.
type tableColumns struct {
	name, link, state, progress, remaining, finish, notices int
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
