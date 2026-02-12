// Sci-Hub PDF Downloader — Background Service Worker
// Receives DOI from content script, fetches from Sci-Hub, parses PDF URL,
// downloads the PDF directly.
//
// NOTE: DOMParser is NOT available in Manifest V3 service workers.
// All HTML parsing uses regex instead.

// Sci-Hub mirrors in priority order
const SCIHUB_MIRRORS = [
  "https://sci-hub.vg",
  "https://sci-hub.al",
  "https://sci-hub.mk",
  "https://sci-hub.ru",
];

// Listen for messages from content script
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "downloadPDF" && request.doi) {
    handleDownload(request.doi)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    // Return true to indicate async response
    return true;
  }
});

async function handleDownload(doi) {
  let lastError = null;

  for (const mirror of SCIHUB_MIRRORS) {
    try {
      const pdfUrl = await findPDFUrl(mirror, doi);
      if (!pdfUrl) {
        lastError = "Could not find PDF URL";
        continue;
      }

      await downloadFromUrl(pdfUrl, doi);
      return { success: true };
    } catch (err) {
      lastError = err.message;
      console.log(
        `Sci-Hub ext: mirror ${mirror} failed for ${doi}: ${err.message}`
      );
      continue;
    }
  }

  return { success: false, error: lastError || "All mirrors failed" };
}

async function findPDFUrl(mirror, doi) {
  const url = mirror + "/" + doi;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  // If Sci-Hub returned the PDF directly
  const contentType = res.headers.get("Content-Type") || "";
  if (contentType.includes("application/pdf")) {
    return res.url;
  }

  const html = await res.text();

  // Check for Cloudflare challenge
  if (html.includes("Just a moment") && html.includes("cf_chl")) {
    throw new Error("Cloudflare challenge");
  }

  // --- Regex-based HTML parsing (DOMParser not available in service workers) ---

  // Try iframe src (sci-hub.vg)
  const iframeMatch = html.match(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/i);
  if (iframeMatch) {
    return normalizeUrl(iframeMatch[1], mirror);
  }

  // Try embed with type=application/pdf (sci-hub.al, sci-hub.mk)
  const embedPdfMatch = html.match(
    /<embed[^>]+type\s*=\s*["']application\/pdf["'][^>]+src\s*=\s*["']([^"']+)["']/i
  );
  if (embedPdfMatch) {
    return normalizeUrl(embedPdfMatch[1], mirror);
  }
  // Also try embed where src comes before type
  const embedPdfMatch2 = html.match(
    /<embed[^>]+src\s*=\s*["']([^"']+)["'][^>]+type\s*=\s*["']application\/pdf["']/i
  );
  if (embedPdfMatch2) {
    return normalizeUrl(embedPdfMatch2[1], mirror);
  }
  // Fallback: any embed with src
  const embedMatch = html.match(/<embed[^>]+src\s*=\s*["']([^"']+)["']/i);
  if (embedMatch) {
    return normalizeUrl(embedMatch[1], mirror);
  }

  // Try object data (sci-hub.ru)
  const objectMatch = html.match(/<object[^>]+data\s*=\s*["']([^"']+)["']/i);
  if (objectMatch) {
    const dataUrl = objectMatch[1];
    if (
      dataUrl.includes(".pdf") ||
      dataUrl.includes("/pdf/") ||
      dataUrl.includes("/storage/")
    ) {
      return normalizeUrl(dataUrl, mirror);
    }
  }

  // Try button onclick with location.href
  const buttonMatches = html.matchAll(
    /<button[^>]+onclick\s*=\s*["']([^"']+)["']/gi
  );
  for (const bm of buttonMatches) {
    const onclick = bm[1];
    const locMatch = onclick.match(
      /location\.href\s*=\s*['"]([^'"]+\.pdf[^'"]*)/
    );
    if (locMatch) {
      return normalizeUrl(locMatch[1].replace(/\\\//g, "/"), mirror);
    }
  }

  // Try script tags for PDF URLs
  const scriptMatches = html.matchAll(
    /<script[^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const sm of scriptMatches) {
    const txt = sm[1];
    const pdfMatch = txt.match(/(https?:\/\/[^\s"<>']+\.pdf[^\s"<>']*)/);
    if (pdfMatch) {
      return pdfMatch[1];
    }
  }

  // Try any src/href containing .pdf as last resort
  const anyPdfMatch = html.match(
    /(?:src|href|data)\s*=\s*["']((?:https?:)?\/\/[^"']+\.pdf[^"']*)/i
  );
  if (anyPdfMatch) {
    return normalizeUrl(anyPdfMatch[1], mirror);
  }

  return null;
}

function normalizeUrl(url, mirror) {
  if (!url) return null;
  url = url.trim();
  // Unescape HTML entities
  url = url.replace(/&amp;/g, "&");
  // Strip fragments
  url = url.replace(/#.*$/, "");

  if (url.startsWith("//")) {
    return "https:" + url;
  } else if (url.startsWith("/")) {
    return mirror + url;
  } else if (url.startsWith("http")) {
    return url;
  } else {
    return mirror + "/" + url;
  }
}

async function downloadFromUrl(pdfUrl, doi) {
  // Validate with a HEAD request first (avoid downloading non-PDFs)
  try {
    const headRes = await fetch(pdfUrl, { method: "HEAD" });
    const contentType = headRes.headers.get("Content-Type") || "";
    if (
      !contentType.includes("application/pdf") &&
      !contentType.includes("application/octet-stream") &&
      !contentType.includes("application/x-pdf")
    ) {
      // Some servers don't support HEAD or return wrong content-type for HEAD,
      // so fall through and try the download anyway
      console.log(
        "Sci-Hub ext: HEAD content-type was " + contentType + ", trying download anyway"
      );
    }
  } catch (e) {
    // HEAD failed — proceed with download anyway
  }

  // Generate filename from DOI
  const filename =
    doi.replace(/\//g, "_").replace(/[^a-zA-Z0-9._-]/g, "") + ".pdf";

  // NOTE: URL.createObjectURL is NOT available in service workers.
  // Pass the URL directly to chrome.downloads — Chrome fetches it natively.
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: pdfUrl,
        filename: filename,
        saveAs: false,
      },
      function (downloadId) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(downloadId);
        }
      }
    );
  });
}
