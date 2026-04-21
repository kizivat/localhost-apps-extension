/** Max number of HTTP redirects to follow manually. */
const MAX_REDIRECTS = 3;

/**
 * Fetch a URL following redirects manually (up to MAX_REDIRECTS) so we can
 * inspect intermediate responses. Returns an array of { url, html } for each
 * hop that returned HTML content, plus the final response.
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ responses: Array<{ url: string, html: string }>, finalUrl: string }>}
 */
async function fetchWithRedirects(url, signal) {
	/** @type {Array<{ url: string, html: string }>} */
	const responses = [];
	let currentUrl = url;

	for (let i = 0; i <= MAX_REDIRECTS; i++) {
		const res = await fetch(currentUrl, { signal, redirect: "manual" });
		console.log(
			`[scanner] ${url} hop ${i}: ${currentUrl} → status=${res.status} type=${res.type}`,
		);

		// Chrome extensions return opaque redirect responses for redirect: "manual"
		// Fall back to redirect: "follow" to get the final page
		if (res.type === "opaqueredirect") {
			console.log(
				`[scanner] ${url} got opaque redirect, falling back to redirect: "follow"`,
			);
			const followRes = await fetch(currentUrl, {
				signal,
				redirect: "follow",
			});
			const finalUrl = followRes.url || currentUrl;
			console.log(
				`[scanner] ${url} follow landed on ${finalUrl} (status=${followRes.status})`,
			);
			if (followRes.ok) {
				const contentType = followRes.headers.get("content-type") || "";
				if (contentType.includes("html")) {
					const html = await followRes.text();
					console.log(
						`[scanner] ${url} got HTML (${html.length} chars) from ${finalUrl}`,
					);
					// If we ended up somewhere different, note both original and final
					if (finalUrl !== currentUrl) {
						responses.push({ url: finalUrl, html });
					} else {
						responses.push({ url: currentUrl, html });
					}
					return { responses, finalUrl };
				}
			}
			return { responses, finalUrl };
		}

		// Follow 3xx redirects
		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get("location");
			if (!location) break;
			console.log(`[scanner] ${url} redirect → ${location}`);
			// Resolve relative redirects
			currentUrl = new URL(location, currentUrl).href;
			continue;
		}

		if (res.ok) {
			const contentType = res.headers.get("content-type") || "";
			if (contentType.includes("html")) {
				const html = await res.text();
				console.log(
					`[scanner] ${url} got HTML (${html.length} chars) from ${currentUrl}`,
				);
				responses.push({ url: currentUrl, html });
			} else {
				console.log(`[scanner] ${url} non-HTML content-type: ${contentType}`);
			}
		}
		break;
	}

	return { responses, finalUrl: currentUrl };
}

/**
 * Try to fetch a web app manifest (manifest.json or site.webmanifest) and
 * return the "name" or "short_name" field.
 * @param {string} baseUrl
 * @param {AbortSignal} [signal]
 * @returns {Promise<string | null>}
 */
async function fetchManifestName(baseUrl, signal) {
	const paths = [
		"/manifest.json",
		"/site.webmanifest",
		"/manifest.webmanifest",
	];
	for (const path of paths) {
		try {
			const res = await fetch(`${baseUrl}${path}`, {
				signal,
				redirect: "follow",
			});
			if (!res.ok) continue;
			const contentType = res.headers.get("content-type") || "";
			if (!contentType.includes("json") && !contentType.includes("manifest"))
				continue;
			const manifest = await res.json();
			const name = manifest.name || manifest.short_name;
			if (typeof name === "string" && name.trim()) return name.trim();
		} catch {
			// try next path
		}
	}
	return null;
}

/** Titles that are generic framework defaults and not meaningful. */
const GENERIC_TITLES = new Set([
	"vite app",
	"index",
	"react app",
	"welcome to sveltekit",
	"create next app",
	"nuxt app",
	"angular",
	"webpack app",
	"document",
	"untitled",
]);

/** Patterns like "Vite + Svelte", "Vite + React + TS" that are framework defaults. */
const GENERIC_TITLE_PATTERN = /^vite\s*\+/i;

/**
 * Returns true if the title is a known generic/framework default.
 * @param {string} title
 * @returns {boolean}
 */
function isGenericTitle(title) {
	const lower = title.toLowerCase().trim();
	return GENERIC_TITLES.has(lower) || GENERIC_TITLE_PATTERN.test(lower);
}

/**
 * Decode basic HTML entities.
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
	return text
		.trim()
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

/**
 * Extracts the <title> content from an HTML string.
 * @param {string} html
 * @returns {string | null}
 */
