import React, { useState } from 'react';
import { Box } from '@mui/material';
import { LandingNavbar } from './LandingNavbar';
import { HeroSection } from './HeroSection';
import { CapabilityStrip } from './CapabilityStrip';
import { FeaturesSection } from './FeaturesSection';
import { SolutionsSection } from './SolutionsSection';
import { ArchitectureVisual } from './ArchitectureVisual';
import { FinalCTA } from './FinalCTA';
import { Footer } from './Footer';
import { OnboardingModal } from './OnboardingModal';

export const LandingPageView: React.FC = () => {
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  return (
    <Box
      sx={{
        width: '100%',
        minHeight: '100vh',
        bgcolor: '#FFFFFF',
        color: '#0F172A',
        overflowX: 'hidden'
      }}
    >
      {/* Sticky Modern Top Navigation */}
      <LandingNavbar onOpenGetStarted={() => setOnboardingOpen(true)} />

      {/* Hero Section with Live Metrics & Composite Product Mockup */}
      <HeroSection onOpenGetStarted={() => setOnboardingOpen(true)} />

      {/* Core Capabilities 5-Card Strip */}
      <CapabilityStrip />

      {/* Powering Smarter Pump Operations: Feature Capabilities */}
      <FeaturesSection />

      {/* Tailored Solutions: Farmers, Dealers, Manufacturers */}
      <SolutionsSection onOpenGetStarted={() => setOnboardingOpen(true)} />

      {/* Product Architecture: From Field to Cloud to Screen */}
      <ArchitectureVisual />

      {/* Final Action Call to Action */}
      <FinalCTA onOpenGetStarted={() => setOnboardingOpen(true)} />

      {/* Enterprise Platform Footer */}
      <Footer />

      {/* Onboarding / Get Started Dialog */}
      <OnboardingModal open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
    </Box>
  );
};
