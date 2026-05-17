// src/lib/tasks.js
// Task utility helpers — recurrence, lifecycle, etc.

import { addTask } from './db';

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
