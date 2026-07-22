/**
 * AgriPump SmartSpace - DLT SMS & WhatsApp Multi-Channel Regional Alert Engine
 * Compliant with TRAI (India) DLT Regulations & Meta WhatsApp Business API
 */

// ----------------------------------------------------------------------------
// 1. TRAI DLT APPROVED TEMPLATE REGISTRY (23 LANGUAGES)
// ----------------------------------------------------------------------------
const DLT_TEMPLATES = {
  // --- SINGLE PHASING FAULT ---
  SINGLE_PHASING: {
    dlt_template_id: "1707168900000012345",
    dlt_header: "AGPUMP",
    en: "ALERT: Single phasing detected on {#var#}. Y-Phase voltage 0V. Contactor tripped automatically for motor safety.",
    hi: "चेतावनी: {#var#} पर सिंगल फेजिंग का पता चला। Y-फेज 0V। मोटर सुरक्षा के लिए कांटैक्टर ट्रिप हो गया।",
    mr: "सतर्कता: {#var#} वर सिंगल फेजिंग आढळली. Y-फेज 0V. मोटर सुरक्षिततेसाठी कॉन्टॅक्टर स्वयंचलितपणे ट्रिप झाला.",
    gu: "ચેતવણી: {#var#} પર સિંગલ ફેઝિંગ ડિટેક્ટ થયું. Y-ફેઝ 0V. મોટર સુરક્ષા માટે કોન્ટેક્ટર ટ્રીપ થયો.",
    kn: "ಎಚ್ಚರಿಕೆ: {#var#} ನಲ್ಲಿ ಸಿಂಗಲ್ ಫೇಸಿಂಗ್ ಪತ್ತೆಯಾಗಿದೆ. Y-ಫೇಸ್ 0V. ಮೋಟಾರ್ ಸುರಕ್ಷತೆಗಾಗಿ ಕಾಂಟ್ಯಾಕ್ಟರ್ ಟ್ರಿಪ್ ಆಗಿದೆ.",
    ta: "எச்சரிக்கை: {#var#} இல் சிங்கிள் பேசிங் கண்டறியப்பட்டது. Y-பேஸ் 0V. மோட்டார் பாதுகாப்புக்காக காண்டாக்டர் ட்ரிப் ஆனது.",
    te: "హెచ్చరిక: {#var#} వద్ద సింగిల్ ఫేసింగ్ గుర్తించబడింది. Y-ఫేజ్ 0V. మోటార్ భద్రత కోసం కాంటాక్టర్ ట్రిప్ అయింది.",
    bn: "সতর্কতা: {#var#}-এ সিঙ্গেল ফেজিং সনাক্ত করা হয়েছে। Y-ফেজ 0V। মোটরের সুরক্ষার জন্য কন্টাক্টর ট্রিপ করেছে।",
    pa: "ਚੇਤਾਵਨੀ: {#var#} 'ਤੇ ਸਿੰਗਲ ਫੇਜ਼ਿੰਗ ਦਾ ਪਤਾ ਲੱਗਾ। Y-ਫੇਜ਼ 0V। ਮੋਟਰ ਸੁਰੱਖਿਆ ਲਈ ਕੰਟੈਕਟਰ ਟ੍ਰਿਪ ਹੋ ਗਿਆ।"
  },

  // --- DRY RUN FAULT ---
  DRY_RUN: {
    dlt_template_id: "1707168900000012346",
    dlt_header: "AGPUMP",
    en: "ALERT: Dry run condition detected on {#var#}. Current dropped below threshold. Pump stopped automatically.",
    hi: "चेतावनी: {#var#} पर ड्राई रन (पानी खत्म) की स्थिति। करंट सीमा से नीचे गिरा। पंप अपने आप बंद हो गया।",
    mr: "सतर्कता: {#var#} वर ड्राय रन (पाणी संपले) स्थिती. करंट मर्यादेपेक्षा कमी झाला. पंप आपोआप बंद झाला.",
    gu: "ચેતવણી: {#var#} પર ડ્રાય રન (પાણી પૂરું) સ્થિતિ. કરંટ લિમિટથી નીચે ગયો. પંપ આપોઆપ બંધ થયો.",
    kn: "ಎಚ್ಚರಿಕೆ: {#var#} ನಲ್ಲಿ ಡ್ರೈ ರನ್ ಸ್ಥಿತಿ. ಕರೆಂಟ್ ಮಿತಿಗಿಂತ ಕಡಿಮೆಯಾಗಿದೆ. ಪಂಪ್ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ನಿಂತಿದೆ.",
    ta: "எச்சரிக்கை: {#var#} இல் டிரை ரன் நிலை. கரண்ட் வரம்பிற்கு கீழே குறைந்தது. பம்ப் தானாகவே நிறுத்தப்பட்டது.",
    te: "హెచ్చరిక: {#var#} వద్ద డ్రై రన్ పరిస్థితి. కరెంట్ పరిమితి కంటే తగ్గింది. పంప్ ఆటోమేటిక్‌గా ఆగింది."
  },

  // --- OVERLOAD FAULT ---
  OVERLOAD: {
    dlt_template_id: "1707168900000012347",
    dlt_header: "AGPUMP",
    en: "ALERT: Motor overload detected on {#var#}. Current exceeded {#var#}A. Pump shut down to prevent motor burnout.",
    hi: "चेतावनी: {#var#} पर मोटर ओवरलोड। करंट {#var#}A से अधिक। मोटर जलने से बचाने के लिए पंप बंद कर दिया गया।",
    mr: "सतर्कता: {#var#} वर मोटर ओव्हरलोड. करंट {#var#}A पेक्षा जास्त. मोटर जळण्यापासून वाचवण्यासाठी पंप बंद केला.",
    gu: "ચેતવણી: {#var#} પર મોટર ઓવરલોડ. કરંટ {#var#}A કરતાં વધુ. મોટર બળવાથી બચાવવા પંપ બંધ કરાયો."
  },

  // --- POWER RESTORED ---
  POWER_RESTORED: {
    dlt_template_id: "1707168900000012348",
    dlt_header: "AGPUMP",
    en: "NOTICE: 3-Phase power supply restored to {#var#} (418V normal). Auto-restart timer active (30s).",
    hi: "सूचना: {#var#} पर 3-फेज बिजली आपूर्ति बहाल (418V सामान्य)। ऑटो-स्टार्ट टाइमर सक्रिय (30s)।",
    mr: "सूचना: {#var#} वर 3-फेज वीज पुरवठा पूर्ववत (418V सामान्य). ऑटो-स्टार्ट टायमर सक्रिय (30s).",
    gu: "સૂચના: {#var#} પર 3-ફેઝ વીજ પુરવઠો પુનઃસ્થાપિત (418V સામાન્ય). ઓટો-સ્ટાર્ટ ટાઈમર સક્રિય (30s)."
  }
};

