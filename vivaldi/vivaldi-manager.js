// Answers the Vivaldi Manager extension (ALLOWED_SENDERS): its popup lists this window's tabs by workspace and stack,
// and the reading list, and acts on them. The protocol, with every action and data shape, is VIVALDI.md in the
// extension's repo. In short: requests come through chrome.runtime.sendMessage("mpognobbkildjkofajifpdfhcoklimli", …)
// as { api: "vivaldi-manager", v: 1, windowId, action, ...args } and are answered { ok: true, ... } or { error }.
// After a "subscribe", this window pushes { api, windowId, push: "tabs", snapshot } and
// { api, windowId, push: "readingList", entries } back to the extension whenever they change, until a push is not
// answered { ok: true }.
// Every window runs its own copy; each answers only requests for its own window.
// Uses Vivaldi's tab list, workspace store and stack functions (found in its webpack modules, see LOOKUPS), and
// vivaldi.tabsPrivate / vivaldi.readingListPrivate directly. If a Vivaldi update renames things, the affected actions
// answer { error }.
//
// Written for: Vivaldi 8.3
// Needs: webpackChunkgapp_browser_react workspaceStore pageSelection pageActions defaultWorkspaceIcon tabsPrivate setGroupProperties unstack readingListPrivate setReadStatus onModelChanged getVersion
// Retire when: Vivaldi Manager is no longer used, or Vivaldi gives extensions access to workspaces, tab stacks and
// the reading list.
(() => {
  const ALLOWED_SENDERS = ["dkdkfdhakeaaoomfiihhippegpampkod"]; // Vivaldi Manager, id fixed by its manifest key
  const API = "vivaldi-manager";
  const PROTOCOL = 1;
  const MOD_VERSION = 1;
  const PUSH_DELAYS_MS = [60, 400]; // after a change; the second catches Vivaldi's tab list updating late
  const READABLE = ["http://", "https://", "file://"]; // the only URLs Vivaldi adds to the reading list
  const DEBUG = false; // true logs each request and push to the UI console (vivaldi://inspect/#apps, inspect window.html)
  const log = (...a) => { if (DEBUG) console.log("vivaldi-manager:", ...a); };

  // ---- Vivaldi internals --------------------------------------------------------------------------------------

  // Vivaldi's own UI code runs once, in the hidden main.html page. Its webpack modules are found there by text in
  // their source, since module ids and export names are minified and change between versions. Every lookup is named
  // and independent, so one that breaks after an update only disables the actions that use it.
  // Lookups run on first use and are cached. A failed one is retried at most every RETRY_MS (right after launch,
  // Vivaldi's code may not be loaded yet) and warned about once.
  const RETRY_MS = 2000;

  // Each lookup finds the module whose source contains all of `module` (strings and regexes), then takes from its
  // exports the object that has all of `methods`, or whatever `pick([id, source], scan)` returns.
  const ICON_KEY = /getIcon=\w=>\w\?\.emoji\?\?\w\?\.icon\?\?\w+\.(\w+)/;

  const LOOKUPS = {
    // getWorkspaces(): [{ id, name, icon (SVG string), emoji }] in menu order
    // getActiveWorkspaceId(windowId): the workspace a window shows, undefined = the default workspace
    // getActiveWorkspaces(): Map of workspace id -> the window showing it
    workspaceStore: {
      module: ["getWorkspaces(){return this.getState().workspaces}"],
      methods: ["getWorkspaces", "getActiveWorkspaceId", "getActiveWorkspaces"],
    },
    // Page actions, one object shared by all windows:
    // setActiveWorkspace(windowId, workspaceId): shows the workspace and activates its most recently used tab
    // createTabStack(pages): does nothing when tab stacking is off
    // removeFromTabStack(pages): what the tab context menu's "Remove from Tab Stack" does
    pageActions: {
      module: ["createTabStack:async function", "moveToWorkspace:"],
      methods: ["createTabStack", "setActiveWorkspace", "removeFromTabStack"],
    },
    // getPages(windowId, { workspaceId }): the window's tabs in a workspace, as Vivaldi counts them; without the
    // second argument, all the window's tabs. Pages carry vivExtData already parsed.
    pageSelection: {
      module: ["getSelectionOrActivePage(e){"],
      methods: ["getPages"],
    },
    // SVG string of the default workspace's icon, the one Vivaldi's Workspaces button falls back to:
    // `getIcon=e=>e?.emoji??e?.icon??Icons.KEY`
    defaultWorkspaceIcon: {
      module: [ICON_KEY],
      pick: ([, source], { sources, require }) => {
        const key = source.match(ICON_KEY)[1];
        return sources.filter(([, s]) => s.includes(`${key}:()=>`))
          .map(([id]) => { try { return require(id)[key]; } catch (_) { return null; } })
          .find((v) => typeof v === "string" && v.trimStart().startsWith("<svg"));
      },
    },
  };

  let mainPage = null; // main.html's window, where Vivaldi's own globals live
  let scan = null; // { require, count, sources: [[id, source]] }

  // webpack's require, and every module's source. Read again when more modules have been loaded since.
  function getScan() {
    if (!scan) {
      mainPage ??= chrome.extension.getViews().find((w) => w.webpackChunkgapp_browser_react) ?? null;
      if (!mainPage) throw new Error("Vivaldi's main.html page not found");
      let req;
      mainPage.webpackChunkgapp_browser_react.push([[`vivaldi-manager-${Date.now()}-${Math.random()}`], {}, (r) => { req = r; }]);
      if (!req) throw new Error("webpack's require not found");
      scan = { require: req, count: -1, sources: [] };
    }
    const ids = Object.keys(scan.require.m);
    if (ids.length !== scan.count) {
      scan.sources = ids.map((id) => [id, Function.prototype.toString.call(scan.require.m[id])]);
      scan.count = ids.length;
    }
    return scan;
  }

  const matches = (anchor, text) => (typeof anchor === "string" ? text.includes(anchor) : anchor.test(text));

  function find(spec) {
    const s = getScan();
    const hit = s.sources.find(([, src]) => spec.module.every((a) => matches(a, src)));
    if (!hit) throw new Error("no module matches");
    if (spec.pick) return spec.pick(hit, s);
    const exports = Object.values(s.require(hit[0]) || {});
    return exports.find((v) => v && typeof v === "object" && spec.methods.every((m) => typeof v[m] === "function"));
  }

  const cache = new Map(); // name -> value
  const failedAt = new Map(); // name -> time of the last failed try
  const warned = new Set();

  function lookup(name) {
    if (cache.has(name)) return true;
    if (Date.now() - (failedAt.get(name) ?? -Infinity) < RETRY_MS) return false;
    try {
      const value = find(LOOKUPS[name]);
      if (!value) throw new Error("module found, but not the export");
      cache.set(name, value);
      return true;
    } catch (err) {
      failedAt.set(name, Date.now());
      if (!warned.has(name)) console.warn(`vivaldi-manager: Vivaldi internal "${name}" not found (yet).`, err);
      warned.add(name);
      return false;
    }
  }

  const core = {
    // get("workspaceStore", "pageActions") -> { workspaceStore, pageActions }, or null while any is not found
    get(...names) {
      const out = {};
      for (const name of names) {
        if (!lookup(name)) return null;
        out[name] = cache.get(name);
      }
      return out;
    },
    // A tab's workspace id from its vivExtData JSON; 0 for the default workspace (which has no id).
    spaceOf(tab) {
      try { return Number(JSON.parse(tab.vivExtData || "{}").workspaceId) || 0; } catch (_) { return 0; }
    },
  };

  let myWindowId = null;
  chrome.windows.getCurrent().then((w) => { myWindowId = w.id; });

  // ---- helpers ------------------------------------------------------------------------------------------------

  class RequestError extends Error {}
  const fail = (message) => { throw new RequestError(message); };

  function need(...names) {
    const found = core.get(...names);
    if (!found) fail("Vivaldi internals not found (see the warning in Vivaldi's UI console)");
    return found;
  }

  // A vivaldi.* call that takes a callback, as a promise.
  const viaCallback = (start) => new Promise((resolve, reject) => start((result) => {
    const err = chrome.runtime.lastError;
    if (err) reject(new Error(err.message)); else resolve(result);
  }));

  const asWorkspace = (id) => id || undefined; // Vivaldi's own convention: undefined = default workspace
  const spaceOfPage = (page) => Number(page.vivExtData?.workspaceId) || 0;
  const groupOfPage = (page) => page.vivExtData?.group || null;

  // This window's tabs as Vivaldi shows them in the tab strip, in strip order.
  const stripPages = (sel) => sel.getPages(myWindowId).toArray().sort((a, b) => a.index - b.index);

  // The stack a page is in. A group of one tab is no stack: Vivaldi shows it as a plain tab.
  function stackOf(pages, page) {
    const group = groupOfPage(page);
    if (!group) return null;
    const space = spaceOfPage(page);
    return pages.filter((p) => groupOfPage(p) === group && spaceOfPage(p) === space).length > 1 ? group : null;
  }

  function pagesById(sel, ids) {
    const pages = stripPages(sel);
    const want = (ids ?? []).map(Number);
    const found = pages.filter((p) => want.includes(p.id));
    if (found.length !== want.length) fail("tab not found in this window");
    return { pages, found };
  }

  // The same pages as an Immutable.js List, which Vivaldi's page functions take.
  const pageList = (sel, ids) => sel.getPages(myWindowId).filter((p) => ids.includes(p.id));

  // ---- the tabs snapshot --------------------------------------------------------------------------------------

  async function snapshot() {
    const { workspaceStore: spaces, pageSelection: sel } = need("workspaceStore", "pageSelection");
    const defaultIcon = core.get("defaultWorkspaceIcon")?.defaultWorkspaceIcon;
    const chromeTabs = new Map((await chrome.tabs.query({ windowId: myWindowId })).map((t) => [t.id, t]));
    const pages = stripPages(sel);

    const workspaces = [
      { id: 0, name: "Default", icon: defaultIcon ? { svg: defaultIcon } : null },
      ...spaces.getWorkspaces().map((w) => ({
        id: w.id, name: w.name, icon: w.emoji ? { emoji: w.emoji } : w.icon ? { svg: w.icon } : null,
      })),
    ].map((w) => ({ ...w, tabCount: 0, items: [] }));
    const byId = new Map(workspaces.map((w) => [w.id, w]));

    const tabOf = (page) => {
      const t = chromeTabs.get(page.id) ?? {};
      const url = t.url ?? page.url ?? "";
      return {
        id: page.id,
        title: page.vivExtData?.fixedTitle || t.title || page.title || url,
        url,
        favIconUrl: t.favIconUrl ?? page.favIconUrl ?? "",
        audible: Boolean(t.audible ?? page.audible),
        muted: Boolean(t.mutedInfo?.muted),
        pinned: Boolean(t.pinned ?? page.pinned),
        active: Boolean(t.active ?? page.active),
        discarded: Boolean(t.discarded ?? page.discarded),
      };
    };

    const stacks = new Map(); // group id -> stack item
    for (const page of pages) {
      const space = byId.get(spaceOfPage(page)) ?? byId.get(0); // a workspace Vivaldi no longer lists: show in Default
      space.tabCount += 1;
      const group = stackOf(pages, page);
      if (!group) {
        space.items.push({ type: "tab", ...tabOf(page) });
        continue;
      }
      let stack = stacks.get(group);
      if (!stack) {
        stack = { type: "stack", id: group, name: "", customName: false, color: page.vivExtData?.groupColor ?? null,
          tabs: [], pages: [] };
        stacks.set(group, stack);
        space.items.push(stack);
      }
      stack.tabs.push(tabOf(page));
      stack.pages.push(page);
    }

    // A stack's name: the one the user gave it, else the title of its most recently used tab, as in Vivaldi.
    for (const stack of stacks.values()) {
      const named = stack.pages.find((p) => p.vivExtData?.fixedGroupTitle);
      if (named) {
        stack.name = named.vivExtData.fixedGroupTitle;
        stack.customName = true;
      } else {
        const recent = stack.tabs.find((t) => t.active)
          ?? stack.tabs.reduce((a, b) => ((chromeTabs.get(b.id)?.lastAccessed ?? 0) > (chromeTabs.get(a.id)?.lastAccessed ?? 0) ? b : a));
        stack.name = recent.title;
      }
      delete stack.pages;
    }

    const active = [...chromeTabs.values()].find((t) => t.active);
    return {
      windowId: myWindowId,
      activeTabId: active?.id ?? null,
      activeWorkspaceId: Number(spaces.getActiveWorkspaceId(myWindowId)) || 0,
      workspaces,
    };
  }

  // ---- tab actions --------------------------------------------------------------------------------------------

  async function activateTab(tabId) {
    const { workspaceStore: spaces, pageSelection: sel, pageActions: actions } =
      need("workspaceStore", "pageSelection", "pageActions");
    const { found: [page] } = pagesById(sel, [tabId]);
    const space = spaceOfPage(page);
    if (space !== (Number(spaces.getActiveWorkspaceId(myWindowId)) || 0)) {
      await actions.setActiveWorkspace(myWindowId, asWorkspace(space));
    }
    await chrome.tabs.update(page.id, { active: true });
  }

  async function closeTabs(tabIds) {
    const { pageSelection: sel } = need("pageSelection");
    const { found } = pagesById(sel, tabIds);
    if (found.length) await chrome.tabs.remove(found.map((p) => p.id));
  }

  async function move(options) {
    const result = await viaCallback((done) => vivaldi.tabsPrivate.move({ ...options, debug: API }, done));
    if (result?.success === false) fail("Vivaldi refused the move");
  }

  // Moves the tabs and stacks next to a target, the way Vivaldi's window panel does on drag and drop.
  async function moveTabs({ tabIds = [], stackIds = [], target, position, intoStack = false }) {
    const { workspaceStore: spaces, pageSelection: sel, pageActions: actions } =
      need("workspaceStore", "pageSelection", "pageActions");
    const { pages, found } = pagesById(sel, tabIds);
    for (const id of stackIds) {
      if (!pages.some((p) => groupOfPage(p) === id)) fail(`stack ${id} not found in this window`);
    }
    if (!found.length && !stackIds.length) fail("nothing to move");
    const moving = [...found, ...pages.filter((p) => stackIds.includes(groupOfPage(p)))];
    const source = Number(spaces.getActiveWorkspaceId(myWindowId)) || 0;

    if (target && "workspaceId" in target) {
      await moveToWorkspace(Number(target.workspaceId) || 0, moving, { spaces, sel });
    } else {
      const tweak = { before: "above", after: "below" }[position] ?? fail('position must be "before" or "after"');
      let targetId;
      let targetPage;
      let into = false;
      if (target?.tabId != null) {
        targetPage = pages.find((p) => p.id === Number(target.tabId)) ?? fail("target tab not found in this window");
        if (moving.includes(targetPage)) return; // onto itself
        const stack = stackOf(pages, targetPage);
        // Next to a stacked tab means into its stack; otherwise next to the whole stack, never splitting it.
        into = Boolean(stack && intoStack);
        targetId = stack && !intoStack ? stack : targetPage.vivExtData.ext_id;
      } else if (target?.stackId != null) {
        if (stackIds.includes(target.stackId)) return; // onto itself
        targetPage = pages.find((p) => groupOfPage(p) === target.stackId) ?? fail("target stack not found in this window");
        targetId = target.stackId;
      } else {
        fail("target must have tabId, stackId or workspaceId");
      }
      const tweaks = [tweak];
      if (into) tweaks.push("into");
      if (stackIds.length) tweaks.push("do-not-reparent");
      log("move", { tabIds: found.map((p) => p.id), extIds: stackIds, target: targetId, tweaks });
      await move({ tabIds: found.map((p) => p.id), extIds: stackIds, target: targetId, tweaks,
        workspaceId: spaceOfPage(targetPage) || 0 });
    }
    await followIfEmptied(source, moving, { sel, actions });
  }

  // To the end of a workspace, even an empty one. Vivaldi places moved tabs after the workspace's last tab, so for
  // an empty workspace a blank placeholder tab is opened there first and closed after the move.
  async function moveToWorkspace(want, moving, { spaces, sel }) {
    if (want && !spaces.getWorkspaces().some((w) => w.id === want)) fail("workspace not found");
    const shownIn = want ? spaces.getActiveWorkspaces().get(want) : undefined;
    if (shownIn !== undefined && shownIn !== myWindowId) fail("that workspace is open in another window");
    const tabIds = moving.map((p) => p.id);
    let placeholder = null;
    if (!sel.getPages(myWindowId, { workspaceId: asWorkspace(want) }).some((p) => !tabIds.includes(p.id))) {
      placeholder = await chrome.tabs.create({ windowId: myWindowId, url: "about:blank", active: false, workspaceId: want });
      if (core.spaceOf(placeholder) !== want) {
        await chrome.tabs.remove(placeholder.id).catch(() => {});
        fail("could not open a placeholder tab in the empty workspace");
      }
    }
    try {
      log("move", tabIds, "to the end of workspace", want, placeholder ? "(placeholder)" : "");
      await move({ tabIds, target: "last", tweaks: ["do-not-reparent"], workspaceId: want || "window" });
    } finally {
      if (placeholder) await chrome.tabs.remove(placeholder.id).catch(() => {});
    }
  }

  // When the move took the last tabs out of the workspace on screen, the window follows them, as Vivaldi would
  // otherwise show an empty workspace. The tab that was active stays active.
  async function followIfEmptied(source, moving, { sel, actions }) {
    if (sel.getPages(myWindowId, { workspaceId: asWorkspace(source) }).size > 0) return;
    const active = moving.find((p) => p.active) ?? moving[0];
    const now = await chrome.tabs.get(active.id).catch(() => null);
    if (!now) return;
    log("workspace", source, "is empty, following the tabs");
    await actions.setActiveWorkspace(myWindowId, asWorkspace(core.spaceOf(now)));
    await chrome.tabs.update(now.id, { active: true });
  }

  async function createStack(tabIds) {
    const { pageSelection: sel, pageActions: actions } = need("pageSelection", "pageActions");
    const { found } = pagesById(sel, tabIds);
    if (found.length < 2) fail("a stack needs at least two tabs");
    const pinned = found.filter((p) => p.pinned).length;
    if (pinned > 0 && pinned < found.length) fail("pinned and unpinned tabs can't share a stack");
    const stackId = await actions.createTabStack(pageList(sel, found.map((p) => p.id)), { showStackEditor: false });
    if (!stackId) fail("Vivaldi did not create the stack (is tab stacking turned off in Settings > Tabs?)");
    return { stackId };
  }

  async function removeFromStack(tabIds) {
    const { pageSelection: sel, pageActions: actions } = need("pageSelection", "pageActions");
    const { found } = pagesById(sel, tabIds);
    if (found.some((p) => !groupOfPage(p))) fail("tab is not in a stack");
    await actions.removeFromTabStack(pageList(sel, found.map((p) => p.id)));
  }

  function stackPages(stackId) {
    const { pageSelection: sel } = need("pageSelection");
    const found = stripPages(sel).filter((p) => groupOfPage(p) === stackId);
    if (!found.length) fail("stack not found in this window");
    return found;
  }

  function dissolveStack(stackId) {
    stackPages(stackId);
    vivaldi.tabsPrivate.unstack(stackId); // takes no callback and returns nothing
  }

  async function setStackProperties(stackId, properties) {
    stackPages(stackId);
    await viaCallback((done) => vivaldi.tabsPrivate.setGroupProperties({ groupExtId: stackId, ...properties }, done));
  }

  // ---- reading list -------------------------------------------------------------------------------------------

  const readingList = () => vivaldi.readingListPrivate;

  async function readingListEntries() {
    const entries = await viaCallback((done) => readingList().getAll(done));
    return (entries ?? []).map((e) => ({ url: e.url, title: e.title ?? "", read: Boolean(e.read), lastUpdate: e.lastUpdate ?? 0 }));
  }

  async function addToReadingList(items) {
    if (!Array.isArray(items)) fail("items must be a list");
    const known = new Set((await readingListEntries()).map((e) => e.url));
    const added = [];
    const skipped = [];
    for (const { url, title } of items) {
      if (typeof url !== "string" || !READABLE.some((s) => url.toLowerCase().startsWith(s))) {
        skipped.push({ url, reason: "Vivaldi only adds http, https and file pages" });
      } else if (known.has(url)) {
        skipped.push({ url, reason: "already in the reading list" });
      } else if (await viaCallback((done) => readingList().add(url, title ?? "", done))) {
        known.add(url);
        added.push(url);
      } else {
        skipped.push({ url, reason: "Vivaldi refused it" });
      }
    }
    return { added, skipped };
  }

  async function requireEntry(url) {
    if (!(await readingListEntries()).some((e) => e.url === url)) fail("not in the reading list");
  }

  async function setRead(url, read) {
    await requireEntry(url);
    if (!(await viaCallback((done) => readingList().setReadStatus(url, Boolean(read), done)))) fail("Vivaldi refused it");
  }

  async function removeFromReadingList(url) {
    await requireEntry(url);
    if (!(await viaCallback((done) => readingList().remove(url, done)))) fail("Vivaldi refused it");
  }

  // As Vivaldi's reading list panel: switch to the page if it's open in this window, else open it; mark it read.
  async function openReadingListItem(url) {
    await requireEntry(url);
    const open = (await chrome.tabs.query({ windowId: myWindowId })).find((t) => t.url === url);
    if (open) await activateTab(open.id);
    else await chrome.tabs.create({ windowId: myWindowId, url, active: true });
    await viaCallback((done) => readingList().setReadStatus(url, true, done));
  }

  // ---- pushes -------------------------------------------------------------------------------------------------

  let subscriber = null; // extension id, while its popup listens
  let lastTabs = null; // JSON of the last snapshot pushed
  const timers = [];

  function push(message) {
    const to = subscriber;
    if (!to) return;
    log("push", message.push);
    chrome.runtime.sendMessage(to, { api: API, windowId: myWindowId, ...message }, (reply) => {
      // The popup replies { ok: true } to every push it takes. Anything else means it has closed.
      const listening = !chrome.runtime.lastError && reply?.ok === true;
      if (!listening && subscriber === to) {
        log("subscriber gone");
        subscriber = null;
      }
    });
  }

  async function pushTabs() {
    if (!subscriber) return;
    try {
      const snap = await snapshot();
      const json = JSON.stringify(snap);
      if (json === lastTabs) return;
      lastTabs = json;
      push({ push: "tabs", snapshot: snap });
    } catch (err) {
      if (!(err instanceof RequestError)) console.warn("vivaldi-manager: could not build the tabs snapshot.", err);
    }
  }

  async function pushReadingList() {
    if (!subscriber) return;
    try {
      push({ push: "readingList", entries: await readingListEntries() });
    } catch (err) {
      console.warn("vivaldi-manager: could not read the reading list.", err);
    }
  }

  function tabsChanged() {
    if (!subscriber) return;
    while (timers.length) clearTimeout(timers.pop());
    for (const ms of PUSH_DELAYS_MS) timers.push(setTimeout(pushTabs, ms));
  }

  for (const event of ["onCreated", "onRemoved", "onUpdated", "onMoved", "onActivated", "onAttached", "onDetached",
    "onReplaced"]) {
    chrome.tabs[event].addListener(tabsChanged);
  }
  try {
    vivaldi.prefs.onChanged.addListener(tabsChanged); // workspaces renamed, added, reordered
  } catch (err) {
    console.warn("vivaldi-manager: no pref change events; workspace edits show on the next tab change.", err);
  }
  try {
    vivaldi.readingListPrivate.onModelChanged.addListener(() => pushReadingList());
  } catch (err) {
    console.warn("vivaldi-manager: no reading list change events.", err);
  }

  // ---- requests -----------------------------------------------------------------------------------------------

  const ACTIONS = {
    ping: () => {
      let vivaldiVersion = null;
      try { vivaldiVersion = vivaldi.utilities.getVersion()?.vivaldiVersion ?? null; } catch (_) { /* unknown */ }
      return { modVersion: MOD_VERSION, vivaldiVersion };
    },
    subscribe: (_msg, sender) => {
      subscriber = sender.id;
      lastTabs = null;
      setTimeout(() => { pushTabs(); pushReadingList(); }); // after the answer
      return {};
    },
    getTabs: async () => ({ snapshot: await snapshot() }),
    activateTab: (msg) => activateTab(msg.tabId),
    closeTabs: (msg) => closeTabs(msg.tabIds),
    moveTabs: (msg) => moveTabs(msg),
    createStack: (msg) => createStack(msg.tabIds),
    removeFromStack: (msg) => removeFromStack(msg.tabIds),
    dissolveStack: (msg) => dissolveStack(msg.stackId),
    renameStack: (msg) => setStackProperties(msg.stackId, { groupTitle: String(msg.name ?? "") }),
    setStackColor: (msg) => {
      if (msg.color != null && !/^color[1-9]$/.test(msg.color)) fail('color must be "color1"…"color9" or null');
      return setStackProperties(msg.stackId, { groupColor: msg.color ?? undefined });
    },
    addToReadingList: (msg) => addToReadingList(msg.items),
    getReadingList: async () => ({ entries: await readingListEntries() }),
    setRead: (msg) => setRead(msg.url, msg.read),
    removeFromReadingList: (msg) => removeFromReadingList(msg.url),
    openReadingListItem: (msg) => openReadingListItem(msg.url),
  };

  chrome.runtime.onMessageExternal.addListener((msg, sender, respond) => {
    if (msg?.api !== API || !ALLOWED_SENDERS.includes(sender.id)) return false;
    if (myWindowId === null || msg.windowId !== myWindowId) return false; // another window's request
    log("request:", msg);
    if (msg.v !== PROTOCOL) {
      respond({ error: "unsupported version" });
      return false;
    }
    const action = Object.hasOwn(ACTIONS, msg.action) ? ACTIONS[msg.action] : null;
    if (!action) {
      respond({ error: `unknown action ${msg.action}` });
      return false;
    }
    (async () => action(msg, sender))().then(
      (result) => respond({ ok: true, ...(result ?? {}) }),
      (err) => {
        if (!(err instanceof RequestError)) console.warn(`vivaldi-manager: ${msg.action} failed.`, err);
        respond({ error: err?.message || String(err) });
      },
    );
    return true; // answered asynchronously
  });
})();
