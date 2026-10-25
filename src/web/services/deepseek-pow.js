"use strict";

// Proof-of-work solver for chat.deepseek.com (DeepSeekHashV1), reverse-engineered from the site's
// own worker: the server returns a challenge {challenge, salt, difficulty, expire_at, signature};
// the answer is the integer `i` in [0, difficulty) such that
//   deepseekHash(`${salt}_${expire_at}_${i}`) === challenge
// where deepseekHash is a Keccak[capacity=256] digest provided by DeepSeek's wasm (bundled here).

const fs = require("node:fs");
const path = require("node:path");

let wasm = null; // { hash(str) }

function loadWasm() {
  if (wasm) return wasm;
  const bytes = fs.readFileSync(path.join(__dirname, "deepseek_sha3.wasm"));
  const ex = new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports;
  const malloc = ex.__wbindgen_export_0;
  const addsp = ex.__wbindgen_add_to_stack_pointer;
  const enc = new TextEncoder();
  const hash = (str) => {
    const retptr = addsp(-16);
    const b = enc.encode(str);
    const p = malloc(b.length, 1);
    new Uint8Array(ex.memory.buffer).set(b, p);
    ex.wasm_deepseek_hash_v1(retptr, p, b.length);
    const view = new DataView(ex.memory.buffer);
    const outPtr = view.getInt32(retptr, true);
    const outLen = view.getInt32(retptr + 4, true);
    const hex = Buffer.from(new Uint8Array(ex.memory.buffer, outPtr, outLen)).toString("ascii");
    addsp(16);
    return hex;
  };
  wasm = { hash };
  return wasm;
}

// Returns the solved answer (integer) or throws if no solution within difficulty.
function solveChallenge(challenge) {
  if (challenge.algorithm !== "DeepSeekHashV1") throw new Error(`Unsupported PoW algorithm: ${challenge.algorithm}`);
  const { hash } = loadWasm();
  const prefix = `${challenge.salt}_${challenge.expire_at}_`;
  const target = challenge.challenge;
  const max = Number(challenge.difficulty);
  for (let i = 0; i < max; i += 1) {
    if (hash(prefix + i) === target) return i;
  }
  throw new Error("PoW: no solution found within difficulty");
}

// Builds the base64 X-DS-PoW-Response header value for a solved challenge.
function powResponseHeader(challenge) {
  const answer = solveChallenge(challenge);
  const payload = {
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    salt: challenge.salt,
    answer,
    signature: challenge.signature,
    target_path: challenge.target_path
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

module.exports = { solveChallenge, powResponseHeader };
