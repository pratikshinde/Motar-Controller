import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import {
  Zap,
  Activity,
  RotateCw,
  Clock,
  Power,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Droplets,
  Gauge,
  Scale,
  Wifi,
  ChevronRight,
  ArrowRight,
  ArrowLeft,
  LogOut,
} from 'lucide-react-native';
import { apiClient } from '../config/api';
import { wsService } from '../services/websocket';
import { TelemetryData, PumpState } from '../types';

interface PumpDashboardScreenProps {
  deviceId: string;
  onNavigateToDevices: () => void;
  onNavigateToAlerts: () => void;
  onLogout?: () => void;
}

// Circular Gauge Sub-component
const PumpGaugeRing: React.FC<{
  phase: string;
  voltage: number;
  color: string;
}> = ({ phase, voltage, color }) => {
  const isDead = voltage < 20;
  const radius = 38;
  const strokeWidth = 5;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.min(Math.max(voltage / 500, 0), 1);
  const strokeDashoffset = isDead ? circumference : circumference * (1 - ratio);

  return (
    <View style={styles.voltCircleWrap}>
      <View style={styles.voltCircle}>
        <Svg width="92" height="92" viewBox="0 0 92 92">
          <Circle
            cx="46"
            cy="46"
            r={radius}
            stroke={isDead ? '#2a2f3a' : '#1c2a45'}
            strokeWidth={strokeWidth}
            fill="none"
          />
          <Circle
            cx="46"
            cy="46"
            r={radius}
            stroke={isDead ? '#2a2f3a' : color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="none"
            transform="rotate(-90 46 46)"
          />
        </Svg>
        <View style={styles.voltCenter}>
          <Text style={[styles.voltPhaseLabel, { color: isDead ? '#555b68' : color }]}>{phase}</Text>
          <Text style={[styles.voltValue, { color: isDead ? '#555b68' : color }]}>
            {isDead ? '0.0' : voltage.toFixed(1)}
          </Text>
          <Text style={styles.voltUnit}>Volts</Text>
        </View>
      </View>
      <View style={[styles.voltPresence, isDead ? styles.presenceAbsent : styles.presencePresent]}>
        <Text style={[styles.presenceText, isDead ? styles.presenceTextAbsent : styles.presenceTextPresent]}>
          {isDead ? 'Phase Loss' : 'Present'}
        </Text>
      </View>
    </View>
  );
};

// GSM Signal Bars Sub-component
const GsmSignalSticks: React.FC<{ dbm: number }> = ({ dbm }) => {
  const bars = Math.max(0, Math.min(5, Math.floor((dbm + 110) / 12)));
  return (
    <View style={styles.gsmContainer}>
      <View style={styles.gsmBarsRow}>
        {[5, 9, 13, 17, 21].map((height, i) => (
          <View
            key={i}
            style={[
              styles.gsmStick,
              { height },
              i < bars ? styles.gsmStickActive : styles.gsmStickInactive,
            ]}
          />
        ))}
      </View>
      <Text style={styles.gsmLabel}>GSM</Text>
    </View>
  );
};

export const PumpDashboardScreen: React.FC<PumpDashboardScreenProps> = ({
  deviceId = 'PUMP-4G-3P-8821',
  onNavigateToDevices,
  onNavigateToAlerts,
  onLogout,
}) => {
  // Live Telemetry State
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    device_id: deviceId,
    timestamp: new Date().toISOString(),
    pump_state: 'RUNNING',
    fault_code: 0,
    v_ry: 435.0,
    v_yb: 428.0,
    v_br: 422.0,
    i_r: 11.3,
    i_y: 10.8,
    i_b: 10.2,
    pf: 0.88,
    freq: 50.0,
    signal_dbm: -75,
    run_hours: 142.5,
    motor_hp: 15.0,
  });

  const [pumpOn, setPumpOn] = useState(true);
  const [phaseSequence, setPhaseSequence] = useState<'forward' | 'reverse'>('forward');
  const [totalSeconds, setTotalSeconds] = useState(84732);
  const [cycleSeconds, setCycleSeconds] = useState(3724);

  // Active Faults dictionary
  const [faults, setFaults] = useState<{ [key: string]: boolean }>({
    cableOpen: false,
    dryRun: false,
    overload: false,
    imbalance: false,
  });

  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [commandLoading, setCommandLoading] = useState(false);

  // Confirmation Modal
  const [modalVisible, setModalVisible] = useState(false);
  const [pendingTargetState, setPendingTargetState] = useState<boolean | null>(null);

  // Time formatting
  const [currentTimeStr, setCurrentTimeStr] = useState('');
  const [currentDateStr, setCurrentDateStr] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const n = new Date();
      setCurrentTimeStr(n.toLocaleTimeString('en-US', { hour12: false }));
      setCurrentDateStr(
        n.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      );
    };
    updateTime();
    const clockInterval = setInterval(updateTime, 1000);
    return () => clearInterval(clockInterval);
  }, []);

  useEffect(() => {
    // Run timer counter
    const timer = setInterval(() => {
      if (pumpOn) {
        setTotalSeconds((prev) => prev + 1);
        setCycleSeconds((prev) => prev + 1);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [pumpOn]);

  useEffect(() => {
    // Cooldown timer
    if (cooldownSeconds <= 0) return;
    const interval = setInterval(() => {
      setCooldownSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldownSeconds]);

  useEffect(() => {
    // Fetch live backend telemetry
    fetchLatestTelemetry();

    // Connect WebSocket
    wsService.connect();
    const unsubTelem = wsService.onTelemetry((data) => {
      if (!data.device_id || data.device_id === deviceId) {
        setTelemetry((prev) => ({ ...prev, ...data }));
        if (data.pump_state) {
          setPumpOn(data.pump_state === 'RUNNING' || data.pump_state === 'STARTING');
        }
      }
    });

    return () => {
      unsubTelem();
    };
  }, [deviceId]);

  const fetchLatestTelemetry = async () => {
    try {
      const res = await apiClient.get(`/pumps/${deviceId}`);
      if (res.data) {
        const d = res.data;
        setTelemetry((prev) => ({
          ...prev,
          v_ry: d.v_ry ?? 435.0,
          v_yb: d.v_yb ?? 428.0,
          v_br: d.v_br ?? 422.0,
          i_r: d.i_r ?? 11.3,
          i_y: d.i_y ?? 10.8,
          i_b: d.i_b ?? 10.2,
        }));
      }
    } catch {
      // Fallback stays active for presentation demo
    }
  };

  const handlePowerClick = () => {
    setPendingTargetState(!pumpOn);
    setModalVisible(true);
  };

  const confirmTogglePump = async () => {
    if (pendingTargetState === null) return;
    const targetState = pendingTargetState;
    setModalVisible(false);

    if (cooldownSeconds > 0) {
      Alert.alert('Command Cooldown', `Please wait ${cooldownSeconds}s before issuing another command.`);
      return;
    }

    setCommandLoading(true);
    try {
      const action = targetState ? 'START' : 'STOP';
      await apiClient.post(`/pumps/${deviceId}/command`, { command: action, action });
      setCooldownSeconds(5);
    } catch {
      // Demo state toggle
    } finally {
      setCommandLoading(false);
      setPumpOn(targetState);
      if (targetState) {
        setCycleSeconds(0);
      }
    }
  };

  const handleLogoutPress = () => {
    if (!onLogout) return;
    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to log out of your account?')) {
        onLogout();
      }
    } else {
      Alert.alert(
        'Logout Confirmation',
        'Are you sure you want to log out of your account?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Logout', onPress: () => onLogout() },
        ],
        { cancelable: true }
      );
    }
  };

  const formatHoursMinSec = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(3, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const FAULT_META: { [key: string]: { name: string; icon: any } } = {
    cableOpen: { name: 'Cable Open', icon: PlugCircleXmarkIcon },
    dryRun: { name: 'Dry Run / Underload', icon: Droplets },
    overload: { name: 'Overload / High Current', icon: Gauge },
    imbalance: { name: 'Phase Load Imbalance', icon: Scale },
  };

  const activeFaultKeys = Object.keys(faults).filter((k) => faults[k]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* HEADER WITH 2-LINE TITLE & RIGHT-ALIGNED POWER BUTTON */}
        <View style={styles.headerCard}>
          <View style={styles.headerScanLine} />

          {/* Top Section: Title (2 Lines) on Left + Power ON/OFF Button on Right */}
          <View style={styles.headerTopRow}>
            <View style={styles.headerLeft}>
              <View style={[styles.pumpIconBox, pumpOn ? styles.pumpIconBoxOn : styles.pumpIconBoxOff]}>
                <Activity size={30} color={pumpOn ? '#00e676' : '#ff1744'} />
              </View>
              <View style={styles.titleTextGroup}>
                <Text style={styles.headerTitleLine1}>AJANTA PUMP</Text>
                <Text style={styles.headerTitleLine2}>CONTROLLER</Text>
                <Text style={styles.headerSubText}>3-Phase 440V • {deviceId}</Text>
              </View>
            </View>

            {/* POWER ON/OFF BUTTON (Larger header button) */}
            <View style={styles.headerPowerRightBox}>
              <TouchableOpacity
                style={[styles.headerPowerBtn, pumpOn ? styles.headerPowerBtnOn : styles.headerPowerBtnOff]}
                onPress={handlePowerClick}
                disabled={commandLoading}
                activeOpacity={0.8}
              >
                {commandLoading ? (
                  <ActivityIndicator size="small" color={pumpOn ? '#00e676' : '#ff1744'} />
                ) : (
                  <Power size={30} color={pumpOn ? '#00e676' : '#ff1744'} />
                )}
              </TouchableOpacity>
              <Text style={[styles.headerPowerLabel, pumpOn ? { color: '#00e676' } : { color: '#ff1744' }]}>
                {pumpOn ? 'PUMP ON' : 'PUMP OFF'}
              </Text>
              {cooldownSeconds > 0 && (
                <Text style={styles.cooldownNotice}>Cooldown: {cooldownSeconds}s</Text>
              )}
            </View>
          </View>

          {/* Bottom Bar: Status Badge + GSM Signal + Time/Date */}
          <View style={styles.headerBottomRow}>
            <View style={[styles.statusBadge, pumpOn ? styles.statusRunning : styles.statusStopped]}>
              <View style={[styles.statusDot, pumpOn ? styles.dotRunning : styles.dotStopped]} />
              <Text style={[styles.statusText, pumpOn ? styles.textRunning : styles.textStopped]}>
                {pumpOn ? 'RUNNING' : 'STOPPED'}
              </Text>
            </View>

            <View style={styles.headerMetaRow}>
              <GsmSignalSticks dbm={telemetry.signal_dbm || -75} />
              <View style={styles.datetimeBox}>
                <Text style={styles.timeText}>{currentTimeStr || '11:35:20'}</Text>
                <Text style={styles.dateText}>{currentDateStr || 'Sat Sep 5, 2026'}</Text>
              </View>
              {onLogout && (
                <TouchableOpacity
                  style={styles.logoutBtn}
                  onPress={handleLogoutPress}
                  activeOpacity={0.7}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <LogOut size={14} color="#ff1744" />
                  <Text style={styles.logoutBtnText}>LOGOUT</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* MAIN DASHBOARD GRID */}
        <View style={styles.mainGrid}>
          {/* CARD 1: LINE VOLTAGES (440V) */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Zap size={16} color="#00e5ff" />
              <Text style={styles.cardTitle}>Line Voltages (440V)</Text>
            </View>
            <View style={styles.voltageCirclesRow}>
              <PumpGaugeRing phase="RY" voltage={pumpOn ? telemetry.v_ry || 435.0 : 0} color="#ff3d3d" />
              <PumpGaugeRing phase="YB" voltage={pumpOn ? telemetry.v_yb || 428.0 : 0} color="#ffc107" />
              <PumpGaugeRing phase="BR" voltage={pumpOn ? telemetry.v_br || 422.0 : 0} color="#2196f3" />
            </View>
          </View>

          {/* CARD 2: PHASE CURRENTS & PHASE SEQUENCE */}
          <View style={styles.card}>
            <View style={styles.cardHeaderBetween}>
              <View style={styles.cardHeaderLeftGroup}>
                <Activity size={16} color="#00e5ff" />
                <Text style={styles.cardTitle}>Phase Currents</Text>
              </View>

              {/* BIG BOLD VISIBLE CIRCLE BADGE (NO OUTLINE) */}
              <View style={[styles.headerSeqGroup, !pumpOn && { opacity: 0.5 }]}>
                <View
                  style={[
                    styles.bigSeqDot,
                    phaseSequence === 'forward' ? styles.seqDotForward : styles.seqDotReverse,
                  ]}
                />
                <Text
                  style={[
                    styles.bigSeqText,
                    phaseSequence === 'forward' ? { color: '#00e676' } : { color: '#ff1744' },
                  ]}
                >
                  {phaseSequence === 'forward' ? 'FORWARD' : 'BACKWARD'}
                </Text>
              </View>
            </View>

            {pumpOn ? (
              <View style={styles.currentsContainer}>
                {/* R Phase */}
                <View style={styles.phaseRow}>
                  <View style={[styles.phaseLabelBox, styles.phaseLabelR]}>
                    <Text style={[styles.phaseLabelText, { color: '#ff3d3d' }]}>R</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        styles.barFillR,
                        { width: `${Math.min(100, ((telemetry.i_r || 11.3) / 20) * 100)}%` },
                      ]}
                    >
                      <Text style={styles.barValText}>{(telemetry.i_r || 11.3).toFixed(1)} A</Text>
                    </View>
                  </View>
                </View>

                {/* Y Phase */}
                <View style={styles.phaseRow}>
                  <View style={[styles.phaseLabelBox, styles.phaseLabelY]}>
                    <Text style={[styles.phaseLabelText, { color: '#ffc107' }]}>Y</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        styles.barFillY,
                        { width: `${Math.min(100, ((telemetry.i_y || 10.8) / 20) * 100)}%` },
                      ]}
                    >
                      <Text style={styles.barValText}>{(telemetry.i_y || 10.8).toFixed(1)} A</Text>
                    </View>
                  </View>
                </View>

                {/* B Phase */}
                <View style={styles.phaseRow}>
                  <View style={[styles.phaseLabelBox, styles.phaseLabelB]}>
                    <Text style={[styles.phaseLabelText, { color: '#2196f3' }]}>B</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        styles.barFillB,
                        { width: `${Math.min(100, ((telemetry.i_b || 10.2) / 20) * 100)}%` },
                      ]}
                    >
                      <Text style={styles.barValText}>{(telemetry.i_b || 10.2).toFixed(1)} A</Text>
                    </View>
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.stoppedMessageContainer}>
                <XCircle size={32} color="#555b68" />
                <Text style={styles.stoppedMessageText}>Pump at rest — No current draw</Text>
              </View>
            )}
          </View>

          {/* CARD 5: RUN TIME */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Clock size={16} color="#00e5ff" />
              <Text style={styles.cardTitle}>Run Time</Text>
            </View>
            <View style={styles.runtimeContainer}>
              <View style={[styles.runtimeBlock, styles.runtimeTotalBlock]}>
                <Text style={styles.runtimeLabel}>Total Run Time</Text>
                <Text style={[styles.runtimeValue, { color: '#00e5ff' }]}>{formatHoursMinSec(totalSeconds)}</Text>
                <Text style={styles.runtimeUnit}>Hours : Minutes : Seconds</Text>
              </View>
              <View style={[styles.runtimeBlock, styles.runtimeCycleBlock]}>
                <Text style={styles.runtimeLabel}>Last Cycle Run Time</Text>
                <Text style={[styles.runtimeValue, { color: '#ffab00' }]}>{formatHoursMinSec(cycleSeconds)}</Text>
                <Text style={styles.runtimeUnit}>Hours : Minutes : Seconds</Text>
              </View>
            </View>
          </View>

          {/* CARD 6: PUMP FAULTS */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <AlertTriangle size={16} color="#00e5ff" />
              <Text style={styles.cardTitle}>Pump Faults</Text>
            </View>
            <View style={styles.faultsContainer}>
              {activeFaultKeys.length === 0 ? (
                <View style={styles.noFaultsBox}>
                  <ShieldCheck size={32} color="#00e676" />
                  <Text style={styles.noFaultsText}>ALL CLEAR — NO FAULTS</Text>
                </View>
              ) : (
                activeFaultKeys.map((key) => {
                  const meta = FAULT_META[key] || { name: key, icon: AlertTriangle };
                  const IconComp = meta.icon;
                  return (
                    <View key={key} style={styles.faultItem}>
                      <IconComp size={18} color="#ff1744" />
                      <Text style={styles.faultNameText}>{meta.name}</Text>
                      <View style={styles.faultBadge}>
                        <Text style={styles.faultBadgeText}>FAULT</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </View>
        </View>
      </ScrollView>

      {/* CONFIRMATION MODAL */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitleText}>
              {pendingTargetState ? 'Start Pump' : 'Stop Pump'}
            </Text>
            <Text style={styles.modalBodyText}>
              {pendingTargetState
                ? 'Are you sure you want to start the pump? Verify 3-phase line power safety.'
                : 'Are you sure you want to stop the pump? This will halt water delivery immediately.'}
            </Text>
            <View style={styles.modalBtnsRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalConfirmBtn,
                  pendingTargetState ? styles.confirmStartBtn : styles.confirmStopBtn,
                ]}
                onPress={confirmTogglePump}
              >
                <Text style={styles.modalConfirmBtnText}>{pendingTargetState ? 'Start' : 'Stop'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

// Fallback icon component for cable open
const PlugCircleXmarkIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <XCircle size={size} color={color} />
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060b14',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 6 : 4,
  },
  scrollContent: {
    padding: 14,
    paddingBottom: 32,
  },
  headerCard: {
    backgroundColor: '#111a2e',
    borderWidth: 1,
    borderColor: '#1c2a45',
    borderRadius: 14,
    padding: 18,
    marginBottom: 18,
    overflow: 'hidden',
  },
  headerScanLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: '#00e676',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1c2a45',
  },
  headerBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    flexShrink: 1,
    paddingRight: 8,
  },
  titleTextGroup: {
    flex: 1,
    flexShrink: 1,
  },
  headerTitleLine1: {
    color: '#e8edf5',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1.5,
    lineHeight: 22,
  },
  headerTitleLine2: {
    color: '#00e5ff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1.2,
    lineHeight: 19,
  },
  headerSubText: {
    color: '#4a5a78',
    fontSize: 10.5,
    letterSpacing: 0.5,
    marginTop: 3,
  },
  headerPowerRightBox: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerPowerBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerPowerBtnOn: {
    borderColor: '#00e676',
    backgroundColor: '#00e67620',
  },
  headerPowerBtnOff: {
    borderColor: '#ff1744',
    backgroundColor: '#ff174420',
  },
  headerPowerLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 4,
  },
  pumpIconBox: {
    width: 52,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pumpIconBoxOn: {
    borderColor: '#00e676',
    backgroundColor: '#00e67615',
  },
  pumpIconBoxOff: {
    borderColor: '#ff1744',
    backgroundColor: '#ff174415',
  },
  headerTitleText: {
    color: '#e8edf5',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2,
  },
  headerSubText: {
    color: '#4a5a78',
    fontSize: 11,
    letterSpacing: 1,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusRunning: {
    backgroundColor: '#00e67620',
    borderColor: '#00e676',
  },
  statusStopped: {
    backgroundColor: '#ff174420',
    borderColor: '#ff1744',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotRunning: {
    backgroundColor: '#00e676',
  },
  dotStopped: {
    backgroundColor: '#ff1744',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  textRunning: {
    color: '#00e676',
  },
  textStopped: {
    color: '#ff1744',
  },
  headerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  gsmContainer: {
    alignItems: 'center',
  },
  gsmBarsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 22,
    backgroundColor: '#0c1220',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1c2a45',
  },
  gsmStick: {
    width: 4,
    borderRadius: 2,
  },
  gsmStickActive: {
    backgroundColor: '#00e676',
  },
  gsmStickInactive: {
    backgroundColor: '#4a5a78',
  },
  gsmLabel: {
    color: '#4a5a78',
    fontSize: 8,
    fontWeight: '700',
    marginTop: 2,
  },
  datetimeBox: {
    alignItems: 'flex-end',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#ff174420',
    borderWidth: 1,
    borderColor: '#ff174480',
    marginLeft: 4,
  },
  logoutBtnText: {
    color: '#ff1744',
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  timeText: {
    color: '#00e5ff',
    fontSize: 15,
    fontWeight: '700',
  },
  dateText: {
    color: '#4a5a78',
    fontSize: 10,
    marginTop: 1,
  },
  mainGrid: {
    gap: 16,
  },
  card: {
    backgroundColor: '#111a2e',
    borderWidth: 1,
    borderColor: '#1c2a45',
    borderRadius: 12,
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 10,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c2a45',
  },
  cardHeaderBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c2a45',
  },
  cardHeaderLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerSeqGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bigSeqDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  seqDotForward: {
    backgroundColor: '#00e676',
  },
  seqDotReverse: {
    backgroundColor: '#ff1744',
  },
  bigSeqText: {
    fontSize: 12.5,
    fontWeight: '900',
    letterSpacing: 1,
  },
  cardTitle: {
    color: '#7a8baa',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  voltageCirclesRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  voltCircleWrap: {
    alignItems: 'center',
    gap: 6,
  },
  voltCircle: {
    position: 'relative',
    width: 92,
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voltCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  voltPhaseLabel: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  voltValue: {
    fontSize: 15,
    fontWeight: '800',
    marginVertical: 1,
  },
  voltUnit: {
    fontSize: 8,
    color: '#4a5a78',
  },
  voltPresence: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  presencePresent: {
    backgroundColor: '#00e67620',
  },
  presenceAbsent: {
    backgroundColor: '#2a2f3a50',
  },
  presenceText: {
    fontSize: 9,
    fontWeight: '800',
  },
  presenceTextPresent: {
    color: '#00e676',
  },
  presenceTextAbsent: {
    color: '#555b68',
  },
  currentsContainer: {
    gap: 12,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  phaseLabelBox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseLabelR: {
    backgroundColor: '#ff3d3d20',
    borderColor: '#ff3d3d40',
  },
  phaseLabelY: {
    backgroundColor: '#ffc10720',
    borderColor: '#ffc10740',
  },
  phaseLabelB: {
    backgroundColor: '#2196f320',
    borderColor: '#2196f340',
  },
  phaseLabelText: {
    fontSize: 12,
    fontWeight: '900',
  },
  barTrack: {
    flex: 1,
    height: 28,
    backgroundColor: '#060b14',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1c2a45',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 8,
  },
  barFillR: {
    backgroundColor: '#ff3d3d',
  },
  barFillY: {
    backgroundColor: '#ffc107',
  },
  barFillB: {
    backgroundColor: '#2196f3',
  },
  barValText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  stoppedMessageContainer: {
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  stoppedMessageText: {
    color: '#555b68',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sequenceContent: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  sequenceArrowsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  seqPhaseChar: {
    fontSize: 22,
    fontWeight: '900',
  },
  seqBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  seqBadgeForward: {
    backgroundColor: '#00e67620',
    borderColor: '#00e676',
  },
  seqBadgeReverse: {
    backgroundColor: '#ff174420',
    borderColor: '#ff1744',
  },
  seqBadgeText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  runtimeContainer: {
    gap: 10,
  },
  runtimeBlock: {
    backgroundColor: '#060b14',
    borderWidth: 1,
    borderColor: '#1c2a45',
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 4,
  },
  runtimeTotalBlock: {
    borderLeftColor: '#00e5ff',
  },
  runtimeCycleBlock: {
    borderLeftColor: '#ffab00',
  },
  runtimeLabel: {
    color: '#4a5a78',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  runtimeValue: {
    fontSize: 22,
    fontWeight: '900',
  },
  runtimeUnit: {
    color: '#7a8baa',
    fontSize: 9,
    marginTop: 2,
  },
  controlSection: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  powerBtn: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  powerBtnOn: {
    borderColor: '#00e676',
    backgroundColor: '#00e67615',
  },
  powerBtnOff: {
    borderColor: '#ff1744',
    backgroundColor: '#ff174415',
  },
  powerLabel: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
  },
  powerLabelOn: {
    color: '#00e676',
  },
  powerLabelOff: {
    color: '#ff1744',
  },
  cooldownNotice: {
    color: '#ffab00',
    fontSize: 11,
    fontWeight: '700',
  },
  faultsContainer: {
    gap: 8,
    minHeight: 60,
  },
  noFaultsBox: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  noFaultsText: {
    color: '#00e676',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  faultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#ff174420',
    borderWidth: 1,
    borderColor: '#ff1744',
  },
  faultNameText: {
    flex: 1,
    color: '#ff1744',
    fontSize: 12,
    fontWeight: '700',
  },
  faultBadge: {
    backgroundColor: '#ff1744',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  faultBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalBox: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#111a2e',
    borderWidth: 1,
    borderColor: '#1c2a45',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  modalTitleText: {
    color: '#e8edf5',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 8,
  },
  modalBodyText: {
    color: '#7a8baa',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
  modalBtnsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1c2a45',
    backgroundColor: '#060b14',
    alignItems: 'center',
  },
  modalCancelBtnText: {
    color: '#7a8baa',
    fontSize: 13,
    fontWeight: '700',
  },
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmStartBtn: {
    backgroundColor: '#00e676',
  },
  confirmStopBtn: {
    backgroundColor: '#ff1744',
  },
  modalConfirmBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
});
