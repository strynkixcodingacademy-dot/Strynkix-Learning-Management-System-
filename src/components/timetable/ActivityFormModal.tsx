'use client';

/**
 * Strynkix LMS — Timetable Activity Configuration Modal
 * Configures individual learning activities (lessons, practical exercises,
 * assignments, assessments, examinations, revisions) within a weekly timetable.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityType,
  AssessmentFormat,
  AssessmentType,
  Lesson,
  Module,
  TimetableActivity,
} from '@/types/domain';
import {
  ACTIVITY_TYPE_LABELS,
  calculateDurationMinutes,
} from '@/lib/learning/timetable';
import { AlertCircle, Clock, Plus, Trash2, X } from 'lucide-react';

interface ActivityFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (activity: TimetableActivity) => void;
  initialActivity?: TimetableActivity | null;
  courseId: string;
  modules: Module[];
  lessons: Lesson[];
  existingAssignments?: { id: string; title: string }[];
}

const inputClass =
  'w-full px-3.5 py-2 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 disabled:opacity-60';

export function ActivityFormModal({
  isOpen,
  onClose,
  onSave,
  initialActivity,
  courseId,
  modules,
  lessons,
  existingAssignments = [],
}: ActivityFormModalProps) {
  const [type, setType] = useState<ActivityType>('lesson');
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('09:30');
  const [endTime, setEndTime] = useState('11:00');
  const [moduleId, setModuleId] = useState<string>('');
  const [lessonId, setLessonId] = useState<string>('');
  const [assignmentId, setAssignmentId] = useState<string>('');
  const [objectives, setObjectives] = useState<string[]>([]);
  const [newObjective, setNewObjective] = useState('');
  const [instructions, setInstructions] = useState('');

  // Assessment fields
  const [assessmentType, setAssessmentType] = useState<AssessmentType>('weekly_test');
  const [maxMarks, setMaxMarks] = useState('50');
  const [passingMarks, setPassingMarks] = useState('25');
  const [format, setFormat] = useState<AssessmentFormat>('mcq');
  const [syllabus, setSyllabus] = useState('');
  const [assessmentInstructions, setAssessmentInstructions] = useState('');

  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (initialActivity) {
      setType(initialActivity.type);
      setTitle(initialActivity.title);
      setStartTime(initialActivity.startTime);
      setEndTime(initialActivity.endTime);
      setModuleId(initialActivity.moduleId ?? '');
      setLessonId(initialActivity.lessonId ?? '');
      setAssignmentId(initialActivity.assignmentId ?? '');
      setObjectives(initialActivity.objectives ?? []);
      setInstructions(initialActivity.instructions ?? '');
      if (initialActivity.assessment) {
        setAssessmentType(initialActivity.assessment.assessmentType);
        setMaxMarks(String(initialActivity.assessment.maxMarks));
        setPassingMarks(initialActivity.assessment.passingMarks ? String(initialActivity.assessment.passingMarks) : '');
        setFormat(initialActivity.assessment.format);
        setSyllabus(initialActivity.assessment.syllabus);
        setAssessmentInstructions(initialActivity.assessment.instructions);
      }
    } else {
      setType('lesson');
      setTitle('');
      setStartTime('09:30');
      setEndTime('11:00');
      setModuleId('');
      setLessonId('');
      setAssignmentId('');
      setObjectives([]);
      setInstructions('');
      setAssessmentType('weekly_test');
      setMaxMarks('50');
      setPassingMarks('25');
      setFormat('mcq');
      setSyllabus('');
      setAssessmentInstructions('');
    }
    setFormError(null);
  }, [initialActivity, isOpen]);

  if (!isOpen) return null;

  // Filter lessons by selected module
  const filteredLessons = moduleId
    ? lessons.filter((l) => l.moduleId === moduleId)
    : lessons;

  const handleLessonChange = (selectedId: string) => {
    setLessonId(selectedId);
    const selected = lessons.find((l) => l.id === selectedId);
    if (selected && !title) {
      setTitle(selected.title);
    }
    if (selected?.moduleId && !moduleId) {
      setModuleId(selected.moduleId);
    }
  };

  const handleAddObjective = () => {
    const trimmed = newObjective.trim();
    if (!trimmed) return;
    if (objectives.length >= 10) {
      setFormError('At most 10 objectives allowed per activity.');
      return;
    }
    setObjectives([...objectives, trimmed]);
    setNewObjective('');
    setFormError(null);
  };

  const handleRemoveObjective = (index: number) => {
    setObjectives(objectives.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const durationMinutes = calculateDurationMinutes(startTime, endTime);
    if (durationMinutes <= 0) {
      setFormError('End time must be after start time.');
      return;
    }

    if (type === 'lesson' && !lessonId) {
      setFormError('Please select a lesson for this lesson activity.');
      return;
    }

    const activity: TimetableActivity = {
      id: initialActivity?.id ?? `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      orderIndex: initialActivity?.orderIndex ?? 0,
      type,
      title: title.trim(),
      startTime,
      endTime,
      durationMinutes,
      courseId,
      moduleId: moduleId || undefined,
      lessonId: type === 'lesson' ? lessonId : undefined,
      assignmentId: type === 'assignment' ? assignmentId || undefined : undefined,
      objectives,
      instructions: instructions.trim() || undefined,
      assessment:
        type === 'quiz' || type === 'examination' || type === 'practical_assessment'
          ? {
              assessmentType,
              maxMarks: Number(maxMarks) || 50,
              passingMarks: passingMarks ? Number(passingMarks) : undefined,
              format,
              syllabus: syllabus.trim(),
              instructions: assessmentInstructions.trim(),
            }
          : undefined,
    };

    onSave(activity);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="activity-modal-title"
    >
      <div className="w-full max-w-xl max-h-[90vh] bg-surface rounded-2xl border border-line shadow-2xl flex flex-col animate-pop overflow-hidden">
        <header className="flex items-center justify-between p-5 border-b border-line bg-canvas">
          <h2 id="activity-modal-title" className="text-base font-bold text-ink">
            {initialActivity ? 'Edit Learning Activity' : 'Add Learning Activity'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-surface transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {formError && (
            <div className="p-3 rounded-lg border border-danger-line bg-danger-soft text-danger-ink text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {/* Activity Type */}
          <div className="space-y-1">
            <label htmlFor="actType" className="text-xs font-semibold text-ink-2">
              Activity Type
            </label>
            <select
              id="actType"
              value={type}
              onChange={(e) => setType(e.target.value as ActivityType)}
              className={inputClass}
            >
              {Object.entries(ACTIVITY_TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div className="space-y-1">
            <label htmlFor="actTitle" className="text-xs font-semibold text-ink-2">
              Activity Title
            </label>
            <input
              id="actTitle"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Asynchronous JavaScript & Promises"
              required
              minLength={2}
              maxLength={160}
              className={inputClass}
            />
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="actStart" className="text-xs font-semibold text-ink-2">
                Start Time
              </label>
              <input
                id="actStart"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="actEnd" className="text-xs font-semibold text-ink-2">
                End Time
              </label>
              <input
                id="actEnd"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className={inputClass}
              />
            </div>
          </div>

          {/* Lesson Picker (When type == lesson) */}
          {type === 'lesson' && (
            <div className="p-4 rounded-xl bg-canvas border border-line space-y-3">
              <div className="text-xs font-bold text-ink uppercase tracking-wider">
                Live Book Curriculum Link
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="actModule" className="text-[11px] font-semibold text-ink-3">
                    Module
                  </label>
                  <select
                    id="actModule"
                    value={moduleId}
                    onChange={(e) => setModuleId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">All Modules</option>
                    {modules.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="actLesson" className="text-[11px] font-semibold text-ink-3">
                    Lesson *
                  </label>
                  <select
                    id="actLesson"
                    value={lessonId}
                    onChange={(e) => handleLessonChange(e.target.value)}
                    required
                    className={inputClass}
                  >
                    <option value="">Select a published lesson</option>
                    {filteredLessons.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Assignment Link (When type == assignment) */}
          {type === 'assignment' && existingAssignments.length > 0 && (
            <div className="space-y-1">
              <label htmlFor="actAssign" className="text-xs font-semibold text-ink-2">
                Attach Existing Assignment (Optional)
              </label>
              <select
                id="actAssign"
                value={assignmentId}
                onChange={(e) => setAssignmentId(e.target.value)}
                className={inputClass}
              >
                <option value="">No existing assignment (new cohort task)</option>
                {existingAssignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Assessment Parameters (When type == quiz / exam / practical_assessment) */}
          {(type === 'quiz' || type === 'examination' || type === 'practical_assessment') && (
            <div className="p-4 rounded-xl bg-canvas border border-line space-y-3">
              <div className="text-xs font-bold text-ink uppercase tracking-wider">
                Assessment Specification
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="examType" className="text-[11px] font-semibold text-ink-3">
                    Category
                  </label>
                  <select
                    id="examType"
                    value={assessmentType}
                    onChange={(e) => setAssessmentType(e.target.value as AssessmentType)}
                    className={inputClass}
                  >
                    <option value="quiz">Quiz</option>
                    <option value="unit_test">Unit Test</option>
                    <option value="weekly_test">Weekly Test</option>
                    <option value="practical_exam">Practical Exam</option>
                    <option value="coding_assessment">Coding Assessment</option>
                    <option value="revision_test">Revision Test</option>
                    <option value="final_exam">Final Examination</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="examFormat" className="text-[11px] font-semibold text-ink-3">
                    Format
                  </label>
                  <select
                    id="examFormat"
                    value={format}
                    onChange={(e) => setFormat(e.target.value as AssessmentFormat)}
                    className={inputClass}
                  >
                    <option value="mcq">MCQ</option>
                    <option value="coding">Coding</option>
                    <option value="written">Written</option>
                    <option value="practical">Practical</option>
                    <option value="hybrid">Hybrid</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="examMax" className="text-[11px] font-semibold text-ink-3">
                    Maximum Marks
                  </label>
                  <input
                    id="examMax"
                    type="number"
                    min={1}
                    max={1000}
                    value={maxMarks}
                    onChange={(e) => setMaxMarks(e.target.value)}
                    required
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="examPass" className="text-[11px] font-semibold text-ink-3">
                    Passing Marks
                  </label>
                  <input
                    id="examPass"
                    type="number"
                    min={1}
                    max={1000}
                    value={passingMarks}
                    onChange={(e) => setPassingMarks(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="examSyllabus" className="text-[11px] font-semibold text-ink-3">
                  Syllabus Covered *
                </label>
                <input
                  id="examSyllabus"
                  value={syllabus}
                  onChange={(e) => setSyllabus(e.target.value)}
                  placeholder="e.g. DOM Manipulation, Event Listeners, Fetch API"
                  required
                  className={inputClass}
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="examInstructions" className="text-[11px] font-semibold text-ink-3">
                  Assessment Instructions
                </label>
                <textarea
                  id="examInstructions"
                  rows={2}
                  value={assessmentInstructions}
                  onChange={(e) => setAssessmentInstructions(e.target.value)}
                  placeholder="e.g. 45-minute timed test. Webcams mandatory."
                  className={inputClass}
                />
              </div>
            </div>
          )}

          {/* Learning Objectives */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-ink-2">
              Learning Objectives (Optional, max 10)
            </label>
            <div className="flex gap-2">
              <input
                value={newObjective}
                onChange={(e) => setNewObjective(e.target.value)}
                placeholder="e.g. Master Promise.all() concurrency"
                className={inputClass}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddObjective();
                  }
                }}
              />
              <button
                type="button"
                onClick={handleAddObjective}
                className="px-3 py-2 rounded-xl bg-surface border border-line hover:bg-surface-muted text-ink text-xs font-semibold shrink-0"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {objectives.length > 0 && (
              <ul className="space-y-1 pt-1">
                {objectives.map((obj, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-surface-muted text-xs text-ink"
                  >
                    <span>• {obj}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveObjective(i)}
                      className="text-ink-4 hover:text-danger-ink"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Activity Instructions / Notes */}
          <div className="space-y-1">
            <label htmlFor="actInstructions" className="text-xs font-semibold text-ink-2">
              Session Instructions / Notes (Optional)
            </label>
            <textarea
              id="actInstructions"
              rows={2}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Have starter code cloned from Git repository before class."
              className={inputClass}
            />
          </div>

          <div className="pt-3 border-t border-line flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-line text-xs font-semibold text-ink-2 hover:bg-surface-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-brand hover:bg-brand-strong text-white text-xs font-semibold transition-colors"
            >
              {initialActivity ? 'Update Activity' : 'Add Activity'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

