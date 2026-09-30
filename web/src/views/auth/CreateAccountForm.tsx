import React, { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardActionArea,
  Button,
  Stack,
  TextField,
  Alert,
  Divider,
  InputAdornment,
  Collapse
} from '@mui/material';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import KeyIcon from '@mui/icons-material/Key';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircle';
import { useNavigate } from 'react-router-dom';
import { sendSmsOtp, verifyOtp } from '../../api/auth';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { isMfaRequired } from '../../types';

interface CreateAccountFormProps {
  onSwitchToLogin: () => void;
  initialRole?: string | null;
}

type RoleId = 'superadmin' | 'manufacturer' | 'distributor' | 'dealer' | 'support' | 'farmer';

export const CreateAccountForm: React.FC<CreateAccountFormProps> = ({
  onSwitchToLogin,
  initialRole = null
}) => {
  const navigate = useNavigate();
  const { handleAuthResult } = useAuth();
  const { showToast } = useToast();

  const [selectedRole, setSelectedRole] = useState<RoleId | null>((initialRole as RoleId) || null);
  const [inviteToken, setInviteToken] = useState('');

  // Farmer phone OTP activation states
  const [farmerPhone, setFarmerPhone] = useState('');
  const [farmerOtp, setFarmerOtp] = useState('');
  const [farmerOtpSent, setFarmerOtpSent] = useState(false);
  const [devOtpNotice, setDevOtpNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const roles = [
    {
      id: 'superadmin' as RoleId,
      name: 'Superadmin / OEM',
      desc: 'Platform administration and global fleet management',
      access: 'Web Console',
      badge: 'Root Authority',
      controlled: true,
      creationNote: 'Provisioned exclusively by system infrastructure administrator.',
      icon: <AdminPanelSettingsOutlinedIcon sx={{ fontSize: 26, color: '#475569' }} />,
      bg: '#F1F5F9'
    },
    {
      id: 'manufacturer' as RoleId,
      name: 'Panel Manufacturer',
      desc: 'Manage panels, devices, allocations and fleet operations',
      access: 'Web Console',
      badge: 'Tier 1 Enterprise',
      controlled: true,
      creationNote: 'Controlled & invitation-based onboarding via OEM administrator.',
      icon: <PrecisionManufacturingIcon sx={{ fontSize: 26, color: '#2563EB' }} />,
      bg: '#EFF6FF'
    },
    {
      id: 'distributor' as RoleId,
      name: 'Regional Distributor',
      desc: 'Manage regional devices, dealers and allocations',
      access: 'Web Console',
      badge: 'Tier 2 Channel',
      controlled: true,
      creationNote: 'Created and invited by an authorised Panel Manufacturer.',
      icon: <HubOutlinedIcon sx={{ fontSize: 26, color: '#7C3AED' }} />,
      bg: '#F5F3FF'
    },
    {
      id: 'dealer' as RoleId,
      name: 'Dealer / Installer',
      desc: 'Commission devices, configure systems and support customers',
      access: 'Web & Mobile',
      badge: 'Tier 3 (L1–L6)',
      controlled: true,
      creationNote: 'Created and invited by an authorised Distributor or parent Dealer.',
      icon: <StorefrontOutlinedIcon sx={{ fontSize: 26, color: '#059669' }} />,
      bg: '#ECFDF5'
    },
    {
      id: 'support' as RoleId,
      name: 'Support Engineer',
      desc: 'Diagnostics, support and remote assistance',
      access: 'Operational',
      badge: 'Operations',
      controlled: true,
      creationNote: 'Requires platform administrator invitation and security credential approval.',
      icon: <SupportAgentOutlinedIcon sx={{ fontSize: 26, color: '#D97706' }} />,
      bg: '#FFFBEB'
    },
    {
      id: 'farmer' as RoleId,
      name: 'End User / Farmer',
      desc: 'Monitor pumps, receive alerts and control connected devices',
      access: 'Mobile & SMS',
      badge: 'Customer',
      controlled: false,
      creationNote: 'Activated during device commissioning or customer mobile onboarding.',
      icon: <AgricultureIcon sx={{ fontSize: 26, color: '#059669' }} />,
      bg: '#ECFDF5'
    }
  ];

  const currentRole = roles.find(r => r.id === selectedRole);

  const handleRedeemInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (inviteToken.trim()) {
      navigate(`/invite/${encodeURIComponent(inviteToken.trim())}`);
    }
  };

  const handleSendFarmerOtp = async () => {
    if (!farmerPhone.trim()) {
      showToast('Enter your mobile number first', true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await sendSmsOtp(farmerPhone.trim());
      setFarmerOtpSent(true);
      if (data.dev_otp) {
        setDevOtpNotice(`[Dev test OTP: ${data.dev_otp}]`);
        setFarmerOtp(data.dev_otp);
      } else {
        setDevOtpNotice(`OTP sent to ${farmerPhone.trim()}`);
      }
      showToast(`Verification challenge sent to ${farmerPhone.trim()}`);
    } catch (err: any) {
      setError(err.message || 'OTP delivery failed');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyFarmerOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await verifyOtp(farmerPhone.trim(), farmerOtp.trim());
      if (isMfaRequired(result)) {
        onSwitchToLogin();
        return;
      }
      handleAuthResult(result);
      showToast(`Customer account active: ${result.user.full_name}`);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ width: '100%', maxWidth: 500, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography
          variant="h4"
          sx={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 800,
            color: '#0F172A',
            fontSize: { xs: '1.7rem', sm: '1.95rem' },
            letterSpacing: '-0.02em',
            mb: 0.75
          }}
        >
          {selectedRole ? currentRole?.name : 'Create your account'}
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.92rem' }}>
          {selectedRole
            ? 'Enterprise hierarchy & onboarding procedure'
            : 'Select the account type that matches your organisation.'}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }}>
          {error}
        </Alert>
      )}

      {/* STEP 1: ROLE SELECTION CARDS */}
      {!selectedRole && (
        <Stack spacing={1.5} sx={{ mb: 3 }}>
          {roles.map(r => (
            <Card
              key={r.id}
              variant="outlined"
              sx={{
                borderRadius: 2.5,
                borderColor: '#E2E8F0',
                bgcolor: '#FFFFFF',
                transition: 'all 0.2s ease',
                '&:hover': {
                  borderColor: '#2563EB',
                  bgcolor: '#F8FAFC',
                  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.05)'
                }
              }}
            >
              <CardActionArea
                onClick={() => setSelectedRole(r.id)}
                sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: 2,
                      bgcolor: r.bg,
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0
                    }}
                  >
                    {r.icon}
                  </Box>
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#0F172A' }}>
                        {r.name}
                      </Typography>
                      {r.controlled && (
                        <Box
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 0.5,
                            px: 1,
                            py: 0.2,
                            borderRadius: 1,
                            bgcolor: '#F1F5F9',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            color: '#64748B'
                          }}
                        >
                          <LockOutlinedIcon sx={{ fontSize: 11 }} /> Controlled
                        </Box>
                      )}
                    </Box>
                    <Typography sx={{ fontSize: '0.8rem', color: '#64748B', lineHeight: 1.3 }}>
                      {r.desc}
                    </Typography>
                  </Box>
                </Box>
                <ArrowForwardIcon sx={{ fontSize: 18, color: '#94A3B8', ml: 1, flexShrink: 0 }} />
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      )}

      {/* STEP 2: SELECTED ROLE ONBOARDING / INVITATION HANDLER */}
      {selectedRole && currentRole && (
        <Box>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={() => {
              setSelectedRole(null);
              setError('');
            }}
            size="small"
            sx={{ mb: 2.5, color: '#64748B', fontWeight: 600, textTransform: 'none' }}
          >
            ← Choose a different account type
          </Button>

          {/* Role Specification Card */}
          <Box
            sx={{
              p: 2.5,
              borderRadius: 2.5,
              bgcolor: currentRole.bg,
              border: '1px solid #E2E8F0',
              mb: 3
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
              {currentRole.icon}
              <Box>
                <Typography sx={{ fontWeight: 800, color: '#0F172A', fontSize: '1.05rem' }}>
                  {currentRole.name}
                </Typography>
                <Typography sx={{ fontSize: '0.78rem', color: '#475569' }}>
                  Hierarchy Level: <strong>{currentRole.badge}</strong> &bull; Access: {currentRole.access}
                </Typography>
              </Box>
            </Box>
            <Typography sx={{ fontSize: '0.86rem', color: '#334155', lineHeight: 1.5, mt: 1 }}>
              {currentRole.creationNote}
            </Typography>
          </Box>

          {/* Case A: Superadmin */}
          {selectedRole === 'superadmin' && (
            <Box sx={{ p: 3, borderRadius: 2.5, bgcolor: '#F8FAFC', border: '1px solid #E2E8F0', textAlign: 'center' }}>
              <AdminPanelSettingsOutlinedIcon sx={{ fontSize: 48, color: '#64748B', mb: 1.5 }} />
              <Typography variant="h6" sx={{ fontWeight: 800, color: '#0F172A', mb: 1 }}>
                Public Registration Prohibited
              </Typography>
              <Typography variant="body2" sx={{ color: '#64748B', lineHeight: 1.6, maxWidth: 380, mx: 'auto', mb: 3 }}>
                Superadmin and OEM root administrative accounts are provisioned exclusively during
                infrastructure deployment. To access your console, sign in with your authorised credentials.
              </Typography>
              <Button
                variant="contained"
                onClick={onSwitchToLogin}
                sx={{ fontWeight: 700, borderRadius: 2, px: 3, textTransform: 'none' }}
              >
                Return to Sign In
              </Button>
            </Box>
          )}

          {/* Case B: Controlled Roles (Manufacturer, Distributor, Dealer, Support) */}
          {(selectedRole === 'manufacturer' ||
            selectedRole === 'distributor' ||
            selectedRole === 'dealer' ||
            selectedRole === 'support') && (
            <Stack spacing={2.5}>
              <Box
                sx={{
                  p: 2.5,
                  borderRadius: 2.5,
                  bgcolor: '#FFFFFF',
                  border: '1px dashed #2563EB',
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.04)'
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <KeyIcon sx={{ color: '#2563EB', fontSize: 20 }} />
                  <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: '#0F172A' }}>
                    Have an Organisation Invitation Code?
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: '0.82rem', color: '#64748B', mb: 2 }}>
                  Enter the secure token or link code provided by your parent administrator:
                </Typography>
                <form onSubmit={handleRedeemInvite}>
                  <Stack direction="row" spacing={1}>
                    <TextField
                      size="small"
                      placeholder="e.g. inv_8294abc1"
                      value={inviteToken}
                      onChange={e => setInviteToken(e.target.value)}
                      fullWidth
                      required
                      sx={{ bgcolor: '#FFFFFF' }}
                    />
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={!inviteToken.trim()}
                      sx={{ px: 2.5, fontWeight: 700, textTransform: 'none', whiteSpace: 'nowrap', borderRadius: 1.5 }}
                    >
                      Redeem
                    </Button>
                  </Stack>
                </form>
              </Box>

              {/* Hierarchy Notice & What to do if no invite */}
              <Box sx={{ p: 2, borderRadius: 2, bgcolor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                  <InfoOutlinedIcon sx={{ color: '#64748B', fontSize: 18, mt: '2px' }} />
                  <Box>
                    <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155', mb: 0.25 }}>
                      Don&apos;t have an invitation yet?
                    </Typography>
                    <Typography sx={{ fontSize: '0.8rem', color: '#64748B', lineHeight: 1.45 }}>
                      {selectedRole === 'manufacturer' &&
                        'Manufacturer accounts must be authorized by the OEM platform owner.'}
                      {selectedRole === 'distributor' &&
                        'Distributor accounts are provisioned and invited by your manufacturer partner.'}
                      {selectedRole === 'dealer' &&
                        'Dealer accounts are provisioned and invited by your authorized regional distributor.'}
                      {selectedRole === 'support' &&
                        'Support engineer accounts require approval and invitation by operations management.'}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </Stack>
          )}

          {/* Case C: Farmer Customer Onboarding */}
          {selectedRole === 'farmer' && (
            <Stack spacing={2.5}>
              <Box sx={{ p: 2.5, borderRadius: 2.5, bgcolor: '#FFFFFF', border: '1px solid #E2E8F0' }}>
                <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: '#0F172A', mb: 0.5 }}>
                  Farmer Mobile Activation
                </Typography>
                <Typography sx={{ fontSize: '0.84rem', color: '#64748B', mb: 2 }}>
                  Verify your mobile number to view and control your connected pumps:
                </Typography>

                <form onSubmit={handleVerifyFarmerOtp}>
                  <Stack spacing={2}>
                    <Box>
                      <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155', mb: 0.5 }}>
                        Farmer Mobile Number
                      </Typography>
                      <Stack direction="row" spacing={1}>
                        <TextField
                          placeholder="98765 43210"
                          value={farmerPhone}
                          onChange={e => setFarmerPhone(e.target.value)}
                          fullWidth
                          required
                          type="tel"
                          slotProps={{
                            input: {
                              startAdornment: (
                                <InputAdornment position="start">
                                  <span style={{ fontSize: '1rem', marginRight: 4 }}>🇮🇳</span> +91
                                </InputAdornment>
                              )
                            }
                          }}
                        />
                        <Button
                          variant="outlined"
                          onClick={handleSendFarmerOtp}
                          disabled={busy || !farmerPhone.trim()}
                          sx={{ whiteSpace: 'nowrap', px: 2, fontWeight: 700, textTransform: 'none', borderRadius: 1.5 }}
                        >
                          {farmerOtpSent ? 'Resend' : 'Send OTP'}
                        </Button>
                      </Stack>
                    </Box>

                    {farmerOtpSent && (
                      <Box>
                        <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155', mb: 0.5 }}>
                          6-Digit OTP Code
                        </Typography>
                        <TextField
                          placeholder="123456"
                          value={farmerOtp}
                          onChange={e => setFarmerOtp(e.target.value)}
                          fullWidth
                          required
                          helperText={devOtpNotice || undefined}
                          slotProps={{
                            htmlInput: {
                              maxLength: 6,
                              style: { letterSpacing: 4, fontWeight: 700, textAlign: 'center' }
                            }
                          }}
                        />
                        <Button
                          type="submit"
                          variant="contained"
                          fullWidth
                          disabled={busy || farmerOtp.trim().length !== 6}
                          sx={{ mt: 1.5, py: 1.25, fontWeight: 700, textTransform: 'none', borderRadius: 2 }}
                        >
                          Activate &amp; Access Pumps
                        </Button>
                      </Box>
                    )}
                  </Stack>
                </form>
              </Box>

              {/* Or Dealer Invite Token */}
              <Box sx={{ p: 2, borderRadius: 2, bgcolor: '#F8FAFC', border: '1px dashed #CBD5E1' }}>
                <Typography sx={{ fontWeight: 700, fontSize: '0.84rem', color: '#1E293B', mb: 0.5 }}>
                  Did your dealer provide an onboarding token?
                </Typography>
                <Typography sx={{ fontSize: '0.78rem', color: '#64748B', mb: 1.5 }}>
                  Enter the invite code from your installation certificate:
                </Typography>
                <Stack direction="row" spacing={1}>
                  <TextField
                    size="small"
                    placeholder="e.g. inv_8294abc1"
                    value={inviteToken}
                    onChange={e => setInviteToken(e.target.value)}
                    fullWidth
                    sx={{ bgcolor: '#FFFFFF' }}
                  />
                  <Button
                    variant="contained"
                    disabled={!inviteToken.trim()}
                    onClick={handleRedeemInvite}
                    sx={{ px: 2, fontWeight: 700, textTransform: 'none', whiteSpace: 'nowrap' }}
                  >
                    Redeem
                  </Button>
                </Stack>
              </Box>
            </Stack>
          )}
        </Box>
      )}

      {/* Bottom Switch to Login */}
      <Box sx={{ mt: 4, pt: 2.5, borderTop: '1px solid #E2E8F0', textAlign: 'center' }}>
        <Typography variant="body2" sx={{ color: '#64748B' }}>
          Already have an account?{' '}
          <Button
            variant="text"
            onClick={onSwitchToLogin}
            sx={{ fontWeight: 700, color: '#2563EB', textTransform: 'none', p: 0, minWidth: 0 }}
          >
            Sign In here
          </Button>
        </Typography>
      </Box>
    </Box>
  );
};
