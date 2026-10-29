'use client';

/**
 * Strynkix Live Books — responsibilities and course-scope editor for Course
 * Design membership. Nothing is pre-selected: org-wide scope must be chosen
 * explicitly, otherwise the Super Admin picks specific courses.
 */

import React, { useEffect, useState } from 'react';
import { getAdminCourses } from '@/lib/courses/service';
import { ALL_COURSES, COURSE_DESIGN_RESPONSIBILITIES, MembershipInput } from '@/lib/admin/course-design';
import { Course, CourseDesignResponsibility } from '@/types/domain';
import { cx } from '@/components/ui/tones';

export function CourseDesignFields({ orgId, value, onChange }: { orgId: string; value: MembershipInput; onChange: (v: MembershipInput) => void }) {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const orgWide = value.assignedCourseIds[0] === ALL_COURSES;

  useEffect(() => {
    let alive = true;
    getAdminCourses(orgId)
      .then((list) => { if (alive) setCourses(list.sort((a, b) => a.title.localeCompare(b.title))); })
      .catch(() => { if (alive) setLoadError(true); });
    return () => {
      alive = false;
    };
  }, [orgId]);

  const toggleResp = (r: CourseDesignResponsibility) =>
    onChange({ ...value, responsibilities: value.responsibilities.includes(r) ? value.responsibilities.filter((x) => x !== r) : [...value.responsibilities, r] });
  const toggleCourse = (id: string) =>
    onChange({ ...value, assignedCourseIds: value.assignedCourseIds.includes(id) ? value.assignedCourseIds.filter((x) => x !== id) : [...value.assignedCourseIds.filter((x) => x !== ALL_COURSES), id] });

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2 rounded-xl border border-line p-3.5">
        <legend className="px-1 text-xs font-bold uppercase tracking-wider text-ink-3">Responsibilities</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {COURSE_DESIGN_RESPONSIBILITIES.map((r) => {
            const checked = value.responsibilities.includes(r.id);
            return (
              <label key={r.id} className={cx('flex cursor-pointer items-start gap-2.5 rounded-lg border p-2 text-xs transition-colors', checked ? 'border-brand bg-brand-soft/50' : 'border-line hover:border-silver')}>
                <input type="checkbox" checked={checked} onChange={() => toggleResp(r.id)} className="mt-0.5" />
                <span><span className="block font-bold text-ink">{r.label}</span><span className="block leading-tight text-ink-3">{r.description}</span></span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-2 rounded-xl border border-line p-3.5">
        <legend className="px-1 text-xs font-bold uppercase tracking-wider text-ink-3">Course scope</legend>
        <label className="flex cursor-pointer items-start gap-2 text-xs">
          <input type="checkbox" checked={orgWide} onChange={() => onChange({ ...value, assignedCourseIds: orgWide ? [] : [ALL_COURSES] })} className="mt-0.5" />
          <span><span className="font-bold text-ink">Every course in this organization</span><span className="block text-ink-3">Includes courses created later. Grant only when needed.</span></span>
        </label>
        {!orgWide && (
          loadError ? <p className="text-xs text-danger-ink">Courses couldn’t be loaded.</p>
            : courses === null ? <p className="text-xs text-ink-3">Loading courses…</p>
              : courses.length === 0 ? <p className="text-xs text-ink-3">No courses yet. Choose “every course” or create a course first.</p>
                : (
                  <ul className="max-h-44 space-y-1 overflow-y-auto pr-1">
                    {courses.map((c) => (
                      <li key={c.id}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-canvas">
                          <input type="checkbox" checked={value.assignedCourseIds.includes(c.id)} onChange={() => toggleCourse(c.id)} />
                          <span className="font-semibold text-ink-2">{c.title}</span>
                          <span className="text-ink-4">{c.status}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )
        )}
      </fieldset>
    </div>
  );
}
