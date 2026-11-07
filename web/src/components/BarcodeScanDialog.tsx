import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';

interface Props {
  open: boolean;
  onClose: () => void;
  onScanned: (text: string) => void;
}

// The browser's own barcode reader (Chrome on Android and desktop Chrome/Edge). Where it does not exist the form still works with a USB
// barcode scanner (it types into the field like a keyboard) or by typing the ID.
export const barcodeScanSupported = (): boolean => typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

export const BarcodeScanDialog: React.FC<Props> = ({ open, onClose, onScanned }) => {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    setError(null);
    (async () => {
      try {
        const Detector = (window as any).BarcodeDetector;
        const detector = new Detector({ formats: ['code_128', 'code_39', 'qr_code', 'ean_13', 'ean_8', 'data_matrix', 'itf', 'upc_a'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const found = await detector.detect(video.current);
            if (found.length && found[0].rawValue) {
              onScanned(String(found[0].rawValue).trim());
              return;
            }
          } catch {
            // a frame that cannot be read: try the next one
          }
          timer = window.setTimeout(tick, 250);
        };
        tick();
      } catch (err: any) {
        setError(err?.name === 'NotAllowedError' ? 'Camera access was refused. Allow the camera, or type the ID.' : 'The camera could not be started.');
      }
    })();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [open, onScanned]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Scan the barcode on the starter's box</DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="warning">{error}</Alert>
        ) : (
          <Box sx={{ borderRadius: 2, overflow: 'hidden', bgcolor: '#000' }}>
            <video ref={video} muted playsInline style={{ width: '100%', display: 'block' }} />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
};
