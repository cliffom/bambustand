package ui

import (
	"fmt"
	"reflect"
	"strconv"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

// Modal geometry is shared by viewport synchronization, paging and rendering.
// The full terminal remains the dashboard's coordinate space. No resize changes
// the input owner or reconstructs its input, selection or suspended parents.
func (m Model) dialogWidth() int { return max(1, min(maximumModalWidth, m.width-modalHorizontalInset)) }

func (m Model) dialogHeight() int {
	return max(1, min(maximumModalHeight, m.height-modalVerticalInset))
}

func (m Model) modalView(content string) string {
	// Compact shutdown must remain usable even below the normal minimum.
	if !m.terminalFits() {
		return content
	}
	w, h := m.dialogWidth(), m.dialogHeight()
	rows := strings.Split(m.styles.canvas(content, w, h), "\n")
	// Integrate the existing title into the border without adding a row or
	// taking space away from the independent scrollable body and fixed footer.
	title := ansi.Cut(rows[0], 0, ansi.StringWidth(strings.TrimRight(ansi.Strip(rows[0]), " ")))
	rows[0] = ""
	border := m.styles.border.Padding(0).Width(w).Render(strings.Join(rows, "\n"))
	box := strings.Split(border, "\n")
	label := " " + ansi.Truncate(title, w-4, "…") + " "
	stroke := m.styles.text.Foreground(m.styles.palette.Border)
	box[0] = stroke.Render("╭─") + label + stroke.Render(strings.Repeat("─", max(0, w-ansi.StringWidth(label)-1))+"╮")
	left, top := (m.width-w-2)/2, (m.height-h-2)/2
	background := m.dimmedDashboard()
	reset := ""
	if surfaceColor(m.styles.palette.Text, false) != "" {
		reset = "\x1b[0m"
	}
	for i, row := range box {
		y := top + i
		background[y] = ansi.Cut(background[y], 0, left) + reset + paintSurface(row, m.styles.palette.Text, m.styles.palette.Background) + reset + ansi.Cut(background[y], left+w+2, m.width)
	}
	return strings.Join(background, "\n")
}

// Re-render every dashboard role at 38% distance from the theme's background,
// including selected surfaces and the footer. Preserve all text/focus markers.
// An inherited background has no known RGB: infer a dark/light blending target
// from the theme's text, without querying the terminal or painting that target.
func (m Model) dimmedDashboard() []string {
	p := m.styles.palette
	background := p.Background
	if background == "" {
		r, g, b := rgb(p.Text)
		if r+g+b >= 384 {
			background = lipgloss.Color(fmt.Sprintf("#%06X", 0))
		} else {
			background = lipgloss.Color(fmt.Sprintf("#%06X", 1<<24-1))
		}
	}
	roles := reflect.ValueOf(&p).Elem()
	for i := 0; i < roles.NumField(); i++ {
		if roles.Type().Field(i).Name == "Background" {
			continue
		}
		roles.Field(i).SetString(string(blend(lipgloss.Color(roles.Field(i).String()), background)))
	}
	m.styles = newStyles(p)
	if m.dialog.active == dialogServerStatus {
		m.toast = ""
	}
	// Cached panel content must use the same dimmed semantic palette. This is a
	// value copy: dashboard viewports are values and no dialog cache is touched.
	m.syncPanels()
	return strings.Split(m.styles.canvas(m.dashboardView(), m.width, m.height), "\n")
}

func rgb(c lipgloss.Color) (int, int, int) {
	v, _ := strconv.ParseUint(strings.TrimPrefix(string(c), "#"), 16, 24)
	return int(v >> 16), int(v >> 8 & 255), int(v & 255)
}

func blend(foreground, background lipgloss.Color) lipgloss.Color {
	r, g, b := rgb(foreground)
	br, bg, bb := rgb(background)
	channel := func(a, base int) int { return base + (a-base)*inactiveColorPercent/100 }
	return lipgloss.Color(fmt.Sprintf("#%02X%02X%02X", channel(r, br), channel(g, bg), channel(b, bb)))
}
