# IoT Smart Pump Controller - React Native Mobile App

Cross-platform React Native mobile application for agricultural and domestic pump monitoring and remote control.

## Stack
- **Framework**: React Native (Expo SDK 51)
- **Language**: TypeScript
- **State & Storage**: React Hooks + `@react-native-async-storage/async-storage`
- **Networking**: Axios + Native WebSockets
- **Backend API**: Python FastAPI (`backend/app/main.py`)

## Features
- **Phone OTP & MFA Auth**: Instant OTP dispatch and verification.
- **Sticky Pump Control Bar**: START and STOP controls with server-enforced **45-second command cooldown** protection.
- **Live 3-Phase Electrical Telemetry**: Real-time voltage ($V_{RY}, V_{YB}, V_{BR}$), phase current ($I_R, I_Y, I_B$), power factor, frequency, and motor run hours over WebSockets.
- **Protection Fault Inbox**: Live alerting for Dry Run, Overload, Phase Loss, Phase Reversal, Voltage Imbalance, and Cable Open faults.
- **Fleet Device Switcher**: Multi-pump device navigation.

## Quick Start
```bash
cd mobile
npm install
npm start
```
- Press `a` to run on Android Emulator / Device.
- Press `i` to run on iOS Simulator.
- Press `w` to run in Web browser preview.
