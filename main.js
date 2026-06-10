/*
 * Index Cards — Obsidian Plugin  v1.2
 * Phase 1 — Stable build
 *
 * Features:
 *  - Projects (separate workspaces)
 *  - Categories + one level of Subcategories
 *  - Cards (title, note, color, tags)
 *  - Autosave (2s debounce)
 *  - Drag-and-drop reordering (projects, categories, cards)
 *  - Search within project
 *  - Recently Edited (across all projects)
 *  - Compare two cards side-by-side
 *  - Move card to category or project
 *  - Duplicate card
 *  - Export cards as individual .md files
 *  - Quick-nav breadcrumb + project jump dropdown
 *  - Keyboard shortcuts
 *  - Settings: card size, editor size, split editor, filename format
 *
 * Deliberately excluded (Phase 2 — Academic Mode):
 *  - Citation fields (author, title, publisher, year, page)
 *  - Zotero integration
 *  - Bibliography generator
 *  - Outline export
 *  - Footnote support
 */

const {
  Plugin, ItemView, Modal, Notice,
  FuzzySuggestModal, PluginSettingTab, Setting, MarkdownRenderer,
  normalizePath
} = require('obsidian');

const VIEW_TYPE  = 'index-cards-main';
const DATA_FILE  = 'index-cards-data.json';

// ─────────────────────────────────────────────
//  Card size presets
// ─────────────────────────────────────────────
const CARD_SIZES = {
  '3x5'   : { label: '3×5 (standard)',    w: 220, h: 160 },
  '4x6'   : { label: '4×6 (large)',       w: 280, h: 200 },
  '5x8'   : { label: '5×8 (extra large)', w: 340, h: 240 },
  'custom': { label: 'Custom (set below)', w: 260, h: 190 },
};

const FILENAME_FORMATS = {
  'spaces'     : { label: 'Spaces  (my card title)' },
  'dashes'     : { label: 'Dashes  (my-card-title)' },
  'underscores': { label: 'Underscores  (my_card_title)' },
};

// ─────────────────────────────────────────────
//  Card colors
// ─────────────────────────────────────────────
const CARD_COLORS = {
  'default': { label: 'Default', bg: 'var(--background-secondary)',   border: 'var(--background-modifier-border)' },
  'blue'   : { label: 'Blue',    bg: 'rgba(59,130,246,0.12)',         border: 'rgba(59,130,246,0.5)' },
  'green'  : { label: 'Green',   bg: 'rgba(34,197,94,0.12)',          border: 'rgba(34,197,94,0.5)' },
  'yellow' : { label: 'Yellow',  bg: 'rgba(234,179,8,0.12)',          border: 'rgba(234,179,8,0.5)' },
  'red'    : { label: 'Red',     bg: 'rgba(239,68,68,0.12)',          border: 'rgba(239,68,68,0.5)' },
  'purple' : { label: 'Purple',  bg: 'rgba(168,85,247,0.12)',         border: 'rgba(168,85,247,0.5)' },
  'orange' : { label: 'Orange',  bg: 'rgba(249,115,22,0.12)',         border: 'rgba(249,115,22,0.5)' },
};

// ─────────────────────────────────────────────
//  Default settings
// ─────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  cardSize      : '3x5',
  customCardW   : 260,
  customCardH   : 190,
  filenameFormat: 'spaces',
  editorSize    : 'medium',
  splitEditor   : false,
  ruledLines    : true,
  timestampFormat: 'local',
  academicMode  : false,
};

// ═════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════
function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function emptyCard(categoryId = null) {
  return {
    id: makeId(),
    categoryId,
    subcategoryId: null,
    cardTitle: '',
    front: '',
    color: 'default',
    tags: [],
    author: '',
    title: '',
    sourceTitle: '',
    publisher: '',
    place: '',
    year: '',
    edition: '',
    volume: '',
    issue: '',
    pages: '',
    url: '',
    accessed: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function emptyCategory(name) {
  return { id: makeId(), name, parentId: null };
}

function emptyProject(name) {
  return { id: makeId(), name, createdAt: Date.now() };
}

function slugify(text, format) {
  const clean = text.replace(/[\\/:*?"<>|#^[\]]/g, '').trim();
  if (format === 'underscores') return clean.replace(/\s+/g, '_');
  if (format === 'dashes')      return clean.replace(/\s+/g, '-');
  return clean;
}

function formatTimestamp(ts, format) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (format === 'iso') return d.toISOString();
  if (format === 'local-date') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  // default: local date + time
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  // If today, show time; if this year, show date+time; otherwise show date only
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return 'Today · ' + time;
  return date + ' · ' + time;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Focus the first input/textarea inside a container, retrying via rAF
// until it's in the DOM and enabled (up to ~500 ms).
function focusWhenReady(selector, root, maxTries = 60) {
  let tries = 0;
  const attempt = () => {
    const el = root ? root.querySelector(selector) : document.querySelector(selector);
    if (el && document.contains(el) && !el.disabled) {
      el.focus();
      // Re-attempt after a short delay in case Obsidian steals focus back
      setTimeout(() => {
        if (document.activeElement !== el) el.focus();
      }, 80);
    } else if (tries++ < maxTries) {
      requestAnimationFrame(attempt);
    }
  };
  requestAnimationFrame(attempt);
}

// Right-click context menu
function showContextMenu(e, items) {
  document.querySelectorAll('.ic-context-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'ic-context-menu';

  for (const item of items) {
    if (item.type === 'separator') {
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'ic-context-menu-separator' }));
    } else if (item.type === 'label') {
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'ic-context-menu-label', textContent: item.text }));
    } else {
      const el = document.createElement('div');
      el.className = 'ic-context-menu-item' + (item.danger ? ' danger' : '');
      el.textContent = item.text;
      el.onclick = () => { menu.remove(); item.action(); };
      menu.appendChild(el);
    }
  }

  document.body.appendChild(menu);

  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = menu.offsetWidth,  mh = menu.offsetHeight;
  let x = e.clientX, y = e.clientY;
  if (x + mw > vw - 8) x = vw - mw - 8;
  if (y + mh > vh - 8) y = vh - mh - 8;
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';

  const dismiss = (ev) => {
    if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', dismiss); }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

// ═════════════════════════════════════════════
//  PERSISTENCE
// ═════════════════════════════════════════════
async function loadData(plugin) {
  const path = normalizePath(plugin.app.vault.configDir + '/' + DATA_FILE);
  try {
    const raw = JSON.parse(await plugin.app.vault.adapter.read(path));
    if (!raw.projects) raw.projects = [];
    // Normalise cards — ensure all expected fields exist
    raw.cards = (raw.cards || []).map(c => ({
      tags: [], color: 'default', subcategoryId: null,
      updatedAt: c.createdAt || Date.now(),
      ...c,
    }));
    // Normalise categories
    raw.categories = (raw.categories || []).map(c => ({ parentId: null, ...c }));
    return raw;
  } catch {
    return { projects: [], categories: [], cards: [] };
  }
}

async function saveData(plugin, data) {
  const path = normalizePath(plugin.app.vault.configDir + '/' + DATA_FILE);
  await plugin.app.vault.adapter.write(path, JSON.stringify(data, null, 2));
}

function getAllFolders(app) {
  const folders = ['/'];
  const recurse = f => {
    for (const c of f.children || []) {
      if (c.children !== undefined) { folders.push(c.path); recurse(c); }
    }
  };
  recurse(app.vault.getRoot());
  return folders.sort();
}

// Collect all unique tags used in a project
function projectTags(data, projectId) {
  const set = new Set();
  data.cards
    .filter(c => c.projectId === projectId)
    .forEach(c => (c.tags || []).forEach(t => set.add(t)));
  return [...set].sort();
}

// ═════════════════════════════════════════════
//  FOLDER PICKER
// ═════════════════════════════════════════════
class FolderPickerModal extends FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder('Type to search folders…');
  }
  getItems()        { return getAllFolders(this.app); }
  getItemText(i)    { return i; }
  onChooseItem(i)   { this.onChoose(i === '/' ? '' : i); }
}

// ═════════════════════════════════════════════
//  SETTINGS TAB
// ═════════════════════════════════════════════
class IndexCardsSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Index Cards — Settings' });

    // ── Card size ──
    new Setting(containerEl)
      .setName('Card size')
      .setDesc('Choose a preset or configure a custom size below.')
      .addDropdown(d => {
        for (const [k, v] of Object.entries(CARD_SIZES)) d.addOption(k, v.label);
        d.setValue(this.plugin.settings.cardSize);
        d.onChange(async v => {
          this.plugin.settings.cardSize = v;
          await this.plugin.saveSettings();
          this.display(); // refresh to show/hide custom fields
        });
      });

    if (this.plugin.settings.cardSize === 'custom') {
      new Setting(containerEl)
        .setName('Custom card width (px)')
        .addText(t => {
          t.setValue(String(this.plugin.settings.customCardW || 260));
          t.onChange(async v => {
            const n = parseInt(v);
            if (n > 80 && n < 800) { this.plugin.settings.customCardW = n; await this.plugin.saveSettings(); }
          });
        });
      new Setting(containerEl)
        .setName('Custom card height (px)')
        .addText(t => {
          t.setValue(String(this.plugin.settings.customCardH || 190));
          t.onChange(async v => {
            const n = parseInt(v);
            if (n > 60 && n < 600) { this.plugin.settings.customCardH = n; await this.plugin.saveSettings(); }
          });
        });
    }

    // ── Editor size ──
    new Setting(containerEl)
      .setName('Editor window size')
      .setDesc('Width of the card editor modal.')
      .addDropdown(d => {
        d.addOption('small',  'Small  (580px)');
        d.addOption('medium', 'Medium (760px)');
        d.addOption('large',  'Large  (1020px)');
        d.setValue(this.plugin.settings.editorSize || 'medium');
        d.onChange(async v => { this.plugin.settings.editorSize = v; await this.plugin.saveSettings(); });
      });

    // ── Split editor ──
    new Setting(containerEl)
      .setName('Split editor (write + preview)')
      .setDesc('Show a live Markdown preview alongside the note field. Useful if you write heavily formatted notes.')
      .addToggle(t => {
        t.setValue(this.plugin.settings.splitEditor || false);
        t.onChange(async v => { this.plugin.settings.splitEditor = v; await this.plugin.saveSettings(); });
      });

    // ── Ruled lines ──
    new Setting(containerEl)
      .setName('Show ruled lines on cards')
      .setDesc('Display horizontal lines on cards like a real index card. Turn off for a clean look.')
      .addToggle(t => {
        t.setValue(this.plugin.settings.ruledLines !== false);
        t.onChange(async v => { this.plugin.settings.ruledLines = v; await this.plugin.saveSettings(); });
      });

    // ── Timestamp format ──
    new Setting(containerEl)
      .setName('Timestamp format')
      .setDesc('How dates appear in exported card metadata.')
      .addDropdown(d => {
        d.addOption('local',      'Local date & time  (Jun 3 · 5:47 PM)');
        d.addOption('local-date', 'Local date only  (Jun 3, 2026)');
        d.addOption('iso',        'ISO / UTC  (2026-06-03T22:47:25.742Z)');
        d.setValue(this.plugin.settings.timestampFormat || 'local');
        d.onChange(async v => { this.plugin.settings.timestampFormat = v; await this.plugin.saveSettings(); });
      });

    // ── Academic mode ──
    new Setting(containerEl)
      .setName('Academic mode')
      .setDesc('Show citation fields (Source / Citation panel) on every card editor.')
      .addToggle(t => {
        t.setValue(this.plugin.settings.academicMode || false);
        t.onChange(async v => { this.plugin.settings.academicMode = v; await this.plugin.saveSettings(); });
      });

    // ── Filename format ──
    new Setting(containerEl)
      .setName('Export filename format')
      .setDesc('How spaces appear in exported filenames.')
      .addDropdown(d => {
        for (const [k, v] of Object.entries(FILENAME_FORMATS)) d.addOption(k, v.label);
        d.setValue(this.plugin.settings.filenameFormat);
        d.onChange(async v => { this.plugin.settings.filenameFormat = v; await this.plugin.saveSettings(); });
      });
  }
}

