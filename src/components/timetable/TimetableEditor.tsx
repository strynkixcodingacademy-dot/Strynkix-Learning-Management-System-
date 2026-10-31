'use client';

/**
 * Strynkix LMS — Weekly Timetable Visual Editor
 * 7-day visual builder (Monday through Sunday) for Branch Managers.
 * Supports multiple ordered activities per day, reordering, time slots,
 * objectives, lessons, assignments and assessment scheduling.
 */

import React, { useState } from 'react';
import {
  DayOfWeek,
  DaySchedule,
  Lesson,
  Module,
  TimetableActivity,
} from '@/types/domain';
import {
  ACTIVITY_TYPE_LABELS,
  DAYS_OF_WEEK,
  DAY_LABELS,
  normalizeActivityOrder,
} from '@/lib/learning/timetable';
import { ActivityFormModal } from './ActivityFormModal';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CalendarDays,
  Clock,
  Edit2,
  FileCheck,
  Flag,
  GraduationCap,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';

interface TimetableEditorProps {
  days: Record<DayOfWeek, DaySchedule>;
  onChange: (updatedDays: Record<DayOfWeek, DaySchedule>) => void;
  canEdit: boolean;
  courseId: string;
  modules: Module[];
  lessons: Lesson[];
  existingAssignments?: { id: string; title: string }[];
  onSaveDraft?: () => void;
  isSaving?: boolean;
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  lesson: BookOpen,
  practical_exercise: GraduationCap,
  assignment: FileCheck,
  quiz: Clock,
  examination: Clock,
  practical_assessment: GraduationCap,
};

