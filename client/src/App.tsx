import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, put, type Settings } from './api';
import { setZone } from './format';
import { JobsProvider, useJobs } from './ui';
import Dashboard from './pages/Dashboard';
import Today from './pages/Today';
import Problems from './pages/Problems';
import Contests from './pages/Contests';
import Calendar from './pages/Calendar';
import Reviews from './pages/Reviews';
import Lists from './pages/Lists';
import Accounts from './pages/Accounts';

interface SettingsCtx {
  settings: Settings;
  save: (patch: Settings) => Promise<void>;
}
const SettingsContext = createContext<SettingsCtx>({ settings: {}, save: async () => {} });
export const useSettings = () => useContext(SettingsContext);

const icon = (d: string) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const NAV = [
  { to: '/', label: 'Dashboard', icon: icon('M2.5 2.5h4.5v5h-4.5zM9 2.5h4.5v3H9zM9 7.5h4.5v6H9zM2.5 9.5h4.5v4h-4.5z') },
  { to: '/today', label: 'Today', icon: icon('M8 1.8v1.5M8 12.7v1.5M1.8 8h1.5M12.7 8h1.5M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z') },
  { to: '/problems', label: 'Problems', icon: icon('M3 2.5h10v11H3zM5.5 5.5h5M5.5 8h5M5.5 10.5h3') },
  { to: '/contests', label: 'Contests', icon: icon('M5 2.5h6v3.5a3 3 0 0 1-6 0zM5 3.5H2.5V5a2 2 0 0 0 2.5 2M11 3.5h2.5V5A2 2 0 0 1 11 7M8 9v2.5M5.5 13.5h5M6.5 11.5h3v2h-3z') },
  { to: '/calendar', label: 'Calendar', icon: icon('M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3') },
  { to: '/reviews', label: 'Reviews', icon: icon('M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.5H11M8 5v3l2 1.5'), badge: 'reviews' as const },
  { to: '/lists', label: 'Problem lists', icon: icon('M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.5M2.5 8h.5M2.5 12h.5') },
  { to: '/accounts', label: 'Accounts & settings', icon: icon('M8 8.2a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4ZM2.8 13.5c.6-2.4 2.7-3.8 5.2-3.8s4.6 1.4 5.2 3.8') },
];

function Shell({ settings }: { settings: Settings }) {
  const { generation } = useJobs();
  const [due, setDue] = useState(0);
  useEffect(() => {
    api<{ today: string; items: { dueDate: string }[] }>('/reviews')
      .then((r) => setDue(r.items.filter((i) => i.dueDate <= r.today).length))
      .catch(() => {});
  }, [generation]);
  useEffect(() => {
    const onReviews = (e: Event) => setDue((e as CustomEvent<number>).detail);
    window.addEventListener('reviews-due', onReviews);
    return () => window.removeEventListener('reviews-due', onReviews);
  }, []);

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="brand-mark">IC</div>
          <div>
            <b>ICPC Practice</b>
            <span>{settings.regional ? settings.regional : 'Training workbench'}</span>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>
              {n.icon}
              {n.label}
              {n.badge === 'reviews' && due > 0 && <span className="count">{due}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">Runs locally · data stays on this computer</div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/today" element={<Today />} />
          <Route path="/problems" element={<Problems />} />
          <Route path="/contests" element={<Contests />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/lists" element={<Lists />} />
          <Route path="/lists/:id" element={<Lists />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    api<Settings>('/settings').then((s) => {
      setZone(s.timezone);
      setSettings(s);
    });
  }, []);
  const save = useCallback(async (patch: Settings) => {
    const s = await put<Settings>('/settings', patch);
    setZone(s.timezone);
    setSettings(s);
  }, []);
  if (!settings) return null;
  return (
    <SettingsContext.Provider value={{ settings, save }}>
      <JobsProvider>
        <Shell settings={settings} />
      </JobsProvider>
    </SettingsContext.Provider>
  );
}
