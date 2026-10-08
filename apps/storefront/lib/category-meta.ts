export type CategoryMeta = { title: string; subtitle: string; breadcrumb: string };

const MAP: Record<string, CategoryMeta> = {
  girls:       { title: "Girls' Collection",  subtitle: "Twirl-ready dresses, soft tees and playful layers for every adventure.", breadcrumb: "Girls' Collection" },
  boys:        { title: "Boys' Collection",   subtitle: "Tough-but-comfy basics built for climbing, running and exploring.", breadcrumb: "Boys' Collection" },
  baby:        { title: "Baby Collection",    subtitle: "Gentle, soft pieces for the littlest members of the family.", breadcrumb: "Baby Collection" },
  women:       { title: "Women's Casual",     subtitle: "Easy, everyday pieces — soft, breathable and made to move.", breadcrumb: "Women's Casual" },
  new:         { title: "New This Week",      subtitle: "Fresh drops from our favourite Indonesian kids brands.", breadcrumb: "New This Week" },
  sale:        { title: "On Sale",            subtitle: "Loved pieces at joyful prices — grab them before they grow out!", breadcrumb: "On Sale" },
  essentials:  { title: "Everyday Essentials",subtitle: "The trusty basics you will reach for again and again.", breadcrumb: "Everyday Essentials" },
  bestsellers: { title: "Bestsellers",        subtitle: "The pieces other families cannot stop loving.", breadcrumb: "Bestsellers" },
  kids:        { title: "Kids' Collection",   subtitle: "Colourful, comfy and made to last — delivered Australia-wide.", breadcrumb: "Kids' Collection" },
  all:         { title: "All Kids' Clothing", subtitle: "Colourful, comfy and made to last — delivered Australia-wide.", breadcrumb: "All Kids' Clothing" },
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function resolveCategoryMeta(category?: string, search?: string): CategoryMeta {
  const q = (search || "").trim();
  if (q) {
    return { title: `Search: "${esc(q)}"`, subtitle: "Results from across our kids' collection.", breadcrumb: "Search" };
  }
  return MAP[(category || "all").toLowerCase()] || { title: "Kids' Collection", subtitle: "Colourful, comfy and made to last.", breadcrumb: "Kids' Collection" };
}
