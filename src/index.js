export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();

    if (host.startsWith("www.")) {
      url.hostname = host.slice(4);
      return Response.redirect(url.toString(), 301);
    }

    const slug = await lookup(host, env, ctx);
    if (!slug) {
      return new Response("This site is not available.", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const origin = env.ORIGIN.replace(/\/$/, "");
    const path = url.pathname;
    const isAsset = /\.[a-zA-Z0-9]{2,5}$/.test(path) || path.startsWith("/assets/");

    if (isAsset) {
      const res = await fetch(origin + path + url.search, {
        cf: { cacheEverything: true, cacheTtl: 3600 },
      });
      return new Response(res.body, res);
    }

    const shell = await fetch(origin + "/", { headers: { accept: "text/html" } });
    const page = new HTMLRewriter()
      .on("head", {
        element(el) {
          el.prepend(
            "<script>window.__GID_SLUG__=" + JSON.stringify(slug) +
            ";window.__GID_HOST__=" + JSON.stringify(host) + ";</script>",
            { html: true }
          );
        },
      })
      .transform(shell);

    return new Response(page.body, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60",
      },
    });
  },
};

async function lookup(host, env, ctx) {
  const cache = caches.default;
  const key = new Request("https://gid-cache.local/host/" + encodeURIComponent(host));
  const hit = await cache.match(key);
  if (hit) {
    const j = await hit.json();
    return j.slug || null;
  }
  const res = await fetch(env.LOOKUP_URL + "?host=" + encodeURIComponent(host));
  if (!res.ok) return null;
  const data = await res.json();
  const body = JSON.stringify({ slug: data.slug || null });
  ctx.waitUntil(
    cache.put(
      key,
      new Response(body, {
        headers: { "cache-control": "max-age=300", "content-type": "application/json" },
      })
    )
  );
  return data.slug || null;
}
