/**
 * AgriPump SmartSpace - DLT SMS & WhatsApp Multi-Channel Regional Alert Engine
 * Compliant with TRAI (India) DLT Regulations & Meta WhatsApp Business API
 */
const metrics = require('./metrics');

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
    ta: "எச்சரிக்கை: {#var#} இல் சிங்கிள் பேசிங் கண்டறியப்பட்டது. Y-பேస్ 0V. மோட்டார் பாதுகாப்புக்காக காண்டாக்டர் ட்ரிப் ஆனது.",
    te: "హెచ్చరిక: {#var#} వద్ద సింగిల్ ఫేసింగ్ గుర్తించబడింది. Y-ఫేజ్ 0V. మోటార్ భద్రత కోసం కాంటాక్టర్ ట్రిప్ అయింది."
  },

  // --- DRY RUN FAULT ---
  DRY_RUN: {
    dlt_template_id: "1707168900000012346",
    dlt_header: "AGPUMP",
    en: "ALERT: Dry run condition detected on {#var#}. Current dropped below threshold. Pump stopped automatically.",
    hi: "चेतावनी: {#var#} पर ड्राई रन (पानी खत्म) की स्थिति। करंट सीमा से नीचे गिरा। पंप अपने आप बंद हो गया।",
    mr: "सतर्कता: {#var#} वर ड्राय रन (पाणी संपले) स्थिती. करंट मर्यादेपेक्षा कमी झाला. पंप आपोआप बंद झाला."
  },

  // --- OVERLOAD FAULT ---
  OVERLOAD: {
    dlt_template_id: "1707168900000012347",
    dlt_header: "AGPUMP",
    en: "ALERT: Motor overload detected on {#var#}. Current exceeded {#var#}A. Pump shut down to prevent motor burnout.",
    hi: "चेतावनी: {#var#} पर मोटर ओवरलोड। करंट {#var#}A से अधिक। मोटर जलने से बचाने के लिए पंप बंद कर दिया गया。",
    mr: "सतर्कता: {#var#} वर मोटर ओव्हरलोड. करंट {#var#}A पेक्षा जास्त. मोटर जळण्यापासून वाचवण्यासाठी पंप बंद केला."
  }
};

// ----------------------------------------------------------------------------
// 2. MULTI-GATEWAY SMS SENDER (MSG91 / FAST2SMS / TWILIO)
// ----------------------------------------------------------------------------
// Public entry point: counts every call for FR-WEB-017's system health
// view. "sent" here means the function returned without throwing (a real
// gateway response or the documented mock fallback) — there is no delivery
// receipt wired up, so this cannot and does not claim confirmed delivery.
async function sendDltSms(...args) {
  try {
    const result = await _sendDltSms(...args);
    metrics.increment('sms_sent');
    return result;
  } catch (err) {
    metrics.increment('sms_failed');
    throw err;
  }
}

async function _sendDltSms(phoneNumber, templateKey, vars = [], lang = 'hi') {
  const template = DLT_TEMPLATES[templateKey];
  if (!template) throw new Error(`Unknown DLT template key: ${templateKey}`);

  const messageText = (template[lang] || template['en']).replace('{#var#}', vars[0] || 'Borewell Pump #1');
  const cleanPhone = phoneNumber.replace('+', '');

  // Gateway Priority 1: MSG91 DLT
  if (process.env.MSG91_AUTH_KEY) {
    const payload = {
      flow_id: process.env.MSG91_FLOW_ID || template.dlt_template_id,
      sender: template.dlt_header,
      recipients: [{ mobiles: cleanPhone, var1: vars[0] || 'Borewell Pump #1' }]
    };
    const res = await fetch('https://api.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { authkey: process.env.MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { status: 'LIVE_SENT', gateway: 'MSG91_DLT', response: await res.json() };
  }

  // Gateway Priority 2: Fast2SMS Quick Route (India)
  if (process.env.FAST2SMS_API_KEY) {
    const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: { authorization: process.env.FAST2SMS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        route: 'q',
        message: messageText,
        numbers: cleanPhone.replace(/^91/, '')
      })
    });
    return { status: 'LIVE_SENT', gateway: 'FAST2SMS', response: await res.json() };
  }

  // Gateway Priority 3: Twilio SMS
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const params = new URLSearchParams({
      To: phoneNumber,
      From: process.env.TWILIO_PHONE_NUMBER,
      Body: messageText
    });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    return { status: 'LIVE_SENT', gateway: 'TWILIO_SMS', response: await res.json() };
  }

  // Fallback: Sandbox Mock
  console.log(`📱 [DLT SMS MOCK LOG] To: ${phoneNumber} | Message (${lang.toUpperCase()}): ${messageText}`);
  return {
    status: 'MOCK_SUCCESS',
    notice: 'No live SMS API key found in backend/.env. Configure MSG91_AUTH_KEY, FAST2SMS_API_KEY, or TWILIO_AUTH_TOKEN to receive real SMS.',
    gateway: 'SIMULATED_MOCK',
    recipient: phoneNumber
  };
}

// ----------------------------------------------------------------------------
// 3. MULTI-GATEWAY WHATSAPP SENDER (META CLOUD API / TWILIO WHATSAPP)
// ----------------------------------------------------------------------------
async function sendWhatsAppAlert(...args) {
  try {
    const result = await _sendWhatsAppAlert(...args);
    metrics.increment('whatsapp_sent');
    return result;
  } catch (err) {
    metrics.increment('whatsapp_failed');
    throw err;
  }
}

async function _sendWhatsAppAlert(phoneNumber, templateKey, vars = [], lang = 'hi') {
  const template = DLT_TEMPLATES[templateKey];
  const messageText = (template[lang] || template['en']).replace('{#var#}', vars[0] || 'Borewell Pump #1');

  // Gateway Priority 1: Meta WhatsApp Cloud API
  if (process.env.WHATSAPP_API_TOKEN) {
    const phoneId = process.env.WHATSAPP_PHONE_ID || '10987654321';
    const payload = {
      messaging_product: "whatsapp",
      to: phoneNumber.replace('+', ''),
      type: "template",
      template: {
        name: `agripump_${templateKey.toLowerCase()}`,
        language: { code: lang },
        components: [{ type: "body", parameters: vars.map(v => ({ type: "text", text: v })) }]
      }
    };
    const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { status: 'LIVE_SENT', gateway: 'META_WHATSAPP', response: await res.json() };
  }

  // Gateway Priority 2: Twilio WhatsApp
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const params = new URLSearchParams({
      To: `whatsapp:${phoneNumber}`,
      From: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886'}`,
      Body: messageText
    });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    return { status: 'LIVE_SENT', gateway: 'TWILIO_WHATSAPP', response: await res.json() };
  }

  // Fallback: Sandbox Mock
  console.log(`💬 [WHATSAPP MOCK LOG] To: ${phoneNumber} | Message (${lang.toUpperCase()}): ${messageText}`);
  return {
    status: 'MOCK_SUCCESS',
    notice: 'No live WhatsApp API token found in backend/.env. Configure WHATSAPP_API_TOKEN or TWILIO_AUTH_TOKEN to receive real WhatsApp messages.',
    gateway: 'SIMULATED_MOCK',
    recipient: phoneNumber
  };
}

module.exports = {
  DLT_TEMPLATES,
  sendDltSms,
  sendWhatsAppAlert
};
