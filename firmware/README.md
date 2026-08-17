# 🛡️ Swathi Switchgear: Advanced Motor Protection & Control Unit

[![Build Version](https://img.shields.io/badge/Build-v1.0.367-blue.svg)](file:///e:/Projects/Swathi_Switchgear/Display_Unit_Code/M031BSP-master/SampleCode/Template%20-%20Copy/config.h#L4)
[![Platform](https://img.shields.io/badge/Platform-Nuvoton%20M031-orange.svg)](https://www.nuvoton.com/products/microcontrollers/arm-cortex-m0-mcus/m031-series/)

A professional-grade **3-Phase Motor Protection and Control System** designed for industrial and agricultural applications. Built on the high-performance **Nuvoton M031BSP (Cortex-M0)** architecture, this unit provides comprehensive monitoring, fault detection, automated control, and **IoT cloud connectivity** for motors ranging from **3HP to 50HP**.

---

## 🚀 Key Features

### 💎 Intelligent Protection
- **Phase Monitoring**: Real-time detection of Phase Loss, Phase Sequence Error, and Voltage Imbalance.
- **Current Protection**: Precise Overload detection and Dry-Run (Underload) protection with configurable thresholds.
- **Cable Security**: Sophisticated detection for partial or full cable open-circuit faults.
- **Voltage Safeguards**: High and Low voltage trip points to protect motor windings.

### 🌐 IoT & Remote Monitoring (New)
- **Cloud Telemetry**: Periodic reporting of 3-Phase voltages, currents, motor state, and run-time via MQTT.
- **Remote Control**: Start or stop the motor securely from the mobile application.
- **Fault Notifications**: Immediate high-priority JSON alerts pushed to the server on any protection trip.
- **Remote Configuration**: Sync and update all system settings (HP, thresholds, timers) over-the-air.

### ⚙️ Automation & Control
- **Auto-Start Logic**: Configurable Power-On Delay (POD) and automated startup sequences.
- **Cyclic Timer**: Enables periodic motor operation with independent ON/OFF timing.
- **Dry-Run Recovery**: Automatic reset logic with a cooldown period to prevent motor burnout.
- **Star-Delta Timing**: Built-in support for transition delays in heavy-duty starters.

---

## 🧠 Technical Highlights

### ⚡ Precision Measurement Engine
- **True RMS Sampling**: Continuous 128-sample window for accurate Voltage and Current calculation.
- **Dynamic Offset Tracking**: Real-time DC-offset compensation by analyzing peak-to-peak midpoints.
- **Advanced Filtering**: 16-point Moving Average with a "Fast Response" bypass for rapid voltage fluctuations.
- **Vector Mathematics**: Intelligent Line-Voltage calculation using 120° vector sum logic.

### 📡 IoT Communication Stack
- **Module Interface**: Dedicated UART2 (PC0/PC1) link to a **SIMCOM A7672X** 4G LTE module.
- **JSON Protocol**: Lightweight, non-blocking JSON parser/serializer for minimal RAM overhead.
- **Telemetry Scheduling**: Adaptive reporting (1-minute interval when running, 5-minute interval when idle).
- **Security**: Device authentication using MCU Unique 96-bit ID + Module IMEI.

---

## 🛠 Hardware Specifications

| Component | Specification |
| :--- | :--- |
| **Microcontroller** | Nuvoton M031LD2AE (ARM Cortex-M0, 64KB Flash, 8KB SRAM) |
| **IoT Module** | SIMCOM A7672X (4G LTE CAT-1 / GNSS / OpenCPU) |
| **Communication** | UART2 @ 115200 (RX: PC.0, TX: PC.1) |
| **Display** | 16x2 LCD (4-bit Interface) |
| **Input Buttons** | 5-Button Matrix (ADC-sampled) |
| **Relay Outputs** | Dual Relays (Motor Control & Aux) |
| **Measurement** | Isolated 3-Phase Voltage & Current Sensing |

---

## 🌐 IoT Communication Protocol

All communication with the A7672X module uses newline-delimited JSON.

### 📤 Outgoing Messages (MCU → Cloud)
| Type | Example Payload |
| :--- | :--- |
| **Registration** | `{"cmd":"reg","dev_id":"001A...","fw":"1.0.364"}` |
| **Status** | `{"cmd":"status","vl":[415,412,410],"i":[12,11,12],"mot":1,"st":2,"flt":0,"rt":1234}` |
| **Fault Alert** | `{"cmd":"fault","code":5,"desc":"DryRun","vl":[415,0,410],"i":[2,0,2]}` |

### 📥 Incoming Messages (Cloud → MCU)
| Type | Action |
| :--- | :--- |
| **Motor Control** | `{"cmd":"motor_cmd","action":"on"}` (Starts motor if no faults present) |
| **Settings Sync** | `{"cmd":"settings","hp":7,"ov":480,"ol":22,"dr":5}` (Updates and saves to Flash) |

---

## 📊 System State Machine

```mermaid
stateDiagram-v2
    [*] --> STATE_POWER_ON_DELAY : Boot
    
    STATE_POWER_ON_DELAY --> STATE_IDLE : POD Complete
    
    state STATE_IDLE {
        [*] --> WAITING
        WAITING --> STATE_AUTOSTART : AutoStart Active
        WAITING --> STATE_RUNNING_FAULT_CHECK : Manual Start / IoT Remote ON
        WAITING --> STATE_FAULT : Voltage/Phase Fault
    }
    
    STATE_AUTOSTART --> STATE_RUNNING_FAULT_CHECK : Delay Expired
    STATE_AUTOSTART --> STATE_FAULT : Fault Detected
    
    state STATE_RUNNING_FAULT_CHECK {
        [*] --> MOTOR_ON
        MOTOR_ON --> STATE_FAULT : Protection Trip (Overload/DryRun/Imbalance)
        MOTOR_ON --> STATE_STOP : Manual Stop / Cycle Complete / IoT Remote OFF
    }
    
    STATE_STOP --> STATE_RESET : Cyclic Re-run
    STATE_STOP --> STATE_IDLE : Stop Confirmed
    
    STATE_RESET --> STATE_RUNNING_FAULT_CHECK : Restart Delay Done
    
    state STATE_FAULT {
        [*] --> DISPLAY_FAULT
        DISPLAY_FAULT --> STATE_DRY_RUN_RESET : Dry Run Recovery
        DISPLAY_FAULT --> STATE_IDLE : Fault Cleared & Reset
    }
    
    STATE_DRY_RUN_RESET --> STATE_IDLE : Cooldown Finished
```

---

## 📂 Project Architecture

| Module | Files | Description |
| :--- | :--- | :--- |
| **Core** | `main.c`, `config.h` | System entry point, global pin mappings, and build configuration. |
| **IoT** | `IoT_Comm.c`, `.h` | UART2 driver, JSON parser, and telemetry scheduling logic. |
| **Protection** | `MotorProtection.c`, `.h` | State machine logic, fault detection algorithms, and timers. |
| **Measurement** | `Measurement.c`, `.h` | RMS calculations, phase angle detection, and ADC processing. |
| **Interface** | `UI_Menu.c`, `LCD.c` | Menu navigation, display formatting, and user interaction. |
| **Storage** | `SettingsEEPROM.c` | Non-volatile memory management using Nuvoton Data Flash. |
| **Hardware** | `Timer3_Int.c`, `Calibration.c` | Shared UART ISR (0/2), timebase, and calibration routines. |

---

## 📝 Recent Changes (v1.0.367)
- ✅ **Flash Cycle Timer Reset**: Added automated flash persistence updates (`TotalRunTime[1] = 0`) at all cycle reset points to prevent immediate restart trips on system reboot.
- ✅ **UI Settings Numbering**: Dynamic adjustment of LCD display numbering (`SD_OFFSET`) to maintain a contiguous sequence (1, 2, 3, ...) when `ENABLE_LOW_LOAD_SETTINGS` skips the Star/Delta delay screen.

## 📝 Previous Changes (v1.0.365)
- ✅ **Cyclic Timer & RunTime Tracking**: Resolved boundary checks and ensured correct motor shutdown when the 2-minute cycle timer expires.
- ✅ **Stack Overflow Fix**: Increased stack size in MCU assembly startup to 2048 bytes (0x800) and statically allocated the IoT processing buffer to resolve memory corruption.
- ✅ **Button ADC Thresholds**: Adjusted Up/Down button ADC windows to improve triggering reliability.
- ✅ **IoT Connectivity**: Integrated SIMCOM A7672X support for remote monitoring and control.
- ✅ **JSON Protocol**: Implemented non-blocking serial JSON stack for cloud sync.
- ✅ **Remote Control**: Enabled secure Motor ON/OFF via mobile app commands.
- ✅ **Fault Push**: Automated immediate server notifications for all protection trip events.
- ✅ **Phase Loss Logic**: Improved detection reliability at lower voltage thresholds (90V fix).
- ✅ **State Persistence**: Optimized EEPROM write cycles for motor runtime tracking.
- ✅ **UI Stability**: Fixed jitter in LCD character rendering during heavy ADC sampling.

---
*Developed for Swathi Switchgear*
