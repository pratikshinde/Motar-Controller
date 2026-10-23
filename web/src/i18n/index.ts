// i18n framework (Web_App_Pending_Items.md §4.1 / §11.5 W3). Structurally
// supports the full 20-locale target (Eighth Schedule + English, less
// Urdu/Kashmiri/Sindhi — deferred with RTL), but the picker only ever
// offers locales whose dictionary is actually complete: shipping a
// language option that silently falls back to English is worse than not
// offering it (the bug this replaces — 9 offered, 4 delivered).
//
// CSS should prefer logical properties (marginInlineStart, not marginLeft)
// so the eventual RTL locales are a `dir` flip plus a small hand-fix pass,
// not a rewrite — see §4.1.

export interface Dict {
  navTelemetry: string;
  navDevices: string;
  navHierarchy: string;
  navFaultLogs: string;
  navMap: string;
  navAudit: string;
  navFleet: string;
  navFactory: string;
  navHealth: string;
  navSupport: string;
  navConfigTemplates: string;
  navServiceReports: string;
  navAlerts: string;
  navManufacturers: string;
  heroTitle: string;
  kpiTotal: string;
  kpiRunning: string;
  kpiFaults: string;
  kpiStopped: string;
  statusRunning: string;
  statusStopped: string;
  statusFault: string;
  btnCommission: string;
  btnSettings: string;
  btnLogout: string;
  btnAddSubordinate: string;
  lblRemoteSwitch: string;
  devicesTitle: string;
  thDeviceId: string;
  thSupplyType: string;
  thDeviceType: string;
  deviceTypeAc3ph: string;
  deviceTypeSolarVfd: string;
  vfdFrequency: string;
  vfdPower: string;
  vfdDcBus: string;
  vfdOutputCurrent: string;
  vfdAcVoltage: string;
  vfdStatus: string;
  vfdFault: string;
  noReading: string;
  thFirmware: string;
  thStatus: string;
  thActions: string;
  hierarchyTitle: string;
  faultLogsTitle: string;
  settingsTitle: string;
  loginTitle: string;
  loginSubtitle: string;
}

export const supportedLocales = ['en', 'hi'] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

export const localeLabels: Record<SupportedLocale, string> = {
  en: 'English',
  hi: 'हिन्दी (Hindi)'
};

export const dictionaries: Record<SupportedLocale, Dict> = {
  en: {
    navTelemetry: 'Live Telemetry',
    navDevices: 'Devices',
    navHierarchy: 'Hierarchy',
    navFaultLogs: 'Fault Logs',
    navMap: 'Map',
    navAudit: 'Audit Log',
    navFleet: 'Fleet Dashboard',
    navFactory: 'Factory Console',
    navHealth: 'System Health',
    navSupport: 'Support Console',
    navConfigTemplates: 'Config Templates',
    navServiceReports: 'Service Reports',
    navAlerts: 'Alerts',
    navManufacturers: 'Manufacturers',
    heroTitle: '3-Phase Power Health Monitor',
    kpiTotal: 'Total',
    kpiRunning: 'Running',
    kpiFaults: 'Faults',
    kpiStopped: 'Idle',
    statusRunning: 'RUNNING',
    statusStopped: 'STOPPED',
    statusFault: 'FAULT',
    btnCommission: 'Commission Pump',
    btnSettings: 'Settings',
    btnLogout: 'Logout',
    btnAddSubordinate: 'Add Subordinate Account',
    lblRemoteSwitch: 'Remote Switch',
    devicesTitle: 'Hardware Device Registry & Fleet Inventory',
    thDeviceId: 'Device ID (Thing Name)',
    thSupplyType: 'Supply Type',
    thDeviceType: 'Device Type',
    deviceTypeAc3ph: 'AC 3-Phase',
    deviceTypeSolarVfd: 'Solar VFD',
    vfdFrequency: 'Output Frequency',
    vfdPower: 'Motor Power',
    vfdDcBus: 'DC Bus Voltage',
    vfdOutputCurrent: 'Output Current',
    vfdAcVoltage: 'AC Output Voltage',
    vfdStatus: 'VFD Status',
    vfdFault: 'VFD Fault',
    noReading: 'No reading',
    thFirmware: 'Firmware',
    thStatus: 'Status',
    thActions: 'Actions',
    hierarchyTitle: 'Multi-Tenant Account Hierarchy',
    faultLogsTitle: 'Fleet Fault Incident & Protection Logs',
    settingsTitle: 'System & Interface Settings',
    loginTitle: 'AgriPump SmartSpace',
    loginSubtitle: 'Sign in to continue'
  },
  hi: {
    navTelemetry: 'लाइव टेलीमेट्री',
    navDevices: 'उपकरण',
    navHierarchy: 'हायरार्की',
    navFaultLogs: 'फॉल्ट लॉग्स',
    navMap: 'मानचित्र',
    navAudit: 'ऑडिट लॉग',
    navFleet: 'फ्लीट डैशबोर्ड',
    navFactory: 'फैक्ट्री कंसोल',
    navHealth: 'सिस्टम स्वास्थ्य',
    navSupport: 'सपोर्ट कंसोल',
    navConfigTemplates: 'कॉन्फ़िग टेम्पलेट्स',
    navServiceReports: 'सेवा रिपोर्ट',
    navAlerts: 'अलर्ट',
    navManufacturers: 'निर्माता',
    heroTitle: '3-फेज मोटर बिजली स्वास्थ्य मॉनिटर',
    kpiTotal: 'कुल उपकरण',
    kpiRunning: 'चालू',
    kpiFaults: 'खराबी',
    kpiStopped: 'बंद',
    statusRunning: 'चालू है',
    statusStopped: 'बंद है',
    statusFault: 'खराबी',
    btnCommission: 'नया पंप जोड़ें',
    btnSettings: 'सेटिंग्स',
    btnLogout: 'लॉगआउट',
    btnAddSubordinate: 'नया सब-अकाउंट जोड़ें',
    lblRemoteSwitch: 'रिमोट स्विच',
    devicesTitle: 'हार्डवेयर डिवाइस रजिस्ट्री',
    thDeviceId: 'उपकरण आईडी',
    thSupplyType: 'बिजली आपूर्ति प्रकार',
    thDeviceType: 'उपकरण का प्रकार',
    deviceTypeAc3ph: 'एसी 3-फेज़',
    deviceTypeSolarVfd: 'सोलर वीएफडी',
    vfdFrequency: 'आउटपुट फ्रीक्वेंसी',
    vfdPower: 'मोटर पावर',
    vfdDcBus: 'डीसी बस वोल्टेज',
    vfdOutputCurrent: 'आउटपुट करंट',
    vfdAcVoltage: 'एसी आउटपुट वोल्टेज',
    vfdStatus: 'वीएफडी स्थिति',
    vfdFault: 'वीएफडी खराबी',
    noReading: 'कोई रीडिंग नहीं',
    thFirmware: 'फर्मवेयर',
    thStatus: 'स्थिति',
    thActions: 'कार्रवाई',
    hierarchyTitle: 'बहु-किरायेदार खाता संरचना',
    faultLogsTitle: 'फ्लीट फॉल्ट और सुरक्षा लॉग',
    settingsTitle: 'सिस्टम और इंटरफ़ेस सेटिंग्स',
    loginTitle: 'एग्रीपंप स्मार्टस्पेस',
    loginSubtitle: 'जारी रखने के लिए साइन इन करें'
  }
};
