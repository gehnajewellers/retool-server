import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const SHOPIFY_STORE = process.env.STORE_NAME;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://retool-page.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const url = `https://${SHOPIFY_STORE}/admin/api/2023-10/products.json?status=active&limit=250`;
    const response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": ACCESS_TOKEN },
    });
    const data = await response.json();

    const products = data.products.map((p) => ({
      id: p.id,
      title: p.title,
      variantId: p.variants[0]?.id,
    }));

    res.status(200).json({ products });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.toString() });
  }
}
