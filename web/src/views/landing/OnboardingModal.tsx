import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  IconButton,
  Button,
  TextField,
  Stack,
  Card,
  CardActionArea,
  Fade,
  Alert
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import BuildIcon from '@mui/icons-material/Build';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import KeyIcon from '@mui/icons-material/Key';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useNavigate } from 'react-router-dom';
import { BrandLogo } from '../../components/brand/BrandLogo';

interface OnboardingModalProps {
  open: boolean;
  onClose: () => void;
}

type UserRole = 'farmer' | 'dealer' | 'oem';

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const [selectedRole, setSelectedRole] = useState<UserRole>('farmer');
  const [inviteCode, setInviteCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleRoleSelect = (role: UserRole) => {
    setSelectedRole(role);
  };

  const handleRedeemInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (inviteCode.trim()) {
      onClose();
      navigate(`/invite/${encodeURIComponent(inviteCode.trim())}`);
    }
  };

  const handleDemoRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (fullName && phone) {
      setSubmitted(true);
    }
  };

  const handleReset = () => {
    setSubmitted(false);
    setInviteCode('');
    setFullName('');
    setPhone('');
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleReset}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 3.5,
            p: { xs: 1, sm: 2 },
            boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
            border: '1px solid rgba(226, 232, 240, 0.8)'
          }
        }
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <BrandLogo size="small" />
        <IconButton onClick={handleReset} size="small" sx={{ color: 'text.secondary' }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        {submitted ? (
          <Fade in>
            <Box sx={{ textAlign: 'center', py: 4, px: 2 }}>
              <Box
                sx={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  bgcolor: '#ECFDF5',
                  color: '#059669',
                  display: 'grid',
                  placeItems: 'center',
                  mx: 'auto',
                  mb: 2.5
                }}
              >
                <CheckCircleIcon sx={{ fontSize: 38 }} />
              </Box>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#0F172A', mb: 1 }}>
                Onboarding Request Received
              </Typography>
              <Typography variant="body2" sx={{ color: '#64748B', maxWidth: 420, mx: 'auto', mb: 3 }}>
                Thank you, <strong>{fullName}</strong>. Our agri-IoT deployment team will reach out at{' '}
                <strong>{phone}</strong> within 24 hours to set up your device allocation.
              </Typography>
              <Button variant="contained" onClick={handleReset} sx={{ px: 4, py: 1.25, borderRadius: 2 }}>
                Return to Home
              </Button>
            </Box>
          </Fade>
        ) : (
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 800, color: '#0F172A', mb: 0.75 }}>
              Get Started with AgriPump SmartSpace
            </Typography>
            <Typography variant="body2" sx={{ color: '#64748B', mb: 3 }}>
              Select your role in the agricultural ecosystem to configure your connected experience.
            </Typography>

            {/* Role Selection Cards */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 3 }}>
              <Card
                variant="outlined"
                elevation={0}
                sx={{
                  flex: 1,
                  borderRadius: 2.5,
                  borderColor: selectedRole === 'farmer' ? '#2563EB' : 'divider',
                  bgcolor: selectedRole === 'farmer' ? '#EFF6FF' : 'background.paper',
                  transition: 'all 0.2s ease',
                  borderWidth: selectedRole === 'farmer' ? 2 : 1
                }}
              >
                <CardActionArea onClick={() => handleRoleSelect('farmer')} sx={{ p: 1.75, height: '100%' }}>
                  <AgricultureIcon sx={{ color: selectedRole === 'farmer' ? '#2563EB' : '#64748B', mb: 1, fontSize: 28 }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#0F172A' }}>
                    Farmer
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mt: 0.5, lineHeight: 1.3 }}>
                    Monitor & control field pump
                  </Typography>
                </CardActionArea>
              </Card>

              <Card
                variant="outlined"
                elevation={0}
                sx={{
                  flex: 1,
                  borderRadius: 2.5,
                  borderColor: selectedRole === 'dealer' ? '#2563EB' : 'divider',
                  bgcolor: selectedRole === 'dealer' ? '#EFF6FF' : 'background.paper',
                  transition: 'all 0.2s ease',
                  borderWidth: selectedRole === 'dealer' ? 2 : 1
                }}
              >
                <CardActionArea onClick={() => handleRoleSelect('dealer')} sx={{ p: 1.75, height: '100%' }}>
                  <BuildIcon sx={{ color: selectedRole === 'dealer' ? '#2563EB' : '#64748B', mb: 1, fontSize: 26 }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#0F172A' }}>
                    Dealer / Installer
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mt: 0.5, lineHeight: 1.3 }}>
                    Commission & maintain pumps
                  </Typography>
                </CardActionArea>
              </Card>

              <Card
                variant="outlined"
                elevation={0}
                sx={{
                  flex: 1,
                  borderRadius: 2.5,
                  borderColor: selectedRole === 'oem' ? '#2563EB' : 'divider',
                  bgcolor: selectedRole === 'oem' ? '#EFF6FF' : 'background.paper',
                  transition: 'all 0.2s ease',
                  borderWidth: selectedRole === 'oem' ? 2 : 1
                }}
              >
                <CardActionArea onClick={() => handleRoleSelect('oem')} sx={{ p: 1.75, height: '100%' }}>
                  <PrecisionManufacturingIcon sx={{ color: selectedRole === 'oem' ? '#2563EB' : '#64748B', mb: 1, fontSize: 26 }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#0F172A' }}>
                    Manufacturer / OEM
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mt: 0.5, lineHeight: 1.3 }}>
                    Fleet & FOTA administration
                  </Typography>
                </CardActionArea>
              </Card>
            </Stack>

            <Button
              variant="contained"
              fullWidth
              onClick={() => {
                onClose();
                navigate(`/auth/register/phone?role=${selectedRole === 'farmer' ? 'customer' : selectedRole}`);
              }}
              sx={{ mb: 3, py: 1.3, fontWeight: 700, borderRadius: 2, bgcolor: '#2563EB', textTransform: 'none', boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)' }}
            >
              Register via WhatsApp for this role &rarr;
            </Button>
            <Box
              sx={{
                p: 2,
                borderRadius: 2.5,
                bgcolor: '#F8FAFC',
                border: '1px dashed #CBD5E1',
                mb: 3
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <KeyIcon sx={{ fontSize: 18, color: '#2563EB' }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#1E293B' }}>
                  Have an Onboarding Invite Code?
                </Typography>
              </Box>
              <Typography variant="caption" sx={{ color: '#64748B', display: 'block', mb: 1.5 }}>
                Enter the secret code or token provided by your dealer or fleet administrator:
              </Typography>
              <form onSubmit={handleRedeemInvite}>
                <Stack direction="row" spacing={1}>
                  <TextField
                    size="small"
                    placeholder="e.g. inv_8294abc1"
                    value={inviteCode}
                    onChange={e => setInviteCode(e.target.value)}
                    fullWidth
                    sx={{ bgcolor: '#FFFFFF', borderRadius: 1 }}
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    disabled={!inviteCode.trim()}
                    sx={{ px: 2.5, whiteSpace: 'nowrap', textTransform: 'none', fontWeight: 700 }}
                  >
                    Activate Code
                  </Button>
                </Stack>
              </form>
            </Box>

            {/* Or Pilot / Demo Request */}
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#1E293B', mb: 1.5 }}>
              Or Request Platform Access
            </Typography>
            <form onSubmit={handleDemoRequest}>
              <Stack spacing={2}>
                <TextField
                  size="small"
                  label="Full Name"
                  placeholder="e.g. Ramesh Patel"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  required
                  fullWidth
                />
                <TextField
                  size="small"
                  label="Mobile Number (E.164 format)"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  required
                  fullWidth
                  type="tel"
                />
                <Button
                  type="submit"
                  variant="outlined"
                  size="large"
                  endIcon={<ArrowForwardIcon />}
                  sx={{
                    fontWeight: 700,
                    textTransform: 'none',
                    borderRadius: 2,
                    py: 1.2
                  }}
                >
                  Submit Access Request
                </Button>
              </Stack>
            </form>

            {/* Sign in footer link */}
            <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid #F1F5F9', textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: '#64748B' }}>
                Already registered with AgriPump?{' '}
                <Button
                  variant="text"
                  onClick={() => {
                    onClose();
                    navigate('/login');
                  }}
                  sx={{ fontWeight: 700, textTransform: 'none', color: '#2563EB', p: 0, minWidth: 0 }}
                >
                  Log in to your Dashboard
                </Button>
              </Typography>
            </Box>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};
