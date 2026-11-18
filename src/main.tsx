import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (typeof (Promise as unknown as { try?: unknown }).try !== 'function') {
  (Promise as unknown as { try: <T, A extends unknown[]>(fn: (...args: A) => T | PromiseLike<T>, ...args: A) => Promise<T> }).try =
    function (fn, ...args) {
      return new Promise((resolve) => resolve(fn(...args)));
    };
}

createRoot(document.getElementById('root')!).render(<App />);
