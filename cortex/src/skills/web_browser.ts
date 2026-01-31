/**
 * web_browser skill - Browse web pages using Playwright
 * Permission: CONFIRM (network access, but read-only)
 */

import { chromium, Browser, Page } from "playwright";
import { SkillDefinition, PermissionLevel, SkillResult } from "../types.js";

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_CONTENT_LENGTH = 50000; // 50KB to save tokens

// Browser instance for reuse
let browserInstance: Browser | null = null;

/**
 * Get or create a browser instance
 */
async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({
      headless: true,
    });
  }
  return browserInstance;
}

/**
 * Close the browser instance
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance && browserInstance.isConnected()) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * Extract simplified content from the page
 * Runs entirely in browser context to avoid TypeScript DOM type issues
 */
async function extractContent(page: Page): Promise<string> {
  // This function runs in the browser context
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return page.evaluate((): string => {
    // Remove non-content elements
    const selectorsToRemove = [
      "script", "style", "noscript", "iframe", "svg", "canvas",
      "video", "audio", "img", "picture", "source", "link", "meta",
      "nav", "footer", "aside", "[role='navigation']", "[role='banner']",
      ".advertisement", ".ad", ".ads", ".cookie-banner", ".popup"
    ];

    selectorsToRemove.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(el => el.remove());
      } catch {
        // Ignore invalid selectors
      }
    });

    const lines: string[] = [];

    // Process a node and its children
    function processNode(node: Node, depth: number): void {
      if (node.nodeType === 3) { // TEXT_NODE
        const text = (node.textContent || "").trim();
        if (text) {
          lines.push(text);
        }
        return;
      }

      if (node.nodeType !== 1) return; // Not ELEMENT_NODE

      const el = node as Element;
      const tagName = el.tagName.toLowerCase();

      // Handle headers
      if (/^h[1-6]$/.test(tagName)) {
        const level = parseInt(tagName[1]);
        const prefix = "#".repeat(level) + " ";
        const text = (el.textContent || "").trim();
        if (text) {
          lines.push("");
          lines.push(prefix + text);
          lines.push("");
        }
        return;
      }

      // Handle links
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

      // Handle list items
      if (tagName === "li") {
        const text = (el.textContent || "").trim();
        if (text) {
          lines.push("- " + text);
        }
        return;
      }

      // Handle paragraphs
      if (tagName === "p") {
        el.childNodes.forEach(child => processNode(child, depth + 1));
        lines.push("");
        return;
      }

      // Handle code blocks
      if (tagName === "pre" || tagName === "code") {
        const text = (el.textContent || "").trim();
        if (text) {
          lines.push("```");
          lines.push(text);
          lines.push("```");
        }
        return;
      }

      // Handle table rows
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

      // Default: process children
      el.childNodes.forEach(child => processNode(child, depth));
    }

    // Find main content area
    const mainContent =
      document.querySelector("main") ||
      document.querySelector("article") ||
      document.querySelector("[role='main']") ||
      document.querySelector(".content") ||
      document.querySelector("#content") ||
      document.body;

    if (mainContent) {
      processNode(mainContent, 0);
    }

    // Clean up output
    return lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  });
}

export const browseWebSkill: SkillDefinition = {
  name: "browse_web",
  description:
    "Browse a web page and extract its text content. " +
    "Returns the page content in a simplified markdown-like format to save tokens. " +
    "Use this to read web pages, check news, documentation, or any public URL.",
  permission: PermissionLevel.CONFIRM,
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to browse (must include protocol, e.g., https://)",
      },
      wait_for: {
        type: "string",
        description:
          "Optional CSS selector to wait for before extracting content. " +
          "Useful for pages that load content dynamically.",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds. Defaults to 30000 (30 seconds).",
      },
      raw_text: {
        type: "boolean",
        description:
          "If true, returns raw innerText instead of simplified markdown. " +
          "Default is false (returns simplified markdown).",
      },
    },
    required: ["url"],
  },

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const url = params.url as string;
    const waitFor = params.wait_for as string | undefined;
    const timeout = (params.timeout as number) || DEFAULT_TIMEOUT;
    const rawText = params.raw_text as boolean | undefined;

    // Validate URL
    try {
      new URL(url);
    } catch {
      return {
        success: false,
        error: `Invalid URL: ${url}. URL must include protocol (e.g., https://)`,
      };
    }

    let page: Page | null = null;

    try {
      const browser = await getBrowser();
      page = await browser.newPage();

      // Set reasonable defaults
      await page.setViewportSize({ width: 1280, height: 800 });

      // Navigate to the URL
      await page.goto(url, {
        timeout,
        waitUntil: "domcontentloaded",
      });

      // Wait for specific element if requested
      if (waitFor) {
        await page.waitForSelector(waitFor, { timeout });
      }

      // Small delay to allow dynamic content to load
      await page.waitForTimeout(500);

      // Extract content
      let content: string;
      if (rawText) {
        content = await page.innerText("body");
      } else {
        content = await extractContent(page);
      }

      // Get page title
      const title = await page.title();

      // Truncate if too long
      if (content.length > MAX_CONTENT_LENGTH) {
        content = content.slice(0, MAX_CONTENT_LENGTH) + "\n\n... (content truncated)";
      }

      // Format output
      const output = `# ${title}\nURL: ${url}\n\n${content}`;

      return {
        success: true,
        output,
        metadata: {
          url,
          title,
          contentLength: content.length,
          truncated: content.length > MAX_CONTENT_LENGTH,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for common errors
      if (errorMessage.includes("net::ERR_NAME_NOT_RESOLVED")) {
        return {
          success: false,
          error: `Could not resolve hostname for URL: ${url}`,
        };
      }
      if (errorMessage.includes("net::ERR_CONNECTION_REFUSED")) {
        return {
          success: false,
          error: `Connection refused for URL: ${url}`,
        };
      }
      if (errorMessage.includes("Timeout")) {
        return {
          success: false,
          error: `Page load timed out after ${timeout}ms for URL: ${url}`,
        };
      }

      return {
        success: false,
        error: `Failed to browse ${url}: ${errorMessage}`,
      };
    } finally {
      // Always close the page to free resources
      if (page) {
        await page.close().catch(() => {});
      }
    }
  },
};

// Clean up browser on process exit
process.on("exit", () => {
  if (browserInstance) {
    browserInstance.close().catch(() => {});
  }
});

process.on("SIGINT", async () => {
  await closeBrowser();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeBrowser();
  process.exit(0);
});
