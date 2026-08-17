# Full SRS Compliance — Development Roadmap

**Target:** every requirement in SRS v7.0 implemented, tested and certified.
**Basis:** one developer, full-time, ~20 productive days per month.
**Companion:** the 15-day pilot plan is Phase 0 of this roadmap, not an alternative to it.

---

## 1. The headline number

**Solo, full SRS scope: 20–24 months.**

That is not padding. The estimate below totals ~89 person-weeks of build before contingency; at 30 % for the unknowns that always appear in embedded and multi-tenant work, it lands near 115 weeks, and certification adds external lead time that partly overlaps.

The same scope with **four to five people is 9–12 months**, because most workstreams are genuinely parallel — firmware, cloud, portal and app touch each other only at defined interfaces. §7 covers what hiring changes and where the first hire pays for itself.

The roadmap below is phased so you have a shippable, sellable product at roughly month 4 and again at month 8, rather than nothing until month 20.

---

## 2. Effort by workstream

| Workstream | Scope | Person-weeks |
|---|---|---|
| **MCU firmware** | GAP-31, under-voltage, `get_settings`, fault reset, enumerated acks, cooldown interlock, runtime intervals, flash debounce, module reset line, promote compile-time setpoints | 3 |
| **MCU bootloader + OTA** | Flash reclamation, module-staged protocol, signature/CRC verification, recovery path, extensive power-cut testing | 5 |
| **Bridge** | AWS mode, cJSON validation, NTP + `seq` enrichment, offline buffering, LWT, shadow support, IoT Jobs relay, FOTA, provisioning-by-claim client, diagnostics | 9 |
| **Cloud backend** | Ingestion + dedup, shadow reconciliation, tenancy + RBAC to 6 dealer levels, device lifecycle state machine, allocation + audit, config templates, alert engine with dedup and digests, notifications (push/email/SMS), subscription enforcement, retention + compaction, provisioning hook, firmware release management, OTA job orchestration, RMA/warranty, reports, versioned API with rate limits and idempotency, observability | 22 |
| **Web portal** | Superadmin (inventory, bulk import, allocation, fleet dashboard, firmware releases, audit, system health, support console); partner (stock, panel binding, templates, dashboards, RMA, user management, white-labelling); 7-tab device detail; alert configuration; i18n; exports | 15 |
| **Android app** | End-user screens, dealer commissioning with BLE and self-test, offline queue, distributor views, 6 languages, push with deep links, accessibility | 11 |
| **Test & QA** | Hardware-in-loop rig, protection test suite, RBAC authorisation suite, load and soak testing, security testing, field pilot support | 7 |
| **Compliance** | EMC/safety pre-testing and remediation, WPC/ETA submission, BIS assessment, DPDP implementation, penetration test remediation, SBOM and CVE process | 9 |
| **Documentation** | User manual, installation guide, service documentation, partner onboarding material, API docs | 3 |
| **Subtotal** | | **84** |
| **Integration & release engineering** | Reproducible builds, IaC across three environments, CI, release process | 5 |
| **Total before contingency** | | **89** |
| **With 30 % contingency** | | **~115 weeks ≈ 23 months** |

---

## 3. Phased roadmap

Each phase ends with something you could deploy or sell. Months are cumulative from project start.

### Phase 0 — Pilot · month 0–1

Per the 15-day plan. 5–10 devices, TLS, validated commands, basic web view.

**Exit:** devices in the field, safe, observable.

---

### Phase 1 — Production baseline · months 1–4

The smallest thing you could sell to a real customer without embarrassment.

