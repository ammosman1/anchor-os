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

  // Auto-stall active projects that haven't been updated in 5+ days.
  // Debounced to avoid firing on every rapid snapshot update.
  const stallTimerRef = useRef(null);
  useEffect(() => {
    if (!user || !projects.length) return;
    clearTimeout(stallTimerRef.current);
    stallTimerRef.current = setTimeout(() => {
      const FIVE_DAYS = 5 * 24 * 60 * 60 * 1000;
      projects
        .filter(p => {
          if (p.status !== 'active') return false;
          const last = p.updatedAt?.toDate?.() || (p.updatedAt ? new Date(p.updatedAt) : new Date(0));
          return (Date.now() - last.getTime()) > FIVE_DAYS;
        })
        .forEach(p => updateProject(user.uid, p.id, { status: 'stalled' }));
    }, 2000);
    return () => clearTimeout(stallTimerRef.current);
  }, [projects, user]); // eslint-disable-line

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
