import React from 'react';
import { Box, Card, CardActionArea, CardContent, Link, Typography } from '@mui/material';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import WarehouseOutlinedIcon from '@mui/icons-material/WarehouseOutlined';
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useNavigate } from 'react-router-dom';

const ROLES = [
  { key: 'admin', title: 'Admin', icon: <AdminPanelSettingsOutlinedIcon />, text: 'A manufacturer, such as Ajanta or Swati. Sign in with your email and a code we send to it.' },
  { key: 'distributor', title: 'Distributor', icon: <WarehouseOutlinedIcon />, text: 'Sign in with your mobile number and password.' },
  { key: 'dealer', title: 'Dealer', icon: <StorefrontOutlinedIcon />, text: 'Sign in with your mobile number and password.' }
];

/** After the Login button: who are you? Each choice opens that kind of person's sign-in. */
export const RoleChooser: React.FC = () => {
  const navigate = useNavigate();
  return (
    <Box sx={{ width: '100%', maxWidth: 460, mx: 'auto' }}>
      <Typography variant="h4" sx={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, color: '#0F172A', fontSize: { xs: '1.75rem', sm: '2rem' }, letterSpacing: '-0.02em', mb: 0.75 }}>
        Who are you?
      </Typography>
      <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.92rem', mb: 3 }}>
        Choose one, then sign in with your own details.
      </Typography>

      <Box sx={{ display: 'grid', gap: 1.75 }}>
        {ROLES.map(r => (
          <Card key={r.key} variant="outlined" sx={{ borderRadius: 3, borderColor: '#E2E8F0' }}>
            <CardActionArea data-testid={`role-${r.key}`} onClick={() => navigate(`/login/${r.key}`)}>
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2.5 }}>
                <Box sx={{ width: 48, height: 48, flexShrink: 0, borderRadius: 2.5, bgcolor: '#E4F5EA', color: '#0B7A3E', display: 'grid', placeItems: 'center' }}>{r.icon}</Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700 }}>{r.title}</Typography>
                  <Typography sx={{ color: '#64748B', fontSize: '0.85rem', lineHeight: 1.45 }}>{r.text}</Typography>
                </Box>
                <ChevronRightIcon sx={{ color: '#94A3B8' }} />
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Box>

      <Typography sx={{ color: '#64748B', fontSize: '0.84rem', mt: 3 }} data-testid="farmer-hint">
        Farmers use the mobile app: ask your dealer for your QR code.
      </Typography>
      <Link component="button" type="button" variant="body2" onClick={() => navigate('/')} data-testid="back-home" sx={{ color: '#0B7A3E', fontWeight: 600, mt: 2 }}>
        ← Back to the home page
      </Link>
    </Box>
  );
};