| Work | Weeks |
|---|---|
| Offline buffering in the bridge (the pilot's most visible gap) | 2 |
| MCU batch release — under-voltage, `get_settings`, fault reset, enumerated acks, cooldown | 3 |
| Device Shadow adoption; retire the command topic | 2 |
| Backend: schema completion, device lifecycle state machine, audit log, alert engine | 5 |
| Portal: device detail, configuration with pending/applied state, fault history, trends | 4 |
| Android: point at the platform properly; commissioning flow | 3 |

**Exit:** a customer can buy a panel, have it commissioned, monitor it, control it, and be alerted — with truthful configuration state and no data loss during outages.

---

### Phase 2 — Channel & commercial · months 4–8

Turns a product into a business.

| Work | Weeks |
|---|---|
| Full tenancy: 6-level dealer recursion, allocation, transfer, chain of custody | 4 |
| Partner portal: stock, panel binding, configuration templates, sub-tree dashboards | 4 |
| RMA and warranty workflow | 2 |
| Subscription model: plans, tiers, expiry, suspension, renewal | 3 |
| Notifications: SMS and WhatsApp with **DLT registration** (external lead time — start in Phase 1) | 2 |
| White-labelling for panel manufacturers | 2 |

**Exit:** partners can be onboarded, devices flow down the channel, subscriptions are enforced.

---

### Phase 3 — OTA & scale · months 8–13

The phase that stops the fleet becoming a liability.

| Work | Weeks |
|---|---|
| Flash reclamation and MCU bootloader | 3 |
| Module-staged OTA protocol, verification, recovery, power-cut testing | 3 |
| Bridge FOTA and IoT Jobs handling | 2 |
| Fleet provisioning by claim: template, pre-provisioning hook, inventory validation, rotation | 3 |
| Firmware release management: staged rollout, canary, abort, version tracking | 2 |
| Retention automation: partition drops, daily compaction, exports | 2 |
| Load testing to design fleet size; mass-reconnection scenario | 2 |
| Observability: ingestion lag, error rates, delivery rates, system health view | 2 |

**Exit:** you can fix firmware without a site visit, and manufacture in batches. **Until this phase lands, every deployed unit is a future service visit.**

---

### Phase 4 — Compliance & GA · months 13–20

| Work | Weeks | Note |
|---|---|---|
| EMC and safety pre-testing, remediation | 4 | Needs a hardware freeze |
| WPC/ETA submission and approval | 2 own effort | **External lead time 2–4 months** |
| BIS applicability assessment | 1 | |
| DPDP: consent capture, data-subject rights, grievance process, breach procedure | 3 | |
| Penetration test and remediation | 3 | |
| SBOM, CVE monitoring, patch SLA | 1 | |
| Documentation set | 3 | |
| Field reliability soak, defect burn-down | 4 | |

**Exit:** legally sellable, security-tested, documented.

---

### Phase 5 — Buffer · months 20–23

Contingency. Not optional — it is where the 30 % lives. Plan it in or it will take itself.

---

## 4. Critical path

The longest dependent chain, which no amount of reordering shortens:

```
Cert provisioning → cloud ingestion → tenancy/RBAC → portal depth
                                                        ↓
                          bootloader → OTA → fleet provisioning → scale
                                                        ↓
                                    hardware freeze → EMC → WPC/ETA → GA
```

Two consequences worth internalising:

**Certification gates legal sale and needs a frozen hardware design.** WPC/ETA alone is 2–4 months of external lead time. If GA matters at month 20, hardware freezes around month 13. Any board change after that — a modem daughterboard, an RTC, a larger MCU — restarts the clock.

**The cloud and portal are 37 of the 89 weeks.** They are the schedule. Firmware feels harder and is more interesting, but it is not what determines the date.

---

## 5. External lead times — start these early

These run in parallel with development but have their own clocks, and each has bitten projects that started them late.

| Item | Lead time | Start by |
|---|---|---|
| **DLT registration** (mandatory for transactional SMS in India) | 2–6 weeks | Phase 1 |
| **WPC/ETA** radio approval | 2–4 months | Phase 3, after hardware freeze |
| **BIS** assessment | 1–3 months if applicable | Phase 3 |
| **SIM partner** M2MSP/KYC evidence (CMP-022) | Weeks | Phase 1 |
| **Penetration test** booking | 4–8 weeks lead | Phase 3 |
| **ISO 27001** if enterprise sales are planned | 6–12 months | Phase 2 |

---

## 6. What could compress this

| Lever | Saving | Cost |
|---|---|---|
| **Drop white-labelling** | 2 weeks | Panel manufacturers lose brand presence — may be a sales objection |
| **Defer subscriptions to post-GA** | 3 weeks | No revenue enforcement; retrofitting billing is unpleasant |
| **Cap the hierarchy at 3 dealer levels** | 2 weeks | Constrains the channel model you specified |
| **English + Hindi only at GA** | 1 week | The app already has 6 languages — this saves little |
| **Buy rather than build the alert/notification layer** | 2 weeks | Vendor dependency, ongoing cost |
| **Skip the HIL rig, test manually** | 3 weeks | **Not recommended.** Protection testing without it is how GAP-31 stayed hidden. |
| **Defer OTA past GA** | 8 weeks | **Strongly not recommended.** Every unit shipped without it is a permanent service liability. |

Realistic compression without damage: **2–3 months**. Getting to 12 months solo would require cutting things that make the product worth selling.

---

## 7. What hiring changes

| Team | Duration | Notes |
|---|---|---|
| Solo | 20–24 months | Baseline |
| +1 full-stack (cloud + portal) | 12–14 months | **The highest-leverage hire.** Takes 37 weeks off your critical path and lets you stay on firmware, where your knowledge is irreplaceable. |
| +2 (cloud/portal, mobile) | 10–12 months | App and portal proceed in parallel |
| 4–5 people | 9–12 months | Approaching the floor — coordination overhead grows and the critical path stops being about capacity |

Below roughly 9 months, the constraint is no longer people. It is certification lead time and the field-soak period needed to trust protection firmware.

**If you hire once, hire the cloud/portal developer.** It is the largest block, the most parallelisable, and the least dependent on the domain knowledge only you have.

---

## 8. Milestone summary

| Month | Milestone | Sellable? |
|---|---|---|
| 1 | Pilot live — 5–10 devices, secure | No — pilot only |
| 4 | Production baseline | Yes, to friendly customers |
| 8 | Channel and commercial model | Yes, through partners |
| 13 | OTA and batch manufacture | Yes, at volume |
| 20 | Certified and security-tested | Yes, legally, everywhere in India |
| 23 | Contingency absorbed | — |

---

## 9. Recommendation

Do not treat this as a 20-month project before anything ships. Treat it as **four releases**: pilot at month 1, sellable product at month 4, channel business at month 8, scalable and certified at month 13–20.

Three things I would hold firm on, whatever else moves:

**Do not defer OTA past volume manufacture.** The cost of not having it scales linearly with every unit shipped, and it is the one deferral that gets permanently worse rather than merely later.

**Do not skip the hardware-in-loop rig.** GAP-31 sat undetected in shipping protection firmware. Manual testing found it never; systematic testing would have found it immediately.

**Start certification and DLT before you feel ready.** They are the only items on this roadmap where working harder does not make them finish sooner.

And the single decision with the largest effect on the date is whether you stay solo. One cloud/portal developer roughly halves the timeline — that is a better return than any scope cut available here.
