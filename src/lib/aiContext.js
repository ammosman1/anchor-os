// src/lib/aiContext.js
// Assembles full user context for all AI calls so nothing runs blind

import { calculateUrgency } from './tasks';
import { calculateMomentum } from './momentum';
import { getProjectNextAction } from './tasks';

export function buildHolisticContext({
  goals = [], tasks = [], projects = [],
  brainDumps = [], weeklyReviews = [],
  userProfile = null, plaidData = null,
  calendarDensity = null, calendarEvents = [],
  weatherForecast = null,
}) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const lines = [];
  lines.push(`=== ANCHOR LIVE CONTEXT — ${today} ===`);
  lines.push(`Energy today: ${userProfile?.energyToday ?? 'not set'}/10`);

  if (userProfile?.persona) {
    lines.push(`\nUSER PERSONA (Andrew's self-described working style — treat as non-negotiable preferences):\n${userProfile.persona}`);
  }

  // Task completion velocity (last 14 days)
  const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const recentlyCompleted = tasks.filter(t => {
    if (!t.done || !t.completedAt) return false;
    try { return new Date(t.completedAt).getTime() > twoWeeksAgo; } catch { return false; }
  });
  const completedLast14 = recentlyCompleted.length;
  const completedPerWeek = Math.round(completedLast14 / 2);
  const openTotal = tasks.filter(t => !t.done).length;
  lines.push(`\nEXECUTION VELOCITY: ${completedLast14} tasks completed in last 14 days (~${completedPerWeek}/week) | ${openTotal} open tasks total`);

  // Weather forecast
  if (weatherForecast?.forecast?.length > 0) {
    lines.push(`\nWEATHER FORECAST (${weatherForecast.location || 'local'}):`);
    weatherForecast.forecast.slice(0, 5).forEach(day => {
      const outdoor = day.outdoorFriendly ? '✓ outdoor-ok' : '✗ no-outdoor';
      lines.push(`  ${day.date}: ${day.label}, ${day.maxTemp}°F, ${day.precipProbability}% precip, wind ${day.windSpeed}mph — ${outdoor}`);
    });
    const badDays = weatherForecast.forecast.slice(0, 5).filter(d => !d.outdoorFriendly);
    if (badDays.length > 0) {
      lines.push(`  ⚠ Avoid scheduling outdoor tasks on: ${badDays.map(d => d.date).join(', ')}`);
    }
  }

  // Upcoming calendar events (next 5 days — actual titles, not just density)
  const todayMs = new Date(); todayMs.setHours(0, 0, 0, 0);
  const in5Ms = new Date(todayMs.getTime() + 5 * 24 * 60 * 60 * 1000);
  const upcomingEvents = (calendarEvents || []).filter(ev => {
    const dt = ev.start?.dateTime;
    if (!dt) return false;
    const d = new Date(dt);
    return d >= todayMs && d <= in5Ms;
  });

  if (upcomingEvents.length > 0) {
    // Group by day
    const byDay = {};
    upcomingEvents.forEach(ev => {
      const dayKey = new Date(ev.start.dateTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      if (!byDay[dayKey]) byDay[dayKey] = [];
      const timeStr = new Date(ev.start.dateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      byDay[dayKey].push(`${ev.summary || 'Untitled'} (${timeStr})`);
    });
    lines.push(`\nUPCOMING CALENDAR EVENTS (next 5 days — use for prep and scheduling context):`);
    Object.entries(byDay).forEach(([day, evs]) => {
      lines.push(`  [${day}] ${evs.slice(0, 5).join(' · ')}`);
    });
  } else if (calendarDensity && Object.keys(calendarDensity).length > 0) {
    // Fall back to density if no event titles available
    lines.push(`\nCALENDAR DENSITY THIS WEEK:`);
    Object.entries(calendarDensity).sort(([a], [b]) => a.localeCompare(b)).forEach(([day, count]) => {
      const load = count >= 5 ? '(heavy — protect from deep work)' : count >= 3 ? '(moderate)' : '(light)';
      lines.push(`  ${day}: ${count} event${count !== 1 ? 's' : ''} ${load}`);
    });
  }

  // Active goals — with orphan flag
  const activeGoals = goals.filter(g => g.status === 'active');
  if (activeGoals.length > 0) {
    lines.push(`\nACTIVE GOALS (${activeGoals.length}):`);
    activeGoals.forEach(g => {
      const linkedTasks = tasks.filter(t => t.goalId === g.id && !t.done);
      const taskCount = linkedTasks.length;
      const score = g.likelihoodScore != null ? `score:${g.likelihoodScore}/100` : 'unscored';
      const target = g.targetDate ? ` | target:${g.targetDate}` : '';
      const ctx = g.context ? ` | context:${g.context}` : '';
      const drift = (g.targetDateChanges || 0) > 0 ? ` | target-moved:${g.targetDateChanges}x` : '';
      const orphan = taskCount === 0 ? ' ⚠ NO TASKS LINKED — goal has no execution path' : '';
      lines.push(`  • "${g.title}" | type:${g.goalType || 'general'} | ${score} | ${taskCount} active tasks${target}${ctx}${drift}${orphan}`);
      if (g.why) lines.push(`    Why it matters: ${g.why}`);
    });
  }

  // Active projects — computed momentum, computed next action
  const activeProjects = projects.filter(p => p.status === 'active' || p.status === 'planning');
  if (activeProjects.length > 0) {
    lines.push(`\nACTIVE PROJECTS (${activeProjects.length}):`);
    activeProjects.forEach(p => {
      const projectTasks = tasks.filter(t => t.projectId === p.id);
      const { score: mScore } = calculateMomentum(p, projectTasks);
      const openCount = projectTasks.filter(t => !t.done).length;
      const blocker = p.blockers ? ` | BLOCKER: "${p.blockers}"` : '';
      const ctx = p.context ? ` | context:${p.context}` : '';
      const drift = (p.deferCount || 0) > 0 ? ` | stalled:${p.deferCount}x` : '';

      // Computed next action from tasks
      const nextActions = getProjectNextAction(p.id, tasks);
      let nextStr = '';
      if (nextActions.length > 0) {
        const items = nextActions.map(a => `"${a.title}"${a.dueDate ? ` due:${a.dueDate}` : ''}`).join(' or ');
        nextStr = ` | next: ${items}`;
      } else if (p.nextAction) {
        nextStr = ` | next: "${p.nextAction}"`;
      }

      lines.push(`  • "${p.title}" | ${p.status} | momentum:${mScore}%${nextStr}${blocker}${ctx}${drift} | ${openCount} open tasks`);
    });
  }

  // High-priority open tasks — sorted by urgency, with tags
  const openHigh = tasks
    .filter(t => !t.done && (t.priority === 'critical' || t.priority === 'high'))
    .map(t => ({ ...t, _urgency: calculateUrgency(t) }))
    .sort((a, b) => b._urgency - a._urgency)
    .slice(0, 14);
  if (openHigh.length > 0) {
    lines.push(`\nHIGH PRIORITY OPEN TASKS (sorted by urgency):`);
    openHigh.forEach(t => {
      const due = t.dueDate ? ` | due:${t.dueDate}` : '';
      const proj = t.project && t.project !== 'Inbox' ? ` | ${t.project}` : '';
      const push = (t.pushCount || 0) > 0 ? ` | pushed:${t.pushCount}x` : '';
      const tags = t.tags?.length ? ` | tags:${t.tags.join(',')}` : '';
      const ctx = t.context ? ` | context:${t.context}` : '';
      lines.push(`  • "${t.title}" | ${t.priority}${proj}${due}${push}${tags}${ctx}`);
    });
  }

  // Stale inbox tasks (not updated in 14+ days, no project)
  const staleInbox = tasks.filter(t => {
    if (t.done || (t.projectId && t.project !== 'Inbox')) return false;
    const updMs = t.updatedAt?.toMillis?.() || (t.updatedAt ? new Date(t.updatedAt).getTime() : 0);
    return updMs > 0 && updMs < twoWeeksAgo;
  });
  if (staleInbox.length > 0) {
    lines.push(`\nSTALE INBOX (${staleInbox.length} tasks untouched 14+ days — flag for triage or delete):`);
    staleInbox.slice(0, 5).forEach(t => {
      lines.push(`  • "${t.title}" | ${t.priority}`);
    });
  }

  // At-risk this week: high/critical with pushCount >= 2 due within 5 days
  const nowMs = Date.now();
  const in5DayMs = nowMs + 5 * 24 * 60 * 60 * 1000;
  const atRisk = tasks.filter(t => {
    if (t.done || !t.dueDate) return false;
    const dueMs = new Date(t.dueDate + 'T23:59:59').getTime();
    if (dueMs < nowMs || dueMs > in5DayMs) return false;
    return (t.priority === 'critical' || t.priority === 'high') && (t.pushCount || 0) >= 2;
  });
  if (atRisk.length > 0) {
    lines.push(`\nAT RISK THIS WEEK — chronic deferral + imminent deadline (CALL THESE OUT explicitly):`);
    atRisk.forEach(t => {
      lines.push(`  ⚑ "${t.title}" | ${t.priority} | due:${t.dueDate} | pushed:${t.pushCount}x`);
    });
  }

  // Overdue tasks
  const now = new Date();
  const overdue = tasks.filter(t => !t.done && t.dueDate && new Date(t.dueDate + 'T23:59:59') < now);
  if (overdue.length > 0) {
    lines.push(`\nOVERDUE TASKS (${overdue.length}):`);
    overdue.slice(0, 5).forEach(t => {
      lines.push(`  • "${t.title}" | was due:${t.dueDate} | ${t.priority}`);
    });
  }

  // Recent brain dumps (last 14 days)
  const recentDumps = brainDumps.filter(d => {
    if (d.archived) return false;
    try {
      const ms = d.createdAt?.toMillis?.() || new Date(d.createdAt).getTime();
      return ms > twoWeeksAgo;
    } catch { return false; }
  }).slice(0, 6);

  if (recentDumps.length > 0) {
    lines.push(`\nRECENT BRAIN DUMPS (last 14 days — ${recentDumps.length} entries):`);
    recentDumps.forEach(d => {
      const dateStr = (() => {
        try {
          const ms = d.createdAt?.toMillis?.() || new Date(d.createdAt).getTime();
          return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch { return '?'; }
      })();
      if (d.summary) {
        lines.push(`  [${dateStr}] ${d.summary}`);
        if (d.mostUrgent) lines.push(`    Most urgent: ${d.mostUrgent}`);
        if (d.urgentFlags?.length) lines.push(`    Flags: ${d.urgentFlags.join(', ')}`);
      } else if (d.rawText) {
        lines.push(`  [${dateStr}] ${d.rawText.slice(0, 220).replace(/\n/g, ' ')}${d.rawText.length > 220 ? '…' : ''}`);
      }
    });
  }

  // Recent reviews
  const recentReviews = weeklyReviews.slice(0, 3);
  if (recentReviews.length > 0) {
    lines.push(`\nRECENT REVIEWS:`);
    recentReviews.forEach((r, i) => {
      const wins = (r.wins || []).slice(0, 2).join('; ');
      const blocks = (r.bottlenecks || []).slice(0, 2).join('; ');
      lines.push(`  [Review ${i + 1}] energy:${r.energyScore || '?'}/100 execution:${r.executionScore || '?'}/100${wins ? ' | wins: ' + wins : ''}${blocks ? ' | blockers: ' + blocks : ''}`);
    });
  }

  if (plaidData) {
    lines.push(`\nFINANCIAL SNAPSHOT:`);
    if (plaidData.monthlySurplus != null) lines.push(`  Monthly surplus: $${Math.round(plaidData.monthlySurplus).toLocaleString()}`);
    if (plaidData.monthlySpending != null) lines.push(`  Monthly spending: $${Math.round(plaidData.monthlySpending).toLocaleString()}`);
  }

  // Past feedback corrections — always enforced
  if (userProfile?.aiFeedback) {
    const entries = Object.entries(userProfile.aiFeedback).filter(([, v]) => v);
    if (entries.length > 0) {
      lines.push(`\nUSER CORRECTIONS — treat these as hard constraints in every response:`);
      entries.forEach(([k, v]) => lines.push(`  [${k}] ${v}`));
    }
  }

  lines.push(`\n=== END CONTEXT ===`);
  return lines.join('\n');
}
