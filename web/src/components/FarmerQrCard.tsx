import React, { useRef } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import DownloadIcon from '@mui/icons-material/Download';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FarmerSummary, FarmerPump, FarmerQr } from '../api/farmers';
import { useToast } from '../context/ToastContext';

interface Props {
  farmer: FarmerSummary;
  pump?: FarmerPump | null;
  qr: FarmerQr;
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

function expiryText(iso: string | null) {
  if (!iso) return '';
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  return days > 0 ? `Works once, within ${days} day${days === 1 ? '' : 's'}.` : 'Expired.';
}

/** The farmer's one-time QR code with a print sheet to hand over and a PNG to send. It is shown once: the server keeps no readable copy. */
export const FarmerQrCard: React.FC<Props> = ({ farmer, pump, qr }) => {
  const { showToast } = useToast();
  const canvasHost = useRef<HTMLDivElement>(null);
  if (!qr.payload) return null;
  const payload = qr.payload;

  const print = () => {
    const svg = renderToStaticMarkup(<QRCodeSVG value={payload} size={300} level="M" includeMargin />);
    const win = window.open('', '_blank', 'width=520,height=720');
    if (!win) {
      showToast('Allow pop-ups to print the QR card', true);
      return;
    }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Farmer QR</title>
      <style>body{font-family:Arial,sans-serif;text-align:center;margin:24px;color:#111}
      h1{font-size:20px;margin:0 0 4px}p{margin:4px 0;font-size:14px}.note{margin-top:16px;font-size:13px;color:#444}
      .box{display:inline-block;border:2px dashed #999;padding:12px;margin-top:12px;border-radius:12px}</style></head><body>
      <h1>Ajanta Pump Controller</h1>
      <p><b>${esc(farmer.full_name)}</b> &middot; ${esc(farmer.phone_number)}</p>
      ${pump ? `<p>Starter ${esc(pump.id)}${pump.hp_rating ? ` &middot; ${pump.hp_rating} HP` : ''}</p>` : ''}
      <div class="box">${svg}</div>
      <p class="note">Open the Ajanta Pump Controller app, tap <b>Scan QR</b>, point the camera here,<br/>then type your mobile number.<br/>This QR works only once. Keep it private.</p>
      <script>window.onload=function(){window.print();}</script></body></html>`);
    win.document.close();
  };

  const download = () => {
    const canvas = canvasHost.current?.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `farmer-qr-${farmer.full_name.replace(/\s+/g, '-').toLowerCase()}.png`;
    link.click();
  };

  return (
    <Stack spacing={1.5} sx={{ alignItems: 'center' }} data-testid="farmer-qr">
      <Box sx={{ bgcolor: '#fff', p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', lineHeight: 0 }}>
        <QRCodeSVG value={payload} size={240} level="M" />
      </Box>
      <Box ref={canvasHost} sx={{ display: 'none' }}>
        <QRCodeCanvas value={payload} size={640} level="M" includeMargin />
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 700 }}>
        {farmer.full_name} · {farmer.phone_number}
      </Typography>
      {pump && (
        <Typography variant="caption" color="text.secondary">
          Starter {pump.id}
          {pump.hp_rating ? ` · ${pump.hp_rating} HP` : ''}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
        {expiryText(qr.expires_at)} Keep it private: whoever scans it first and knows the farmer's number gets the farmer's pump.
      </Typography>
      <Stack direction="row" spacing={1}>
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
