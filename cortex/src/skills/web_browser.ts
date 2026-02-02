/**
 * web_browser skill - Full browser automation using Playwright
 * Permission: CONFIRM (network access, can interact with web pages)
 *
 * Capabilities:
 * - Navigate to URLs
 * - Click elements
 * - Type and fill forms
 * - Scroll pages
 * - Take screenshots
 * - Handle popups/dialogs
 * - Multiple tabs
 * - Run in headless, visible, or real Chrome browser
 */

import { chromium, Browser, Page, BrowserContext, Dialog } from "playwright";
import { SkillDefinition, PermissionLevel, SkillResult } from "../types.js";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

const DEFAULT_TIMEOUT = 30000;
const MAX_CONTENT_LENGTH = 50000;

// Session management for persistent browsing
interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  pages: Map<string, Page>;
  activePageId: string;
  mode: "headless" | "visible" | "chrome" | "connect";
  dialogHistory: string[];
}

const CDP_ENDPOINT = "http://localhost:9222";

let session: BrowserSession | null = null;

// Action types for browser automation
type BrowserAction =
  | { action: "navigate"; url: string }
  | { action: "click"; selector: string; button?: "left" | "right" | "middle" }
  | { action: "double_click"; selector: string }
  | { action: "type"; selector: string; text: string; delay?: number }
  | { action: "fill"; selector: string; text: string }
  | { action: "clear"; selector: string }
  | { action: "press"; key: string }
  | { action: "scroll"; direction?: "up" | "down" | "left" | "right"; amount?: number; selector?: string }
  | { action: "scroll_to"; selector: string }
  | { action: "hover"; selector: string }
  | { action: "select"; selector: string; value: string }
  | { action: "check"; selector: string }
  | { action: "uncheck"; selector: string }
  | { action: "screenshot"; path?: string; fullPage?: boolean; selector?: string }
  | { action: "wait"; milliseconds?: number; selector?: string; state?: "visible" | "hidden" | "attached" | "detached" }
  | { action: "extract"; selector?: string; raw?: boolean }
  | { action: "get_text"; selector: string }
  | { action: "get_attribute"; selector: string; attribute: string }
  | { action: "get_url" }
  | { action: "get_title" }
  | { action: "go_back" }
  | { action: "go_forward" }
  | { action: "reload" }
  | { action: "new_tab"; url?: string }
  | { action: "switch_tab"; pageId: string }
  | { action: "close_tab"; pageId?: string }
  | { action: "list_tabs" }
  | { action: "evaluate"; script: string }
  | { action: "handle_dialog"; accept: boolean; promptText?: string };

/**
 * Get Chrome executable path based on OS
 */
function getChromeExecutablePath(): string | undefined {
  const platform = os.platform();

  if (platform === "win32") {
    const paths = [
      path.join(process.env["LOCALAPPDATA"] || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["PROGRAMFILES"] || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    ];
    return paths.find(p => fs.existsSync(p));
  } else if (platform === "darwin") {
    const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    return fs.existsSync(chromePath) ? chromePath : undefined;
  } else {
    // Linux
    const paths = [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ];
    return paths.find(p => fs.existsSync(p));
  }
}

/**
 * Get Chrome user data directory
 */
function getChromeUserDataDir(): string {
  const platform = os.platform();

  if (platform === "win32") {
    return path.join(process.env["LOCALAPPDATA"] || "", "Google", "Chrome", "User Data");
  } else if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome");
  } else {
    return path.join(os.homedir(), ".config", "google-chrome");
  }
}

/**
 * Initialize or get browser session
 */
