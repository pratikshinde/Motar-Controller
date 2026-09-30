import React from 'react';
import { Box, Container, Typography, Button, Stack } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useNavigate } from 'react-router-dom';

interface FinalCTAProps {
  onOpenGetStarted: () => void;
}

export const FinalCTA: React.FC<FinalCTAProps> = ({ onOpenGetStarted }) => {
  const navigate = useNavigate();

  return (
    <Box
      id="about"
      sx={{
        py: { xs: 8, md: 12 },
        bgcolor: '#0B1528',
        color: '#FFFFFF',
        position: 'relative',
        overflow: 'hidden',
        backgroundImage: `
          radial-gradient(circle at 20% 30%, rgba(37, 99, 235, 0.18) 0%, transparent 50%),
          radial-gradient(circle at 80% 70%, rgba(5, 150, 105, 0.16) 0%, transparent 50%)
        `
      }}
    >
      <Container maxWidth="md" sx={{ textAlign: 'center', position: 'relative', zIndex: 1, px: { xs: 2.5, sm: 4 } }}>
        <Typography
          variant="h2"
          sx={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 800,
            fontSize: { xs: '2.1rem', sm: '2.8rem', md: '3.4rem' },
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
            mb: 2.5
          }}
        >
          Take control of every pump <br />
          from one smart platform.
        </Typography>

        <Typography
          sx={{
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontSize: { xs: '1rem', sm: '1.15rem' },
            color: '#94A3B8',
            maxWidth: 600,
            mx: 'auto',
            mb: { xs: 4, sm: 5 },
            lineHeight: 1.6
          }}
        >
          Monitor your fleet, respond to faults and manage connected pump operations from anywhere.
        </Typography>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'center', alignItems: 'center' }}
        >
          <Button
            variant="contained"
            size="large"
            onClick={onOpenGetStarted}
            endIcon={<ArrowForwardIcon />}
            sx={{
              bgcolor: '#2563EB',
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: '1rem',
              borderRadius: 2.5,
              px: 4,
              py: 1.6,
              textTransform: 'none',
              boxShadow: '0 12px 24px -6px rgba(37, 99, 235, 0.45)',
              '&:hover': {
                bgcolor: '#1D4ED8',
                boxShadow: '0 16px 32px -6px rgba(37, 99, 235, 0.6)'
              }
            }}
          >
            Get Started →
          </Button>

          <Button
            variant="outlined"
            size="large"
            onClick={() => navigate('/login')}
            sx={{
              color: '#FFFFFF',
              borderColor: 'rgba(255, 255, 255, 0.3)',
              fontWeight: 700,
              fontSize: '1rem',
              borderRadius: 2.5,
              px: 4,
              py: 1.6,
              textTransform: 'none',
              borderWidth: 1.5,
              '&:hover': {
                borderColor: '#FFFFFF',
                bgcolor: 'rgba(255, 255, 255, 0.08)',
                borderWidth: 1.5
              }
            }}
          >
            Login
          </Button>
        </Stack>
      </Container>
    </Box>
  );
};