// ═════════════════════════════════════════════
//  MAIN VIEW
// ═════════════════════════════════════════════
class IndexCardsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.screen          = 'projects';
    this.activeProjectId = null;
    this.activeProjectName = '';
    this.activeCatId     = null;
    this.activeCatName   = '';
    this.activeSubcatId  = null;
    this.activeSubcatName = '';
  }

  getViewType()    { return VIEW_TYPE; }
  getDisplayText() { return 'Index Cards'; }
  getIcon()        { return 'library'; }

  async onOpen()  { await this.renderProjects(); }
  async onClose() {}

  cardSize() {
    if (this._runtimeSize) return this._runtimeSize;
    const s = this.plugin.settings;
    if (s.cardSize === 'custom') return { w: s.customCardW || 260, h: s.customCardH || 190 };
    return CARD_SIZES[s.cardSize] || CARD_SIZES['3x5'];
  }

  // ── Navigation helpers ──
  async goProjects()              { this._runtimeSize = null; this.screen = 'projects'; await this.renderProjects(); }
  async goCanvas()                { this._runtimeSize = null; this.screen = 'canvas';   await this.renderCanvas(); }
  async openCanvas(pid, pname)    { this._runtimeSize = null; this.screen = 'canvas';   this.activeProjectId = pid; this.activeProjectName = pname; await this.renderCanvas(); }
  async openPile(cid, cname)      { this._runtimeSize = null; this.screen = 'pile';     this.activeCatId = cid;     this.activeCatName = cname;     await this.renderPile(); }

  // ── Quick-nav breadcrumb + project jump ──
  buildQuickNav(root, data) {
    const bar = root.createDiv('ic-quicknav');
    const bc  = bar.createDiv('ic-quicknav-breadcrumb');

    const crumb = (text, action) => {
      const s = bc.createSpan({ cls: 'ic-quicknav-crumb', text });
      if (action) s.onclick = action;
      else s.addClass('ic-quicknav-crumb-current');
    };
    const sep = () => bc.createSpan({ cls: 'ic-quicknav-sep', text: ' › ' });

    if (this.screen === 'projects') {
      crumb('All Projects');
    } else if (this.screen === 'canvas') {
      crumb('All Projects', () => this.goProjects());
      sep(); crumb(this.activeProjectName);
    } else if (this.screen === 'pile') {
      crumb('All Projects', () => this.goProjects());
      sep(); crumb(this.activeProjectName, () => this.goCanvas());
      sep(); crumb(this.activeCatName);
    } else if (this.screen === 'subcat') {
      crumb('All Projects', () => this.goProjects());
      sep(); crumb(this.activeProjectName, () => this.goCanvas());
      sep(); crumb(this.activeCatName, () => this.openPile(this.activeCatId, this.activeCatName));
      sep(); crumb(this.activeSubcatName);
    }

    // Project jump dropdown — only when more than one project exists
    if (this.screen !== 'projects' && data.projects.length > 1) {
      const jump = bar.createEl('select', { cls: 'ic-quicknav-jump' });
      jump.createEl('option', { text: '⇢ Jump to project…', value: '' });
      for (const p of data.projects) {
        const opt = jump.createEl('option', { text: p.name, value: p.id });
        if (p.id === this.activeProjectId) opt.selected = true;
      }
      jump.onchange = () => {
        const p = data.projects.find(p => p.id === jump.value);
        if (p) this.openCanvas(p.id, p.name);
      };
    }

    // Recently Edited — styled as pill button
    bar.createEl('button', { text: '🕒 Recent', cls: 'ic-quicknav-recent' })
      .onclick = () => new RecentlyEditedModal(this.plugin, data, card => this.openCardFromSearch(card, data)).open();
  }

  // ── Keyboard shortcut attachment ──
  attachShortcuts(root, handlers) {
    if (root._shortcutFn) {
      document.removeEventListener('keydown', root._shortcutFn);
      root._shortcutFn = null;
    }
    let busy = false;
    const fn = e => {
      if (!root.isConnected) return;
      if (!document.contains(root)) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      const activeLeaf = this.plugin.app.workspace.activeLeaf;
      if (activeLeaf && !activeLeaf.view.containerEl.contains(root)) return;
      if (!handlers[e.key]) return;
      e.preventDefault();
      e.stopPropagation();
      if (busy) return;
      busy = true;
      handlers[e.key]();
      setTimeout(() => { busy = false; }, 400);
    };
    document.addEventListener('keydown', fn);
    root._shortcutFn = fn;
  }

  // ══════════════════════════════════════════
  //  PROJECTS SCREEN — Dashboard
  // ══════════════════════════════════════════
  async renderProjects() {
    const data = await loadData(this.plugin);
    const root = this.containerEl.children[1] ?? this.containerEl;
    root.empty();
    root.className = 'ic-view ic-dashboard';
    root.setAttribute('tabindex', '0');

    // ── Header ──
    const header = root.createDiv('ic-dashboard-header');
    const titleEl = header.createEl('h1', { cls: 'ic-dashboard-title' });
    titleEl.innerHTML = 'Index <span>Cards</span>';

    const headerRight = header.createDiv({ attr: { style: 'display:flex;align-items:center;gap:8px;' } });
    headerRight.createEl('button', { text: '🕒 Recent', cls: 'ic-quicknav-recent' })
      .onclick = () => new RecentlyEditedModal(this.plugin, data, card => this.openCardFromSearch(card, data)).open();
    headerRight.createEl('button', { text: '+ New Project', cls: 'ic-btn primary' })
      .onclick = () => new NewProjectModal(this.plugin, data, () => this.renderProjects()).open();

    // ── Stats row ──
    const totalCards = data.cards.length;
    const totalCats  = data.categories.filter(c => !c.parentId).length;
    const lastEdited = data.cards.length
      ? new Date(Math.max(...data.cards.map(c => c.updatedAt || 0)))
          .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '—';

    const stats = root.createDiv('ic-dashboard-stats');
    const addStat = (value, label) => {
      const s = stats.createDiv('ic-stat');
      s.createDiv({ cls: 'ic-stat-value', text: String(value) });
      s.createDiv({ cls: 'ic-stat-label', text: label });
    };
    addStat(data.projects.length, data.projects.length === 1 ? 'Project' : 'Projects');
    stats.createDiv('ic-stat-divider');
    addStat(totalCats, totalCats === 1 ? 'Category' : 'Categories');
    stats.createDiv('ic-stat-divider');
    addStat(totalCards, totalCards === 1 ? 'Card' : 'Cards');
    stats.createDiv('ic-stat-divider');
    addStat(lastEdited, 'Last Edited');

    // ── Empty state ──
    if (!data.projects.length) {
      const empty = root.createDiv('ic-dashboard-empty');
      empty.createDiv({ cls: 'ic-dashboard-empty-icon', text: '🗂️' });
      const h = empty.createEl('h3', { text: 'No projects yet' });
      empty.createEl('p', { text: 'Each project is a separate workspace with its own categories and cards. Create one to get started.' });
      empty.createEl('button', { text: '+ Create your first project', cls: 'ic-btn primary' })
        .onclick = () => new NewProjectModal(this.plugin, data, () => this.renderProjects()).open();
      return;
    }

    // ── Project grid ──
    const grid = root.createDiv('ic-project-grid');

    for (const p of data.projects) {
      const catCount  = data.categories.filter(c => c.projectId === p.id && !c.parentId).length;
      const cardCount = data.cards.filter(c => c.projectId === p.id).length;
      const projCards = data.cards.filter(c => c.projectId === p.id);
      const lastUp    = projCards.length
        ? Math.max(...projCards.map(c => c.updatedAt || c.createdAt || 0))
        : p.createdAt || 0;
      const updatedStr = lastUp
        ? formatTimestamp(lastUp, this.plugin.settings.timestampFormat || 'local')
        : '—';

      this.renderProjectCard(grid, p, catCount, cardCount, updatedStr, data);
    }
  }

  renderProjectCard(grid, project, catCount, cardCount, updatedStr, data) {
    const card = grid.createDiv('ic-project-card');
    card.setAttribute('draggable', 'true');

    card.ondragstart = e => {
      e.dataTransfer.setData('project-drag', project.id);
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => card.style.opacity = '0.4', 0);
    };
    card.ondragend  = () => { card.style.opacity = '1'; };
    card.ondragover = e => { e.preventDefault(); card.addClass('ic-project-drop-hover'); };
    card.ondragleave = () => card.removeClass('ic-project-drop-hover');
    card.ondrop = async e => {
      e.preventDefault(); card.removeClass('ic-project-drop-hover');
      const srcId = e.dataTransfer.getData('project-drag');
      if (!srcId || srcId === project.id) return;
      const projs = data.projects;
      const si = projs.findIndex(p => p.id === srcId);
      const di = projs.findIndex(p => p.id === project.id);
      if (si >= 0 && di >= 0) { const [m] = projs.splice(si, 1); projs.splice(di, 0, m); }
      await saveData(this.plugin, data);
      await this.renderProjects();
    };

    // Accent bar
    card.createDiv({ cls: 'ic-project-card-accent' });

    const body = card.createDiv('ic-project-card-body');
    body.onclick = () => this.openCanvas(project.id, project.name);

    body.createDiv({ cls: 'ic-project-card-name', text: project.name });

    const statsRow = body.createDiv('ic-project-card-stats');
    const addStat = (num, label) => {
      const s = statsRow.createDiv('ic-project-card-stat');
      s.createSpan({ cls: 'ic-project-card-stat-num', text: String(num) });
      s.createSpan({ text: ' ' + label });
    };
    addStat(catCount, catCount === 1 ? 'category' : 'categories');
    addStat(cardCount, cardCount === 1 ? 'card' : 'cards');

    body.createDiv({ cls: 'ic-project-card-updated', text: 'Updated ' + updatedStr });

    // Actions row (visible on hover via CSS)
    const actions = card.createDiv('ic-project-card-actions');
    actions.createEl('button', { text: 'Open', cls: 'ic-btn primary' })
      .onclick = e => { e.stopPropagation(); this.openCanvas(project.id, project.name); };
    actions.createEl('button', { text: 'Rename', cls: 'ic-pile-action-btn' })
      .onclick = e => { e.stopPropagation(); new RenameProjectModal(this.plugin, project, data, () => this.renderProjects()).open(); };
    actions.createEl('button', { text: 'Delete', cls: 'ic-pile-action-btn danger' })
      .onclick = async e => {
        e.stopPropagation();
        if (!confirm(`Delete project "${project.name}"?\n\n${catCount} categories and ${cardCount} cards will be permanently deleted.`)) return;
        data.projects   = data.projects.filter(p => p.id !== project.id);
        data.categories = data.categories.filter(c => c.projectId !== project.id);
        data.cards      = data.cards.filter(c => c.projectId !== project.id);
        await saveData(this.plugin, data);
        await this.renderProjects();
        new Notice(`Project "${project.name}" deleted.`);
      };
  }

  // ══════════════════════════════════════════
  //  CANVAS SCREEN  (category pile grid)
  // ══════════════════════════════════════════
  async renderCanvas() {
    const data = await loadData(this.plugin);
    const root = this.containerEl.children[1] ?? this.containerEl;
    root.empty();
    root.className = 'ic-view ic-canvas-view';
    root.setAttribute('tabindex', '0');

    // ── Toolbar ──
    const tb = root.createDiv('ic-toolbar');
    tb.createEl('button', { text: '← Projects', cls: 'ic-btn' }).onclick = () => this.goProjects();
    tb.createEl('h2', { cls: 'ic-toolbar-title', text: this.activeProjectName });

    const tbActions = tb.createDiv('ic-toolbar-actions');
    tbActions.createEl('button', { text: '+ Card', cls: 'ic-btn primary' })
      .onclick = () => new CardEditorModal(this.plugin, data, null, null, this.activeProjectId, () => this.renderCanvas()).open();
    tbActions.createEl('button', { text: '+ Category', cls: 'ic-btn' })
      .onclick = () => new NewCategoryModal(this.plugin, data, this.activeProjectId, () => this.renderCanvas()).open();
    tbActions.createEl('button', { text: '🔍', cls: 'ic-btn', title: 'Search [F]' })
      .onclick = () => new SearchModal(this.plugin, data, this.activeProjectId, card => this.openCardFromSearch(card, data)).open();

    // ⋯ overflow menu
    const overflowWrap = tbActions.createDiv({ attr: { style: 'position:relative;' } });
    const overflowBtn  = overflowWrap.createEl('button', { text: '⋯', cls: 'ic-btn-overflow', title: 'More options' });
    let overflowOpen = false;
    const closeOverflow = () => { const m = overflowWrap.querySelector('.ic-overflow-menu'); if (m) m.remove(); overflowOpen = false; };
    overflowBtn.onclick = e => {
      e.stopPropagation();
      if (overflowOpen) { closeOverflow(); return; }
      overflowOpen = true;
      const menu = overflowWrap.createDiv('ic-overflow-menu');
      const item = (text, action) => {
        const el = menu.createDiv({ cls: 'ic-overflow-menu-item', text });
        el.onclick = () => { closeOverflow(); action(); };
      };
      item('↑ Export cards', () => new ExportModal(this.plugin, data, this.activeProjectId).open());
      item('📚 Bibliography', () => new BibliographyModal(this.plugin, data, this.activeProjectId).open());
      item('⚖️ Compare cards', () => new CompareModal(this.plugin, data, this.activeProjectId, null).open());
      menu.createDiv('ic-overflow-menu-separator');
      item('🕒 Recently edited', () => new RecentlyEditedModal(this.plugin, data, card => this.openCardFromSearch(card, data)).open());
      setTimeout(() => document.addEventListener('mousedown', function h(ev) {
        if (!overflowWrap.contains(ev.target)) { closeOverflow(); document.removeEventListener('mousedown', h); }
      }), 0);
    };

    this.buildQuickNav(root, data);

    this.attachShortcuts(root, {
      'n'     : () => new CardEditorModal(this.plugin, data, null, null, this.activeProjectId, () => this.renderCanvas()).open(),
      'c'     : () => new NewCategoryModal(this.plugin, data, this.activeProjectId, () => this.renderCanvas()).open(),
      'f'     : () => new SearchModal(this.plugin, data, this.activeProjectId, card => this.openCardFromSearch(card, data)).open(),
      'Escape': () => { this.goProjects(); },
    });

    const hints = root.createDiv('ic-shortcut-bar');
    hints.innerHTML = '<kbd>N</kbd> New card &nbsp;·&nbsp; <kbd>C</kbd> New category &nbsp;·&nbsp; <kbd>F</kbd> Search &nbsp;·&nbsp; <kbd>Esc</kbd> Projects';

    const desk = root.createDiv('ic-desk');
    const projectCats   = data.categories.filter(c => c.projectId === this.activeProjectId && !c.parentId);
    const uncategorized = data.cards.filter(c => c.projectId === this.activeProjectId && !c.categoryId);

    if (!projectCats.length && !uncategorized.length) {
      const e = desk.createDiv('ic-desk-empty');
      e.innerHTML = `<div style="font-size:2.5rem;margin-bottom:12px">🗂️</div>
        <strong>This project is empty.</strong><br>Press <kbd>N</kbd> to add a card or <kbd>C</kbd> to create a category.`;
      return;
    }

    let dragSrcCatId = null;

    for (const cat of projectCats) {
      const cards = data.cards.filter(c => c.categoryId === cat.id);
      const w = this.renderPileWidget(desk, cat.name, cards.length, cat.id, cards[0] || null, data, false);

      w.setAttribute('draggable', 'true');
      w.ondragstart = e => {
        dragSrcCatId = cat.id;
        e.dataTransfer.setData('cat-drag', cat.id);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => w.style.opacity = '0.4', 0);
      };
      w.ondragend = () => { w.style.opacity = '1'; };
      w.ondragover = e => {
        e.preventDefault();
        if (dragSrcCatId && dragSrcCatId !== cat.id) w.addClass('ic-drop-hover');
      };
      w.ondragleave = () => w.removeClass('ic-drop-hover');
      w.ondrop = async e => {
        e.preventDefault();
        w.removeClass('ic-drop-hover');
        const srcCatId = e.dataTransfer.getData('cat-drag');
        if (srcCatId && srcCatId !== cat.id) {
          const cats = data.categories;
          const si = cats.findIndex(c => c.id === srcCatId);
          const di = cats.findIndex(c => c.id === cat.id);
          if (si >= 0 && di >= 0) { const [m] = cats.splice(si, 1); cats.splice(di, 0, m); }
          await saveData(this.plugin, data);
          await this.renderCanvas();
          return;
        }
        const cardId = e.dataTransfer.getData('text/plain');
        if (cardId) {
          const card = data.cards.find(c => c.id === cardId);
          if (card) { card.categoryId = cat.id; await saveData(this.plugin, data); await this.renderCanvas(); }
        }
      };
    }

    if (uncategorized.length)
      this.renderPileWidget(desk, 'Uncategorized', uncategorized.length, null, uncategorized[0] || null, data, true);
  }

  renderPileWidget(desk, name, count, catId, topCard, data, isUncategorized) {
    const size = this.cardSize();
    const pW = size.w - 20;
    const pH = Math.round(pW * (size.h / size.w));

    const wrapper = desk.createDiv('ic-pile-wrapper' + (isUncategorized ? ' uncategorized' : ''));
    wrapper.ondragover = e => e.preventDefault();
    wrapper.ondrop = async e => {
      e.preventDefault();
      wrapper.removeClass('ic-drop-hover');
      const cardId = e.dataTransfer.getData('text/plain');
      if (!cardId) return;
      const card = data.cards.find(c => c.id === cardId);
      if (card) { card.categoryId = catId; await saveData(this.plugin, data); await this.renderCanvas(); }
    };

    const pile = wrapper.createDiv('ic-pile');
    pile.style.width  = pW + 'px';
    pile.style.height = pH + 'px';

    // Shadow layers give the "stack of cards" effect
    const s1 = pile.createDiv('ic-pile-shadow s1');
    s1.style.width  = (pW - 10) + 'px';
    s1.style.height = (pH - 10) + 'px';
    const s2 = pile.createDiv('ic-pile-shadow s2');
    s2.style.width  = (pW - 10) + 'px';
    s2.style.height = (pH - 10) + 'px';

    const top = pile.createDiv('ic-pile-top');
    top.style.width  = (pW - 8) + 'px';
    top.style.height = (pH - 8) + 'px';

    // Color stripe from top card
    if (topCard && topCard.color && topCard.color !== 'default') {
      const stripe = top.createDiv('ic-pile-color-stripe');
      stripe.style.background = CARD_COLORS[topCard.color]?.border || 'transparent';
    }

    if (topCard && (topCard.cardTitle || topCard.front)) {
      const preview = top.createDiv('ic-pile-preview');
      if (topCard.cardTitle) preview.createDiv({ cls: 'ic-pile-preview-title', text: topCard.cardTitle });
      const pt = (topCard.front || '').split('\n')[0].slice(0, 80);
      if (pt) preview.createDiv({ cls: 'ic-pile-preview-text', text: pt });
      top.createDiv({ cls: 'ic-pile-count-badge', text: String(count) });
    } else {
      top.createDiv({ cls: 'ic-pile-count', text: String(count) });
      top.createDiv({ cls: 'ic-pile-count-label', text: count === 1 ? 'card' : 'cards' });
    }

    // Subcategory indicator
    if (catId) {
      const subcatCount = data.categories.filter(c => c.parentId === catId).length;
      if (subcatCount > 0) {
        top.createDiv({ cls: 'ic-pile-subcat-badge', text: `↳ ${subcatCount} sub${subcatCount === 1 ? '' : 's'}` });
      }
    }

    top.createDiv({ cls: 'ic-pile-drag-hint', text: '⠿ drag to reorder' });
    wrapper.createDiv({ cls: 'ic-pile-label', text: name });
    pile.onclick = () => this.openPile(catId, name);

    if (!isUncategorized) {
      const actions = wrapper.createDiv('ic-pile-actions');
      actions.createEl('button', { text: 'Rename', cls: 'ic-pile-action-btn' })
        .onclick = e => {
          e.stopPropagation();
          const cat = data.categories.find(c => c.id === catId);
          if (cat) new RenameCategoryModal(this.plugin, cat, data, () => this.renderCanvas()).open();
        };
      actions.createEl('button', { text: 'Delete', cls: 'ic-pile-action-btn danger' })
        .onclick = async e => {
          e.stopPropagation();
          if (!confirm(`Delete category "${name}"?\nCards will become Uncategorized.`)) return;
          data.categories = data.categories.filter(c => c.id !== catId);
          data.cards = data.cards.map(c => c.categoryId === catId ? { ...c, categoryId: null } : c);
          await saveData(this.plugin, data);
          await this.renderCanvas();
        };
    }
    return wrapper;
  }

  // ══════════════════════════════════════════
  //  PILE VIEW  (cards in a category)
  // ══════════════════════════════════════════
  // ── Ctrl+hover card preview popover ──
  _ensurePopover() {
    if (this._hoverPop) return;
    const pop = document.createElement('div');
    pop.className = 'ic-hover-popover';
    pop.style.cssText = 'display:none;position:fixed;z-index:9999;max-width:420px;min-width:260px;pointer-events:none;';
    document.body.appendChild(pop);
    this._hoverPop = pop;
    this._hoverKeyDown = (e) => {
      if (e.key === 'Control' && this._hoverCard) this._showPopover(this._hoverCard, this._hoverX, this._hoverY);
    };
    this._hoverKeyUp = (e) => {
      if (e.key === 'Control') this._hidePopover();
    };
    document.addEventListener('keydown', this._hoverKeyDown);
    document.addEventListener('keyup',   this._hoverKeyUp);
  }

  _showPopover(card, x, y) {
    const pop = this._hoverPop;
    if (!pop) return;
    pop.innerHTML = '';
    const inner = pop.createDiv('ic-hover-popover-inner');
    if (card.cardTitle) inner.createDiv({ cls: 'ic-hover-title', text: card.cardTitle.toUpperCase() });
    const body = inner.createDiv('ic-hover-body');
    MarkdownRenderer.render(this.plugin.app, card.front || '*(empty)*', body, '', this.plugin);
    if (card.author || card.year) {
      const cite = [
        card.author ? card.author.split(',')[0] : null,
        card.year   ? card.year : null,
        card.pages  ? 'p. ' + card.pages : null,
      ].filter(Boolean).join(', ');
      inner.createDiv({ cls: 'ic-hover-citation', text: cite });
    }
    this._positionPopover(x, y);
    pop.style.display = 'block';
  }

  _hidePopover() {
    if (this._hoverPop) this._hoverPop.style.display = 'none';
    this._hoverCard = null;
  }

  _positionPopover(x, y) {
    const pop = this._hoverPop;
    if (!pop) return;
    const pad = 16, vw = window.innerWidth, vh = window.innerHeight;
    const pw = pop.offsetWidth  || 320;
    const ph = pop.offsetHeight || 200;
    let left = x + 20;
    let top  = y + 10;
    if (left + pw + pad > vw) left = x - pw - 10;
    if (top  + ph + pad > vh) top  = vh - ph - pad;
    if (left < pad) left = pad;
    if (top  < pad) top  = pad;
    pop.style.left = left + 'px';
    pop.style.top  = top  + 'px';
  }

  async renderPile() {
    const data = await loadData(this.plugin);
    this._ensurePopover();
    const root = this.containerEl.children[1] ?? this.containerEl;
    root.empty();
    root.className = 'ic-view ic-pile-view' + (this.plugin.settings.ruledLines === false ? ' ic-no-rules' : '');
    root.setAttribute('tabindex', '0');

    // ── Toolbar ──
    const tb = root.createDiv('ic-toolbar');
    tb.createEl('button', { text: '← Back', cls: 'ic-btn' }).onclick = () => this.goCanvas();
    tb.createEl('h2', { cls: 'ic-toolbar-title', text: this.activeCatName });

    const tbActions = tb.createDiv('ic-toolbar-actions');
    tbActions.createEl('button', { text: '+ Card', cls: 'ic-btn primary' })
      .onclick = () => new CardEditorModal(this.plugin, data, null, this.activeCatId, this.activeProjectId, () => this.renderPile()).open();

    if (this.activeCatId) {
      tbActions.createEl('button', { text: '+ Sub', cls: 'ic-btn', title: 'Add Subcategory' })
        .onclick = () => new NewSubcategoryModal(this.plugin, data, this.activeCatId, this.activeProjectId, () => this.renderPile()).open();
    }

    tbActions.createEl('button', { text: '🔍', cls: 'ic-btn', title: 'Search [F]' })
      .onclick = () => new SearchModal(this.plugin, data, this.activeProjectId, card => this.openCardFromSearch(card, data)).open();

    // ── Card size slider popover ──
    const sizeWrap = tbActions.createDiv({ attr: { style: 'position:relative;' } });
    const sizeBtn  = sizeWrap.createEl('button', { text: '⤢', cls: 'ic-btn-overflow', title: 'Card size' });
    let sizeOpen = false;
    const closeSizePopover = () => { const p = sizeWrap.querySelector('.ic-size-popover'); if (p) p.remove(); sizeOpen = false; };
    sizeBtn.onclick = e => {
      e.stopPropagation();
      if (sizeOpen) { closeSizePopover(); return; }
      sizeOpen = true;
      const pop = sizeWrap.createDiv('ic-size-popover');

      const makeSlider = (label, key, min, max, step) => {
        const row = pop.createDiv('ic-size-popover-row');
        row.createDiv({ cls: 'ic-size-popover-label', text: label });
        const slider = row.createEl('input', { type: 'range', cls: 'ic-size-popover-slider' });
        slider.min   = String(min);
        slider.max   = String(max);
        slider.step  = String(step);
        // Always read the actual rendered size as the starting value
        const size = this.cardSize();
        const cur = key === 'w' ? size.w : size.h;
        slider.value = String(cur);
        const valEl = row.createDiv({ cls: 'ic-size-popover-value', text: cur + 'px' });
        slider.onmousedown = e => e.stopPropagation();
        slider.oninput = () => {
          const v = parseInt(slider.value);
          valEl.textContent = v + 'px';
          if (!this._runtimeSize) this._runtimeSize = { ...this.cardSize() };
          if (key === 'w') this._runtimeSize.w = v;
          else             this._runtimeSize.h = v;
          clearTimeout(slider._renderTimer);
          slider._renderTimer = setTimeout(async () => {
            await this.renderPile();
            const newSizeBtn = root.querySelector('.ic-btn-overflow[title="Card size"]');
            if (newSizeBtn) newSizeBtn.click();
          }, 300);
        };
        return slider;
      };

      makeSlider('Width',  'w', 140, 420, 10);
      makeSlider('Height', 'h', 120, 360, 10);

      // Dismiss when clicking outside the popover wrapper
      setTimeout(() => document.addEventListener('mousedown', function h(ev) {
        if (!sizeWrap.contains(ev.target)) { closeSizePopover(); document.removeEventListener('mousedown', h); }
      }), 0);
    };

    // ⋯ overflow menu
    const overflowWrap = tbActions.createDiv({ attr: { style: 'position:relative;' } });
    const overflowBtn  = overflowWrap.createEl('button', { text: '⋯', cls: 'ic-btn-overflow', title: 'More options' });
    let overflowOpen = false;
    const closeOverflow = () => { const m = overflowWrap.querySelector('.ic-overflow-menu'); if (m) m.remove(); overflowOpen = false; };
    overflowBtn.onclick = e => {
      e.stopPropagation();
      if (overflowOpen) { closeOverflow(); return; }
      overflowOpen = true;
      const menu = overflowWrap.createDiv('ic-overflow-menu');
      const item = (text, action) => {
        const el = menu.createDiv({ cls: 'ic-overflow-menu-item', text });
        el.onclick = () => { closeOverflow(); action(); };
      };
      item('⚖️ Compare cards', () => new CompareModal(this.plugin, data, this.activeProjectId, null).open());
      item('↑ Export cards',   () => new ExportModal(this.plugin, data, this.activeProjectId).open());
      item('📚 Bibliography',  () => new BibliographyModal(this.plugin, data, this.activeProjectId).open());
      menu.createDiv('ic-overflow-menu-separator');
      item('🕒 Recently edited', () => new RecentlyEditedModal(this.plugin, data, card => this.openCardFromSearch(card, data)).open());
      setTimeout(() => document.addEventListener('mousedown', function h(ev) {
        if (!overflowWrap.contains(ev.target)) { closeOverflow(); document.removeEventListener('mousedown', h); }
      }), 0);
    };

    this.attachShortcuts(root, {
      'n'     : () => new CardEditorModal(this.plugin, data, null, this.activeCatId, this.activeProjectId, () => this.renderPile()).open(),
      'f'     : () => new SearchModal(this.plugin, data, this.activeProjectId, card => this.openCardFromSearch(card, data)).open(),
      'Escape': () => this.goCanvas(),
    });

    this.buildQuickNav(root, data);

    const hints = root.createDiv('ic-shortcut-bar');
    hints.innerHTML = '<kbd>N</kbd> Add card &nbsp;·&nbsp; <kbd>F</kbd> Search &nbsp;·&nbsp; <kbd>Esc</kbd> Back';

    const subcats = this.activeCatId
      ? data.categories.filter(c => c.parentId === this.activeCatId)
      : [];

    const cards = data.cards.filter(c =>
      this.activeCatId === null
        ? (c.projectId === this.activeProjectId && !c.categoryId)
        : (c.categoryId === this.activeCatId && !c.subcategoryId)
    );

    const grid = root.createDiv('ic-cards-grid');

    if (!cards.length && !subcats.length) {
      grid.createDiv({ cls: 'ic-cards-empty', text: 'No cards yet. Press N to add one.' });
      return;
    }

    // Cards first
    let dragSrcId = null;
    for (const card of cards)
      this.renderCardWidget(grid, card, data, id => { dragSrcId = id; }, () => dragSrcId);

    // Subcategory piles BELOW cards
    if (subcats.length) {
      const subDesk = root.createDiv('ic-subcat-row');
      subDesk.createDiv({ cls: 'ic-subcat-row-label', text: 'Subcategories' });
      const subPiles = subDesk.createDiv('ic-subcat-piles');
      for (const sub of subcats) {
        const subCards = data.cards.filter(c => c.subcategoryId === sub.id);
        this.renderSubcategoryPile(subPiles, sub, subCards.length, subCards[0] || null, data);
      }
    }
  }

  renderSubcategoryPile(container, sub, count, topCard, data) {
    const size = this.cardSize();
    const pW = Math.round((size.w - 20) * 0.8);
    const pH = Math.round(pW * (size.h / size.w));

    const wrapper = container.createDiv('ic-pile-wrapper ic-subcat-pile-wrapper');
    const pile    = wrapper.createDiv('ic-pile');
    pile.style.width  = pW + 'px';
    pile.style.height = pH + 'px';

    const s1 = pile.createDiv('ic-pile-shadow s1');
    s1.style.cssText = `width:${pW - 10}px;height:${pH - 10}px`;

    const top = pile.createDiv('ic-pile-top');
    top.style.cssText = `width:${pW - 8}px;height:${pH - 8}px`;

    if (topCard && (topCard.cardTitle || topCard.front)) {
      const prev = top.createDiv('ic-pile-preview');
      if (topCard.cardTitle) prev.createDiv({ cls: 'ic-pile-preview-title', text: topCard.cardTitle });
      const pt = (topCard.front || '').split('\n')[0].slice(0, 60);
      if (pt) prev.createDiv({ cls: 'ic-pile-preview-text', text: pt });
      top.createDiv({ cls: 'ic-pile-count-badge', text: String(count) });
    } else {
      top.createDiv({ cls: 'ic-pile-count', text: String(count) });
      top.createDiv({ cls: 'ic-pile-count-label', text: count === 1 ? 'card' : 'cards' });
    }

    wrapper.createDiv({ cls: 'ic-pile-label', text: '↳ ' + sub.name });

    pile.onclick = () => this.openSubcatView(sub.id, sub.name);

    const actions = wrapper.createDiv('ic-pile-actions');
    actions.createEl('button', { text: 'Rename', cls: 'ic-pile-action-btn' })
      .onclick = e => {
        e.stopPropagation();
        new RenameSubcategoryModal(this.plugin, sub, data, () => this.renderPile()).open();
      };
    actions.createEl('button', { text: 'Delete', cls: 'ic-pile-action-btn danger' })
      .onclick = async e => {
        e.stopPropagation();
        if (!confirm(`Delete subcategory "${sub.name}"?\nCards will move up to the parent category.`)) return;
        data.categories = data.categories.filter(c => c.id !== sub.id);
        data.cards = data.cards.map(c => c.subcategoryId === sub.id ? { ...c, subcategoryId: null } : c);
        await saveData(this.plugin, data);
        await this.renderPile();
      };
  }

  async openSubcatView(subId, subName) {
    this.screen          = 'subcat';
    this.activeSubcatId  = subId;
    this.activeSubcatName = subName;
    await this.renderSubcatView();
  }

  async renderSubcatView() {
    const data = await loadData(this.plugin);
    const root = this.containerEl.children[1] ?? this.containerEl;
    root.empty();
    root.className = 'ic-view ic-pile-view' + (this.plugin.settings.ruledLines === false ? ' ic-no-rules' : '');
    root.setAttribute('tabindex', '0');

    const tb = root.createDiv('ic-toolbar');
    tb.createEl('button', { text: '← Back', cls: 'ic-btn' }).onclick = () => this.renderPile();
    tb.createEl('h2', { cls: 'ic-toolbar-title', text: '↳ ' + this.activeSubcatName });

    const tbActions = tb.createDiv('ic-toolbar-actions');
    tbActions.createEl('button', { text: '+ Card', cls: 'ic-btn primary' })
      .onclick = () => {
        const modal = new CardEditorModal(this.plugin, data, null, this.activeCatId, this.activeProjectId, () => this.renderSubcatView());
        modal._defaultSubcatId = this.activeSubcatId;
        modal.open();
      };
    tbActions.createEl('button', { text: '🔍', cls: 'ic-btn', title: 'Search [F]' })
      .onclick = () => new SearchModal(this.plugin, data, this.activeProjectId, card => this.openCardFromSearch(card, data)).open();

    // Size slider popover (same as pile view)
    const sizeWrap = tbActions.createDiv({ attr: { style: 'position:relative;' } });
    const sizeBtn  = sizeWrap.createEl('button', { text: '⤢', cls: 'ic-btn-overflow', title: 'Card size' });
    let sizeOpen = false;
    const closeSizePopover = () => { const p = sizeWrap.querySelector('.ic-size-popover'); if (p) p.remove(); sizeOpen = false; };
    sizeBtn.onclick = e => {
      e.stopPropagation();
      if (sizeOpen) { closeSizePopover(); return; }
      sizeOpen = true;
      const pop = sizeWrap.createDiv('ic-size-popover');
      const makeSlider = (label, key, min, max, step) => {
        const row = pop.createDiv('ic-size-popover-row');
        row.createDiv({ cls: 'ic-size-popover-label', text: label });
        const slider = row.createEl('input', { type: 'range', cls: 'ic-size-popover-slider' });
        slider.min = String(min); slider.max = String(max); slider.step = String(step);
        const size = this.cardSize();
        const cur = key === 'w' ? size.w : size.h;
        slider.value = String(cur);
        const valEl = row.createDiv({ cls: 'ic-size-popover-value', text: cur + 'px' });
        slider.onmousedown = e => e.stopPropagation();
        slider.oninput = () => {
          const v = parseInt(slider.value);
          valEl.textContent = v + 'px';
          if (!this._runtimeSize) this._runtimeSize = { ...this.cardSize() };
          if (key === 'w') this._runtimeSize.w = v;
          else             this._runtimeSize.h = v;
          clearTimeout(slider._renderTimer);
          slider._renderTimer = setTimeout(async () => {
            await this.renderSubcatView();
            const newSizeBtn = root.querySelector('.ic-btn-overflow[title="Card size"]');
            if (newSizeBtn) newSizeBtn.click();
          }, 300);
        };
      };
      makeSlider('Width', 'w', 160, 400, 10);
      makeSlider('Height', 'h', 120, 320, 10);
      setTimeout(() => document.addEventListener('mousedown', function h(ev) {
        if (!sizeWrap.contains(ev.target)) { closeSizePopover(); document.removeEventListener('mousedown', h); }
      }), 0);
    };

    this.attachShortcuts(root, {
      'n': () => {
        const modal = new CardEditorModal(this.plugin, data, null, this.activeCatId, this.activeProjectId, () => this.renderSubcatView());
        modal._defaultSubcatId = this.activeSubcatId;
        modal.open();
      },
      'f'     : () => new SearchModal(this.plugin, data, this.activeProjectId, card => this.openCardFromSearch(card, data)).open(),
      'Escape': () => this.openPile(this.activeCatId, this.activeCatName),
    });

    this.buildQuickNav(root, data);

    const hints = root.createDiv('ic-shortcut-bar');
    hints.innerHTML = '<kbd>N</kbd> Add card &nbsp;·&nbsp; <kbd>F</kbd> Search &nbsp;·&nbsp; <kbd>Esc</kbd> Back';

    const grid  = root.createDiv('ic-cards-grid');
    const cards = data.cards.filter(c => c.subcategoryId === this.activeSubcatId);

    if (!cards.length) {
      grid.createDiv({ cls: 'ic-cards-empty', text: 'No cards yet. Press N to add one.' });
      return;
    }

    let dragSrcId = null;
    for (const card of cards)
      this.renderCardWidget(grid, card, data, id => { dragSrcId = id; }, () => dragSrcId, true);
  }

  // ══════════════════════════════════════════
  //  CARD WIDGET
  // ══════════════════════════════════════════
  renderCardWidget(grid, card, data, setDragSrc, getDragSrc) {
    const size = this.cardSize();
    const el   = grid.createDiv('ic-card');
    el.style.width  = size.w + 'px';
    el.style.height = size.h + 'px';

    const col = CARD_COLORS[card.color || 'default'] || CARD_COLORS['default'];
    el.style.background   = col.bg;
    el.style.borderColor  = col.border;

    // ── Drag ──
    el.setAttribute('draggable', 'true');
    el.ondragstart = e => {
      setDragSrc(card.id);
      e.dataTransfer.setData('text/plain', card.id);
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => el.addClass('ic-card-dragging'), 0);
    };
    el.ondragend = () => el.removeClass('ic-card-dragging');
    el.ondragover = e => {
      e.preventDefault();
      if (getDragSrc() && getDragSrc() !== card.id) el.addClass('ic-card-drop-target');
    };
    el.ondragleave = () => el.removeClass('ic-card-drop-target');
    el.ondrop = async e => {
      e.preventDefault(); e.stopPropagation();
      el.removeClass('ic-card-drop-target');
      const srcId = e.dataTransfer.getData('text/plain');
      if (!srcId || srcId === card.id) return;
      const si = data.cards.findIndex(c => c.id === srcId);
      const di = data.cards.findIndex(c => c.id === card.id);
      if (si < 0 || di < 0) return;
      const srcCard = data.cards[si];
      srcCard.categoryId = card.categoryId;
      data.cards.splice(si, 1);
      const newDi = data.cards.findIndex(c => c.id === card.id);
      const insertPos = si < di ? newDi + 1 : newDi;
      data.cards.splice(insertPos, 0, srcCard);
      await saveData(this.plugin, data);
      await this.renderPile();
    };

    // ── Card content ──
    const front = el.createDiv('ic-card-front');

    if (card.cardTitle)
      front.createDiv({ cls: 'ic-card-title-badge', text: card.cardTitle.toUpperCase() });

    // Show category badge when viewing Uncategorized pile
    if (!this.activeCatId && card.categoryId) {
      const cat = data.categories.find(c => c.id === card.categoryId);
      if (cat) front.createDiv({ cls: 'ic-card-category-badge', text: cat.name });
    }

    const contentEl = front.createDiv({ cls: 'ic-card-front-text' });
    MarkdownRenderer.render(this.plugin.app, card.front || '*(empty)*', contentEl, '', this.plugin);
    front.createDiv({ cls: 'ic-card-text-fade' });

    if (card.tags && card.tags.length) {
      const tagsRow = front.createDiv('ic-card-tags-row');
      for (const tag of card.tags)
        tagsRow.createSpan({ cls: 'ic-card-tag', text: '#' + tag });
    }

    el.onmouseover = () => {
      el.style.boxShadow   = '0 6px 18px rgba(0,0,0,0.25)';
      el.style.borderColor = 'var(--interactive-accent)';
      el.style.zIndex      = '10';
    };
    el.onmouseout = e => {
      if (!el.contains(e.relatedTarget)) {
        el.style.boxShadow   = '0 2px 6px rgba(0,0,0,0.13)';
        el.style.borderColor = col.border;
        el.style.zIndex      = '';
        this._hidePopover();
      }
    };
    el.addEventListener('mouseenter', e => {
      this._hoverCard = card;
      this._hoverX = e.clientX;
      this._hoverY = e.clientY;
      if (e.ctrlKey) this._showPopover(card, e.clientX, e.clientY);
    });
    el.addEventListener('mousemove', e => {
      this._hoverX = e.clientX;
      this._hoverY = e.clientY;
      if (this._hoverPop && this._hoverPop.style.display === 'block') {
        this._positionPopover(e.clientX, e.clientY);
      }
    });

    // ── Footer ──
    const footer  = el.createDiv('ic-card-footer');
    // Short citation — left side of footer
    if (card.author || card.year) {
      const citeStr = [
        card.author ? card.author.split(',')[0] : null,
        card.year   ? card.year : null,
        card.pages  ? 'p. ' + card.pages : null,
      ].filter(Boolean).join(', ');
      footer.createDiv({ cls: 'ic-card-citation', text: citeStr });
    }
    const actions = footer.createDiv('ic-card-actions');

    actions.createEl('button', { text: '✏️', cls: 'ic-card-action', title: 'Edit' })
      .onclick = e => {
        e.stopPropagation();
        new CardEditorModal(this.plugin, data, card, this.activeCatId, this.activeProjectId, () => this.renderPile()).open();
      };

    actions.createEl('button', { text: '📂', cls: 'ic-card-action', title: 'Move to category' })
      .onclick = e => {
        e.stopPropagation();
        new MoveCategoryModal(this.plugin, card, data, this.activeProjectId, () => this.renderPile()).open();
      };

    actions.createEl('button', { text: '🗑', cls: 'ic-card-action', title: 'Delete' })
      .onclick = async e => {
        e.stopPropagation();
        const delLabelBtn = (card.cardTitle || card.front.slice(0, 40) || 'this card').replace(/\n/g, ' ').trim();
        if (!confirm(`Delete "${delLabelBtn}"?\nThis cannot be undone.`)) return;
        data.cards = data.cards.filter(c => c.id !== card.id);
        await saveData(this.plugin, data);
        await this.renderPile();
      };

    // Open editor on card click
    el.onclick = () =>
      new CardEditorModal(this.plugin, data, card, this.activeCatId, this.activeProjectId, () => this.renderPile()).open();

    // ── Right-click context menu ──
    el.oncontextmenu = e => {
      e.preventDefault(); e.stopPropagation();
      showContextMenu(e, [
        { type: 'label', text: 'Card Actions' },
        {
          text: '✏️  Edit Card',
          action: () => new CardEditorModal(this.plugin, data, card, this.activeCatId, this.activeProjectId, () => this.renderPile()).open(),
        },
        { type: 'separator' },
        {
          text: '📂  Move to Category',
          action: () => new MoveCategoryModal(this.plugin, card, data, this.activeProjectId, () => this.renderPile()).open(),
        },
        {
          text: '🗂️  Move to Project',
          action: () => new MoveToProjectModal(this.plugin, card, data, this.activeProjectId, () => this.renderPile()).open(),
        },
        { type: 'separator' },
        {
          text: '⚖️  Compare with…',
          action: () => new CompareModal(this.plugin, data, this.activeProjectId, card).open(),
        },
        {
          text: '↑  Export Card',
          action: () => new ExportModal(this.plugin, data, this.activeProjectId, card).open(),
        },
        {
          text: '📋  Duplicate Card',
          action: async () => {
            const dup = {
              ...card,
              id: makeId(),
              cardTitle: card.cardTitle ? card.cardTitle + ' (copy)' : '',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            const idx = data.cards.findIndex(c => c.id === card.id);
            data.cards.splice(idx + 1, 0, dup);
            await saveData(this.plugin, data);
            await this.renderPile();
            new Notice('Card duplicated.');
          },
        },
        { type: 'separator' },
        {
          text: '🗑  Delete Card', danger: true,
          action: async () => {
            const ctxLabel = (card.cardTitle || card.front.slice(0, 40) || 'this card').replace(/\n/g, ' ').trim();
            if (!confirm(`Delete "${ctxLabel}"?\nThis cannot be undone.`)) return;
            data.cards = data.cards.filter(c => c.id !== card.id);
            await saveData(this.plugin, data);
            await this.renderPile();
          },
        },
      ]);
    };
  }

  openCardFromSearch(card, data) {
    // Delay navigation so the search/recent modal fully closes first
    setTimeout(async () => {
      const catId   = card.categoryId || null;
      const catName = catId
        ? (data.categories.find(c => c.id === catId) || {}).name || 'Uncategorized'
        : 'Uncategorized';
      this.activeProjectId   = card.projectId;
      this.activeProjectName = (data.projects.find(p => p.id === card.projectId) || {}).name || '';
      await this.openPile(catId, catName);
      // Reload fresh data before opening editor
      const freshData = await loadData(this.plugin);
      const freshCard = freshData.cards.find(c => c.id === card.id) || card;
      new CardEditorModal(this.plugin, freshData, freshCard, catId, this.activeProjectId, () => this.renderPile()).open();
    }, 120);
  }
}

