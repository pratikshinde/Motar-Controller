/**
 * AgriPump SmartSpace - Device Simulator
 *
 * Sprint-0 item from Development_Plan_FINAL.md §3: "Two days of work that
 * removes a twelve-month dependency." Portal-first development (Stream 1)
 * has nothing real to develop against until Stream 3 (month 12-14), so this
 * stands in for real devices against the HTTP endpoints that actually exist
 * today.
 *
 * What it does, matching SRS §4.7 / §6.1-6.3 as closely as the current
 * backend supports:
 *   - Publishes telemetry via POST /api/telemetry (60s running / 300s idle
 *     cadence — SRS §5.1 FR-CON-006 — compressed for local testing via
 *     TICK_MS below; see the constant for how to restore real cadence).
 *   - Models the fault codes 0-10 from SRS §6.2 with weighted random
 *     injection so the fleet dashboard and fault-log UI have real content.
 *   - Polls GET /api/devices/:id/commands/pending and acks via
 *     POST /api/devices/:id/commands/:cid/ack, so the web UI's remote
 *     start/stop is exercised against something that actually responds
 *     (previously nothing did — see Web_App_Pending_Items.md).
 *   - Reports configuration via POST /api/devices/:id/config/report so the
 *     desired/reported loop (SRS §6.4) has a non-empty `reported` side.
 *
 * What it deliberately does NOT do: implement MQTT/TLS, AWS IoT, or any of
 * the layer-B protocol from SRS §6.3 — that's Stream 3 (the bridge) and out
 * of scope for a "make the portal have data to develop against" tool. If
 * that gap starts to matter (e.g. testing shadow reconciliation), extend
 * this rather than starting over — the fault/state model below is a
 * reasonable base for it.
 *
 * Usage:
 *   PUMP_ID=PUMP-4G-3P-8821 DEVICE_KEY=<key from setup-db.js output> \
 *     node backend/simulator/deviceSimulator.js
 *
 *   Or run several at once:
 *     node backend/simulator/deviceSimulator.js --fleet fleet.json
 *   where fleet.json is [{ "pumpId": "...", "deviceKey": "..." }, ...]
 */

const API_BASE = process.env.API_BASE || 'http://localhost:5000/api';
const TICK_MS = parseInt(process.env.TICK_MS || '5000', 10); // real cadence is 60000/300000ms; compressed for dev use
const COMMAND_POLL_MS = parseInt(process.env.COMMAND_POLL_MS || '3000', 10);
const FAULT_INJECT_PROBABILITY = parseFloat(process.env.FAULT_PROBABILITY || '0.03'); // per tick, while running

// SRS §6.2 — single source of truth is the numeric code; names here only
// for simulator-side logging.
const FAULT_CODES = [
  { code: 1, name: 'YPhase' },
  { code: 2, name: 'PhaseLoss' },
  { code: 3, name: 'OverVolt' },
  { code: 4, name: 'PhaseSeq' },
  { code: 5, name: 'DryRun' },
  { code: 6, name: 'CableAll' },
  { code: 7, name: 'CablePart' },
  { code: 8, name: 'OverLoad' },
  { code: 9, name: 'Imbalance' },
  { code: 10, name: 'UnderVolt' }
];

// SRS §4.7 — 8-state machine, simplified here to what's observable via the
// HTTP telemetry/command surface: pump_on + fault_active is what the
// backend actually models today (device_config/lifecycle_state are
// separate). A full state-machine port isn't useful until the bridge exists
// to speak it over MQTT.
function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

class SimulatedDevice {
  constructor(pumpId, deviceKey) {
    this.pumpId = pumpId;
    this.deviceKey = deviceKey;
    this.pumpOn = false;
    this.faultActive = false;
    this.faultCode = 0;
    this.seq = 0;
  }

  headers() {
    return { 'Content-Type': 'application/json', 'X-Device-Key': this.deviceKey };
  }

  log(msg) {
    console.log(`[${this.pumpId}] ${msg}`);
  }

  async tick() {
    await this.pollCommands();
    await this.publishTelemetry();
  }

  async pollCommands() {
    try {
      const res = await fetch(`${API_BASE}/devices/${encodeURIComponent(this.pumpId)}/commands/pending`, {
        headers: this.headers()
      });
      if (!res.ok) return;
      const data = await res.json();
      for (const cmd of data.commands || []) {
        await this.handleCommand(cmd);
      }
    } catch (err) {
      this.log(`⚠️ command poll failed: ${err.message}`);
    }
  }

  async handleCommand(cmd) {
    // FR-DEV-049: remote START honoured only when no fault is active.
    if (cmd.action === 'START' && this.faultActive) {
      await this.ackCommand(cmd.cid, false, 'FAULT_ACTIVE');
      this.log(`❌ rejected START — fault ${this.faultCode} still active`);
      return;
    }
    this.pumpOn = cmd.action === 'START';
    await this.ackCommand(cmd.cid, true);
    this.log(`✅ applied ${cmd.action} (cid ${cmd.cid.slice(0, 8)}…)`);
  }

