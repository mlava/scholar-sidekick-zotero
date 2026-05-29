// zotero-plugin/addon/bootstrap.js
//
// Zotero 7+ bootstrap lifecycle. Zotero 9 introspects the four lifecycle
// methods off the bootstrap scope's `this`, so each handler is assigned
// via `this.X = function`.
//
// Key responsibility beyond loading main.js: register a chrome:// URL
// for the plugin's content directory via aomStartup.registerChrome.
// Without that, Zotero 9's openDialog silently rejects file:// URLs and
// the modal opens to about:blank. The registered URL is
// `chrome://scholar-sidekick/content/`, which maps to addon/chrome/
// content/ — same files, but loaded with chrome privileges so the view
// script can access window.arguments and DOM globals.
//
// All real logic lives in main.js (esbuild output) which exposes
// globalThis.ScholarSidekick. Handlers must never throw — Zotero
// swallows errors silently otherwise.

var ScholarSidekick;
var chromeHandle;

this.install = function install(_data, _reason) {};

this.startup = async function startup({ id, version, rootURI, resourceURI }, _reason) {
  try {
    await Zotero.initializationPromise;

    const root = rootURI || (resourceURI && resourceURI.spec);
    if (!root) {
      Zotero.debug("[scholar-sidekick] no rootURI — cannot load main.js");
      return;
    }

    // Register chrome content namespace so dialogs load with chrome
    // privileges. Maps chrome://scholar-sidekick/content/* → addon/
    // chrome/content/*.
    try {
      const aomStartup = Components.classes[
        "@mozilla.org/addons/addon-manager-startup;1"
      ].getService(Components.interfaces.amIAddonManagerStartup);
      const manifestURI = Services.io.newURI(root + "manifest.json");
      chromeHandle = aomStartup.registerChrome(manifestURI, [
        ["content", "scholar-sidekick", "chrome/content/"],
      ]);
    } catch (err) {
      Zotero.debug(
        "[scholar-sidekick] registerChrome failed: " + (err && err.stack ? err.stack : err),
      );
    }

    Services.scriptloader.loadSubScript(root + "chrome/content/main.js");

    ScholarSidekick = globalThis.ScholarSidekick;
    if (!ScholarSidekick) {
      Zotero.debug("[scholar-sidekick] main.js loaded but ScholarSidekick global missing");
      return;
    }

    await ScholarSidekick.startup({ id, version, rootURI: root });
  } catch (err) {
    Zotero.debug("[scholar-sidekick] startup failed: " + (err && err.stack ? err.stack : err));
  }
};

this.shutdown = async function shutdown(_data, _reason) {
  try {
    if (ScholarSidekick) await ScholarSidekick.shutdown();
  } catch (err) {
    Zotero.debug("[scholar-sidekick] shutdown failed: " + (err && err.stack ? err.stack : err));
  } finally {
    ScholarSidekick = undefined;
    if (globalThis.ScholarSidekick) delete globalThis.ScholarSidekick;
    if (chromeHandle) {
      try {
        chromeHandle.destruct();
      } catch (_err) {
        // Best-effort cleanup; ignore.
      }
      chromeHandle = undefined;
    }
  }
};

this.uninstall = function uninstall(_data, _reason) {};
