// src/context/DataContext.js
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import {
  subscribeProjects, subscribeTasks, subscribeDebtAccounts,
  subscribeIdeas, subscribeBrainDumps,
  subscribeWeeklyReviews, subscribeGoals, subscribeCalendarIntegration,
  subscribePlaidItems, subscribeProfile, subscribeDailyReviews, updateProject,
  subscribeManualCashFlow, subscribeAssetAccounts,
  subscribeHabits, subscribeHabitLogs, subscribeNotes, subscribeDocuments,
  subscribeSavingsAnalysis, subscribeSavingsAnalysisHistory, subscribeLastWeeklyReset,
  subscribeActedOnRecommendations, saveBrainDumpDigest, subscribeBrainDumpDigests,
  subscribeHealthLogs,
} from '../lib/db';
import { setUserPersona, generateWeeklyBrainDumpDigest } from '../lib/ai';
import { calculateMomentum } from '../lib/momentum';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { user } = useAuth();
  const [projects,      setProjects]      = useState([]);
  const [tasks,         setTasks]         = useState([]);
  const [debtAccounts,  setDebtAccounts]  = useState([]);
  const [ideas,         setIdeas]         = useState([]);
  const [brainDumps,    setBrainDumps]    = useState([]);
  const [weeklyReviews, setWeeklyReviews] = useState([]);
  const [goals,               setGoals]               = useState([]);
  const [calendarIntegration, setCalendarIntegration] = useState(null);
  const [plaidItems,          setPlaidItems]          = useState([]);
  const [userProfile,         setUserProfile]         = useState(null);
  const [dailyReviews,        setDailyReviews]        = useState([]);
  const [manualCashFlow,      setManualCashFlow]      = useState(null);
  const [assetAccounts,       setAssetAccounts]       = useState([]);
  const [habits,              setHabits]              = useState([]);
  const [habitLogs,           setHabitLogs]           = useState([]);
  const [notes,               setNotes]               = useState([]);
  const [documents,           setDocuments]           = useState([]);
  const [savingsAnalysis,         setSavingsAnalysis]         = useState(null);
  const [savingsHistory,          setSavingsHistory]          = useState([]);
  const [lastWeeklyReset,         setLastWeeklyReset]         = useState(null);
  const [actedOnRecommendations,  setActedOnRecommendations]  = useState([]);
  const [brainDumpDigests,        setBrainDumpDigests]        = useState([]);
  const [healthLogs,              setHealthLogs]              = useState([]);
  const [loaded,              setLoaded]              = useState(false);
  const digestingRef = useRef(false);

  useEffect(() => {
    if (!user) {
      setProjects([]); setTasks([]); setDebtAccounts([]);
      setIdeas([]); setBrainDumps([]);
      setWeeklyReviews([]); setGoals([]); setCalendarIntegration(null); setPlaidItems([]);
      setDailyReviews([]); setManualCashFlow(null); setAssetAccounts([]);
      setHabits([]); setHabitLogs([]); setNotes([]); setDocuments([]);
      setSavingsAnalysis(null); setSavingsHistory([]); setLastWeeklyReset(null);
      setActedOnRecommendations([]); setBrainDumpDigests([]); setHealthLogs([]);
      setLoaded(false);
      return;
    }

    const unsubs = [
      subscribeProjects(user.uid,      setProjects),
      subscribeTasks(user.uid,         setTasks),
      subscribeDebtAccounts(user.uid,  setDebtAccounts),
      subscribeIdeas(user.uid,         setIdeas),
      subscribeBrainDumps(user.uid,    setBrainDumps),
      subscribeWeeklyReviews(user.uid, setWeeklyReviews),
      subscribeGoals(user.uid,               setGoals),
      subscribeCalendarIntegration(user.uid, setCalendarIntegration),
      subscribePlaidItems(user.uid,          setPlaidItems),
      subscribeDailyReviews(user.uid,        setDailyReviews),
      subscribeManualCashFlow(user.uid,      setManualCashFlow),
      subscribeAssetAccounts(user.uid,       setAssetAccounts),
      subscribeHabits(user.uid,              setHabits),
      subscribeHabitLogs(user.uid,           setHabitLogs),
      subscribeNotes(user.uid,               setNotes),
      subscribeDocuments(user.uid,           setDocuments),
      subscribeSavingsAnalysis(user.uid,          setSavingsAnalysis),
      subscribeSavingsAnalysisHistory(user.uid,   setSavingsHistory),
      subscribeLastWeeklyReset(user.uid,          setLastWeeklyReset),
      subscribeActedOnRecommendations(user.uid,   setActedOnRecommendations),
      subscribeBrainDumpDigests(user.uid,         setBrainDumpDigests),
      subscribeHealthLogs(user.uid,               setHealthLogs),
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
  }, [projects, tasks, user]); // eslint-disable-line react-hooks/exhaustive-deps -- updateProject is a stable db import, not a reactive value

  // Auto-generate weekly brain dump digests for weeks older than 14 days.
  // Processes one missing week per effect run so we never hammer the AI.
  useEffect(() => {
    if (!user || !brainDumps.length || digestingRef.current) return;

    const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - FOURTEEN_DAYS;

    const oldDumps = brainDumps.filter(d => {
      const ms = d.createdAt?.toMillis?.() || (d.createdAt ? new Date(d.createdAt).getTime() : 0);
      return ms > 0 && ms < cutoff;
    });
    if (!oldDumps.length) return;

    // Group by week (ISO Monday date string)
    const getMondayKey = (date) => {
      const d = new Date(date);
      const day = d.getDay();
      d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
      d.setHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 10);
    };

    const byWeek = {};
    oldDumps.forEach(d => {
      const ms = d.createdAt?.toMillis?.() || new Date(d.createdAt).getTime();
      const key = getMondayKey(new Date(ms));
      if (!byWeek[key]) byWeek[key] = [];
      byWeek[key].push(d);
    });

    const existingKeys = new Set(brainDumpDigests.map(d => d.id));
    const missing = Object.entries(byWeek).find(([k]) => !existingKeys.has(k));
    if (!missing) return;

    const [weekKey, entries] = missing;
    digestingRef.current = true;
    generateWeeklyBrainDumpDigest(entries)
      .then(digest => {
        if (!digest) return;
        const end = new Date(weekKey);
        end.setDate(end.getDate() + 6);
        saveBrainDumpDigest(user.uid, weekKey, {
          weekStart: weekKey,
          weekEnd:   end.toISOString().slice(0, 10),
          digest,
          entryCount: entries.length,
        });
      })
      .catch(() => {})
      .finally(() => { digestingRef.current = false; });
  }, [brainDumps, brainDumpDigests, user]); // eslint-disable-line react-hooks/exhaustive-deps -- saveBrainDumpDigest and generateWeeklyBrainDumpDigest are stable module imports

  // Derived data
  const activeProjects  = projects.filter(p => p.status === 'active');
  const stalledProjects = projects.filter(p => p.status === 'stalled');
  const todayTasks      = tasks.filter(t => !t.done && (t.priority === 'critical' || t.priority === 'high' || t.source === 'brain-dump' || !t.projectId));
  const totalDebt       = debtAccounts.reduce((s, a) => s + (a.balance || 0), 0);
  const totalAssets     = assetAccounts.reduce((s, a) => s + (a.balance || 0), 0);
  const activeGoals     = goals.filter(g => g.status === 'active');

  return (
    <DataContext.Provider value={{
      projects, tasks, debtAccounts, assetAccounts, ideas, brainDumps, weeklyReviews, goals, calendarIntegration, plaidItems, userProfile, dailyReviews, manualCashFlow,
      habits, habitLogs, notes, documents, savingsAnalysis, savingsHistory, lastWeeklyReset, actedOnRecommendations,
      brainDumpDigests, healthLogs,
      activeProjects, stalledProjects, todayTasks, totalDebt, totalAssets, activeGoals,
      loaded,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export const useData = () => useContext(DataContext);
