// Puts the brand on the shop's live theme: logo, favicon and the first colour scheme.
// Run by hand (.github/workflows/ecom-theme.yml). It never publishes, switches or deletes a theme:
// it only rewrites config/settings_data.json of the current theme, after saving the original in
// theme-backup/ (kept as a workflow artifact) so it can be put back.
// Needs the app scopes read_themes, write_themes and write_files on top of the usual ones.
//   npx tsx server/ecom/theme.ts            apply
//   npx tsx server/ecom/theme.ts --restore  put theme-backup/settings_data.json back
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Shopify } from "./shopify";

const BRAND = {
  ink: "#1F3A34", // deep green: text, buttons
  paw: "#F4B79F", // soft peach: the paw
  page: "#FFFFFF",
  onInk: "#FFFFFF",
};
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function scopeHint(e: unknown): never {
  const m = (e as Error).message;
  if (/access denied|not approved|scope|ACCESS_DENIED/i.test(m))
    throw new Error(`droits manquants : ajoute read_themes, write_themes et write_files à l'app (nouvelle version + réinstallation). Shopify dit : ${m.slice(0, 200)}`);
  throw e;
}

async function upload(shop: Shopify, path: string, alt: string): Promise<string> {
  const name = path.split("/").pop()!;
  // already in the shop's files from an earlier run: reuse it instead of adding a copy
  type Q = { files: { nodes: { image?: { url: string } | null }[] } };
  const found = await shop.gql<Q>(`query($q: String!) { files(first: 5, query: $q) { nodes { ... on MediaImage { image { url } } } } }`, { q: `filename:${name}` }).catch(() => null);
  const same = found?.files.nodes.map((n) => n.image?.url).find((u) => u && decodeURIComponent(new URL(u).pathname.split("/").pop()!) === name);
  if (same) return name;
  const size = statSync(path).size;
  type S = { stagedUploadsCreate: { stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[]; userErrors: { message: string }[] } };
  const s = await shop.gql<S>(
    `mutation($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } } }`,
    { input: [{ resource: "IMAGE", filename: name, mimeType: "image/png", httpMethod: "POST", fileSize: String(size) }] },
  );
  const target = s.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new Error(`envoi refusé : ${s.stagedUploadsCreate.userErrors.map((e) => e.message).join(" ; ")}`);
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([readFileSync(path)], { type: "image/png" }), name);
  const up = await fetch(target.url, { method: "POST", body: form });
  if (!up.ok) throw new Error(`envoi du fichier ${name} refusé (${up.status})`);
  type C = { fileCreate: { files: { id: string }[]; userErrors: { message: string }[] } };
  const c = await shop.gql<C>(`mutation($files: [FileCreateInput!]!) { fileCreate(files: $files) { files { id } userErrors { message } } }`, {
    files: [{ originalSource: target.resourceUrl, contentType: "IMAGE", alt }],
  });
  const id = c.fileCreate.files[0]?.id;
  if (!id) throw new Error(`fichier refusé : ${c.fileCreate.userErrors.map((e) => e.message).join(" ; ")}`);
  // Shopify processes the image for a few seconds; its final name is what the theme refers to
  for (let i = 0; i < 20; i++) {
    await wait(1500);
    type N = { node: { fileStatus: string; image: { url: string } | null } | null };
    const n = await shop.gql<N>(`query($id: ID!) { node(id: $id) { ... on MediaImage { fileStatus image { url } } } }`, { id });
    if (n.node?.fileStatus === "FAILED") throw new Error(`Shopify n'a pas pu traiter ${name}`);
    if (n.node?.fileStatus === "READY" && n.node.image?.url) return decodeURIComponent(new URL(n.node.image.url).pathname.split("/").pop()!);
  }
  throw new Error(`${name} toujours en traitement chez Shopify, relance dans une minute`);
}

type Json = Record<string, unknown>;
const parseThemeJson = (text: string) => JSON.parse(text.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "")) as Json;

async function mainTheme(shop: Shopify) {
  type T = { themes: { nodes: { id: string; name: string; role: string }[] } };
  const t = await shop.gql<T>(`{ themes(first: 20, roles: [MAIN]) { nodes { id name role } } }`).catch(scopeHint);
  const theme = t.themes.nodes[0];
  if (!theme) throw new Error("aucun thème principal trouvé dans la boutique");
  return theme;
}

async function readFiles(shop: Shopify, themeId: string, names: string[]) {
  type F = { theme: { files: { nodes: { filename: string; body: { content?: string } }[] } } };
  const f = await shop.gql<F>(
    `query($id: ID!, $names: [String!]) { theme(id: $id) { files(filenames: $names, first: 10) { nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } } } } }`,
    { id: themeId, names },
  );
  return Object.fromEntries(f.theme.files.nodes.map((n) => [n.filename, n.body.content ?? ""]));
}

