---
name: PayBench Run Desk
description: A live stage-manager rundown for one paid checkout study.
colors:
  harbor: "oklch(0.45 0.086 230)"
  harbor-deep: "oklch(0.29 0.055 230)"
  harbor-ink: "oklch(0.23 0.038 230)"
  harbor-pale: "oklch(0.94 0.022 230)"
  brass: "oklch(0.74 0.14 78)"
  brass-pale: "oklch(0.95 0.045 78)"
  paper: "oklch(0.985 0.004 225)"
  worktop: "oklch(0.955 0.009 225)"
  line: "oklch(0.86 0.012 225)"
  muted: "oklch(0.52 0.024 230)"
  success: "oklch(0.53 0.11 152)"
  danger: "oklch(0.53 0.18 25)"
  danger-pale: "oklch(0.96 0.025 25)"
  white: "oklch(1 0 0)"
typography:
  display:
    fontFamily: "Recursive, Arial Narrow, Arial, sans-serif"
    fontSize: "31px"
    fontWeight: 790
    lineHeight: 1.1
    letterSpacing: "-0.025em"
    fontVariation: '"CASL" 0.28, "CRSV" 0, "MONO" 0'
  headline:
    fontFamily: "Recursive, Arial Narrow, Arial, sans-serif"
    fontSize: "23px"
    fontWeight: 720
    lineHeight: 1.15
    letterSpacing: "normal"
    fontVariation: '"CASL" 0.25, "CRSV" 0, "MONO" 0'
  title:
    fontFamily: "Recursive, Arial Narrow, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 770
    lineHeight: 1.45
    letterSpacing: "-0.015em"
  body-large:
    fontFamily: "Recursive, Arial Narrow, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  body:
    fontFamily: "Recursive, Arial Narrow, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
    fontVariation: '"CASL" 0.12, "CRSV" 0, "MONO" 0'
  label:
    fontFamily: "Recursive, Arial Narrow, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 720
    lineHeight: 1.45
    letterSpacing: "normal"
    fontVariation: '"CASL" 0, "CRSV" 0, "MONO" 1'
rounded:
  micro: "6px"
  inset: "8px"
  control: "9px"
  alert: "10px"
  row: "12px"
  surface: "14px"
  pill: "999px"
spacing:
  hair: "4px"
  tight: "8px"
  compact: "13px"
  module: "17px"
  grid: "18px"
  page: "32px"
  section: "34px"
components:
  button-primary:
    backgroundColor: "{colors.harbor}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 17px"
    height: "42px"
  button-primary-hover:
    backgroundColor: "{colors.harbor-deep}"
    textColor: "{colors.white}"
  button-secondary:
    backgroundColor: "{colors.harbor-pale}"
    textColor: "{colors.harbor}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 13px"
    height: "36px"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.harbor-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  chip:
    backgroundColor: "{colors.harbor-pale}"
    textColor: "{colors.harbor}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 8px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.harbor-ink}"
    rounded: "{rounded.surface}"
    padding: "17px"
  run-row-selected:
    backgroundColor: "{colors.brass-pale}"
    textColor: "{colors.harbor-ink}"
    rounded: "{rounded.row}"
    padding: "13px 12px"
  alert:
    backgroundColor: "{colors.danger-pale}"
    textColor: "{colors.danger}"
    rounded: "{rounded.alert}"
    padding: "11px 13px"
---

# Design System: PayBench Run Desk

## Overview

**Creative North Star: "The Live Rundown"**

PayBench reads like a stage manager's cue sheet for one paid study. The selected run leads, its eight cues stay ordered, and the next action is impossible to miss. The interface is operational, compact, and calm under time pressure.

The world combines a bright work surface with deep harbor blue and rare brass live cues. Ruled modules, asymmetric columns, and live monitor frames replace generic metric-card grids. Copy stays short; status, position, time, actor, and artifact carry the meaning.

**Key Characteristics:**

- One selected run is the unit of attention.
- Ordered cues lead before evidence and history.
- Brass marks work in motion; green confirms completion; red marks failure.
- Recursive variable type shifts from casual display weight to mono-like operational data.
- Desktop uses a fixed run rail; mobile turns it into a dismissible drawer.
- Labels are terse and controls rely on familiar form.

## Colors

