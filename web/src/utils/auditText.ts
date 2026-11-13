/** The activity log's action codes as plain sentences. A code that is not listed is turned into words ("SET_WARRANTY" -> "Set warranty"). */
const TEXT: Record<string, string> = {
  USER_CREATED: 'Added an account',
  CREATE_SUBORDINATE: 'Added an account',
  CREATE_STAFF: 'Added a staff login',
  USER_UPDATED: 'Changed an account',
  USER_DELETED: 'Deleted an account',
  ACCOUNT_SUSPENDED: 'Stopped an account',
  ACCOUNT_ACTIVE: 'Restored an account',
  PARTNER_QR_ISSUED: 'Made a new sign-up QR',
  QR_CLAIMED: 'Opened a sign-up QR',
  QR_CLAIM_FAILED: 'Typed a wrong number on a QR',
  FARMER_REGISTERED: 'Registered a farmer',
  FARMER_UPDATED: 'Changed a farmer’s details',
  FARMER_STOPPED: 'Stopped a farmer’s app',
  FARMER_RESTORED: 'Restored a farmer’s app',
  FARMER_QR_REISSUED: 'Made a new QR for a farmer',
  DEVICE_ALLOCATED: 'Gave a starter to someone',
  BULK_ALLOCATE: 'Gave starters to someone',
  BRAND_CREATED: 'Added a manufacturer',
  BRAND_UPDATED: 'Changed a manufacturer',
  BRAND_SUSPENDED: 'Switched a manufacturer’s app off',
  BRAND_ACTIVATED: 'Switched a manufacturer’s app on',
  COMMAND_START: 'Started a pump',
  COMMAND_STOP: 'Stopped a pump',
  COMMAND_QUEUED: 'Sent a command to a pump',
  COMMAND_FAILED: 'A pump did not obey a command',
  RESOLVE: 'Resolved an alert',
  RESOLVE_FAULT: 'Resolved a fault',
  ACK: 'Acknowledged an alert',
  ASSIGN: 'Assigned an alert',
  PANEL_BOUND: 'Recorded a panel’s details',
  SET_PANEL_BINDING: 'Recorded a panel’s details',
  SET_WARRANTY: 'Set a warranty',
  WARRANTY_UPDATED: 'Changed a warranty',
  DELETE_PUMP: 'Deleted a pump',
  LOGIN_SUCCESS: 'Signed in',
  LOGIN_FAILED: 'A sign-in failed',
  MFA_SUCCESS: 'Entered the authenticator code',
  MFA_FAILED: 'Entered a wrong authenticator code',
  MFA_REQUIRED: 'Was asked for the authenticator code',
  OTP_REQUESTED: 'Asked for a sign-in code',
  OTP_VERIFIED: 'Entered a sign-in code',
  OTP_FAILED: 'Entered a wrong sign-in code',
  PASSWORD_RESET: 'Password changed',
  MFA_ENABLED: 'Turned on the authenticator',
  MFA_DISABLED: 'Turned off the authenticator',
  IMEI_IMPORT: 'Uploaded a factory sheet',
  BULK_IMPORT_DEVICE: 'Uploaded a factory sheet'
};

export function auditText(action: string): string {
  const key = (action || '').toUpperCase();
  if (TEXT[key]) return TEXT[key];
  const words = key.toLowerCase().replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Something happened';
}

/** Whether the action is one to look twice at (a failed sign-in, a stop, a delete). */
export const auditNeedsAttention = (action: string): boolean => /FAILED|DELETE|SUSPENDED|STOPPED|DISABLED/i.test(action || '');
