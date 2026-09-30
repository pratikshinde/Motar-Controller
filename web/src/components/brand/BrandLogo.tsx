import React from 'react';
import { Box, Typography } from '@mui/material';

interface BrandLogoProps {
  size?: 'small' | 'medium' | 'large';
  light?: boolean;
  withTagline?: boolean;
  onClick?: () => void;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'medium',
  light = false,
  withTagline = false,
  onClick
}) => {
  const iconSizes = {
    small: { w: 28, h: 28, svg: 28 },
    medium: { w: 36, h: 36, svg: 36 },
    large: { w: 46, h: 46, svg: 46 }
  };

  const textSizes = {
    small: { title: '1.05rem', tagline: '0.65rem' },
    medium: { title: '1.3rem', tagline: '0.72rem' },
    large: { title: '1.65rem', tagline: '0.82rem' }
  };

  const { w, h, svg } = iconSizes[size];
  const { title, tagline } = textSizes[size];

  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1.25,
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        textDecoration: 'none'
      }}
    >
      {/* Brand Icon: Smart Agriculture Droplet with embedded Sprout / Leaf */}
      <Box
        sx={{
          width: w,
          height: h,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}
      >
        <svg
          width={svg}
          height={svg}
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="dropGrad" x1="6" y1="4" x2="34" y2="36" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#38BDF8" />
              <stop offset="50%" stopColor="#2563EB" />
              <stop offset="100%" stopColor="#1D4ED8" />
            </linearGradient>
            <linearGradient id="leafGrad" x1="14" y1="12" x2="30" y2="34" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#34D399" />
              <stop offset="60%" stopColor="#10B981" />
              <stop offset="100%" stopColor="#059669" />
            </linearGradient>
            <filter id="subtleGlow" x="0" y="0" width="40" height="40" filterUnits="userSpaceOnUse">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#2563EB" floodOpacity="0.25" />
            </filter>
          </defs>

          {/* Droplet Outline / Body */}
          <path
            d="M20 3.5C20 3.5 8 18 8 26C8 32.6274 13.3726 38 20 38C26.6274 38 32 32.6274 32 26C32 18 20 3.5 20 3.5Z"
            fill="url(#dropGrad)"
            filter="url(#subtleGlow)"
          />

          {/* Inner Agricultural Leaf / Sprout Contour */}
          <path
            d="M20 14C17.5 19 12 23 12 28C12 32.4183 15.5817 36 20 36C22.5 36 25 34.5 26.5 32.5C24 31 22 28.5 22 25C22 20.5 25.5 17 28 16C25.5 14.5 22 13.5 20 14Z"
            fill="url(#leafGrad)"
          />

          {/* Telemetry Wave / Ripple Accent */}
          <path
            d="M17 24C18 23 20 23 21 24C22 25 24 25 25 24"
            stroke="#FFFFFF"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeOpacity="0.85"
          />
        </svg>
      </Box>

      {/* Brand Typography */}
      <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
        <Typography
          component="span"
          sx={{
            fontFamily: "'Space Grotesk', 'Plus Jakarta Sans', sans-serif",
            fontWeight: 800,
            fontSize: title,
            letterSpacing: '-0.02em',
            display: 'flex',
            alignItems: 'center',
            gap: '3px'
          }}
        >
          <Box
            component="span"
            sx={{
              color: light ? '#FFFFFF' : '#0F172A',
              fontWeight: 800
            }}
          >
            AgriPump
          </Box>
          <Box
            component="span"
            sx={{
              color: '#2563EB',
              fontWeight: 700
            }}
          >
            SmartSpace
          </Box>
        </Typography>

        {withTagline && (
          <Typography
            component="span"
            sx={{
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontSize: tagline,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: light ? 'rgba(255,255,255,0.7)' : '#64748B',
              mt: '2px'
            }}
          >
            Connect • Monitor • Control • Grow
          </Typography>
        )}
      </Box>
    </Box>
  );
};
