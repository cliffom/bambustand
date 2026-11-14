//go:build ignore

// Run with go run tools/probe-cell-borders.go. All experimental bytes are kept
// in memory; this probe never sends capability queries or pens to the terminal.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
)

type probe struct{ keys []string }

func (m probe) Init() tea.Cmd {
	return tea.Tick(50*time.Millisecond, func(time.Time) tea.Msg { return tea.Quit() })
}

func (m probe) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	if k, ok := msg.(tea.KeyMsg); ok {
		m.keys = append(m.keys, k.String())
	}
	return m, nil
}
func (m probe) View() string { return "isolated input probe" }

func main() {
	query := "\x1bP1+bcell-border;q\x1b\\"
	reply := "\x1bP1+bcell-border;ok;1;pen,rect,half,center,palette\x1b\\\x1b[?1;2c"
	pen := "\x1bP1+bcell-border;pen;48;32;7aa2f7;0;0\x1b\\"
	var output bytes.Buffer
	model, err := tea.NewProgram(probe{}, tea.WithInput(strings.NewReader(reply)), tea.WithOutput(&output), tea.WithoutRenderer(), tea.WithoutSignalHandler()).Run()
	if err != nil {
		panic(err)
	}
	result := struct {
		QueryWidth, PenTextWidth int
		Stripped                 string
		RoutedKeys               []string
	}{ansi.StringWidth(query), ansi.StringWidth(pen + "hello\x1b[0m"), ansi.Strip(pen + "hello\x1b[0m"), model.(probe).keys}
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}
