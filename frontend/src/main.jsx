import React from 'react';
import ReactDOM from 'react-dom/client';
// Tailwind first, and it stays first. Its utilities live in @layer, and
// unlayered CSS always outranks layered CSS regardless of import order — so
// App.css wins any conflict by construction. That is deliberate: Tailwind is
// available for new components without being able to disturb existing ones.
import './tailwind.css';
import App from './App.jsx';
import { warmBackend } from './lib/api';

// BEFORE React renders, not inside an effect. The backend takes 22.5s to boot
// from cold and 0.21s warm; the only lever we have is starting that boot during
// the dead time the user spends loading Clerk and typing their password, rather
// than after it. Every millisecond earlier this fires is a millisecond off the
// wait. It is fire-and-forget and cannot fail the app — see warmBackend.
warmBackend();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
