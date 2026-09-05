import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { storage } from './src/services/storage';
import { SplashScreen } from './src/screens/SplashScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { PumpDashboardScreen } from './src/screens/PumpDashboardScreen';
import { DeviceListScreen } from './src/screens/DeviceListScreen';
import { AlertsScreen } from './src/screens/AlertsScreen';
import { CommissioningScreen } from './src/screens/CommissioningScreen';

type ScreenState = 'SPLASH' | 'LOGIN' | 'DASHBOARD' | 'DEVICES' | 'ALERTS' | 'COMMISSION';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenState>('SPLASH');
  const [selectedDeviceId, setSelectedDeviceId] = useState('PUMP-4G-3P-8821');

  const checkAuth = async () => {
    const token = await storage.getItem('agripump_token');
    return !!token;
  };

  const handleSplashFinish = async () => {
    const authenticated = await checkAuth();
    if (authenticated) {
      setCurrentScreen('DASHBOARD');
    } else {
      setCurrentScreen('LOGIN');
    }
  };

  const handleLogout = async () => {
    await storage.clearAuth();
    setCurrentScreen('LOGIN');
  };

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <StatusBar style="light" />
        {currentScreen === 'SPLASH' && (
          <SplashScreen onFinish={handleSplashFinish} />
        )}
        {currentScreen === 'LOGIN' && (
          <LoginScreen onLoginSuccess={() => setCurrentScreen('DASHBOARD')} />
        )}
        {currentScreen === 'DASHBOARD' && (
          <PumpDashboardScreen
            deviceId={selectedDeviceId}
            onNavigateToDevices={() => setCurrentScreen('DEVICES')}
            onNavigateToAlerts={() => setCurrentScreen('ALERTS')}
            onLogout={handleLogout}
          />
        )}
        {currentScreen === 'DEVICES' && (
          <DeviceListScreen
            onSelectDevice={(id) => {
              setSelectedDeviceId(id);
              setCurrentScreen('DASHBOARD');
            }}
            onBackToDashboard={() => setCurrentScreen('DASHBOARD')}
            onOpenCommissioning={() => setCurrentScreen('COMMISSION')}
          />
        )}
        {currentScreen === 'ALERTS' && (
          <AlertsScreen onBackToDashboard={() => setCurrentScreen('DASHBOARD')} />
        )}
        {currentScreen === 'COMMISSION' && (
          <CommissioningScreen
            onBack={() => setCurrentScreen('DEVICES')}
            onCompleted={(id) => {
              setSelectedDeviceId(id);
              setCurrentScreen('DASHBOARD');
            }}
          />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
});
