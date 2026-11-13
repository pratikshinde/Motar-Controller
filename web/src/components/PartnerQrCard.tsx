import React, { useRef } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import DownloadIcon from '@mui/icons-material/Download';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { renderToStaticMarkup } from 'react-dom/server';
import { claimLinkFor, type PartnerClaim } from '../api/users';
import { useToast } from '../context/ToastContext';
import { useBrandName } from '../hooks/useBrandName';

interface Props {
  name: string;
  phone: string;
  /** "Distributor", "Dealer / Installer" … for the print sheet. */
  roleLabel: string;
  claim: PartnerClaim;
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

function expiryText(iso: string) {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  return days > 0 ? `Works once, within ${days} day${days === 1 ? '' : 's'}.` : 'Expired.';
}

/** A distributor's or dealer's one-time sign-up QR, with a print sheet to hand over, a PNG, and the plain link to send on WhatsApp.
 *  It opens the website's claim page: they type their registered mobile number and choose a password. Shown once; the server keeps no readable copy. */
export const PartnerQrCard: React.FC<Props> = ({ name, phone, roleLabel, claim }) => {
  const { showToast } = useToast();
  const brand = useBrandName();
  const canvasHost = useRef<HTMLDivElement>(null);
  const link = claimLinkFor(claim.token);

  const print = () => {
    const svg = renderToStaticMarkup(<QRCodeSVG value={link} size={300} level="M" includeMargin />);
    const win = window.open('', '_blank', 'width=520,height=720');
    if (!win) {
      showToast('Allow pop-ups to print the QR card', true);
      return;
    }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Sign-up QR</title>
      <style>body{font-family:Arial,sans-serif;text-align:center;margin:24px;color:#111}
      h1{font-size:20px;margin:0 0 4px}p{margin:4px 0;font-size:14px}.note{margin-top:16px;font-size:13px;color:#444}
      .box{display:inline-block;border:2px dashed #999;padding:12px;margin-top:12px;border-radius:12px}</style></head><body>
      <h1>${esc(brand)}</h1>
      <p><b>${esc(name)}</b> &middot; ${esc(roleLabel)}</p>
      <p>${esc(phone)}</p>
      <div class="box">${svg}</div>
      <p class="note">Scan this with your phone camera, type your mobile number,<br/>then choose a password. After that you sign in on the website<br/>with your mobile number and password.<br/>This QR works only once. Keep it private.</p>
      <script>window.onload=function(){window.print();}</script></body></html>`);
    win.document.close();
  };

  const download = () => {
    const canvas = canvasHost.current?.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `signup-qr-${name.replace(/\s+/g, '-').toLowerCase()}.png`;
    a.click();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      showToast('Link copied');
    } catch {
      showToast('Could not copy. Select the link and copy it.', true);
    }
  };

  return (
    <Stack spacing={1.5} sx={{ alignItems: 'center' }} data-testid="partner-qr">
      <Box sx={{ bgcolor: '#fff', p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', lineHeight: 0 }}>
        <QRCodeSVG value={link} size={220} level="M" />
      </Box>
      <Box ref={canvasHost} sx={{ display: 'none' }}>
        <QRCodeCanvas value={link} size={640} level="M" includeMargin />
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 700 }}>
        {name} · {phone}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
        {expiryText(claim.expires_at)} They scan it, type this mobile number and choose a password. Keep it private: whoever opens it first and
        knows the number gets the account.
      </Typography>
      <Typography
        variant="caption"
        data-testid="partner-qr-link"
        sx={{ wordBreak: 'break-all', textAlign: 'center', fontFamily: 'monospace', px: 1 }}
      >
        {link}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'center', rowGap: 1 }}>
        <Button size="small" variant="outlined" startIcon={<ContentCopyIcon />} onClick={copy}>
          Copy link
        </Button>
        <Button size="small" variant="outlined" startIcon={<PrintIcon />} onClick={print}>
          Print
        </Button>
        <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={download}>
          Download PNG
        </Button>
      </Stack>
    </Stack>
  );
};