// ═════════════════════════════════════════════
//  SEARCH MODAL
// ═════════════════════════════════════════════
class SearchModal extends Modal {
  constructor(plugin, data, projectId, onSelect) {
    super(plugin.app);
    this.plugin    = plugin;
    this.data      = data;
    this.projectId = projectId;
    this.onSelect  = onSelect;
  }

  onOpen() {
    // Mark a global flag so we never open two at once
    if (window._icSearchOpen) { this.close(); return; }
    window._icSearchOpen = true;
    this._buildUI();
  }

  onClose() {
    window._icSearchOpen = false;
    this.contentEl.empty();
  }

  _buildUI() {
    this.modalEl.addClass('ic-modal-narrow');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: '🔍 Search Cards' });

    const input = contentEl.createEl('input', {
      type: 'text',
      placeholder: 'Search titles, notes, tags…',
      cls: 'ic-search-input',
    });
    setTimeout(() => input.focus(), 50);

    const results = contentEl.createDiv('ic-search-results');

    const render = q => {
      results.empty();
      const cards   = this.data.cards.filter(c => c.projectId === this.projectId);
      const matches = q
        ? cards.filter(c => {
            const hay = [c.cardTitle, c.front, ...(c.tags || [])].join(' ').toLowerCase();
            return hay.includes(q.toLowerCase());
          })
        : cards.slice(0, 20);

      if (!matches.length) {
        results.createDiv({
          text: q ? 'No cards match that search.' : 'No cards in this project.',
          attr: { style: 'color:var(--text-muted);font-size:0.85rem;padding:8px 0' },
        });
        return;
      }

      for (const card of matches) {
        const row = results.createDiv('ic-search-result');
        const cat = card.categoryId
          ? (this.data.categories.find(c => c.id === card.categoryId) || {}).name || 'Uncategorized'
          : 'Uncategorized';
        row.createDiv({ cls: 'ic-search-result-title', text: card.cardTitle || card.front.slice(0, 60) || '(untitled)' });
        row.createDiv({ cls: 'ic-search-result-meta',  text: cat + (card.tags?.length ? ' · #' + card.tags.join(' #') : '') });
        row.onclick = () => { this.close(); this.onSelect(card); };
      }

      if (!q)
        results.createDiv({ text: 'Showing recent cards. Type to search.', attr: { style: 'color:var(--text-faint);font-size:0.75rem;margin-top:4px' } });
    };

    render('');
    input.oninput  = () => render(input.value.trim());
    input.onkeydown = e => { if (e.key === 'Escape') this.close(); };
  }

}

