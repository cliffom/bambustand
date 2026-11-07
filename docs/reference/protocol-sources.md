# Protocol and message references

This application implements a community-documented cloud monitoring protocol. It is not affiliated with Bambu Lab.

- Account API and MQTT topics: [OpenBambuAPI](https://github.com/Doridian/OpenBambuAPI).
- HMS severity encoding: [Bambu Studio DevHMS.h](https://github.com/bambulab/BambuStudio/blob/master/src/slic3r/GUI/DeviceCore/DevHMS.h) and [DevHMS.cpp](https://github.com/bambulab/BambuStudio/blob/master/src/slic3r/GUI/DeviceCore/DevHMS.cpp). The upper word of the code encodes fatal (1), serious (2), common (3), or informational (4). The TUI groups fatal/serious as errors, common as warnings, and informational as info. Unrecognized levels remain visible as warnings.
- Message meanings: seven pinned Bambu Studio English catalogues, reviewed 2026-11-07; see the [source inventory and update procedure](#message-catalogue-update-process). Bundled descriptions are independently phrased summaries. Model-dependent details are explicitly qualified.
- `0500_0200_0003_000A` is the existing intentional internal exception: suppress it only without an explicit telemetry message. Other empty-source entries remain visible with their code and a no-published-description explanation. Genuinely unknown codes retain severity and an “Unrecognized HMS notice” or “Printer error” label.
- Dual-nozzle temperatures, filament paths, and AMS HT IDs: [Home Assistant Bambu integration](https://github.com/greghesp/ha-bambulab/tree/main/custom_components/bambu_lab/pybambu). Protocol IDs 128–135 are shown as AMS HT 1–8; wire identities are not changed.
- Native credential CLI: [Apple SecurityTool.c](https://github.com/apple-oss-distributions/Security/blob/main/SecurityTool/sharedTool/SecurityTool.c). The interactive parser has a 4096-byte buffer; oversized writes are rejected, and EOF preserves the add command's failure status. No credential appears in process arguments.

Unknown messages are not guessed, and no telemetry fault-clear operation is implemented. Descriptions can differ across printer models and firmware; use the displayed code to check Bambu's troubleshooting information.

## Firmware reporting

Installed printer firmware comes from the `ota` module's `sw_ver` in an `info.get_version` reply, as documented in [OpenBambuAPI](https://github.com/Doridian/OpenBambuAPI/blob/main/mqtt.md#infoget_version). The MQTT refresh sends this fixed read-only query alongside the status snapshot request. Controller and AMS module versions are not substituted for the printer OTA version, and info-only replies do not refresh print-status timestamps or conceal stale telemetry.

Update assessment follows the `Upgrade` and `Info` parsing documented in the [Home Assistant Bambu integration](https://github.com/greghesp/ha-bambulab/blob/main/custom_components/bambu_lab/pybambu/models.py): `print.upgrade_state.new_version_state` reports `1` for available upgrades and `2` for no upgrades; targets can be in an `ota` entry of `new_ver_list` (`cur_ver`/`new_ver`) or the older `ota_new_version_number` field. An upgrade flag can concern an attached component. Without a printer OTA target, an available-upgrade flag does not establish a printer update. Explicit OTA current-version metadata can supply the installed version when a version reply is unavailable.

The TUI displays the printer's reported assessment, not a global latest-version lookup. Missing/unrecognized metadata and in-progress upgrade states remain unknown; an installed-version change invalidates the old assessment. Explicit no-upgrade metadata, or a reported OTA target matching the installed version, can establish reported current status. Partial reports retain known fields without refreshing assessment age merely because unrelated telemetry arrived. Assessments older than two minutes, old installed-version reports, or unavailable/stale connections are qualified as last-known. `r` requests fresh metadata. Firmware installation and upgrade-control operations are not implemented. Demo firmware values are synthetic.

## AMS drying

The [Home Assistant parser](https://github.com/greghesp/ha-bambulab/blob/main/custom_components/bambu_lab/pybambu/models.py) and [sensor definitions](https://github.com/greghesp/ha-bambulab/blob/main/custom_components/bambu_lab/definitions.py), inspected 2026-11-03, read per-unit `print.ams.ams[].dry_time` as remaining minutes and derive drying from a value greater than zero. An explicit zero establishes reported not-drying; missing/invalid data stays unknown. This is a cycle indication, not direct heater-current measurement. BambuStand requires whole nonnegative values within the 16-bit range; it does not count them down locally. Each unit's observation age advances only on a report containing `dry_time`. Values older than two minutes, or unavailable printer/cloud telemetry, are last-known.

Version-report module prefixes identify hardware: `ams/<id>` is original AMS, `ams_f1/<id>` is AMS Lite, `n3f/<id>` is AMS 2 Pro, and `n3s/<id>` is AMS HT. IDs remain unchanged; serials are not needed for display identification. Confirmed original AMS/AMS Lite units show unsupported active drying. Without metadata or drying data, capability remains unknown. Version replies do not refresh printer status or drying observation age.

The integration gates drying on A1 firmware 01.06.10.33+, P1 01.07.50.18+, and X1 01.08.50.18+; X1E support is unknown there. Other supported printer families default to enabled in that integration. BambuStand consumes explicit telemetry rather than assuming these gates guarantee cloud reporting. Live cloud drying behavior on specific hardware/firmware remains unverified.

`dry_setting.dry_temperature` is a target in °C and `dry_duration` is configured hours. The integration currently gates these settings on P2 firmware 01.01.50.40+ and H2C 01.01.50.00+. BambuStand displays valid reported targets (1–100°C) and duration (1–48 hours) separately as last reported settings. Other values stay unavailable; settings never establish an active cycle. The optional `dry_filament` setting is not displayed because cross-firmware value meanings have not been verified. Tray `tray_temp`/`tray_time` metadata is not the unit's live drying state. Temperature and humidity remain independent readings. No drying control commands are implemented.

## Reviewed fault catalogue

Run `make audit-faults` to reproduce the upstream verification. This explicit network check fetches the seven English catalogues at the pinned commit below, checks every bundled HMS and print-error code for exact membership and every upstream code for local coverage, and verifies curated HMS slot labels against upstream slot numbers. It fails on missing/extra codes, slot mismatches, or fetch/decode errors. The **Formatting and lint** workflow runs the audit on pull requests and pushes to `main`. Ordinary `make test` runs offline and skips this network audit. The audit checks code membership and slot addressing; description meanings still require review against the source text.

The message inventory is verified against Bambu Studio commit [`79df7ae309be398ed30c9f397c13c9911c2edc57`](https://github.com/bambulab/BambuStudio/tree/79df7ae309be398ed30c9f397c13c9911c2edc57/resources/hms). Both `device_hms` (16-digit codes) and `device_error` (8-digit print errors) were inspected in its English [093](https://github.com/bambulab/BambuStudio/blob/79df7ae309be398ed30c9f397c13c9911c2edc57/resources/hms/hms_en_093.json), [094](https://github.com/bambulab/BambuStudio/blob/79df7ae309be398ed30c9f397c13c9911c2edc57/resources/hms/hms_en_094.json), [20P](https://github.com/bambulab/BambuStudio/blob/79df7ae309be398ed30c9f397c13c9911c2edc57/resources/hms/hms_en_20P.json), [22E](https://github.com/bambulab/BambuStudio/blob/79df7ae309be398ed30c9f397c13c9911c2edc57/resources/hms/hms_en_22E.json), [239](https://github.com/bambulab/BambuStudio/blob/79df7ae309be398ed30c9f397c13c9911c2edc57/resources/hms/hms_en_239.json), [26A](https://github.com/bambulab/BambuStudio/blob/79df7ae309be398ed30c9f397c13c9911c2edc57/resources/hms/hms_en_26A.json), and [31B](https://github.com/bambulab/BambuStudio/blob/79df7ae309be398ed30c9f397c13c9911c2edc57/resources/hms/hms_en_31B.json) catalogues. All **5,289 HMS and 1,082 print-error codes** in the source union are accounted for in the embedded inventory. The dispositions cover 5,566 summarized codes, 711 codes with model-dependent wording, 93 entries with no published description, and the one intentional internal suppression. Existing curated filament/printer descriptions override the broader inventory where they provide a more useful generalized summary. A 2026-11-07 comparison found the same code/description sets in the current master files. Runtime use is offline; descriptions are short, independently phrased summaries rather than copies of the manufacturer text.

The earlier curated filament subset remains in place:

| Code family | Curated coverage |
| --- | --- |
| HMS `07uu` and `18uu`, unit `uu=00..07` | Standard AMS and AMS HT. Components `1000..1300`: feeder overload; `2000..2300`: runout, empty slot, breakage, failed recovery, failed extrusion, feed/retract timeouts, stalled feeder, failed rewind, automatic purge and backup-spool switch; `6000..6300`: possible tangle/buffer jam; `7000..7300`: toolhead feed/retract failures. |
| HMS component `7000`, subcodes `0002_0003`, `0002_0006`, `0002_0007` | Operation-level extrusion failure, purge timeout, and runout. These do **not** expand to components `7100..7300`; those combinations were absent upstream. |
| HMS `07FE`, `07FF`, `18FE`, `18FF`, component `2000` | External-spool runout (`0002_0001`) versus no filament detected (`0002_0002`). Side-specific wording varies by model, so summaries retain the external-spool distinction without guessing an extruder side. |
| HMS `0300_0900`, `0300_1A00`, selected `07FF_2000` | Extruder overload/resistance/extrusion faults, a verified nozzle-clog code, and auxiliary-extruder unload/feed failures. |
| Print errors `07uu` and `18uu`, unit `uu=00..07` | Suffixes `8003`, `8004`, `8005`, `8006`, `8007`, `8010`, `8011`, `8013`: extraction/retraction/feed/extrusion failures, overload, runout, purge timeout. |
| Print errors `07FE`, `07FF`, `18FE`, `18FF` | Suffixes `8004`, `8006`, `8011`, `8013`: external retraction, loading, runout, purge timeout. |
| Print errors `03004006`, `03008016`, `0300801C`, `0300801E` | Nozzle clog, abnormal extrusion resistance, and extruder overload. |

The curated finite combinations are expanded in `internal/farm/filament_faults.go`; the full inventory supplies other exact verified addresses. Similar-looking addresses absent from both keep the unknown-code fallback. Catalogue slot addressing describes reported codes, not the number of physical spool positions on an AMS HT. Firmware may emit multiple codes for one incident. Synthetic H2D/X2D fixtures exercise decoding, not a claim of live hardware validation for every catalogue entry.

Printer-supplied HMS messages take precedence. Severity still comes from the wire code, so a reported automatic purge or backup-spool switch retains its warning severity rather than being rewritten as an error or inferred success. A reported 0% estimate does not prove runout, and an empty slot does not create a synthetic runout fault. The full code and HMS troubleshooting URL remain available.

A paused-state notice remains separate from HMS and print-error notices, even when all concern the same incident. Pause is an independently reported state; matching it to a fault by timing or wording could hide a distinct condition. Each notice therefore keeps its own acknowledgement/dismissal and resolution lifetime. Dismissing runout does not acknowledge a new feed failure, another AMS unit/slot, or the paused state.

The inventory includes `12`-family, sensor/electrical/drying/track-switch and other model-specific codes. Remaining limits are model-dependent details, empty manufacturer descriptions and future firmware additions. Unknown codes remain visible for troubleshooting; catalogue expansion does not add printer control or fault-clear commands.

## Message catalogue update process

1. Select an immutable Bambu Studio commit and review the seven `resources/hms/hms_en_<model>.json` files above, for both `device_hms` and `device_error`. Do not use fuzzy prefix expansion to assign meanings.
2. Compare the exact code union with [the embedded inventory](../../internal/farm/fault_catalogue.json). Author short summaries of the factual condition; retain uncertainty and only evidenced unit/slot labels. Generalize conflicting model details and mark `model-dependent`; mark blank descriptions `empty-source`. Never suppress an additional code without an explicit reviewed policy change. The existing internal exception still allows supplied-message precedence.
3. Update the inventory's commit/models and the matching audit pin/count assertions in [catalogue audit tests](../../internal/farm/catalogue_audit_test.go), plus this reference. Group identical authored summaries using explicit code arrays. Model-dependent inventory summaries carry a visible qualifier; curated generalizations may already avoid model assumptions.
4. Run `make audit-faults` to compare exact coverage in both directions. Run `make test` for offline schema/count, precedence, severity, unknown/empty, occurrence and display regressions. The audit establishes membership and selected addressing, not semantic accuracy: review authored summaries against source text separately.
5. Review action classification separately from description coverage. The pre-expansion classifier registry is intentionally preserved; changes to notification eligibility/grouping belong to [#172](https://github.com/cliffom/bambustand/issues/172). Update user guidance/captures for visible interpretation changes.

### Verified print-outcome examples

| Code | Concise interpretation |
| --- | --- |
| `0C00_0100_0002_0017` | Nozzle camera lens needs cleaning; AI monitoring may be affected |
| `0C00_0300_0003_0008` | Possible spaghetti detected; inspect print quality |
| `0300_8003` | AI monitoring detected possible spaghetti; inspect print quality |
| `0300_400C` | Task canceled |

A paused/stopped summary combines current reported state with a described non-informational fault, preferring a print error then actionable/recovery HMS in deterministic code order. Maintenance/advisory notices do not explain a pause. An unclassified HMS notice is labeled as a reported notice rather than a confirmed cause. It does not prove causality or reconstruct earlier reports. Verified cancellation requires FAILED and the exact cancellation code observed since the latest job identity/start boundary; a retained error from a prior job remains an independent notice but cannot explain the new outcome. It does not identify an actor. FINISH establishes the displayed completion outcome. Raw state/codes and independent notices remain available; unavailable telemetry is last-known.

## Notification job identity

Bambu Studio's [DeviceManager.cpp](https://github.com/bambulab/BambuStudio/blob/master/src/slic3r/GUI/DeviceManager.cpp), inspected 2026-10-25, reads `task_id` and `subtask_id` from reports and excludes zero/empty subtask identifiers from cloud slice lookup. This establishes field use, not uniqueness for every physical run or model/firmware combination. The notification foundation combines reported identities with normalized state and conservatively suppresses ambiguous completion. It does not use job names or elapsed time as identifiers. Live identity/reprint behavior on H2D/X2D remains unverified.
