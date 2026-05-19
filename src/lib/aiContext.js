// src/lib/aiContext.js
// Assembles full user context for all AI calls so nothing runs blind

import { calculateUrgency } from './tasks';
import { calculateMomentum } from './momentum';
import { getProjectNextAction } from './tasks';

export function buildHolisticContext({
  goals = [], tasks = [], projects = [],
  brainDumps = [], weeklyReviews = [],
  userProfile = null, plaidData = null, manualCashFlow = null,
  debtAccounts = [], assetAccounts = [],
  calendarDensity = null, calendarEvents = [],
  weatherForecast = null,
  notes = [],
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

  // Completion notes — what Andrew actually found/learned when finishing tasks
  const withNotes = recentlyCompleted.filter(t => t.completionNote).slice(0, 8);
  if (withNotes.length > 0) {
    lines.push(`\nCOMPLETION NOTES (what was actually found or learned — use to inform advice):`);
    withNotes.forEach(t => {
      const dateStr = (() => {
        try { return new Date(t.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return '?'; }
      })();
      lines.push(`  [${dateStr}] "${t.title}": ${t.completionNote}`);
    });
  }

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
      const linkedProjectIds = projects.filter(p => p.goalId === g.id).map(p => p.id);
      const linkedTasks = tasks.filter(t => !t.done && (t.goalId === g.id || linkedProjectIds.includes(t.projectId)));
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

  // Active + stalled projects — computed momentum, computed next action
  const activeProjects = projects.filter(p => ['active', 'planning', 'stalled'].includes(p.status));
  if (activeProjects.length > 0) {
    lines.push(`\nPROJECTS (${activeProjects.length}):`);
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

  // Context breakdown — work vs personal task load
  const openTasks = tasks.filter(t => !t.done);
  const workTasks     = openTasks.filter(t => t.context === 'work');
  const personalTasks = openTasks.filter(t => t.context === 'personal');
  const homeTasks     = openTasks.filter(t => t.context === 'home');
  const financialTasks = openTasks.filter(t => t.context === 'financial');
  const healthTasks   = openTasks.filter(t => t.context === 'health');
  const untaggedTasks = openTasks.filter(t => !t.context);
  if (openTasks.length > 0) {
    const parts = [];
    if (workTasks.length)     parts.push(`work:${workTasks.length}`);
    if (personalTasks.length) parts.push(`personal:${personalTasks.length}`);
    if (homeTasks.length)     parts.push(`home:${homeTasks.length}`);
    if (financialTasks.length) parts.push(`financial:${financialTasks.length}`);
    if (healthTasks.length)   parts.push(`health:${healthTasks.length}`);
    if (untaggedTasks.length) parts.push(`untagged:${untaggedTasks.length}`);
    lines.push(`\nTASK LOAD BY CONTEXT: ${parts.join(' | ')} (total open: ${openTasks.length})`);
    if (workTasks.length > 0) {
      const workHigh = workTasks.filter(t => t.priority === 'critical' || t.priority === 'high');
      lines.push(`  Work — ${workHigh.length} high/critical, ${workTasks.length - workHigh.length} medium/low`);
    }
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
    lines.push(`\nRECENT WEEKLY REVIEWS:`);
    recentReviews.forEach((r, i) => {
      const ratingStr = r.weekRating != null
        ? `rating:${r.weekRating}/5`
        : (r.energyScore != null ? `energy:${r.energyScore}/100 execution:${r.executionScore}/100` : 'unrated');
      const wins = Array.isArray(r.wins) ? r.wins.slice(0, 2).join('; ') : (r.wins || '');
      const blocks = Array.isArray(r.stalled) ? r.stalled.slice(0, 2).join('; ') : (r.bottlenecks || '');
      const intention = r.intention ? ` | intention: ${r.intention}` : '';
      lines.push(`  [Week ${i + 1}] ${ratingStr}${wins ? ' | wins: ' + wins : ''}${blocks ? ' | stalled: ' + blocks : ''}${intention}`);
    });
  }

  const effectiveFinance = plaidData || manualCashFlow;
  const totalDebtVal   = debtAccounts.reduce((s, a) => s + (a.balance || 0), 0);
  const totalAssetsVal = assetAccounts.reduce((s, a) => s + (a.balance || 0), 0);
  const netWorthVal    = totalAssetsVal - totalDebtVal;

  if (effectiveFinance || totalDebtVal > 0 || totalAssetsVal > 0) {
    const src     = plaidData ? 'Plaid' : manualCashFlow ? 'manual import' : null;
    const surplus  = effectiveFinance?.monthlySurplus  ?? effectiveFinance?.surplus;
    const spending = effectiveFinance?.monthlySpending ?? effectiveFinance?.spending;
    const income   = effectiveFinance?.monthlyIncome   ?? effectiveFinance?.income;

    lines.push(`\nFINANCIAL SNAPSHOT${src ? ` (cash flow via ${src})` : ''}:`);
    if (income   != null) lines.push(`  Monthly income: $${Math.round(income).toLocaleString()}`);
    if (spending != null) lines.push(`  Monthly spending: $${Math.round(spending).toLocaleString()}`);
    if (surplus  != null) lines.push(`  Monthly surplus: $${Math.round(surplus).toLocaleString()}`);
    if (totalDebtVal > 0)   lines.push(`  Total debt: $${totalDebtVal.toLocaleString()} across ${debtAccounts.length} account(s)`);
    if (totalAssetsVal > 0) lines.push(`  Total assets: $${totalAssetsVal.toLocaleString()} across ${assetAccounts.length} account(s)`);
    if (totalDebtVal > 0 || totalAssetsVal > 0) {
      lines.push(`  Net worth: ${netWorthVal >= 0 ? '+' : ''}$${netWorthVal.toLocaleString()}`);
    }

    // Debt payoff progress (accounts with balance history show trends)
    const withHistory = debtAccounts.filter(a => Array.isArray(a.balanceHistory) && a.balanceHistory.length >= 2);
    if (withHistory.length > 0) {
      const progressParts = [];
      withHistory.slice(0, 4).forEach(a => {
        const sorted  = [...a.balanceHistory].sort((x, y) => x.date.localeCompare(y.date));
        const oldest  = sorted[0];
        const newest  = sorted[sorted.length - 1];
        const paid    = oldest.balance - newest.balance;
        if (paid > 0) progressParts.push(`${a.name}: -$${paid.toLocaleString()} paid down`);
      });
      if (progressParts.length > 0) lines.push(`  Payoff progress: ${progressParts.join(' | ')}`);
    }

    // Asset breakdown by type
    if (assetAccounts.length > 0) {
      const byType = {};
      assetAccounts.forEach(a => { byType[a.type] = (byType[a.type] || 0) + (a.balance || 0); });
      const breakdown = Object.entries(byType).map(([t, v]) => `${t}:$${v.toLocaleString()}`).join(' | ');
      lines.push(`  Asset breakdown: ${breakdown}`);
    }
  }

  // Pinned + recent notes — surface as context for the AI
  const pinnedNotes = notes.filter(n => n.pinned);
  const recentNotes = notes.filter(n => !n.pinned).slice(0, 4);
  if (pinnedNotes.length > 0 || recentNotes.length > 0) {
    lines.push(`\nNOTES:`);
    pinnedNotes.forEach(n => {
      lines.push(`  📌 "${n.title}"${n.body ? ': ' + n.body.slice(0, 200).replace(/\n/g, ' ') + (n.body.length > 200 ? '…' : '') : ''}`);
    });
    recentNotes.forEach(n => {
      lines.push(`  · "${n.title}"${n.body ? ': ' + n.body.slice(0, 120).replace(/\n/g, ' ') + (n.body.length > 120 ? '…' : '') : ''}`);
    });
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
