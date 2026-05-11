// src/context/DataContext.js
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import {
  subscribeProjects, subscribeTasks, subscribeDebtAccounts,
  subscribeIdeas, subscribeDecisions, subscribeBrainDumps,
  subscribeWeeklyReviews,
} from '../lib/db';

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
  const [loaded,        setLoaded]        = useState(false);

  useEffect(() => {
    if (!user) {
      setProjects([]); setTasks([]); setDebtAccounts([]);
      setIdeas([]); setDecisions([]); setBrainDumps([]);
      setWeeklyReviews([]); setLoaded(false);
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
    ];

    setLoaded(true);
    return () => unsubs.forEach(u => u());
  }, [user]);

  // Derived data
  const activeProjects  = projects.filter(p => p.status === 'active');
  const stalledProjects = projects.filter(p => p.status === 'stalled');
  const todayTasks      = tasks.filter(t => !t.done && t.priority !== 'later');
  const totalDebt       = debtAccounts.reduce((s, a) => s + (a.balance || 0), 0);

  return (
    <DataContext.Provider value={{
      projects, tasks, debtAccounts, ideas, decisions, brainDumps, weeklyReviews,
      activeProjects, stalledProjects, todayTasks, totalDebt,
      loaded,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export const useData = () => useContext(DataContext);