async function writeSettings(shop: Shopify, themeId: string, content: string) {
  type U = { themeFilesUpsert: { upsertedThemeFiles: { filename: string }[] | null; userErrors: { field: string[]; message: string }[] } };
  const u = await shop.gql<U>(
    `mutation($id: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) { themeFilesUpsert(themeId: $id, files: $files) { upsertedThemeFiles { filename } userErrors { field message } } }`,
    { id: themeId, files: [{ filename: "config/settings_data.json", body: { type: "TEXT", value: content } }] },
  ).catch(scopeHint);
  if (u.themeFilesUpsert.userErrors.length) throw new Error(`thème refusé : ${u.themeFilesUpsert.userErrors.map((e) => e.message).join(" ; ")}`);
}

// image settings of the theme, found in its own schema rather than guessed
export function imageSettings(schemaText: string) {
  const ids: string[] = [];
  try {
    for (const group of JSON.parse(schemaText) as { settings?: { id?: string; type?: string }[] }[])
      for (const s of group.settings ?? []) if (s.type === "image_picker" && s.id) ids.push(s.id);
  } catch {
    /* unusual schema: fall back to the usual names */
  }
  const logo = ids.filter((id) => /logo/i.test(id) && !/inverse|transparent|footer|mobile/i.test(id));
  const favicon = ids.filter((id) => /favicon/i.test(id));
  return { logo: logo.length ? logo : ["logo"], favicon: favicon.length ? favicon : ["favicon"] };
}

// recolour the first colour scheme; only hex colours that already exist are changed
export function recolour(scheme: Json): string[] {
  const changed: string[] = [];
  for (const [k, v] of Object.entries(scheme)) {
    if (typeof v !== "string" || !/^#[0-9a-f]{3,8}$/i.test(v)) continue;
    const key = k.toLowerCase();
    let to: string | null = null;
    if (key.includes("secondary") || key.includes("border") || key.includes("shadow") || key.includes("gradient")) continue;
    if (key.includes("button") && /(label|text|foreground)/.test(key)) to = BRAND.onInk;
    else if (key.includes("button")) to = BRAND.ink;
    else if (key.includes("background")) to = BRAND.page;
    else if (/(foreground|text|heading)/.test(key)) to = BRAND.ink;
    else if (key === "primary" || key.includes("accent")) to = BRAND.ink;
    if (to && to.toLowerCase() !== v.toLowerCase()) {
      scheme[k] = to;
      changed.push(k);
    }
  }
  return changed;
}

async function main() {
  const shop = await Shopify.connect();
  const theme = await mainTheme(shop);
  console.log(`Thème principal : « ${theme.name} ».`);
  mkdirSync("theme-backup", { recursive: true });

  if (process.argv.includes("--restore")) {
    if (!existsSync("theme-backup/settings_data.json")) throw new Error("pas de sauvegarde à remettre (theme-backup/settings_data.json)");
    await writeSettings(shop, theme.id, readFileSync("theme-backup/settings_data.json", "utf8"));
    console.log("Réglages d'origine du thème remis.");
    return;
  }

  const files = await readFiles(shop, theme.id, ["config/settings_data.json", "config/settings_schema.json"]).catch(scopeHint);
  const original = files["config/settings_data.json"];
  if (!original) throw new Error("réglages du thème introuvables");
  writeFileSync("theme-backup/settings_data.json", original);
  writeFileSync("theme-backup/theme.txt", `${theme.name}\n${theme.id}\n`);

  const logoFile = await upload(shop, here("./brand/coussinet-logo.png"), "Logo Coussinet");
  const iconFile = await upload(shop, here("./brand/coussinet-icone.png"), "Icône Coussinet");
  console.log("Logo et icône envoyés dans les fichiers de la boutique.");

  const data = parseThemeJson(original);
  const presets = (data.presets ?? {}) as Record<string, Json>;
  let current = data.current as Json | string | undefined;
  if (typeof current === "string") current = structuredClone(presets[current] ?? {});
  if (!current || typeof current !== "object") current = {};
  const { logo, favicon } = imageSettings(files["config/settings_schema.json"] ?? "");
  for (const id of logo) current[id] = `shopify://shop_images/${logoFile}`;
  for (const id of favicon) current[id] = `shopify://shop_images/${iconFile}`;
  let colours: string[] = [];
  // a fresh theme keeps its colour schemes in the preset, not in "current": copy them over first
  if (!current.color_schemes) {
    const preset = Object.values(presets).find((p) => p && typeof p === "object" && (p as Json).color_schemes) as Json | undefined;
    if (preset) current.color_schemes = structuredClone(preset.color_schemes);
  }
  const schemes = current.color_schemes as Record<string, { settings?: Json }> | undefined;
  const first = schemes && Object.keys(schemes)[0];
  if (first && schemes![first].settings) colours = recolour(schemes![first].settings!);
  else console.log(`Pas de schéma de couleurs trouvé (réglages : ${Object.keys(current).slice(0, 30).join(", ") || "aucun"} ; préréglages : ${Object.keys(presets).join(", ") || "aucun"}).`);
  data.current = current;
  await writeSettings(shop, theme.id, JSON.stringify(data, null, 2));
  console.log(`Thème mis à jour : logo (${logo.join(", ")}), icône (${favicon.join(", ")}), ${colours.length} couleur(s) du schéma « ${first ?? "aucun"} ». Rien n'a été publié.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