The palette feels maritime and workmanlike: cool paper, harbor blues, and a single brass cue light.

### Primary

- **Harbor Blue:** Owns primary controls, links, progress, and actor emphasis.
- **Deep Harbor:** Anchors the run rail, monitor wells, and strongest headings.
- **Harbor Ink:** Carries default text without using absolute black.
- **Harbor Wash:** Marks current rows, quiet controls, chips, and selected context.

### Secondary

- **Live Brass:** Signals work in motion, variant B, Replay, and the active cue.
- **Brass Wash:** Supports selected runs and compact live annotations without flooding the page.

### Tertiary

- **Completion Green:** Confirms completed cues, paid state, and healthy events.
- **Failure Red:** Marks blockers and failures in both glyph and text.
- **Failure Wash:** Gives blocked rows and error notices a quiet but unmistakable field.

### Neutral

- **Paper:** The main module and panel surface.
- **Worktop:** The cool page canvas behind modules.
- **Rule Line:** Divides cue rows, artifacts, and event entries.
- **Muted Slate:** Carries timestamps, counts, paths, and secondary labels.
- **White:** Reserved for contrast on strong fills and the cleanest inset surfaces.

### Named Rules

**The Cue-Light Rule.** Brass marks active or changing state; it never becomes general decoration.

**The Three-State Rule.** Every status pairs color with readable text or a recognizable glyph: green is complete, brass is active, and red is blocked or failed.

## Typography

**Display Font:** Recursive (with Arial Narrow, Arial, sans-serif fallback)

**Body Font:** Recursive (with Arial Narrow, Arial, sans-serif fallback)

**Label/Mono Font:** Recursive with its MONO axis enabled

**Character:** One variable family carries the entire desk. A modest CASL axis gives headlines a human cue-sheet character, while the MONO axis makes times, paths, IDs, and codes precise.

### Hierarchy

- **Display** (790, 31px, 1.1): Founder names and the strongest page identity.
- **Headline** (720, 23px, 1.15): The current action and access-gate heading.
- **Title** (770, 17px, 1.45): Module headings and compact panel titles.
- **Body Large** (400, 15px, 1.45): Brand and stronger supporting copy.
- **Body** (400, 13px, 1.45): Default interface text and cue labels.
- **Label** (720, 11px, 1.45): Status, metadata, times, actor chips, and paths.

### Named Rules

**The Fixed-Scale Rule.** Use only the implemented 11, 13, 15, 17, 23, and 31px sizes; hierarchy comes from weight, variation axes, and placement.

**The Operational Mono Rule.** Enable the MONO axis only for IDs, codes, timestamps, file paths, and compact machine data.

## Layout

Desktop holds a fixed 64px top bar and a 272px run rail. The workspace begins after the rail, uses 32px page padding, and caps all working modules at 1480px. The first grid favors the rundown at a 2.15:0.85 ratio; sandbox monitors use a 0.92:1.08 split; study and Replay evidence use 0.8:1.2. Recurring module gaps are 18px and major vertical sections are separated by 34px.

At 1080px the rundown and action board stack. At 840px the run rail becomes an off-canvas drawer, the workspace takes the full width, and both sandbox and evidence grids become single columns. At 620px horizontal padding becomes 13px, utility copy disappears, cue times collapse, and list grids simplify. At 390px the payment stamp and narrow statistical layouts stack again. The minimum supported viewport is 320px.

**The One-Run Rule.** Navigation selects a founder; every module in the workspace belongs to that one run.

**The Cue-First Rule.** Rundown and next action precede sandboxes, study evidence, artifacts, and the event ledger at every width.

## Elevation & Depth

Depth is hybrid and purposeful. Most modules stay flat with a one-pixel rule; live work surfaces receive a soft ambient shadow, while the selected run, action board, and access gate use a crisp offset shadow that feels pinned to a physical workbench.

### Shadow Vocabulary

