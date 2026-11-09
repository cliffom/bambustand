# Notification strategy

[Documentation index](../README.md) · [Alert preferences](../user/alerts.md) · [Architecture](architecture.md)

This is the maintained directing reference for notification decisions in BambuStand and for [bambustand-ios](https://github.com/cliffom/bambustand-ios) and [bambustand-android](https://github.com/cliffom/bambustand-android). It owns product intent, event eligibility and cross-platform direction. The [alert guide](../user/alerts.md) owns current setup, controls and detailed delivery policies; [architecture](architecture.md) owns implementation mechanics. Mobile direction below is a requirement for adoption, not a claim that either app currently implements it. Their code and delivery services were not audited for this document.

## Purpose

Interrupt the operator when a reported condition warrants inspection or intervention. Keep routine telemetry and informational notices available for inspection without turning every update into a notification. Reduce notification fatigue and unnecessary mobile processing and delivery cost by deciding eligibility before scheduling delivery.

An actionable classification is a reason to inspect, not proof of physical failure. Possible spaghetti detection must remain qualified. Acknowledgement, hiding, snoozing and notification dismissal never repair a printer, resume a job or establish that a condition cleared. Printer control remains outside this project's scope.

## Current desktop and browser behavior

Baseline reviewed against v0.9.1, source revision `93c7f5d`, on 2026-11-08. This table describes implemented eligibility before preferences, review state, snoozes, quiet hours, freshness and delivery constraints are applied.

| Reported event | Current automatic notification decision |
| --- | --- |
| Verified intervention fault: runout, feed/retract/path, extrusion or other curated intervention code | Eligible even while state still reports RUNNING; a separate PAUSE/FAILED report is not required |
| Possible spaghetti detection with verified action metadata | Eligible; request inspection without claiming a confirmed defect |
| FAILED without a verified reason | Eligible for generic review through Failed prints |
| FAILED with current-job cancellation code `0300_400C` | One Task canceled outcome through the failed-state occurrence; the code cannot independently request a second intervention notification |
| Ambiguous PAUSE | Eligible once both HMS and print-error snapshots have arrived, unless a verified reason explains/suppresses the pause; contributing fault categories govern explained actionable pauses |
| Unknown non-informational fault | Eligible for generic review with PAUSE/FAILED; an unknown fault during RUNNING does not independently notify |
| Explicit manual pause or automatic recovery | Does not independently notify; another genuine actionable fault or independent FAILED can still qualify |
| Maintenance/advisory, low-filament estimate, progress, temperature, ETA, ordinary job start/resume | Does not independently notify |
| Confirmed FINISH | Eligible only for a trustworthy protocol job observed active by this monitor, when completion is enabled; percentage, ETA and startup FINISH are insufficient |
| Cloud loss, printer offline, stale/missing telemetry | Visible locally; currently no automatic monitoring-loss notification |

Message descriptions and wire severity do not establish action metadata. Expanding the catalogue must not silently expand interruption eligibility. Incomplete reports remain unknown; missing data cannot establish resolution or a new occurrence.

Completion is an **informational exception** to attention-focused delivery. In the current desktop/browser configuration, `completed_prints` defaults true, while both delivery channels require separate opt-in. This existing default is not a mobile push default.

### Delivery and noise controls

Both channels consume shared normalized classification, category preferences and local review state. Native delivery requires an opted-in running TUI on a local Mac. Browser delivery requires an enabled executing page and browser permission, with either TUI or foreground serve hosting. Native enablement does not enable browser delivery. Native and browser attempts have separate ledgers, so enabling both can produce two notifications. Tabs/browsers share the browser channel's durable claims.

Related attention reports collect in a bounded per-printer/job window; optional native burst grouping can combine due events across printers. Underlying fault/state occurrences stay distinct. Completion bypasses attention collection. Reports outside the window may produce another request for a distinct actionable occurrence. Late cancellation after a failed-state attempt causes no second request and cannot rewrite an accepted banner. Confirmed recurrence and independent escalation remain eligible. See [classification and grouping](../user/alerts.md#notification-classification-and-grouping) for timing and cancellation details.

Fresh connected telemetry is required for current print-event delivery. Reviews, categories, snoozes and quiet hours can suppress requests; quiet suppression has no catch-up summary. Native pending events may become eligible after snooze expiry; browser muted events do not replay. Browser enable/reload/reconnect and long polling gaps establish a new-events-only baseline. Events expire, and browser suspension or closure can lose alerts. Exact intervals belong to the [browser delivery policy](../user/alerts.md#browser-system-notifications).

Each channel reserves identities durably before delivery and does not automatically retry failed or uncertain attempts. This favors avoiding duplicates and can lose a notification after a reservation/crash or lost response. Storage errors pause delivery rather than forgetting history. Native rate-limited work waits and is revalidated; browser delivery consumes excess events without returning them. These local limits provide neither a mobile cost budget nor a guarantee of presentation. See the [alert guide](../user/alerts.md) for limits and recovery instructions.

Explicit synthetic tests bypass automatic eligibility and do not enable monitoring. OS/browser acceptance, visible banners and audible delivery are separate outcomes. Current hardware and environment gaps remain in the [single live-check list](validation.md#remaining-live-checks).

## Direction for iOS and Android

Mobile notifications should default to **attention events only** after explicit user opt-in. Apply the evidence-based classifications above, with these product boundaries:

- Keep completion and other informational lifecycle updates out of default push. If offered, completion needs a separate explicit informational subscription. Do not use progress, ETA or routine telemetry changes as push triggers or a background refresh transport.
- A verified intervention may warrant attention before PAUSE arrives. An ambiguous pause or independent failure may warrant a generic review request; do not wait indefinitely for a recognized code. Unknown RUNNING faults stay visible without speculative push.
- Cancellation must not create a second fault alert. Preserve the single failed-state outcome when actor intent is unknown; if a mobile implementation can reliably correlate the user's own cancellation, define suppression of that redundant outcome explicitly. Never infer the actor from the code alone.
- Treat sustained monitoring loss as a separate proposed attention category: ask the operator to check monitoring, without claiming a printer stopped. It is not implemented in this repository; adoption depends on the policy and evidence in [#175](https://github.com/cliffom/bambustand/issues/175).

### Cost and delivery requirements for adoption

At the component that owns mobile notification decisions, classify, correlate related reports, check subscriptions/reviews/snoozes/quiet hours, and deduplicate **before enqueueing a push request**. Group related state/error/HMS reports within a documented bounded window without merging underlying occurrence identities or suppressing independent recurrence/escalation. Provider collapse identifiers alone are insufficient to prevent redundant decision or delivery work.

Define account/printer/job/occurrence identity, device fan-out, expiry, rate/budget limits, recovery and restart behavior before enabling automatic push. Repeated reports or reconnects must not create new billable requests for the same occurrence. Specify cross-device/channel behavior explicitly; current desktop/browser ledgers do not provide mobile or global deduplication. Select a mobile retry/idempotency policy deliberately, including uncertain outcomes, rather than assuming desktop no-retry semantics apply to a push provider. Do not trade away distinct actionable events merely to meet a volume cap; make skipped coverage observable.

Keep notification content minimal and suitable for lock screens; avoid credentials, raw telemetry and job/file names. Permission is separate from category subscription. Delivery failures must leave monitoring usable. A host or suspended app cannot reliably report its own death; do not promise stopped-host, closed-app or remote delivery without an independently running and validated observer/transport. This strategy chooses no mobile backend, provider, service installation or remote-access design.

Each mobile repository should link this document from its contributor/agent guidance, record the reviewed BambuStand revision, and document its adopted behavior and any deliberate differences. Use shared synthetic event timelines to verify decisions across implementations, including negative/no-notification cases; adapting transport and OS lifecycle must not broaden eligibility silently. Platform-specific permission/background delivery evidence belongs with that implementation.

## Implementation references and maintenance

| Decision | Owning code or evidence |
| --- | --- |
| Action eligibility and pause categories | [attention.go](../../internal/farm/attention.go), [classification fixtures](../../internal/farm/attention_test.go) |
| Normalized notification evidence and classes | [notification_snapshot.go](../../internal/farm/notification_snapshot.go), [classification tests](../../internal/farm/notification_classification_test.go) |
| Durable occurrence/completion decisions | [notification state](../../internal/notification_state/store.go) |
| Native policy and collection | [worker.go](../../internal/notifications/worker.go), [collection.go](../../internal/notifications/collection.go), [outcome tests](../../internal/notifications/outcomes_test.go) |
| Browser policy and claims | [session projection](../../internal/session/web.go), [browser worker](../../internal/webserver/notifications.go), [outcome tests](../../internal/webserver/notification_outcomes_test.go) |

Any change to eligibility, defaults, grouping, deduplication, suppression, retry, delivery lifecycle or monitoring-health policy must update this reference and affected user/architecture guidance in the same PR. State whether mobile direction changes and identify downstream adoption work when needed. Update the baseline revision/date when rechecking the current-state claims; do not mark proposals implemented because an issue exists. Mobile repositories should update their recorded reference revision when adopting a change, with tests for intentional differences.

The [roadmap](../ROADMAP.md) owns priorities and notification follow-up issues. The [validation record](validation.md#remaining-live-checks) owns outstanding hardware and delivery checks; issue completion does not establish real-world delivery success.
