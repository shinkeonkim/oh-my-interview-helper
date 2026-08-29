# Oh My Interview Helper Design System

## 0. Research Log

- Existing UI audit: preserved the career-workbench IA, compact job context, global search, and future detail-tab pattern while replacing inaccessible shell markup.
- Official shadcn-vue docs: Vite + Tailwind v4 CSS variables, project-owned generated primitives, `SidebarProvider`, `Sheet`, and `CommandDialog`.
- Skipped external screens and image drafts: this is a local application shell, not a marketing composition or pixel clone.

## 1. Atmosphere & Identity

Korean-first career workbench: calm, compact, and evidence-oriented. Zinc surfaces keep long preparation sessions quiet; emerald marks the next useful action, active route, and healthy status. Pretendard-first typography and a thin emerald active rail preserve the product's practical, research-desk character without turning the shell into a dense admin topbar.

Shadcn-vue is the implementation source, not a remote runtime dependency. Generated files under `client/src/components/ui` are project-owned and may be adapted locally. Lucide icons are pinned in the client manifest and always paired with text or an accessible label.

## 2. Color

Semantic shadcn tokens are CSS variables in `client/src/style.css`; all component classes use those tokens rather than raw colors.

| Role           | Token                  | Light       | Dark        | Usage                       |
| -------------- | ---------------------- | ----------- | ----------- | --------------------------- |
| Canvas         | `--background`         | zinc-50     | zinc-950    | Reading canvas              |
| Surface        | `--card`               | white       | zinc-900    | Sidebar, route surfaces     |
| Elevated       | `--popover`            | white       | zinc-900    | Menus, command, dialogs     |
| Text           | `--foreground`         | zinc-950    | zinc-50     | Headings and body           |
| Secondary text | `--muted-foreground`   | zinc-600    | zinc-400    | Supporting copy             |
| Border         | `--border`             | zinc-200    | zinc-800    | Quiet separation            |
| Primary        | `--primary`            | emerald-700 | emerald-400 | Actions, active rail, focus |
| Primary text   | `--primary-foreground` | white       | zinc-950    | Text on emerald             |
| Success        | `--status-success`     | emerald-700 | emerald-400 | Ready and complete          |
| Warning        | `--status-warning`     | amber-700   | amber-400   | Attention                   |
| Error          | `--destructive`        | red-600     | red-400     | Recoverable errors          |

Emerald is interactive or semantic only. Surfaces use tonal shifts and subtle borders; shadows are reserved for overlays.

## 3. Typography

| Level      | Size                          | Weight | Line height | Usage               |
| ---------- | ----------------------------- | ------ | ----------- | ------------------- |
| Display    | `clamp(2rem, 5vw, 3.5rem)`    | 700    | 1.08        | Home statement      |
| H1         | `clamp(1.75rem, 4vw, 2.5rem)` | 700    | 1.15        | Route title         |
| H2         | `1.5rem`                      | 650    | 1.25        | Surface title       |
| Body       | `1rem`                        | 400    | 1.6         | Default reading     |
| Body small | `0.875rem`                    | 400    | 1.5         | Supporting copy     |
| Caption    | `0.75rem`                     | 600    | 1.4         | Metadata and labels |

Primary: `Pretendard`, `Apple SD Gothic Neo`, `Noto Sans KR`, system sans. Mono metadata: system ui-monospace. No remote font loading or tracking.

Headings use `text-wrap: balance`; Korean prose uses natural wrapping and `overflow-wrap: anywhere` at untrusted boundaries.

## 4. Spacing & Layout

All intent spacing derives from a 4px base: 4, 8, 12, 16, 20, 24, 32, 40, 48, and 64px. The desktop sidebar is 17rem; the content column is flexible and capped at 80rem. The shell uses `min-h-svh`, `min-w-0`, and one scroll owner for the main route.

Breakpoints: mobile below 768px uses a Sheet; desktop uses Sidebar. At 320px the primary content remains one readable column with no horizontal overflow. Toolbar controls collapse to icon-plus-tooltip affordances rather than wrapping into a second dense row.

## 5. Components

### App shell

- **Structure**: skip link, `SidebarProvider`, desktop `Sidebar`, `Sheet` mobile navigation, toolbar, `main`, Sonner region.
- **States**: active route, collapsed desktop rail, mobile open/closed, locale, system/light/dark, reduced motion.
- **Accessibility**: landmarks, `aria-current`, visible focus, Sheet focus trap/Escape/restore, skip link.
- **Layout**: sidebar shell; main route owns vertical scroll.

### Command search

- **Structure**: labelled toolbar Button and `CommandDialog` with grouped route commands and empty state.
- **States**: closed, open, filtered, empty.
- **Accessibility**: Ctrl/Cmd+K, Escape, focus restoration, keyboard item navigation.

### Surface primitives

- **Owned primitives**: Button, DropdownMenu, Tooltip, Card, Badge, Progress, Tabs, Input, Select, ScrollArea, Skeleton, Separator, Dialog, AlertDialog, Sonner.
- **States**: default, hover, active, focus-visible, disabled, loading, empty, error.
- **Rule**: compose these primitives before adding a new bespoke control.

### Future feature mappings

- `AppShell`: Sidebar + Sheet + CommandDialog + DropdownMenu + Tooltip.
- `HeaderSearch`: CommandDialog with local entity groups and honest empty/loading/error states.
- `JobIndicator`: Badge + Progress + Tooltip, linking to Job postings.
- `AgentProgress`: Progress + Skeleton + Alert, never fake completion.
- Job card/create dialog: Card + Badge + Dialog + Input + Select + AlertDialog for destructive confirmation.
- Detail header/tabs: Card header + Button + Tabs with emerald underline and route-backed active tab.
- Chat panel/query composer: ScrollArea + Card + Textarea/Input + Button, with mobile Sheet.
- Recommendations/application tracker: Card + Badge + Progress + Select, sourced only from real data.
- Document import: Dialog + Input + Alert + Skeleton, with explicit local parsing status.
- Setting section: Card + Label + Select + Separator + Sonner.

## 6. Motion & Interaction

Micro interactions use 150ms ease-out; Sheets and dialogs use the generated Reka UI motion. Only transform and opacity animate. `prefers-reduced-motion: reduce` disables non-essential motion and smooth scrolling. No decorative animation.

## 7. Depth & Surface

Depth strategy is tonal shift plus rules. Cards and sidebar use semantic background/border tokens. Popovers, dialogs, and Sheets may use the generated restrained shadow. No gradients, blobs, decorative metrics, or fake data.

## 8. Accessibility Constraints & Verification

- WCAG 2.2 AA target: 4.5:1 body contrast, 3:1 large text/controls, visible focus on every interactive element.
- Every route has a semantic heading, honest empty state, and keyboard-reachable navigation.
- Locale updates `<html lang>`; invalid preferences recover to Korean/system; system theme follows live `matchMedia` changes.
- CJK text must wrap safely at 320px; no horizontal overflow in the primary route canvas.

The earlier placeholder routes and route-only search have been replaced by persisted domain flows and local entity search. Playwright covers every route, keyboard navigation, focus restoration, mobile focus trapping, theme and locale persistence, and 320px overflow. Manual assistive-technology review remains part of release verification rather than an accepted product exception.
