# SRS Addendum A1: Solar VFD Controller Integration (Fuji FRENIC-Ace)

**Document Version:** 1.0.0  
**Target Brand:** Swati Pump Controller  
**Author / Engineering Context:** IoT Agri Pump Platform Engineering  
**Parent Specification:** IoT Agri Pump Control & Monitoring System Architecture  

---

## 1. Executive Summary & Purpose

This addendum defines the functional, communication, and register-level interface between the AgriPump Pump Control Device (PCD) and the **Fuji Electric FRENIC-Ace** series Variable Frequency Drive (VFD) used in Swati solar-powered agricultural pumping installations.

The integration enables cloud and mobile telemetry monitoring alongside remote START and STOP operations for solar agricultural pumps while guaranteeing complete isolation from legacy three-phase (`AC_3PH`) grid infrastructure.

---

## 2. Scope Boundaries

To ensure operational safety, field reliability, and agricultural usability:

### In Scope
1. **Telemetry Telemetry Ingestion:**
   - Inverter Output Frequency ($Hz$)
   - Motor Power ($kW$)
   - Solar Array DC Bus Voltage ($V\text{ DC}$)
   - Inverter Output AC Voltage ($V\text{ AC}$)
   - Motor Output Current ($A$)
   - Drive Running Status (`RUNNING`, `STOPPED`, `TRIPPED`)
   - VFD Specific Alarm / Fault Codes (Codes 100–106)
2. **Remote Power Commands:**
   - Command `START` (Run command issued to drive)
   - Command `STOP` (Halt command issued to drive)
3. **Web Portal & Mobile Applications:**
   - Dedicated Solar VFD telemetry widgets and trend charts
   - Brand scoping ensuring Swati dealers/farmers access Solar VFD capabilities while Ajanta and AC grid installations remain strictly untouched

### Strictly Out of Scope
- **No Speed / Frequency Setpoint Adjustment:** The mobile app and web portal do NOT provide frequency sliders, RPM targets, or speed tuning.
- **No MPPT Tuning or Internal Drive Tuning:** Maximum Power Point Tracking (MPPT), V/f patterns, carrier frequencies, deceleration ramps, and motor pole tuning are exclusively handled autonomously by the Fuji FRENIC-Ace drive firmware and the local solar array dynamics.
- **No Parameter Writing Beyond Operation Command `S06`:** The PCD will not modify drive configuration parameters in the field.

---

## 3. Physical Wiring & Communication Interface

The PCD communicates with the Fuji FRENIC-Ace drive via its onboard serial communication terminal:

| Interface Parameter | Specification | Notes |
|---|---|---|
| **Physical Layer** | RS-485 (2-wire differential) | Multi-drop capable, shielded twisted pair recommended |
| **Port on Inverter** | **Port 2 (DX+, DX-, SD)** | Dedicated RS-485 communications port on terminal block |
| **Protocol** | Modbus RTU | Master = PCD, Slave = Fuji Inverter (Default Slave ID = 1) |
| **Baud Rate** | 9600 bps or 19200 bps | Configured in inverter function code `y04` |
| **Data Framing** | 8 Data Bits, 1 Stop Bit, No Parity (or Even) | Configured in function code `y05` |
| **Required Inverter Parameter** | **`H30 = 6`** | Assigns run and frequency command source to RS-485 communications Port 2 |

---

## 4. Modbus Register Address Mapping

All registers listed correspond to standard Fuji Electric Modbus RTU protocol function codes (`03h` Read Holding Registers, `06h` / `10h` Write Registers).

### 4.1 Command Registers (PCD $\rightarrow$ Drive)

| Register | Name | Type | Value | Functional Description |
|---|---|---|---|---|
| **`S06`** | Operation Command | Word (16-bit) | `0001h` | **START**: Forward rotation run command (Bit 0 = 1). |
| **`S06`** | Operation Command | Word (16-bit) | `0000h` | **STOP**: Stop command (Bit 0 = 0, ramp to stop). |

*Note:* Inverter command execution requires function code `H30 = 6` (Link command via Port 2) to be configured on the drive.

---

### 4.2 Monitor Registers (Drive $\rightarrow$ PCD Telemetry Loop)

The PCD periodically polls the following registers (recommended interval: 2000 ms to 5000 ms during operation):

