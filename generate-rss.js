const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");
const RSS = require("rss");

const flareSolverrURL = process.env.FLARESOLVERR_URL || "http://localhost:8191";

fs.mkdirSync("./feeds", { recursive: true });

// ─── FlareSolverr ────────────────────────────────────────────────────────────

async function fetchWithFlareSolverr(url) {
  try {
    console.log(`Fetching ${url} via FlareSolverr...`);
    const response = await axios.post(
      `${flareSolverrURL}/v1`,
      { cmd: "request.get", url, maxTimeout: 60000 },
      { headers: { "Content-Type": "application/json" }, timeout: 65000 }
    );
    if (response.data?.solution) {
      console.log(`✅ FlareSolverr bypassed protection for: ${url}`);
      return response.data.solution.response;
    }
    throw new Error("FlareSolverr did not return a solution");
  } catch (error) {
    console.error(`❌ FlareSolverr error for ${url}:`, error.message);
    throw error;
  }
}

// ─── Date Parser ─────────────────────────────────────────────────────────────

function parsePublishDate(text) {
  if (!text) return new Date();
  const cleaned = text.replace("Published :", "").trim();
  const parsed = new Date(cleaned);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

// ─── Scraper + RSS Generator ─────────────────────────────────────────────────

async function generateRSS({ baseURL, targetURL, outputFile, feedTitle, feedDescription, language }) {
  console.log(`\n📡 Starting RSS generation for: ${targetURL}`);

  try {
    const htmlContent = await fetchWithFlareSolverr(targetURL);
    const $ = cheerio.load(htmlContent);
    const items = [];

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
          image: imgSrc || null
        });
      }
    });

    console.log(`📰 Found ${items.length} articles from ${targetURL}`);

    const feed = new RSS({
      title: feedTitle,
      description: feedDescription,
      feed_url: `${baseURL}/feed.xml`,
      site_url: baseURL,
      language,
      pubDate: new Date().toUTCString()
    });

    if (items.length === 0) {
      console.warn(`⚠️ No articles found for ${targetURL}, inserting placeholder`);
      feed.item({
        title: "No articles found",
        url: baseURL,
        description: "RSS feed could not scrape any articles.",
        date: new Date()
      });
    } else {
      items.slice(0, 20).forEach(item => {
        feed.item({
          title: item.title,
          url: item.link,
          description: item.description || "",
          date: item.date || new Date(),
          ...(item.image && { enclosure: { url: item.image } })
        });
      });
    }

    fs.writeFileSync(outputFile, feed.xml({ indent: true }));
    console.log(`✅ RSS written to ${outputFile} (${Math.min(items.length, 20)} items)`);

  } catch (err) {
    console.error(`❌ Failed to generate RSS for ${targetURL}:`, err.message);

    const feed = new RSS({
      title: `${feedTitle} (error fallback)`,
      description: "RSS feed could not scrape, showing placeholder",
      feed_url: `${baseURL}/feed.xml`,
      site_url: baseURL,
      language,
      pubDate: new Date().toUTCString()
    });
    feed.item({
      title: "Feed generation failed",
      url: baseURL,
      description: `An error occurred during scraping: ${err.message}`,
      date: new Date()
    });
    fs.writeFileSync(outputFile, feed.xml({ indent: true }));
    console.log(`⚠️ Error fallback feed written to ${outputFile}`);
  }
}

// ─── Run Both Feeds ───────────────────────────────────────────────────────────

async function main() {
  await Promise.all([
    generateRSS({
      baseURL: "https://bdnews24.com",
      targetURL: "https://bdnews24.com/archive",
      outputFile: "./feeds/feed.xml",
      feedTitle: "bdnews24.com – Latest News",
      feedDescription: "Latest news from bdnews24.com archive",
      language: "en"
    }),
    generateRSS({
      baseURL: "https://bangla.bdnews24.com",
      targetURL: "https://bangla.bdnews24.com/archive",
      outputFile: "./feeds/feed-bangla.xml",
      feedTitle: "bdnews24.com – সর্বশেষ বাংলা সংবাদ",
      feedDescription: "bangla.bdnews24.com আর্কাইভ থেকে সর্বশেষ সংবাদ",
      language: "bn"
    })
  ]);

  console.log("\n🎉 All feeds generated successfully.");
}

main();
