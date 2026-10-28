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
import { lessonBlockSchema } from '@/types/validation';
import {
  Course,
  Lesson,
  LessonBlock,
  TextBlock,
  CodeExampleBlock,
  CalloutBlock,
  QuizBlock,
  WorkedExampleBlock,
  HeadingBlock,
  ImageBlock,
  PracticeTaskBlock,
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
  Heading,
  ImageIcon,
  Wrench,
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
  // Only the Super Admin publishes shared courses and lessons (owner decision D3).
  const canPublish = tenant?.role === 'super_admin';
  const [course, setCourse] = useState<Course | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [blocks, setBlocks] = useState<LessonBlock[]>([]);
  const [title, setTitle] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState(20);
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  // `loadError` is fatal (the lesson could not be opened). `error` is for save and
  // publish failures and renders inline, so the editor and unsaved work stay put.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Refreshes after a save without blanking the editor.
  const reloadLessonData = async () => {
    if (!tenant?.orgId) return;
    try {
      const [c, l] = await Promise.all([
        getCourseById(courseId),
        getLesson(lessonId, tenant.orgId, true),
      ]);
      if (!c || !l) {
        setError('Saved, but the lesson could not be reloaded. Refresh the page to see the latest version.');
        return;
      }
      setCourse(c);
      setLesson(l);
      setBlocks(l.blocks || []);
      setTitle(l.title);
      setEstimatedMinutes(l.estimatedMinutes || 20);
    } catch (err: unknown) {
      console.error('Failed to reload lesson editor data:', err);
      setError('Saved, but the lesson could not be reloaded. Refresh the page to see the latest version.');
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
            setLoadError('Lesson or course not found.');
            setIsLoading(false);
            return;
          }
          setCourse(c);
          setLesson(l);
          setBlocks(l.blocks || []);
          setTitle(l.title);
          setEstimatedMinutes(l.estimatedMinutes || 20);
          setLoadError(null);
          setIsLoading(false);
        }
      } catch (err: unknown) {
        if (isMounted) {
          console.error('Failed to load lesson editor data:', err);
          setLoadError('Unable to load lesson.');
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
    setError(null);
    setSuccessMsg(null);

    // Students' reader drops blocks that fail the schema, so an invalid block
    // must never be saved silently. Report the first problem per block instead.
    const problems = blocks.flatMap((block, i) => {
      const result = lessonBlockSchema.safeParse(block);
      if (result.success) return [];
      const issue = result.error.issues[0];
      const field = issue?.path?.length ? ` (${issue.path.join('.')})` : '';
      return [`Block ${i + 1} — ${block.type.replace('_', ' ')}${field}: ${issue?.message ?? 'invalid content'}`];
    });
    const minutes = Number(estimatedMinutes);
    if (!title.trim() || title.trim().length < 2) problems.unshift('Lesson title must be at least 2 characters.');
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) problems.unshift('Estimated minutes must be a whole number from 1 to 600.');
    if (problems.length) {
      setError(`Not saved — fix ${problems.length === 1 ? 'this' : 'these'} first: ${problems.join(' · ')}`);
      return;
    }

    setIsSaving(true);
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

  const addHeadingBlock = () => {
    const newBlock: HeadingBlock = {
      id: `blk_heading_${Date.now().toString(36)}`,
      type: 'heading',
      level: 2,
      text: 'New section',
    };
    setBlocks([...blocks, newBlock]);
  };

  const addImageBlock = () => {
    const newBlock: ImageBlock = {
      id: `blk_image_${Date.now().toString(36)}`,
      type: 'image',
      url: 'https://',
      altText: 'Describe what the image shows',
    };
    setBlocks([...blocks, newBlock]);
  };

  const addPracticeBlock = () => {
    const newBlock: PracticeTaskBlock = {
      id: `blk_practice_${Date.now().toString(36)}`,
      type: 'practice_task',
      title: 'Practice task',
      instructions: 'Describe what the student should build or change.',
      language: 'typescript',
      starterCode: '',
      hints: [],
      expectedOutcome: 'Describe how the student knows they are done.',
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
        <Loader2 className="w-8 h-8 text-brand-ink animate-spin" />
        <span className="text-xs text-ink-3">Loading Live Book Studio...</span>
      </div>
    );
  }

  if (loadError || !lesson || !course) {
    return (
      <div className="p-8 max-w-md mx-auto my-12 bg-surface border border-line rounded-2xl text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-danger-ink mx-auto" />
        <h3 className="text-lg font-bold text-ink">Lesson Not Found</h3>
        <p className="text-xs text-ink-3">{loadError || 'Could not load lesson.'}</p>
        <Link
          href={`/dashboard/courses/${courseId}`}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white text-xs font-semibold"
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line">
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/courses/${course.id}`}
            className="p-2 rounded-lg bg-surface border border-line text-ink-3 hover:text-ink transition"
            title="Back to Curriculum"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.06em] text-brand-ink font-semibold">
                Live Book Block Studio
              </span>
              <span
                className={`text-[10px] font-bold uppercase tracking-[0.06em] px-2 py-0.5 rounded-full border ${
 isPub
 ? 'bg-success-soft text-success-ink border-success-line'
 : 'bg-warning-soft text-warning-ink border-warning-line'
 }`}
              >
                {lesson.status}
              </span>
            </div>
            <h2 className="text-xl font-extrabold text-ink">{lesson.title}</h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Editor vs Live Preview Toggle */}
          <div className="flex items-center bg-surface p-1 rounded-xl border border-line">
            <button
              type="button"
              onClick={() => setActiveTab('editor')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
 activeTab === 'editor'
 ? 'bg-brand text-white shadow-sm'
 : 'text-ink-3 hover:text-ink'
 }`}
            >
              Studio Editor
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
 activeTab === 'preview'
 ? 'bg-brand text-white shadow-sm'
 : 'text-ink-3 hover:text-ink'
 }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Live Preview</span>
            </button>
          </div>

{canPublish ? (<>
          {/* Publish / Unpublish */}
          <button
            type="button"
            onClick={handleTogglePublish}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition ${
 isPub
 ? 'bg-warning-soft text-warning-ink border border-warning-line hover:bg-surface-muted'
 : 'bg-success-soft text-success-ink border border-success-line hover:bg-surface-muted'
 }`}
          >
            {isPub ? <XCircle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            <span>{isPub ? 'Unpublish' : 'Publish'}</span>
          </button>
          </>) : (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface-muted px-3 py-2 text-xs font-semibold text-ink-3" title="Only the Super Admin publishes lessons">{isPub ? 'Published' : 'Draft · Super Admin publishes'}</span>
          )}

          {/* Save Button */}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-success hover:bg-success disabled:opacity-50 text-white text-xs font-semibold shadow-card transition"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{isSaving ? 'Saving...' : 'Save Blocks'}</span>
          </button>
        </div>
      </div>

      {/* Alerts */}
      {successMsg && (
        <div className="p-4 rounded-xl bg-success-soft border border-success-line flex items-center gap-2.5 text-success-ink text-xs">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-success-ink" />
          <span>{successMsg}</span>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-danger-soft border border-danger-line flex items-center gap-2.5 text-danger-ink text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 text-danger-ink" />
          <span>{error}</span>
        </div>
      )}

      {/* Studio Workspace */}
      {activeTab === 'editor' ? (
        <div className="space-y-6">
          {/* Metadata Controls */}
          <div className="p-5 rounded-2xl bg-surface border border-line grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2 space-y-1">
              <label className="text-xs font-semibold text-ink-2">Lesson Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-2">Estimated Minutes</label>
              <input
                type="number"
                min={1}
                max={600}
                value={estimatedMinutes}
                onChange={(e) => setEstimatedMinutes(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink font-mono focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
              />
            </div>
          </div>

          {/* Block Toolbox */}
          <div className="p-4 rounded-2xl bg-surface border border-line flex flex-wrap items-center justify-between gap-3 shadow-card">
            <div className="text-xs font-semibold text-ink-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-brand-ink" />
              <span>Add Pedagogical Block:</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={addTextBlock}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-sunken text-ink text-xs font-semibold transition"
              >
                <FileText className="w-3.5 h-3.5 text-brand-ink" />
                <span>Text Concept</span>
              </button>
              <button
                type="button"
                onClick={addCodeBlock}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-sunken text-ink text-xs font-semibold transition"
              >
                <FileCode className="w-3.5 h-3.5 text-teal-ink" />
                <span>Code Block</span>
              </button>
              <button
                type="button"
                onClick={addCalloutBlock}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-sunken text-ink text-xs font-semibold transition"
              >
                <Info className="w-3.5 h-3.5 text-warning-ink" />
                <span>Callout</span>
              </button>
              <button
                type="button"
                onClick={addQuizBlock}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-sunken text-ink text-xs font-semibold transition"
              >
                <HelpCircle className="w-3.5 h-3.5 text-success-ink" />
                <span>Quiz Checkpoint</span>
              </button>
              <button
                type="button"
                onClick={addWorkedExample}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-sunken text-ink text-xs font-semibold transition"
              >
                <Plus className="w-3.5 h-3.5 text-lavender-ink" />
                <span>Worked Example</span>
              </button>
              <button
                type="button"
                onClick={addPracticeBlock}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-sunken text-ink text-xs font-semibold transition"
              >
                <Wrench className="w-3.5 h-3.5 text-coral-ink" />
                <span>Practice Task</span>
              </button>
              <button
                type="button"
                onClick={addHeadingBlock}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-sunken text-ink text-xs font-semibold transition"
              >
                <Heading className="w-3.5 h-3.5 text-ink-2" />
                <span>Heading</span>
              </button>
              <button
                type="button"
                onClick={addImageBlock}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-muted hover:bg-surface-sunken text-ink text-xs font-semibold transition"
              >
                <ImageIcon className="w-3.5 h-3.5 text-teal-ink" />
                <span>Image</span>
              </button>
            </div>
          </div>

          {/* Blocks Sequence */}
          <div className="space-y-4">
            {blocks.map((block, idx) => (
              <div
                key={block.id || idx}
                className="rounded-2xl border border-line bg-surface p-5 space-y-3 shadow-card"
              >
                {/* Block Header & Reordering Toolbar */}
                <div className="flex items-center justify-between pb-3 border-b border-line">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded bg-surface-muted text-ink-3">
                      Block {idx + 1}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-[0.06em] text-brand-ink font-bold">
                      {block.type}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveBlock(idx, 'up')}
                      disabled={idx === 0}
                      className="p-1 rounded text-ink-3 hover:text-ink disabled:opacity-30"
                      title="Move Up"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveBlock(idx, 'down')}
                      disabled={idx === blocks.length - 1}
                      className="p-1 rounded text-ink-3 hover:text-ink disabled:opacity-30"
                      title="Move Down"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBlock(idx)}
                      className="p-1 rounded text-ink-3 hover:text-danger-ink"
                      title="Delete Block"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Block Specific Form Elements */}
                {block.type === 'text' && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-ink-3">Narrative Content</label>
                    <textarea
                      rows={4}
                      value={block.content}
                      onChange={(e) => updateBlockField(idx, 'content', e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-sans"
                    />
                  </div>
                )}

                {block.type === 'code_example' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-ink-3">Language</label>
                        <input
                          type="text"
                          value={block.language}
                          onChange={(e) => updateBlockField(idx, 'language', e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-ink-3">Caption</label>
                        <input
                          type="text"
                          value={block.caption || ''}
                          onChange={(e) => updateBlockField(idx, 'caption', e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-ink-3">Code Snippet</label>
                      <textarea
                        rows={6}
                        value={block.code}
                        onChange={(e) => updateBlockField(idx, 'code', e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-success-ink font-mono focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
                      />
                    </div>
                  </div>
                )}

                {block.type === 'callout' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-ink-3">Variant</label>
                        <select
                          value={block.variant}
                          onChange={(e) => updateBlockField(idx, 'variant', e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
                        >
                          <option value="info">Info</option>
                          <option value="tip">Tip</option>
                          <option value="warning">Warning</option>
                          <option value="danger">Danger</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-ink-3">Title</label>
                        <input
                          type="text"
                          value={block.title || ''}
                          onChange={(e) => updateBlockField(idx, 'title', e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-ink-3">Callout Message</label>
                      <textarea
                        rows={2}
                        value={block.content}
                        onChange={(e) => updateBlockField(idx, 'content', e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
                      />
                    </div>
                  </div>
                )}

                {block.type === 'quiz' && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-ink-3">Question</label>
                      <input
                        type="text"
                        value={block.question}
                        onChange={(e) => updateBlockField(idx, 'question', e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-medium text-ink-3">Options & Correct Answer</label>
                      {block.options.map((opt, optIdx) => (
                        <div key={opt.id} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`quiz_${block.id}`}
                            checked={block.correctOptionId === opt.id}
                            onChange={() => updateBlockField(idx, 'correctOptionId', opt.id)}
                            className="text-success-ink focus:ring-brand"
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
                            className="flex-1 px-3 py-1.5 rounded-lg bg-surface border border-line text-xs text-ink"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-medium text-ink-3">Explanation</label>
                      <textarea
                        rows={2}
                        value={block.explanation}
                        onChange={(e) => updateBlockField(idx, 'explanation', e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
                      />
                    </div>
                  </div>
                )}

                {block.type === 'heading' && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr]">
                    <div className="space-y-1">
                      <label htmlFor={`lvl-${block.id}`} className="text-xs font-medium text-ink-3">Level</label>
                      <select id={`lvl-${block.id}`} value={block.level}
                        onChange={(e) => updateBlockField(idx, 'level', Number(e.target.value))} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15">
                        <option value={1}>Section</option>
                        <option value={2}>Subsection</option>
                        <option value={3}>Minor heading</option>
                        <option value={4}>Small heading</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor={`hd-${block.id}`} className="text-xs font-medium text-ink-3">Heading text</label>
                      <input id={`hd-${block.id}`} type="text" value={block.text} maxLength={200}
                        onChange={(e) => updateBlockField(idx, 'text', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
                    </div>
                  </div>
                )}

                {block.type === 'image' && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label htmlFor={`img-${block.id}`} className="text-xs font-medium text-ink-3">Image URL</label>
                      <input id={`img-${block.id}`} type="url" value={block.url} maxLength={1000}
                        onChange={(e) => updateBlockField(idx, 'url', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono" />
                      <p className="text-[11px] text-ink-3">Use an https:// address or a site path such as /images/diagram.png. File upload is not available yet.</p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label htmlFor={`alt-${block.id}`} className="text-xs font-medium text-ink-3">Alt text (required)</label>
                        <input id={`alt-${block.id}`} type="text" value={block.altText} maxLength={300}
                          onChange={(e) => updateBlockField(idx, 'altText', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`cap-${block.id}`} className="text-xs font-medium text-ink-3">Caption</label>
                        <input id={`cap-${block.id}`} type="text" value={block.caption || ''} maxLength={300}
                          onChange={(e) => updateBlockField(idx, 'caption', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
                      </div>
                    </div>
                  </div>
                )}

                {block.type === 'practice_task' && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label htmlFor={`pt-${block.id}`} className="text-xs font-medium text-ink-3">Task title</label>
                      <input id={`pt-${block.id}`} type="text" value={block.title} maxLength={160}
                        onChange={(e) => updateBlockField(idx, 'title', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor={`pi-${block.id}`} className="text-xs font-medium text-ink-3">Instructions</label>
                      <textarea id={`pi-${block.id}`} rows={3} value={block.instructions}
                        onChange={(e) => updateBlockField(idx, 'instructions', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]">
                      <div className="space-y-1">
                        <label htmlFor={`pl-${block.id}`} className="text-xs font-medium text-ink-3">Language</label>
                        <input id={`pl-${block.id}`} type="text" value={block.language || ''} maxLength={30}
                          onChange={(e) => updateBlockField(idx, 'language', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono" />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`ps-${block.id}`} className="text-xs font-medium text-ink-3">Starter code (optional)</label>
                        <textarea id={`ps-${block.id}`} rows={4} value={block.starterCode || ''} spellCheck={false}
                          onChange={(e) => updateBlockField(idx, 'starterCode', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 font-mono" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor={`ph-${block.id}`} className="text-xs font-medium text-ink-3">Hints (one per line, up to 10)</label>
                      <textarea id={`ph-${block.id}`} rows={2} value={(block.hints || []).join('\n')}
                        onChange={(e) => updateBlockField(idx, 'hints', e.target.value.split('\n').slice(0, 10))} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor={`po-${block.id}`} className="text-xs font-medium text-ink-3">You&apos;re done when (expected outcome)</label>
                      <textarea id={`po-${block.id}`} rows={2} value={block.expectedOutcome}
                        onChange={(e) => updateBlockField(idx, 'expectedOutcome', e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15" />
                    </div>
                  </div>
                )}

                {block.type === 'worked_example' && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-ink-3">Example Title</label>
                      <input
                        type="text"
                        value={block.title}
                        onChange={(e) => updateBlockField(idx, 'title', e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-ink-3">Problem Statement</label>
                      <textarea
                        rows={2}
                        value={block.problem}
                        onChange={(e) => updateBlockField(idx, 'problem', e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-ink-3">Solution Code</label>
                      <textarea
                        rows={3}
                        value={block.solutionCode || ''}
                        onChange={(e) => updateBlockField(idx, 'solutionCode', e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-success-ink font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-ink-3">Explanation</label>
                      <textarea
                        rows={2}
                        value={block.explanation}
                        onChange={(e) => updateBlockField(idx, 'explanation', e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line-strong text-sm text-ink"
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
        <div className="p-8 rounded-3xl bg-surface border border-line shadow-lift max-w-4xl mx-auto space-y-6">
          <div className="pb-4 border-b border-line">
            <span className="text-xs font-bold uppercase tracking-[0.06em] text-brand-ink font-bold">
              Student Reader Preview
            </span>
            <h1 className="text-3xl font-extrabold text-ink mt-1">{title}</h1>
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
          <Loader2 className="w-8 h-8 text-brand-ink animate-spin" />
          <span className="text-xs text-ink-3">Loading lesson studio...</span>
        </div>
      }
    >
      <LessonEditorContent params={params} />
    </Suspense>
  );
}
