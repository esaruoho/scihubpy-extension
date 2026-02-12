// Sci-Hub PDF Downloader — Background Service Worker
// Receives DOI from content script, fetches from Sci-Hub, parses PDF URL,
// downloads the PDF directly.

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

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Try iframe (sci-hub.vg)
  const iframe = doc.querySelector("iframe[src]");
  if (iframe) {
    return normalizeUrl(iframe.getAttribute("src"), mirror);
  }

  // Try embed with type=application/pdf (sci-hub.al, sci-hub.mk)
  let embed = doc.querySelector('embed[type="application/pdf"][src]');
  if (embed) {
    return normalizeUrl(embed.getAttribute("src"), mirror);
  }
  // Fallback: any embed with src
  embed = doc.querySelector("embed[src]");
  if (embed) {
    return normalizeUrl(embed.getAttribute("src"), mirror);
  }

  // Try object data (sci-hub.ru)
  const obj = doc.querySelector("object[data]");
  if (obj) {
    const dataUrl = obj.getAttribute("data");
    if (
      dataUrl.includes(".pdf") ||
      dataUrl.includes("/pdf/") ||
      dataUrl.includes("/storage/")
    ) {
      return normalizeUrl(dataUrl, mirror);
    }
  }

  // Try button onclick with location.href
  const buttons = doc.querySelectorAll("button[onclick]");
  for (const btn of buttons) {
    const onclick = btn.getAttribute("onclick");
    const match = onclick.match(
      /location\.href\s*=\s*['"]([^'"]+\.pdf[^'"]*)/
    );
    if (match) {
      return normalizeUrl(match[1].replace(/\\\//g, "/"), mirror);
    }
  }

  // Try script tags for PDF URLs
  const scripts = doc.querySelectorAll("script");
  for (const script of scripts) {
    const txt = script.textContent || "";
    const match = txt.match(/(https?:\/\/[^\s"<>']+\.pdf[^\s"<>']*)/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function normalizeUrl(url, mirror) {
  if (!url) return null;
  url = url.trim();
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
  // Verify it's actually a PDF by fetching the first few bytes
  const res = await fetch(pdfUrl);
  const contentType = res.headers.get("Content-Type") || "";

  if (!contentType.includes("application/pdf")) {
    throw new Error("Response is not a PDF (got " + contentType + ")");
  }

  const blob = await res.blob();

  // Validate PDF magic bytes
  const header = await blob.slice(0, 5).text();
  if (!header.startsWith("%PDF-")) {
    throw new Error("Invalid PDF content");
  }

  // Generate filename from DOI
  const filename = doi.replace(/\//g, "_").replace(/[^a-zA-Z0-9._-]/g, "") + ".pdf";

  // Create object URL and trigger download
  const blobUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: blobUrl,
        filename: filename,
        saveAs: false,
      },
      function (downloadId) {
        if (chrome.runtime.lastError) {
          URL.revokeObjectURL(blobUrl);
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          // Clean up blob URL after a delay
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
          resolve(downloadId);
        }
      }
    );
  });
}
