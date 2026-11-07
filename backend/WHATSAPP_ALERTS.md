# WhatsApp alerts (Meta WhatsApp Cloud API)

The backend tells a pump's owner on WhatsApp when:

| Event | Template (default name) | Variables |
|---|---|---|
| no contact for 3 minutes | `pump_no_contact` | {{1}} pump name, {{2}} minutes |
| back online | `pump_back_online` | {{1}} pump name, {{2}} supply volts, {{3}} running or stopped |
| a fault stopped the pump | `pump_fault_stop` | {{1}} pump name, {{2}} the starter's fault name |

Meta only lets a business start a chat with an **approved template**, so create these three in
Meta Business Manager > WhatsApp Manager > Message templates. Category **Utility**, language **English** (`en`).

**pump_no_contact**

    Pump alert: {{1}} has not been heard from for {{2}} minutes. The power may be off, or there is no mobile signal.

**pump_back_online**

    {{1}} is back online. Supply: {{2}} V. The pump is {{3}}.

**pump_fault_stop**

    {{1}} stopped: {{2}}. Please check the pump.

## Settings (backend/.env)

    WHATSAPP_API_TOKEN=<access token from the Meta developer console>
    WHATSAPP_PHONE_ID=<the WhatsApp phone number ID>
    ALERT_WHATSAPP_ENABLED=true
    ALERT_WHATSAPP_TO=<a number you verified in the console, while testing>   # remove to send to the owners
    # only if you named the templates differently:
    # WHATSAPP_TPL_NO_CONTACT / WHATSAPP_TPL_BACK_ONLINE / WHATSAPP_TPL_FAULT, WHATSAPP_ALERT_LANGUAGE

Restart the backend after changing `.env`. The token never goes in git (`.env` is ignored).

## Testing stage

With Meta's test number, only phone numbers you add and verify under *API Setup > To* can receive messages (up to 5), and the
temporary token expires after about a day. For real use, add a real number, finish business verification and create a
permanent token from a system user.