// ═════════════════════════════════════════════
//  CARD EDITOR MODAL  — single panel, autosave
// ═════════════════════════════════════════════
class CardEditorModal extends Modal {
  constructor(plugin, data, existingCard, defaultCategoryId, projectId, onSave) {
    super(plugin.app);
    this.plugin    = plugin;
    this.data      = data;
    this.projectId = projectId;
    this.card      = existingCard
      ? { ...existingCard }
      : { ...emptyCard(defaultCategoryId), projectId };
    this.isNew       = !existingCard;
    this.onSave      = onSave;
    this._saveStatus = null;
    // Autosave 2 s after last keystroke
    this._autosave = debounce(async () => { await this._persist(); this._showSaved(); }, 2000);
  }

  async _persist() {
    const hasContent = (this.card.front || '').trim() || (this.card.cardTitle || '').trim();
    if (!hasContent) return;
    this.card.updatedAt = Date.now();
    if (this.isNew) {
      const existing = this.data.cards.find(c => c.id === this.card.id);
      if (!existing) { this.data.cards.push(this.card); this.isNew = false; }
      else Object.assign(existing, this.card);
    } else {
      const idx = this.data.cards.findIndex(c => c.id === this.card.id);
      if (idx >= 0) this.data.cards[idx] = { ...this.data.cards[idx], ...this.card };
    }
    await saveData(this.plugin, this.data);
    this.onSave();
  }

  _showSaved() {
    if (this._saveStatus) {
      this._saveStatus.textContent = '✓ Saved';
      setTimeout(() => { if (this._saveStatus) this._saveStatus.textContent = ''; }, 2000);
    }
  }

  _touch() { this._autosave(); }

