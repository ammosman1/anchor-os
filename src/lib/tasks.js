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