async function getSession(mode: "headless" | "visible" | "chrome" | "connect" = "headless", cdpUrl?: string): Promise<BrowserSession> {
  // If session exists with same mode, reuse it
  if (session && session.browser.isConnected() && session.mode === mode) {
    return session;
  }

  // Close existing session if mode changed (but don't close connected browsers)
  if (session && session.mode !== "connect") {
    await closeSession();
  } else if (session && session.mode === "connect" && mode !== "connect") {
    // Just clear the session reference, don't close the user's browser
    session = null;
  }

  let browser: Browser;
  let context: BrowserContext;

  if (mode === "connect") {
    // Connect to existing Chrome instance via CDP
    const endpoint = cdpUrl || CDP_ENDPOINT;

    try {
      browser = await chromium.connectOverCDP(endpoint);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("ECONNREFUSED") || msg.includes("connect")) {
        throw new Error(
          `Could not connect to Chrome at ${endpoint}.\n\n` +
          `Make sure Chrome is running with remote debugging:\n` +
          `  1. Close all Chrome windows\n` +
          `  2. Run: chrome.exe --remote-debugging-port=9222\n` +
          `  3. Try again`
        );
      }
      throw error;
    }

    // Get the default context (the user's actual browser context)
    const contexts = browser.contexts();
    context = contexts[0] || await browser.newContext();

    // Import all existing pages/tabs
    const pages = new Map<string, Page>();
    const existingPages = context.pages();

    let activePageId = "";
    for (let i = 0; i < existingPages.length; i++) {
      const pageId = `tab_${i}_${Date.now()}`;
      pages.set(pageId, existingPages[i]);
      setupPageHandlers(existingPages[i]);
      if (i === 0) activePageId = pageId;
    }

    // If no pages exist, create one
    if (pages.size === 0) {
      const newPage = await context.newPage();
      const pageId = `tab_${Date.now()}`;
      pages.set(pageId, newPage);
      activePageId = pageId;
      setupPageHandlers(newPage);
    }

    session = {
      browser,
      context,
      pages,
      activePageId,
      mode,
      dialogHistory: [],
    };

    // Set up handler for new pages
    context.on("page", (page) => {
      const pageId = `tab_${Date.now()}`;
      session?.pages.set(pageId, page);
      setupPageHandlers(page);
    });

    return session;

  } else if (mode === "chrome") {
    // Launch with real Chrome browser and user profile
    const executablePath = getChromeExecutablePath();
    if (!executablePath) {
      throw new Error("Chrome browser not found. Please install Google Chrome.");
    }

    // Use a copy of user data to avoid profile lock issues
    const userDataDir = path.join(os.tmpdir(), "claudian-chrome-profile");

    browser = await chromium.launchPersistentContext(userDataDir, {
      executablePath,
      headless: false,
      channel: "chrome",
      viewport: { width: 1280, height: 800 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
      ],
    }) as unknown as Browser;

    // For persistent context, the context IS the browser
    context = browser as unknown as BrowserContext;
  } else {
    // Standard Chromium launch
    browser = await chromium.launch({
      headless: mode === "headless",
      args: mode === "visible" ? ["--start-maximized"] : [],
    });

    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
  }

  // Create initial page
  const pages = new Map<string, Page>();
  const initialPage = context.pages()[0] || await context.newPage();
  const pageId = `tab_${Date.now()}`;
  pages.set(pageId, initialPage);

  session = {
    browser,
    context,
    pages,
    activePageId: pageId,
    mode,
    dialogHistory: [],
  };

  // Set up dialog handler
  context.on("page", (page) => {
    setupPageHandlers(page);
  });
  setupPageHandlers(initialPage);

  return session;
}

/**
 * Set up event handlers for a page
 */
function setupPageHandlers(page: Page): void {
  page.on("dialog", async (dialog: Dialog) => {
    if (session) {
      session.dialogHistory.push(`[${dialog.type()}] ${dialog.message()}`);
    }
    // Auto-dismiss by default, can be overridden with handle_dialog action
    await dialog.dismiss().catch(() => {});
  });
}

/**
 * Close browser session
 * Note: In "connect" mode, we disconnect but don't close the user's browser
 */
export async function closeSession(): Promise<void> {
  if (session) {
    try {
      if (session.mode === "connect") {
        // Just disconnect, don't close the user's browser
        await session.browser.close(); // This disconnects CDP, doesn't close Chrome
      } else {
        await session.browser.close();
      }
    } catch {
      // Ignore close errors
    }
    session = null;
  }
}

/**
 * Get active page from session
 */
function getActivePage(): Page {
  if (!session) {
    throw new Error("No browser session active");
  }
  const page = session.pages.get(session.activePageId);
  if (!page) {
    throw new Error("Active page not found");
  }
  return page;
}

