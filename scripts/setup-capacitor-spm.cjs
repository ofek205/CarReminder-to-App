#!/usr/bin/env node
/*
 * Workaround: build Capacitor from local source via SPM.
 *
 * Why this exists
 * ---------------
 * The official capacitor-swift-pm 8.x binary xcframework drops public-extension
 * methods from its Swift module interface (call.reject, call.getString(_:),
 * bridge.webView, bridge.viewController, UIColor.capacitor.color(fromHex:), …).
 * The shipped @capacitor/* plugin sources call exactly those symbols, so the
 * Archive step fails with `has no member 'webView'` and `missing argument for
 * parameter #2 in call` errors.
 *
 * The full source — with the public extensions intact — already lives in
 * node_modules/@capacitor/ios/. We replace the broken binary dependency with
 * a local SPM build of that source.
 *
 * Why the prep step
 * -----------------
 * SPM in Xcode 15.4 does not support mixed-language targets (Swift + ObjC in
 * the same target). The Capacitor folder ships with .swift, .h and .m files
 * side by side, so we have to split it into two targets:
 *
 *     Capacitor/Capacitor/   →   _spm/CapacitorObjC/include/  (.h files)
 *                                _spm/CapacitorObjC/          (.m files)
 *                                _spm/Capacitor/              (.swift files,
 *                                                              with `import
 *                                                              CapacitorObjC`
 *                                                              injected)
 *
 * Each swift file in Capacitor source uses ObjC types defined in the same
 * folder (CAPPlugin, CAPPluginCall, CAPBridgeViewController …). After the
 * split, those types live in a different module (CapacitorObjC), so the swift
 * files need an explicit `import CapacitorObjC` to compile. We inject that
 * line near the top of each copied .swift file (after the leading comment
 * block / the first `import` statement).
 *
 * The `Capacitor` swift target also gets a generated `_CapacitorReexports.swift`
 * file containing `@_exported import CapacitorObjC` so that plugins doing
 * `import Capacitor` keep seeing the ObjC types as if Capacitor were a single
 * module.
 *
 * Idempotent — runs as `postinstall` (after npm ci wipes node_modules) and
 * again from CI right after `npx cap sync ios` (which regenerates
 * CapApp-SPM/Package.swift back to the broken GitHub URL).
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const capIos = path.join(repoRoot, 'node_modules', '@capacitor', 'ios');
const wrapperManifest = path.join(capIos, 'Package.swift');
const capAppSpm = path.join(repoRoot, 'ios', 'App', 'CapApp-SPM', 'Package.swift');

const capacitorSrcDir = path.join(capIos, 'Capacitor', 'Capacitor');
const cordovaSrcDir = path.join(capIos, 'CapacitorCordova', 'CapacitorCordova');
const prepRoot = path.join(capIos, '_spm');
// CapacitorObjC: ObjC half of Capacitor. The original sources `#import
// <Capacitor/Foo.h>`, so place public headers under include/Capacitor/.
const prepObjC = path.join(prepRoot, 'CapacitorObjC');
const prepObjCInclude = path.join(prepObjC, 'include', 'Capacitor');
const prepObjCSrc = path.join(prepObjC, 'src');
const prepSwift = path.join(prepRoot, 'Capacitor');
// Cordova: ObjC-only. Sources `#import <Cordova/Foo.h>`, so headers under
// include/Cordova/.
const prepCordova = path.join(prepRoot, 'Cordova');
const prepCordovaInclude = path.join(prepCordova, 'include', 'Cordova');
const prepCordovaSrc = path.join(prepCordova, 'src');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function rmDirSafe(p) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}

function injectImport(swiftSource) {
  if (swiftSource.includes('import CapacitorObjC')) {
    return swiftSource;
  }
  // Insert `import CapacitorObjC` right after the first `import` line we find.
  // Most files start with `import Foundation` or similar; this preserves the
  // header comment block.
  const lines = swiftSource.split(/\r?\n/);
  let inserted = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s+\w+/.test(lines[i])) {
      lines.splice(i + 1, 0, 'import CapacitorObjC');
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    // No existing import — prepend at the top.
    lines.unshift('import CapacitorObjC');
  }
  return lines.join('\n');
}

function prepareCapacitorSplit() {
  if (!fs.existsSync(capacitorSrcDir)) {
    console.log('[capacitor-spm] Capacitor source folder missing — skipping prep.');
    return false;
  }

  rmDirSafe(prepRoot);
  ensureDir(prepObjCInclude);
  ensureDir(prepObjCSrc);
  ensureDir(prepCordovaInclude);
  ensureDir(prepCordovaSrc);
  ensureDir(prepSwift);

  // ---- Capacitor (mixed-language) → split into CapacitorObjC + Capacitor (Swift)
  const capEntries = fs.readdirSync(capacitorSrcDir, { withFileTypes: true });
  for (const entry of capEntries) {
    const src = path.join(capacitorSrcDir, entry.name);

    if (entry.isDirectory()) {
      // Resources / nested folders: copy verbatim into the swift target so
      // resource declarations in Package.swift can reach them.
      if (entry.name === 'assets') {
        fs.cpSync(src, path.join(prepSwift, entry.name), { recursive: true });
      }
      continue;
    }

    const lower = entry.name.toLowerCase();
    if (lower.endsWith('.h')) {
      fs.copyFileSync(src, path.join(prepObjCInclude, entry.name));
    } else if (lower.endsWith('.m')) {
      fs.copyFileSync(src, path.join(prepObjCSrc, entry.name));
    } else if (lower.endsWith('.swift')) {
      const content = fs.readFileSync(src, 'utf8');
      fs.writeFileSync(path.join(prepSwift, entry.name), injectImport(content));
    } else if (lower === 'capacitor.modulemap' || lower === 'info.plist') {
      // Skip — we generate our own structure.
    } else if (entry.name === 'PrivacyInfo.xcprivacy') {
      fs.copyFileSync(src, path.join(prepSwift, entry.name));
    }
  }

  // Re-export bridge: lets plugins keep doing `import Capacitor` and still see
  // ObjC-defined types like CAPPlugin / CAPPluginCall.
  const reexports = `// Auto-generated by scripts/setup-capacitor-spm.cjs.
// Re-exports the ObjC half of Capacitor so consumers of the Capacitor module
// continue to see CAPPlugin, CAPPluginCall, and friends without needing a
// separate import.
@_exported import CapacitorObjC
`;
  fs.writeFileSync(path.join(prepSwift, '_CapacitorReexports.swift'), reexports);

  // ---- Cordova (ObjC-only) → flatten Classes/ + Classes/Public/ into
  //      include/Cordova (headers) and src (m files). The shipped sources
  //      `#import <Cordova/Foo.h>`, so the headers must live under a
  //      "Cordova" subdirectory of an include path.
  if (fs.existsSync(cordovaSrcDir)) {
    function walkCordova(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const src = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkCordova(src);
          continue;
        }
        const lower = entry.name.toLowerCase();
        if (lower.endsWith('.h')) {
          fs.copyFileSync(src, path.join(prepCordovaInclude, entry.name));
        } else if (lower.endsWith('.m')) {
          fs.copyFileSync(src, path.join(prepCordovaSrc, entry.name));
        }
      }
    }
    walkCordova(cordovaSrcDir);
  }

  return true;
}

function writeWrapperManifest(prepared) {
  if (!fs.existsSync(capIos)) {
    console.log('[capacitor-spm] @capacitor/ios not installed yet — skipping wrapper manifest.');
    return;
  }

  const manifest = `// swift-tools-version: 5.9
// Auto-generated by scripts/setup-capacitor-spm.cjs.
// Wraps the local @capacitor/ios source as an SPM package so iOS Archive
// builds against complete public APIs (the upstream binary xcframework drops
// public-extension methods from its swiftinterface).
//
// Capacitor ships .swift + .h + .m in one folder; SPM in Xcode 15.4 does not
// support mixed-language targets, so the postinstall script splits the
// Capacitor source into a Swift target and an ObjC target under _spm/.
import PackageDescription

let package = Package(
    name: "capacitor-swift-pm",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "Capacitor", targets: ["Capacitor", "CapacitorObjC"]),
        .library(name: "Cordova", targets: ["Cordova"])
    ],
    targets: [
        .target(
            name: "Cordova",
            path: "_spm/Cordova",
            sources: ["src"],
            publicHeadersPath: "include",
            cSettings: [
                .headerSearchPath("include")
            ]
        ),
        .target(
            name: "CapacitorObjC",
            dependencies: ["Cordova"],
            path: "_spm/CapacitorObjC",
            sources: ["src"],
            publicHeadersPath: "include",
            cSettings: [
                .headerSearchPath("include"),
                .define("CAPACITOR_SWIFT_PM_LOCAL", to: "1")
            ]
        ),
        .target(
            name: "Capacitor",
            dependencies: ["CapacitorObjC", "Cordova"],
            path: "_spm/Capacitor",
            resources: [
                .copy("assets/native-bridge.js"),
                .copy("PrivacyInfo.xcprivacy")
            ]
        )
    ]
)
`;

  const existing = fs.existsSync(wrapperManifest) ? fs.readFileSync(wrapperManifest, 'utf8') : null;
  if (existing === manifest && prepared) {
    console.log('[capacitor-spm] Wrapper manifest already up-to-date:', wrapperManifest);
    return;
  }
  fs.writeFileSync(wrapperManifest, manifest);
  console.log('[capacitor-spm] Wrote wrapper manifest:', wrapperManifest);
}

function patchCapAppSpm() {
  if (!fs.existsSync(capAppSpm)) {
    console.log('[capacitor-spm] CapApp-SPM/Package.swift not present — skipping patch.');
    return;
  }
  let content = fs.readFileSync(capAppSpm, 'utf8');
  const githubLine = /\.package\(\s*url:\s*"https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git"\s*,[^)]*\)/;
  const localLine = '.package(name: "capacitor-swift-pm", path: "../../../node_modules/@capacitor/ios")';

  if (!githubLine.test(content)) {
    if (content.includes('"capacitor-swift-pm"') && content.includes('node_modules/@capacitor/ios')) {
      console.log('[capacitor-spm] CapApp-SPM/Package.swift already patched.');
    } else {
      console.log('[capacitor-spm] CapApp-SPM/Package.swift has unexpected shape — skipping patch (no GitHub URL found).');
    }
    return;
  }
  content = content.replace(githubLine, localLine);
  fs.writeFileSync(capAppSpm, content);
  console.log('[capacitor-spm] Patched CapApp-SPM/Package.swift to use local path.');
}

function patchPluginPackageSwifts() {
  // Each @capacitor/<plugin>/Package.swift declares its own dependency on
  // capacitor-swift-pm via the GitHub URL. With our root package using a local
  // path, SPM ends up resolving BOTH packages and bails on:
  //   multiple targets named 'Capacitor' in: 'capacitor-swift-pm', 'ios'
  // Rewrite each plugin's reference to use the local path too. Plugin folders
  // live at node_modules/@capacitor/<plugin>/, so the relative path to
  // @capacitor/ios is just "../ios".
  const pluginsDir = path.join(repoRoot, 'node_modules', '@capacitor');
  if (!fs.existsSync(pluginsDir)) return;

  const githubLine = /\.package\(\s*url:\s*"https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git"\s*,[^)]*\)/;
  const localLine = '.package(name: "capacitor-swift-pm", path: "../ios")';

  const skip = new Set(['cli', 'core', 'ios', 'android', 'assets', 'docgen']);
  for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || skip.has(entry.name)) continue;
    const pluginPkg = path.join(pluginsDir, entry.name, 'Package.swift');
    if (!fs.existsSync(pluginPkg)) continue;

    let content = fs.readFileSync(pluginPkg, 'utf8');
    if (!githubLine.test(content)) continue;
    content = content.replace(githubLine, localLine);
    fs.writeFileSync(pluginPkg, content);
    console.log(`[capacitor-spm] Patched ${entry.name}/Package.swift to use local @capacitor/ios.`);
  }
}

const prepared = prepareCapacitorSplit();
writeWrapperManifest(prepared);
patchCapAppSpm();
patchPluginPackageSwifts();
