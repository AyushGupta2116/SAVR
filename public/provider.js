// Remote product provider (not using local static data)
// This calls our own Node.js backend on the same origin.

async function fetchProductsFromProvider(query) {
  const url = `/api/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Failed to fetch products from provider');
  }

  const data = await res.json();
  const products = Array.isArray(data.products) ? data.products : [];
  return products;
}

