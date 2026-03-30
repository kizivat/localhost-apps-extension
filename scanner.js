/**
 * Try to fetch package.json from the dev server root and return the "name" field.
 * Vite (and many other dev servers) serve the project root, so this usually works.
 * @param {string} baseUrl
 * @param {AbortSignal} [signal]
 * @returns {Promise<string | null>}
 */
async function fetchProjectName(baseUrl, signal) {
	try {
		const res = await fetch(`${baseUrl}/package.json`, { signal });
		if (!res.ok) return null;
		const contentType = res.headers.get("content-type") || "";
		if (!contentType.includes("json")) return null;
		const pkg = await res.json();
		return typeof pkg.name === "string" && pkg.name.trim()
			? pkg.name.trim()
			: null;
	} catch {
		return null;
	}
}

/**
 * Probes a single port on localhost. Returns app info if something responds, null otherwise.
 * Title priority: package.json "name" > HTML <title> > "localhost:PORT"
 * @param {number} port
 * @param {AbortSignal} [signal]
 * @returns {Promise<{port: number, url: string, title: string} | null>}
 */
export async function probePort(port, signal) {
	const url = `http://localhost:${port}`;
	try {
		const [htmlRes, projectName] = await Promise.all([
			fetch(url, { signal }),
			fetchProjectName(url, signal),
		]);

		const html = await htmlRes.text();
		const htmlTitle = extractTitle(html);

		// Prefer project name (from package.json), then HTML title, then port
		const title = projectName || htmlTitle || `localhost:${port}`;

		return { port, url, title };
	} catch {
		return null;
	}
}

/**
 * Extracts the <title> content from an HTML string.
 * @param {string} html
 * @returns {string | null}
 */
function extractTitle(html) {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (!match) return null;
	// Decode basic HTML entities
	return match[1]
		.trim()
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
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

	const controller = new AbortController();
	// Hard timeout for the entire scan
	const timeout = setTimeout(() => controller.abort(), 5000);

	const results = await Promise.all(
		ports.map((port) => probePort(port, controller.signal)),
	);

	clearTimeout(timeout);
	return results.filter(Boolean);
}

export { DEFAULT_PORT_RANGES };
