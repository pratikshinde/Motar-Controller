export interface TranslationSet {
  tabTelemetry: string;
  tabMap: string;
  tabDevices: string;
  tabTree: string;
  tabLogs: string;
  heroTitle: string;
  seqNormal: string;
  lblVoltRY: string;
  lblVoltYB: string;
  lblVoltBR: string;
  lblCurrR: string;
  lblCurrY: string;
  lblCurrB: string;
  btnPhaseLoss: string;
  btnDryRun: string;
  btnResetFaults: string;
  lblRemoteSwitch: string;
  btnCommission: string;
  btnSettings: string;
  btnLogout: string;
  lblRunning: string;
  lblStopped: string;
  lblFault: string;
}

export const languagesList = [
  { code: 'as', label: '1. Assamese (অসমীয়া)' },
  { code: 'bn', label: '2. Bengali (বাংলা)' },
  { code: 'brx', label: '3. Bodo (बोडो)' },
  { code: 'doi', label: '4. Dogri (डोगरी)' },
  { code: 'en', label: '5. English (Default)' },
  { code: 'gu', label: '6. Gujarati (ગુજરાતી)' },
  { code: 'hi', label: '7. Hindi (हिन्दी)' },
  { code: 'kn', label: '8. Kannada (ಕನ್ನಡ)' },
  { code: 'ks', label: '9. Kashmiri (कश्मीरी)' },
  { code: 'kok', label: '10. Konkani (कोंकणी)' },
  { code: 'mai', label: '11. Maithili (मैथिली)' },
  { code: 'ml', label: '12. Malayalam (മലയാളം)' },
  { code: 'mni', label: '13. Manipuri (<ctrl42>ꯩꯇꯩꯂꯣꯟ)' },
  { code: 'mr', label: '14. Marathi (मराठी)' },
  { code: 'ne', label: '15. Nepali (नेपाली)' },
  { code: 'or', label: '16. Odia (ଓଡ଼ିଆ)' },
  { code: 'pa', label: '17. Punjabi (ਪੰਜਾਬੀ)' },
  { code: 'sa', label: '18. Sanskrit (संस्कृतम्)' },
  { code: 'sat', label: '19. Santali (ᱥᱟᱱᱛᱟᱲᱤ)' },
  { code: 'sd', label: '20. Sindhi (सिंधी)' },
  { code: 'ta', label: '21. Tamil (தமிழ்)' },
  { code: 'te', label: '22. Telugu (తెలుగు)' },
  { code: 'ur', label: '23. Urdu (اردو)' }
];