/**
 * Execute a single browser action
 */
async function executeAction(action: BrowserAction, timeout: number): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const page = getActivePage();

  try {
    switch (action.action) {
      case "navigate": {
        await page.goto(action.url, { timeout, waitUntil: "domcontentloaded" });
        return { success: true, result: `Navigated to ${action.url}` };
      }

      case "click": {
        await page.click(action.selector, { button: action.button || "left", timeout });
        return { success: true, result: `Clicked ${action.selector}` };
      }

      case "double_click": {
        await page.dblclick(action.selector, { timeout });
        return { success: true, result: `Double-clicked ${action.selector}` };
      }

      case "type": {
        await page.type(action.selector, action.text, { delay: action.delay || 50, timeout });
        return { success: true, result: `Typed text into ${action.selector}` };
      }

      case "fill": {
        await page.fill(action.selector, action.text, { timeout });
        return { success: true, result: `Filled ${action.selector}` };
      }

      case "clear": {
        await page.fill(action.selector, "", { timeout });
        return { success: true, result: `Cleared ${action.selector}` };
      }

      case "press": {
        await page.keyboard.press(action.key);
        return { success: true, result: `Pressed ${action.key}` };
      }

      case "scroll": {
        if (action.selector) {
          await page.locator(action.selector).scrollIntoViewIfNeeded({ timeout });
        } else {
          const amount = action.amount || 500;
          const deltaX = action.direction === "left" ? -amount : action.direction === "right" ? amount : 0;
          const deltaY = action.direction === "up" ? -amount : amount; // Default down
          await page.mouse.wheel(deltaX, deltaY);
        }
        return { success: true, result: `Scrolled ${action.direction || "down"}` };
      }

      case "scroll_to": {
        await page.locator(action.selector).scrollIntoViewIfNeeded({ timeout });
        return { success: true, result: `Scrolled to ${action.selector}` };
      }

      case "hover": {
        await page.hover(action.selector, { timeout });
        return { success: true, result: `Hovered over ${action.selector}` };
      }

      case "select": {
        await page.selectOption(action.selector, action.value, { timeout });
        return { success: true, result: `Selected ${action.value} in ${action.selector}` };
      }

      case "check": {
        await page.check(action.selector, { timeout });
        return { success: true, result: `Checked ${action.selector}` };
      }

      case "uncheck": {
        await page.uncheck(action.selector, { timeout });
        return { success: true, result: `Unchecked ${action.selector}` };
      }

      case "screenshot": {
        const screenshotPath = action.path || path.join(os.tmpdir(), `screenshot_${Date.now()}.png`);

        if (action.selector) {
          await page.locator(action.selector).screenshot({ path: screenshotPath, timeout });
        } else {
          await page.screenshot({ path: screenshotPath, fullPage: action.fullPage || false });
        }
        return { success: true, result: `Screenshot saved to ${screenshotPath}` };
      }

      case "wait": {
        if (action.selector) {
          await page.waitForSelector(action.selector, { state: action.state || "visible", timeout });
          return { success: true, result: `Waited for ${action.selector}` };
        } else {
          await page.waitForTimeout(action.milliseconds || 1000);
          return { success: true, result: `Waited ${action.milliseconds || 1000}ms` };
        }
      }

      case "extract": {
        const content = await extractContent(page, action.selector, action.raw || false);
        return { success: true, result: content };
      }

      case "get_text": {
        const text = await page.locator(action.selector).innerText({ timeout });
        return { success: true, result: text };
      }

      case "get_attribute": {
        const value = await page.locator(action.selector).getAttribute(action.attribute, { timeout });
        return { success: true, result: value };
      }

      case "get_url": {
        return { success: true, result: page.url() };
      }

      case "get_title": {
        const title = await page.title();
        return { success: true, result: title };
      }

      case "go_back": {
        await page.goBack({ timeout });
        return { success: true, result: "Navigated back" };
      }

      case "go_forward": {
        await page.goForward({ timeout });
        return { success: true, result: "Navigated forward" };
      }

      case "reload": {
        await page.reload({ timeout });
        return { success: true, result: "Page reloaded" };
      }

      case "new_tab": {
        if (!session) throw new Error("No session");
        const newPage = await session.context.newPage();
        const newPageId = `tab_${Date.now()}`;
        session.pages.set(newPageId, newPage);
        session.activePageId = newPageId;
        setupPageHandlers(newPage);

        if (action.url) {
          await newPage.goto(action.url, { timeout, waitUntil: "domcontentloaded" });
        }
        return { success: true, result: { pageId: newPageId, message: `New tab created${action.url ? ` and navigated to ${action.url}` : ""}` } };
      }

      case "switch_tab": {
        if (!session) throw new Error("No session");
        if (!session.pages.has(action.pageId)) {
          return { success: false, error: `Tab ${action.pageId} not found` };
        }
        session.activePageId = action.pageId;
        return { success: true, result: `Switched to tab ${action.pageId}` };
      }

      case "close_tab": {
        if (!session) throw new Error("No session");
        const pageIdToClose = action.pageId || session.activePageId;
        const pageToClose = session.pages.get(pageIdToClose);

        if (!pageToClose) {
          return { success: false, error: `Tab ${pageIdToClose} not found` };
        }

        await pageToClose.close();
        session.pages.delete(pageIdToClose);

        // Switch to another tab if we closed the active one
        if (pageIdToClose === session.activePageId && session.pages.size > 0) {
          session.activePageId = session.pages.keys().next().value!;
        }

        return { success: true, result: `Closed tab ${pageIdToClose}` };
      }

      case "list_tabs": {
        if (!session) throw new Error("No session");
        const tabs = [];
        const entries = Array.from(session.pages.entries());
        for (const [id, p] of entries) {
          tabs.push({
            id,
            url: p.url(),
            title: await p.title(),
            active: id === session.activePageId,
          });
        }
        return { success: true, result: tabs };
      }

      case "evaluate": {
        const result = await page.evaluate(action.script);
        return { success: true, result };
      }

      case "handle_dialog": {
        // This sets up a one-time handler for the next dialog
        const dialogPromise = new Promise<string>((resolve) => {
          page.once("dialog", async (dialog: Dialog) => {
            if (action.accept) {
              await dialog.accept(action.promptText);
              resolve(`Accepted dialog: ${dialog.message()}`);
            } else {
              await dialog.dismiss();
              resolve(`Dismissed dialog: ${dialog.message()}`);
            }
          });
        });

        // Wait briefly for dialog, but don't block forever
        const result = await Promise.race([
          dialogPromise,
          new Promise<string>((resolve) => setTimeout(() => resolve("No dialog appeared"), 2000)),
        ]);
        return { success: true, result };
      }

      default:
        return { success: false, error: `Unknown action: ${(action as BrowserAction).action}` };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Extract content from page
 */
async function extractContent(page: Page, selector?: string, raw?: boolean): Promise<string> {
  if (raw) {
    if (selector) {
      return await page.locator(selector).innerText();
    }
    return await page.innerText("body");
  }

  return page.evaluate((sel?: string): string => {
    const selectorsToRemove = [
      "script", "style", "noscript", "iframe", "svg", "canvas",
      "video", "audio", "img", "picture", "source", "link", "meta",
      "nav", "footer", "aside", "[role='navigation']", "[role='banner']",
      ".advertisement", ".ad", ".ads", ".cookie-banner", ".popup"
    ];

    // Clone the document to avoid modifying the actual page
    const clone = document.body.cloneNode(true) as HTMLElement;

    selectorsToRemove.forEach(s => {
      try {
        clone.querySelectorAll(s).forEach(el => el.remove());
      } catch { /* ignore */ }
    });

    const lines: string[] = [];

    function processNode(node: Node): void {
      if (node.nodeType === 3) {
        const text = (node.textContent || "").trim();
        if (text) lines.push(text);
        return;
      }

      if (node.nodeType !== 1) return;

      const el = node as Element;
      const tagName = el.tagName.toLowerCase();

      if (/^h[1-6]$/.test(tagName)) {
        const level = parseInt(tagName[1]);
        const text = (el.textContent || "").trim();
        if (text) {
          lines.push("");
          lines.push("#".repeat(level) + " " + text);
          lines.push("");
        }
        return;
      }

      if (tagName === "a") {
        const href = el.getAttribute("href") || "";
        const text = (el.textContent || "").trim();
        if (text && href && !href.startsWith("javascript:")) {
          lines.push(`[${text}](${href})`);
        } else if (text) {
          lines.push(text);
        }
        return;
      }

      if (tagName === "li") {
        const text = (el.textContent || "").trim();
        if (text) lines.push("- " + text);
        return;
      }

      if (tagName === "p") {
        el.childNodes.forEach(child => processNode(child));
        lines.push("");
        return;
      }

      if (tagName === "pre" || tagName === "code") {
        const text = (el.textContent || "").trim();
        if (text) {
          lines.push("```");
          lines.push(text);
          lines.push("```");
        }
        return;
      }

      if (tagName === "tr") {
        const cells: string[] = [];
        el.querySelectorAll("td, th").forEach(cell => {
          cells.push((cell.textContent || "").trim());
        });
        if (cells.length > 0) {
          lines.push("| " + cells.join(" | ") + " |");
        }
        return;
      }

      // Handle form elements - show their state
      if (tagName === "input") {
        const type = el.getAttribute("type") || "text";
        const name = el.getAttribute("name") || el.getAttribute("id") || "";
        const value = (el as HTMLInputElement).value || "";
        const placeholder = el.getAttribute("placeholder") || "";
        lines.push(`[INPUT:${type} name="${name}" value="${value}" placeholder="${placeholder}"]`);
        return;
      }

      if (tagName === "button") {
        const text = (el.textContent || "").trim();
        lines.push(`[BUTTON: ${text}]`);
        return;
      }

      el.childNodes.forEach(child => processNode(child));
    }

    // Use selector or find main content
    let target: Element | null;
    if (sel) {
      target = clone.querySelector(sel);
    } else {
      target = clone.querySelector("main") ||
               clone.querySelector("article") ||
               clone.querySelector("[role='main']") ||
               clone.querySelector(".content") ||
               clone.querySelector("#content") ||
               clone;
    }

    if (target) processNode(target);

    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }, selector);
}

export const browseWebSkill: SkillDefinition = {
  name: "browse_web",
  description: `Full browser automation - navigate, click, type, scroll, screenshot, and more.

MODES:
- "headless": Fast, invisible browser (default)
- "visible": See the browser window
- "chrome": Launch Chrome with a temp profile
- "connect": Connect to YOUR running Chrome (best for logged-in sessions)

TO USE "connect" MODE:
1. Close all Chrome windows
2. Run: chrome.exe --remote-debugging-port=9222
3. Use mode: "connect" - agent will control your actual browser with all your logins!

ACTIONS (pass as array, executed in order):
- navigate: { action: "navigate", url: "..." }
- click: { action: "click", selector: "button.submit" }
- double_click: { action: "double_click", selector: "..." }
- type: { action: "type", selector: "input", text: "hello", delay?: 50 }
- fill: { action: "fill", selector: "input", text: "hello" } (clears first)
- clear: { action: "clear", selector: "input" }
- press: { action: "press", key: "Enter" }
- scroll: { action: "scroll", direction: "down", amount: 500 }
- scroll_to: { action: "scroll_to", selector: "#footer" }
- hover: { action: "hover", selector: ".menu" }
- select: { action: "select", selector: "select#country", value: "US" }
- check/uncheck: { action: "check", selector: "input[type=checkbox]" }
- screenshot: { action: "screenshot", path?: "...", fullPage?: true, selector?: "..." }
- wait: { action: "wait", milliseconds: 1000 } or { action: "wait", selector: ".loaded" }
- extract: { action: "extract", selector?: "main", raw?: false }
- get_text: { action: "get_text", selector: "h1" }
- get_attribute: { action: "get_attribute", selector: "a", attribute: "href" }
- get_url, get_title, go_back, go_forward, reload
- new_tab: { action: "new_tab", url?: "..." }
- switch_tab: { action: "switch_tab", pageId: "tab_123" }
- close_tab: { action: "close_tab", pageId?: "..." }
- list_tabs: { action: "list_tabs" }
- evaluate: { action: "evaluate", script: "return document.title" }
- handle_dialog: { action: "handle_dialog", accept: true, promptText?: "..." }

SESSION: Browser stays open between calls. Use close_session: true to end (won't close your Chrome in connect mode).`,

  permission: PermissionLevel.CONFIRM,

  parameters: {
    type: "object",
    properties: {
      actions: {
        type: "array",
        description: "Array of action objects to perform in sequence. Each action has an 'action' field specifying the type.",
      },
      mode: {
        type: "string",
        enum: ["headless", "visible", "chrome", "connect"],
        description: "Browser mode: headless (fast), visible (watch it), chrome (temp profile), connect (YOUR running Chrome with logins)",
      },
      cdp_url: {
        type: "string",
        description: "CDP endpoint URL for connect mode (default: http://localhost:9222)",
      },
      timeout: {
        type: "number",
        description: "Timeout in ms for each action (default: 30000)",
      },
      close_session: {
        type: "boolean",
        description: "Close/disconnect browser after actions complete",
      },
      // Legacy support for simple URL fetch
      url: {
        type: "string",
        description: "Simple mode: just fetch this URL and extract content",
      },
    },
  },

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const mode = (params.mode as "headless" | "visible" | "chrome" | "connect") || "headless";
    const cdpUrl = params.cdp_url as string | undefined;
    const timeout = (params.timeout as number) || DEFAULT_TIMEOUT;
    const closeAfter = params.close_session as boolean;
    const actions = params.actions as BrowserAction[] | undefined;
    const simpleUrl = params.url as string | undefined;

    try {
      // Initialize session
      await getSession(mode, cdpUrl);

      // Handle simple URL mode (backwards compatible)
      if (simpleUrl && !actions) {
        const navigateResult = await executeAction({ action: "navigate", url: simpleUrl }, timeout);
        if (!navigateResult.success) {
          return { success: false, error: navigateResult.error };
        }

        const extractResult = await executeAction({ action: "extract" }, timeout);
        const titleResult = await executeAction({ action: "get_title" }, timeout);

        let content = extractResult.result as string;
        if (content.length > MAX_CONTENT_LENGTH) {
          content = content.slice(0, MAX_CONTENT_LENGTH) + "\n\n... (content truncated)";
        }

        return {
          success: true,
          output: `# ${titleResult.result}\nURL: ${simpleUrl}\n\n${content}`,
        };
      }

      // Execute action sequence
      if (!actions || actions.length === 0) {
        return {
          success: false,
          error: "No actions provided. Pass 'actions' array or 'url' for simple fetch.",
        };
      }

      const results: { action: string; success: boolean; result?: unknown; error?: string }[] = [];

      for (const action of actions) {
        const result = await executeAction(action, timeout);
        results.push({
          action: action.action,
          ...result,
        });

        // Stop on first error unless it's a non-critical action
        if (!result.success && !["get_text", "get_attribute"].includes(action.action)) {
          break;
        }
      }

      // Close session if requested
      if (closeAfter) {
        await closeSession();
      }

      // Format output
      const lastResult = results[results.length - 1];
      const allSucceeded = results.every(r => r.success);

      // If last action was extract, return that content directly
      if (lastResult.action === "extract" && lastResult.success) {
        let content = lastResult.result as string;
        if (content.length > MAX_CONTENT_LENGTH) {
          content = content.slice(0, MAX_CONTENT_LENGTH) + "\n\n... (content truncated)";
        }
        return {
          success: true,
          output: content,
          metadata: { actions: results, sessionActive: !closeAfter },
        };
      }

      return {
        success: allSucceeded,
        output: allSucceeded
          ? `Completed ${results.length} action(s) successfully`
          : `Failed at action: ${lastResult.action} - ${lastResult.error}`,
        metadata: {
          actions: results,
          sessionActive: !closeAfter && session !== null,
          dialogHistory: session?.dialogHistory || [],
        },
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Browser error: ${errorMessage}`,
      };
    }
  },
};

// Convenience function to close browser (exported for external use)
export const closeBrowser = closeSession;

// Clean up on process exit
process.on("exit", () => {
  if (session?.browser) {
    session.browser.close().catch(() => {});
  }
});

process.on("SIGINT", async () => {
  await closeSession();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeSession();
  process.exit(0);
});
