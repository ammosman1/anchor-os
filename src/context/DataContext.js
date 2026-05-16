// src/context/DataContext.js
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import {
  subscribeProjects, subscribeTasks, subscribeDebtAccounts,
  subscribeIdeas, subscribeDecisions, subscribeBrainDumps,
  subscribeWeeklyReviews, subscribeGoals, subscribeCalendarIntegration,
  subscribePlaidItems, subscribeProfile,
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
  const [loaded,              setLoaded]              = useState(false);

  useEffect(() => {
    if (!user) {
      setProjects([]); setTasks([]); setDebtAccounts([]);
      setIdeas([]); setDecisions([]); setBrainDumps([]);
      setWeeklyReviews([]); setGoals([]); setCalendarIntegration(null); setPlaidItems([]); setLoaded(false);
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
      subscribeProfile(user.uid, (prof) => {
        setUserProfile(prof);
        if (prof?.persona) setUserPersona(prof.persona);
      }),
    ];

    setLoaded(true);
    return () => unsubs.forEach(u => u());
  }, [user]);

  // Derived data
  const activeProjects  = projects.filter(p => p.status === 'active');
  const stalledProjects = projects.filter(p => p.status === 'stalled');
  const todayTasks      = tasks.filter(t => !t.done && (t.priority === 'critical' || t.priority === 'high' || t.source === 'brain-dump' || !t.projectId));
  const totalDebt       = debtAccounts.reduce((s, a) => s + (a.balance || 0), 0);
  const activeGoals     = goals.filter(g => g.status === 'active');

  return (
    <DataContext.Provider value={{
      projects, tasks, debtAccounts, ideas, decisions, brainDumps, weeklyReviews, goals, calendarIntegration, plaidItems, userProfile,
      activeProjects, stalledProjects, todayTasks, totalDebt, activeGoals,
      loaded,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export const useData = () => useContext(DataContext);
