export type RoleTier = 
  | 'superadmin' 
  | 'manufacturer' 
  | 'distributor' 
  | 'dealer1' 
  | 'dealer2' 
  | 'dealer3' 
  | 'dealer4' 
  | 'dealer5' 
  | 'customer';

export type ThemePreset = 'sapphire' | 'agro-light' | 'cyber-neon';

export type IndianLanguage = 
  | 'as' | 'bn' | 'brx' | 'doi' | 'en' | 'gu' | 'hi' | 'kn' | 'ks' 
  | 'kok' | 'mai' | 'ml' | 'mni' | 'mr' | 'ne' | 'or' | 'pa' | 'sa' 
  | 'sat' | 'sd' | 'ta' | 'te' | 'ur';

export interface PumpDevice {
  id: string;
  name: string;
  type: '3-phase' | '1-phase';
  hp: number;
  status: 'RUNNING' | 'STOPPED' | 'FAULT';
  vRY: number;
  vYB: number;
  vBR: number;
  iR: number;
  iY: number;
  iB: number;
  lat: number;
  lng: number;
  owner: string;
  rssi: number;
  firmware: string;
  lastSeenSec: number;
}