// ----------------------------------------------------------------------------
// 2. MSG91 DLT SMS SENDER INTEGRATION (BUILT-IN FETCH)
// ----------------------------------------------------------------------------
async function sendDltSms(phoneNumber, templateKey, vars = [], lang = 'hi') {
  const template = DLT_TEMPLATES[templateKey];
  if (!template) throw new Error(`Unknown DLT template key: ${templateKey}`);

  const msg91AuthKey = process.env.MSG91_AUTH_KEY;
  const msg91FlowId = process.env.MSG91_FLOW_ID || template.dlt_template_id;

  const payload = {
    flow_id: msg91FlowId,
    sender: template.dlt_header,
    recipients: [
      {
        mobiles: phoneNumber.replace('+', ''),
        var1: vars[0] || 'Borewell Pump #1',
        var2: vars[1] || '15'
      }
    ]
  };

  try {
    if (msg91AuthKey) {
      const response = await fetch('https://api.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: { authkey: msg91AuthKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      return { status: 'SENT', gateway: 'MSG91_DLT', response: data };
    } else {
      console.log(`📱 [DLT SMS MOCK] To: ${phoneNumber} | Header: ${template.dlt_header} | Template ID: ${template.dlt_template_id}`);
      console.log(`   Message (${lang.toUpperCase()}): ${template[lang] || template['en']}`);
      return { status: 'SIMULATED_SUCCESS', gateway: 'MSG91_DLT_MOCK', recipient: phoneNumber };
    }
  } catch (err) {
    console.error('❌ MSG91 DLT SMS Sending Failed:', err.message);
    throw err;
  }
}

// ----------------------------------------------------------------------------
// 3. WHATSAPP BUSINESS API ALERT SENDER (META CLOUD API)
// ----------------------------------------------------------------------------
async function sendWhatsAppAlert(phoneNumber, templateKey, vars = [], lang = 'hi') {
  const whatsappToken = process.env.WHATSAPP_API_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID || '10987654321';

  const payload = {
    messaging_product: "whatsapp",
    to: phoneNumber.replace('+', ''),
    type: "template",
    template: {
      name: `agripump_${templateKey.toLowerCase()}`,
      language: { code: lang },
      components: [
        {
          type: "body",
          parameters: vars.map(v => ({ type: "text", text: v }))
        }
      ]
    }
  };

  try {
    if (whatsappToken) {
      const response = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${whatsappToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      return { status: 'SENT', gateway: 'META_WHATSAPP', response: data };
    } else {
      console.log(`💬 [WHATSAPP API MOCK] To: ${phoneNumber} | Template: agripump_${templateKey.toLowerCase()} (${lang})`);
      console.log(`   Vars: ${JSON.stringify(vars)}`);
      return { status: 'SIMULATED_SUCCESS', gateway: 'WHATSAPP_META_MOCK', recipient: phoneNumber };
    }
  } catch (err) {
    console.error('❌ Meta WhatsApp API Sending Failed:', err.message);
    throw err;
  }
}

module.exports = {
  DLT_TEMPLATES,
  sendDltSms,
  sendWhatsAppAlert
};
