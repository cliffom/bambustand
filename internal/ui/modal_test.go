package ui

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/muesli/termenv"
)

// activeView lets interaction tests inspect the active owner's content/footer
// independently of the inactive dashboard still visible around its frame.
func activeView(m Model) string {
	if m.hasOpenDialog() && m.terminalFits() {
		return m.styles.canvas(routeFor(m.dialog.active).view(m), m.dialogWidth(), m.dialogHeight())
	}
	return m.View()
}

func TestModalFullContrastAndInactiveDimming(t *testing.T) {
	previous := lipgloss.ColorProfile()
	t.Cleanup(func() { lipgloss.SetColorProfile(previous) })
	names, err := BundledThemeNames()
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range names {
		theme, err := LoadThemeOverride(name)
		if err != nil {
			t.Fatal(err)
		}
		p := theme.Palette
		background := p.Background
		if background == "" {
			r, g, b := rgb(p.Text)
			target := 0
			if r+g+b < 384 {
				target = 1<<24 - 1
			}
			background = lipgloss.Color(fmt.Sprintf("#%06X", target))
		}
		for _, profile := range []termenv.Profile{termenv.TrueColor, termenv.ANSI256, termenv.Ascii} {
			lipgloss.SetColorProfile(profile)
			m := key(resizeModel(demoModel().WithPalette(p), 120, 32), ",")
			rows := strings.Split(m.View(), "\n")
			left, top := (m.width-m.dialogWidth()-2)/2, (m.height-m.dialogHeight()-2)/2
			assertPaint(t, rows[0], "BambuStand", blend(p.Accent, background), p.Background, true)
			assertPaint(t, rows[top], "CONFIG", p.Accent, p.Background, true)
			assertPaint(t, ansi.Cut(rows[top], left, left+m.dialogWidth()+2), "╭", p.Border, p.Background, false)
			// Inherited modal blanks must reset a dimmed dashboard selection's
			// background as well as its foreground at the composition boundary.
			body := ansi.Cut(rows[top+1], left+1, left+1+m.dialogWidth())
			for _, cell := range paintedCells(body) {
				if cell.background != expectedPaint(p.Text, p.Background, false).background {
					t.Fatal("modal surface inherited inactive color", name, profile)
				}
			}
			footer := ansi.Cut(rows[top+m.dialogHeight()], left+1, left+1+m.dialogWidth())
			assertPaint(t, footer, "Cloud endpoint", p.FooterText, p.FooterBackground, false)
			assertPaint(t, rows[len(rows)-1], "select", blend(p.FooterText, background), blend(p.FooterBackground, background), false)
		}
	}
}

func TestModalResizeKeepsInvalidInputAndSuspendedOwner(t *testing.T) {
	m := key(key(key(demoModel(), ","), "down"), "enter")
	m = key(key(m, "101"), "enter")
	input, problem, revision := m.configInput, m.configInputError, m.ConfigRevision()
	if !m.configEditing || problem == "" {
		t.Fatal("invalid input fixture")
	}
	m = key(m, "ctrl+e")
	owner := m.dialog
	for _, size := range [][2]int{{120, 32}, {60, 18}, {59, 17}, {151, 45}, {60, 18}} {
		m = resizeModel(m, size[0], size[1])
		before := hiddenState(m)
		_ = m.View()
		if m.dialog != owner || m.configInput != input || m.configInputError != problem || !m.configEditing || m.ConfigRevision() != revision || !reflect.DeepEqual(before, hiddenState(m)) {
			t.Fatal("resize/render changed suspended edit", size)
		}
	}
	m = key(m, "esc")
	if m.dialog.active != dialogConfig || m.configInput != input || m.configInputError != problem {
		t.Fatal("return lost invalid edit")
	}
}

func TestModalCenteringBoundsAndOpaqueBody(t *testing.T) {
	for _, size := range [][2]int{{60, 18}, {80, 24}, {105, 32}, {120, 32}, {151, 45}} {
		for _, input := range []string{",", "?", "A", "m", "N", "D", "W", "ctrl+e", "X"} {
			m := resizeModel(noticeModel(t), size[0], size[1])
			m = key(m, input)
			if !m.hasOpenDialog() {
				t.Fatalf("%s did not open", input)
			}
			view := m.View()
			rows := strings.Split(view, "\n")
			w, h := m.dialogWidth(), m.dialogHeight()
			left, top := (m.width-w-2)/2, (m.height-h-2)/2
			if len(rows) != m.height {
				t.Fatal("height", input, size)
			}
			for _, row := range rows {
				if ansi.StringWidth(row) != m.width {
					t.Fatal("width", input, size)
				}
			}
			if !strings.HasPrefix(ansi.Strip(ansi.Cut(rows[top], left, left+w+2)), "╭") || !strings.HasSuffix(ansi.Strip(ansi.Cut(rows[top+h+1], left, left+w+2)), "╯") {
				t.Fatal("frame not centered", input, size, "\n"+ansi.Strip(view))
			}
			// The interior is precisely the owner's canvas, including blank cells;
			// dashboard text must never bleed through its padding or body.
			content := strings.Split(activeView(m), "\n")
			for y := 1; y < h; y++ {
				if ansi.Strip(ansi.Cut(rows[top+1+y], left+1, left+1+w)) != ansi.Strip(content[y]) {
					t.Fatal("transparent or clipped interior", input, size, y)
				}
			}
		}
	}
}

func TestSharedPanelFocusIncludesDivider(t *testing.T) {
	previous := lipgloss.ColorProfile()
	lipgloss.SetColorProfile(termenv.TrueColor)
	t.Cleanup(func() { lipgloss.SetColorProfile(previous) })
	m := demoModel()
	for _, focus := range []dashboardPanel{panelPrinters, panelDetails, panelNotices} {
		m.focus = focus
		color := m.styles.palette.SecondaryText
		if focus != panelPrinters {
			color = m.styles.palette.Focus
		}
		row := m.joinedPanelRow("left", "right", 20, 20)
		assertPaint(t, ansi.Cut(row, 21, 22), "│", color, "", false)
		if ansi.StringWidth(row) != 43 {
			t.Fatal("shared divider consumed extra columns")
		}
	}
}
