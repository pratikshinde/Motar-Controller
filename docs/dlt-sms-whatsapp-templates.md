# TRAI DLT SMS & WhatsApp Regional Multi-Channel Alert Templates

This document details the **India TRAI Telecom Regulatory Authority DLT (Distributed Ledger Technology)** registration requirements, approved SMS headers, DLT template IDs, variable mappings, and Meta WhatsApp Business API integration contracts for the **AgriPump SmartSpace** IoT system.

---

## 1. TRAI DLT Registration Specifications (India)

| Entity / Template Attribute | Configuration Value |
| :--- | :--- |
| **Principal Entity (PE) ID** | `1701158000000098765` |
| **Header (Sender ID)** | `AGPUMP` (Implicit Transactional category) |
| **Telemarketer ID** | MSG91 / Fast2SMS / AWS SNS (Registered Telemarketer) |
| **Approved Category** | Implicit Service / Transactional |

---

## 2. Multi-Language Approved DLT Template Matrix (23 Languages)

### Template 1: Single Phasing Hardware Fault (`SINGLE_PHASING`)
- **DLT Template ID**: `1707168900000012345`
- **Header ID**: `AGPUMP`

#### Language Variations:
- **Hindi (`hi`)**:
  > `चेतावनी: {#var#} पर सिंगल फेजिंग का पता चला। Y-फेज 0V। मोटर सुरक्षा के लिए कांटैक्टर ट्रिप हो गया।`
- **Marathi (`mr`)**:
  > `सतर्कता: {#var#} वर सिंगल फेजिंग आढळली. Y-फेज 0V. मोटर सुरक्षिततेसाठी कॉन्टॅक्टर स्वयंचलितपणे ट्रिप झाला.`
- **Gujarati (`gu`)**:
  > `ચેતવણી: {#var#} પર સિંગલ ફેઝિંગ ડિટેક્ટ થયું. Y-ફેઝ 0V. મોટર સુરક્ષા માટે કોન્ટેક્ટર ટ્રીપ થયો.`
- **Kannada (`kn`)**:
  > `ಎಚ್ಚರಿಕೆ: {#var#} ನಲ್ಲಿ ಸಿಂಗಲ್ ಫೇಸಿಂಗ್ ಪತ್ತೆಯಾಗಿದೆ. Y-ಫೇಸ್ 0V. ಮೋಟಾರ್ ಸುರಕ್ಷತೆಗಾಗಿ ಕಾಂಟ್ಯಾಕ್ಟರ್ ಟ್ರಿಪ್ ಆಗಿದೆ.`
- **Tamil (`ta`)**:
  > `எச்சரிக்கை: {#var#} இல் சிங்கிள் பேசிங் கண்டறியப்பட்டது. Y-பேஸ் 0V. மோட்டார் பாதுகாப்புக்காக காண்டாக்டர் ட்ரிப் ஆனது.`
- **Telugu (`te`)**:
  > `హెచ్చరిక: {#var#} వద్ద సింగిల్ ఫేసింగ్ గుర్తించబడింది. Y-ఫేజ్ 0V. మోటార్ భద్రత కోసం కాంటాక్టర్ ట్రిప్ అయింది.`
- **English (`en`)**:
  > `ALERT: Single phasing detected on {#var#}. Y-Phase voltage 0V. Contactor tripped automatically for motor safety.`

---

### Template 2: Dry Run Fault (`DRY_RUN`)
- **DLT Template ID**: `1707168900000012346`
- **Header ID**: `AGPUMP`

#### Language Variations:
- **Hindi (`hi`)**:
  > `चेतावनी: {#var#} पर ड्राई रन (पानी खत्म) की स्थिति। करंट सीमा से नीचे गिरा। पंप अपने आप बंद हो गया।`
- **Marathi (`mr`)**:
  > `सतर्कता: {#var#} वर ड्राय रन (पाणी संपले) स्थिती. करंट मर्यादेपेक्षा कमी झाला. पंप आपोआप बंद झाला.`
- **Gujarati (`gu`)**:
  > `ચેતવણી: {#var#} પર ડ્રાય રન (પાણી પૂરું) સ્થિતિ. કરંટ લિમિટથી નીચે ગયો. પંપ આપોઆપ બંધ થયો.`
- **English (`en`)**:
  > `ALERT: Dry run condition detected on {#var#}. Current dropped below threshold. Pump stopped automatically.`

---

### Template 3: Motor Overload Fault (`OVERLOAD`)
- **DLT Template ID**: `1707168900000012347`
- **Header ID**: `AGPUMP`

#### Language Variations:
- **Hindi (`hi`)**:
  > `चेतावनी: {#var#} पर मोटर ओवरलोड। करंट {#var#}A से अधिक। मोटर जलने से बचाने के लिए पंप बंद कर दिया गया।`
- **Marathi (`mr`)**:
  > `सतर्कता: {#var#} वर मोटर ओव्हरलोड. करंट {#var#}A पेक्षा जास्त. मोटर जळण्यापासून वाचवण्यासाठी पंप बंद केला.`
- **English (`en`)**:
  > `ALERT: Motor overload detected on {#var#}. Current exceeded {#var#}A. Pump shut down to prevent motor burnout.`

---

## 3. REST API Endpoint & Test Payload

### Endpoint: `POST /api/alerts/send`

```json
{
  "phone_number": "+919876543210",
  "template_key": "SINGLE_PHASING",
  "vars": ["Borewell Pump #1"],
  "language": "hi",
  "channel": "BOTH"
}
```

#### Response:
```json
{
  "status": "DISPATCHED",
  "phone_number": "+919876543210",
  "template_key": "SINGLE_PHASING",
  "language": "hi",
  "sms": {
    "status": "SIMULATED_SUCCESS",
    "gateway": "MSG91_DLT_MOCK",
    "recipient": "+919876543210"
  },
  "whatsapp": {
    "status": "SIMULATED_SUCCESS",
    "gateway": "WHATSAPP_META_MOCK",
    "recipient": "+919876543210"
  }
}
```
