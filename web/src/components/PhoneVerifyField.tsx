import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import {
  confirmPhoneCode,
  looksLikePhone,
  normalizePhone,
  sendPhoneCode,
  type VerificationPurpose
} from '../api/phoneVerification';

const RESEND_SECONDS = 30;

interface Props {
  /** What the code is for: creating an account (default) or resetting a password. */
  purpose?: VerificationPurpose;
  /** The number being verified, exactly as it is typed in the form (spaces and dashes do not matter). */
  phone: string;
  /** The ticket once the code is confirmed; null again as soon as the number is edited. */
  onTicket: (ticket: string | null) => void;
  disabled?: boolean;
  /** Change this to throw away a verification (e.g. after the server has spent the ticket on a failed attempt). */
  resetKey?: number;
  /** Who reads the code out: the owner of the number, or somebody sitting with them. */
  hint?: string;
}

/**
 * "Prove this phone is real" step: sends a WhatsApp code to the number, takes the code back, and hands the form a
 * single-use ticket (see api/phoneVerification.ts). The form submits the ticket with the account-creation call.
 */
export const PhoneVerifyField: React.FC<Props> = ({ purpose = 'registration', phone, onTicket, disabled, resetKey = 0, hint }) => {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [verifiedFor, setVerifiedFor] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [devNotice, setDevNotice] = useState('');
  const onTicketRef = useRef(onTicket);
  onTicketRef.current = onTicket;

  const current = normalizePhone(phone);

  // Editing the number (or an outside reset) invalidates everything that was done for the old one.
  useEffect(() => {
    if (sentTo !== null && sentTo !== current) {
      setSentTo(null);
      setCode('');
      setError('');
      setDevNotice('');
    }
    if (verifiedFor !== null && verifiedFor !== current) {
      setVerifiedFor(null);
      onTicketRef.current(null);
    }
  }, [current, sentTo, verifiedFor]);

  useEffect(() => {
    setSentTo(null);
    setVerifiedFor(null);
    setCode('');
    setError('');
    setDevNotice('');
    onTicketRef.current(null);
  }, [resetKey]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  async function send() {
    setBusy(true);
    setError('');
    try {
      const res = await sendPhoneCode(current, purpose);
      setSentTo(current);
      setCooldown(RESEND_SECONDS);
      if (res.dev_otp) {
        // The server only returns the code in development mode.
        setCode(res.dev_otp);
        setDevNotice(`Development mode: code ${res.dev_otp} filled in.`);
      } else {
        setDevNotice('');
        setCode('');
      }
    } catch (err: any) {
      setError(err.message || 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError('');
    try {
      const ticket = await confirmPhoneCode(current, code, purpose);
      setVerifiedFor(current);
      onTicket(ticket);
    } catch (err: any) {
      setError(err.message || 'That code did not work.');
    } finally {
      setBusy(false);
    }
  }

  if (verifiedFor === current && current) {
    return (
      <Alert severity="success" sx={{ py: 0.25 }}>
        Phone number verified
      </Alert>
    );
  }

  const canSend = looksLikePhone(current) && !disabled && !busy && cooldown === 0;
  const sent = sentTo === current;

  return (
    <Stack spacing={1}>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 1 }}>
        <Button variant="outlined" size="small" onClick={send} disabled={!canSend} sx={{ whiteSpace: 'nowrap', mt: 0.5 }}>
          {sent ? (cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code') : 'Send WhatsApp code'}
        </Button>
        {sent && (
          <>
            <TextField
              size="small"
              label="6-digit code"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={disabled || busy}
              helperText={devNotice || undefined}
              slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6, 'aria-label': 'Verification code' } }}
              sx={{ maxWidth: 150 }}
            />
            <Button variant="contained" size="small" onClick={verify} disabled={disabled || busy || code.length !== 6} sx={{ mt: 0.5 }}>
              Verify
            </Button>
          </>
        )}
      </Stack>
      {error && (
        <Typography variant="caption" color="error" role="alert">
          {error}
        </Typography>
      )}
    </Stack>
  );
};
