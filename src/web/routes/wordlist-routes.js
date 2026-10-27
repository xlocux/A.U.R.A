"use strict";

const fs = require("node:fs");
const { generateWordlistFromDb } = require("../../recon/wordlist-generator");
const { HttpError, exportHeaders, isExistingFile, readBody, sendJson } = require("../http-utils");
const {
  buildWordlistMetadata,
  ensureDefaultWordlists,
  isGeneratedWordlistPath,
  readWordlistPreview,
  resolveWordlistFile
} = require("../services/wordlist-files");

// Wordlists are plain-text files. Restricting extensions keeps the preview/download endpoints from
// becoming a generic file reader (e.g. pointing a "wordlist" at data/aura.db or an SSH key).
const WORDLIST_FILE_PATTERN = /\.(txt|lst|list|dic|wordlist)$/i;

function requireWordlist(store, id) {
  const wordlist = store.getWordlist(id);
  if (!wordlist) throw new HttpError(404, "Wordlist not found");
  return wordlist;
}

function requireReadableWordlistFile(wordlist) {
  const filePath = resolveWordlistFile(wordlist.path);
  if (!filePath || !WORDLIST_FILE_PATTERN.test(filePath)) throw new HttpError(403, "Only .txt/.lst/.list/.dic wordlist files can be read");
  if (!isExistingFile(filePath)) throw new HttpError(404, "Wordlist file is not available on disk");
  return filePath;
}

function listWordlists({ response, store }) {
  ensureDefaultWordlists(store);
  sendJson(response, { wordlists: store.listWordlists() });
}

async function createWordlist({ request, response, store }) {
  const body = await readBody(request);
  const name = String(body.name || "").trim();
  const category = String(body.category || "").trim();
  const filePath = String(body.path || "").trim();
  if (!name || !category || !filePath) throw new HttpError(400, "name, category, and path are required");
  if (!WORDLIST_FILE_PATTERN.test(filePath)) throw new HttpError(400, "Wordlist path must point to a .txt, .lst, .list, .dic, or .wordlist file");
  const wordlist = store.addWordlist({
    name,
    category,
    path: filePath,
    status: body.status === "disabled" ? "disabled" : "active",
    notes: body.notes ? String(body.notes) : null
  });
  sendJson(response, { wordlist }, 201);
}

async function generateWordlist({ request, response, store }) {
  const body = await readBody(request);
  if (!body.category) throw new HttpError(400, "category is required");
  const generated = generateWordlistFromDb(store, {
    targetName: body.targetName || null,
    category: String(body.category).trim(),
    name: body.name || null
  });
  const wordlist = store.addWordlist({
    name: generated.name,
    category: generated.category,
    path: generated.path,
    status: "active",
    notes: `Generated from DB (${generated.count} entries)`
  });
  sendJson(response, { wordlist, generated }, 201);
}

function getWordlist({ response, store, params }) {
  sendJson(response, { wordlist: requireWordlist(store, params.id) });
}

function getWordlistMetadata({ response, store, params }) {
  const wordlist = requireWordlist(store, params.id);
  sendJson(response, { wordlist, metadata: buildWordlistMetadata(wordlist) });
}

function previewWordlist({ response, store, params }) {
  const wordlist = requireWordlist(store, params.id);
  sendJson(response, { wordlist, ...readWordlistPreview(requireReadableWordlistFile(wordlist)) });
}

function downloadWordlist({ response, store, params }) {
  const wordlist = requireWordlist(store, params.id);
  const filePath = requireReadableWordlistFile(wordlist);
  response.writeHead(200, exportHeaders("text/plain; charset=utf-8", `${wordlist.name || "wordlist"}.txt`));
  fs.createReadStream(filePath).on("error", () => response.destroy()).pipe(response);
}

function deleteWordlist({ response, store, params }) {
  const wordlist = requireWordlist(store, params.id);
  const filePath = resolveWordlistFile(wordlist.path);
  const deleteFile = isGeneratedWordlistPath(filePath) && fs.existsSync(filePath);
  if (!store.deleteWordlist(params.id)) throw new HttpError(404, "Wordlist not found");
  if (deleteFile) fs.rmSync(filePath, { force: true });
  sendJson(response, { deleted: true, fileDeleted: deleteFile, id: params.id });
}

module.exports = [
  { method: "GET", path: "/api/wordlists", handler: listWordlists },
  { method: "POST", path: "/api/wordlists", handler: createWordlist },
  { method: "POST", path: "/api/wordlists/generate", handler: generateWordlist },
  { method: "GET", path: "/api/wordlists/:id", handler: getWordlist },
  { method: "GET", path: "/api/wordlists/:id/metadata", handler: getWordlistMetadata },
  { method: "GET", path: "/api/wordlists/:id/preview", handler: previewWordlist },
  { method: "GET", path: "/api/wordlists/:id/download", handler: downloadWordlist },
  { method: "DELETE", path: "/api/wordlists/:id", handler: deleteWordlist }
];