function extractTitle(html) {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (!match) return null;
	const title = decodeEntities(match[1]);
	if (!title || isGenericTitle(title)) return null;
	return title;
}

/**
 * Extracts a meaningful name from HTML meta tags.
 * Checks: application-name, og:site_name, og:title.
 * @param {string} html
 * @returns {string | null}
 */
function extractMetaName(html) {
	// <meta name="application-name" content="...">
	const appName = html.match(
		/<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']+)["']/i,
	);
	if (appName?.[1]?.trim()) return decodeEntities(appName[1]);

	// <meta property="og:site_name" content="...">
	const ogSiteName = html.match(
		/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
	);
	if (ogSiteName?.[1]?.trim()) return decodeEntities(ogSiteName[1]);

	// <meta property="og:title" content="...">
	const ogTitle = html.match(
		/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
	);
	if (ogTitle?.[1]?.trim()) {
		const title = decodeEntities(ogTitle[1]);
		if (!isGenericTitle(title)) return title;
	}

	return null;
}

/**
 * Extracts the manifest link href from HTML, fetches it, and returns the name.
 * Handles <link rel="manifest" href="/custom-manifest.json">.
 * @param {string} html
 * @param {string} baseUrl
 * @param {AbortSignal} [signal]
 * @returns {Promise<string | null>}
 */
