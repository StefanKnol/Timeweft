import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

const rootElement = document.getElementById('root');
if (rootElement === null) throw new Error('The page has no #root to draw into.');
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
