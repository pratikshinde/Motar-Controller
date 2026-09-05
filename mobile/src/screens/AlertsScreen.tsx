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
import { Alert } from '../types';

interface AlertsScreenProps {
  onBackToDashboard: () => void;
}

export const AlertsScreen: React.FC<AlertsScreenProps> = ({ onBackToDashboard }) => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAlerts();
  }, []);

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/alerts');
      if (Array.isArray(res.data)) {
        setAlerts(res.data);
      } else if (res.data.alerts) {
        setAlerts(res.data.alerts);
      }
    } catch (e) {
      setAlerts([
        {
          id: 'alt-101',
          device_id: 'PUMP-4G-3P-8821',
          fault_code: 1,
          fault_name: 'Dry Run Protection Trip',
          severity: 'CRITICAL',
          status: 'ACTIVE',
          created_at: new Date(Date.now() - 3600000).toISOString(),
          message: 'Borewell water level dropped below sensor threshold.',
        },
        {
          id: 'alt-102',
          device_id: 'PUMP-4G-3P-9912',
          fault_code: 4,
          fault_name: 'Phase Reversal Detected',
          severity: 'WARNING',
          status: 'RESOLVED',
          created_at: new Date(Date.now() - 86400000).toISOString(),
          message: 'Phase sequence corrected by grid operator.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBackToDashboard}>
          <Text style={styles.backText}>‹ Dashboard</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Alerts & Fault Inbox</Text>
        <TouchableOpacity style={styles.refreshBtn} onPress={fetchAlerts}>
          <Text style={styles.refreshText}>↻</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#38BDF8" />
        </View>
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.alertCard}>
              <View style={styles.cardHeader}>
                <Text style={styles.faultName}>{item.fault_name}</Text>
                <View
                  style={[
                    styles.sevPill,
                    {
                      backgroundColor:
                        item.severity === 'CRITICAL' ? '#DC262620' : '#EAB30820',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.sevText,
                      { color: item.severity === 'CRITICAL' ? '#EF4444' : '#EAB308' },
                    ]}
                  >
                    {item.severity}
                  </Text>
                </View>
              </View>

              <Text style={styles.deviceText}>Device: {item.device_id}</Text>
              <Text style={styles.msgText}>{item.message}</Text>

              <View style={styles.cardFooter}>
                <Text style={styles.timeText}>
                  {new Date(item.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
                <Text
                  style={[
                    styles.statusText,
                    { color: item.status === 'ACTIVE' ? '#EF4444' : '#22C55E' },
                  ]}
                >
                  {item.status}
                </Text>
              </View>
            </View>
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
  alertCard: {
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
  faultName: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  sevPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  sevText: {
    fontSize: 11,
    fontWeight: '800',
  },
  deviceText: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  msgText: {
    color: '#CBD5E1',
    fontSize: 13,
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderColor: '#334155',
    paddingTop: 8,
  },
  timeText: {
    color: '#64748B',
    fontSize: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
