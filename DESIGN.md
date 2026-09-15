# X Article Bridge Design System

## 0. Research Log (greenfield only)

- Embedded refs: shortlisted neutral operational tooling, Linear-style, and Notion-style; picked the neutral operational lane because the extension is a focused transfer tool rather than a marketing surface.
- Lazyweb: skipped; no external product screen is needed for this compact browser utility.
- Imagen drafts: skipped; a utility panel has no focal visual asset.

## 1. Atmosphere & Identity

Quiet transfer utility: compact, legible, and trustworthy while an article is being moved into X. The signature is a thin amber progress rail that makes the import pipeline visible without taking over the editor.

## 2. Color

### Palette

| Role | Token | Value | Usage |
|------|-------|-------|-------|
| Surface/primary | `--surface-primary` | `#111318` | Panel background |
| Surface/secondary | `--surface-secondary` | `#1A1D24` | Drop zone and cards |
| Surface/elevated | `--surface-elevated` | `#232733` | Hover and focused surfaces |
| Text/primary | `--text-primary` | `#F5F7FA` | Main copy |
| Text/secondary | `--text-secondary` | `#A7AFBE` | Helper copy |
| Text/tertiary | `--text-tertiary` | `#737C8C` | Metadata |
| Border/default | `--border-default` | `#343A48` | Panel edges |
| Border/subtle | `--border-subtle` | `#272C36` | Internal separators |
| Accent/primary | `--accent-primary` | `#F4B740` | Progress and primary action |
| Accent/hover | `--accent-hover` | `#FFD166` | Hover and focus |
| Status/success | `--status-success` | `#4CC38A` | Completed import |
| Status/warning | `--status-warning` | `#F4B740` | Missing assets |
| Status/error | `--status-error` | `#FF6B6B` | Import failure |

### Rules

- Surfaces use tonal shifts; no decorative gradients.
- Amber is reserved for progress, focus, and the primary action.
- Every new color must be added here before it appears in CSS.

## 3. Typography

| Level | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| H1 | 20px | 700 | 1.25 | Panel title |
| H2 | 14px | 700 | 1.4 | Section title |
| Body | 14px | 400 | 1.5 | Instructions and status |
| Caption | 12px | 500 | 1.4 | Metadata and badges |
| Mono | 12px | 500 | 1.4 | File names and tag names |

Font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; mono: `ui-monospace, SFMono-Regular, Menlo, monospace`.

## 4. Spacing & Layout

Base unit: 4px.

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 4px | Icon and label gap |
| `--space-2` | 8px | Compact groups |
| `--space-3` | 12px | Text blocks |
| `--space-4` | 16px | Card padding |
| `--space-5` | 20px | Panel sections |
| `--space-6` | 24px | Panel edge padding |

The side panel is a single-column shell with a maximum readable width of 360px. The in-page status rail is fixed to the top-right of the article editor and never changes document flow.

## 5. Components

### Side Panel Shell

- **Structure**: header, drop hint, supported-format list, status footer.
- **Variants**: idle, processing, success, warning, error.
- **States**: default, focus, loading, complete, partial, error.
- **Accessibility**: semantic headings, labelled status region, keyboard focus visible.
- **Motion**: 150ms opacity/transform for status changes; disabled under reduced motion.

### Import Status Rail

- **Structure**: label, progress bar, short status line.
- **Variants**: idle, parsing, uploading, done, warning, error.
- **States**: default, active, complete, failed.
- **Accessibility**: `role="status"`, progress text is not color-only.
- **Motion**: progress width only changes while importing; no decorative loops.

### Drop Hint

- **Structure**: dashed target with file type and action copy.
- **Variants**: neutral, drag-over, rejected.
- **States**: default, hover, drag-over, rejected.
- **Accessibility**: visible keyboard focus and text alternative for file types.

## 6. Motion & Interaction

- Micro interactions use 120ms ease-out.
- Panel state transitions use 200ms ease-in-out.
- Only opacity and transform animate.
- `prefers-reduced-motion: reduce` removes transitions.

## 7. Depth & Surface

Strategy: tonal-shift. The panel uses three dark surface levels and a single internal separator. No shadows are needed for the compact utility surface.

## 8. Accessibility Constraints & Accepted Debt

- WCAG 2.2 AA target; body text is at least 14px, visible focus is required, and status messages are text-readable without color.
- Accepted debt: X editor DOM selectors are an external integration boundary and may change; the adapter will show a concrete error and preserve the source file when it cannot find the editor or media input.
