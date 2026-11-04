package farm

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Drying freshness is independent of unrelated printer reports. Never count down
// locally: the reported minutes can include a paused or interrupted cycle.
const (
	dryingFreshness          = 2 * time.Minute
	conventionalAMSUnitCount = 4
	maxDryingTemperature     = 100
	maxDryingDuration        = 48
)

func amsUnitID(id int) bool {
	return id >= 0 && id < conventionalAMSUnitCount || id >= AMSHTFirstID && id <= AMSHTLastID
}

// Drying minutes are whole, nonnegative wire integers. Reject fractions rather
// than truncating an invalid value into a confirmed zero.
func dryingInteger(v any) *int {
	n, err := strconv.ParseUint(str(v), 10, 16)
	if err != nil {
		return nil
	}
	return ptr(int(n))
}

func (p *Printer) observeAMSDrying(delta map[string]any, now time.Time) {
	if p.amsDryingReports == nil {
		p.amsDryingReports = map[int]time.Time{}
	}
	for _, entry := range array(object(delta[fieldAMS])[fieldAMS]) {
		unit := object(entry)
		id := number(unit[fieldID])
		if id != nil && amsUnitID(*id) {
			if _, present := unit[fieldDryTime]; present {
				p.amsDryingReports[*id] = now
			}
		}
	}
	// An explicitly cleared inventory must not reuse observation timestamps.
	for id := range p.amsDryingReports {
		found := false
		for _, entry := range array(object(p.Raw[fieldAMS])[fieldAMS]) {
			if n := number(object(entry)[fieldID]); n != nil && *n == id {
				found = true
				break
			}
		}
		if !found {
			delete(p.amsDryingReports, id)
		}
	}
}

// Module prefixes establish hardware type, without retaining serial numbers or
// substituting AMS firmware for printer OTA firmware. Replies may be partial.
func (p *Printer) amsVersionReport(info map[string]any) {
	if p.amsModels == nil {
		p.amsModels = map[int]string{}
	}
	models := map[string]string{"ams": "AMS", "ams_f1": "AMS Lite", "n3f": "AMS 2 Pro", "n3s": "AMS HT"}
	for _, entry := range array(info[fieldModule]) {
		name := str(object(entry)[fieldName])
		prefix, suffix, ok := strings.Cut(name, "/")
		id, err := strconv.Atoi(suffix)
		if !ok || err != nil || !amsUnitID(id) || models[prefix] == "" {
			continue
		}
		p.amsModels[id] = models[prefix]
		for i := range p.AMS {
			if p.AMS[i].ID == id {
				p.AMS[i].Model = models[prefix]
			}
		}
	}
}

// DryingStatus is shared display interpretation, including explicit unsupported
// hardware. A missing model never turns missing telemetry into unsupported.
func (a AMS) DryingStatus(now time.Time, current bool) string {
	if a.Model == "AMS" || a.Model == "AMS Lite" {
		return "Unsupported (no active dryer)"
	}
	if a.DryingMinutes == nil {
		return "Unknown"
	}
	value := "Not drying · 0 min remaining"
	if *a.DryingMinutes > 0 {
		value = fmt.Sprintf("Drying · %d min remaining", *a.DryingMinutes)
	}
	if !a.DryingCurrent(now, current) {
		value = "Last-known · " + value
	}
	return value
}

// DryingCurrent exposes freshness independently of presentation text, so a
// browser can qualify a formerly current snapshot when its feed is lost.
func (a AMS) DryingCurrent(now time.Time, current bool) bool {
	return current && a.Model != "AMS" && a.Model != "AMS Lite" && a.DryingMinutes != nil &&
		!a.DryingReported.IsZero() && !now.Before(a.DryingReported) && now.Sub(a.DryingReported) <= dryingFreshness
}

// DryingSettings describes configuration, never evidence of an active cycle.
func (a AMS) DryingSettings() string {
	if a.Model == "AMS" || a.Model == "AMS Lite" || a.DryingTemperature == nil && a.DryingDuration == nil {
		return ""
	}
	var values []string
	if a.DryingTemperature != nil {
		values = append(values, fmt.Sprintf("%d°C target", *a.DryingTemperature))
	}
	if a.DryingDuration != nil {
		values = append(values, fmt.Sprintf("%d h duration", *a.DryingDuration))
	}
	return strings.Join(values, " · ")
}
