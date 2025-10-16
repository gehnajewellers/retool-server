import fetch from "node-fetch";
import dotenv from "dotenv";
// import cors from "cors";
// import express from "express";

dotenv.config();

const SHOPIFY_STORE = process.env.STORE_NAME;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

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

    if (!res.ok) break;

    const data = await res.json();
    if (!data.products || data.products.length === 0) break;

    for (const product of data.products) {
      try {
        const metaRes = await fetch(
          `https://${SHOPIFY_STORE}/admin/api/2023-10/products/${product.id}/metafields.json`,
          { headers: { "X-Shopify-Access-Token": ACCESS_TOKEN } }
        );

        const { metafields } = await metaRes.json();
        if (!metafields) continue;

        let gold_weight = parseFloat(metafields.find(m => m.key === "gold_weight")?.value) || 0;
        let diamond_price = parseInt(metafields.find(m => m.key === "diamond_cost")?.value) || 0;
        let product_purity = parseInt(metafields.find(m => m.key === "gold_purity")?.value) || 0;
        let colour_stone_price = parseInt(metafields.find(m => m.key === "colour_stone_cost")?.value) || 0;

        const appliedGoldRate = product_purity === 18 ? gold_rate_18 : gold_rate_14;
        const goldPrice = appliedGoldRate * gold_weight;
        const appliedlabourRate = gold_weight < 5 ? labour_rate_less : labour_rate_greater;
        const labourPrice = appliedlabourRate * gold_weight;
        const basePrice = goldPrice + labourPrice + diamond_price + colour_stone_price;
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
                variant: { id: variantId, price: finalPrice.toFixed(2) }
              })
            }
          );
          if (updateRes.ok) updatedCount++;
        }
      } catch (err) {
        console.error(`❌ Error updating ${product.title}:`, err.message);
      }
    }

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

export default async function handler(req, res) {
  // Handle CORS preflight
  res.setHeader("Access-Control-Allow-Origin", "https://retool-page.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end(); // Preflight request
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { gold_rate_14, gold_rate_18, labour_rate_less, labour_rate_greater, gst_rate } = req.body;
    const updatedCount = await updateAllProducts(
      gold_rate_14, gold_rate_18, labour_rate_less, labour_rate_greater, gst_rate
    );
    res.status(200).json({ message: "Prices updated successfully", updatedCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.toString() });
  }
}
