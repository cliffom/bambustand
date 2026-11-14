# Cell-edge border assessment

[Documentation index](../README.md) · [UI direction](ui-direction.md)

## Decision

Defer experimental cell-edge borders for BambuStand. The conventional Unicode/SGR implementation supplies rounded frames, integrated titles, shared solid dividers and joints, and dotted detail separators. These occupy cells and depend on the terminal font; they cannot reproduce sub-cell stroke widths, arcs or independent edge layers. No fork, capability probe, passthrough or renderer migration is required at runtime.

## Sources and isolated experiment

Reviewed on 2026-11-14 UTC for [#195](https://github.com/cliffom/bambustand/issues/195): the author's [protocol specification](https://github.com/joshka/ghostty/blob/62f25299908b4fc432dca76f330bf43da7185a02/specs/cell-border-protocol.md), [Ghostty experiment](https://github.com/joshka/ghostty/tree/62f25299908b4fc432dca76f330bf43da7185a02), and [Ratatui integration branch](https://github.com/joshka/ratatui/tree/joshka/cell-borders). The specification describes a versioned DCS namespace, query/reply followed by a DA1 ordering barrier, cell-attached borders, a cursor pen, rectangle operations and reset/erase/scroll rules. These experimental implementations do not establish support in BambuStand's Go stack or installed terminals. The introductory website was unavailable through the browsing tool; the primary specification was fetched through GitHub instead.

Run `go run tools/probe-cell-borders.go` from the repository root. The build-excluded experiment keeps all protocol bytes in memory. On macOS 27.2.1 arm64, Go 1.27.4, Bubble Tea 1.3.10, Lip Gloss 1.1.0 and x/ansi 0.11.9, the query had width zero; a pen followed by hello had width five and stripped to hello. Bubble Tea routed the synthetic capability reply as three KeyMsg values: alt+P, a rune string containing the DCS payload, and alt+backslash. This fails safe negotiation before any terminal rendering is attempted. The probe uses a bounded 50ms event loop; it does not prove terminal support, presentation or cleanup.

## Adoption requirements

| Area | Finding and requirement before adoption |
| --- | --- |
| Capability and fallback | Intercept complete, bounded DCS replies before keyboard routing, order them against DA1, and handle unsupported/no-response terminals. Never infer support from environment names. Keep conventional geometry until negotiation succeeds. |
| Width and diffing | ANSI width recognition passes the isolated sample. The [pinned Bubble Tea renderer](https://github.com/charmbracelet/bubbletea/blob/v1.3.10/standard_renderer.go) compares rendered lines, without a model of cell-edge attributes. A reliable backend needs border-aware diffs, including changes with unchanged text and rectangle invalidation. |
| Erase, scroll and resize | The specification transfers the pen to written/erased cells and preserves borders on moved cells. Existing line erasure, scroll optimization and modal overlays need explicit state tracking and redraw/clear tests; width handling alone cannot establish these. |
| Lifecycle | SGR reset clears the pen but not every existing cell border. Alternate-screen entry/exit, interrupted updates, quit, signals and terminal restoration require tested cleanup and conservative full redraws. |
| Multiplexers | The specification describes unknown-DCS discard and DA1 fallback. No installed multiplexer or supporting terminal was tested here. Do not enable passthrough or infer downstream support from an outer terminal. |

Revisit only with an input/backend integration and reproducible supporting-terminal, unsupported-terminal and multiplexer evidence covering all rows above. No experimental terminal was installed or live protocol sent. Mandatory dashboard/modal usability is independent of this decision; current conventional PTY and layout evidence belongs in the [validation record](validation.md).