  onOpen() {
    this.modalEl.addClass('ic-modal');
    const widths = { small: '580px', medium: '760px', large: '1020px' };
    const w = widths[this.plugin.settings.editorSize || 'medium'];
    this.modalEl.style.setProperty('width',     w, 'important');
    this.modalEl.style.setProperty('max-width', w, 'important');
    this.modalEl.style.setProperty('min-width', w, 'important');

    // ── Draggable ──
    this.modalEl.style.position = 'fixed';
    let isDragging = false, dragOffX = 0, dragOffY = 0;
    const onMouseMove = e => {
      if (!isDragging) return;
      this.modalEl.style.left = (e.clientX - dragOffX) + 'px';
      this.modalEl.style.top  = (e.clientY - dragOffY) + 'px';
      this.modalEl.style.transform = 'none';
      this.modalEl.style.margin = '0';
    };
    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    const { contentEl } = this;
    contentEl.empty();
    const inner = contentEl.createDiv('ic-modal-inner');

    // ── Drag handle ──
    const dragBar = inner.createDiv('ic-drag-bar');
    dragBar.innerHTML = '<span style="opacity:0.4;letter-spacing:2px;">⠿⠿⠿</span><span style="font-size:0.7rem;opacity:0.4;margin-left:8px;">drag to move</span>';
    dragBar.onmousedown = e => {
      if (e.button !== 0) return;
      const rect = this.modalEl.getBoundingClientRect();
      if (!this.modalEl.style.left) {
        this.modalEl.style.left = rect.left + 'px';
        this.modalEl.style.top  = rect.top  + 'px';
        this.modalEl.style.transform = 'none';
        this.modalEl.style.margin = '0';
      }
      isDragging = true;
      dragOffX = e.clientX - this.modalEl.getBoundingClientRect().left;
      dragOffY = e.clientY - this.modalEl.getBoundingClientRect().top;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    };

    // ── Header ──
    const header = inner.createDiv('ic-modal-header');
    header.createEl('h3', { text: this.isNew ? 'New Card' : 'Edit Card' });
    this._saveStatus = header.createDiv({ cls: 'ic-save-status' });

    // ── Tab row ──
    const tabRow = inner.createDiv('ic-editor-tabs');
    const noteTabBtn = tabRow.createDiv({ cls: 'ic-editor-tab active', text: '📄 Note' });
    const srcTabBtn  = this.plugin.settings.academicMode
      ? tabRow.createDiv({ cls: 'ic-editor-tab', text: '📚 Source / Citation' })
      : null;

    const notePanel = inner.createDiv('ic-editor-panel');
    const srcPanel  = inner.createDiv({ cls: 'ic-editor-panel', attr: { style: 'display:none;' } });

    const switchTab = (tab) => {
      noteTabBtn.removeClass('active');
      if (srcTabBtn) srcTabBtn.removeClass('active');
      notePanel.style.display = 'none';
      srcPanel.style.display  = 'none';
      if (tab === 'note') { noteTabBtn.addClass('active'); notePanel.style.display = ''; }
      else                { if (srcTabBtn) srcTabBtn.addClass('active'); srcPanel.style.display = ''; }
    };

    noteTabBtn.onclick = () => switchTab('note');
    if (srcTabBtn) srcTabBtn.onclick = () => switchTab('source');

    // ══ NOTE PANEL ══════════════════════════════════════
    // Card Title
    const tf = notePanel.createDiv('ic-field');
    tf.createEl('label', { text: 'Card Title' });
    const ti = tf.createEl('input', { type: 'text', placeholder: 'e.g. Main argument — Chapter 3' });
    ti.value   = this.card.cardTitle || '';
    ti.oninput = () => { this.card.cardTitle = ti.value; this._touch(); };
    // Tab from title goes straight to textarea (set via tabindex after build)

    // Note field
    const nf = notePanel.createDiv('ic-field');
    const noteLabel = nf.createDiv({ attr: { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;' } });
    noteLabel.createEl('label', { text: 'Note', attr: { style: 'margin:0;' } });
    const previewToggle = noteLabel.createEl('button', {
      text: this._sessionSplit ? '✕ Preview' : '⬜ Preview',
      cls: 'ic-btn',
      attr: { style: 'font-size:0.72rem;padding:2px 8px;', tabindex: '-1' }
    });
    if (this._sessionSplit === undefined) this._sessionSplit = this.plugin.settings.splitEditor;
    const useSplit = () => this._sessionSplit;
    previewToggle.onclick = () => {
      this._sessionSplit = !this._sessionSplit;
      previewToggle.textContent = this._sessionSplit ? '✕ Preview' : '⬜ Preview';
      buildNoteField();
    };

    let _activeTa = null;
    const applyFmt = wrap => {
      const ta = _activeTa; if (!ta) return;
      const s = ta.selectionStart, e = ta.selectionEnd;
      const raw = ta.value.slice(s, e);
      const trimmed = raw.trim();
      const leadSpace = raw.slice(0, raw.length - raw.trimStart().length);
      const trailSpace = raw.slice(raw.trimEnd().length);
      const before = ta.value.slice(0, s) + leadSpace;
      const after  = trailSpace + ta.value.slice(e);
      const iS = s + leadSpace.length, iE = iS + trimmed.length;
      if (before.endsWith(wrap) && after.startsWith(wrap)) {
        ta.value = before.slice(0, -wrap.length) + trimmed + after.slice(wrap.length);
        ta.setSelectionRange(iS - wrap.length, iE - wrap.length);
      } else {
        ta.value = before + wrap + trimmed + wrap + after;
        ta.setSelectionRange(iS + wrap.length, iE + wrap.length);
      }
      ta.dispatchEvent(new Event('input'));
      ta.focus();
    };

    const blockKeys = ta => {
      _activeTa = ta;
      // Use keypress for * so we insert it ourselves before Obsidian sees it
      ta.addEventListener('keydown', ev => {
        if (ev.key === '*' || ev.key === '_' || ev.key === '`' || ev.key === '~') {
          ev.stopPropagation();
          ev.preventDefault();
          const s = ta.selectionStart, e = ta.selectionEnd;
          ta.value = ta.value.slice(0, s) + ev.key + ta.value.slice(e);
          ta.setSelectionRange(s + 1, s + 1);
          ta.dispatchEvent(new Event('input'));
          return false;
        }
        if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'b' || ev.key === 'i')) {
          ev.stopPropagation(); ev.preventDefault();
          applyFmt(ev.key === 'b' ? '**' : '*');
        }
      }, true);
      // Belt-and-suspenders: also block on keypress phase
      ta.addEventListener('keypress', ev => {
        if (ev.key === '*' || ev.key === '_' || ev.key === '`' || ev.key === '~') {
          ev.stopPropagation();
          ev.preventDefault();
        }
      }, true);
    };

    const buildNoteField = () => {
      Array.from(nf.querySelectorAll('textarea, .ic-split-editor, .ic-fmt-bar')).forEach(el => el.remove());
      const fmtBar = nf.createDiv({ cls: 'ic-fmt-bar' });
      for (const btn of [{l:'B',w:'**',t:'Bold'},{l:'I',w:'*',t:'Italic'},{l:'S',w:'~~',t:'Strikethrough'},{l:'`',w:'`',t:'Code'}]) {
        const b = fmtBar.createEl('button', { text: btn.l, cls: 'ic-fmt-btn', title: btn.t, attr: { tabindex: '-1' } });
        b.type = 'button';
        b.onmousedown = ev => { ev.preventDefault(); applyFmt(btn.w); };
      }
      if (useSplit()) {
        const splitWrap = nf.createDiv({ cls: 'ic-split-editor' });
        const ta = splitWrap.createEl('textarea', { cls: 'ic-split-textarea', placeholder: 'Write your note here…' });
        ta.value = this.card.front || '';
        ta.oninput = () => { this.card.front = ta.value; this._touch(); refresh(); };
        blockKeys(ta);
        const prev = splitWrap.createDiv({ cls: 'ic-split-preview' });
        const refresh = () => { prev.empty(); MarkdownRenderer.render(this.plugin.app, ta.value || '*Start typing…*', prev, '', this.plugin); };
        refresh();
      } else {
        const ta = nf.createEl('textarea', { placeholder: 'Write your note, quote, or idea here…', cls: 'ic-note-textarea' });
        ta.value = this.card.front || '';
        ta.oninput = () => { this.card.front = ta.value; this._touch(); };
        blockKeys(ta);
        // Tab from title field jumps here
        ti.addEventListener('keydown', ev => {
          if (ev.key === 'Tab' && !ev.shiftKey) { ev.preventDefault(); ta.focus(); }
        });
      }
    };
    buildNoteField();

    // Category
    const projectCats = this.data.categories.filter(c => c.projectId === this.projectId && !c.parentId);
    const cf  = notePanel.createDiv('ic-field');
    cf.createEl('label', { text: 'Category' });
    const sel = cf.createEl('select');
    sel.createEl('option', { text: '— Uncategorized —', value: '' });
    for (const cat of projectCats) {
      const opt = sel.createEl('option', { text: cat.name, value: cat.id });
      if (cat.id === this.card.categoryId) opt.selected = true;
    }

    // Subcategory (includes subcategories now)
    const subF   = notePanel.createDiv('ic-field');
    subF.createEl('label', { text: 'Subcategory' });
    const subSel = subF.createEl('select');

    const refreshSubcats = catId => {
      subSel.empty();
      subSel.createEl('option', { text: '— None —', value: '' });
      if (!catId) { subF.style.display = 'none'; return; }
      const subs = this.data.categories.filter(c => c.parentId === catId);
      subs.forEach(s => {
        const o = subSel.createEl('option', { text: s.name, value: s.id });
        if (s.id === this.card.subcategoryId) o.selected = true;
      });
      subF.style.display = subs.length ? '' : 'none';
    };
    refreshSubcats(this.card.categoryId);

    if (this._defaultSubcatId) {
      this.card.subcategoryId = this._defaultSubcatId;
      refreshSubcats(this.card.categoryId);
      const opt = subSel.querySelector(`option[value="${this._defaultSubcatId}"]`);
      if (opt) opt.selected = true;
    }

    sel.onchange = () => {
      this.card.categoryId    = sel.value || null;
      this.card.subcategoryId = null;
      refreshSubcats(this.card.categoryId);
      this._touch();
    };
    subSel.onchange = () => { this.card.subcategoryId = subSel.value || null; this._touch(); };

    // Color
    const colF   = notePanel.createDiv('ic-field');
    colF.createEl('label', { text: 'Color' });
    const colRow = colF.createDiv({ cls: 'ic-color-picker' });
    for (const [key, col] of Object.entries(CARD_COLORS)) {
      const swatch = colRow.createDiv({
        cls: 'ic-color-swatch' + (this.card.color === key ? ' active' : ''),
        title: col.label,
      });
      swatch.style.background = key === 'default' ? 'var(--background-secondary)' : col.border;
      swatch.onclick = () => {
        this.card.color = key;
        this._touch();
        colRow.querySelectorAll('.ic-color-swatch').forEach(s => s.removeClass('active'));
        swatch.addClass('active');
      };
    }

    // Tags
    const tagF = notePanel.createDiv('ic-field');
    tagF.createEl('label', { text: 'Tags' });
    const tagContainer = tagF.createDiv('ic-tag-container');
    tagContainer.onclick = () => { const inp = tagContainer.querySelector('input'); if (inp) inp.focus(); };
    const suggestBox = tagF.createDiv({ cls: 'ic-tag-suggest' });
    suggestBox.style.display = 'none';

    const renderTags = () => {
      tagContainer.empty();
      (this.card.tags || []).forEach((tag, i) => {
        const chip = tagContainer.createSpan({ cls: 'ic-tag-chip' });
        chip.createSpan({ text: '#' + tag });
        const del = chip.createSpan({ text: '×', cls: 'ic-tag-del' });
        del.onclick = e => { e.stopPropagation(); this.card.tags.splice(i, 1); this._touch(); renderTags(); };
      });
      const tagInput = tagContainer.createEl('input', { type: 'text', placeholder: 'Add tag…', cls: 'ic-tag-input' });
      tagInput.onclick = e => e.stopPropagation();
      const existingTags = projectTags(this.data, this.projectId).filter(t => !(this.card.tags || []).includes(t));
      tagInput.oninput = () => {
        suggestBox.empty();
        const q = tagInput.value.trim().toLowerCase();
        if (!q) { suggestBox.style.display = 'none'; return; }
        const matches = existingTags.filter(t => t.toLowerCase().startsWith(q));
        if (!matches.length) { suggestBox.style.display = 'none'; return; }
        suggestBox.style.display = 'block';
        matches.slice(0, 6).forEach(t => {
          const opt = suggestBox.createDiv({ cls: 'ic-tag-suggest-item', text: '#' + t });
          opt.onmousedown = e => { e.preventDefault(); addTag(t); };
        });
      };
      const addTag = tag => {
        tag = tag.trim().replace(/^#+/, '').replace(/\s+/g, '-').toLowerCase();
        if (!tag) return;
        if (!this.card.tags) this.card.tags = [];
        if (!this.card.tags.includes(tag)) { this.card.tags.push(tag); this._touch(); }
        tagInput.value = '';
        suggestBox.style.display = 'none';
        renderTags();
      };
      tagInput.onkeydown = e => {
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput.value); }
        if (e.key === 'Escape') suggestBox.style.display = 'none';
      };
      tagInput.onblur = () => setTimeout(() => suggestBox.style.display = 'none', 150);
    };
    renderTags();

    // ══ SOURCE PANEL (academic mode) ═══════════════════
    if (this.plugin.settings.academicMode) {
      const buildSourcePanel = () => {
        srcPanel.empty();

        const parseRow = srcPanel.createDiv({ cls: 'ic-field ic-zotero-box' });
        parseRow.createEl('label', { text: 'Paste Zotero Citation to Auto-Fill' });
        const parseWrap = parseRow.createDiv({ attr: { style: 'display:flex;gap:6px;' } });
        const parseTa = parseWrap.createEl('input', { type: 'text', placeholder: 'Paste citation here…' });
        parseTa.style.flex = '1';
        parseWrap.createEl('button', { text: 'Parse', cls: 'ic-btn' }).onclick = () => {
          const filled = this.parseClipboardCitation(parseTa.value);
          if (filled) { parseTa.value = ''; buildSourcePanel(); }
          else new Notice('Could not parse — please fill fields manually.');
        };
        parseWrap.createEl('button', { text: 'Clear All', cls: 'ic-btn danger' }).onclick = () => {
          for (const key of ['author','title','sourceTitle','publisher','place','year','edition','volume','issue','pages','url','accessed'])
            this.card[key] = '';
          this._touch();
          buildSourcePanel();
        };

        const fullFields = [
          { key: 'author',      label: 'Author(s)',        placeholder: 'Last, First and Last, First' },
          { key: 'title',       label: 'Title',            placeholder: 'Title of article, chapter, or book' },
          { key: 'sourceTitle', label: 'Journal / Series', placeholder: 'Journal name or book series' },
          { key: 'publisher',   label: 'Publisher',        placeholder: 'Publisher name' },
          { key: 'place',       label: 'Place',            placeholder: 'City, State' },
          { key: 'year',        label: 'Year',             placeholder: new Date().getFullYear().toString() },
        ];
        for (const f of fullFields) {
          const row = srcPanel.createDiv({ cls: 'ic-field ic-source-field' });
          row.createEl('label', { text: f.label });
          const inp = row.createEl('input', { type: 'text', placeholder: f.placeholder });
          if (f.key === 'year') inp.style.maxWidth = '120px';
          inp.value = this.card[f.key] || '';
          inp.oninput = () => { this.card[f.key] = inp.value; this._touch(); };
        }

        // Compact fields — only show when they have data (avoids confusing placeholder values)
        const compactFields = [
          { key: 'edition', label: 'Edition', placeholder: '2nd',   w: '18%' },
          { key: 'volume',  label: 'Vol.',    placeholder: '12',    w: '14%' },
          { key: 'issue',   label: 'Issue',   placeholder: '3',     w: '14%' },
          { key: 'pages',   label: 'Pages',   placeholder: '45–67', w: '30%' },
        ];
        const fieldsToShow = compactFields.filter(f => this.card[f.key]);
        if (fieldsToShow.length) {
          const compactRow = srcPanel.createDiv({ cls: 'ic-source-compact-row' });
          for (const f of fieldsToShow) {
            const cell = compactRow.createDiv({ attr: { style: 'width:' + f.w + ';flex-shrink:0;' } });
            cell.createEl('label', { text: f.label, attr: { style: 'font-size:0.68rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);display:block;margin-bottom:3px;' } });
            const inp = cell.createEl('input', { type: 'text', placeholder: f.placeholder, attr: { style: 'width:100%;box-sizing:border-box;' } });
            inp.value = this.card[f.key] || '';
            inp.oninput = () => { this.card[f.key] = inp.value; this._touch(); };
          }
        }

        // URL field — full width, always shown in source panel
        const urlRow = srcPanel.createDiv({ cls: 'ic-field ic-source-field' });
        urlRow.createEl('label', { text: 'URL' });
        const urlInp = urlRow.createEl('input', { type: 'url', placeholder: 'https://...' });
        urlInp.value = this.card.url || '';
        urlInp.oninput = () => { this.card.url = urlInp.value.trim(); this._touch(); };

        // Accessed field — shown only when URL is present or accessed is already set
        const accessedRow = srcPanel.createDiv({ cls: 'ic-field ic-source-field' });
        accessedRow.createEl('label', { text: 'Accessed' });
        const accessedInp = accessedRow.createEl('input', { type: 'text', placeholder: 'e.g. June 9, 2026' });
        accessedInp.value = this.card.accessed || '';
        accessedInp.oninput = () => { this.card.accessed = accessedInp.value.trim(); this._touch(); };
        const toggleAccessed = () => {
          accessedRow.style.display = (this.card.url || this.card.accessed) ? '' : 'none';
        };
        toggleAccessed();
        urlInp.addEventListener('input', toggleAccessed);
      };
      buildSourcePanel();
    }

    // ── Footer ──
    const footer = inner.createDiv('ic-modal-footer');
    footer.style.justifyContent = 'space-between';

    if (!this.isNew) {
      const delBtn = footer.createEl('button', { text: '🗑 Delete', cls: 'ic-btn danger' });
      delBtn.onclick = async () => {
        const label = (this.card.cardTitle || this.card.front?.slice(0, 40) || 'this card').replace(/\n/g, ' ').trim();
        if (!confirm(`Delete "${label}"?\nThis cannot be undone.`)) return;
        const data = await loadData(this.plugin);
        data.cards = data.cards.filter(c => c.id !== this.card.id);
        await saveData(this.plugin, data);
        this.close();
        if (this.onSave) this.onSave();
      };
    } else {
      footer.createDiv(); // spacer so Close stays right
    }

    footer.createEl('button', { text: 'Close', cls: 'ic-btn primary' }).onclick = async () => {
      await this._persist();
      this.close();
    };

    focusWhenReady('input,textarea', inner);
  }

