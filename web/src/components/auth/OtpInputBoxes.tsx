import React, { useRef, useEffect } from 'react';
import { Box } from '@mui/material';

interface OtpInputBoxesProps {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  length?: number;
}

export const OtpInputBoxes: React.FC<OtpInputBoxesProps> = ({
  value,
  onChange,
  disabled = false,
  length = 6
}) => {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    // Focus first input on mount if empty
    if (!value && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, idx: number) => {
    const rawChar = e.target.value.slice(-1);
    if (!/^\d*$/.test(rawChar)) return;

    const chars = value.split('');
    while (chars.length < length) chars.push('');
    chars[idx] = rawChar;

    const newVal = chars.join('').slice(0, length);
    onChange(newVal);

    // Auto-advance to next input if digit entered
    if (rawChar && idx < length - 1 && inputRefs.current[idx + 1]) {
      inputRefs.current[idx + 1]?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'Backspace') {
      if (!value[idx] && idx > 0 && inputRefs.current[idx - 1]) {
        // If current is empty, move back and clear previous
        const chars = value.split('');
        chars[idx - 1] = '';
        onChange(chars.join(''));
        inputRefs.current[idx - 1]?.focus();
      } else {
        const chars = value.split('');
        chars[idx] = '';
        onChange(chars.join(''));
      }
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowRight' && idx < length - 1) {
      inputRefs.current[idx + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text/plain').replace(/\D/g, '').slice(0, length);
    if (pastedData) {
      onChange(pastedData);
      const focusIndex = Math.min(pastedData.length, length - 1);
      inputRefs.current[focusIndex]?.focus();
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        gap: { xs: 1, sm: 1.5 },
        my: 1.5
      }}
      onPaste={handlePaste}
    >
      {Array.from({ length }).map((_, idx) => {
        const char = value[idx] || '';
        return (
          <Box
            key={idx}
            component="input"
            ref={el => (inputRefs.current[idx] = el as HTMLInputElement | null)}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={char}
            disabled={disabled}
            onChange={e => handleChange(e, idx)}
            onKeyDown={e => handleKeyDown(e, idx)}
            sx={{
              width: { xs: 44, sm: 52 },
              height: { xs: 50, sm: 58 },
              fontSize: { xs: '1.25rem', sm: '1.5rem' },
              fontWeight: 800,
              fontFamily: "'Space Grotesk', monospace",
              textAlign: 'center',
              borderRadius: 2.5,
              border: '2px solid',
              borderColor: char ? '#2563EB' : '#CBD5E1',
              bgcolor: char ? '#EFF6FF' : '#FFFFFF',
              color: '#0F172A',
              outline: 'none',
              transition: 'all 0.15s ease',
              '&:focus': {
                borderColor: '#2563EB',
                bgcolor: '#FFFFFF',
                boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.18)'
              },
              '&:disabled': {
                bgcolor: '#F1F5F9',
                borderColor: '#E2E8F0',
                color: '#94A3B8'
              }
            }}
          />
        );
      })}
    </Box>
  );
};
