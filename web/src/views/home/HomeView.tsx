import React from 'react';
import { Box, Button, Container, IconButton, Link, Tooltip, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import PersonIcon from '@mui/icons-material/Person';
import EnergySavingsLeafIcon from '@mui/icons-material/EnergySavingsLeaf';
import SmartphoneOutlinedIcon from '@mui/icons-material/SmartphoneOutlined';
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import BarChartRoundedIcon from '@mui/icons-material/BarChartRounded';
import QrCode2RoundedIcon from '@mui/icons-material/QrCode2Rounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import PlayCircleFilledWhiteRoundedIcon from '@mui/icons-material/PlayCircleFilledWhiteRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import { useNavigate } from 'react-router-dom';

const NAVY = '#10286B';
const BLUE = '#1D3FA8';
const INK = '#0B1B45';
const MUTED = '#4A5878';
const LINE = '#E3E9F5';
const GREEN = '#2E9B4E';

const NAV = [
  { label: 'Home', href: '#top' },
  { label: 'Features', href: '#features' },
  { label: 'How It Works', href: '#how' },
  { label: 'Benefits', href: '#benefits' }
];

const FEATURES = [
  {
    icon: <SmartphoneOutlinedIcon />,
    title: 'Remote Control',
    text: 'Turn your pump ON/OFF from anywhere.'
  },
  {
    icon: <AccessTimeOutlinedIcon />,
    title: 'Schedule Operation',
    text: 'Set timings for automatic pump control.'
  },
  {
    icon: <WaterDropIcon />,
    title: 'Water & Energy Saving',
    text: 'Use resources efficiently.'
  },
  {
    icon: <BarChartRoundedIcon />,
    title: 'Real-Time Monitoring',
    text: 'Know your pump status instantly.'
  }
];

/** Blue monoblock pump icon for Step 2 ("Control Pump") and the phone mockup. */
const PumpGlyph: React.FC<{ color?: string; size?: number }> = ({ color = BLUE, size = 44 }) => (
  <svg width={size} height={size * 0.78} viewBox="0 0 64 50" fill="none" aria-hidden="true">
    {/* Top terminal box */}
    <rect x="26" y="4" width="14" height="7" rx="2" fill={color} />
    <rect x="29" y="1" width="8" height="3" rx="1" fill={color} />
    {/* Main motor body */}
    <rect x="16" y="11" width="34" height="24" rx="5" fill={color} />
    {/* Cooling fins */}
    <line x1="21" y1="16" x2="45" y2="16" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.65" />
    <line x1="21" y1="21" x2="45" y2="21" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.65" />
    <line x1="21" y1="26" x2="45" y2="26" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.65" />
    {/* Volute & outlet flange */}
    <rect x="9" y="16" width="7" height="14" rx="2" fill={color} />
    <path d="M9 19 L3 19 L3 27 L9 27 Z" fill={color} />
    {/* Rear fan cover */}
    <path d="M50 14 C56 14 58 18 58 23 C58 28 56 32 50 32 Z" fill={color} />
    {/* Mounting feet & base */}
    <path d="M20 35 L17 42 L49 42 L46 35 Z" fill={color} />
    <rect x="13" y="42" width="40" height="4" rx="2" fill={color} />
  </svg>
);

const STEPS = [
  {
    icon: <QrCode2RoundedIcon sx={{ fontSize: 44, color: INK }} />,
    title: 'Scan QR Code',
    text: 'Access your pump controller app.'
  },
  {
    icon: <PumpGlyph color={BLUE} size={50} />,
    title: 'Control Pump',
    text: 'Start or stop the pump with a single tap.'
  },
  {
    icon: <CheckRoundedIcon sx={{ fontSize: 46, color: GREEN, stroke: GREEN, strokeWidth: 1.5 }} />,
    title: 'Enjoy Benefits',
    text: 'Save water, save energy, increase productivity.'
  }
];

const PROMISES = [
  { icon: null, text: 'Innovating for a Greener Tomorrow' },
  { icon: <ShieldOutlinedIcon />, text: 'Secure sign-in' },
  { icon: <NotificationsActiveOutlinedIcon />, text: 'Alerts when something is wrong' },
  { icon: <PhoneAndroidIcon />, text: 'Made for the farmer’s phone' }
];

/**
 * Illustrated sunrise farm scene with crop rows, irrigation sprinklers, and a blue monoblock pump
 * gushing water on a concrete pedestal (matches the reference hero artwork until a photo is dropped in).
 */
const FarmScene: React.FC = () => (
  <svg
    viewBox="0 0 880 460"
    preserveAspectRatio="xMidYMid slice"
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="heroSky" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#E6F0FA" />
        <stop offset="38%" stopColor="#CBE1F8" />
        <stop offset="72%" stopColor="#94C0EE" />
        <stop offset="100%" stopColor="#6CA4E3" />
      </linearGradient>
      <radialGradient id="heroSun" cx="0.24" cy="0.48" r="0.38">
        <stop offset="0%" stopColor="#FFFDF2" />
        <stop offset="30%" stopColor="#FFE89E" stopOpacity="0.95" />
        <stop offset="68%" stopColor="#F9D98C" stopOpacity="0.35" />
        <stop offset="100%" stopColor="#F9D98C" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="heroField" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#A9D14B" />
        <stop offset="35%" stopColor="#6FB232" />
        <stop offset="75%" stopColor="#388526" />
        <stop offset="100%" stopColor="#1E5D18" />
      </linearGradient>
      <linearGradient id="pumpBody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#3B7BF6" />
        <stop offset="45%" stopColor="#1B4EC9" />
        <stop offset="100%" stopColor="#0D2A7A" />
      </linearGradient>
      <linearGradient id="pumpSnout" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#5B9BFF" />
        <stop offset="100%" stopColor="#1843B0" />
      </linearGradient>
      <linearGradient id="waterGush" x1="0.8" y1="0" x2="0.1" y2="1">
        <stop offset="0%" stopColor="#FFFFFF" />
        <stop offset="45%" stopColor="#DDF2FF" />
        <stop offset="85%" stopColor="#9AD0FA" stopOpacity="0.9" />
        <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.2" />
      </linearGradient>
      <linearGradient id="concreteTop" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#EFECE4" />
        <stop offset="100%" stopColor="#C9C3B4" />
      </linearGradient>
      <linearGradient id="concreteSide" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#D8D2C5" />
        <stop offset="100%" stopColor="#9A9383" />
      </linearGradient>
    </defs>

    {/* Sky & clouds */}
    <rect width="880" height="460" fill="url(#heroSky)" />
    <ellipse cx="640" cy="70" rx="140" ry="38" fill="#FFFFFF" opacity="0.55" />
    <ellipse cx="750" cy="88" rx="110" ry="32" fill="#FFFFFF" opacity="0.45" />
    <ellipse cx="500" cy="54" rx="95" ry="25" fill="#FFFFFF" opacity="0.4" />

    {/* Warm golden sunrise on the left horizon */}
    <circle cx="215" cy="220" r="240" fill="url(#heroSun)" />
    <circle cx="215" cy="228" r="34" fill="#FFFBE6" opacity="0.95" />

    {/* Distant treeline along the horizon */}
    <path
      d="M0 245 Q60 228 115 240 T230 236 T355 234 T470 226 T595 224 T710 218 T820 214 L880 218 L880 262 L0 262 Z"
      fill="#3B6E2C"
      opacity="0.72"
    />
    {/* Fuller tree canopies on the right horizon */}
    {[
      [560, 212, 24],
      [592, 206, 30],
      [628, 210, 26],
      [665, 204, 28],
      [705, 198, 34],
      [748, 202, 28],
      [795, 190, 38],
      [838, 186, 42],
      [872, 194, 34],
      [295, 224, 18],
      [320, 220, 22]
    ].map(([cx, cy, r], idx) => (
      <circle key={idx} cx={cx} cy={cy} r={r} fill={idx > 5 ? '#26531B' : '#316423'} opacity="0.88" />
    ))}

    {/* Main irrigated green crop field */}
    <rect x="0" y="248" width="880" height="212" fill="url(#heroField)" />

    {/* Perspective crop rows radiating from the horizon */}
    {[-520, -400, -290, -190, -100, -20, 60, 145, 235, 330, 435, 550].map((offset, i) => (
      <g key={i}>
        <path
          d={`M 235 248 L ${235 + offset * 1.65} 460`}
          stroke="#194F13"
          strokeWidth={i % 2 === 0 ? '6' : '4'}
          opacity="0.38"
        />
        <path
          d={`M 242 248 L ${250 + offset * 1.65} 460`}
          stroke="#C8EA6B"
          strokeWidth="2.5"
          opacity="0.35"
        />
      </g>
    ))}

    {/* Irrigation sprinklers & misty water arcs in the left-center field */}
    {[110, 195, 280, 360].map((sx, idx) => (
      <g key={sx} opacity="0.65">
        <line x1={sx} y1={255} x2={sx} y2={278} stroke="#E2F1FF" strokeWidth="1.8" />
        <path d={`M ${sx} 256 Q ${sx - 34} 236 ${sx - 66} 268`} stroke="#FFFFFF" strokeWidth="1.8" fill="none" strokeDasharray="3 2" />
        <path d={`M ${sx} 256 Q ${sx + 34} 236 ${sx + 66} 268`} stroke="#FFFFFF" strokeWidth="1.8" fill="none" strokeDasharray="3 2" />
        <ellipse cx={sx} cy={256 + (idx % 2) * 3} rx="42" ry="8" fill="#FFFFFF" opacity="0.22" />
      </g>
    ))}

    {/* Floating green leaf in the breeze to the left of the phone */}
    <g transform="translate(335, 108) rotate(-22)">
      <path d="M0 16 C 10 0, 34 -2, 46 12 C 34 26, 14 26, 0 16 Z" fill="#43A047" />
      <path d="M2 16 Q 22 13 42 12" stroke="#A5D6A7" strokeWidth="1.5" fill="none" />
    </g>

    {/* Concrete pedestal under the pump on the right */}
    <polygon points="585,378 825,378 852,396 562,396" fill="url(#concreteTop)" />
    <polygon points="562,396 852,396 852,456 562,456" fill="url(#concreteSide)" />
    <line x1="562" y1="396" x2="852" y2="396" stroke="#FFFDF9" strokeWidth="2" opacity="0.7" />

    {/* Detailed 3D-styled Blue Agricultural Monoblock Pump */}
    <g transform="translate(575, 200)">
      {/* Mounting feet */}
      <path d="M105 142 L95 182 L135 182 L130 142 Z" fill="#0B2268" />
      <path d="M185 142 L180 182 L218 182 L208 142 Z" fill="#0B2268" />
      <rect x="82" y="176" width="146" height="9" rx="3" fill="#081A52" />

      {/* Rear motor fan cowl */}
      <ellipse cx="226" cy="106" rx="22" ry="44" fill="#0B236B" />
      {/* Main cylindrical motor housing */}
      <rect x="112" y="60" width="114" height="92" rx="14" fill="url(#pumpBody)" />
      {/* Cooling ribs */}
      {[70, 80, 90, 100, 110, 120, 130].map(ry => (
        <line key={ry} x1="122" y1={ry} x2="216" y2={ry} stroke="#6FA1FF" strokeWidth="2.4" strokeLinecap="round" opacity="0.55" />
      ))}
      {/* Tie rods & bolts */}
      <rect x="106" y="56" width="14" height="100" rx="4" fill="#1744B8" />
      <rect x="214" y="58" width="10" height="96" rx="3" fill="#0F318C" />

      {/* Top terminal box */}
      <rect x="132" y="22" width="54" height="38" rx="5" fill="url(#pumpBody)" />
      <rect x="128" y="18" width="62" height="9" rx="3" fill="#2A65E8" />
      <circle cx="159" cy="14" r="6" fill="#1B4EC9" />

      {/* Pump volute chamber */}
      <ellipse cx="94" cy="104" rx="26" ry="50" fill="url(#pumpBody)" />
      <ellipse cx="86" cy="104" rx="20" ry="42" fill="#2963E2" opacity="0.7" />

      {/* Angled discharge nozzle & flange */}
      <path d="M88 76 L34 92 L44 134 L94 124 Z" fill="url(#pumpSnout)" />
      <ellipse cx="39" cy="113" rx="10" ry="23" transform="rotate(-14 39 113)" fill="#0E2A7E" />
      <ellipse cx="37" cy="113" rx="7" ry="18" transform="rotate(-14 37 113)" fill="#07184D" />

      {/* Gushing white & cyan water stream pouring from the nozzle */}
      <path
        d="M36 96 C 2 114, -30 165, -62 258 L 12 258 C 24 192, 34 150, 44 130 Z"
        fill="url(#waterGush)"
      />
      {/* Water highlight streaks */}
      <path d="M32 104 C 4 126, -20 176, -46 254" stroke="#FFFFFF" strokeWidth="5" fill="none" strokeLinecap="round" opacity="0.9" />
      <path d="M38 114 C 14 140, -6 184, -24 254" stroke="#E0F4FF" strokeWidth="3.5" fill="none" strokeLinecap="round" opacity="0.85" />
      <path d="M42 122 C 24 150, 10 190, -4 254" stroke="#FFFFFF" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.75" />
      {/* Splash foam at bottom */}
      <ellipse cx="-24" cy="254" rx="52" ry="12" fill="#FFFFFF" opacity="0.65" />
    </g>
  </svg>
);

/** Right-side green field vignette inside the "How It Works?" card, framed by a curved blue ribbon. */
const HowFieldScene: React.FC = () => (
  <svg viewBox="0 0 420 220" preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%', display: 'block' }} aria-hidden="true">
    <defs>
      <linearGradient id="howSky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#9AC5F4" />
        <stop offset="100%" stopColor="#E5F0FA" />
      </linearGradient>
      <linearGradient id="howCrop" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#8CC63F" />
        <stop offset="100%" stopColor="#26691E" />
      </linearGradient>
    </defs>
    <rect width="420" height="220" fill="url(#howSky)" />
    {/* Clouds */}
    <ellipse cx="180" cy="42" rx="65" ry="18" fill="#FFFFFF" opacity="0.65" />
    <ellipse cx="310" cy="36" rx="80" ry="22" fill="#FFFFFF" opacity="0.55" />
    {/* Distant trees */}
    <path d="M0 106 Q70 94 140 102 T280 96 T420 92 L420 118 L0 118 Z" fill="#2F6224" />
    {[95, 125, 210, 242, 275, 340, 375].map((tx, i) => (
      <circle key={i} cx={tx} cy={92 - (i % 3) * 5} r={14 + (i % 2) * 5} fill="#25521B" />
    ))}
    {/* Green field */}
    <rect x="0" y="110" width="420" height="110" fill="url(#howCrop)" />
    {/* Perspective crop rows */}
    {[-240, -160, -90, -25, 35, 95, 160, 230, 310].map((dx, i) => (
      <g key={i}>
        <path d={`M 140 110 L ${140 + dx * 1.5} 220`} stroke="#174911" strokeWidth="5" opacity="0.42" />
        <path d={`M 145 110 L ${152 + dx * 1.5} 220`} stroke="#C9EE73" strokeWidth="2" opacity="0.45" />
      </g>
    ))}
  </svg>
);

/** Tilted smartphone showing the Ajanta Pump Controller app ("Pump ON", Schedule, Usage, "Stop Pump"). */
const PhoneMock: React.FC = () => (
  <Box
    aria-hidden="true"
    sx={{
      position: 'relative',
      width: { xs: 192, sm: 210, md: 222 },
      height: { xs: 382, sm: 412, md: 432 },
      transform: 'rotate(8deg)',
      borderRadius: '36px',
      bgcolor: '#0B1020',
      p: '8px',
      boxShadow: '0 28px 55px rgba(8, 20, 60, 0.45), 0 0 0 1.5px rgba(255,255,255,0.22)',
      zIndex: 3
    }}
  >
    {/* Top speaker notch */}
    <Box
      sx={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 56,
        height: 6,
        borderRadius: 99,
        bgcolor: '#1E2640',
        zIndex: 4
      }}
    />
    <Box
      sx={{
        height: '100%',
        borderRadius: '29px',
        bgcolor: '#FFFFFF',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Navy app header */}
      <Box
        sx={{
          background: `linear-gradient(180deg, #0D2159 0%, ${NAVY} 100%)`,
          color: '#FFFFFF',
          textAlign: 'center',
          pt: 2.6,
          pb: 1.8,
          position: 'relative'
        }}
      >
        <Box component="img" src="/ajanta-mark.png" alt="" sx={{ height: 26, display: 'block', mx: 'auto', mb: 0.4 }} />
        <Typography sx={{ fontWeight: 800, fontSize: '1.22rem', lineHeight: 1.05, letterSpacing: '-0.01em' }}>
          Ajanta
        </Typography>
        <Typography sx={{ fontSize: '0.62rem', opacity: 0.88, letterSpacing: '0.02em' }}>
          Pump Controller
        </Typography>
      </Box>

      {/* App body */}
      <Box
        sx={{
          flex: 1,
          px: 1.6,
          pt: 1.8,
          pb: 1.5,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          bgcolor: '#F7FAFF'
        }}
      >
        {/* Glowing green Pump ON circle */}
        <Box
          sx={{
            width: 108,
            height: 108,
            borderRadius: '50%',
            bgcolor: '#E2F5E6',
            border: '5px solid #CBEBD3',
            display: 'grid',
            placeItems: 'center',
            boxShadow: '0 8px 22px rgba(46, 155, 78, 0.22)'
          }}
        >
          <Box sx={{ textAlign: 'center' }}>
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 0.3 }}>
              <PumpGlyph color="#1E8738" size={34} />
            </Box>
            <Typography sx={{ color: '#1B6E30', fontWeight: 800, fontSize: '0.82rem', lineHeight: 1.1 }}>
              Pump ON
            </Typography>
          </Box>
        </Box>

        {/* Schedule & Usage mini tiles */}
        <Box sx={{ display: 'flex', gap: 1, mt: 1.8, width: '100%' }}>
          <Box
            sx={{
              flex: 1,
              bgcolor: '#FFFFFF',
              borderRadius: 2.5,
              border: `1px solid ${LINE}`,
              py: 1,
              px: 0.5,
              textAlign: 'center',
              boxShadow: '0 3px 10px rgba(16, 40, 107, 0.05)'
            }}
          >
            <CalendarMonthOutlinedIcon sx={{ fontSize: 18, color: NAVY, mb: 0.2 }} />
            <Typography sx={{ fontWeight: 800, fontSize: '0.66rem', color: INK, lineHeight: 1.1 }}>
              Schedule
            </Typography>
            <Typography sx={{ fontSize: '0.56rem', color: MUTED }}>Set Time</Typography>
          </Box>
          <Box
            sx={{
              flex: 1,
              bgcolor: '#FFFFFF',
              borderRadius: 2.5,
              border: `1px solid ${LINE}`,
              py: 1,
              px: 0.5,
              textAlign: 'center',
              boxShadow: '0 3px 10px rgba(16, 40, 107, 0.05)'
            }}
          >
            <BarChartRoundedIcon sx={{ fontSize: 18, color: NAVY, mb: 0.2 }} />
            <Typography sx={{ fontWeight: 800, fontSize: '0.66rem', color: INK, lineHeight: 1.1 }}>
              Usage
            </Typography>
            <Typography sx={{ fontSize: '0.56rem', color: MUTED }}>12.5 hrs</Typography>
          </Box>
        </Box>

        {/* Stop Pump button */}
        <Box
          sx={{
            mt: 'auto',
            width: '100%',
            background: `linear-gradient(90deg, ${NAVY} 0%, ${BLUE} 100%)`,
            color: '#FFFFFF',
            borderRadius: 2.5,
            py: 1.05,
            textAlign: 'center',
            fontWeight: 800,
            fontSize: '0.76rem',
            boxShadow: '0 6px 14px rgba(29, 63, 168, 0.28)'
          }}
        >
          Stop Pump
        </Box>
      </Box>
    </Box>
  </Box>
);