  parseClipboardCitation(text) {
    const t = text.trim();
    if (!t) return false;

    // Clear all citation fields first so no phantom data from previous card
    for (const key of ['author','title','sourceTitle','publisher','place','year','edition','volume','issue','pages','url','accessed']) {
      this.card[key] = '';
    }

    let filled = false;
    const set = (key, val) => {
      if (!val) return;
      val = String(val).trim().replace(/^[,;\s]+/, '');
      // Strip trailing commas/semicolons/spaces; strip trailing period only if NOT preceded by a single capital letter (initial)
      val = val.replace(/[,;\s]+$/, '').replace(/(?<![A-Z])\.+$/, '').trim();
      if (!val) return;
      this.card[key] = val;
      filled = true;
    };

    // Strip parenthetical full names e.g. "(Raymond Edward)"
    const tClean = t.replace(/\([A-Z][a-z]+(\s[A-Z][a-z]+)+\)/g, '').replace(/\s+/g, ' ').trim();

    // ── Year ── prefer year in parens
    const yearM = t.match(/\((\d{4})\)/) || t.match(/\b(1[5-9]\d{2}|20[012]\d)\b/);
    set('year', yearM ? yearM[1] : null);

    // ── Pages ──
    const pageColon = t.match(/\(\d{4}\):\s*([\d\u2013\u2014\-]+)/);
    const pagePP    = t.match(/\bpp?\.\s*([\d\u2013\u2014\-]+)/i);
    set('pages', (pageColon || pagePP || [])[1]);

    // ── Edition ── "3rd ed." or "3d ed."
    const edM = t.match(/\b(\d+(?:st|nd|rd|th)(?:\s+ed\.)?|[Tt]hird|[Ss]econd|[Ff]irst)\s+ed\./i);
    if (edM) set('edition', edM[1]);

    // ── Title in smart or straight quotes ──
    const titleQ = t.match(/[\u201c"]([^\u201d"\u201c"]{3,})[\u201d"]/);
    if (titleQ) {
      // Strip trailing site name suffixes common in web citations:
      // "Article Title | Site Name" → "Article Title"
      // "Article Title." (trailing period from closing quote) → "Article Title"
      let tq = titleQ[1]
        .replace(/\s*\|\s*[^|]+$/, '')          // strip "| Site Name" suffix
        .replace(/\s*\*\s*[^*]+\*.*$/, '')       // strip "* Site * by Author" suffix
        .replace(/^[\s\-–—\u201c\u201d"]+/, '')  // strip leading dashes, spaces, stray quotes
        .replace(/\.+$/, '')                     // strip trailing periods
        .trim();
      set('title', tq);
    }

    // ── Author ──
    // Detect no-author web citations: "Title. (Year). Site. URL" or "Title – Site. (Year). URL"
    // In these cases skip author parsing entirely; title is already set from titleQ or set it now
    const hasUrl = /https?:\/\//.test(t);
    const noAuthorApaM = !this.card.title && hasUrl
      ? t.match(/^([^([\n]{5,}?)\.\s*\(\d{4}\)/)
      : null;
    if (noAuthorApaM) set('title', noAuthorApaM[1].replace(/\s*[–—-]\s*[^–—\n]+$/, '').trim());
    // For APA no-author web: "Title. (Year). SiteName. URL" — site name goes to publisher
    if (noAuthorApaM && !this.card.publisher) {
      const webSiteM = t.match(/\(\d{4}\)\.\s+([A-Z][^.\n]+?)\.\s+https?:\/\//);
      if (webSiteM) set('publisher', webSiteM[1].trim());
    }
    const hasQuote = /[\u201c"]/.test(t);
    // APA: "Last, I. I. (Year)." — strip the year paren from tClean for author parsing
    // Strip year paren and trailing role indicators (eds., Eds., editors) before author parsing
    // Strip year paren and role indicators (eds., Eds., editors) plus everything following them
    // (title, publisher etc. always come after the role indicator, so safe to truncate there)
    // Also strip ". In Title..." suffix (APA edited volume) so author loop terminates cleanly
    const tCleanNoYear = tClean
      .replace(/\s*\(\d{4}\)\.?/, '')
      .replace(/[,.]?\s*\b(?:editors?|[Ee]ds?\.?)[.,\s].*/, '')
      .replace(/\.\s+In\s+[A-Z].*$/, '')
      .trim();
    if (!noAuthorApaM && hasQuote) {
      // Journal/chapter: everything before the opening quote
      const authorM = tClean.match(/^(.+?)(?=,?\s*[\u201c"])/);
      if (authorM) set('author', authorM[1].trim().replace(/\.\s*\d{4}\.?\s*$/, '').trim());
    } else if (!noAuthorApaM) {
      // Book with et al.
      const etAlM = tCleanNoYear.match(/^(.+?\bet al\.)/);
      if (etAlM) {
        set('author', etAlM[1].trim());
      } else {
        const beforeParen = tCleanNoYear.replace(/\s*\([^)]*\).*$/, '').trim();
        // Split on ", and " or ", & " (APA uses ampersand)
        const andSplit = beforeParen.split(/,\s+(?:and|&)\s+/i);
        if (andSplit.length >= 2) {
          const lastChunk = andSplit[andSplit.length - 1];
          const earlyAuthors = andSplit.slice(0, -1).join(', and ');
          const lastChunkParts = lastChunk.split(',');
          const lastAuthorSegs = [];
          for (const seg of lastChunkParts) {
            const s = seg.trim();
            // Stop at sentence boundary — period followed by space+capital means title is starting
            // Exception 1: pure initials like "F. W." are a name segment, not a sentence
            const isPureInitials = /^(?:[A-Z]\.\s*)+$/.test(s);
            // Exception 2: initials followed specifically by 'In Title' (APA style: "F. W. In A ...")
            const initialsBeforeIn = !isPureInitials && s.match(/^((?:[A-Z]\.\s*)+)[Ii]n\s+[A-Z]/);
            // Exception 3: short name-like segment (≤4 words) — could be "F. Wilbur Gingrich"
            const isShortName = s.split(' ').length <= 4 && s.length < 30 && /^[A-Z]/.test(s);
            if (!isPureInitials && !initialsBeforeIn && !isShortName && /\.\s+[A-Z]/.test(s)) break;
            if (initialsBeforeIn) {
              if (lastAuthorSegs.length < 2) lastAuthorSegs.push(initialsBeforeIn[1].trim());
              break;
            }
            const looksName = /^[A-Z]/.test(s) && s.split(' ').length <= 4 && s.length < 35;
            if (looksName && lastAuthorSegs.length < 2) lastAuthorSegs.push(s);
            else break;
          }
          const lastAuthor = lastAuthorSegs.join(', ');
          if (lastAuthor) {
            // Last chunk had a parseable name segment
            set('author', (earlyAuthors + ', and ' + lastAuthor).trim());
            if (!this.card.title) {
              let titlePart = lastChunk.slice(lastAuthor.length).replace(/^[,\s]+/, '').replace(/^[Ii]n\s+/, '').replace(/\s*\(.*$/, '').trim();
              // Stop at first sentence boundary (e.g. "Title. Place: Publisher")
              const titleBoundary = titlePart.match(/^([^.]+(?:\.[^.A-Z][^.]*)*?)\.\s+[A-Z][a-z]/);
              if (titleBoundary) titlePart = titleBoundary[1].trim();
              // Strip trailing year (Chicago W comma-style: "Title, 2000")
              titlePart = titlePart.replace(/,\s*\d{4}\.?\s*$/, '').trim();
              if (titlePart) set('title', titlePart);
            }
          } else {
            // Last chunk is entirely a name+title run: "F. Wilbur Gingrich. Title..."
            // or "F. Wilbur Gingrich. in Title..." (SBL lowercase 'in')
            // or "F. Wilbur Gingrich, Title, Year" (Chicago W comma style)
            // Match name structure including middle initials: "F. Wilbur Gingrich", "Charles A. Briggs"
            const sentBoundary = lastChunk.match(/^([A-Z](?:[a-z]+\.?|\.)(?:\s+[A-Z](?:[a-z]+\.?|\.))*(?:\s+[A-Z][a-z]+)?)\.\s+(?:[Ii]n\s+)?([A-Z].*)/);
            const commaBoundary = !sentBoundary && lastChunk.match(/^([A-Z](?:[a-z]+\.?|\.)(?:\s+[A-Z](?:[a-z]+\.?|\.))*(?:\s+[A-Z][a-z]+)?),\s+([A-Z].*)/);
            const boundary = sentBoundary || commaBoundary;
            if (boundary) {
              const lastNamePart = boundary[1].trim();
              let titlePart = boundary[2].trim().replace(/\s*\(.*$/, '');
              // Stop title at next sentence boundary
              const titleStop = titlePart.match(/^(.+?)\.\s+[A-Z][a-z]/);
              if (titleStop) titlePart = titleStop[1].trim();
              // Strip trailing year (comma style: "Title, 2000")
              titlePart = titlePart.replace(/,\s*\d{4}\.?\s*$/, '').trim();
              set('author', (earlyAuthors + ', and ' + lastNamePart).trim());
              if (!this.card.title) set('title', titlePart);
            } else {
              set('author', earlyAuthors.trim());
              if (!this.card.title) set('title', lastChunk.replace(/^[Ii]n\s+/, '').replace(/\s*\(.*$/, '').trim());
            }
          }
        } else {
          // Chicago W style: "D. A. Carson, Title" — initials-first, no inversion
          const chicagoWM = tCleanNoYear.match(/^((?:[A-Z]\.\s*)+[A-Z][a-zA-Z\-]+)(?=,\s+[A-Z][a-z])/);
          if (chicagoWM) {
            set('author', chicagoWM[1]);
          } else {
            // "Last, I. I." (Carson, D. A.) and "Last, First I." (Lincoln, Andrew T.)
            const authorInitialM = tCleanNoYear.match(/^([A-Z][a-zA-Z\-]+,\s+(?:[A-Z][a-z]+\s+)?(?:[A-Z]\.\s*)+)(?=[A-Z][a-z])/);
            if (authorInitialM) {
              set('author', authorInitialM[1]);
            } else {
              const parts2 = tCleanNoYear.split(',');
              const secondSeg = parts2.length >= 2 ? parts2[1].trim() : '';
              const looksLikeName = secondSeg && secondSeg.split(' ').length <= 2 && secondSeg.length < 25 && /^[A-Z]/.test(secondSeg) && !/\band\b/.test(secondSeg);
              if (looksLikeName) set('author', (parts2[0] + ', ' + secondSeg).trim());
              else set('author', parts2[0].trim());
            }
          }
        }
      }
    }

    // ── "in Book Title" patterns (dictionary/encyclopedia/edited volume entries) ──
    // Matches: ", in Title, 3rd ed." or ", in Title, ed. Editor" or ", in Title (Publisher"
    // If an article title is already set, the book goes to sourceTitle; otherwise it IS the title.
    const inAnyM = t.match(/[,\u201d"]\s+in\s+([^,]+?)(?:\s*,\s*(?:\d+(?:st|nd|rd|th)\s+)?ed[^a-z]|\s*,\s*ed\.|\s*\()/i);
    if (inAnyM) {
      if (this.card.title) set('sourceTitle', inAnyM[1].trim());
      else set('title', inAnyM[1].trim());
    }
    // Chicago/SBL: "eds. in The Lexham Bible Dictionary." — no comma/quote before "in"
    if (!this.card.sourceTitle && !this.card.title) {
      const edsInM = t.match(/\bEds?\.?\s+in\s+([^.(]+)/i);
      if (edsInM) set('title', edsInM[1].trim());
    }
    // APA edited volume: "(2016). In The Lexham Bible Dictionary. Publisher."
    if (!this.card.sourceTitle && !this.card.title) {
      const apaInM = t.match(/\(\d{4}\)\.\s+In\s+([^.]+)\./);
      if (apaInM) set('title', apaInM[1].trim());
    }
    // MLA: "Eds., The Lexham Bible Dictionary, 2016" — Eds. followed by comma then title
    if (!this.card.sourceTitle && !this.card.title) {
      const mlaEdsM = t.match(/\bEds?\.,?\s+([^,]+),\s*\d{4}/i);
      if (mlaEdsM) set('title', mlaEdsM[1].trim());
    }
    // Plain Chicago/SBL: "eds. The Lexham Bible Dictionary." or "editors. Title, Publisher"
    // Catches edited volumes where the title follows eds. with no "in"
    if (!this.card.title) {
      const edsTitleM = t.match(/\b(?:editors?|[Ee]ds?\.?)[.,]?\s+([A-Z][^.]+?)(?=\s*[.,])/);
      if (edsTitleM) set('title', edsTitleM[1].trim());
    }

    // ── Journal after closing quote ──
    // Handles: "Title," Journal Name 59, no. 2 (1966)
    // and:     "Title," Journal Name 59.2 (1966)
    // and:     "Title," Journal Name 59 (1966)
    // Web article: "Title," SiteName, DD Mon. YYYY or "Title." SiteName. Month YYYY
    // Stop at comma/period followed by date or month name
    if (!this.card.sourceTitle) {
      const webSrcM = t.match(/[\u201d"]\.?\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)(?=[.,]\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{4}|\d{1,2}\s))/);
      if (webSrcM) set('sourceTitle', webSrcM[1].trim());
    }
    if (!this.card.sourceTitle) {
      const jrnlM = t.match(/[\u201d"],?\s+([A-Z][A-Za-z\s\.]+?)\s+\d+(?:[,\s]+no\.)?\s*[\d.,\s]*[\s\.\(]/);
      if (jrnlM) set('sourceTitle', jrnlM[1].trim());
    }

    // ── Volume/issue ──
    // "59, no. 2" or "19, no. 4" — Chicago/SBL journal style
    const volNo   = t.match(/\b(\d+),\s*no\.\s*(\d+)/i);
    const volDot  = t.match(/\b(\d+)\.(\d+)\s*\(/);
    const volJrnl = t.match(/[A-Za-z]\s+(\d+)\s+\(\d{4}\)/);
    const volWord = t.match(/vol\.\s*(\d+)/i);
    const issWord = t.match(/no\.\s*(\d+)/i);
    if (volNo)          { set('volume', volNo[1]);   set('issue', volNo[2]); }
    else if (volDot)    { set('volume', volDot[1]);  set('issue', volDot[2]); }
    else if (volJrnl)   { set('volume', volJrnl[1]); }
    else if (volWord)   { set('volume', volWord[1]); if (issWord) set('issue', issWord[1]); }

    // ── "edited by" → sourceTitle (Chicago/MLA chapter-in-edited-volume) ──
    // Handles: '"Title." In Book, edited by ...' and '"Title." Book, edited by ...'
    if (!this.card.sourceTitle) {
      const editedByM = t.match(/[\u201d"]\.?\s+(?:[Ii]n\s+)?([A-Z][^,]+?),\s*edited\s+by/i);
      if (editedByM) set('sourceTitle', editedByM[1].trim());
    }

    // ── APA chapter: (Year). ArticleTitle. In Editors (Eds.), BookTitle. Publisher ──
    if (!this.card.title) {
      const apaTitleM = t.match(/\(\d{4}\)\.\s+([^.]+)\.\s+In\s+/);
      if (apaTitleM) set('title', apaTitleM[1].trim());
    }
    if (!this.card.sourceTitle) {
      const apaBookM = t.match(/\(Eds?\.\),\s+([^.]+)\./);
      if (apaBookM) set('sourceTitle', apaBookM[1].trim());
    }

    // ── MLA plain (no quotes, no eds.): "FirstName LastName, Title, Year" ──
    // Set title early so publisher fallback guard can catch it
    if (!this.card.title && !this.card.sourceTitle) {
      const mlaPlainM = t.match(/^[A-Z][a-z]+\s+[A-Z][a-z]+,\s+([^,]+),\s+\d{4}/);
      if (mlaPlainM) set('title', mlaPlainM[1].trim());
    }

    // ── Publisher/place ──
    const pubParen = t.match(/\(([A-Z][^:)]+?)\s*:\s*([^,)]+(?:;\s*[^,)]+)*),\s*\d{4}\)/);
    if (pubParen) { set('place', pubParen[1].trim()); set('publisher', pubParen[2].trim()); }
    else {
      // Chicago W paren: "(Place; Place: Pub; Pub, Year)" — already caught above by pubParen
      // APA: "Last, I. (Year). Title (ed.). Publisher." — no place, no trailing year
      const apaPubM = t.match(/\(\d{4}\)\.\s+.+\.\s+([A-Z][^()\n]+?)\.?\s*$/);
      if (apaPubM) { set('publisher', apaPubM[1].trim()); }
      else {
        const pubOnly = t.match(/\(([A-Z][^,:)]+),\s*\d{4}\)/);
        if (pubOnly) set('publisher', pubOnly[1].trim());
        else {
          // Period-anchored place: Pub, Year (allows dots in publisher names like W.B.)
          const pubPlain = t.match(/\.\s+([A-Z][^.:]+(?:;\s*[A-Z][^.:]+)?)\s*:\s*([A-Z].+?),\s*\d{4}/);
          if (pubPlain) { set('place', pubPlain[1].trim()); set('publisher', pubPlain[2].trim()); }
          else {
            // MLA: "Title. Publisher; W.B. Publisher, Year" — no place
            // Find the last sentence-boundary period (lowercase then '. Cap') before year
            const mlaYearIdx = t.search(/,\s*\d{4}(?:\.|$)/);
            if (mlaYearIdx !== -1) {
              const beforeYear = t.slice(0, mlaYearIdx);
              // Exclude 'et al.' from sentence boundary matches
              const sentenceDots = [...beforeYear.matchAll(/(?<!et al)\b[a-z]\.\s+(?=[A-Z])/g)];
              if (sentenceDots.length > 0) {
                // Period-delimited: grab everything after last sentence-boundary dot
                const lastSentenceDot = sentenceDots[sentenceDots.length - 1];
                const pubCandidate = beforeYear.slice(lastSentenceDot.index + 2).trim();
                if (/^[A-Z]/.test(pubCandidate)) set('publisher', pubCandidate);
              } else {
                // Comma-delimited (MLA style): grab last comma-segment before year
                // e.g. "Title, 3rd ed., University of Chicago Press, 2000"
                // Guard: skip if it looks like a long title (many words, no publisher keywords)
                const commaSegs = beforeYear.split(',');
                const lastSeg = commaSegs[commaSegs.length - 1].trim();
                const looksLikePublisher = /^[A-Z]/.test(lastSeg) && lastSeg.length > 3 && lastSeg.split(' ').length <= 6;
                const notAlreadyTitle = (!this.card.title || lastSeg !== this.card.title)
                                     && (!this.card.sourceTitle || lastSeg !== this.card.sourceTitle);
                if (looksLikePublisher && notAlreadyTitle) set('publisher', lastSeg);
              }
            }
          }
        }
      }
    }

    // ── Clean up role-indicator bleed from title field ──
    // Handles: title="editors", title="eds", title="W.. In The Lexham Bible Dictionary. Lexham Press"
    // Also: title="Wendy Widder in The Lexham Bible Dictionary" (last-author bleed from eds. in)
    if (this.card.title) {
      this.card.title = this.card.title
        .replace(/^[Ee]ditors?\s*/i, '')              // bare "editors" or "editor"
        .replace(/^[Ee]ds?\.?\s+[Ii]n\s+/i, '')       // "eds. in Title" → remove prefix
        .replace(/^[Ee]ds?\.?\s*/i, '')                // bare "eds" or "eds."
        .replace(/^[A-Z]\.\.\s+[Ii]n\s+/i, '')        // "W.. In Title" → remove initial bleed
        .replace(/\.\s+[A-Z][^.]+Press[^.]*$/, '')    // strip trailing ". Publisher Press"
        // "Wendy Widder in The Lexham Bible Dictionary" → strip leading name+in
        .replace(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\s+in\s+/i, '')
        .trim();
      // If title duplicates sourceTitle, clear it — but not for web citations
      if (this.card.title && this.card.sourceTitle && this.card.title === this.card.sourceTitle && !hasUrl) {
        delete this.card.title;
      }
      if (!this.card.title) delete this.card.title;
    }

    // ── Kindle citation format ──
    // "Last, First. Title (p. 117). Publisher. Kindle Edition."
    // Must run before fallback title block to prevent author/title misparse
    if (t.match(/Kindle Edition/i)) {
      const kindleAuthorM = tClean.match(/^([A-Z][a-zA-Z\-]+,\s+[A-Z][a-zA-Z\-]+)\./);
      if (kindleAuthorM) set('author', kindleAuthorM[1].trim());
      const kindleTitleM = tClean.match(/^[A-Z][a-zA-Z\-]+,\s+[A-Z][a-zA-Z\-]+\.\s+(.+?)\s*\(/);
      if (kindleTitleM) set('title', kindleTitleM[1].trim());
      const kindlePubM = tClean.match(/\(p+\.\s*[\d,\-]+\)\.\s+([^.]+)\./);
      if (kindlePubM) set('publisher', kindlePubM[1].trim());
      const kindlePagesM = t.match(/\(pp?\.\s*([\d,\-]+)\)/);
      if (kindlePagesM) set('pages', kindlePagesM[1].trim());
    }

    // ── Fallback title for books without quoted titles ──
    // Must run before series detection, which depends on this.card.title
    if (!this.card.title) {
      const afterAuthor = this.card.author
        ? tCleanNoYear.slice(tCleanNoYear.indexOf(this.card.author.split(',')[0]) + this.card.author.length).replace(/^[.,\s]+/, '')
        : tCleanNoYear;
      // Stop at period, paren, or comma (Chicago W uses comma between title and series)
      const bookTitleM = afterAuthor.match(/^([^.,(]+?)(?:[.,]|(?:\s*,\s*(?:vol\.|[A-Z][A-Za-z\s]{4,40})\s*\()|\s*\()/i);
      if (bookTitleM) set('title', bookTitleM[1].trim().replace(/,?\s*vol\..*$/i,'').trim());
    }

    // ── Series ──
    if (!this.card.sourceTitle) {
      const seriesOf = t.match(/vol\.\s*\d+\s+of\s+([^(,]+)/i);
      if (seriesOf) set('sourceTitle', seriesOf[1].trim());
    }
    // Comma-separated series before paren publisher (UBS style or Chicago W):
    // "Title, Series Name (" or "Title, Series Name. ("
    if (!this.card.sourceTitle && this.card.title) {
      const seriesTrail = t.match(new RegExp(
        this.card.title.slice(0,20).replace(/[.*+?^${}()|[\]\\]/g,'\\$&') +
        ',\\s+([^(,;]{5,60}?)\\.?\\s+\\('
      ));
      // Exclude if it looks like a publisher (contains Press, Publishers, Eerdmans-style words)
      if (seriesTrail && !/Press|Publisher|Eerdmans|Zondervan|Baker|Fortress|Brill|Mohr/i.test(seriesTrail[1])) {
        set('sourceTitle', seriesTrail[1].trim());
      }
    }
    // Bare period-delimited series: "Title. Series Name. Place: Publisher, Year"
    if (!this.card.sourceTitle && this.card.title) {
      const titleStart = t.indexOf(this.card.title.slice(0, 15));
      if (titleStart !== -1) {
        const afterTitle = t.slice(titleStart + this.card.title.length);
        const seriesBare = afterTitle.match(/^[.,]\s+([A-Z][^.;]{4,60})\.\s+[A-Z(]/);
        if (seriesBare && !/Press|Publisher|Eerdmans|Zondervan|Baker|Fortress|Brill|Mohr/i.test(seriesBare[1])) {
          set('sourceTitle', seriesBare[1].trim());
        }
      }
    }

    const thesisM = t.match(/\((?:PhD|MA|ThD|MTh|DMin)[^,]*,\s*([^,)]+)/i);
    if (thesisM) set('publisher', thesisM[1].trim());

    // ── URL ──
    const urlM = t.match(/https?:\/\/[^\s,]+/);
    if (urlM) set('url', urlM[0].replace(/[.,]$/, '')); // strip trailing punctuation

    // ── Accessed date ──
    const accessedM = t.match(/[Aa]ccessed\s+(\d{1,2}\s+\w+\.?\s+\d{4}|\w+\s+\d{1,2},\s+\d{4})/);
    if (accessedM) set('accessed', accessedM[1].trim());

    return filled;
  }
  onClose() { this.contentEl.empty(); }
}

// ═════════════════════════════════════════════
//  EXPORT MODAL
// ═════════════════════════════════════════════
class ExportModal extends Modal {
  constructor(plugin, data, projectId, singleCard = null) {
    super(plugin.app);
    this.plugin     = plugin;
    this.data       = data;
    this.projectId  = projectId;
    this.folderPath = 'Index Cards';
    this.whichCards = 'all';
    this.singleCard = singleCard;
    this.selectedIds = new Set();
  }

  onOpen() {
    this.modalEl.addClass('ic-modal-narrow');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: '↑ Export Cards' });

    // Destination folder
    const ff = contentEl.createDiv('ic-field');
    ff.createEl('label', { text: 'Destination Folder' });
    const fr = ff.createDiv({ attr: { style: 'display:flex;gap:8px;align-items:center' } });
    const fd = fr.createEl('input', { type: 'text', value: this.folderPath, placeholder: 'e.g. Research/Cards' });
    fd.style.flex   = '1';
    fd.oninput      = () => { this.folderPath = fd.value.trim(); };
    fr.createEl('button', { text: '📁 Browse', cls: 'ic-btn' })
      .onclick = () => new FolderPickerModal(this.app, c => { this.folderPath = c || 'Index Cards'; fd.value = this.folderPath; }).open();

    if (this.singleCard) {
      const sf = contentEl.createDiv('ic-field');
      sf.style.marginTop = '10px';
      sf.createEl('label', { text: 'Exporting' });
      const nameEl = sf.createDiv({ cls: 'ic-export-single-label' });
      nameEl.setText(this.singleCard.cardTitle || this.singleCard.front.slice(0, 60) || '(untitled)');
    } else {
      const wf = contentEl.createDiv('ic-field');
      wf.style.marginTop = '10px';
      wf.createEl('label', { text: 'Which cards?' });
      const sel = wf.createEl('select');
      sel.createEl('option', { text: 'All cards in this project', value: 'all' });
      sel.createEl('option', { text: 'Uncategorized only',        value: 'none' });
      sel.createEl('option', { text: 'Pick individual cards…',    value: 'pick' });
      this.data.categories
        .filter(c => c.projectId === this.projectId && !c.parentId)
        .forEach(cat => sel.createEl('option', { text: 'Category: ' + cat.name, value: cat.id }));
      sel.onchange = () => { this.whichCards = sel.value; this._renderPickList(pickWrap); };

      const pickWrap = contentEl.createDiv('ic-export-pick-wrap');
      pickWrap.style.display = 'none';
      this._renderPickList = (wrap) => {
        wrap.empty();
        if (this.whichCards !== 'pick') { wrap.style.display = 'none'; return; }
        wrap.style.display = 'block';
        const projectCards = this.data.cards.filter(c => c.projectId === this.projectId);
        if (!projectCards.length) { wrap.createEl('p', { text: 'No cards in this project.', cls: 'ic-muted' }); return; }
        const ctrl = wrap.createDiv({ attr: { style: 'display:flex;gap:12px;margin-bottom:6px;font-size:0.8rem;' } });
        const selAll  = ctrl.createEl('a', { text: 'Select all',  href: '#' });
        const selNone = ctrl.createEl('a', { text: 'Select none', href: '#' });
        selAll.onclick  = e => { e.preventDefault(); checkboxes.forEach(([cb, id]) => { cb.checked = true;  this.selectedIds.add(id); }); };
        selNone.onclick = e => { e.preventDefault(); checkboxes.forEach(([cb, id]) => { cb.checked = false; this.selectedIds.delete(id); }); };
        const list = wrap.createDiv('ic-export-pick-list');
        const checkboxes = [];
        const cats = this.data.categories.filter(c => c.projectId === this.projectId && !c.parentId);
        const uncategorized = projectCards.filter(c => !c.categoryId);
        const renderGroup = (label, cards) => {
          if (!cards.length) return;
          list.createDiv({ cls: 'ic-export-pick-header', text: label });
          for (const card of cards) {
            const row = list.createDiv('ic-export-pick-row');
            const cb  = row.createEl('input', { type: 'checkbox' });
            cb.checked = true;
            this.selectedIds.add(card.id);
            cb.onchange = () => cb.checked ? this.selectedIds.add(card.id) : this.selectedIds.delete(card.id);
            const lbl = row.createEl('label');
            lbl.setText(card.cardTitle || card.front.slice(0, 60) || '(untitled)');
            checkboxes.push([cb, card.id]);
          }
        };
        cats.forEach(cat => renderGroup(cat.name, projectCards.filter(c => c.categoryId === cat.id)));
        renderGroup('Uncategorized', uncategorized);
      };
    }

    const footer = contentEl.createDiv('ic-modal-footer');
    footer.style.padding = '16px 0 0';
    footer.createEl('button', { text: 'Cancel', cls: 'ic-btn' }).onclick = () => this.close();
    footer.createEl('button', { text: 'Export', cls: 'ic-btn primary' }).onclick = () => this.doExport();
  }

  async doExport() {
    let cards;
    if (this.singleCard) {
      cards = [this.singleCard];
    } else if (this.whichCards === 'pick') {
      cards = this.data.cards.filter(c => this.selectedIds.has(c.id));
    } else {
      cards = this.data.cards.filter(c => c.projectId === this.projectId);
      if (this.whichCards === 'none')     cards = cards.filter(c => !c.categoryId);
      else if (this.whichCards !== 'all') cards = cards.filter(c => c.categoryId === this.whichCards);
    }
    if (!cards.length) { new Notice('No cards to export.'); return; }

    const folder = this.folderPath.replace(/\/$/, '') || 'Index Cards';
    if (!this.app.vault.getAbstractFileByPath(folder))
      await this.app.vault.createFolder(folder);

    const fmt = this.plugin.settings.filenameFormat;
    let created = 0, updated = 0, skipped = 0;

    for (const card of cards) {
      const catName  = card.categoryId
        ? (this.data.categories.find(c => c.id === card.categoryId) || {}).name || 'Uncategorized'
        : 'Uncategorized';
      const rawTitle = card.cardTitle
        ? card.cardTitle
        : (card.front || '').slice(0, 40).replace(/\n/g, ' ').trim() || 'untitled';
      // Append short ID for untitled cards to prevent filename collisions
      const titleSlug = card.cardTitle
        ? slugify(rawTitle, fmt)
        : slugify(rawTitle, fmt) + '-' + card.id.slice(-5);
      const filename = `${folder}/${titleSlug}.md`;
      const tags     = (card.tags || []).map(t => '  - ' + t).join('\n');
      const srcFields = [
        ['author',    card.author],
        ['title',     card.title],
        ['source',    card.sourceTitle],
        ['publisher', card.publisher],
        ['place',     card.place],
        ['year',      card.year],
        ['edition',   card.edition],
        ['volume',    card.volume],
        ['issue',     card.issue],
        ['pages',     card.pages],
        ['url',       card.url],
        ['accessed',  card.accessed],
      ].filter(([, v]) => v && v.trim()).map(([k, v]) => `${k}: "${v.trim()}"`).join('\n');
      const fm = [
        '---',
        `category: "${catName}"`,
        tags ? `tags:\n${tags}` : 'tags: []',
        `color: "${card.color || 'default'}"`,
        srcFields || null,
        `created: "${formatTimestamp(card.createdAt, this.plugin.settings.timestampFormat || 'local')}"`,
        `updated: "${formatTimestamp(card.updatedAt, this.plugin.settings.timestampFormat || 'local')}"`,
        `index-card-id: "${card.id}"`,
        '---',
        '',
        card.cardTitle ? `# ${card.cardTitle}\n` : '',
        card.front || '',
        '',
      ].filter(l => l !== null).join('\n');

      try {
        const ex = this.app.vault.getAbstractFileByPath(filename);
        if (ex) { await this.app.vault.modify(ex, fm); updated++; }
        else    { await this.app.vault.create(filename, fm); created++; }
      } catch { skipped++; }
    }

    this.close();
    const parts = [];
    if (created) parts.push(`${created} new`);
    if (updated) parts.push(`${updated} updated`);
    const summary = parts.length ? parts.join(', ') : '0';
    new Notice(`Export complete — ${summary} card${(created+updated) !== 1 ? 's' : ''} in "${folder}".${skipped ? ' ' + skipped + ' skipped.' : ''}`);
  }

  onClose() { this.contentEl.empty(); }
}

// ═════════════════════════════════════════════
//  MOVE CATEGORY MODAL
// ═════════════════════════════════════════════
class MoveCategoryModal extends Modal {
  constructor(plugin, card, data, projectId, onMove) {
    super(plugin.app);
    this.plugin    = plugin; this.card = card; this.data = data;
    this.projectId = projectId; this.onMove = onMove;
  }

  onOpen() {
    this.modalEl.addClass('ic-modal-narrow');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Move Card to Category' });

    const list = contentEl.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:6px;margin-top:8px' } });

    const nb = list.createEl('button', { text: '— Uncategorized —', cls: 'ic-btn' });
    if (!this.card.categoryId) nb.style.opacity = '0.4';
    nb.onclick = async () => { this.card.categoryId = null; this.card.subcategoryId = null; await this.doMove(); };

    for (const cat of this.data.categories.filter(c => c.projectId === this.projectId && !c.parentId)) {
      const btn = list.createEl('button', { text: cat.name, cls: 'ic-btn' });
      if (cat.id === this.card.categoryId) btn.style.opacity = '0.4';
      btn.onclick = async () => { this.card.categoryId = cat.id; this.card.subcategoryId = null; await this.doMove(); };
    }

    // Allow creating a new category on the spot
    const newCatBtn = contentEl.createEl('button', { text: '+ Create new category', cls: 'ic-btn', attr: { style: 'margin-top:10px;width:100%;border-style:dashed;' } });
    newCatBtn.onclick = () => {
      contentEl.empty();
      contentEl.createEl('h2', { text: 'New Category' });
      const f = contentEl.createDiv('ic-field');
      f.createEl('label', { text: 'Category Name' });
      const input = f.createEl('input', { type: 'text', placeholder: 'e.g. Background Context' });
      input.style.marginTop = '8px';
      setTimeout(() => input.focus(), 50);
      const footer = contentEl.createDiv('ic-modal-footer');
      footer.style.paddingTop = '14px';
      footer.createEl('button', { text: 'Cancel', cls: 'ic-btn' }).onclick = () => this.close();
      const doCreate = async () => {
        const name = input.value.trim();
        if (!name) { new Notice('Please enter a category name.'); return; }
        const newCat = { id: makeId(), name, parentId: null, projectId: this.projectId };
        this.data.categories.push(newCat);
        this.card.categoryId = newCat.id;
        await this.doMove();
      };
      footer.createEl('button', { text: 'Create & Move', cls: 'ic-btn primary' }).onclick = doCreate;
      input.onkeydown = e => { if (e.key === 'Enter') doCreate(); };
    };

    contentEl.createEl('button', { text: 'Cancel', cls: 'ic-btn', attr: { style: 'margin-top:6px;width:100%' } })
      .onclick = () => this.close();
  }

  async doMove() {
    const idx = this.data.cards.findIndex(c => c.id === this.card.id);
    if (idx >= 0) this.data.cards[idx] = this.card;
    await saveData(this.plugin, this.data);
    this.close();
    this.onMove();
  }

  onClose() { this.contentEl.empty(); }
}

// ═════════════════════════════════════════════
//  BIBLIOGRAPHY MODAL
// ═════════════════════════════════════════════
class BibliographyModal extends Modal {
  constructor(plugin, data, projectId) {
    super(plugin.app);
    this.plugin    = plugin;
    this.data      = data;
    this.projectId = projectId;
    this.citStyle  = 'chicago';
    this.folderPath = '';
  }

  onOpen() {
    this.modalEl.addClass('ic-modal-narrow');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Generate Bibliography' });

    const pf = contentEl.createDiv('ic-field');
    pf.createEl('label', { text: 'Project' });
    const pSel = pf.createEl('select');
    for (const p of this.data.projects) {
      const opt = pSel.createEl('option', { text: p.name, value: p.id });
      if (p.id === this.projectId) opt.selected = true;
    }
    pSel.onchange = () => { this.projectId = pSel.value; };

    const sf = contentEl.createDiv('ic-field');
    sf.createEl('label', { text: 'Citation Style' });
    const sSel = sf.createEl('select');
    const styles = [
      ['chicago',  'Chicago (Notes-Bibliography)'],
      ['sbl',      'SBL (Society of Biblical Literature)'],
      ['mla',      'MLA (9th edition)'],
      ['apa',      'APA (7th edition)'],
      ['turabian', 'Turabian'],
    ];
    for (const [k, v] of styles) sSel.createEl('option', { text: v, value: k });
    sSel.onchange = () => { this.citStyle = sSel.value; };

    const ff = contentEl.createDiv('ic-field');
    ff.createEl('label', { text: 'Save to folder (optional)' });
    const fInp = ff.createEl('input', { type: 'text', placeholder: 'e.g. Research/Bibliographies' });
    fInp.oninput = () => { this.folderPath = fInp.value.trim(); };

    const footer = contentEl.createDiv('ic-modal-footer');
    footer.style.paddingTop = '14px';
    footer.createEl('button', { text: 'Cancel', cls: 'ic-btn' }).onclick = () => this.close();
    footer.createEl('button', { text: 'Generate', cls: 'ic-btn primary' }).onclick = () => this.generate();
  }

  formatEntry(card, style) {
    // Clean up author: remove trailing period duplicates from initials
    const a   = (card.author || 'Unknown Author').replace(/\.{2,}/g, '.');
    const t   = (card.title || 'Untitled').replace(/^[\u201c\u201d"]+|[\u201c\u201d"]+$/g, '').trim();
    const st  = card.sourceTitle || '';
    const pub = card.publisher   || '';
    const pl  = card.place       || '';
    const yr  = card.year        || 'n.d.';
    const ed  = card.edition     ? card.edition + '. ' : '';
    const vol = card.volume      ? 'vol. ' + card.volume + (card.issue ? ', no. ' + card.issue + '. ' : '. ') : '';
    const pg  = card.pages       ? ': ' + card.pages    : '';
    const url = card.url         ? card.url       : '';
    const acc = card.accessed    ? card.accessed  : '';
    const urlAcc = url ? url + (acc ? '. Accessed ' + acc : '') : '';
    const pubLine = [pl, pub].filter(Boolean).join(': ');

    const clean = s => s.replace(/\.{2,}/g, '.').replace(/,\s*\./, '.').trim();

    if (style === 'chicago' || style === 'turabian') {
      if (st) return clean(a + '. "' + t + '." *' + st + '* ' + vol + yr + pg + (urlAcc ? '. ' + urlAcc : '') + '.');
      return clean(a + '. *' + t + '*. ' + ed + pubLine + (pubLine ? ', ' : '') + yr + (urlAcc ? '. ' + urlAcc : '') + '.');
    }
    if (style === 'sbl') {
      if (st) return clean(a + '. "' + t + '." *' + st + '* ' + vol + '(' + yr + ')' + pg + (urlAcc ? '. ' + urlAcc : '') + '.');
      return clean(a + '. *' + t + '*. ' + ed + pubLine + (pubLine ? ', ' : '') + yr + (urlAcc ? '. ' + urlAcc : '') + '.');
    }
    if (style === 'mla') {
      if (st) return clean(a + '. "' + t + '." *' + st + '*, ' + vol + yr + ', pp. ' + (card.pages || 'n.p.') + (urlAcc ? '. ' + urlAcc : '') + '.');
      return clean(a + '. *' + t + '*. ' + ed + pub + (pub && yr ? ', ' : '') + yr + (urlAcc ? '. ' + urlAcc : '') + '.');
    }
    if (style === 'apa') {
      const lastName = a.split(',')[0];
      const rest = a.includes(',') ? a.split(',').slice(1).join(',').trim() : '';
      const initials = rest ? rest.split(' ').filter(Boolean).map(n => n[0] + '.').join(' ') : '';
      const auth = initials ? lastName + ', ' + initials : lastName;
      if (st) {
        const volIss = card.volume ? '*' + card.volume + '*' + (card.issue ? '(' + card.issue + ')' : '') : '';
        return clean(auth + ' (' + yr + '). ' + t + '. *' + st + '*, ' + volIss + pg + (urlAcc ? ' ' + urlAcc : '') + '.');
      }
      return clean(auth + ' (' + yr + '). *' + t + '*. ' + pub + (urlAcc ? ' ' + urlAcc : '') + '.');
    }
    return clean(a + '. *' + t + '*. ' + yr + (urlAcc ? '. ' + urlAcc : '') + '.');
  }

  async generate() {
    const cards = this.data.cards.filter(c => c.projectId === this.projectId && (c.author || c.title));
    if (!cards.length) { new Notice('No cards with citation data in this project.'); return; }

    const project = this.data.projects.find(p => p.id === this.projectId);
    const styleLabel = { chicago:'Chicago', sbl:'SBL', mla:'MLA', apa:'APA', turabian:'Turabian' }[this.citStyle] || this.citStyle;

    const sorted = [...cards].sort((a, b) => {
      return (a.author || 'zzz').split(',')[0].toLowerCase()
        .localeCompare((b.author || 'zzz').split(',')[0].toLowerCase());
    });

    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const lines = [
      '# Bibliography' + (project ? ' — ' + project.name : ''),
      '*Style: ' + styleLabel + '  ·  Generated: ' + dateStr + '*',
      '',
    ];
    const seen = new Set();
    for (const card of sorted) {
      const entry = this.formatEntry(card, this.citStyle);
      if (seen.has(entry)) continue;
      seen.add(entry);
      lines.push(entry);
      lines.push('');
    }

    const folder = this.folderPath || '';
    if (folder && !this.plugin.app.vault.getAbstractFileByPath(folder)) {
      await this.plugin.app.vault.createFolder(folder);
    }
    const baseName = slugify((project ? project.name : 'bibliography') + '-bibliography', 'dashes');
    const filename = (folder ? folder + '/' : '') + baseName + '.md';
    const content  = lines.join('\n');

    try {
      const ex = this.plugin.app.vault.getAbstractFileByPath(filename);
      if (ex) await this.plugin.app.vault.modify(ex, content);
      else    await this.plugin.app.vault.create(filename, content);
      this.close();
      new Notice('Bibliography saved: ' + filename);
      const file = this.plugin.app.vault.getAbstractFileByPath(filename);
      if (file) this.plugin.app.workspace.getLeaf('tab').openFile(file);
    } catch(e) {
      new Notice('Error saving bibliography: ' + e.message);
    }
  }

  onClose() { this.contentEl.empty(); }
}


// ═════════════════════════════════════════════
//  MOVE TO PROJECT MODAL
// ═════════════════════════════════════════════
class MoveToProjectModal extends Modal {
  constructor(plugin, card, data, currentProjectId, onMove) {
    super(plugin.app);
    this.plugin = plugin; this.card = card; this.data = data;
    this.currentProjectId = currentProjectId; this.onMove = onMove;
  }

  onOpen() {
    this.modalEl.addClass('ic-modal-narrow');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Move Card to Project' });
    contentEl.createEl('p', {
      text: 'Moving to a new project will unset the current category.',
      attr: { style: 'color:var(--text-muted);font-size:0.83rem;margin:0 0 14px' },
    });

    const otherProjects = this.data.projects.filter(p => p.id !== this.currentProjectId);
    if (!otherProjects.length) {
      contentEl.createEl('p', { text: 'No other projects exist. Create another project first.', attr: { style: 'color:var(--text-muted)' } });
      contentEl.createEl('button', { text: 'Close', cls: 'ic-btn', attr: { style: 'margin-top:12px' } }).onclick = () => this.close();
      return;
    }

    const pf  = contentEl.createDiv('ic-field');
    pf.createEl('label', { text: 'Destination Project' });
    const sel = pf.createEl('select');
    for (const p of otherProjects) sel.createEl('option', { text: p.name, value: p.id });

    const cf     = contentEl.createDiv('ic-field');
    cf.createEl('label', { text: 'Category (optional)' });
    const catSel = cf.createEl('select');

    const refreshCats = () => {
      catSel.empty();
      catSel.createEl('option', { text: '— Uncategorized —', value: '' });
      this.data.categories
        .filter(c => c.projectId === sel.value && !c.parentId)
        .forEach(c => catSel.createEl('option', { text: c.name, value: c.id }));
    };
    refreshCats();
    sel.onchange = () => refreshCats();

    const footer = contentEl.createDiv('ic-modal-footer');
    footer.style.padding = '14px 0 0';
    footer.createEl('button', { text: 'Cancel', cls: 'ic-btn' }).onclick = () => this.close();
    footer.createEl('button', { text: 'Move Card', cls: 'ic-btn primary' }).onclick = async () => {
      const destProjectId = sel.value;
      const destCatId     = catSel.value || null;
      const idx = this.data.cards.findIndex(c => c.id === this.card.id);
      if (idx >= 0) {
        this.data.cards[idx].projectId  = destProjectId;
        this.data.cards[idx].categoryId = destCatId;
      }
      await saveData(this.plugin, this.data);
      this.close();
      new Notice(`Card moved to "${this.data.projects.find(p => p.id === destProjectId)?.name || 'project'}".`);
      this.onMove();
    };
  }

  onClose() { this.contentEl.empty(); }
}

// ═════════════════════════════════════════════
//  RECENTLY EDITED MODAL
// ═════════════════════════════════════════════
class RecentlyEditedModal extends Modal {
  constructor(plugin, data, onSelect) {
    super(plugin.app);
    this.plugin = plugin; this.data = data; this.onSelect = onSelect;
  }

  onOpen() {
    this.modalEl.addClass('ic-modal-narrow');
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: '🕒 Recently Edited' });

    const allCards = [...this.data.cards]
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
      .slice(0, 50);

    if (!allCards.length) {
      contentEl.createDiv({ text: 'No cards yet.', attr: { style: 'color:var(--text-muted)' } });
    } else {
      const list = contentEl.createDiv('ic-search-results');
      for (const card of allCards) {
        const project = this.data.projects.find(p => p.id === card.projectId) || { name: 'Unknown' };
        const cat     = card.categoryId
          ? (this.data.categories.find(c => c.id === card.categoryId) || {}).name
          : 'Uncategorized';
        const when    = card.updatedAt
          ? new Date(card.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : '';
        const row = list.createDiv('ic-search-result');
        row.createDiv({ cls: 'ic-search-result-title', text: card.cardTitle || (card.front || '').slice(0, 60) || '(untitled)' });
        row.createDiv({ cls: 'ic-search-result-meta',  text: `${project.name} › ${cat}${when ? ' · ' + when : ''}` });
        row.onclick = () => { this.close(); this.onSelect(card); };
      }
    }

    contentEl.createEl('button', { text: 'Close', cls: 'ic-btn', attr: { style: 'margin-top:14px;width:100%' } })
      .onclick = () => this.close();
  }

  onClose() { this.contentEl.empty(); }
}

// ═════════════════════════════════════════════
//  COMPARE MODAL
// ═════════════════════════════════════════════
class CompareModal extends Modal {
  constructor(plugin, data, projectId, preselectedCardA) {
    super(plugin.app);
    this.plugin    = plugin; this.data = data; this.projectId = projectId;
    this.cardA     = preselectedCardA || null;
    this.cardB     = null;
  }

  onOpen() {
    this.modalEl.addClass('ic-compare-modal');
    const { contentEl } = this;
    contentEl.empty();

    const hdr = contentEl.createDiv('ic-compare-header');
    hdr.createEl('h2', { text: '⚖️ Compare Cards' });
    hdr.createEl('button', { text: '✕ Close', cls: 'ic-btn' }).onclick = () => this.close();

    const pickerRow   = contentEl.createDiv('ic-compare-picker-row');
    const projectCards = this.data.cards.filter(c => c.projectId === this.projectId);
    const makeLabel   = card => card.cardTitle || (card.front || '').slice(0, 60) || '(untitled)';

    const makeSelect = (label, preselected) => {
      const wrap = pickerRow.createDiv('ic-compare-picker');
      wrap.createEl('label', { text: label });
      const sel = wrap.createEl('select');
      sel.createEl('option', { text: '— Choose a card —', value: '' });
      for (const c of projectCards) {
        const opt = sel.createEl('option', { text: makeLabel(c), value: c.id });
        if (preselected && c.id === preselected.id) opt.selected = true;
      }
      return sel;
    };

    const selA      = makeSelect('Card A', this.cardA);
    const selB      = makeSelect('Card B', this.cardB);
    const compareBtn = pickerRow.createEl('button', { text: 'Compare', cls: 'ic-btn primary' });

    const body  = contentEl.createDiv('ic-compare-body');
    const paneA = body.createDiv('ic-compare-pane');
    const paneB = body.createDiv('ic-compare-pane');

    const renderPane = async (pane, card) => {
      pane.empty();
      if (!card) { pane.createDiv({ cls: 'ic-compare-pane-empty', text: 'Select a card above.' }); return; }
      if (card.cardTitle) pane.createDiv({ cls: 'ic-compare-card-title', text: card.cardTitle });
      const bodyEl = pane.createDiv('ic-compare-card-body');
      MarkdownRenderer.render(this.plugin.app, card.front || '*(empty)*', bodyEl, '', this.plugin);
      if (card.tags && card.tags.length) {
        const tagsEl = pane.createDiv('ic-compare-tags');
        for (const t of card.tags) tagsEl.createSpan({ cls: 'ic-card-tag', text: '#' + t });
      }
      const cat = card.categoryId ? (this.data.categories.find(c => c.id === card.categoryId) || {}).name : null;
      if (cat) {
        pane.createDiv({ attr: { style: 'margin-top:12px;font-size:0.72rem;color:var(--text-muted)' } }).textContent = '📂 ' + cat;
      }
    };

    const doCompare = async () => {
      const cA = projectCards.find(c => c.id === selA.value) || null;
      const cB = projectCards.find(c => c.id === selB.value) || null;
      await renderPane(paneA, cA);
      await renderPane(paneB, cB);
    };

    compareBtn.onclick = doCompare;

    const footer = contentEl.createDiv('ic-compare-footer');
    footer.createEl('button', { text: 'Close', cls: 'ic-btn' }).onclick = () => this.close();

    if (this.cardA) doCompare();
    else {
      paneA.createDiv({ cls: 'ic-compare-pane-empty', text: 'Select a card above.' });
      paneB.createDiv({ cls: 'ic-compare-pane-empty', text: 'Select a card above.' });
    }
  }

  onClose() { this.contentEl.empty(); }
}

// ═════════════════════════════════════════════
//  PROJECT MODALS
// ═════════════════════════════════════════════
class NewProjectModal extends Modal {
  constructor(plugin, data, onSave) { super(plugin.app); this.plugin = plugin; this.data = data; this.onSave = onSave; }
  onOpen() {
    this.modalEl.addClass('ic-modal-narrow');
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl('h2', { text: 'New Project' });
    contentEl.createEl('p', { text: 'A project is a separate workspace with its own categories and cards.', attr: { style: 'color:var(--text-muted);font-size:0.85rem;margin:4px 0 12px' } });
    const f = contentEl.createDiv('ic-field'); f.createEl('label', { text: 'Project Name' });
    const input = f.createEl('input', { type: 'text', placeholder: 'e.g. Summer Reading Notes' }); input.focus();
    const footer = contentEl.createDiv('ic-modal-footer'); footer.style.padding = '14px 0 0';
    footer.createEl('button', { text: 'Cancel', cls: 'ic-btn' }).onclick = () => this.close();
    const doSave = async () => {
      const name = input.value.trim(); if (!name) { new Notice('Please enter a project name.'); return; }
      this.data.projects.push(emptyProject(name)); await saveData(this.plugin, this.data); this.close(); this.onSave();
    };
    footer.createEl('button', { text: 'Create Project', cls: 'ic-btn primary' }).onclick = doSave;
    input.onkeydown = e => { if (e.key === 'Enter') doSave(); };
  }
  onClose() { this.contentEl.empty(); }
}

class RenameProjectModal extends Modal {
  constructor(plugin, project, data, onSave) { super(plugin.app); this.plugin = plugin; this.project = project; this.data = data; this.onSave = onSave; }
  onOpen() {
    this.modalEl.addClass('ic-modal-narrow');
    const { contentEl } = this; contentEl.empty(); contentEl.createEl('h2', { text: 'Rename Project' });
    const f = contentEl.createDiv('ic-field'); f.createEl('label', { text: 'New Name' });
    const input = f.createEl('input', { type: 'text', value: this.project.name }); input.focus(); input.select();
    const footer = contentEl.createDiv('ic-modal-footer'); footer.style.padding = '14px 0 0';
    footer.createEl('button', { text: 'Cancel', cls: 'ic-btn' }).onclick = () => this.close();
    const doSave = async () => {
      const name = input.value.trim(); if (!name) return;
      const idx = this.data.projects.findIndex(p => p.id === this.project.id);
      if (idx >= 0) this.data.projects[idx].name = name;
      await saveData(this.plugin, this.data); this.close(); this.onSave();
    };
    footer.createEl('button', { text: 'Rename', cls: 'ic-btn primary' }).onclick = doSave;
    input.onkeydown = e => { if (e.key === 'Enter') doSave(); };
  }
  onClose() { this.contentEl.empty(); }
}

// ═════════════════════════════════════════════
//  CATEGORY MODALS
// ═════════════════════════════════════════════
class NewCategoryModal extends Modal {
  constructor(plugin, data, projectId, onSave) { super(plugin.app); this.plugin = plugin; this.data = data; this.projectId = projectId; this.onSave = onSave; }
  onOpen() {
    this.modalEl.addClass('ic-modal-narrow');
    const { contentEl } = this; contentEl.empty(); contentEl.createEl('h2', { text: 'New Category' });
    const f = contentEl.createDiv('ic-field'); f.createEl('label', { text: 'Category Name' });
    const input = f.createEl('input', { type: 'text', placeholder: 'e.g. Chapter 3 Notes' }); input.focus();
    const footer = contentEl.createDiv('ic-modal-footer'); footer.style.padding = '14px 0 0';
    footer.createEl('button', { text: 'Cancel', cls: 'ic-btn' }).onclick = () => this.close();
    const doSave = async () => {
      const name = input.value.trim(); if (!name) { new Notice('Please enter a name.'); return; }
      this.data.categories.push({ ...emptyCategory(name), projectId: this.projectId });
      await saveData(this.plugin, this.data); this.close(); this.onSave();
    };
    footer.createEl('button', { text: 'Create', cls: 'ic-btn primary' }).onclick = doSave;
    input.onkeydown = e => { if (e.key === 'Enter') doSave(); };
  }
  onClose() { this.contentEl.empty(); }
}

class RenameCategoryModal extends Modal {
  constructor(plugin, cat, data, onSave) { super(plugin.app); this.plugin = plugin; this.cat = cat; this.data = data; this.onSave = onSave; }
  onOpen() {
    this.modalEl.addClass('ic-modal-narrow');
    const { contentEl } = this; contentEl.empty(); contentEl.createEl('h2', { text: 'Rename Category' });
    const f = contentEl.createDiv('ic-field'); f.createEl('label', { text: 'New Name' });
    const input = f.createEl('input', { type: 'text', value: this.cat.name }); input.focus(); input.select();
    const footer = contentEl.createDiv('ic-modal-footer'); footer.style.padding = '14px 0 0';
    footer.createEl('button', { text: 'Cancel', cls: 'ic-btn' }).onclick = () => this.close();
    const doSave = async () => {
      const name = input.value.trim(); if (!name) return;
      const idx = this.data.categories.findIndex(c => c.id === this.cat.id);
      if (idx >= 0) this.data.categories[idx].name = name;
      await saveData(this.plugin, this.data); this.close(); this.onSave();
    };
    footer.createEl('button', { text: 'Rename', cls: 'ic-btn primary' }).onclick = doSave;
    input.onkeydown = e => { if (e.key === 'Enter') doSave(); };
  }
  onClose() { this.contentEl.empty(); }
}

// ═════════════════════════════════════════════
//  SUBCATEGORY MODALS
// ═════════════════════════════════════════════
class NewSubcategoryModal extends Modal {
  constructor(plugin, data, parentCatId, projectId, onSave) { super(plugin.app); this.plugin = plugin; this.data = data; this.parentCatId = parentCatId; this.projectId = projectId; this.onSave = onSave; }
  onOpen() {
    this.modalEl.addClass('ic-modal-narrow');
    const { contentEl } = this; contentEl.empty(); contentEl.createEl('h2', { text: 'New Subcategory' });
    const f = contentEl.createDiv('ic-field'); f.createEl('label', { text: 'Subcategory Name' });
    const input = f.createEl('input', { type: 'text', placeholder: 'e.g. Key Quotes' }); input.focus();
    const footer = contentEl.createDiv('ic-modal-footer'); footer.style.padding = '14px 0 0';
    footer.createEl('button', { text: 'Cancel', cls: 'ic-btn' }).onclick = () => this.close();
    const doSave = async () => {
      const name = input.value.trim(); if (!name) { new Notice('Please enter a name.'); return; }
      this.data.categories.push({ ...emptyCategory(name), projectId: this.projectId, parentId: this.parentCatId });
      await saveData(this.plugin, this.data); this.close(); this.onSave();
    };
    footer.createEl('button', { text: 'Create', cls: 'ic-btn primary' }).onclick = doSave;
    input.onkeydown = e => { if (e.key === 'Enter') doSave(); };
  }
  onClose() { this.contentEl.empty(); }
}

class RenameSubcategoryModal extends Modal {
  constructor(plugin, sub, data, onSave) { super(plugin.app); this.plugin = plugin; this.sub = sub; this.data = data; this.onSave = onSave; }
  onOpen() {
    this.modalEl.addClass('ic-modal-narrow');
    const { contentEl } = this; contentEl.empty(); contentEl.createEl('h2', { text: 'Rename Subcategory' });
    const f = contentEl.createDiv('ic-field'); f.createEl('label', { text: 'New Name' });
    const input = f.createEl('input', { type: 'text', value: this.sub.name }); input.focus(); input.select();
    const footer = contentEl.createDiv('ic-modal-footer'); footer.style.padding = '14px 0 0';
    footer.createEl('button', { text: 'Cancel', cls: 'ic-btn' }).onclick = () => this.close();
    const doSave = async () => {
      const name = input.value.trim(); if (!name) return;
      const idx = this.data.categories.findIndex(c => c.id === this.sub.id);
      if (idx >= 0) this.data.categories[idx].name = name;
      await saveData(this.plugin, this.data); this.close(); this.onSave();
    };
    footer.createEl('button', { text: 'Rename', cls: 'ic-btn primary' }).onclick = doSave;
    input.onkeydown = e => { if (e.key === 'Enter') doSave(); };
  }
  onClose() { this.contentEl.empty(); }
}

// ═════════════════════════════════════════════
//  MAIN PLUGIN
// ═════════════════════════════════════════════
class IndexCardsPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, leaf => new IndexCardsView(leaf, this));
    this.addRibbonIcon('library', 'Index Cards', () => this.openView());
    this.addCommand({ id: 'open-index-cards', name: 'Open Index Cards', callback: () => this.openView() });
    this.addSettingTab(new IndexCardsSettingTab(this.app, this));
  }

  async loadSettings()  { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings()  { await this.saveData(this.settings); }

  async openView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length) { this.app.workspace.revealLeaf(existing[0]); return; }
    // 'tab' always opens as a full-width tab in the main editor area
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  onunload() {}
}

module.exports = IndexCardsPlugin;
