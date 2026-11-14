package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
)

// dashboardPanel identifies a panel in Tab navigation order.
type dashboardPanel uint8

const (
	panelPrinters dashboardPanel = iota
	panelDetails
	panelNotices
	panelCount
)

func (m Model) panelStroke(focused bool) lipgloss.Style {
	if focused {
		return m.styles.focus
	}
	return m.styles.secondary
}

func (m Model) panelEdge(title string, focused bool, width int, left, right string) string {
	label := ""
	if title != "" {
		label = ansi.Truncate("─ "+title+" ", max(0, width-2), "…")
	}
	return m.panelStroke(focused).Render(left + label + strings.Repeat("─", max(0, width-ansi.StringWidth(left+label+right))) + right)
}

func (m Model) panelRow(content string, width int, focused bool) string {
	return m.panelStroke(focused).Render("│") + m.panelContent(content, width) + m.panelStroke(focused).Render("│")
}

func (m Model) panelContent(content string, width int) string {
	content = ansi.Truncate(content, max(0, width), "…")
	return content + strings.Repeat(" ", max(0, width-ansi.StringWidth(content)))
}

func (m Model) joinedPanelRow(left, right string, leftWidth, rightWidth int) string {
	return m.panelStroke(m.focus == panelDetails).Render("│") + m.panelContent(left, leftWidth) +
		m.panelStroke(m.focus == panelDetails || m.focus == panelNotices).Render("│") +
		m.panelContent(right, rightWidth) + m.panelStroke(m.focus == panelNotices).Render("│")
}
