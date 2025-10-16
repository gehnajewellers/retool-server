import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(cors({ origin: "https://retool-page.vercel.app" })); // change if needed
app.use(express.json());

const SHOPIFY_STORE = process.env.STORE_NAME;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

// Helper function to update all products
async function updateAllProducts(gold_rate_14, gold_rate_18, labour_rate_less, labour_rate_greater, gst_rate) {
  let hasMore = true;
  let nextPageInfo = null;
  let updatedCount = 0;

  while (hasMore) {
    const url = new URL(`https://${SHOPIFY_STORE}/admin/api/2023-10/products.json`);
    url.searchParams.set("limit", "50");
    url.searchParams.set("status", "active");
    if (nextPageInfo) url.searchParams.set("page_info", nextPageInfo);

    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": ACCESS_TOKEN }
    });

    if (!res.ok) {
      console.error("❌ Error fetching products:", res.statusText);
      break;
    }

    const data = await res.json();
    if (!data.products || data.products.length === 0) break;

    for (const product of data.products) {
      try {
        // Fetch metafields for this product
        const metaRes = await fetch(
          `https://${SHOPIFY_STORE}/admin/api/2023-10/products/${product.id}/metafields.json`,
          { headers: { "X-Shopify-Access-Token": ACCESS_TOKEN } }
        );

        const { metafields } = await metaRes.json();
        if (!metafields) continue;

        let gold_weight = parseFloat(metafields.find(m => m.key === "gold_weight")?.value) || 0 ;
        let diamond_price = parseInt(metafields.find(m => m.key === "diamond_cost")?.value) || 0;
        let product_purity = parseInt(metafields.find(m => m.key === "gold_purity")?.value) || 0 ;
        let colour_stone_price = parseInt(metafields.find(m => m.key === "colour_stone_cost")?.value) || 0;

        console.log({gold_weight, diamond_price, product_purity, colour_stone_price});

        // calculate gold price
        const appliedGoldRate = product_purity === 18 ? gold_rate_18 : gold_rate_14;
        const goldPrice = appliedGoldRate * gold_weight;

        // calculate labour price
        const appliedlabourRate = gold_weight < 5 ? labour_rate_less : labour_rate_greater
        const labourPrice = appliedlabourRate * gold_weight;

        // calculate product base price
        const basePrice = goldPrice + labourPrice + diamond_price + colour_stone_price;

        // calculate product final price
        const finalPrice = basePrice + (basePrice * gst_rate / 100);
        
        const variantId = product.variants[0]?.id;
        if (variantId) {
          const updateRes = await fetch(
            `https://${SHOPIFY_STORE}/admin/api/2023-10/variants/${variantId}.json`,
            {
              method: "PUT",
              headers: {
                "X-Shopify-Access-Token": ACCESS_TOKEN,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                variant: {
                  id: variantId,
                  price: finalPrice.toFixed(2)
                }
              })
            }
          );

          if (updateRes.ok) {
            console.log(`✅ Updated ${product.title} → ₹${finalPrice.toFixed(2)}`);
            updatedCount++;
          } else {
            console.warn(`⚠️ Failed updating ${product.title}`);
          }
        }
      } catch (err) {
        console.error(`❌ Error with ${product.title}:`, err.message);
      }
    }

    // Handle pagination (from Link header)
    const linkHeader = res.headers.get("link");
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/page_info=([^&>]+)/);
      nextPageInfo = match ? match[1] : null;
      hasMore = !!nextPageInfo;
    } else {
      hasMore = false;
    }
  }

  return updatedCount;
}
// Route
app.post("/update-prices", async (req, res) => {
  try {
    const { gold_rate_14, gold_rate_18, labour_rate_less, labour_rate_greater, gst_rate } = req.body;
    const updatedCount = await updateAllProducts(gold_rate_14, gold_rate_18, labour_rate_less, labour_rate_greater, gst_rate);
    res.json({ message: "Prices updated successfully", updatedCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.toString() });
  }
});

app.listen(3000, () => console.log("🚀 Server running"));
