// src/App.js
import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { PageContextProvider } from './context/PageContext';
import { globalStyles } from './lib/tokens';
import AppLayout        from './components/layout/AppLayout';
import { handleCalendarCallback } from './lib/calendar';
import AuthScreen       from './components/screens/AuthScreen';
import OnboardingScreen from './components/screens/OnboardingScreen';
import HomeScreen       from './components/screens/HomeScreen';
import ProjectsScreen   from './components/screens/ProjectsScreen';
import BrainDumpScreen  from './components/screens/BrainDumpScreen';
import AdvisorScreen    from './components/screens/AdvisorScreen';
import ReviewScreen     from './components/screens/ReviewScreen';
import TasksScreen      from './components/screens/TasksScreen';
import LifeScreen       from './components/screens/LifeScreen';
import GoalsScreen      from './components/screens/GoalsScreen';
import GoalDetailScreen     from './components/screens/GoalDetailScreen';
import ProjectDetailScreen  from './components/screens/ProjectDetailScreen';
import DebtScreen  from './components/screens/DebtScreen';
import IdeasScreen from './components/screens/IdeasScreen';
import ProfileScreen   from './components/screens/ProfileScreen';
import CalendarScreen  from './components/screens/CalendarScreen';
import HabitsScreen    from './components/screens/HabitsScreen';
import NotesScreen     from './components/screens/NotesScreen';
import DocumentsScreen from './components/screens/DocumentsScreen';
import WeeklyResetWizard from './components/screens/WeeklyResetWizard';
import HomeScreenV2      from './components/screens/HomeScreenV2';

// Inject global styles once
if (!document.getElementById('anchor-global-styles')) {
  const styleEl = document.createElement('style');
  styleEl.id = 'anchor-global-styles';
  styleEl.textContent = globalStyles;
  document.head.appendChild(styleEl);
}

function AppRoutes() {
  const { user, loading, isOnboarded } = useAuth();

  // Handle Google Calendar OAuth redirect — save tokens to Firestore, clear URL
  useEffect(() => {
    if (user && window.location.search.includes('calendarConnected=1')) {
      handleCalendarCallback(user.uid);
    }
  }, [user]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0C0E12' }}>
        <div style={{ fontSize: '24px', opacity: 0.4 }} className="pulsing">⚓</div>
      </div>
    );
  }

  if (!user)        return <AuthScreen />;
  if (!isOnboarded) return <OnboardingScreen />;

  return (
    <DataProvider>
      <PageContextProvider>
        <AppLayout>
          <Routes>
            <Route path="/"           element={<HomeScreen />}      />
            <Route path="/tasks"      element={<TasksScreen />}     />
            <Route path="/projects"              element={<ProjectsScreen />}      />
            <Route path="/projects/:projectId" element={<ProjectDetailScreen />} />
            <Route path="/brain-dump" element={<Navigate to="/" />} />
            <Route path="/advisor"    element={<Navigate to="/" />} />
            <Route path="/review"     element={<ReviewScreen />}    />
            <Route path="/ideas"      element={<IdeasScreen />}     />
            <Route path="/debt"       element={<DebtScreen />}      />
            <Route path="/life"       element={<LifeScreen />}      />
            <Route path="/goals"          element={<GoalsScreen />}      />
            <Route path="/goals/:goalId"  element={<GoalDetailScreen />} />
            <Route path="/calendar"   element={<CalendarScreen />}  />
            <Route path="/habits"     element={<HabitsScreen />}    />
            <Route path="/notes"      element={<NotesScreen />}     />
            <Route path="/documents"     element={<DocumentsScreen />}   />
            <Route path="/weekly-reset" element={<WeeklyResetWizard />} />
            <Route path="/profile"      element={<ProfileScreen />}     />
            <Route path="/home-v2"      element={<HomeScreenV2 />}      />
            <Route path="*"             element={<Navigate to="/" />}   />
          </Routes>
        </AppLayout>
      </PageContextProvider>
    </DataProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