export const i18nDict: Record<string, TranslationSet> = {
  en: {
    tabTelemetry: "⚡ 1. Live Telemetry & Control",
    tabMap: "🗺️ 2. GIS Geo-Location Map",
    tabDevices: "📱 3. Devices Registry",
    tabTree: "👥 4. RBAC 9-Tier Hierarchy",
    tabLogs: "🚨 5. Fault Incident Logs",
    heroTitle: "3-Phase Power Health Monitor",
    seqNormal: "R-Y-B NORMAL",
    lblVoltRY: "Phase R-Y",
    lblVoltYB: "Phase Y-B",
    lblVoltBR: "Phase B-R",
    lblCurrR: "Ph R",
    lblCurrY: "Ph Y",
    lblCurrB: "Ph B",
    btnPhaseLoss: "⚡ Phase Loss",
    btnDryRun: "💧 Dry Run",
    btnResetFaults: "✅ Clear Faults",
    lblRemoteSwitch: "Remote Switch",
    btnCommission: "+ Commission Pump",
    btnSettings: "⚙️ Settings",
    btnLogout: "🚪 Logout",
    lblRunning: "RUNNING",
    lblStopped: "STOPPED",
    lblFault: "FAULT"
  },
  hi: {
    tabTelemetry: "⚡ 1. लाइव टेलीमेट्री और कंट्रोल",
    tabMap: "🗺️ 2. जीआईएस मानचित्र",
    tabDevices: "📱 3. उपकरण रजिस्ट्री",
    tabTree: "👥 4. 9-स्तरीय यूजर ट्री",
    tabLogs: "🚨 5. फॉल्ट लॉग्स",
    heroTitle: "3-फेज मोटर बिजली स्वास्थ्य मॉनिटर",
    seqNormal: "R-Y-B सामान्य",
    lblVoltRY: "फेज R-Y",
    lblVoltYB: "फेज Y-B",
    lblVoltBR: "फेज B-R",
    lblCurrR: "करंट R",
    lblCurrY: "करंट Y",
    lblCurrB: "करंट B",
    btnPhaseLoss: "⚡ फेज लॉस",
    btnDryRun: "💧 ड्राई रन",
    btnResetFaults: "✅ फॉल्ट साफ करें",
    lblRemoteSwitch: "रिमोट स्विच",
    btnCommission: "+ नया पंप जोड़ें",
    btnSettings: "⚙️ सेटिंग्स",
    btnLogout: "🚪 लॉगआउट",
    lblRunning: "चालू है",
    lblStopped: "बंद है",
    lblFault: "खराबी"
  },
  mr: {
    tabTelemetry: "⚡ 1. लाइव्ह टेलिमेन्ट्री आणि कंट्रोल",
    tabMap: "🗺️ 2. नकाशे (GIS Map)",
    tabDevices: "📱 3. उपकरण नोंदणी",
    tabTree: "👥 4. 9-स्तरीय खाते झाड",
    tabLogs: "🚨 5. त्रुटी नोंदी",
    heroTitle: "3-फेज मोटर पॉवर मॉनिटर",
    seqNormal: "R-Y-B सामान्य",
    lblVoltRY: "फेज R-Y",
    lblVoltYB: "फेज Y-B",
    lblVoltBR: "फेज B-R",
    lblCurrR: "करंट R",
    lblCurrY: "करंट Y",
    lblCurrB: "करंट B",
    btnPhaseLoss: "⚡ फेज लॉस",
    btnDryRun: "💧 ड्राय रन",
    btnResetFaults: "✅ त्रुटी साफ करा",
    lblRemoteSwitch: "रिमोट स्विच",
    btnCommission: "+ नवीन पंप जोडा",
    btnSettings: "⚙️ सेटिंग्ज",
    btnLogout: "🚪 बाहेर पडा",
    lblRunning: "चालू आहे",
    lblStopped: "बंद आहे",
    lblFault: "फॉल्ट"
  },
  gu: {
    tabOverview: "⚡ 1. લાઇવ ટેલિમેટ્રી",
    heroTitle: "લાઇવ 3-ફેઝ પાવર હેલ્થ મોનિટર",
    btnCommission: "+ નવો પંપ ઉમેરો",
    btnSettings: "⚙️ સેટિંગ્સ",
    lblRemoteSwitch: "રિમોટ સ્વિચ"
  },
  ta: {
    tabOverview: "⚡ 1. லைவ் டெலிமெட்ரி",
    heroTitle: "லைவ் 3-பேஸ் மோட்டார் பவர் மானிட்டர்",
    btnCommission: "+ புதிய பம்ப் சேர்க்க",
    btnSettings: "⚙️ அமைப்புகள்",
    lblRemoteSwitch: "ரிமோட் ஸ்விட்ச்"
  },
  te: {
    tabOverview: "⚡ 1. లైవ్ టెలిమెట్రీ",
    heroTitle: "లైవ్ 3-ఫేజ్ పవర్ మానిటర్",
    btnCommission: "+ కొత్త పంప్ జోడించండి",
    btnSettings: "⚙️ సెట్టింగ్‌లు",
    lblRemoteSwitch: "రిమోట్ స్విచ్"
  },
  kn: {
    tabOverview: "⚡ 1. ಲೈವ್ ಟೆಲಿಮೆಟ್ರಿ",
    heroTitle: "ಲೈವ್ 3-ಫೇಸ್ ಮೋಟಾರ್ ಪವರ್ ಮಾನಿಟರ್",
    btnCommission: "+ ಹೊಸ ಪಂಪ್ ಸೇರಿಸಿ",
    btnSettings: "⚙️ ಸಂಯೋಜನೆಗಳು",
    lblRemoteSwitch: "ರಿಮೋಟ್ ಸ್ವಿಚ್"
  },
  bn: {
    tabOverview: "⚡ 1. লাইভ টেলিম্যাট্রি",
    heroTitle: "লাইভ ৩-ফেজ পাওয়ার মনিটর",
    btnCommission: "+ পাম্প যোগ করুন",
    btnSettings: "⚙️ সেটিংস",
    lblRemoteSwitch: "রিমোট সুইচ"
  },
  pa: {
    tabOverview: "⚡ 1. ਲਾਈਵ ਟੈਲੀਮੈਟਰੀ",
    heroTitle: "ਲਾਈਵ 3-ਫੇਜ਼ ਮੋਟਰ ਪਾਵਰ ਮਾਨੀਟਰ",
    btnCommission: "+ ਨਵਾਂ ਪੰਪ ਜੋੜੋ",
    btnSettings: "⚙️ ਸੈਟਿੰਗਾਂ",
    lblRemoteSwitch: "ਰਿਮੋਟ ਸਵਿੱਚ"
  },
  ml: {
    tabOverview: "⚡ 1. ലൈവ് ടെലിമെട്രി",
    heroTitle: "ലൈവ് 3-ഫേസ് മോട്ടോർ പവർ മോണിറ്റർ",
    btnCommission: "+ പുതിയ പമ്പ് ചേർക്കുക",
    btnSettings: "⚙️ ക്രമീകരണങ്ങൾ",
    lblRemoteSwitch: "റിമോട്ട് സ്വിച്ച്"
  },
  or: {
    tabOverview: "⚡ 1. ଲାଇଭ୍ ଟେଲିମେଟ୍ରି",
    heroTitle: "ଲାଇଭ୍ 3-ଫେଜ୍ ମୋଟର ପାୱାର୍ ମନିଟର",
    btnCommission: "+ ନୂତନ ପମ୍ପ ଯୋଡନ୍ତୁ",
    btnSettings: "⚙️ ସେଟିଂସମୂହ",
    lblRemoteSwitch: "ରିମୋଟ ସ୍ୱିଚ୍"
  },
  as: {
    tabOverview: "⚡ 1. লাইভ টেলিমেট্ৰী",
    heroTitle: "লাইভ ৩-ফেজ পাম্প পাৱাৰ মনিটৰ",
    btnCommission: "+ পাম্প পঞ্জীয়ন",
    btnSettings: "⚙️ ছেটিংছ",
    lblRemoteSwitch: "ৰিমোট ছুইচ"
  },
  ur: {
    tabOverview: "⚡ 1. لائیو ٹیلی میٹری",
    heroTitle: "لائیو 3-فیز موٹر پاور مانیٹر",
    btnCommission: "+ نیا پمپ شامل کریں",
    btnSettings: "⚙️ ترتیبات",
    lblRemoteSwitch: "ریموٹ سوئچ"
  }
};
