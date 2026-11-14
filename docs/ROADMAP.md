# Roadmap

BambuStand prioritizes trustworthy read-only monitoring, useful alerts and quick navigation. This page owns current priorities and milestone intent. Individual release changes belong in the [changelog](CHANGELOG.md); observed results and outstanding checks belong in the [validation record](development/validation.md).

[Documentation index](README.md) · [Open issues](https://github.com/cliffom/bambustand/issues)

## Delivered

The application monitors Bambu Cloud through a TUI or a foreground terminal-free `serve` process, with a shared localhost browser dashboard. Current capabilities include first-launch email-code login, farm filters/sorting, printer/job/AMS inspection, local notice decisions and snoozes, diagnostic exports, theme selection, and opt-in native macOS/browser notifications. See [usage](user/usage.md), [farm view](user/farm-view.md) and [alert policy](user/alerts.md) for current behavior.

Both hosts share session ownership and persisted notice/snooze decisions; canonical application identity is `com.suitepotato.bambustand`. Foreground `serve` requires a running process and saved cloud login. It is not an installed background service. Native macOS delivery currently requires the TUI; browser notifications have separate permission and page-lifecycle limits.

Displayed telemetry has user-reported H2D/X2D validation, and historical router-restart recovery was observed. These scoped results do not complete current-release account/persistence, firmware, notification or device validation; see the [evidence and outstanding work](development/validation.md#remaining-live-checks).

Both interfaces show reported AMS drying status, known message descriptions and shared print outcomes. Native/browser notifications collect related reports per printer and represent cancellation through one failed-state outcome. The [notification strategy](development/notification-strategy.md) captures current rules and directing policy for iOS/Android; monitoring-loss notifications remain proposed.

## Current priority

The user-selected next release is the [TUI UI/UX refresh, milestone 19](https://github.com/cliffom/bambustand/milestone/19), prepared as v0.12.0 in this branch. Complete its implementation and release review before resuming notification reliability, led by sustained monitoring-loss alerts (#175). Broader browser/device validation remains in #139; notice controls (#136), the TUI Idle / finished filter (#137), browser view persistence (#138) and remote access (#143) remain separately scoped.

## Open-issue milestones

Open issue states and milestone assignments were checked on 2026-11-14 (UTC) against the open GitHub issues and milestone assignments. This backlog is grouped by outcome, without committed delivery dates or release versions. The design milestones track decisions only; implementation requires an adopted design and separately scoped work.

| Milestone | Open issues | Completion criteria |
| --- | --- | --- |
| [Dashboard usability](https://github.com/cliffom/bambustand/milestone/14) | [#136](https://github.com/cliffom/bambustand/issues/136), [#137](https://github.com/cliffom/bambustand/issues/137), [#138](https://github.com/cliffom/bambustand/issues/138) | Shared browser notice/snooze controls, TUI Idle / finished filtering and browser view persistence, with relevant interaction/layout checks and current documentation/captures. |
| [Validation and performance baselines](https://github.com/cliffom/bambustand/milestone/15) | [#23](https://github.com/cliffom/bambustand/issues/23), [#38](https://github.com/cliffom/bambustand/issues/38), [#39](https://github.com/cliffom/bambustand/issues/39), [#139](https://github.com/cliffom/bambustand/issues/139) | Recorded native-notification and live-account checks, measured large-farm baselines, and broader browser/device evidence, with exact environments and explicit limitations. Unavailable checks require an explicit disposition before closure. |
| [Foreground native notifications — design](https://github.com/cliffom/bambustand/milestone/16) | [#142](https://github.com/cliffom/bambustand/issues/142) | A reviewed decision with rationale, environment/lifecycle boundaries, shared delivery policy, implementation phases, and validation requirements coordinated with #23. |
| [Authenticated remote access — design](https://github.com/cliffom/bambustand/milestone/17) | [#143](https://github.com/cliffom/bambustand/issues/143) | A reviewed decision with rationale, trust/threat model, access protections, deployment options, and phased verification requirements; localhost defaults remain in place. |
| [Notification reliability and monitoring-loss alerts](https://github.com/cliffom/bambustand/milestone/18) | [#175](https://github.com/cliffom/bambustand/issues/175), [#176](https://github.com/cliffom/bambustand/issues/176), [#177](https://github.com/cliffom/bambustand/issues/177), [#178](https://github.com/cliffom/bambustand/issues/178) | Lead with opt-in sustained monitoring-loss alerts that distinguish unavailable monitoring from printer failure. Audit actionable metadata, delayed-report/dual-channel noise and browser lifecycle gaps, with verified decisions and maintained strategy/user guidance. Coordinate existing live checks in milestone 15. |

Live validation in #23 and #38 remains deferred behind usability work, as recorded in those issues. Milestone assignment does not establish successful validation or authorize printer control, remote binding, or an installed background service. Earlier version milestones retain historical release context. Detailed outstanding checks are maintained only in the [validation record](development/validation.md#remaining-live-checks).

## TUI UI/UX refresh

[Milestone 19](https://github.com/cliffom/bambustand/milestone/19) is implemented in the v0.12.0 candidate and awaits PR/CI and release review. Its six issues remain open until the implementation PR merges: [#190 shared frames](https://github.com/cliffom/bambustand/issues/190), [#191 dashboard](https://github.com/cliffom/bambustand/issues/191), [#192 Config](https://github.com/cliffom/bambustand/issues/192), [#193 Action needed / Filament](https://github.com/cliffom/bambustand/issues/193), [#194 status/activity and remaining dialogs](https://github.com/cliffom/bambustand/issues/194), and [#195 protocol assessment](https://github.com/cliffom/bambustand/issues/195). The last records [deferral of experimental cell-edge rendering](development/cell-border-assessment.md), independently from the conventional implementation.

The [design review](development/design/tui-refresh-review/index.html) retains approved generated references. Current implementation and capture evidence belongs in the [validation record](development/validation.md); generated concepts are not application or hardware evidence. Keep the 60 × 18 minimum and read-only/telemetry/local-decision contracts. Release preparation does not constitute publication or live validation.

## Scope and validation

Printer control, job submission, LAN monitoring, camera feeds, authenticated remote access and an installed background service are outside current implemented scope. Read-only LAN monitoring was [closed as not planned (#12)](https://github.com/cliffom/bambustand/issues/12). Remote access and foreground native notifications remain design proposals in the milestones above. Existing AMS/filament inspection is delivered; this roadmap makes no commitment to additional inventory management.

Keep unknown telemetry distinct from confirmed state, and local acknowledgement/hiding/snoozing distinct from physical fault resolution. A delivered feature, closed issue or published release does not establish a successful environment or hardware check. Milestone completion requires implemented acceptance criteria, applicable interaction/layout coverage, current guidance/captures, and explicitly scoped validation evidence or a recorded disposition for unavailable checks.
