import React, { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Stack,
  Alert,
  IconButton,
  InputAdornment,
  Divider,
  Link,
  Chip
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import SmsOutlinedIcon from '@mui/icons-material/SmsOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import { useNavigate } from 'react-router-dom';
import { sendSmsOtp, verifyOtp, loginWithPassword } from '../../api/auth';
import { verifyMfa } from '../../api/mfa';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { ResetPasswordDialog } from '../../components/ResetPasswordDialog';
import { isMfaRequired } from '../../types';

interface LoginFormProps {
  onSwitchToRegister: () => void;
  onSelectRole?: (roleId: string) => void;
}

type AuthMode = 'password' | 'otp';

// Shortcuts for a developer's machine only (`npm run dev`): the seeded demo accounts and their published password.
// `import.meta.env.DEV` is a literal `false` in a production build, so none of this - the accounts, the password, the
// panel that shows them - reaches the bundle that gets deployed.
const DEV_HELPERS = import.meta.env.DEV;
const DEMO_ACCOUNTS = DEV_HELPERS
  ? [
      { label: 'Super Admin', phone: '9999900001', role: 'Super Admin', pass: 'Admin@123' },
      { label: 'Manufacturer', phone: '9999900002', role: 'OEM', pass: 'Admin@123' },
      { label: 'Distributor', phone: '9999900003', role: 'Regional', pass: 'Admin@123' },
      { label: 'Dealer', phone: '9999900004', role: 'Installer', pass: 'Admin@123' },
      { label: 'Support', phone: '9999900005', role: 'Engineer', pass: 'Admin@123' },
      { label: 'Farmer', phone: '9999900006', role: 'Customer', pass: 'Admin@123' }
    ]
  : [];

export const LoginForm: React.FC<LoginFormProps> = ({ onSwitchToRegister, onSelectRole }) => {
  const navigate = useNavigate();
  const { handleAuthResult } = useAuth();
  const { showToast } = useToast();

  const [mode, setMode] = useState<AuthMode>('password');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [devOtpNotice, setDevOtpNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Forgot password dialog state
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);

  // MFA challenge state
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  const handleSelectDemoAccount = (acc: typeof DEMO_ACCOUNTS[number]) => {
    setPhone(acc.phone);
    setPassword(acc.pass);
    if (mode === 'otp') {
      setOtp('123456');
      setOtpRequested(true);
      setDevOtpNotice('[Dev test OTP: 123456 ready]');
    }
    setError('');
  };

  const quickRoles = [
    { id: 'superadmin', label: 'Super Admin', sub: 'Platform administration', icon: <AdminPanelSettingsOutlinedIcon sx={{ fontSize: 20, color: '#475569' }} /> },
    { id: 'manufacturer', label: 'Manufacturer', sub: 'Manage products & fleets', icon: <PrecisionManufacturingIcon sx={{ fontSize: 20, color: '#2563EB' }} /> },
    { id: 'distributor', label: 'Distributor', sub: 'Manage dealers & devices', icon: <HubOutlinedIcon sx={{ fontSize: 20, color: '#7C3AED' }} /> },
    { id: 'dealer', label: 'Dealer', sub: 'Commission devices & support', icon: <StorefrontOutlinedIcon sx={{ fontSize: 20, color: '#059669' }} /> },
    { id: 'support', label: 'Support Engineer', sub: 'Diagnostics & support', icon: <SupportAgentOutlinedIcon sx={{ fontSize: 20, color: '#D97706' }} /> }
  ];

  async function handleSendOtp() {
    if (!phone.trim()) {
      showToast('Please enter your mobile phone number first', true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await sendSmsOtp(phone.trim());
      setOtpRequested(true);
      if (data.dev_otp) {
        setDevOtpNotice(`[Dev test OTP: ${data.dev_otp}]`);
        setOtp(data.dev_otp);
      } else {
        setDevOtpNotice(`SMS/WhatsApp OTP sent to ${phone.trim()}`);
      }
      showToast(`Verification code sent to ${phone.trim()}`);
    } catch (err: any) {
      showToast(err.message || 'OTP request failed', true);
      setError(err.message || 'OTP request failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result =
        mode === 'password'
          ? await loginWithPassword(phone.trim(), password.trim())
          : await verifyOtp(phone.trim(), otp.trim());

      if (isMfaRequired(result)) {
        setMfaToken(result.mfa_token);
        setMfaCode(DEV_HELPERS ? '123456' : '');
        return;
      }
      handleAuthResult(result);
      showToast(`Authenticated session active: ${result.user.full_name}`);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError('');
    setBusy(true);
    try {
      const result = await verifyMfa(mfaToken, mfaCode.trim());
      handleAuthResult(result);
      showToast(`Authenticated session active: ${result.user.full_name}`);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Incorrect verification code. Check your authenticator app and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ width: '100%', maxWidth: 460, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ mb: 3.5 }}>
        <Typography
          variant="h4"
          sx={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 800,
            color: '#0F172A',
            fontSize: { xs: '1.75rem', sm: '2rem' },
            letterSpacing: '-0.02em',
            mb: 0.75
          }}
        >
          Welcome Back
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.92rem' }}>
          Sign in to AgriPump SmartSpace
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
          {error}
        </Alert>
      )}

      {/* MFA Challenge View */}
      {mfaToken ? (
        <form onSubmit={handleMfaSubmit}>
          <Stack spacing={2.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                bgcolor: '#EFF6FF',
                display: 'grid',
                placeItems: 'center',
                color: '#2563EB'
              }}
            >
              <ShieldOutlinedIcon sx={{ fontSize: 32 }} />
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 700, color: '#0F172A' }}>
              Two-Factor Authentication
            </Typography>
            <Typography variant="body2" sx={{ color: '#64748B', maxWidth: 360 }}>
              Enter the 6-digit verification code from your authenticator application.
            </Typography>
            {DEV_HELPERS && (
              <Box sx={{ p: 1.5, bgcolor: '#EFF6FF', borderRadius: 2, border: '1px solid #BFDBFE', width: '100%' }}>
                <Typography sx={{ fontSize: '0.8rem', color: '#1E40AF', fontWeight: 600 }}>
                  💡 Dev Testing: Code <strong>123456</strong> or your Authenticator App TOTP code is accepted.
                </Typography>
              </Box>
            )}
            <TextField
              label="Authenticator Code"
              placeholder="123456"
              value={mfaCode}
              onChange={e => setMfaCode(e.target.value)}
              fullWidth
              autoFocus
              slotProps={{
                htmlInput: {
                  maxLength: 6,
                  style: { letterSpacing: 6, fontWeight: 700, textAlign: 'center', fontSize: '1.25rem' }
                }
              }}
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              fullWidth
              disabled={busy || mfaCode.trim().length !== 6}
              sx={{ py: 1.3, borderRadius: 2, fontWeight: 700, textTransform: 'none' }}
            >
              Verify Code
            </Button>
            <Link
              component="button"
              type="button"
              variant="body2"
              onClick={() => {
                setMfaToken(null);
                setMfaCode('');
                setError('');
              }}
              sx={{ color: '#2563EB', fontWeight: 600 }}
            >
              ← Back to sign in
            </Link>
          </Stack>
        </form>
      ) : (
        /* Regular Login Form */
        <form onSubmit={handleSubmit}>
          <Stack spacing={2.5}>
            {/* Mobile Number with India +91 prefix */}
            <Box>
              <Typography sx={{ fontSize: '0.84rem', fontWeight: 600, color: '#334155', mb: 0.75 }}>
                Mobile Number
              </Typography>
              <TextField
                placeholder="98765 43210"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                fullWidth
                required
                type="tel"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pr: 1, borderRight: '1px solid #CBD5E1' }}>
                          <span style={{ fontSize: '1.1rem' }}>🇮🇳</span>
                          <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, color: '#0F172A' }}>
                            +91
                          </Typography>
                        </Box>
                      </InputAdornment>
                    ),
                    sx: { borderRadius: 2.2, bgcolor: '#FFFFFF' }
                  }
                }}
              />
            </Box>

            {/* Password Login Mode */}
            {mode === 'password' && (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                  <Typography sx={{ fontSize: '0.84rem', fontWeight: 600, color: '#334155' }}>
                    Password
                  </Typography>
                  <Link
                    component="button"
                    type="button"
                    variant="caption"
                    onClick={() => setForgotPasswordOpen(true)}
                    sx={{ color: '#2563EB', fontWeight: 600, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                  >
                    Forgot password?
                  </Link>
                </Box>
                <TextField
                  placeholder="Enter your password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  fullWidth
                  required
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton onClick={() => setShowPassword(p => !p)} edge="end" size="small">
                            {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                          </IconButton>
                        </InputAdornment>
                      ),
                      sx: { borderRadius: 2.2, bgcolor: '#FFFFFF' }
                    }
                  }}
                />
              </Box>
            )}

            {/* OTP Mode */}
            {mode === 'otp' && (
              <Box>
                <Typography sx={{ fontSize: '0.84rem', fontWeight: 600, color: '#334155', mb: 0.75 }}>
                  6-Digit SMS Verification Code
                </Typography>
                <Stack direction="row" spacing={1.5} sx={{ mb: 1 }}>
                  <TextField
                    placeholder="123456"
                    value={otp}
                    onChange={e => setOtp(e.target.value)}
                    fullWidth
                    slotProps={{
                      htmlInput: {
                        maxLength: 6,
                        style: { letterSpacing: 4, fontWeight: 700, textAlign: 'center' }
                      },
                      input: { sx: { borderRadius: 2.2, bgcolor: '#FFFFFF' } }
                    }}
                    helperText={devOtpNotice || undefined}
                  />
                  <Button
                    variant="outlined"
                    onClick={handleSendOtp}
                    disabled={busy || !phone.trim()}
                    sx={{
                      whiteSpace: 'nowrap',
                      px: 2.5,
                      borderRadius: 2.2,
                      fontWeight: 700,
                      textTransform: 'none',
                      borderColor: '#CBD5E1',
                      color: '#0F172A'
                    }}
                  >
                    {otpRequested ? 'Resend' : 'Send OTP'}
                  </Button>
                </Stack>
              </Box>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={busy || (mode === 'otp' && !otpRequested)}
              sx={{
                py: 1.35,
                borderRadius: 2.2,
                fontWeight: 700,
                fontSize: '0.95rem',
                bgcolor: '#2563EB',
                textTransform: 'none',
                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)',
                '&:hover': { bgcolor: '#1D4ED8' }
              }}
            >
              {mode === 'password' ? 'Sign In' : 'Verify OTP & Sign In'}
            </Button>

            {/* Divider OR */}
            <Divider sx={{ my: 1 }}>
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#94A3B8' }}>
                OR
              </Typography>
            </Divider>

            {/* Secondary Option: Switch between OTP / Password */}
            {mode === 'password' ? (
              <Button
                variant="outlined"
                size="large"
                startIcon={<SmsOutlinedIcon sx={{ fontSize: 18 }} />}
                onClick={() => setMode('otp')}
                sx={{
                  py: 1.2,
                  borderRadius: 2.2,
                  borderColor: '#CBD5E1',
                  color: '#0F172A',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  textTransform: 'none',
                  '&:hover': { borderColor: '#2563EB', color: '#2563EB', bgcolor: '#F8FAFC' }
                }}
              >
                Sign in with OTP
              </Button>
            ) : (
              <Button
                variant="text"
                onClick={() => setMode('password')}
                sx={{
                  color: '#2563EB',
                  fontWeight: 600,
                  fontSize: '0.88rem',
                  textTransform: 'none'
                }}
              >
                ← Sign in with password instead
              </Button>
            )}

            {/* Information Notice */}
            <Box
              sx={{
                p: 1.75,
                borderRadius: 2,
                bgcolor: '#F0F9FF',
                border: '1px solid #BAE6FD',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1.25,
                mt: 0.5
              }}
            >
              <InfoOutlinedIcon sx={{ color: '#0284C7', fontSize: 20, mt: '2px', flexShrink: 0 }} />
              <Typography sx={{ fontSize: '0.82rem', color: '#0369A1', lineHeight: 1.45 }}>
                {mode === 'password'
                  ? 'Use your registered mobile number and password to access your platform account.'
                  : 'A 6-digit SMS one-time passcode will be delivered to your registered mobile number.'}
              </Typography>
            </Box>
          </Stack>
        </form>
      )}

      {/* Quick Test Accounts for instant role validation - development builds only */}
      {DEV_HELPERS && (
        <Box sx={{ mt: 3, p: 2, bgcolor: '#F8FAFC', borderRadius: 2.5, border: '1px solid #E2E8F0' }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B', mb: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Quick Test Accounts (Click to load role):
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {DEMO_ACCOUNTS.map(acc => (
              <Chip
                key={acc.phone}
                label={`${acc.label} (${acc.role})`}
                size="small"
                onClick={() => handleSelectDemoAccount(acc)}
                sx={{
                  bgcolor: phone === acc.phone ? '#EFF6FF' : '#FFFFFF',
                  borderColor: phone === acc.phone ? '#2563EB' : '#CBD5E1',
                  color: phone === acc.phone ? '#2563EB' : '#334155',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  border: '1px solid',
                  cursor: 'pointer',
                  '&:hover': { bgcolor: '#F1F5F9', borderColor: '#2563EB' }
                }}
              />
            ))}
          </Box>
          <Typography sx={{ fontSize: '0.72rem', color: '#94A3B8', mt: 1 }}>
            Default Password: <strong>Admin@123</strong> &bull; OTP: <strong>123456</strong>
          </Typography>
        </Box>
      )}

      {/* Bottom Section: New to AgriPump? Role Preview Row */}
      <Box sx={{ mt: 4, pt: 3, borderTop: '1px solid #E2E8F0' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', color: '#0F172A' }}>
              New to AgriPump SmartSpace?
            </Typography>
            <Typography sx={{ fontSize: '0.78rem', color: '#64748B' }}>
              Create an account based on your role.
            </Typography>
          </Box>
          <Button
            variant="text"
            size="small"
            onClick={onSwitchToRegister}
            endIcon={<ArrowForwardIcon sx={{ fontSize: 16 }} />}
            sx={{ fontWeight: 700, fontSize: '0.84rem', color: '#2563EB', textTransform: 'none' }}
          >
            Create Account
          </Button>
        </Box>

        {/* Role cards: as many per row as fit (five side by side on a wide form, two or three on a phone) */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))',
            gap: 1
          }}
        >
          {quickRoles.map(r => (
            <Box
              key={r.id}
              onClick={() => {
                if (onSelectRole) onSelectRole(r.id);
                else onSwitchToRegister();
              }}
              sx={{
                p: 1.2,
                borderRadius: 2,
                bgcolor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 0.5,
                minWidth: 0,
                '&:hover': {
                  borderColor: '#2563EB',
                  bgcolor: '#EFF6FF',
                  transform: 'translateY(-2px)'
                }
              }}
            >
              <Box sx={{ display: 'grid', placeItems: 'center' }}>{r.icon}</Box>
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#0F172A', lineHeight: 1.1 }}>
                {r.label}
              </Typography>
              <Typography
                sx={{
                  fontSize: '0.62rem',
                  color: '#64748B',
                  lineHeight: 1.15,
                  display: { xs: 'none', lg: 'block' }
                }}
              >
                {r.sub}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Forgot password: a real reset (WhatsApp code, then a new password) */}
      <ResetPasswordDialog
        open={forgotPasswordOpen}
        onClose={() => setForgotPasswordOpen(false)}
        initialPhone={phone}
        onDone={resetPhone => {
          setForgotPasswordOpen(false);
          setPhone(resetPhone);
          setPassword('');
          setMode('password');
          setError('');
          showToast('Password updated. Sign in with your new password.');
        }}
      />
    </Box>
  );
};