async function fetchLinkedManifestName(html, baseUrl, signal) {
	const match = html.match(
		/<link[^>]+rel=["']manifest["'][^>]+href=["']([^"']+)["']/i,
	);
	if (!match?.[1]) return null;

	const href = match[1];
	// Only allow relative or same-origin paths
	if (href.startsWith("http") && !href.startsWith(baseUrl)) return null;

	const manifestUrl = href.startsWith("http")
		? href
		: `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;

	try {
		const res = await fetch(manifestUrl, { signal, redirect: "follow" });
		if (!res.ok) return null;
		const manifest = await res.json();
		const name = manifest.name || manifest.short_name;
		if (typeof name === "string" && name.trim()) return name.trim();
	} catch {
		// ignore
	}
	return null;
}

/**
 * Try to detect the framework/server from HTML content or patterns.
 * Returns a human-friendly label like "Vite app", "Next.js app", etc.
 * @param {string} html
 * @returns {string | null}
 */
function detectFramework(html) {
	if (html.includes("__sveltekit") || html.includes("_app/immutable"))
		return "SvelteKit app";
	if (html.includes("__next") || html.includes("/_next/")) return "Next.js app";
	if (html.includes("__nuxt") || html.includes("/_nuxt/")) return "Nuxt app";
	if (html.includes("ng-version") || html.includes("/main.js"))
		return "Angular app";
	if (html.includes("/@vite/client") || html.includes("vite/modulepreload"))
		return "Vite app";
	if (html.includes("/static/js/bundle.js")) return "React app";
	return null;
}

/**
 * @typedef {Object} TitleDebug
 * @property {string} source - Which heuristic matched (e.g. "html-title", "meta-og:title", "manifest", "framework", "redirect-title", "fallback")
 * @property {string} [redirectChain] - Redirect path if any (e.g. "/ → /login → /dashboard")
 * @property {string[]} tried - All heuristics attempted in order
 */

/**
 * Resolve a title from an HTML string, trying all heuristics in order.
 * Returns the title and debug info about which heuristic matched.
 * @param {string} html
 * @param {string} baseUrl
 * @param {string|null} manifestName
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ title: string, source: string }>}
 */
async function resolveTitle(html, baseUrl, manifestName, signal) {
	const htmlTitle = extractTitle(html);
	console.log(`[scanner] ${baseUrl} extractTitle: ${htmlTitle ?? "(none)"}`);
	if (htmlTitle) return { title: htmlTitle, source: "html-title" };

	const metaName = extractMetaName(html);
	console.log(`[scanner] ${baseUrl} extractMetaName: ${metaName ?? "(none)"}`);
	if (metaName) return { title: metaName, source: "meta-tag" };

	console.log(`[scanner] ${baseUrl} manifestName: ${manifestName ?? "(none)"}`);
	if (manifestName) return { title: manifestName, source: "manifest" };

	const linkedManifest = await fetchLinkedManifestName(html, baseUrl, signal);
	console.log(
		`[scanner] ${baseUrl} linkedManifest: ${linkedManifest ?? "(none)"}`,
	);
	if (linkedManifest)
		return { title: linkedManifest, source: "linked-manifest" };

	const framework = detectFramework(html);
	console.log(`[scanner] ${baseUrl} detectFramework: ${framework ?? "(none)"}`);
	if (framework) return { title: framework, source: "framework-detect" };

	console.log(`[scanner] ${baseUrl} no title found`);
	return { title: "", source: "" };
}

/**
 * Probes a single port on localhost. Returns app info if something responds, null otherwise.
 * Follows redirects manually (up to 3 hops) and tries title heuristics on each page.
 * Title priority: HTML <title> > meta tags > manifest name > linked manifest > framework detection > "localhost:PORT"
 * @param {number} port
 * @param {AbortSignal} [signal]
 * @returns {Promise<{port: number, url: string, title: string, debug: TitleDebug} | null>}
 */
export async function probePort(port, signal) {
	const url = `http://localhost:${port}`;
	console.log(`[scanner] probing :${port}`);
	try {
		const [{ responses, finalUrl }, manifestName] = await Promise.all([
			fetchWithRedirects(url, signal),
			fetchManifestName(url, signal),
		]);

		console.log(
			`[scanner] :${port} — ${responses.length} HTML response(s), finalUrl=${finalUrl}, manifest=${manifestName ?? "(none)"}`,
		);

		if (responses.length === 0) {
			return {
				port,
				url,
				title: `localhost:${port}`,
				debug: {
					source: "fallback (no HTML)",
					redirectChain: finalUrl !== url ? `→ ${finalUrl}` : undefined,
					tried: ["fetch returned no HTML"],
				},
			};
		}

		const redirectChain =
			responses.length > 1 || responses[0].url !== url
				? responses.map((r) => new URL(r.url).pathname).join(" → ")
				: undefined;

		/** @type {string[]} */
		const tried = [];

		// Try title heuristics on the FIRST (original) page, then on redirect targets
		for (const { html, url: pageUrl } of responses) {
			const pagePath = new URL(pageUrl).pathname;
			const { title, source } = await resolveTitle(
				html,
				url,
				manifestName,
				signal,
			);

			if (title) {
				const fullSource =
					responses.length > 1 ? `${source} (${pagePath})` : source;
				tried.push(`✓ ${fullSource}`);
				console.log(
					`[scanner] :${port} resolved title: "${title}" via ${fullSource}`,
				);
				return {
					port,
					url,
					title,
					debug: { source: fullSource, redirectChain, tried },
				};
			}
			tried.push(`✗ no match on ${pagePath}`);
		}

		// Fallback
		tried.push("✓ fallback");
		return {
			port,
			url,
			title: `localhost:${port}`,
			debug: { source: "fallback", redirectChain, tried },
		};
	} catch (err) {
		console.log(`[scanner] :${port} probe failed:`, err);
		return null;
	}
}

/** Default port ranges: Vite dev/preview, common Node ports */
const DEFAULT_PORT_RANGES = "3000-3010, 4173-4175, 5173-5183, 8080-8085";

/**
 * Parse a port config string like "3000-3010, 5173, 8080-8085" into a flat
 * array of port numbers.
 * @param {string} config
 * @returns {number[]}
 */
export function parsePortConfig(config) {
	/** @type {number[]} */
	const ports = [];
	const parts = config
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	for (const part of parts) {
		if (part.includes("-")) {
			const [startStr, endStr] = part.split("-");
			const start = parseInt(startStr, 10);
			const end = parseInt(endStr, 10);
			if (
				!Number.isNaN(start) &&
				!Number.isNaN(end) &&
				start <= end &&
				end - start < 1000
			) {
				for (let p = start; p <= end; p++) ports.push(p);
			}
		} else {
			const p = parseInt(part, 10);
			if (!Number.isNaN(p) && p > 0 && p < 65536) ports.push(p);
		}
	}

	return [...new Set(ports)].sort((a, b) => a - b);
}

/**
 * Scan all configured ports concurrently. Returns an array of found apps.
 * @param {string} [portConfig]
 * @returns {Promise<Array<{port: number, url: string, title: string}>>}
 */
export async function scanPorts(portConfig) {
	const config = portConfig || DEFAULT_PORT_RANGES;
	const ports = parsePortConfig(config);
	console.log(`[scanner] scanPorts: scanning ${ports.length} ports:`, ports);

	const controller = new AbortController();
	// Hard timeout for the entire scan
	const timeout = setTimeout(() => controller.abort(), 5000);

	const results = await Promise.all(
		ports.map((port) => probePort(port, controller.signal)),
	);

	clearTimeout(timeout);
	const found = results.filter(Boolean);
	console.log(
		`[scanner] scanPorts done: found ${found.length} app(s)`,
		found.map((a) => `${a.url} → "${a.title}" (${a.debug?.source})`),
	);
	return found;
}

export { DEFAULT_PORT_RANGES };
