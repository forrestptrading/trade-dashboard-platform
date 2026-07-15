import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage"]);
const textExtensions = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".html",
  ".css", ".md", ".yaml", ".yml", ".toml", ".txt", ".sql", ".sh",
]);

const productionFiles = new Set([
  "index.html",
  "script.js",
  ".github/workflows/pages.yml",
  "artifacts/api-server/src/app.ts",
  "artifacts/api-server/src/routes/index.ts",
  "artifacts/api-server/src/routes/auth.ts",
  "artifacts/api-server/src/routes/health.ts",
  "artifacts/api-server/src/routes/quotes.ts",
  "artifacts/api-server/src/routes/portfolio.ts",
  "artifacts/api-server/src/routes/snaptrade.ts",
  "artifacts/api-server/src/routes/snaptradeSession.ts",
  "artifacts/api-server/src/middlewares/auth.ts",
  "artifacts/api-server/src/lib/auth/session.ts",
]);

const bannedProductionPatterns = [
  { label: "mock-mode marker", regex: /\bmock\b/i },
  { label: "placeholder-data marker", regex: /\bplaceholder(?:\s+(?:data|feed|content|value)|s\b)/i },
  { label: "Plaid runtime reference", regex: /(?:PLAID_|\/api\/plaid|window\.Plaid|cdn\.plaid\.com)/i },
  { label: "known fabricated portfolio amount", regex: /(?:999999\.99|77777\.77|88888\.88|52341\.87|3241\.56|6666\.66)/ },
  { label: "fabricated portfolio account", regex: /MOCK-12345678/i },
];

const forbiddenMountedRoutes = [
  "positionsRouter",
  "watchlistRouter",
  "marketSummaryRouter",
  "accountActivityRouter",
  "portfolioSummaryRouter",
  "optionsPositionsRouter",
  "approvalsPendingRouter",
  "aiOptionsAlertsRouter",
  "aiCommandCenterRouter",
  "analyticsRouter",
  "riskRouter",
  "performanceRouter",
  "aiTradesRouter",
  "notificationsRouter",
  "brokerConnectionsRouter",
  "brokerEngineRouter",
  "plaidRouter",
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

const allFiles = await walk(root);
const textFiles = [];
const repositoryMarkers = [];
const productionViolations = [];

for (const fullPath of allFiles) {
  const path = relative(root, fullPath).replaceAll("\\", "/");
  const extension = extname(path).toLowerCase();
  if (!textExtensions.has(extension) && !["Dockerfile", "Procfile"].includes(path)) continue;

  const fileStat = await stat(fullPath);
  if (fileStat.size > 2_000_000) continue;
  const content = await readFile(fullPath, "utf8");
  textFiles.push(path);

  const broadMarker = /\b(mock|placeholder)\b|\/api\/plaid|PLAID_/gi;
  for (const match of content.matchAll(broadMarker)) {
    repositoryMarkers.push({ path, line: lineNumber(content, match.index ?? 0), value: match[0] });
  }

  if (!productionFiles.has(path)) continue;
  for (const pattern of bannedProductionPatterns) {
    const match = pattern.regex.exec(content);
    if (match) {
      productionViolations.push({
        path,
        line: lineNumber(content, match.index),
        problem: pattern.label,
        value: match[0],
      });
    }
  }
}

const routeIndexPath = resolve(root, "artifacts/api-server/src/routes/index.ts");
const routeIndex = await readFile(routeIndexPath, "utf8");
for (const routeName of forbiddenMountedRoutes) {
  if (routeIndex.includes(routeName)) {
    productionViolations.push({
      path: "artifacts/api-server/src/routes/index.ts",
      line: lineNumber(routeIndex, routeIndex.indexOf(routeName)),
      problem: "legacy route is mounted",
      value: routeName,
    });
  }
}

const pagesPath = resolve(root, ".github/workflows/pages.yml");
const pagesWorkflow = await readFile(pagesPath, "utf8");
if (!pagesWorkflow.includes("cp index.html style.css script.js _site/")) {
  productionViolations.push({
    path: ".github/workflows/pages.yml",
    line: 1,
    problem: "Pages deployment is not using the single production script",
    value: "expected direct copy",
  });
}
if (/cat\s+script\.js|patch\.js/.test(pagesWorkflow)) {
  productionViolations.push({
    path: ".github/workflows/pages.yml",
    line: lineNumber(pagesWorkflow, Math.max(0, pagesWorkflow.search(/cat\s+script\.js|patch\.js/))),
    problem: "Pages deployment still concatenates legacy patches",
    value: "legacy bundle",
  });
}

const productionScript = await readFile(resolve(root, "script.js"), "utf8");
for (const endpoint of [
  "/api/portfolio",
  "/api/plaid",
  "/api/broker-engine",
  "/api/ai-",
]) {
  if (productionScript.includes(endpoint)) {
    productionViolations.push({
      path: "script.js",
      line: lineNumber(productionScript, productionScript.indexOf(endpoint)),
      problem: "retired endpoint referenced by production frontend",
      value: endpoint,
    });
  }
}

console.log(`Repository audit scanned ${allFiles.length} files (${textFiles.length} text files).`);
console.log(`Informational legacy markers outside production runtime: ${repositoryMarkers.filter((item) => !productionFiles.has(item.path)).length}.`);

if (productionViolations.length) {
  console.error("Production data-policy violations:");
  for (const violation of productionViolations) {
    console.error(`- ${violation.path}:${violation.line} ${violation.problem}: ${violation.value}`);
  }
  process.exit(1);
}

console.log("Production runtime audit passed: no fabricated data paths are deployed or mounted.");