  async ackCommand(cid, ok, reason) {
    try {
      await fetch(`${API_BASE}/devices/${encodeURIComponent(this.pumpId)}/commands/${cid}/ack`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ ok, reason })
      });
    } catch (err) {
      this.log(`⚠️ ack failed: ${err.message}`);
    }
  }

  maybeInjectFault() {
    if (this.faultActive || !this.pumpOn) return;
    if (Math.random() < FAULT_INJECT_PROBABILITY) {
      const f = FAULT_CODES[Math.floor(Math.random() * FAULT_CODES.length)];
      this.faultActive = true;
      this.faultCode = f.code;
      this.faultName = f.name;
      this.pumpOn = false; // trip
      this.log(`⚡ FAULT injected: code ${f.code} (${f.name}) — output de-energised`);
    } else if (!this.faultActive && Math.random() < 0.02) {
      // occasional auto-recovery, mirrors dry-run auto-reset etc.
      this.faultActive = false;
    }
  }

  async publishTelemetry() {
    this.maybeInjectFault();
    this.seq += 1;

    const vBase = 415;
    const isFaultVoltageDip = this.faultActive && [2, 3, 9, 10].includes(this.faultCode);
    const payload = {
      pump_id: this.pumpId,
      v_ry: isFaultVoltageDip ? randomBetween(0, 250) : randomBetween(vBase - 8, vBase + 8),
      v_yb: isFaultVoltageDip && this.faultCode === 2 ? 0 : randomBetween(vBase - 8, vBase + 8),
      v_br: randomBetween(vBase - 8, vBase + 8),
      i_r: this.pumpOn ? randomBetween(10, 15) : 0,
      i_y: this.pumpOn ? randomBetween(10, 15) : 0,
      i_b: this.pumpOn ? randomBetween(10, 15) : 0,
      gsm_rssi: Math.round(randomBetween(-95, -60)), // realistic rural LTE Cat-1 range, not a fabricated constant
      pump_on: this.pumpOn,
      fault_active: this.faultActive,
      seq: this.seq,
      ts_approx: false
    };
    if (this.faultActive) {
      payload.fault_code = this.faultCode;
      payload.fault_description = `Simulated ${this.faultName} fault (code ${this.faultCode})`;
    }

    try {
      const res = await fetch(`${API_BASE}/telemetry`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        this.log(`⚠️ telemetry rejected (${res.status}): ${err.error || 'unknown error'}`);
        return;
      }
      this.log(
        `📡 seq=${this.seq} pump_on=${this.pumpOn} fault=${this.faultActive ? this.faultCode : 'none'} ` +
        `v_ry=${payload.v_ry.toFixed(0)}V`
      );
    } catch (err) {
      this.log(`⚠️ telemetry publish failed (is the backend running on ${API_BASE}?): ${err.message}`);
    }
  }

  async reportConfig(desired) {
    try {
      await fetch(`${API_BASE}/devices/${encodeURIComponent(this.pumpId)}/config/report`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ reported: desired || {} })
      });
    } catch (err) {
      this.log(`⚠️ config report failed: ${err.message}`);
    }
  }

  start() {
    this.log(`starting simulator — telemetry every ${TICK_MS}ms, command poll every ${COMMAND_POLL_MS}ms`);
    this._telemetryTimer = setInterval(() => this.tick(), TICK_MS);
    this._commandTimer = setInterval(() => this.pollCommands(), COMMAND_POLL_MS);
    this.tick();
  }

  stop() {
    clearInterval(this._telemetryTimer);
    clearInterval(this._commandTimer);
  }
}

function loadFleetFromArgs() {
  const fleetFlagIndex = process.argv.indexOf('--fleet');
  if (fleetFlagIndex !== -1 && process.argv[fleetFlagIndex + 1]) {
    const fs = require('fs');
    const raw = fs.readFileSync(process.argv[fleetFlagIndex + 1], 'utf8');
    return JSON.parse(raw).map(d => ({ pumpId: d.pumpId, deviceKey: d.deviceKey }));
  }
  if (!process.env.PUMP_ID || !process.env.DEVICE_KEY) {
    console.error(
      'Usage: PUMP_ID=<id> DEVICE_KEY=<key> node deviceSimulator.js\n' +
      '   or: node deviceSimulator.js --fleet fleet.json\n\n' +
      'Get a device key from `node setup-db.js` output (seeded pumps) or from\n' +
      'the response of POST /api/pumps (returned once at creation time).'
    );
    process.exit(1);
  }
  return [{ pumpId: process.env.PUMP_ID, deviceKey: process.env.DEVICE_KEY }];
}

function main() {
  const fleet = loadFleetFromArgs();
  const devices = fleet.map(d => new SimulatedDevice(d.pumpId, d.deviceKey));
  devices.forEach(d => d.start());

  process.on('SIGINT', () => {
    console.log('\nStopping simulator…');
    devices.forEach(d => d.stop());
    process.exit(0);
  });
}

if (require.main === module) {
  main();
}

module.exports = { SimulatedDevice };
