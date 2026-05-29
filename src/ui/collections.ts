// zotero-plugin/src/ui/collections.ts
//
// Two Zotero-facing helpers used by the dialog controller:
//   1. enumerateCollections() — flat list of the user's collections (with
//      depth for indentation) so the modal's "Import into" dropdown can
//      offer a target.
//   2. pickBibliographyFile() — file picker that returns the file's
//      text content for the verify pipeline. Returns null when the user
//      cancels.

declare const Zotero: {
  Libraries: { userLibraryID: number };
  Collections: {
    getByLibrary: (libraryID: number, recursive?: boolean) => Array<ZoteroCollection>;
  };
};

declare const Components: {
  classes: Record<string, { createInstance: (iface: unknown) => unknown }>;
  interfaces: {
    nsIFilePicker: {
      modeOpen: number;
      returnOK: number;
      returnCancel: number;
      returnReplace: number;
    };
  };
};

declare const IOUtils: {
  readUTF8: (path: string) => Promise<string>;
};

interface ZoteroCollection {
  id: number;
  name: string;
  parentID: number | false;
}

export interface CollectionOption {
  id: number;
  label: string;
  depth: number;
}

/**
 * Return the user's collections as a flat list ordered by parent → child,
 * with `depth` set so the UI can indent. v0.1 sticks to the user library;
 * group library support is a v2 concern.
 */
export function enumerateCollections(): CollectionOption[] {
  const libraryID = Zotero.Libraries.userLibraryID;
  const all = Zotero.Collections.getByLibrary(libraryID, true) ?? [];
  const byId = new Map<number, ZoteroCollection>();
  for (const c of all) byId.set(c.id, c);

  function depthOf(c: ZoteroCollection): number {
    let depth = 0;
    let cursor: number | false = c.parentID;
    const guard = new Set<number>();
    while (typeof cursor === "number" && !guard.has(cursor)) {
      guard.add(cursor);
      depth += 1;
      const parent = byId.get(cursor);
      cursor = parent ? parent.parentID : false;
    }
    return depth;
  }

  // Sort: stable by depth-first traversal, alphabetical at each level.
  const byParent = new Map<number | "root", ZoteroCollection[]>();
  for (const c of all) {
    const key = typeof c.parentID === "number" ? c.parentID : "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.name.localeCompare(b.name));

  const out: CollectionOption[] = [];
  function walk(parent: number | "root"): void {
    const children = byParent.get(parent) ?? [];
    for (const child of children) {
      out.push({ id: child.id, label: child.name, depth: depthOf(child) });
      walk(child.id);
    }
  }
  walk("root");
  return out;
}

/**
 * Open a native file picker for .bib / .ris / .txt, return the file's
 * UTF-8 contents. Resolves to null when the user cancels.
 */
export function pickBibliographyFile(win: Window): Promise<string | null> {
  return new Promise((resolve, reject) => {
    try {
      const fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(
        Components.interfaces.nsIFilePicker as unknown as object,
      ) as {
        init: (parent: unknown, title: string, mode: number) => void;
        appendFilter: (title: string, filter: string) => void;
        open: (cb: (rv: number) => void) => void;
        file: { path: string };
      };
      // Zotero 9 / modern Firefox: nsIFilePicker.init takes a BrowsingContext
      // as arg 0, not a DOM window. Fall back to the window for older builds.
      const parent = (win as unknown as { browsingContext?: unknown }).browsingContext ?? win;
      fp.init(parent, "Select a bibliography", Components.interfaces.nsIFilePicker.modeOpen);
      fp.appendFilter("Bibliography", "*.bib;*.ris;*.txt");
      fp.appendFilter("All files", "*");
      fp.open(async (rv) => {
        if (rv !== Components.interfaces.nsIFilePicker.returnOK) {
          resolve(null);
          return;
        }
        try {
          const text = await IOUtils.readUTF8(fp.file.path);
          resolve(text);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
