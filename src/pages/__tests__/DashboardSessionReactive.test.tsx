// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { saveAllSessions } from '../../utils/storage';
import type { VideoStudySession } from '../../types';

vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { BarChart: Stub, Bar: Stub, XAxis: Stub, YAxis: Stub, Tooltip: Stub, ResponsiveContainer: Stub, PieChart: Stub, Pie: Stub, Cell: Stub, AreaChart: Stub, Area: Stub };
});
vi.mock('../../i18n/I18nContext', () => ({ useI18n: () => ({ t: (key: string) => key, lang: 'en' }) }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../services/youtubeApi', () => ({ getRecentVideosFromChannel: vi.fn(), hasApiKey: () => false }));
vi.mock('../../services/sessionDeletionSync', () => ({ syncDeletedSessions: vi.fn() }));
vi.mock('../../config/targetChannel', () => ({ TARGET_CHANNEL: { input: 'test' } }));

import DashboardPage from '../DashboardPage';

const session = (id: string, title: string): VideoStudySession => ({
  id, youtubeUrl: `https://youtu.be/${id}`, youtubeId: id, title,
  transcriptLines: [], createdAt: Date.now(), updatedAt: Date.now(), status: 'studying',
});

describe('Dashboard session change subscription', () => {
  beforeEach(() => localStorage.clear());

  it('refreshes mounted session UI when persisted sessions change', () => {
    saveAllSessions([session('a', 'Session A')]);
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(screen.getByText('Session A')).toBeTruthy();

    act(() => saveAllSessions([session('b', 'Session B')]));

    expect(screen.getByText('Session B')).toBeTruthy();
    expect(screen.queryByText('Session A')).toBeNull();
  });
});
