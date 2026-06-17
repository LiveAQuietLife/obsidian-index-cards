# Index Cards

A research capture plugin for Obsidian. Index Cards gives you a dedicated workspace for jotting down ideas, reading notes, and sources while you work — organized into projects and categories, exportable to your vault when you're done.

> **Desktop only.** Index Cards is designed for Obsidian on Windows, macOS, and Linux. Mobile is not supported.

---

## How It's Different

Most "card" plugins in Obsidian are display tools — they take your existing vault notes and render them in a grid or gallery layout. Index Cards does something different: it's a **capture layer** that sits alongside your vault.

Cards are fast to create, easy to reorganize, and meant to be exported when you're done with a project — not accumulated indefinitely. The workflow mirrors the physical index cards researchers have used for decades: write it down quickly, keep it organized, move it into your permanent notes when it's ready.

If you're a researcher, student, or academic writer, **Academic Mode** adds citation fields, a citation parser that reads copied bibliography text from Zotero, Google Scholar, Logos, and other tools, and one-click bibliography generation in Chicago, SBL, MLA, APA, and Turabian styles. Academic Mode is off by default — if you don't need it, you'll never see it.

---

## Table of Contents

- [Installation](#installation)
- [Getting Started](#getting-started)
- [Projects](#projects)
- [Categories & Subcategories](#categories--subcategories)
- [Cards](#cards)
- [Navigating Your Cards](#navigating-your-cards)
- [Card Preview (Ctrl+Hover)](#card-preview-ctrlhover)
- [Search](#search)
- [Moving & Copying Cards](#moving--copying-cards)
- [Exporting Cards](#exporting-cards)
- [Recently Edited](#recently-edited)
- [Compare Cards](#compare-cards)
- [Academic Mode](#academic-mode)
- [Settings](#settings)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Data Storage](#data-storage)

---

## Installation

Search for **Index Cards** in Obsidian's community plugin browser (*Settings → Community plugins → Browse*), install, and enable it. The plugin adds an **Index Cards** icon to your left ribbon.

---

## Getting Started

Click the Index Cards ribbon icon to open the plugin. It always opens as a full-width tab.

On first launch you'll see the **Projects** dashboard — an empty workspace. Click **+ New Project** to create your first project, give it a name, and click into it. From there, create a category, and then start adding cards.

The typical flow is: **Project → Category → Cards**. You can also add subcategories under any category if you need a second level of organization.

---

## Projects

The Projects dashboard is your home screen. Each project appears as a tile showing its name and card count.

**Creating a project:** Click **+ New Project**, type a name, and press Enter.

**Opening a project:** Click the project tile.

**Renaming or deleting a project:** Right-click the project tile for options.

**Navigating back:** Use the breadcrumb at the top of the view, or press `Escape` to go up one level.

[![Project View](https://github.com/LiveAQuietLife/obsidian-index-cards/raw/main/screenshots/project_view.jpg)](https://github.com/LiveAQuietLife/obsidian-index-cards/raw/main/screenshots/project_view.jpg)

---

## Categories & Subcategories

Inside a project, **categories** are the primary containers for your cards. Think of them as the dividers in a physical index card box.

**Creating a category:** Click **+ New Category** inside a project.

**Subcategories:** Any category can hold one level of subcategories. Open a category, then click **+ New Subcategory**. Subcategories appear as a smaller card pile within the category view. The pile badge shows how many cards are inside.

**Renaming or deleting:** Right-click any category or subcategory for options. Deleting a category also deletes all cards inside it.

**Reordering:** Drag and drop categories to rearrange them within a project.

[![Categories](https://github.com/LiveAQuietLife/obsidian-index-cards/raw/main/screenshots/category_view.jpg)](https://github.com/LiveAQuietLife/obsidian-index-cards/raw/main/screenshots/category_view.jpg)

[![Subcategories](https://github.com/LiveAQuietLife/obsidian-index-cards/raw/main/screenshots/subcat_view.jpg)](https://github.com/LiveAQuietLife/obsidian-index-cards/raw/main/screenshots/subcat_view.jpg)

---

## Cards

Cards are the core unit. Each card has a **title**, a **note** field, an optional **color**, and optional **tags**.

### Creating a Card

Inside a category or subcategory, click **+ New Card**. The card editor opens as a floating modal.

### The Card Editor

The editor has two tabs:

- **📄 Note** — the main writing area, with a title field and a free-text note field.
- **📚 Source / Citation** — citation fields for Academic Mode (hidden unless Academic Mode is enabled in Settings).

**Toolbar (Note tab):** Bold (`B`), Italic (`I`), Strikethrough (`S`), and Inline Code (`` ` ``) buttons wrap selected text in the appropriate Markdown syntax. Select text first, then click a button.

**Tab order:** The title field tabs directly to the note textarea.

**Autosave:** Cards save automatically with a short debounce. There is no manual save button.

**Dragging the modal:** Click and drag the modal header to reposition it anywhere on screen.

### Card Colors

Each card can be assigned a color from a palette in the editor. Colored cards stand out visually in the category view — useful for flagging important cards or grouping by theme.

### Tags

Add comma-separated tags to a card from within the editor. Tags are internal to the plugin and won't appear in Obsidian's Tags pane while they live in Index Cards. When a card is exported, its tags are written to the exported file's frontmatter and Obsidian will recognize them normally from that point on.

### Editing an Existing Card

Click a card to open it in the editor. All fields are immediately editable.

### Duplicating a Card

Right-click a card and select **Duplicate**. The copy appears in the same category with "Copy of" prepended to the title.

### Deleting a Card

Right-click a card and select **Delete**, or use the delete button inside the card editor.

### Reordering Cards

Drag and drop cards within a category to rearrange them.

[![Cards](https://github.com/LiveAQuietLife/obsidian-index-cards/raw/main/screenshots/card_view.jpg)](https://github.com/LiveAQuietLife/obsidian-index-cards/raw/main/screenshots/card_view.jpg)

[![Edit Cards](https://github.com/LiveAQuietLife/obsidian-index-cards/raw/main/screenshots/edit_card_view.jpg)](https://github.com/LiveAQuietLife/obsidian-index-cards/raw/main/screenshots/edit_card_view.jpg)

---

## Navigating Your Cards

**Breadcrumb navigation:** A breadcrumb at the top of every view shows your current location (e.g. *Project → Category → Subcategory*). Click any segment to jump back to that level.

**Project jump dropdown:** A dropdown in the header lets you switch directly to any project without going back to the dashboard.

**Escape key:** Press `Escape` to go up one level in the hierarchy, or to close an open modal.

**Card size slider:** A slider in the category view adjusts card display height for the current session. This is a temporary per-session setting; your default card size is controlled in Settings.

---

## Card Preview (Ctrl+Hover)

Hold `Ctrl` and hover over any card to see a full preview of its title and note content without opening the editor. The preview popover appears near the card and stays open as long as you hold `Ctrl`. Release `Ctrl` to dismiss it.

This is useful for quickly scanning cards in a dense category without clicking into each one.

---

## Search

Press `F` or click the search icon to open the search modal. Search looks across all card titles and note content within the current project. Results update as you type. Click a result to open that card.

---

## Moving & Copying Cards

**Moving a card:** Right-click a card and select **Move**. A modal lists all available categories and subcategories across all projects. Non-clickable uppercase headers show category names; indented buttons beneath them are subcategories. Click a destination to move the card there.

Moving always clears the card's subcategory assignment, so the card lands cleanly in its new home regardless of where it came from.

**Duplicating to another location:** Duplicate the card first (right-click → Duplicate), then move the copy.

---

## Exporting Cards

Right-click a card and select **Export**, or use the export button in the toolbar to export multiple cards at once.

**Single card export:** Exports that card as a `.md` file directly to a location you choose.

**Bulk export:** A modal lets you select any combination of cards across categories using a scrollable checklist. Cards are grouped by category for easy scanning. Selected cards export as individual Markdown files.

Exported files include Obsidian-compatible frontmatter with all card fields (title, tags, color, note, and citation fields if Academic Mode is on).

[![Export Outline](https://github.com/LiveAQuietLife/obsidian-index-cards/blob/main/screenshots/export_outline_view.jpg)](https://github.com/LiveAQuietLife/obsidian-index-cards/blob/main/screenshots/export_outline_view.jpg)

---

## Recently Edited

Click the **Recently Edited** button (clock icon in the toolbar) to see a list of the most recently modified cards across all projects. Click any card in the list to open it directly.

---

## Compare Cards

Select **Compare** from the toolbar to open two cards side by side in a split view. Use the dropdowns in each pane to choose which cards to compare. Useful for checking for overlap, contradiction, or synthesis opportunities across your notes.

[![Compare Cards](https://github.com/LiveAQuietLife/obsidian-index-cards/raw/main/screenshots/compare_cards.jpg)](https://github.com/LiveAQuietLife/obsidian-index-cards/raw/main/screenshots/compare_cards.jpg)

---

## Academic Mode

Academic Mode is off by default. Enable it in **Settings → Index Cards → Academic Mode**.

When enabled, each card gains a **📚 Source / Citation** tab in the editor with fields for:

- Author
- Title
- Journal / Series
- Publisher, Place, Year
- Edition, Volume, Issue, Pages
- URL, Accessed (for web sources)

A short citation (author + year) appears in the card footer when source information is present.

### Citation Parser

Inside the Source tab, a paste box accepts citation text copied from any reference manager, browser extension, or bibliography. Copy a citation from Zotero (*Edit → Copy as → Bibliography Entry*), your library database, Google Scholar, Logos, or anywhere else — paste it in and click **Parse**. The plugin reads the text and fills in the author, title, journal/series, publisher, place, year, volume, issue, and pages fields automatically.

You can also fill in the citation fields manually without using the parser at all.

Supported citation formats for parsing:

- Chicago (Author-Date and Notes-Bibliography)
- SBL (Society of Biblical Literature)
- MLA
- APA
- Turabian

After parsing, review the filled fields and make any corrections before saving.

**Clear All:** Clears the paste area and all filled citation fields at once. Use this when you want to start fresh with a new source.

### Bibliography Generator

Click **Bibliography** in the toolbar (visible only in Academic Mode) to open the bibliography modal. Choose a citation style from the dropdown and click **Generate**. The plugin compiles citations from all cards in the current project that have source information filled in, formats them according to the chosen style, and displays the result as copyable text.

Supported output styles: Chicago, SBL, MLA, APA, Turabian.

---

## Settings

Open *Settings → Index Cards* to configure the plugin.

| Setting | Description |
| --- | --- |
| **Card size** | Choose a preset card display size, or configure a custom size. |
| **Editor window size** | Controls the width of the card editor modal. |
| **Split editor (write + preview)** | When enabled, the card editor shows a live Markdown preview pane alongside the note textarea. |
| **Show ruled lines on cards** | Displays horizontal lines on cards like a real index card. Turn off for a clean look. |
| **Timestamp format** | Controls how dates appear in exported card metadata. |
| **Academic mode** | Enables citation fields, citation parsing, and bibliography generation. Off by default. |
| **Export filename format** | Controls how spaces appear in exported filenames. |

[![Settings](https://github.com/LiveAQuietLife/obsidian-index-cards/raw/main/screenshots/settings_view.jpg)](https://github.com/LiveAQuietLife/obsidian-index-cards/raw/main/screenshots/settings_view.jpg)

---

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `F` | Open search |
| `Ctrl` + hover | Preview card content |
| `Escape` | Close modal / go up one level |
| `Tab` (in editor) | Move from title field to note field |
| `B` / `I` / `S` / `` ` `` (with text selected) | Bold / Italic / Strikethrough / Inline code via toolbar |

---

## Data Storage

All plugin data is stored in a single file at the root of your vault: `index-cards-data.json`. This file is created automatically on first use. It holds all your projects, categories, and cards while they're active.

Index Cards is designed as a **working space, not a permanent archive**. The intended workflow is: gather cards while you're working through a project, then export them to your vault as proper Markdown files when the project wraps up. Once exported, the cards live in your vault like any other note — searchable, linkable, taggable — and you can clear out the project in Index Cards. Back up `index-cards-data.json` along with your vault if your projects are long-running.

---

*Index Cards is a community plugin for Obsidian. Feedback and bug reports are welcome via the [GitHub repository](https://github.com/LiveAQuietLife/obsidian-index-cards).*
