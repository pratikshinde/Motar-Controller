import React from 'react';
import Svg, { Rect, Circle, Path } from 'react-native-svg';

interface MotorIconProps {
  size?: number;
  color?: string;
  fill?: string;
}

export const MotorIcon: React.FC<MotorIconProps> = ({ size = 64, color = '#64748B', fill = 'none' }) => {
  return (
    <Svg width={size} height={size} viewBox="0 0 80 80" fill="none">
      {/* Motor Terminal Box on top */}
      <Rect x="26" y="14" width="28" height="12" rx="3" fill={color} />

      {/* Main Motor Cylindrical Body */}
      <Rect x="16" y="24" width="48" height="38" rx="8" fill={color} />

      {/* Cooling Fins / Indentations */}
      <Path
        d="M24 30 L24 56 M32 30 L32 56 M40 30 L40 56 M48 30 L48 56 M56 30 L56 56"
        stroke="#FFFFFF"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity={0.3}
      />

      {/* Front Bearing Hub / Flange */}
      <Circle cx="64" cy="43" r="8" fill={color} />
      {/* Rotor Drive Shaft */}
      <Rect x="68" y="39" width="8" height="8" rx="2" fill={color} />

      {/* Motor Base Mount Feet */}
      <Path
        d="M14 62 L66 62 M18 62 L18 68 M62 62 L62 68"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
      />
    </Svg>
  );
};
