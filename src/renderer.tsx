import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { HoldOverlay } from './components/hold-overlay';
import './index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Renderer root element is missing.');
}

const overlay = window.location.hash === '#overlay';

createRoot(container).render(
  <StrictMode>{overlay ? <HoldOverlay /> : <App />}</StrictMode>,
);
