const os = require("os");
const sharp = require("sharp");
const { createWorker, PSM } = require("tesseract.js");

let workerPromise = null;
let queue = Promise.resolve();

function getWorker() {
    if (!workerPromise) {
        workerPromise = (async () => {
            const worker = await createWorker("eng", 1, { cachePath: os.tmpdir() });
            await worker.setParameters({
                tessedit_char_whitelist: "0123456789",
                tessedit_pageseg_mode: PSM.SPARSE_TEXT,
            });
            return worker;
        })().catch((err) => {
            workerPromise = null; // allow a retry on the next request
            throw err;
        });
    }
    return workerPromise;
}

// One OCR job at a time keeps memory predictable on small hosts.
function runExclusive(task) {
    const result = queue.then(task, task);
    queue = result.catch(() => {});
    return result;
}

async function readDigits(image) {
    const worker = await getWorker();
    const { data } = await worker.recognize(image);
    return data.text || "";
}

function sixDigitTokens(text) {
    const tokens = text.match(/\d+/g) || [];
    return [...new Set(tokens.filter((t) => t.length === 6))];
}

/** Returns every distinct 6-digit number found in the photo. */
async function extractStampCandidates(buffer) {
    const base = sharp(buffer)
        .rotate() // honour phone EXIF orientation
        .resize({ width: 1600, withoutEnlargement: true })
        .grayscale()
        .normalize();

    const plain = await base.clone().sharpen().png().toBuffer();
    let found = sixDigitTokens(await runExclusive(() => readDigits(plain)));

    if (found.length === 0) {
        const bw = await base.clone().threshold(140).png().toBuffer();
        found = sixDigitTokens(await runExclusive(() => readDigits(bw)));
    }
    return found;
}

function warmUpOcr() {
    return getWorker().catch((e) => console.error("[OCR] warm-up failed:", e.message));
}

module.exports = { extractStampCandidates, warmUpOcr };