export function TimetableEditor({
  days,
  onChange,
  canEdit,
  courseId,
  modules,
  lessons,
  existingAssignments = [],
  onSaveDraft,
  isSaving = false,
}: TimetableEditorProps) {
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>('monday');
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    dayKey: DayOfWeek;
    activity: TimetableActivity | null;
  }>({
    isOpen: false,
    dayKey: 'monday',
    activity: null,
  });

  const activeDay = days[selectedDay];

  const handleUpdateTheme = (theme: string) => {
    onChange({
      ...days,
      [selectedDay]: {
        ...activeDay,
        theme,
      },
    });
  };

  const handleOpenAdd = () => {
    setModalState({
      isOpen: true,
      dayKey: selectedDay,
      activity: null,
    });
  };

  const handleOpenEdit = (act: TimetableActivity) => {
    setModalState({
      isOpen: true,
      dayKey: selectedDay,
      activity: act,
    });
  };

  const handleSaveActivity = (activity: TimetableActivity) => {
    const currentList = activeDay.activities;
    const exists = currentList.some((a) => a.id === activity.id);
    let updatedList: TimetableActivity[];

    if (exists) {
      updatedList = currentList.map((a) => (a.id === activity.id ? activity : a));
    } else {
      updatedList = [...currentList, activity];
    }

    onChange({
      ...days,
      [selectedDay]: {
        ...activeDay,
        activities: normalizeActivityOrder(updatedList),
      },
    });
  };

  const handleDeleteActivity = (actId: string) => {
    const updatedList = activeDay.activities.filter((a) => a.id !== actId);
    onChange({
      ...days,
      [selectedDay]: {
        ...activeDay,
        activities: normalizeActivityOrder(updatedList),
      },
    });
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    const list = [...activeDay.activities];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= list.length) return;

    const temp = list[index];
    list[index] = list[targetIndex];
    list[targetIndex] = temp;

    onChange({
      ...days,
      [selectedDay]: {
        ...activeDay,
        activities: normalizeActivityOrder(list),
      },
    });
  };

  // Compute week overview stats
  const allActivities = Object.values(days).flatMap((d) => d.activities);
  const totalMinutes = allActivities.reduce((sum, a) => sum + (a.durationMinutes || 0), 0);
  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
  const lessonsCount = allActivities.filter((a) => a.type === 'lesson').length;
  const assessmentsCount = allActivities.filter(
    (a) => a.type === 'quiz' || a.type === 'examination' || a.type === 'practical_assessment'
  ).length;

  return (
    <div className="space-y-6">
      {/* Week Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-canvas border border-line">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <span className="font-semibold text-ink-2">
            Weekly Scope: <strong>{allActivities.length} activities</strong>
          </span>
          <span>·</span>
          <span className="text-ink-3">~{totalHours} total learning hours</span>
          <span>·</span>
          <span className="text-ink-3">{lessonsCount} lessons</span>
          <span>·</span>
          <span className="text-ink-3">{assessmentsCount} assessments</span>
        </div>

        {canEdit && onSaveDraft && (
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-line bg-surface hover:bg-surface-muted text-xs font-semibold text-ink transition-colors disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {isSaving ? 'Saving...' : 'Save Draft'}
          </button>
        )}
      </div>

      {/* 7-Day Navigation Tabs */}
      <div className="flex overflow-x-auto pb-1 gap-2 border-b border-line">
        {DAYS_OF_WEEK.map((dayKey) => {
          const d = days[dayKey];
          const isSelected = selectedDay === dayKey;
          const count = d.activities.length;

          return (
            <button
              key={dayKey}
              type="button"
              onClick={() => setSelectedDay(dayKey)}
              className={`flex-1 min-w-[110px] p-3 rounded-t-xl border-t border-x text-left transition-colors ${
                isSelected
                  ? 'bg-surface border-line border-b-2 border-b-brand font-bold text-brand-ink shadow-sm'
                  : 'bg-canvas border-transparent hover:bg-surface-muted text-ink-3'
              }`}
            >
              <div className="text-[11px] uppercase tracking-wider">{DAY_LABELS[dayKey]}</div>
              <div className="text-xs font-mono font-medium text-ink-4 mt-0.5">{d.date.slice(5)}</div>
              <div className="text-[11px] font-semibold text-ink-2 mt-1">
                {count} {count === 1 ? 'activity' : 'activities'}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Day View */}
      <div className="p-6 rounded-2xl bg-surface border border-line space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line">
          <div>
            <h3 className="text-lg font-bold text-ink flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-brand-ink" />
              {DAY_LABELS[selectedDay]} — {activeDay.date}
            </h3>
            <p className="text-xs text-ink-3 mt-0.5">
              {activeDay.activities.length === 0
                ? 'No activities scheduled for this day yet.'
                : `${activeDay.activities.length} ordered activities planned.`}
            </p>
          </div>

          {canEdit && (
            <button
              type="button"
              onClick={handleOpenAdd}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand hover:bg-brand-strong text-white text-xs font-semibold self-start sm:self-auto transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Activity
            </button>
          )}
        </div>

        {/* Day Focus / Theme */}
        {canEdit ? (
          <div className="space-y-1">
            <label htmlFor="dayTheme" className="text-xs font-semibold text-ink-2">
              Daily Focus / Theme (Optional)
            </label>
            <input
              id="dayTheme"
              value={activeDay.theme ?? ''}
              onChange={(e) => handleUpdateTheme(e.target.value)}
              placeholder="e.g. Asynchronous Architecture & Promises in Depth"
              className="w-full px-3.5 py-2 rounded-xl bg-canvas border border-line-strong text-sm text-ink focus:outline-none focus:border-brand"
            />
          </div>
        ) : (
          activeDay.theme && (
            <div className="p-3 rounded-xl bg-canvas border border-line text-xs font-medium text-ink-2">
              <span className="font-bold text-ink uppercase text-[10px] tracking-wider block mb-0.5">
                Focus:
              </span>
              {activeDay.theme}
            </div>
          )
        )}

        {/* Activities List */}
        {activeDay.activities.length === 0 ? (
          <div className="py-12 text-center rounded-xl bg-canvas border border-dashed border-line text-xs text-ink-3">
            No activities scheduled for {DAY_LABELS[selectedDay]}.
            {canEdit && ' Click "Add Activity" above to schedule a lesson, lab or test.'}
          </div>
        ) : (
          <ol className="space-y-3">
            {activeDay.activities.map((act, index) => {
              const Icon = TYPE_ICONS[act.type] || BookOpen;

              return (
                <li
                  key={act.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-line bg-canvas hover:border-line-strong transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface border border-line text-xs font-bold text-brand-ink">
                      {index + 1}
                    </span>

                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface border border-line text-ink-3 flex items-center gap-1">
                          <Icon className="w-3 h-3" />
                          {ACTIVITY_TYPE_LABELS[act.type] || act.type}
                        </span>

                        <span className="text-xs font-mono font-semibold text-ink-3 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {act.startTime} – {act.endTime} ({act.durationMinutes}m)
                        </span>
                      </div>

                      <h4 className="text-sm font-bold text-ink truncate">{act.title}</h4>

                      {act.objectives.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {act.objectives.map((obj, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 text-[11px] text-ink-3 rounded-md bg-surface px-2 py-0.5 border border-line"
                            >
                              <Flag className="w-2.5 h-2.5 text-coral" /> {obj}
                            </span>
                          ))}
                        </div>
                      )}

                      {act.assessment && (
                        <div className="text-[11px] text-brand-ink font-semibold">
                          {act.assessment.assessmentType.replace('_', ' ')} · Max {act.assessment.maxMarks} marks ({act.assessment.format})
                        </div>
                      )}
                    </div>
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-1 self-end sm:self-center shrink-0">
                      <button
                        type="button"
                        onClick={() => handleMove(index, 'up')}
                        disabled={index === 0}
                        className="p-1.5 rounded-lg border border-line bg-surface hover:bg-surface-muted disabled:opacity-30 text-ink-3"
                        title="Move Up"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMove(index, 'down')}
                        disabled={index === activeDay.activities.length - 1}
                        className="p-1.5 rounded-lg border border-line bg-surface hover:bg-surface-muted disabled:opacity-30 text-ink-3"
                        title="Move Down"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(act)}
                        className="p-1.5 rounded-lg border border-line bg-surface hover:bg-surface-muted text-ink-2"
                        title="Edit Activity"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteActivity(act.id)}
                        className="p-1.5 rounded-lg border border-line bg-surface hover:bg-surface-muted text-danger-ink"
                        title="Delete Activity"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <ActivityFormModal
        isOpen={modalState.isOpen}
        onClose={() => setModalState({ isOpen: false, dayKey: selectedDay, activity: null })}
        onSave={handleSaveActivity}
        initialActivity={modalState.activity}
        courseId={courseId}
        modules={modules}
        lessons={lessons}
        existingAssignments={existingAssignments}
      />
    </div>
  );
}

