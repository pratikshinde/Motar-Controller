# AWS IoT Basic Ingest (cheaper readings)

Without it, every reading goes through the AWS message broker (about $1 per million messages) and then the rule. With Basic Ingest the starter
publishes to the rule directly, so the broker step and its charge are gone (the rule's own charge stays). The server, the dashboards, the app and the
commands to the pump do not change: the rule still puts the same message, with the sender's identity, on the queue `agripump-ingest`.

| | Usual | Basic Ingest |
|---|---|---|
| Readings topic | `devices/<id>/telemetry` | `$aws/rules/<rule>/devices/<id>/telemetry` |
| Faults topic | `devices/<id>/faults` | `$aws/rules/<rule>/devices/<id>/faults` |
| Commands (to the pump) | `devices/<id>/commands` | unchanged |

What you lose: the AWS console's MQTT test client cannot show these readings (they never reach the broker). The dashboard shows them as usual.

## Switching on, on one test starter first

1. **Device policy.** IoT Core > Security > Policies > `agripump-device-policy` > create a new version from `policies/device-policy-basic-ingest.json`
   (ready to paste: the rule is `agripump_ingest`, the account part of each ARN is `*`), set as active. The old topics stay allowed, so starters not yet reflashed keep working.
2. **Rule.** Keep the rule as it is (`iot-rule.sql`). It reads `devices/+/+` and keeps `telemetry` and `faults`. Check on the test starter that readings still reach
   the queue; if the rule does not see the part after the `$aws/rules/<rule>/` prefix, change its `WHERE` to match what `topic()` returns and keep the old filter too
   until every starter is reflashed.
3. **Firmware.** In `swathi_mqtt/inc/app_config.h` remove the comment marks around `#define BASIC_INGEST_RULE "<rule name>"`, build and flash.
4. **Check.** The module log shows it connected; the dashboard shows readings arriving; the queue `agripump-ingest` receives them. Then roll out to the others.
