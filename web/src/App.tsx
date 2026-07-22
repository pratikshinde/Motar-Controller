import React, { useState } from 'react';
import { RoleTier, ThemePreset, IndianLanguage } from './types';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'telemetry' | 'map' | 'devices' | 'tree' | 'logs'>('telemetry');
  const [theme, setTheme] = useState<ThemePreset>('sapphire');
  const [role, setRole] = useState<RoleTier>('customer');
  const [lang, setLang] = useState<IndianLanguage>('en');
  const [showSettings, setShowSettings] = useState(false);
  const [showCommModal, setShowCommModal] = useState(false);

  const isAdminRole = role === 'superadmin' || role === 'manufacturer' || role === 'distributor';

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* TOP HEADER */}
      <header style={{ height: '60px', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-card)', background: 'var(--bg-surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #38bdf8, #a855f7)', display: 'grid', placeItems: 'center', fontWeight: 800, color: '#fff' }}>⚡</div>
          <div>
            <h1 style={{ fontSize: 16, fontWeight: 800 }}>AgriPump SmartSpace</h1>
            <span style={{ fontSize: 10, color: '#10b981', fontFamily: 'monospace' }}>Zero-Scroll React Control</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select value={theme} onChange={e => { setTheme(e.target.value as ThemePreset); document.documentElement.setAttribute('data-theme', e.target.value); }} style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--bg-surface-elevated)', color: 'var(--text-main)', border: '1px solid var(--border-card)' }}>
            <option value="sapphire">🌌 Sapphire Dark</option>
            <option value="agro-light">🌿 Agro Clean Light</option>
            <option value="cyber-neon">⚡ Cyber Neon</option>
          </select>

          <select value={role} onChange={e => setRole(e.target.value as RoleTier)} style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--bg-surface-elevated)', color: 'var(--text-main)', border: '1px solid var(--border-card)' }}>
            <option value="superadmin">1. Superadmin (Admin)</option>
            <option value="manufacturer">2. Manufacturer (Admin)</option>
            <option value="distributor">3. Distributor (Admin)</option>
            <option value="dealer1">4. Dealer Tier 1</option>
            <option value="dealer5">8. Dealer Tier 5</option>
            <option value="customer">9. End Customer</option>
          </select>

          <button onClick={() => setShowSettings(true)} style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--bg-surface-elevated)', color: 'var(--text-main)', border: '1px solid var(--border-card)', cursor: 'pointer' }}>⚙️ Settings</button>
          <button onClick={() => setShowCommModal(true)} style={{ padding: '7px 14px', borderRadius: 8, background: 'linear-gradient(135deg, #38bdf8, #a855f7)', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}>+ Commission Pump</button>
        </div>
      </header>

      {/* SECONDARY TAB BAR */}
      <nav style={{ height: '48px', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface-elevated)', borderBottom: '1px solid var(--border-card)' }}>
        {(['telemetry', 'map', 'devices', 'tree', 'logs'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: activeTab === t ? 'var(--bg-surface)' : 'transparent', color: activeTab === t ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 700, cursor: 'pointer' }}>
            {t === 'telemetry' && '⚡ 1. Live Telemetry & Control'}
            {t === 'map' && '🗺️ 2. GIS Geo-Location Map'}
            {t === 'devices' && '📱 3. Devices Registry'}
            {t === 'tree' && '👥 4. RBAC 9-Tier Hierarchy'}
            {t === 'logs' && '🚨 5. Fault Incident Logs'}
          </button>
        ))}
      </nav>

      {/* MAIN VIEWPORT */}
      <main style={{ flex: 1, padding: 16, overflow: 'hidden' }}>
        {activeTab === 'telemetry' && (
          <div style={{ height: '100%', display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16 }}>
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-card)', borderRadius: 18, padding: 16, display: 'flex', flexDirection: 'column', justifyBetween: 'space-between' }}>
              <h3 style={{ fontSize: 15, fontWeight: 800 }}>3-Phase Power Health Monitor</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, margin: '12px 0', textAlign: 'center' }}>
                <div style={{ background: 'var(--bg-surface-elevated)', padding: 8, borderRadius: 12 }}><strong style={{ fontSize: 14 }}>418V</strong><br/><span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Ph R-Y</span></div>
                <div style={{ background: 'var(--bg-surface-elevated)', padding: 8, borderRadius: 12 }}><strong style={{ fontSize: 14 }}>422V</strong><br/><span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Ph Y-B</span></div>
                <div style={{ background: 'var(--bg-surface-elevated)', padding: 8, borderRadius: 12 }}><strong style={{ fontSize: 14 }}>415V</strong><br/><span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Ph B-R</span></div>
              </div>
            </div>

            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-card)', borderRadius: 18, padding: 16 }}>
              <h3 style={{ fontSize: 15, fontWeight: 800 }}>Borewell Pump #1 (15 HP)</h3>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Status: 🟢 RUNNING • 5m Off / 2m On Interval</p>
            </div>
          </div>
        )}

        {activeTab === 'devices' && (
          <div style={{ height: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border-card)', borderRadius: 18, padding: 20 }}>
            <h3>📱 Hardware Device Registry</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>PUMP-4G-3P-8821 | 3-Phase (415V) | GSM RSSI: -68 dBm | 19.9975° N, 73.7898° E</p>
          </div>
        )}

        {activeTab === 'tree' && (
          <div style={{ height: '100%', background: 'var(--bg-surface)', border: '1px solid var(--border-card)', borderRadius: 18, padding: 20 }}>
            <h3>👥 9-Tier Multi-Tenant RBAC Hierarchy</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Superadmin ➔ Manufacturer ➔ Distributor ➔ Dealer 1-5 ➔ End Customer</p>
          </div>
        )}
      </main>
    </div>
  );
};
export default App;
