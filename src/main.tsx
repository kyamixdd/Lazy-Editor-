import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (typeof (Promise as unknown as { try?: unknown }).try !== 'function') {
  (Promise as unknown as { try: <T, A extends unknown[]>(fn: (...args: A) => T | PromiseLike<T>, ...args: A) => Promise<T> }).try =
    function (fn, ...args) {
      return new Promise((resolve) => resolve(fn(...args)));
    };
}

class AppErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep diagnostics useful without exposing document contents or API keys.
    console.error('Lazy Editor UI recovery boundary:', error.message, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#0b0b0d', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
          <section style={{ width: 'min(100%, 520px)', padding: 28, border: '1px solid #ffffff24', borderRadius: 18, background: '#17171b' }}>
            <h1 style={{ margin: '0 0 10px', fontSize: 22 }}>Lazy Editor recovered from an error</h1>
            <p style={{ color: '#c4c4cc', lineHeight: 1.6 }}>
              A screen component stopped unexpectedly. Your saved projects remain in this browser's local storage. Reload the application to recover; do not clear your browser data.
            </p>
            <button onClick={() => window.location.reload()} style={{ marginTop: 12, border: 0, borderRadius: 10, padding: '12px 18px', background: '#fff', color: '#111', fontWeight: 650, cursor: 'pointer' }}>
              Reload Lazy Editor
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Lazy Editor root element was not found.');
createRoot(rootElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
