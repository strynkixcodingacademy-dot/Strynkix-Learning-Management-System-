# Strynkix design system: "The academy press"

Strynkix looks and behaves like a university press: ivory paper, blue-black ink, cloth-bound books, contents pages and ribbon bookmarks. Tokens live in `src/app/globals.css`; components live in `src/components/ui/`. The app is light only.

When you add a screen, use the components below and the tokens they already use. If you need a new colour or size, that is a design decision, so add it here.

## Principles

- **Typography carries the hierarchy.** Size and typeface separate levels, not coloured cards.
- **Colour means something.** Every hue below has one job. A colour with no job doesn't belong on the page.
- **Not everything is a card.** Figures sit on rules, lists divide with rules, and tables are tables. Cards are for objects the user opens or fills in.
- **One primary action per view.** Everything else is secondary or ghost.
- **Motion answers the user.** Dialogs, drawers and confirmations animate. Nothing animates on load or while reading.
- **Plain copy.** Say what is on the page ("No plan today. Pick up a course where you left it."). No slogans, clever headlines or numbered feature trios.
- **Status is quiet.** A dot or icon and words in the tone's colour, never a tinted chip.

## Type

| Face | Token | Used for |
|---|---|---|
| Literata | `font-display`, `font-reading` | The page `h1`, course covers, lesson and block titles (weight 560), and long-form reading. Its optical-size axis adapts it from display to body sizes. |
| Schibsted Grotesk | `font-sans` (default) | The interface, section headings and figures |
| JetBrains Mono | `font-mono` | Code and technical identifiers only |

All three load through `next/font/google` in `src/app/layout.tsx`, so they are self-hosted at build time.

| Utility | Use |
|---|---|
| `type-page` | The page `h1` (fluid, 28 to 40px). `PageHeader` applies it. |
| `type-section` | Section titles: interface face, 17px semibold. `Section` and `Modal` apply it. |
| `type-figure` | A number: score, balance or percentage. Interface face, tabular. |
| `prose-reading` | Lesson body text (18px / 1.72, 68ch) |
| `text-xs` / `sm` / `body` / `base` | 12.5 / 14 / 15 / 16px interface text. Nothing is smaller than 12.5px. |

Only the `h1` is set in the book face by default; `h2` and below are the interface face. Keep the serif for moments that are actually bookish (page titles, covers, lesson titles). If every heading is serif, the page reads as a template.

Don't use all-caps labels or tracked-out micro labels. A label above a heading goes under it instead (`PageHeader`'s `eyebrow`), and only when it is real context such as a date, code or role.

## Colour

| Token family | Meaning |
|---|---|
| `canvas`, `surface`, `surface-muted`, `surface-sunken`, `sidebar` | Paper, from the page ground up to white and down to tints |
| `ink`, `ink-2`, `ink-3`, `ink-4` | Text. All four are at least 4.5:1 on white and on `canvas`. |
| `line`, `line-strong`, `silver` | Rules. `silver` is decorative only (chevrons, large inactive numerals). |
| `brand` | Cobalt: primary action, links, the current place |
| `success` | Sage: completed, passed |
| `warning` | Amber: today's objectives, due soon |
| `coral` | Overdue, late, urgent, not passed |
| `danger` | Brick: errors and destructive actions |
| `teal` | Assessments and submissions |
| `info` | Slate: neutral information, administration |
| `highlight` | The ribbon only |
| `cloth-*`, `foil` | Course identity only, never status |

Each meaning colour has `-soft` (tint), `-line` (border on a tint) and `-ink` (text on a tint, at least 4.5:1). Use `TONE_CLASSES` in `tones.ts` from code. Status is always shown as words, never colour alone.

## Signature elements

- **Cloth covers** (`CourseCover`, `CourseIcon`): every course is a bound volume. The cloth colour follows its subject and falls back to a stable colour from its id (`courseIdentity`), so a course looks the same everywhere. The cover title is decorative CSS content, so always repeat the title as real text beside it.
- **The ribbon** (`ribbon` utility): the amber bookmark means "today" or "you are here". Don't use it for anything else.
- **Contents and rails**: real sequences get numbers and a rail (`CoursePath`, `MyDayPanel`). Things that aren't sequences don't get numbers.

## Shape and depth

- **Radius:** `md` 6px (small controls), `lg` 8px (fields, buttons), `card` 12px. `rounded-full` is for status pills, avatars and rail nodes.
- **Depth:** cards use a border, not a shadow. `shadow-lift` is for hover on an object, `shadow-float` for what truly floats (dialogs, menus).
- **Motion:** 120 to 240ms with `--ease-out-quint`. `prefers-reduced-motion` collapses all of it, globally.

## Components (`src/components/ui`)

| Component | Notes |
|---|---|
| `Button`, `buttonClasses`, `IconButton`, `iconButtonClasses` | Variants: primary, secondary, ghost, danger, success. Sizes: sm 32, md 40, lg 48px. `loading` shows a spinner. |
| `PageHeader`, `Section`, `SectionLink`, `Breadcrumbs` | Page structure. Every page has exactly one visible `h1`. |
| `Card` | A bordered surface for objects, with an optional `interactive` hover. |
| `TableFrame` | Scroll frame for tables. Base styles handle headers, row hover and tabular numerals. |
| `Field`, `fieldClasses`, `SearchInput`, `Segmented` | Forms and filters. `Segmented` uses native radios, so arrow keys work. |
| `Facts` | Label and value pairs on detail pages |
| `Modal`, `ModalFrame` | `Modal` draws a titled dialog, as a bottom sheet on phones. `ModalFrame` gives a self-drawn panel native modal behaviour. Leave off `onClose` when content must be acknowledged, such as one-time credentials: Esc then does nothing. |
| `useConfirm` | Promise-based confirm and prompt dialogs. Never use `window.confirm`. |
| `Tabs` | Roving tabindex with arrow keys |
| `StatusPill`, `ProgressBar`, `ProgressRing`, `Avatar` | `StatusPill` is a small dot (or icon) and words in the tone's ink, with no chip background. Avatars are neutral: a person isn't a status. |
| `KpiTile` | A figure on a rule. Only coral, danger and warning colour the number, and never when the value is 0. |
| `ColumnChart`, `Meter`, and `BarList`, `PairedColumns` (`components/command/Charts.tsx`) | Thin marks on one baseline, each with a hidden table of exact values. Paired series use cobalt and coral, which pass the colour-blind separation check; don't change them without re-validating. |
| `EmptyState`, `ErrorState`, `LoadingState`, `Skeleton`, `Notice` | `Notice` is the inline confirmation. Errors announce assertively. |

## Layout

- **Shell** (`components/dashboard/AppShell.tsx`): a 240px labelled sidebar from `lg`, otherwise a drawer. Students also get a bottom bar on phones. Groups are ordered per role in `groupOrder` and can be collapsed; the group holding the current page can't be. Navigation only shows the way: every route and API still authorizes on its own.
- **Reader** (`courses/[courseId]/lessons/[lessonId]`): has no sidebar. A running head, a 44rem measure and a margin outline on wide screens.
- **Next.js:** with `cacheComponents` on, the previous route stays mounted but hidden in an `<Activity>`. Count visible elements only, as `e2e/consolidation.spec.ts` does with `filter({ visible: true })`.

## Before shipping a screen

- It works at 390, 820, 1280 and 1440px with no horizontal page scroll.
- Loading, empty and error states are all designed.
- Everything is reachable by keyboard with a visible focus ring.
- Controls name their action, and errors say what went wrong and how to fix it.
- Figures come from real records and say what they count.