| Fuji Reg | Parameter Name | Modbus Reg | Unit / Scaling | Platform Telemetry Field |
|---|---|---|---|---|
| **`M09`** | Output Frequency | Holding Reg | $0.01\text{ Hz}$ (or $0.1\text{ Hz}$) | `vfd_hz` |
| **`M10` / `M64`** | Input / Motor Power | Holding Reg | $0.01\text{ kW}$ | `vfd_kw` |
| **`M11`** | Output Current | Holding Reg | $0.01\text{ A}$ | `vfd_i_out` |
| **`M12`** | Output AC Voltage | Holding Reg | $0.1\text{ V AC}$ | `vfd_v_ac` |
| **`M21`** | DC Bus Voltage | Holding Reg | $1\text{ V DC}$ | `vfd_v_dc` |
| **`M14`** | Running Status | Holding Reg | Bitmask | `vfd_status` |
| **`M16`** | Latest Alarm Code | Holding Reg | Fuji Alarm Index | `vfd_fault_code` |

---

## 5. Platform Fault Code Mapping

The cloud platform and mobile apps translate internal Modbus alarm codes to unified platform fault codes seeded in the database:

| Platform Fault Code | Canonical Name | Display Text (English) | Fuji Cause / Condition |
|---|---|---|---|
| **100** | `VfdDcOverVolt` | Solar DC Bus Overvoltage | Solar array open circuit voltage exceeds inverter DC limit (`OU`). |
| **101** | `VfdDcUnderVolt` | Solar DC Bus Undervoltage / Low Sun | Insufficient solar irradiance, DC link voltage dropped below operating threshold (`LU`). |
| **102** | `VfdMotorOverload` | VFD Motor Overload | Motor current exceeded thermal threshold for sustained period (`OL1`). |
| **103** | `VfdInverterOverheat` | VFD Inverter Overheat | Heat sink temperature exceeded safe operating limit (`OH1`). |
| **104** | `VfdOutputPhaseLoss` | VFD Output Phase Loss | Output phase cable disconnected or motor winding open (`OPL`). |
| **105** | `VfdModbusTimeout` | Modbus Communication Timeout | RS-485 link between PCD and Fuji VFD disconnected or timed out (`Er8`). |
| **106** | `VfdDryRun` | Solar Dry Run (Low Power) | Output power or current dropped below dry run cavitation threshold during full sun. |

---

## 6. Open Items & Hardware Clarifications

The following engineering decisions are flagged for confirmation with the hardware and solar field engineering team:

1. **Register Units for Fuji `M10`, `M11`, and `M64`:**
   - *Status:* Open.
   - *Detail:* Need confirmation from Fuji drive firmware build documentation whether `M10`/`M64` returns raw engineering units ($0.01\text{ kW}$) or percentage of drive rated kW ($0.01\%$). Similarly, verify whether `M11` is raw amperes or percentage of rated current for custom motor windings.
2. **Selection of Output Power Register (`M10` vs `M64`):**
   - *Status:* Open.
   - *Detail:* `M10` measures electrical input power from the DC link, whereas `M64` calculates mechanical output power delivered to the pump shaft. For farmer reporting (pump water output correlation), `M64` is preferred; if `M64` is not populated on specific FRENIC-Ace firmware revisions, `M10` is used as fallback.
3. **Modbus Link Failure Behavior (`y02` and `y03`):**
   - *Status:* Proposed.
   - *Detail:* If communication between PCD and drive is lost while the pump is running, inverter behavior is governed by function codes `y02` (Timer) and `y03` (Operation on comm error).
   - *Recommendation:* Set `y02 = 15.0 s` and `y03 = 0` (Decelerate to stop on error). This prevents runaway unattended pumping if the controller loses connection or power while the solar panels are energised.
4. **PCD RS-485 Hardware Transceiver Verification:**
   - *Status:* Open.
   - *Detail:* Clarification needed on whether existing production PCD hardware boards deployed for Swati already mount an isolated RS-485 transceiver (e.g., MAX485 or SN65HVD72) on Port 2 pins, or if a minor hardware rev / piggyback transceiver module is required for initial solar pilot units.

---

## 7. Approval & Sign-Off

| Role | Name | Status | Date |
|---|---|---|---|
| Lead IoT Platform Engineer | Antigravity AI / Engineering Pair | **Complete** | Oct 2026 |
| Firmware & Hardware Engineering | Hardware Team | Pending Review | — |
| Swati Product Management | Product Operations | Pending Review | — |
