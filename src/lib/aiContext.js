// src/lib/aiContext.js
// Assembles full user context for all AI calls so nothing runs blind

export function buildHolisticContext({
  goals = [], tasks = [], projects = [],
  brainDumps = [], weeklyReviews = [],
  userProfile = null, plaidData = null,
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

  // Active goals
  const activeGoals = goals.filter(g => g.status === 'active');
  if (activeGoals.length > 0) {
    lines.push(`\nACTIVE GOALS (${activeGoals.length}):`);
    activeGoals.forEach(g => {
      const taskCount = tasks.filter(t => t.goalId === g.id && !t.done).length;
      const score = g.likelihoodScore != null ? `score:${g.likelihoodScore}/100` : 'unscored';
      const target = g.targetDate ? ` | target:${g.targetDate}` : '';
      lines.push(`  • "${g.title}" | type:${g.goalType || 'general'} | ${score} | ${taskCount} active tasks${target}`);
      if (g.why) lines.push(`    Why it matters: ${g.why}`);
    });
  }

  // Active projects
  const activeProjects = projects.filter(p => p.status === 'active' || p.status === 'planning');
  if (activeProjects.length > 0) {
    lines.push(`\nACTIVE PROJECTS (${activeProjects.length}):`);
    activeProjects.forEach(p => {
      const taskCount = tasks.filter(t => t.projectId === p.id && !t.done).length;
      const blocker = p.blockers ? ` | BLOCKER: "${p.blockers}"` : '';
      const next = p.nextAction ? ` | next: "${p.nextAction}"` : '';
      lines.push(`  • "${p.title}" | ${p.status} | momentum:${p.momentum || 0}%${next}${blocker} | ${taskCount} open tasks`);
    });
  }

  // High-priority open tasks
  const openHigh = tasks
    .filter(t => !t.done && (t.priority === 'critical' || t.priority === 'high'))
    .slice(0, 14);
  if (openHigh.length > 0) {
    lines.push(`\nHIGH PRIORITY OPEN TASKS:`);
    openHigh.forEach(t => {
      const due = t.dueDate ? ` | due:${t.dueDate}` : '';
      const proj = t.project && t.project !== 'Inbox' ? ` | ${t.project}` : '';
      lines.push(`  • "${t.title}" | ${t.priority}${proj}${due}`);
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
  const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const recentDumps = brainDumps.filter(d => {
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
