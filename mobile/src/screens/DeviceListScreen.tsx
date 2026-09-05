import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiClient } from '../config/api';
import { Device } from '../types';

interface DeviceListScreenProps {
  onSelectDevice: (deviceId: string) => void;
  onBackToDashboard: () => void;
  onOpenCommissioning?: () => void;
}

export const DeviceListScreen: React.FC<DeviceListScreenProps> = ({
  onSelectDevice,
  onBackToDashboard,
  onOpenCommissioning,
}) => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDevices();
  }, []);

  const fetchDevices = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/pumps');
      if (Array.isArray(res.data)) {
        setDevices(res.data);
      } else if (res.data.pumps) {
        setDevices(res.data.pumps);
      }
    } catch (e) {
      // Fallback mockup list if offline / mock
      setDevices([
        {
          id: '1',
          name: 'North Field Borewell #1',
          device_id: 'PUMP-4G-3P-8821',
          status: 'ONLINE',
          pump_state: 'RUNNING',
          fault_code: 0,
          motor_hp: 15.0,
          phase_type: '3P',
          location: 'Sector A - Plot 4',
        },
        {
          id: '2',
          name: 'South Canal Drip Pump #2',
          device_id: 'PUMP-4G-3P-9912',
          status: 'ONLINE',
          pump_state: 'OFF',
          fault_code: 0,
          motor_hp: 7.5,
          phase_type: '3P',
          location: 'Sector B - Plot 12',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBackToDashboard}>
          <Text style={styles.backText}>‹ Dashboard</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Pump Controllers</Text>
        {onOpenCommissioning && (
          <TouchableOpacity
            style={{ backgroundColor: '#00E676', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 }}
            onPress={onOpenCommissioning}
          >
            <Text style={{ color: '#0D1117', fontWeight: 'bold', fontSize: 12 }}>+ Commission</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(item) => item.device_id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.deviceCard}
              onPress={() => onSelectDevice(item.device_id)}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.deviceName}>{item.name || item.device_id}</Text>
                <View
                  style={[
                    styles.statusPill,
                    {
                      backgroundColor:
                        item.status === 'ONLINE' ? '#16A34A20' : '#DC262620',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      { color: item.status === 'ONLINE' ? '#22C55E' : '#EF4444' },
                    ]}
                  >
                    {item.status}
                  </Text>
                </View>
              </View>

              <Text style={styles.idText}>ID: {item.device_id}</Text>
              <Text style={styles.locationText}>{item.location || 'Farm Location'}</Text>

              <View style={styles.cardFooter}>
                <Text style={styles.footerText}>Rating: {item.motor_hp} HP</Text>
                <Text style={styles.stateText}>State: {item.pump_state}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderColor: '#334155',
  },
  backBtn: {
    padding: 6,
  },
  backText: {
    color: '#38BDF8',
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
  },
  refreshBtn: {
    padding: 6,
  },
  refreshText: {
    color: '#38BDF8',
    fontSize: 20,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    padding: 16,
    gap: 12,
  },
  deviceCard: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  deviceName: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  idText: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  locationText: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderColor: '#334155',
    paddingTop: 10,
  },
  footerText: {
    color: '#CBD5E1',
    fontSize: 13,
  },
  stateText: {
    color: '#22C55E',
    fontSize: 13,
    fontWeight: '700',
  },
});
