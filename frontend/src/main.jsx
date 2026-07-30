import React from 'react';
import ReactDOM from 'react-dom/client';
// Tailwind first, and it stays first. Its utilities live in @layer, and
// unlayered CSS always outranks layered CSS regardless of import order — so
// App.css wins any conflict by construction. That is deliberate: Tailwind is
// available for new components without being able to disturb existing ones.
import './tailwind.css';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
