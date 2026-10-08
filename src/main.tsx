import '@fontsource-variable/bricolage-grotesque/wght.css';
import '@fontsource-variable/plus-jakarta-sans/wght.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import { captureInstallPrompt } from './state/install';

captureInstallPrompt();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
