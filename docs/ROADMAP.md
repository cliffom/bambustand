# Roadmap

BambuStand prioritizes trustworthy read-only monitoring, useful alerts and quick navigation. This page owns current priorities and milestone intent. Individual release changes belong in the [changelog](CHANGELOG.md); observed results and outstanding checks belong in the [validation record](development/validation.md).

[Documentation index](README.md) · [Open issues](https://github.com/cliffom/bambustand/issues)

## Delivered

The application monitors Bambu Cloud through a TUI or a foreground terminal-free `serve` process, with a shared localhost browser dashboard. Current capabilities include first-launch email-code login, farm filters/sorting, printer/job/AMS inspection, local notice decisions and snoozes, diagnostic exports, theme selection, and opt-in native macOS/browser notifications. See [usage](user/usage.md), [farm view](user/farm-view.md) and [alert policy](user/alerts.md) for current behavior.

Both hosts share session ownership and persisted notice/snooze decisions; canonical application identity is `com.suitepotato.bambustand`. Foreground `serve` requires a running process and saved cloud login. It is not an installed background service. Native macOS delivery currently requires the TUI; browser notifications have separate permission and page-lifecycle limits.

Displayed telemetry has user-reported H2D/X2D validation, and historical router-restart recovery was observed. These scoped results do not complete current-release account/persistence, firmware, notification or device validation; see the [evidence and outstanding work](development/validation.md#remaining-live-checks).

Both interfaces show reported AMS drying status, known message descriptions and shared print outcomes. Native/browser notifications collect related reports per printer and represent cancellation through one failed-state outcome. The [notification strategy](development/notification-strategy.md) captures current rules and directing policy for iOS/Android; monitoring-loss notifications remain proposed.

## Current priority

The owner-requested compact browser dashboard in [#183](https://github.com/cliffom/bambustand/issues/183) takes the next release ahead of the notification backlog: search-aware status counts, mobile selection, compact cards and front-view illustrations, distinct Details/Notices entry, and responsive inspection. This branch prepares v0.10.0; the issue remains open until its implementation PR merges. Broader browser/device validation remains in #139. Notice controls (#136), view persistence (#138), remote access (#143), and notification policy remain separately scoped. After this release, resume the notification reliability milestone without dropping the usability and validation work below.

## Open-issue milestones

Open issue states and milestone assignments were checked on 2026-11-12 against the open GitHub issues and milestone assignments. This backlog is grouped by outcome, without committed delivery dates or release versions. The design milestones track decisions only; implementation requires an adopted design and separately scoped work.

| Milestone | Open issues | Completion criteria |
| --- | --- | --- |
| [Dashboard usability](https://github.com/cliffom/bambustand/milestone/14) | [#136](https://github.com/cliffom/bambustand/issues/136), [#137](https://github.com/cliffom/bambustand/issues/137), [#138](https://github.com/cliffom/bambustand/issues/138) | Shared browser notice/snooze controls, TUI Idle / finished filtering and browser view persistence, with relevant interaction/layout checks and current documentation/captures. |
| [Validation and performance baselines](https://github.com/cliffom/bambustand/milestone/15) | [#23](https://github.com/cliffom/bambustand/issues/23), [#38](https://github.com/cliffom/bambustand/issues/38), [#39](https://github.com/cliffom/bambustand/issues/39), [#139](https://github.com/cliffom/bambustand/issues/139) | Recorded native-notification and live-account checks, measured large-farm baselines, and broader browser/device evidence, with exact environments and explicit limitations. Unavailable checks require an explicit disposition before closure. |
| [Foreground native notifications — design](https://github.com/cliffom/bambustand/milestone/16) | [#142](https://github.com/cliffom/bambustand/issues/142) | A reviewed decision with rationale, environment/lifecycle boundaries, shared delivery policy, implementation phases, and validation requirements coordinated with #23. |
| [Authenticated remote access — design](https://github.com/cliffom/bambustand/milestone/17) | [#143](https://github.com/cliffom/bambustand/issues/143) | A reviewed decision with rationale, trust/threat model, access protections, deployment options, and phased verification requirements; localhost defaults remain in place. |
| [Notification reliability and monitoring-loss alerts](https://github.com/cliffom/bambustand/milestone/18) | [#175](https://github.com/cliffom/bambustand/issues/175), [#176](https://github.com/cliffom/bambustand/issues/176), [#177](https://github.com/cliffom/bambustand/issues/177), [#178](https://github.com/cliffom/bambustand/issues/178) | Lead with opt-in sustained monitoring-loss alerts that distinguish unavailable monitoring from printer failure. Audit actionable metadata, delayed-report/dual-channel noise and browser lifecycle gaps, with verified decisions and maintained strategy/user guidance. Coordinate existing live checks in milestone 15. |

Live validation in #23 and #38 remains deferred behind usability work, as recorded in those issues. Milestone assignment does not establish successful validation or authorize printer control, remote binding, or an installed background service. Earlier version milestones retain historical release context. Detailed outstanding checks are maintained only in the [validation record](development/validation.md#remaining-live-checks).

## Scope and validation

Printer control, job submission, LAN monitoring, camera feeds, authenticated remote access and an installed background service are outside current implemented scope. Read-only LAN monitoring was [closed as not planned (#12)](https://github.com/cliffom/bambustand/issues/12). Remote access and foreground native notifications remain design proposals in the milestones above. Existing AMS/filament inspection is delivered; this roadmap makes no commitment to additional inventory management.

Keep unknown telemetry distinct from confirmed state, and local acknowledgement/hiding/snoozing distinct from physical fault resolution. A delivered feature, closed issue or published release does not establish a successful environment or hardware check. Milestone completion requires implemented acceptance criteria, applicable interaction/layout coverage, current guidance/captures, and explicitly scoped validation evidence or a recorded disposition for unavailable checks.
