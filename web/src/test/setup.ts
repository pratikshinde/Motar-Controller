import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom cannot draw on a canvas (the QR's download copy is drawn on one): a canvas that draws nothing keeps the output quiet.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

// Each test starts from an empty page.
afterEach(() => cleanup());
