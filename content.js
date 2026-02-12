// Sci-Hub PDF Downloader — Content Script
// Detects DOIs on journal/paper pages and injects a download button.

(function () {
  "use strict";

  // DOI regex — matches 10.XXXX/... patterns
  const DOI_REGEX = /\b(10\.\d{4,9}\/[^\s"'<>&]+)\b/;

  // Domains where we should NOT inject (search engines, social media, etc.)
  const IGNORE_DOMAINS = [
    "google.com",
    "bing.com",
    "duckduckgo.com",
    "facebook.com",
    "twitter.com",
    "x.com",
    "reddit.com",
    "youtube.com",
    "github.com",
    "sci-hub.",
  ];

  function shouldIgnorePage() {
    const host = window.location.hostname;
    return IGNORE_DOMAINS.some((d) => host.includes(d));
  }

  // Try to extract a DOI from the page, in priority order.
  function detectDOI() {
    // 1. Meta tags (most reliable — publishers always include these)
    const metaSelectors = [
      'meta[name="citation_doi"]',
      'meta[name="dc.identifier"][scheme="doi"]',
      'meta[name="dc.identifier"]',
      'meta[name="DC.identifier"]',
      'meta[name="DC.Identifier"]',
      'meta[name="doi"]',
      'meta[name="DOI"]',
      'meta[property="citation_doi"]',
      'meta[name="prism.doi"]',
      'meta[name="bepress_citation_doi"]',
      'meta[name="eprints.id_number"]',
    ];

    for (const sel of metaSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const content = el.getAttribute("content") || "";
        // Strip "doi:" prefix if present
        const cleaned = content.replace(/^(doi:|https?:\/\/doi\.org\/)/, "");
        const match = cleaned.match(DOI_REGEX);
        if (match) return match[1];
      }
    }

    // 2. URL patterns
    const url = window.location.href;

    // doi.org / dx.doi.org direct links
    const doiOrgMatch = url.match(
      /https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/[^\s?#]+)/
    );
    if (doiOrgMatch) return doiOrgMatch[1];

    // DOI embedded in common publisher URL paths
    const urlDoiMatch = url.match(
      /\/(?:doi|article|abs|full|pdf)\/?(10\.\d{4,9}\/[^\s?#]+)/
    );
    if (urlDoiMatch) return urlDoiMatch[1];

    // 3. Schema.org / JSON-LD
    const ldScripts = document.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    for (const script of ldScripts) {
      try {
        const data = JSON.parse(script.textContent);
        const doi = extractDOIFromLD(data);
        if (doi) return doi;
      } catch (e) {
        // ignore parse errors
      }
    }

    // 4. Links to doi.org (catches IEEE and many other publishers)
    const doiLinks = document.querySelectorAll(
      'a[href*="doi.org/10."], a[href*="dx.doi.org/10."]'
    );
    for (const link of doiLinks) {
      const href = link.getAttribute("href") || "";
      const match = href.match(
        /(?:dx\.)?doi\.org\/(10\.\d{4,9}\/[^\s?#"']+)/
      );
      if (match) return match[1];
    }

    // 5. DOI in JavaScript objects / inline scripts (IEEE xplGlobal, etc.)
    const scripts = document.querySelectorAll("script:not([src])");
    for (const script of scripts) {
      const txt = script.textContent || "";
      // Match "doi":"10.xxxx/..." or 'doi':'10.xxxx/...' or doi: "10.xxxx/..."
      const doiStringMatch = txt.match(
        /["']?doi["']?\s*[:=]\s*["'](10\.\d{4,9}\/[^"']+)["']/i
      );
      if (doiStringMatch) return doiStringMatch[1];
    }

    // 6. Visible DOI text on page (last resort, limited scope)
    // Only check specific containers to avoid false positives
    const containers = document.querySelectorAll(
      [
        ".article-header",
        ".article-info",
        ".citation",
        ".doi",
        '[class*="doi"]',
        '[class*="DOI"]',
        '[id*="doi"]',
        ".metadata",
        ".article-meta",
        "header",
      ].join(",")
    );

    for (const container of containers) {
      const text = container.textContent || "";
      const match = text.match(DOI_REGEX);
      if (match) return match[1];
    }

    return null;
  }

  function extractDOIFromLD(data) {
    if (!data) return null;
    if (Array.isArray(data)) {
      for (const item of data) {
        const result = extractDOIFromLD(item);
        if (result) return result;
      }
      return null;
    }
    if (typeof data === "object") {
      // Check common LD+JSON DOI fields
      for (const key of ["doi", "DOI", "@id", "identifier", "sameAs"]) {
        const val = data[key];
        if (typeof val === "string") {
          const cleaned = val.replace(/^(doi:|https?:\/\/doi\.org\/)/, "");
          const match = cleaned.match(DOI_REGEX);
          if (match) return match[1];
        }
        if (Array.isArray(val)) {
          for (const item of val) {
            if (typeof item === "string") {
              const cleaned = item.replace(
                /^(doi:|https?:\/\/doi\.org\/)/,
                ""
              );
              const match = cleaned.match(DOI_REGEX);
              if (match) return match[1];
            }
          }
        }
      }
    }
    return null;
  }

  // Clean trailing punctuation that regex may have captured
  function cleanDOI(doi) {
    // Remove trailing periods, commas, semicolons, closing parens/brackets
    return doi.replace(/[.,;)\]]+$/, "");
  }

  function injectButton(doi) {
    // Don't inject twice
    if (document.getElementById("scihub-ext-btn")) return;

    const btn = document.createElement("div");
    btn.id = "scihub-ext-btn";
    btn.title = "Download PDF from Sci-Hub\nDOI: " + doi;

    btn.innerHTML = `
      <div class="scihub-ext-inner">
        <span class="scihub-ext-icon">&#128218;</span>
        <span class="scihub-ext-label">Sci-Hub PDF</span>
      </div>
      <div class="scihub-ext-status" id="scihub-ext-status"></div>
    `;

    btn.addEventListener("click", function () {
      downloadPDF(doi);
    });

    document.body.appendChild(btn);
  }

  function setStatus(msg, isError) {
    const el = document.getElementById("scihub-ext-status");
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? "block" : "none";
    el.style.color = isError ? "#ff6b6b" : "#a0a0a0";
  }

  function downloadPDF(doi) {
    const btn = document.getElementById("scihub-ext-btn");
    if (!btn) return;

    // Disable button during download
    btn.classList.add("scihub-ext-loading");
    setStatus("Fetching...", false);

    // Send message to background service worker
    chrome.runtime.sendMessage(
      { action: "downloadPDF", doi: doi },
      function (response) {
        if (chrome.runtime.lastError) {
          setStatus("Extension error", true);
          btn.classList.remove("scihub-ext-loading");
          return;
        }

        if (response && response.success) {
          setStatus("Downloaded!", false);
          btn.classList.remove("scihub-ext-loading");
          setTimeout(() => setStatus("", false), 3000);
        } else {
          const err = response ? response.error : "Unknown error";
          setStatus(err, true);
          btn.classList.remove("scihub-ext-loading");
        }
      }
    );
  }

  // Main
  function init() {
    if (shouldIgnorePage()) return;

    const doi = detectDOI();
    if (!doi) return;

    const cleaned = cleanDOI(doi);
    if (!cleaned) return;

    injectButton(cleaned);
  }

  // Run after page is fully loaded
  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init);
  }

  // Retry after a delay for SPAs that load metadata dynamically
  // (IEEE, some Elsevier pages, etc.)
  if (!document.getElementById("scihub-ext-btn")) {
    setTimeout(function () {
      if (!document.getElementById("scihub-ext-btn")) {
        init();
      }
    }, 2000);
  }
})();
