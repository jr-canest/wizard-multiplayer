import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import { App } from './App';
import { Home } from './routes/Home';
import { Room } from './routes/Room';
import { History } from './routes/History';
import { Me } from './routes/Me';
import { SessionProvider } from './hooks/useSession';
import { preloadCardImages } from './lib/cardImages';

preloadCardImages();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<App />}>
            <Route index element={<Home />} />
            <Route path="room/:code" element={<Room />} />
            <Route path="history" element={<History />} />
            <Route path="me" element={<Me />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  </StrictMode>,
);
