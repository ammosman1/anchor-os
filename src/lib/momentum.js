// src/lib/momentum.js
// Auto-calculates project momentum from real activity data

export function calculateMomentum(project, projectTasks) {
  const now   = Date.now();
  const total = projectTasks.length;
  const done  = projectTasks.filter(t => t.done).length;

  // Find most recent activity across project edits and task updates/completions
  let lastTaskMs = 0;
  for (const t of projectTasks) {
    const completedMs = t.completedAt ? new Date(t.completedAt).getTime() : 0;
    const updatedMs   = t.updatedAt?.toMillis?.() ?? (t.updatedAt  ? new Date(t.updatedAt).getTime()  : 0);
    const createdMs   = t.createdAt?.toMillis?.()  ?? (t.createdAt ? new Date(t.createdAt).getTime()  : 0);
    lastTaskMs = Math.max(lastTaskMs, completedMs, updatedMs, createdMs);
  }
  const projectMs    = project.updatedAt?.toMillis?.() ?? (project.updatedAt ? new Date(project.updatedAt).getTime() : 0);
  const lastActivity = Math.max(lastTaskMs, projectMs);
  const daysSince    = lastActivity > 0 ? (now - lastActivity) / (1000 * 60 * 60 * 24) : 999;

  if (total === 0) {
    return {
      score:   50,
      factors: [{ label: 'No tasks added yet', delta: 0, icon: '—' }],
    };
  }

  let score = 50;
  const factors = [];

  // Activity recency (–30 to +30)
  if (daysSince < 1) {
    score += 30; factors.push({ label: 'Active today',                            delta: +30, icon: '↑' });
  } else if (daysSince < 3) {
    score += 15; factors.push({ label: `Active ${Math.floor(daysSince)}d ago`,    delta: +15, icon: '↑' });
  } else if (daysSince < 7) {
    score +=  5; factors.push({ label: `Last activity ${Math.floor(daysSince)}d ago`, delta: +5,  icon: '→' });
  } else if (daysSince > 14) {
    score -= 30; factors.push({ label: `No activity for ${Math.floor(daysSince)} days`, delta: -30, icon: '↓' });
  } else {
    score -= 15; factors.push({ label: `No activity for ${Math.floor(daysSince)} days`, delta: -15, icon: '↓' });
  }

  // Task completion rate (+0 to +20)
  const completionBonus = Math.round((done / total) * 20);
  score += completionBonus;
  factors.push({
    label: `${done}/${total} tasks complete`,
    delta: completionBonus,
    icon:  completionBonus >= 10 ? '↑' : '→',
  });

  // Next action set (+10) or missing (–5)
  if (project.nextAction) {
    score += 10; factors.push({ label: 'Next action defined',   delta: +10, icon: '↑' });
  } else {
    score -=  5; factors.push({ label: 'No next action set',    delta:  -5, icon: '↓' });
  }

  // Active blocker (–20)
  if (project.blockers) {
    const preview = project.blockers.length > 40
      ? project.blockers.slice(0, 40) + '…'
      : project.blockers;
    score -= 20; factors.push({ label: `Blocker: ${preview}`, delta: -20, icon: '↓' });
  }

  return { score: Math.max(0, Math.min(100, score)), factors };
}

export function getMomentumBlurb(score, factors) {
  const noTasks = factors.some(f => f.delta === 0);
  if (noTasks) return 'Add tasks to start tracking momentum.';

  const positives = factors.filter(f => f.delta > 0).map(f => f.label.toLowerCase());
  const negatives = factors.filter(f => f.delta < 0).map(f => f.label.toLowerCase());

  if (score >= 70) {
    const drivers = positives.slice(0, 2).join(' and ');
    return `Strong momentum — ${drivers}.`;
  }
  if (score >= 45) {
    const parts = [];
    if (positives.length) parts.push(`${positives[0]} is helping`);
    if (negatives.length) parts.push(`${negatives[0]} is holding it back`);
    return parts.join(', ') + '.';
  }
  if (negatives.length) {
    const top = negatives.slice(0, 2).join(' and ');
    return `Low momentum — ${top}.`;
  }
  return 'Momentum needs attention — add tasks and log activity.';
}
