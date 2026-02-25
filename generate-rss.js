const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");
const RSS = require("rss");

const baseURL = "https://bdnews24.com";
const targetURL = "https://bdnews24.com/archive";
const flareSolverrURL = process.env.FLARESOLVERR_URL || "http://localhost:8191";

// Ensure feeds folder exists
fs.mkdirSync("./feeds", { recursive: true });

async function fetchWithFlareSolverr(url) {
  try {
    console.log(`Fetching ${url} via FlareSolverr...`);

    const response = await axios.post(
      `${flareSolverrURL}/v1`,
      {
        cmd: "request.get",
        url: url,
        maxTimeout: 60000
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 65000
      }
    );

    if (response.data && response.data.solution) {
      console.log("✅ FlareSolverr successfully bypassed protection");
      return response.data.solution.response;
    } else {
      throw new Error("FlareSolverr did not return a solution");
    }
  } catch (error) {
    console.error("❌ FlareSolverr error:", error.message);
    throw error;
  }
}

// Parse "Published : 25 Feb 2026, 11:05 AM" into a Date object
function parsePublishDate(text) {
  if (!text) return new Date();
  const cleaned = text.replace("Published :", "").trim();
  const parsed = new Date(cleaned);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function generateRSS() {
  try {
    // Fetch page content using FlareSolverr
    const htmlContent = await fetchWithFlareSolverr(targetURL);

    const $ = cheerio.load(htmlContent);
    const items = [];

    // Scrape archive articles from #data-wrapper inside .SubCat-wrapper
    $("#data-wrapper .SubCat-wrapper").each((_, el) => {
      const $wrapper = $(el);
      const $link = $wrapper.find("a").first();

      const href = $link.attr("href");
      const title = $link.find("h5").text().trim();
      const category = $link.find(".category-arch").text().trim();
      const publishTimeText = $link.find(".publish-time").text().trim();
      const imgSrc = $link.find("img").attr("src");

      if (title && href) {
        const link = href.startsWith("http") ? href : baseURL + href;
        items.push({
          title,
          link,
          description: category ? `[${category}] ${title}` : title,
          date: parsePublishDate(publishTimeText),
          image: imgSrc
        });
      }
    });

    console.log(`Found ${items.length} articles`);

    // Fallback: dummy item if no articles found
    if (items.length === 0) {
      console.log("⚠️ No articles found, creating dummy item");
      items.push({
        title: "No articles found yet",
        link: baseURL,
        description: "RSS feed could not scrape any articles.",
        date: new Date()
      });
    }

    // Create RSS feed
    const feed = new RSS({
      title: "bdnews24.com – Latest News",
      description: "Latest news from bdnews24.com archive",
      feed_url: `${targetURL}/feed.xml`,
      site_url: baseURL,
      language: "en",
      pubDate: new Date().toUTCString()
    });

    items.slice(0, 20).forEach(item => {
      feed.item({
        title: item.title,
        url: item.link,
        description: item.description || "",
        date: item.date || new Date(),
        enclosure: item.image ? { url: item.image } : undefined
      });
    });

    // Write feed.xml
    const xml = feed.xml({ indent: true });
    fs.writeFileSync("./feeds/feed.xml", xml);
    console.log(`✅ RSS generated with ${items.length} items.`);
  } catch (err) {
    console.error("❌ Error generating RSS:", err.message);

    // Create dummy feed on error
    const feed = new RSS({
      title: "bdnews24.com (error fallback)",
      description: "RSS feed could not scrape, showing placeholder",
      feed_url: `${targetURL}/feed.xml`,
      site_url: baseURL,
      language: "en",
      pubDate: new Date().toUTCString()
    });
    feed.item({
      title: "Feed generation failed",
      url: baseURL,
      description: "An error occurred during scraping.",
      date: new Date()
    });
    fs.writeFileSync("./feeds/feed.xml", feed.xml({ indent: true }));
  }
}

generateRSS();