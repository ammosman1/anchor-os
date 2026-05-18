// src/context/DataContext.js
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import {
  subscribeProjects, subscribeTasks, subscribeDebtAccounts,
  subscribeIdeas, subscribeDecisions, subscribeBrainDumps,
  subscribeWeeklyReviews, subscribeGoals, subscribeCalendarIntegration,
  subscribePlaidItems, subscribeProfile, subscribeDailyReviews, updateProject,
} from '../lib/db';
import { setUserPersona } from '../lib/ai';
import { calculateMomentum } from '../lib/momentum';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { user } = useAuth();
  const [projects,      setProjects]      = useState([]);
  const [tasks,         setTasks]         = useState([]);
  const [debtAccounts,  setDebtAccounts]  = useState([]);
  const [ideas,         setIdeas]         = useState([]);
  const [decisions,     setDecisions]     = useState([]);
  const [brainDumps,    setBrainDumps]    = useState([]);
  const [weeklyReviews, setWeeklyReviews] = useState([]);
  const [goals,               setGoals]               = useState([]);
  const [calendarIntegration, setCalendarIntegration] = useState(null);
  const [plaidItems,          setPlaidItems]          = useState([]);
  const [userProfile,         setUserProfile]         = useState(null);
  const [dailyReviews,        setDailyReviews]        = useState([]);
  const [loaded,              setLoaded]              = useState(false);

  useEffect(() => {
    if (!user) {
      setProjects([]); setTasks([]); setDebtAccounts([]);
      setIdeas([]); setDecisions([]); setBrainDumps([]);
      setWeeklyReviews([]); setGoals([]); setCalendarIntegration(null); setPlaidItems([]);
      setDailyReviews([]); setLoaded(false);
      return;
    }

    const unsubs = [
      subscribeProjects(user.uid,      setProjects),
      subscribeTasks(user.uid,         setTasks),
      subscribeDebtAccounts(user.uid,  setDebtAccounts),
      subscribeIdeas(user.uid,         setIdeas),
      subscribeDecisions(user.uid,     setDecisions),
      subscribeBrainDumps(user.uid,    setBrainDumps),
      subscribeWeeklyReviews(user.uid, setWeeklyReviews),
      subscribeGoals(user.uid,               setGoals),
      subscribeCalendarIntegration(user.uid, setCalendarIntegration),
      subscribePlaidItems(user.uid,          setPlaidItems),
      subscribeDailyReviews(user.uid,        setDailyReviews),
      subscribeProfile(user.uid, (prof) => {
        setUserProfile(prof);
        if (prof?.persona) setUserPersona(prof.persona);
      }),
    ];

    setLoaded(true);
    return () => unsubs.forEach(u => u());
  }, [user]);

  // Single source of truth for project stall/reactivation status.
  // Debounced to avoid firing on every rapid snapshot update.
  // Uses task activity (not just project.updatedAt) so working through tasks
  // doesn't incorrectly stall a project.
  const stallTimerRef = useRef(null);
  useEffect(() => {
    if (!user || !projects.length) return;
    clearTimeout(stallTimerRef.current);
    stallTimerRef.current = setTimeout(() => {
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

      const latestActivity = (project) => {
        let ms = project.updatedAt?.toDate?.().getTime()
          ?? (project.updatedAt ? new Date(project.updatedAt).getTime() : 0);
        for (const t of tasks.filter(t => t.projectId === project.id)) {
          const tMs = Math.max(
            t.completedAt ? new Date(t.completedAt).getTime() : 0,
            t.updatedAt?.toDate?.().getTime() ?? (t.updatedAt ? new Date(t.updatedAt).getTime() : 0),
          );
          if (tMs > ms) ms = tMs;
        }
        return ms;
      };

      projects.forEach(p => {
        const lastMs = latestActivity(p);
        const idle = lastMs > 0 && (Date.now() - lastMs) > SEVEN_DAYS;
        const projectTasks = tasks.filter(t => t.projectId === p.id);
        const { score: mScore } = calculateMomentum(p, projectTasks);

        if (p.status === 'active' && idle && mScore <= 50) {
          updateProject(user.uid, p.id, { status: 'stalled' });
        } else if (p.status === 'stalled' && (!idle || mScore > 50)) {
          updateProject(user.uid, p.id, { status: 'active' });
        }
      });
    }, 2000);
    return () => clearTimeout(stallTimerRef.current);
  }, [projects, tasks, user]); // eslint-disable-line

  // Derived data
  const activeProjects  = projects.filter(p => p.status === 'active');
  const stalledProjects = projects.filter(p => p.status === 'stalled');
  const todayTasks      = tasks.filter(t => !t.done && (t.priority === 'critical' || t.priority === 'high' || t.source === 'brain-dump' || !t.projectId));
  const totalDebt       = debtAccounts.reduce((s, a) => s + (a.balance || 0), 0);
  const activeGoals     = goals.filter(g => g.status === 'active');

  return (
    <DataContext.Provider value={{
      projects, tasks, debtAccounts, ideas, decisions, brainDumps, weeklyReviews, goals, calendarIntegration, plaidItems, userProfile, dailyReviews,
      activeProjects, stalledProjects, todayTasks, totalDebt, activeGoals,
      loaded,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export const useData = () => useContext(DataContext);
