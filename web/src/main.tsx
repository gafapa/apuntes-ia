import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { BarreraErrores } from './components/BarreraErrores';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BarreraErrores>
      <App />
    </BarreraErrores>
  </StrictMode>,
);
