// Where the visitor is signing in from, and how that device installs a PWA. Pure — the caller
// passes the user-agent string and touch-point count, so this is unit-testable and has no DOM.
//
// The honest constraint behind all of this: only Chromium browsers expose an install API
// (`beforeinstallprompt`). iOS exposes nothing at all — Apple has never shipped an equivalent — so
// on an iPhone the only thing an app can do is describe the Share-menu steps. That is why every
// platform below carries written steps even when a one-tap button is also possible.

export type InstallPlatform =
  | "ios-safari" // Add to Home Screen, and the only iOS browser that does it properly
  | "ios-other" // Chrome/Firefox/Edge on iOS — same WebKit, worse install story
  | "android"
  | "desktop-chromium"
  | "desktop-safari"
  | "firefox"
  | "unknown";

export interface DeviceGuess {
  platform: InstallPlatform;
  /** What to call the device in a sentence: "Looks like you're on an iPhone". */
  deviceLabel: string;
  /** Whether `beforeinstallprompt` can ever fire here — i.e. whether a real Install button exists. */
  canPromptInstall: boolean;
}

export function detectDevice(userAgent: string, maxTouchPoints = 0): DeviceGuess {
  const ua = userAgent.toLowerCase();

  const isIPhone = /iphone|ipod/.test(ua);
  // iPadOS 13+ reports itself as a Mac. Touch points are the only reliable tell left.
  const isIPad = /ipad/.test(ua) || (/macintosh/.test(ua) && maxTouchPoints > 1);

  if (isIPhone || isIPad) {
    const label = isIPad ? "iPad" : "iPhone";
    // On iOS every browser is WebKit underneath, but only Safari's share sheet offers
    // "Add to Home Screen" reliably — the others need the visitor to switch browsers first.
    const inSafari = !/crios|fxios|edgios|opt\//.test(ua);
    return {
      platform: inSafari ? "ios-safari" : "ios-other",
      deviceLabel: label,
      canPromptInstall: false,
    };
  }

  if (/android/.test(ua)) {
    // Firefox on Android can't install either, despite the platform being able to.
    if (/firefox/.test(ua)) {
      return { platform: "firefox", deviceLabel: "Android", canPromptInstall: false };
    }
    return { platform: "android", deviceLabel: "Android", canPromptInstall: true };
  }

  const desktopLabel = /windows/.test(ua) ? "Windows" : /mac os x/.test(ua) ? "Mac" : /linux/.test(ua) ? "Linux" : "this computer";

  if (/firefox/.test(ua)) {
    return { platform: "firefox", deviceLabel: desktopLabel, canPromptInstall: false };
  }
  // Edge and Opera both carry "chrome" in their UA, so this catches all Chromium desktops.
  if (/edg\/|chrome|chromium/.test(ua)) {
    return { platform: "desktop-chromium", deviceLabel: desktopLabel, canPromptInstall: true };
  }
  if (/safari/.test(ua)) {
    return { platform: "desktop-safari", deviceLabel: desktopLabel, canPromptInstall: false };
  }

  return { platform: "unknown", deviceLabel: desktopLabel, canPromptInstall: false };
}

export interface InstallGuide {
  title: string;
  steps: string[];
  /** Shown under the steps when the browser itself is the obstacle. */
  note?: string;
}

const GUIDES: Record<InstallPlatform, InstallGuide> = {
  "ios-safari": {
    title: "Add Karpool to your Home Screen",
    steps: [
      "Tap the Share button at the bottom of Safari — the square with an arrow pointing up.",
      'Scroll down the list and tap "Add to Home Screen".',
      'Tap "Add" in the top right. Karpool now opens like any other app.',
    ],
    note: "On iPhone this is also the only way to receive notifications — Apple doesn't deliver them to browser tabs.",
  },
  "ios-other": {
    title: "Open Karpool in Safari first",
    steps: [
      "Copy this page's address, then open Safari and paste it in.",
      "Tap the Share button — the square with an arrow pointing up.",
      'Scroll down and tap "Add to Home Screen", then "Add".',
    ],
    note: "Only Safari can add an app to the iPhone Home Screen. Other iPhone browsers can't, and notifications won't arrive until it's added.",
  },
  android: {
    title: "Install Karpool on your phone",
    steps: [
      "Tap the ⋮ menu in the top-right corner of the browser.",
      'Tap "Install app" (some phones say "Add to Home screen").',
      'Confirm with "Install".',
    ],
  },
  "desktop-chromium": {
    title: "Install Karpool on your computer",
    steps: [
      "Click the install icon at the right-hand end of the address bar — a small screen with a downward arrow.",
      'If it isn\'t there, open the ⋮ menu and look for "Install page as app…" or "Apps".',
      'Confirm with "Install". Karpool opens in its own window from then on.',
    ],
  },
  "desktop-safari": {
    title: "Add Karpool to your Dock",
    steps: [
      "Open the File menu in Safari.",
      'Choose "Add to Dock…".',
      'Confirm with "Add".',
    ],
    note: "Needs Safari 17 or newer (macOS Sonoma). On an older Mac, Chrome or Edge can install it instead.",
  },
  firefox: {
    title: "Firefox can't install web apps",
    steps: [
      "Open this page in Chrome or Edge instead — on a computer or an Android phone.",
      "On an iPhone, open it in Safari.",
      "Then follow that browser's install prompt.",
    ],
    note: "Firefox removed its install support; there's no workaround from inside the page.",
  },
  unknown: {
    title: "Install Karpool",
    steps: [
      "Open your browser's menu.",
      'Look for "Install", "Install app", or "Add to Home screen".',
      "Follow the prompt your browser shows.",
    ],
  },
};

export function installGuideFor(platform: InstallPlatform): InstallGuide {
  return GUIDES[platform];
}
