'use client';

/**
 * Strynkix LMS — Live Book Lesson Authoring & Block Studio
 * Enables instructors to compose, reorder, edit, preview, and publish
 * modular Live Book pedagogical blocks (text, code, callouts, quizzes, worked examples).
 */

import React, { useEffect, useState, use, Suspense } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/dashboard/AppShell';
import { RequireRole } from '@/components/auth/RouteGuards';
import { getCourseById, updateLesson, setLessonStatus } from '@/lib/courses/service';
import { getLesson } from '@/lib/livebook/service';
import { LessonBlockRenderer } from '@/components/livebook/LessonBlockRenderer';
import {
  Course,
  Lesson,
  LessonBlock,
  TextBlock,
  CodeExampleBlock,
  CalloutBlock,
  QuizBlock,
  WorkedExampleBlock,
  EntityStatus,
} from '@/types/domain';
import {
  ArrowLeft,
  Eye,
  Save,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileCode,
  HelpCircle,
  Info,
  Check,
  XCircle,
  FileText,
  Sparkles,
} from 'lucide-react';

interface LessonEditorPageProps {
  params: Promise<{ courseId: string; lessonId: string }>;
}

function LessonBlockEditorView({
  courseId,
  lessonId,
}: {
  courseId: string;
  lessonId: string;
}) {
  const { tenant } = useAuth();
  const [course, setCourse] = useState<Course | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [blocks, setBlocks] = useState<LessonBlock[]>([]);
  const [title, setTitle] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState(20);
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const reloadLessonData = async () => {
    if (!tenant?.orgId) return;
    try {
      setIsLoading(true);
      setError(null);
      const [c, l] = await Promise.all([
        getCourseById(courseId),
        getLesson(lessonId, tenant.orgId, true),
      ]);

      if (!c || !l) {
        setError('Lesson or course not found.');
        return;
      }
      setCourse(c);
      setLesson(l);
      setBlocks(l.blocks || []);
      setTitle(l.title);
      setEstimatedMinutes(l.estimatedMinutes || 20);
    } catch (err: unknown) {
      console.error('Failed to load lesson editor data:', err);
      setError('Unable to load lesson.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    async function fetchLessonData() {
      if (!tenant?.orgId) {
        if (isMounted) setIsLoading(false);
        return;
      }
      try {
        const [c, l] = await Promise.all([
          getCourseById(courseId),
          getLesson(lessonId, tenant.orgId, true),
        ]);

        if (isMounted) {
          if (!c || !l) {
            setError('Lesson or course not found.');
            setIsLoading(false);
            return;
          }
          setCourse(c);
          setLesson(l);
          setBlocks(l.blocks || []);
          setTitle(l.title);
          setEstimatedMinutes(l.estimatedMinutes || 20);
          setError(null);
          setIsLoading(false);
        }
      } catch (err: unknown) {
        if (isMounted) {
          console.error('Failed to load lesson editor data:', err);
          setError('Unable to load lesson.');
          setIsLoading(false);
        }
      }
    }

    fetchLessonData();
    return () => {
      isMounted = false;
    };
  }, [courseId, lessonId, tenant?.orgId]);

  const handleSave = async () => {
    if (!lesson) return;
    setIsSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await updateLesson(lesson.id, {
        title: title.trim(),
        estimatedMinutes: Number(estimatedMinutes),
        blocks,
      });
      setSuccessMsg('All lesson blocks saved successfully!');
      await reloadLessonData();
    } catch (err: unknown) {
      const e = err as Error;
      setError(`Failed to save lesson: ${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTogglePublish = async () => {
    if (!lesson) return;
    const nextStatus: EntityStatus = lesson.status === 'published' ? 'draft' : 'published';
    try {
      await setLessonStatus(lesson.id, nextStatus);
      setSuccessMsg(`Lesson status changed to ${nextStatus.toUpperCase()}.`);
      await reloadLessonData();
    } catch (err: unknown) {
      const e = err as Error;
      setError(`Failed to update publication: ${e.message}`);
    }
  };

  // Block Manipulation Helpers
  const addTextBlock = () => {
    const newBlock: TextBlock = {
      id: `blk_text_${Date.now().toString(36)}`,
      type: 'text',
      content: 'New concept narrative block. Type explanation here...',
    };
    setBlocks([...blocks, newBlock]);
  };

  const addCodeBlock = () => {
    const newBlock: CodeExampleBlock = {
      id: `blk_code_${Date.now().toString(36)}`,
      type: 'code_example',
      language: 'typescript',
      code: '// Type executable code snippet here\nfunction calculateChecksum(data: string): number {\n  return data.length;\n}',
      caption: 'Example TypeScript implementation',
    };
    setBlocks([...blocks, newBlock]);
  };

  const addCalloutBlock = () => {
    const newBlock: CalloutBlock = {
      id: `blk_callout_${Date.now().toString(36)}`,
      type: 'callout',
      variant: 'info',
      title: 'Architectural Invariant',
      content: 'Always enforce validation at the data access perimeter.',
    };
    setBlocks([...blocks, newBlock]);
  };

  const addQuizBlock = () => {
    const optA = `opt_a_${Date.now().toString(36)}`;
    const optB = `opt_b_${Date.now().toString(36)}`;
    const newBlock: QuizBlock = {
      id: `blk_quiz_${Date.now().toString(36)}`,
      type: 'quiz',
      question: 'Which component is the true security boundary in Firestore?',
      options: [
        { id: optA, text: 'Frontend UI route guards' },
        { id: optB, text: 'Cloud Firestore Security Rules (firestore.rules)' },
      ],
      correctOptionId: optB,
      explanation: 'UI guards only enhance presentation; Firestore Security Rules enforce access at the database level.',
    };
    setBlocks([...blocks, newBlock]);
  };

  const addWorkedExample = () => {
    const newBlock: WorkedExampleBlock = {
      id: `blk_example_${Date.now().toString(36)}`,
      type: 'worked_example',
      title: 'Worked Example: Data Boundary Verification',
      problem: 'A multi-tenant system must isolate university branches from reading cross-campus progress.',
      solutionCode: 'match /progress/{id} {\n  allow read: if request.auth.uid == resource.data.studentId;\n}',
      explanation: 'The compound security rule verifies student UID ownership against the document data attribute.',
    };
    setBlocks([...blocks, newBlock]);
  };

  const removeBlock = (index: number) => {
    const updated = [...blocks];
    updated.splice(index, 1);
    setBlocks(updated);
  };

  const moveBlock = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === blocks.length - 1) return;
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    const updated = [...blocks];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIdx, 0, moved);
    setBlocks(updated);
  };

  const updateBlockField = (index: number, field: string, value: unknown) => {
    const updated = [...blocks];
    updated[index] = { ...updated[index], [field]: value } as LessonBlock;
    setBlocks(updated);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-3">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <span className="text-xs text-slate-400 font-mono">Loading Live Book Studio...</span>
      </div>
    );
  }

  if (error || !lesson || !course) {
    return (
      <div className="p-8 max-w-md mx-auto my-12 bg-slate-900 border border-slate-800 rounded-2xl text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
        <h3 className="text-lg font-bold text-white">Lesson Not Found</h3>
        <p className="text-xs text-slate-400">{error || 'Could not load lesson.'}</p>
        <Link
          href={`/dashboard/courses/${courseId}`}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Curriculum</span>
        </Link>
      </div>
    );
  }

  const isPub = lesson.status === 'published';

  return (
    <div className="space-y-6">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/courses/${course.id}`}
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition"
            title="Back to Curriculum"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase text-indigo-400 font-semibold">
                Live Book Block Studio
              </span>
              <span
                className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${
                  isPub
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    : 'bg-amber-950 text-amber-300 border-amber-800'
                }`}
              >
                {lesson.status}
              </span>
            </div>
            <h2 className="text-xl font-extrabold text-white">{lesson.title}</h2>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Editor vs Live Preview Toggle */}
          <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('editor')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'editor'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Studio Editor
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                activeTab === 'preview'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Live Preview</span>
            </button>
          </div>

          {/* Publish / Unpublish */}
          <button
            type="button"
            onClick={handleTogglePublish}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition ${
              isPub
                ? 'bg-amber-950 text-amber-300 border border-amber-800 hover:bg-amber-900'
                : 'bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-900'
            }`}
          >
            {isPub ? <XCircle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            <span>{isPub ? 'Unpublish' : 'Publish'}</span>
          </button>

          {/* Save Button */}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-emerald-600/30 transition"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{isSaving ? 'Saving...' : 'Save Blocks'}</span>
          </button>
        </div>
      </div>

      {/* Alerts */}
      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800 flex items-center gap-2.5 text-emerald-300 text-xs">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 flex items-center gap-2.5 text-rose-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Studio Workspace */}
      {activeTab === 'editor' ? (
        <div className="space-y-6">
          {/* Metadata Controls */}
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2 space-y-1">
              <label className="text-xs font-semibold text-slate-300">Lesson Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Estimated Minutes</label>
              <input
                type="number"
                min={1}
                max={600}
                value={estimatedMinutes}
                onChange={(e) => setEstimatedMinutes(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Block Toolbox */}
          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-wrap items-center justify-between gap-3 shadow-lg">
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span>Add Pedagogical Block:</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={addTextBlock}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
              >
                <FileText className="w-3.5 h-3.5 text-indigo-400" />
                <span>Text Concept</span>
              </button>
              <button
                type="button"
                onClick={addCodeBlock}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
              >
                <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                <span>Code Block</span>
              </button>
              <button
                type="button"
                onClick={addCalloutBlock}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
              >
                <Info className="w-3.5 h-3.5 text-amber-400" />
                <span>Callout</span>
              </button>
              <button
                type="button"
                onClick={addQuizBlock}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
              >
                <HelpCircle className="w-3.5 h-3.5 text-emerald-400" />
                <span>Quiz Checkpoint</span>
              </button>
              <button
                type="button"
                onClick={addWorkedExample}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
              >
                <Plus className="w-3.5 h-3.5 text-purple-400" />
                <span>Worked Example</span>
              </button>
            </div>
          </div>

          {/* Blocks Sequence */}
          <div className="space-y-4">
            {blocks.map((block, idx) => (
              <div
                key={block.id || idx}
                className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3 shadow-lg"
              >
                {/* Block Header & Reordering Toolbar */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                      Block {idx + 1}
                    </span>
                    <span className="text-xs font-mono uppercase text-indigo-400 font-bold">
                      {block.type}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveBlock(idx, 'up')}
                      disabled={idx === 0}
                      className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30"
                      title="Move Up"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveBlock(idx, 'down')}
                      disabled={idx === blocks.length - 1}
                      className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30"
                      title="Move Down"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBlock(idx)}
                      className="p-1 rounded text-slate-400 hover:text-rose-400"
                      title="Delete Block"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Block Specific Form Elements */}
                {block.type === 'text' && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-400">Narrative Content</label>
                    <textarea
                      rows={4}
                      value={block.content}
                      onChange={(e) => updateBlockField(idx, 'content', e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                    />
                  </div>
                )}

                {block.type === 'code_example' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-400">Language</label>
                        <input
                          type="text"
                          value={block.language}
                          onChange={(e) => updateBlockField(idx, 'language', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-400">Caption</label>
                        <input
                          type="text"
                          value={block.caption || ''}
                          onChange={(e) => updateBlockField(idx, 'caption', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-400">Code Snippet</label>
                      <textarea
                        rows={6}
                        value={block.code}
                        onChange={(e) => updateBlockField(idx, 'code', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-emerald-300 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                )}

                {block.type === 'callout' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-400">Variant</label>
                        <select
                          value={block.variant}
                          onChange={(e) => updateBlockField(idx, 'variant', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                        >
                          <option value="info">Info</option>
                          <option value="tip">Tip</option>
                          <option value="warning">Warning</option>
                          <option value="danger">Danger</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-400">Title</label>
                        <input
                          type="text"
                          value={block.title || ''}
                          onChange={(e) => updateBlockField(idx, 'title', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-400">Callout Message</label>
                      <textarea
                        rows={2}
                        value={block.content}
                        onChange={(e) => updateBlockField(idx, 'content', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                      />
                    </div>
                  </div>
                )}

                {block.type === 'quiz' && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-400">Question</label>
                      <input
                        type="text"
                        value={block.question}
                        onChange={(e) => updateBlockField(idx, 'question', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-400">Options & Correct Answer</label>
                      {block.options.map((opt, optIdx) => (
                        <div key={opt.id} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`quiz_${block.id}`}
                            checked={block.correctOptionId === opt.id}
                            onChange={() => updateBlockField(idx, 'correctOptionId', opt.id)}
                            className="text-emerald-500 focus:ring-emerald-500"
                            title="Mark as correct answer"
                          />
                          <input
                            type="text"
                            value={opt.text}
                            onChange={(e) => {
                              const newOpts = [...block.options];
                              newOpts[optIdx] = { ...newOpts[optIdx], text: e.target.value };
                              updateBlockField(idx, 'options', newOpts);
                            }}
                            className="flex-1 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-400">Explanation</label>
                      <textarea
                        rows={2}
                        value={block.explanation}
                        onChange={(e) => updateBlockField(idx, 'explanation', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                      />
                    </div>
                  </div>
                )}

                {block.type === 'worked_example' && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-400">Example Title</label>
                      <input
                        type="text"
                        value={block.title}
                        onChange={(e) => updateBlockField(idx, 'title', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-400">Problem Statement</label>
                      <textarea
                        rows={2}
                        value={block.problem}
                        onChange={(e) => updateBlockField(idx, 'problem', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-400">Solution Code</label>
                      <textarea
                        rows={3}
                        value={block.solutionCode || ''}
                        onChange={(e) => updateBlockField(idx, 'solutionCode', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-emerald-300 font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-400">Explanation</label>
                      <textarea
                        rows={2}
                        value={block.explanation}
                        onChange={(e) => updateBlockField(idx, 'explanation', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Live Preview Mode */
        <div className="p-8 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-2xl max-w-4xl mx-auto space-y-6">
          <div className="pb-4 border-b border-slate-800">
            <span className="text-xs font-mono uppercase text-indigo-400 font-bold">
              Student Reader Preview
            </span>
            <h1 className="text-3xl font-extrabold text-white mt-1">{title}</h1>
          </div>

          <div className="space-y-3">
            {blocks.map((block) => (
              <LessonBlockRenderer key={block.id} block={block} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LessonEditorContent({ params }: LessonEditorPageProps) {
  const resolved = use(params);
  return (
    <RequireRole allowedRoles={['super_admin', 'university_admin', 'branch_admin', 'instructor']}>
      <AppShell pageTitle="Lesson Block Studio">
        <LessonBlockEditorView courseId={resolved.courseId} lessonId={resolved.lessonId} />
      </AppShell>
    </RequireRole>
  );
}

export default function LessonEditorPage({ params }: LessonEditorPageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center py-24 space-y-3">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <span className="text-xs text-slate-400 font-mono">Loading lesson studio...</span>
        </div>
      }
    >
      <LessonEditorContent params={params} />
    </Suspense>
  );
}