/** The public landing page of Ajanta Pump Controller. */
export const HomeView: React.FC = () => {
  const navigate = useNavigate();

  return (
    <Box
      id="top"
      sx={{
        minHeight: '100vh',
        bgcolor: '#FFFFFF',
        color: INK,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        overflowX: 'hidden'
      }}
    >
      {/* 1. STICKY HEADER */}
      <Box
        component="header"
        sx={{
          borderBottom: `1px solid ${LINE}`,
          bgcolor: 'rgba(255,255,255,0.97)',
          position: 'sticky',
          top: 0,
          zIndex: 20,
          backdropFilter: 'blur(8px)'
        }}
      >
        <Container
          maxWidth="xl"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: { xs: 1.25, md: 2.5 },
            py: { xs: 1, md: 1.25 }
          }}
        >
          <Box
            component="img"
            src="/ajanta-logo.png"
            alt="Ajanta"
            sx={{ height: { xs: 36, sm: 44, md: 48 }, display: 'block', flexShrink: 0 }}
          />
          <Box sx={{ display: { xs: 'none', sm: 'block' }, width: '1.5px', height: 34, bgcolor: '#CBD5E1' }} />
          <Typography
            sx={{
              display: { xs: 'none', sm: 'block' },
              fontWeight: 800,
              fontSize: { sm: '1.02rem', md: '1.15rem' },
              color: INK,
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap'
            }}
          >
            Ajanta Pump Controller
          </Typography>

          <Box
            component="nav"
            aria-label="Sections"
            sx={{
              display: { xs: 'none', md: 'flex' },
              alignItems: 'center',
              gap: { md: 3.5, lg: 5 },
              mx: 'auto'
            }}
          >
            {NAV.map((n, i) => (
              <Link
                key={n.label}
                href={n.href}
                underline="none"
                sx={{
                  color: i === 0 ? INK : '#334155',
                  fontWeight: i === 0 ? 800 : 600,
                  fontSize: '0.96rem',
                  py: 0.75,
                  borderBottom: i === 0 ? `3px solid ${BLUE}` : '3px solid transparent',
                  transition: 'color 0.15s ease',
                  '&:hover': { color: BLUE },
                  '&:focus-visible': { outline: `2px solid ${BLUE}`, outlineOffset: 4, borderRadius: 1 }
                }}
              >
                {n.label}
              </Link>
            ))}
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, ml: { xs: 'auto', md: 0 } }}>
            <Tooltip title="Platform owner sign in">
              <IconButton
                aria-label="Platform owner sign in"
                data-testid="owner-lock"
                onClick={() => navigate('/owner')}
                sx={{
                  border: `1px solid ${LINE}`,
                  color: NAVY,
                  width: 40,
                  height: 40,
                  '&:hover': { bgcolor: '#F1F5FC' },
                  '&:focus-visible': { outline: `2px solid ${BLUE}`, outlineOffset: 2 }
                }}
              >
                <LockOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Button
              data-testid="login-button"
              variant="contained"
              startIcon={<PersonIcon />}
              onClick={() => navigate('/login')}
              sx={{
                bgcolor: NAVY,
                color: '#FFFFFF',
                borderRadius: 999,
                px: { xs: 2.4, sm: 3.2 },
                py: 0.95,
                fontWeight: 700,
                fontSize: '0.95rem',
                textTransform: 'none',
                boxShadow: '0 4px 12px rgba(16, 40, 107, 0.22)',
                '&:hover': { bgcolor: '#0A1B4D' }
              }}
            >
              Login
            </Button>
          </Box>
        </Container>
      </Box>

      {/* MAIN CONTENT */}
      <Box component="main" sx={{ flex: 1 }}>
        {/* 2. HERO SECTION */}
        <Box
          sx={{
            position: 'relative',
            overflow: 'hidden',
            bgcolor: '#F3F7FD',
            borderBottom: `1px solid ${LINE}`
          }}
        >
          {/* Full-bleed farm artwork on the right side */}
          <Box
            sx={{
              position: { xs: 'relative', md: 'absolute' },
              top: 0,
              right: 0,
              bottom: 0,
              width: { xs: '100%', md: '66%' },
              height: { xs: 370, sm: 410, md: '100%' },
              zIndex: 1
            }}
          >
            <FarmScene />
            {/* Smooth white-to-transparent blend on desktop so the left text sits naturally over the sky */}
            <Box
              sx={{
                display: { xs: 'none', md: 'block' },
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(90deg, #FFFFFF 0%, rgba(255,255,255,0.96) 14%, rgba(255,255,255,0.55) 30%, rgba(255,255,255,0) 48%)'
              }}
            />
          </Box>

          {/* Diagonal white & blue wave along the bottom-left edge of the hero */}
          <Box
            component="svg"
            viewBox="0 0 1440 90"
            preserveAspectRatio="none"
            aria-hidden="true"
            sx={{
              display: { xs: 'none', md: 'block' },
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: -1,
              width: '100%',
              height: 74,
              zIndex: 2,
              pointerEvents: 'none'
            }}
          >
            <path d="M0 90 L0 12 Q420 12 690 90 Z" fill="#FFFFFF" />
            <path d="M430 34 Q575 56 710 90 L650 90 Q535 58 430 34 Z" fill={BLUE} opacity="0.88" />
          </Box>

          <Container
            maxWidth="xl"
            sx={{
              position: 'relative',
              zIndex: 3,
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1.02fr 0.98fr' },
              alignItems: 'center',
              gap: { xs: 2, md: 2 },
              py: { xs: 3.5, md: 5.5 },
              minHeight: { md: 455 }
            }}
          >
            {/* Left copy column */}
            <Box
              sx={{
                maxWidth: 590,
                bgcolor: { xs: 'rgba(255,255,255,0.92)', md: 'transparent' },
                p: { xs: 2, sm: 2.5, md: 0 },
                borderRadius: { xs: 3, md: 0 }
              }}
            >
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 1,
                  bgcolor: '#E5F0FF',
                  border: '1px solid #D0E2FC',
                  borderRadius: 999,
                  pl: 1.2,
                  pr: 2.2,
                  py: 0.65,
                  mb: 2.2
                }}
              >
                <EnergySavingsLeafIcon sx={{ color: GREEN, fontSize: 20 }} />
                <Typography sx={{ fontWeight: 700, color: NAVY, fontSize: { xs: '0.86rem', sm: '0.94rem' } }}>
                  Smart Irrigation. Smart Farming.
                </Typography>
              </Box>

              <Typography
                component="h1"
                sx={{
                  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                  fontWeight: 800,
                  letterSpacing: '-0.03em',
                  fontSize: { xs: '2.45rem', sm: '3.2rem', md: '4.1rem', lg: '4.4rem' },
                  lineHeight: 1.04,
                  color: INK
                }}
              >
                Ajanta Pump{' '}
                <Box component="span" sx={{ display: 'block', color: BLUE }}>
                  Controller
                </Box>
              </Typography>

              <Typography
                sx={{
                  color: '#334155',
                  fontSize: { xs: '1.02rem', sm: '1.18rem', md: '1.28rem' },
                  lineHeight: 1.48,
                  mt: 2.2,
                  mb: 3.2,
                  maxWidth: 500,
                  fontWeight: 500
                }}
              >
                Control your water pump from anywhere, at any time — with ease.
              </Typography>

              <Box sx={{ display: 'flex', gap: 1.75, flexWrap: 'wrap', alignItems: 'center' }}>
                <Button
                  data-testid="get-started"
                  variant="contained"
                  startIcon={<PlayCircleFilledWhiteRoundedIcon sx={{ fontSize: '22px !important' }} />}
                  onClick={() => navigate('/login')}
                  sx={{
                    bgcolor: NAVY,
                    color: '#FFFFFF',
                    borderRadius: 999,
                    px: { xs: 3, sm: 3.6 },
                    py: 1.3,
                    fontWeight: 700,
                    fontSize: '0.98rem',
                    textTransform: 'none',
                    boxShadow: '0 8px 20px rgba(16, 40, 107, 0.26)',
                    '&:hover': { bgcolor: '#0A1B4D' }
                  }}
                >
                  Get Started
                </Button>
                <Button
                  component="a"
                  href="#how"
                  variant="outlined"
                  startIcon={<PlayArrowRoundedIcon sx={{ color: NAVY }} />}
                  sx={{
                    borderColor: NAVY,
                    color: INK,
                    bgcolor: 'rgba(255,255,255,0.92)',
                    borderRadius: 999,
                    px: { xs: 2.8, sm: 3.4 },
                    py: 1.25,
                    fontWeight: 700,
                    fontSize: '0.98rem',
                    textTransform: 'none',
                    borderWidth: 1.5,
                    '&:hover': { borderWidth: 1.5, borderColor: BLUE, bgcolor: '#EEF4FF' }
                  }}
                >
                  See how it works
                </Button>
              </Box>
            </Box>

            {/* Right visual column: tilted phone mockup + handwritten tagline */}
            <Box
              sx={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: { xs: 'center', md: 'flex-start' },
                pl: { md: 4, lg: 7 },
                minHeight: { xs: 340, md: 420 },
                mt: { xs: -36, md: 0 }
              }}
            >
              <PhoneMock />
              <Typography
                aria-hidden="true"
                sx={{
                  position: 'absolute',
                  right: { xs: 8, sm: 28, md: 36, lg: 64 },
                  top: { xs: 8, sm: 16, md: 18 },
                  fontFamily: "'Caveat', cursive",
                  fontWeight: 700,
                  fontSize: { xs: '1.45rem', sm: '1.85rem', md: '2.15rem' },
                  lineHeight: 1.08,
                  color: INK,
                  transform: 'rotate(-6deg)',
                  textShadow: '0 2px 10px rgba(255,255,255,0.85)',
                  zIndex: 4
                }}
              >
                Smarter Control…
                <br />
                Healthier Crops…
              </Typography>
            </Box>
          </Container>
        </Box>

        {/* 3. POWERFUL FEATURES */}
        <Box id="features" sx={{ py: { xs: 4.5, md: 5.5 }, bgcolor: '#FFFFFF', scrollMarginTop: 80 }}>
          <Container maxWidth="xl">
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: { xs: 2, sm: 3 } }}>
              <Box
                sx={{
                  flex: 1,
                  maxWidth: 150,
                  height: '1.5px',
                  bgcolor: NAVY,
                  opacity: 0.45,
                  display: { xs: 'none', sm: 'block' }
                }}
              />
              <Typography
                component="h2"
                sx={{
                  fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                  fontWeight: 800,
                  fontSize: { xs: '1.65rem', sm: '2rem', md: '2.2rem' },
                  color: INK,
                  textAlign: 'center',
                  letterSpacing: '-0.02em'
                }}
              >
                Powerful Features
              </Typography>
              <Box
                sx={{
                  flex: 1,
                  maxWidth: 150,
                  height: '1.5px',
                  bgcolor: NAVY,
                  opacity: 0.45,
                  display: { xs: 'none', sm: 'block' }
                }}
              />
            </Box>
            <Typography
              sx={{
                textAlign: 'center',
                color: '#3B4A6B',
                fontSize: { xs: '0.95rem', md: '1.05rem' },
                fontWeight: 500,
                mt: 0.5,
                mb: 3.5
              }}
            >
              Designed for Farmers, Built for a Smarter Tomorrow
            </Typography>

            <Box
              sx={{
                display: 'grid',
                gap: 2.5,
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' }
              }}
            >
              {FEATURES.map(f => (
                <Box
                  key={f.title}
                  sx={{
                    display: 'flex',
                    gap: 2,
                    alignItems: 'center',
                    p: 2.4,
                    borderRadius: '18px',
                    border: `1px solid ${LINE}`,
                    background: 'linear-gradient(180deg, #FFFFFF 0%, #F9FBFF 100%)',
                    boxShadow: '0 8px 24px rgba(16, 40, 107, 0.06)'
                  }}
                >
                  <Box
                    sx={{
                      width: 62,
                      height: 62,
                      flex: 'none',
                      borderRadius: '50%',
                      bgcolor: '#E5EEFC',
                      border: '4px solid #F1F6FE',
                      color: NAVY,
                      display: 'grid',
                      placeItems: 'center',
                      '& svg': { fontSize: 30 }
                    }}
                  >
                    {f.icon}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 800, fontSize: '1.02rem', color: INK, lineHeight: 1.25 }}>
                      {f.title}
                    </Typography>
                    <Typography sx={{ color: MUTED, fontSize: '0.88rem', lineHeight: 1.4, mt: 0.4 }}>
                      {f.text}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          </Container>
        </Box>

        {/* 4. HOW IT WORKS? */}
        <Box id="how" sx={{ pb: { xs: 4, md: 5 }, pt: 1, scrollMarginTop: 80 }}>
          <Container maxWidth="xl">
            <Box
              sx={{
                position: 'relative',
                overflow: 'hidden',
                borderRadius: { xs: 4, md: '28px' },
                border: `1px solid ${LINE}`,
                background: 'linear-gradient(90deg, #EDF3FC 0%, #F5F9FF 62%, #E6EFFD 100%)',
                boxShadow: '0 10px 30px rgba(16, 40, 107, 0.06)'
              }}
            >
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: '0.9fr 1.85fr', lg: '0.75fr 1.75fr 0.95fr' },
                  alignItems: 'center',
                  gap: { xs: 3, md: 2 }
                }}
              >
                {/* Left title block + curved arrow */}
                <Box sx={{ p: { xs: 3, sm: 4 }, pr: { md: 1 }, position: 'relative' }}>
                  <Box sx={{ width: 42, height: '3px', bgcolor: NAVY, mb: 1.5, borderRadius: 2 }} />
                  <Typography
                    component="h2"
                    sx={{
                      fontFamily: "'Plus Jakarta Sans', 'Space Grotesk', sans-serif",
                      fontWeight: 800,
                      fontSize: { xs: '1.85rem', md: '2.2rem' },
                      color: INK,
                      lineHeight: 1.12,
                      letterSpacing: '-0.02em'
                    }}
                  >
                    How It Works?
                  </Typography>
                  <Typography sx={{ color: '#334155', fontSize: '1.08rem', fontWeight: 500, mt: 0.6 }}>
                    Simple. Smart. Effective.
                  </Typography>

                  {/* Curved arrow pointing to step 1 on desktop */}
                  <Box
                    component="svg"
                    viewBox="0 0 68 32"
                    fill="none"
                    aria-hidden="true"
                    sx={{
                      display: { xs: 'none', md: 'block' },
                      position: 'absolute',
                      right: -12,
                      top: '54%',
                      width: 58,
                      height: 28
                    }}
                  >
                    <path
                      d="M2 26 C 18 10, 38 8, 62 12"
                      stroke={NAVY}
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    />
                    <path
                      d="M55 6 L63 12 L54 18"
                      stroke={NAVY}
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Box>
                </Box>

                {/* Center 3 numbered steps with arrows in between */}
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                    gap: { xs: 3, sm: 1.5 },
                    px: { xs: 3, sm: 2 },
                    py: { xs: 1, md: 3 }
                  }}
                >
                  {STEPS.map((s, i) => (
                    <Box key={s.title} sx={{ textAlign: 'center', position: 'relative', px: 1 }}>
                      {/* Step arrow between items on tablet/desktop */}
                      {i < STEPS.length - 1 && (
                        <Box
                          component="svg"
                          viewBox="0 0 28 16"
                          fill="none"
                          aria-hidden="true"
                          sx={{
                            display: { xs: 'none', sm: 'block' },
                            position: 'absolute',
                            right: -14,
                            top: 48,
                            width: 24,
                            height: 14
                          }}
                        >
                          <path d="M2 8 H24 M18 3 L24 8 L18 13" stroke={BLUE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </Box>
                      )}

                      {/* Number badge */}
                      <Box
                        sx={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          bgcolor: NAVY,
                          color: '#FFFFFF',
                          display: 'inline-grid',
                          placeItems: 'center',
                          fontWeight: 800,
                          fontSize: '0.84rem',
                          mb: 1,
                          boxShadow: '0 4px 10px rgba(16,40,107,0.22)'
                        }}
                      >
                        {i + 1}
                      </Box>

                      {/* Step icon */}
                      <Box
                        sx={{
                          height: 54,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          mb: 1
                        }}
                      >
                        {s.icon}
                      </Box>

                      <Typography sx={{ fontWeight: 800, fontSize: '1.02rem', color: INK }}>
                        {s.title}
                      </Typography>
                      <Typography sx={{ color: MUTED, fontSize: '0.86rem', lineHeight: 1.38, maxWidth: 195, mx: 'auto', mt: 0.4 }}>
                        {s.text}
                      </Typography>
                    </Box>
                  ))}
                </Box>

                {/* Right curved crop field panel (visible on large screens, matching reference) */}
                <Box
                  sx={{
                    display: { xs: 'none', lg: 'block' },
                    position: 'relative',
                    height: '100%',
                    minHeight: 205,
                    overflow: 'hidden'
                  }}
                >
                  {/* Blue curved ribbon border */}
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      clipPath: 'polygon(18% 0%, 100% 0%, 100% 100%, 0% 100%)',
                      background: `linear-gradient(180deg, #3B7BF6 0%, ${NAVY} 100%)`
                    }}
                  />
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 6,
                      right: 0,
                      bottom: 0,
                      left: 14,
                      clipPath: 'polygon(18% 0%, 100% 0%, 100% 100%, 0% 100%)',
                      overflow: 'hidden'
                    }}
                  >
                    <HowFieldScene />
                  </Box>
                </Box>
              </Box>
            </Box>

            {/* Required Farmer Note */}
            <Box
              data-testid="farmers-note"
              sx={{
                mt: 2.5,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                bgcolor: '#F8FAFF',
                border: `1px solid ${LINE}`,
                borderRadius: 3.5,
                px: { xs: 2, sm: 3 },
                py: 1.6
              }}
            >
              <PhoneAndroidIcon sx={{ color: BLUE, fontSize: 30, flexShrink: 0 }} />
              <Box>
                <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', color: INK }}>
                  Are you a farmer?
                </Typography>
                <Typography sx={{ color: MUTED, fontSize: '0.88rem' }}>
                  Farmers use the mobile app, not this website. Ask your dealer for your QR code and scan it in the app.
                </Typography>
              </Box>
            </Box>
          </Container>
        </Box>
      </Box>

      {/* 5. DARK NAVY FOOTER BAND */}
      <Box component="footer" id="benefits" sx={{ bgcolor: '#0D225C', color: '#FFFFFF', scrollMarginTop: 80 }}>
        <Container
          maxWidth="xl"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: { xs: 2, lg: 3 },
            flexWrap: 'wrap',
            py: { xs: 2.5, md: 2.2 }
          }}
        >
          <Box
            component="img"
            src="/ajanta-logo.png"
            alt="Ajanta"
            sx={{
              height: { xs: 42, md: 48 },
              bgcolor: '#FFFFFF',
              borderRadius: 2,
              px: 1.2,
              py: 0.6,
              display: 'block'
            }}
          />

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: { xs: 2, md: 3 },
              flex: 1,
              justifyContent: { xs: 'flex-start', lg: ' space-around' }
            }}
          >
            {PROMISES.map(p => (
              <Box
                key={p.text}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  pl: { md: 2.5 },
                  borderLeft: { md: '1px solid rgba(255,255,255,0.22)' },
                  fontSize: { xs: '0.86rem', md: '0.92rem' },
                  fontWeight: 600,
                  color: 'rgba(255,255,255,0.94)',
                  '& svg': { fontSize: 20, color: '#93C5FD' }
                }}
              >
                {p.icon}
                <span>{p.text}</span>
              </Box>
            ))}
          </Box>

          <Box
            sx={{
              bgcolor: '#FFFFFF',
              color: INK,
              borderRadius: 999,
              px: 2.8,
              py: 1,
              fontWeight: 800,
              fontSize: '0.92rem',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              boxShadow: '0 4px 14px rgba(0,0,0,0.2)'
            }}
          >
            <EnergySavingsLeafIcon sx={{ color: GREEN, fontSize: 20 }} />
            <span>Grow More. Worry Less.</span>
          </Box>
        </Container>
      </Box>
    </Box>
  );
};
