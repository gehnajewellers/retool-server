import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const SHOPIFY_STORE = process.env.STORE_NAME;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

// Helper: delay
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Retry on 429
async function fetchWithRetry(url, options, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429) return res;

    const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
    console.log(`⚠️ 429 received. Retrying after ${retryAfter}s (attempt ${attempt + 1})`);
    await delay(retryAfter * 1000);
  }
  throw new Error("Max retries reached for 429");
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "https://retool-page.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { products, gold_rate_14, gold_rate_18, gold_rate_22, labour_rate_less, labour_rate_greater, gst_rate } = req.body;

    const results = [];

    for (const product of products) {
      try {
        const metaRes = await fetchWithRetry(
          `https://${SHOPIFY_STORE}/admin/api/2023-10/products/${product.id}/metafields.json`,
          { headers: { "X-Shopify-Access-Token": ACCESS_TOKEN } }
        );

        const { metafields } = await metaRes.json();
        if (!metafields) continue;

        const gold_weight = parseFloat(metafields.find(m => m.key === "gold_weight")?.value) || 0;
        const diamond_price = parseInt(metafields.find(m => m.key === "diamond_cost")?.value) || 0;
        const product_purity = parseInt(metafields.find(m => m.key === "gold_purity")?.value) || 18;
        const colour_stone_price = parseInt(metafields.find(m => m.key === "colour_stone_cost")?.value) || 0;

        const goldRates = {
          14: gold_rate_14,
          18: gold_rate_18,
          22: gold_rate_22
        };

        const appliedGoldRate = goldRates[product_purity] || gold_rate_18;
        const goldPrice = appliedGoldRate * gold_weight;
        const appliedLabourRate = gold_weight < 5 ? labour_rate_less : labour_rate_greater;
        const labourPrice = appliedLabourRate * gold_weight;
        const basePrice = goldPrice + labourPrice + diamond_price + colour_stone_price;
        const finalPrice = basePrice + (basePrice * gst_rate / 100);

        if (product.variantId) {
          await fetchWithRetry(
            `https://${SHOPIFY_STORE}/admin/api/2023-10/variants/${product.variantId}.json`,
            {
              method: "PUT",
              headers: {
                "X-Shopify-Access-Token": ACCESS_TOKEN,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ variant: { id: product.variantId, price: finalPrice.toFixed(2) } })
            }
          );
          
          console.log(`✅ Updated ${product.title} → ₹${finalPrice.toFixed(2)}`);
          results.push({ id: product.id, title: product.title, status: "success", price: finalPrice.toFixed(2) });
        }
        await delay(400); // throttle
      } catch (err) {
        console.warn(`⚠️ Failed updating ${product.title}:`, err.message);
        results.push({ id: product.id, title: product.title, status: "failed", error: err.message });
      }
    }

    res.status(200).json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.toString() });
  }
}
