// zotero-plugin/src/ui/menu.ts
//
// Registers (and tears down) the Tools-menu entry that launches the
// import-boundary verifier modal. Iterates every open main window so we
// catch windows opened both before and after plugin startup, and listens
// for new windows via Services.wm.
//
// Per the windingwind/zotero-plugin-template convention, all DOM mutation
// done by the plugin is tagged with data-scholar-sidekick="1" so the
// teardown step can remove every artifact even after main.js is reloaded.

import type { StartupContext } from "../index";
import { openImportDialog } from "./dialog";

declare const Zotero: { debug: (msg: string) => void };
declare const Services: {
  wm: {
    getEnumerator: (windowType: string) => { hasMoreElements(): boolean; getNext(): Window };
    addListener: (l: WindowListener) => void;
    removeListener: (l: WindowListener) => void;
  };
};

interface WindowListener {
  onOpenWindow: (xulWin: { docShell: { domWindow: Window } }) => void;
  onCloseWindow: (_xulWin: unknown) => void;
}

const MARK_ATTR = "data-scholar-sidekick";
const MENU_ID = "scholar-sidekick-tools-menu-item";
const TOOLS_MENU_POPUP_ID = "menu_ToolsPopup";

let listener: WindowListener | null = null;
let ctxRef: StartupContext | null = null;

function injectMenuItem(win: Window): void {
  const doc = win.document;
  if (doc.getElementById(MENU_ID)) return;
  const popup = doc.getElementById(TOOLS_MENU_POPUP_ID);
  if (!popup) return;

  // XUL menuitems must be created with createXULElement in Zotero 7.
  const create = (doc as unknown as { createXULElement: (tag: string) => HTMLElement })
    .createXULElement;
  const item = create.call(doc, "menuitem");
  item.id = MENU_ID;
  item.setAttribute("label", "Verify & import bibliography…");
  item.setAttribute(MARK_ATTR, "1");
  item.addEventListener("command", () => {
    if (!ctxRef) return;
    openImportDialog(win, ctxRef).catch((err) => {
      Zotero.debug(`[scholar-sidekick] dialog failed: ${String(err)}`);
    });
  });
  popup.appendChild(item);
}

function removeMenuItem(win: Window): void {
  const doc = win.document;
  const nodes = doc.querySelectorAll(`[${MARK_ATTR}="1"]`);
  for (const node of Array.from(nodes)) {
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }
}

function forEachZoteroWindow(fn: (win: Window) => void): void {
  const wins = Services.wm.getEnumerator("navigator:browser");
  while (wins.hasMoreElements()) {
    const w = wins.getNext() as Window;
    fn(w);
  }
}

export function registerToolsMenu(ctx: StartupContext): void {
  ctxRef = ctx;
  forEachZoteroWindow(injectMenuItem);
  listener = {
    onOpenWindow: (xul) => {
      const win = xul.docShell.domWindow;
      // Defer until DOMContentLoaded so menu_ToolsPopup exists.
      win.addEventListener("load", () => injectMenuItem(win), { once: true });
    },
    onCloseWindow: () => {},
  };
  Services.wm.addListener(listener);
}

export function unregisterToolsMenu(): void {
  if (listener) {
    Services.wm.removeListener(listener);
    listener = null;
  }
  forEachZoteroWindow(removeMenuItem);
  ctxRef = null;
}
