// src/App.js
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { globalStyles } from './lib/tokens';

import AppLayout        from './components/layout/AppLayout';
import AuthScreen       from './components/screens/AuthScreen';
import OnboardingScreen from './components/screens/OnboardingScreen';
import HomeScreen       from './components/screens/HomeScreen';
import ProjectsScreen   from './components/screens/ProjectsScreen';
import BrainDumpScreen  from './components/screens/BrainDumpScreen';
import AdvisorScreen    from './components/screens/AdvisorScreen';
import { DebtScreen, ReviewScreen, DecisionsScreen, IdeasScreen, LifeScreen } from './components/screens/OtherScreens';
import TasksScreen from './components/screens/TasksScreen';

// Inject global styles once
const styleEl = document.createElement('style');
styleEl.textContent = globalStyles;
document.head.appendChild(styleEl);

function AppRoutes() {
  const { user, loading, isOnboarded } = useAuth();

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
      <AppLayout>
        <Routes>
          <Route path="/"           element={<HomeScreen />}      />
          <Route path="/tasks"      element={<TasksScreen />} />
          <Route path="/projects"   element={<ProjectsScreen />}  />
          <Route path="/brain-dump" element={<BrainDumpScreen />} />
          <Route path="/advisor"    element={<AdvisorScreen />}   />
          <Route path="/review"     element={<ReviewScreen />}    />
          <Route path="/decisions"  element={<DecisionsScreen />} />
          <Route path="/ideas"      element={<IdeasScreen />}     />
          <Route path="/debt"       element={<DebtScreen />}      />
          <Route path="/life"       element={<LifeScreen />}      />
          <Route path="*"           element={<Navigate to="/" />} />
        </Routes>
      </AppLayout>
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
