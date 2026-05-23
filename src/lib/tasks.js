// src/lib/tasks.js
// Task utility helpers — recurrence, lifecycle, urgency

import { addTask } from './db';

const PRIORITY_WEIGHTS = { critical: 4, high: 3, medium: 2, low: 1 };

// Urgency score: priority × time-pressure + drift bonus.
// Higher = surface sooner. Tasks without a due date get a small priority-only baseline.
export function calculateUrgency(task) {
  const weight     = PRIORITY_WEIGHTS[task.priority] || 1;
  const driftBonus = (task.pushCount || 0) >= 3 ? 1.5 : 0;

  if (!task.dueDate) return weight * 0.1 + driftBonus;

  const due        = new Date(task.dueDate + 'T23:59:59');
  const daysTillDue = (due.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  const recency    = 1 / Math.max(daysTillDue, 0.5);

  return weight * recency + driftBonus;
}

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

// Returns [{title, dueDate, priority}] — 1 item normally, 2 if there's a true tie.
// Logic: tasks with due dates first (nearest), tiebreak by priority, tiebreak → show both.
// Falls back to highest-priority task if none have due dates.
export function getProjectNextAction(projectId, tasks) {
  const open = tasks.filter(t => t.projectId === projectId && !t.done);
  if (open.length === 0) return [];

  const withDue = open
    .filter(t => t.dueDate)
    .sort((a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      return (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4);
    });

  const withoutDue = open
    .filter(t => !t.dueDate)
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4));

  const candidates = [...withDue, ...withoutDue];
  const first = candidates[0];
  const second = candidates[1];

  // True tie: same due date AND same priority → show both
  if (second && first.dueDate && second.dueDate === first.dueDate && second.priority === first.priority) {
    return [
      { title: first.title,  dueDate: first.dueDate,  priority: first.priority  },
      { title: second.title, dueDate: second.dueDate, priority: second.priority },
    ];
  }

  return [{ title: first.title, dueDate: first.dueDate || null, priority: first.priority }];
}

export const RECURRENCE_OPTIONS = [
  { value: 'none',     label: 'No repeat'  },
  { value: 'daily',    label: 'Daily'      },
  { value: 'weekdays', label: 'Weekdays'   },
  { value: 'weekly',   label: 'Weekly'     },
  { value: 'monthly',  label: 'Monthly'    },
];

// Given a base date and recurrence type, returns the next scheduled date string (YYYY-MM-DD).
export function nextRecurrenceDate(baseDateStr, recurrence) {
  const base = baseDateStr ? new Date(baseDateStr + 'T00:00:00') : new Date();
  const next = new Date(base);

  switch (recurrence) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      break;
    case 'weekdays':
      do { next.setDate(next.getDate() + 1); } while ([0, 6].includes(next.getDay()));
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
    default:
      return null;
  }

  const pad = n => String(n).padStart(2, '0');
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
}

// True when a task has a future startDate and shouldn't be scheduled or surfaced yet.
export function isDeferred(task) {
  if (!task.startDate) return false;
  return task.startDate > new Date().toISOString().split('T')[0];
}

// True when a task was explicitly deferred by the user until a future date.
export function isTaskDeferred(task) {
  if (!task.deferredUntil) return false;
  return task.deferredUntil > new Date().toISOString().split('T')[0];
}

export function getNextMonday() {
  const d = new Date();
  const daysUntilMonday = d.getDay() === 0 ? 1 : 8 - d.getDay();
  d.setDate(d.getDate() + daysUntilMonday);
  return d.toISOString().split('T')[0];
}

export function isTaskBlocked(task, allTasks) {
  if (!task.blockedBy?.length) return false;
  return task.blockedBy.some(id => {
    const blocker = allTasks.find(t => t.id === id);
    return blocker && !blocker.done;
  });
}

// Returns the uncompleted blocker task objects for a given task.
export function getBlockers(task, allTasks) {
  if (!task.blockedBy?.length) return [];
  return task.blockedBy
    .map(id => allTasks.find(t => t.id === id))
    .filter(t => t && !t.done);
}

// When a recurring task is completed, create the next occurrence in Firestore.
export async function scheduleNextRecurrence(uid, task) {
  if (!task.recurrence || task.recurrence === 'none') return;

  const nextDate = nextRecurrenceDate(task.scheduledDate, task.recurrence);
  if (!nextDate) return;

  await addTask(uid, {
    title:      task.title,
    priority:   task.priority   || 'medium',
    project:    task.project    || 'Inbox',
    projectId:  task.projectId  || null,
    tags:       task.tags       || [],
    recurrence: task.recurrence,
    scheduledDate: nextDate,
    status:     'scheduled',
    goalId:     task.goalId     || null,
    notes:      task.notes      || '',
    source:     'recurrence',
  });
}
