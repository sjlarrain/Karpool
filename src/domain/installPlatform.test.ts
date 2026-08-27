import { describe, it, expect } from "vitest";
import { detectDevice, installGuideFor, type InstallPlatform } from "./installPlatform";

// Real user-agent strings, trimmed to the parts that matter. Guessing these from memory is how
// device detection goes quietly wrong, so each one is a shape actually seen in the wild.
const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1",
  ipadOS:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  desktopFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
};

describe("detectDevice", () => {
  it("names the device the visitor is actually holding", () => {
    expect(detectDevice(UA.iphoneSafari).deviceLabel).toBe("iPhone");
    expect(detectDevice(UA.androidChrome).deviceLabel).toBe("Android");
    expect(detectDevice(UA.windowsChrome).deviceLabel).toBe("Windows");
    expect(detectDevice(UA.macSafari).deviceLabel).toBe("Mac");
  });

  it("separates Safari on iOS from the other iOS browsers", () => {
    expect(detectDevice(UA.iphoneSafari).platform).toBe("ios-safari");
    expect(detectDevice(UA.iphoneChrome).platform).toBe("ios-other");
  });

  it("recognises an iPad that claims to be a Mac", () => {
    // iPadOS 13+ sends a desktop Safari user-agent; touch points are the only difference left.
    expect(detectDevice(UA.ipadOS, 5)).toEqual({
      platform: "ios-safari",
      deviceLabel: "iPad",
      canPromptInstall: false,
    });
    // Same string, no touch screen: a real Mac.
    expect(detectDevice(UA.ipadOS, 0).platform).toBe("desktop-safari");
  });

  it("offers a real install button only where beforeinstallprompt exists", () => {
    expect(detectDevice(UA.androidChrome).canPromptInstall).toBe(true);
    expect(detectDevice(UA.windowsChrome).canPromptInstall).toBe(true);
    expect(detectDevice(UA.windowsEdge).canPromptInstall).toBe(true);

    expect(detectDevice(UA.iphoneSafari).canPromptInstall).toBe(false);
    expect(detectDevice(UA.macSafari).canPromptInstall).toBe(false);
    expect(detectDevice(UA.desktopFirefox).canPromptInstall).toBe(false);
    expect(detectDevice(UA.androidFirefox).canPromptInstall).toBe(false);
  });

  it("treats Edge as Chromium, not as Safari", () => {
    expect(detectDevice(UA.windowsEdge).platform).toBe("desktop-chromium");
  });

  it("falls back to a generic guide rather than guessing wrong", () => {
    const guess = detectDevice("some-crawler/1.0");
    expect(guess.platform).toBe("unknown");
    expect(guess.canPromptInstall).toBe(false);
  });
});

describe("installGuideFor", () => {
  const platforms: InstallPlatform[] = [
    "ios-safari",
    "ios-other",
    "android",
    "desktop-chromium",
    "desktop-safari",
    "firefox",
    "unknown",
  ];

  it("has real steps for every platform, including the ones that can't be prompted", () => {
    for (const platform of platforms) {
      const guide = installGuideFor(platform);
      expect(guide.title.length).toBeGreaterThan(0);
      expect(guide.steps.length).toBeGreaterThanOrEqual(2);
      expect(guide.steps.every((s) => s.trim().length > 0)).toBe(true);
    }
  });

  it("explains the iPhone notification constraint where it applies", () => {
    expect(installGuideFor("ios-safari").note).toMatch(/notification/i);
    expect(installGuideFor("ios-other").note).toMatch(/Safari/);
  });
});