- **Live Glow** (`2px 2px 8px color-mix(in oklch, var(--brass) 45%, transparent)`): Marks a changing status dot.
- **Active Cue Glow** (`2px 3px 9px color-mix(in oklch, var(--brass) 38%, transparent)`): Lifts the current cue glyph.
- **Selected Run Offset** (`3px 4px 0 var(--brass)`): Pins the chosen run in the dark rail.
- **Action Offset** (`5px 7px 0 color-mix(in oklch, var(--harbor) 32%, var(--line))`): Gives the next-action module visual authority.
- **Monitor Ambient** (`0 9px 26px color-mix(in oklch, var(--harbor-deep) 13%, transparent)`): Separates live sandbox monitors from the worktop.
- **Gate Offset** (`7px 9px 0 color-mix(in oklch, var(--harbor) 25%, var(--line))`): Grounds the operator access form.

### Named Rules

**The Evidence-Stays-Flat Rule.** Rundown, artifacts, ledger, study, and Replay use tonal layering or rules; shadow is reserved for selection, action, monitoring, and access.

## Shapes

Surfaces use gently curved 14px corners. Rows and payment stamps tighten to 12px; controls use 9px; monitor frames use 8px; file marks use 6px. Pills and status bars use a full 999px radius, while cue and status marks are circular. One-pixel rules keep long operational lists legible.

**The Nested-Corner Rule.** Outer modules have the largest radius; embedded controls and marks step down so nested layers remain clear.

## Components

### Buttons

- **Shape:** Compact control corners (9px) with a minimum 36px or 42px height.
- **Primary:** White on Harbor Blue with 17px horizontal padding; hover deepens to Deep Harbor.
- **Hover / Focus:** Color changes are immediate and the shared focus treatment is a 3px brass outline with a 3px offset.
- **Secondary:** Harbor Blue on Harbor Wash with 13px horizontal padding.
- **Icon:** A transparent 36px square that gains Harbor Wash on hover.

### Chips

- **Style:** Small, bold pills use Harbor Wash and Harbor Blue; live-source chips may use Brass Wash.
- **State:** Actor, source, variant, and action chips stay terse. Color and text always appear together.

### Cards / Containers

- **Corner Style:** Main surfaces use the 14px surface radius; ruled list containers add a one-pixel Rule Line border.
- **Background:** Paper on the Worktop canvas. Monitor wells switch to Deep Harbor.
- **Shadow Strategy:** Flat by default; use only the named shadows for selected, actionable, monitored, or gated surfaces.
- **Internal Padding:** Module headers and bodies commonly use 17px.

### Inputs / Fields

- **Style:** White field, one-pixel Rule Line border, 9px corners, 44px height, and 12px horizontal padding.
- **Focus:** The border changes to Harbor Blue while the global brass focus outline stays visible.
- **Error / Disabled:** Error copy uses Failure Red. Disabled controls remain present at reduced opacity and show a wait cursor.

### Navigation

The 64px top bar holds brand, desk name, connection, and refresh. A 272px Deep Harbor rail lists runs; the selected row flips to Brass Wash with a brass offset. Below 840px the rail becomes a drawer with a scrim and Escape dismissal.

### Rundown Cue

Each cue is one ruled row: index, state glyph, label, actor chip, and time. The current cue receives Harbor Wash; complete, active, and blocked states change both the glyph and row treatment.

### Sandbox Monitor

Each Superserve monitor has a terse header, variant token, live state, Deep Harbor viewing well, and compact footer. Variant A uses Harbor Blue; variant B uses Live Brass.

### Study and Replay Evidence

The two evidence modules use flat Paper surfaces and a four-pixel top rule. Terac is Harbor Blue; Replay is Live Brass. Progress is shown with native bars and short numeric status, never explanatory paragraphs.

## Do's and Don'ts

### Do:

- **Do** lead every workspace with the selected run, eight-cue rundown, and current action.
- **Do** preserve the fixed 11, 13, 15, 17, 23, and 31px type scale.
- **Do** keep copy short enough to scan while the run is moving.
- **Do** pair every status color with text or a glyph.
- **Do** show live work as a monitor, progress bar, timestamp, artifact, or ledger event.
- **Do** keep the 14px surface radius and tighter nested radii.

### Don't:

- **Don't** turn the desk into a generic grid of summary cards.
- **Don't** use brass as a broad brand fill; reserve it for live cues and variant B.
- **Don't** add descriptions under self-explanatory navigation, buttons, or module titles.
- **Don't** expose secrets, participant codes, phone numbers, payment data, or survey free text.
- **Don't** claim statistical significance or proven revenue lift from the small study.
- **Don't** show founder or Terac interfaces in this internal operator system.
