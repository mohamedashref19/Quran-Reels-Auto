const axios = require("axios");
const FormData = require("form-data");
const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const ffprobeStatic = require("ffprobe-static");

// تعريف مسارات أدوات المونتاج
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

// لو خليتها true هيعرض النص المختصر المكتوب في dailyAyahs
// لو خليتها false (الأفضل للصوت) هيعرض نص الآية الكامل المطابق لتلاوة الشيخ
const USE_CUSTOM_TEXT = false;

// ==========================================
// خريطة أسماء سور القرآن الكريم (1 إلى 114)
// ==========================================
const SURAH_NAMES = [
  "الفاتحة",
  "البقرة",
  "آل عمران",
  "النساء",
  "المائدة",
  "الأنعام",
  "الأعراف",
  "الأنفال",
  "التوبة",
  "يونس",
  "هود",
  "يوسف",
  "الرعد",
  "إبراهيم",
  "الحجر",
  "النحل",
  "الإسراء",
  "الكهف",
  "مريم",
  "طه",
  "الأنبياء",
  "الحج",
  "المؤمنون",
  "النور",
  "الفرقان",
  "الشعراء",
  "النمل",
  "القصص",
  "العنكبوت",
  "الروم",
  "لقمان",
  "السجدة",
  "الأحزاب",
  "سبأ",
  "فاطر",
  "يس",
  "الصافات",
  "ص",
  "الزمر",
  "غافر",
  "فصلت",
  "الشورى",
  "الزخرف",
  "الدخان",
  "الجاثية",
  "الأحقاف",
  "محمد",
  "الفتح",
  "الحجرات",
  "ق",
  "الذاريات",
  "الطور",
  "النجم",
  "القمر",
  "الرحمن",
  "الواقعة",
  "الحديد",
  "المجادلة",
  "الحشر",
  "الممتحنة",
  "الصف",
  "الجمعة",
  "المنافقون",
  "التغابن",
  "الطلاق",
  "التحريم",
  "الملك",
  "القلم",
  "الحاقة",
  "المعارج",
  "نوح",
  "الجن",
  "المزمل",
  "المدثر",
  "القيامة",
  "الإنسان",
  "المرسلات",
  "النبأ",
  "النازعات",
  "عبس",
  "التكوير",
  "الانفطار",
  "المطففين",
  "الانشقاق",
  "البروج",
  "الطارق",
  "الأعلى",
  "الغاشية",
  "الفجر",
  "البلد",
  "الشمس",
  "الليل",
  "الضحى",
  "الشرح",
  "التين",
  "العلق",
  "القدر",
  "البينة",
  "الزلزلة",
  "العاديات",
  "القارعة",
  "التكاثر",
  "العصر",
  "الهمزة",
  "الفيل",
  "قريش",
  "الماعون",
  "الكوثر",
  "الكافرون",
  "النصر",
  "المسد",
  "الإخلاص",
  "الفلق",
  "الناس",
];

function normalizeSurahName(name) {
  return String(name)
    .replace(/^سورة\s+/, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .trim();
}

const SURAH_MAP = {};
SURAH_NAMES.forEach((name, idx) => {
  SURAH_MAP[normalizeSurahName(name)] = idx + 1;
});

function getSurahNumber(surahName) {
  const num = SURAH_MAP[normalizeSurahName(surahName)];
  if (!num) throw new Error(`اسم السورة غير معروف: ${surahName}`);
  return num;
}

// تحويل "5-6" إلى [5, 6] أو "5" إلى [5]
function parseAyahNumbers(numberField) {
  if (Array.isArray(numberField)) return numberField.map(Number);
  const str = String(numberField).trim();
  if (str.includes("-")) {
    const [start, end] = str.split("-").map((n) => parseInt(n.trim(), 10));
    const list = [];
    for (let i = start; i <= end; i++) list.push(i);
    return list;
  }
  if (str.includes(",")) {
    return str.split(",").map((n) => parseInt(n.trim(), 10));
  }
  return [parseInt(str, 10)];
}

// ==========================================
// 0. تنظيف نص الآية من علامات الوقف
// ==========================================
function cleanAyahText(text) {
  return String(text)
    .replace(/[\u06D6-\u06ED]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ==========================================
// 1. جلب بيانات الآية (يدعم آية واحدة أو عدة آيات)
// ==========================================
async function getAyahData(ayahItem, reciterIndex = 0, retries = 3) {
  try {
    const reciters = [
      "ar.alafasy",
      "ar.mahermuaiqly",
      "ar.abdulbasitmurattal",
      "ar.minshawi",
    ];
    const reciter = reciters[reciterIndex % reciters.length];
    console.log(`   🎙️ القارئ: ${reciter}`);

    const surahNumber = getSurahNumber(ayahItem.surah);
    const ayahNumbers = parseAyahNumbers(ayahItem.number);

    const fetchedAyahs = [];
    for (const num of ayahNumbers) {
      const response = await axios.get(
        `http://api.alquran.cloud/v1/ayah/${surahNumber}:${num}/${reciter}`,
      );
      fetchedAyahs.push(response.data.data);
    }

    let finalText = "";
    if (USE_CUSTOM_TEXT && ayahItem.text) {
      const sep =
        ayahNumbers.length > 1
          ? ` <span class="ayah-inline-num">﴿ ${ayahNumbers[0]} ﴾</span> `
          : " ";
      finalText = cleanAyahText(ayahItem.text.replace(/\s*\*\s*/g, sep));
    } else {
      finalText = fetchedAyahs
        .map((a, idx) => {
          const cleaned = cleanAyahText(a.text);
          // وضع الرقم الذهبي بعد الآيات الأولى فقط، وترك الآية الأخيرة بدون رقم داخلي لمنع التكرار
          return idx < fetchedAyahs.length - 1
            ? `${cleaned} <span class="ayah-inline-num">﴿ ${a.numberInSurah} ﴾</span>`
            : cleaned;
        })
        .join(" ");
    }

    const lastAyahNumber = ayahNumbers[ayahNumbers.length - 1];

    return {
      text: finalText,
      surahName: fetchedAyahs[0].surah.name,
      numberInSurah: String(lastAyahNumber), // يظهر في التصميم رقم الآية الأخيرة فقط
      captionRange: String(ayahItem.number), // يحفظ النطاق الكامل للكابشن مثل "5-6"
      audioUrls: fetchedAyahs.map((a) => a.audio),
    };
  } catch (error) {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return await getAyahData(ayahItem, reciterIndex, retries - 1);
    }
    throw error;
  }
}

// ==========================================
// 2. اختيار فيديو طبيعي من مجلد videos
// ==========================================
async function getRandomNatureVideo(outputPath, rotationIndex = 0) {
  console.log("1. جاري اختيار فيديو طبيعي...");
  const videosDir = path.join(__dirname, "videos");
  if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir);

  const files = fs
    .readdirSync(videosDir)
    .filter((file) => file.toLowerCase().endsWith(".mp4"))
    .sort();
  if (files.length === 0)
    throw new Error('⚠️ مجلد "videos" فارغ! أرجو وضع فيديوهات بداخله.');

  const chosen = files[rotationIndex % files.length];
  console.log(
    `   🎞️ الفيديو المختار: ${chosen} (من ${files.length} فيديو متاح)`,
  );
  fs.copyFileSync(path.join(videosDir, chosen), outputPath);
  return outputPath;
}

// ==========================================
// 3. (أ) تصميم صورة الآية
// ==========================================
async function generateAyahImage(ayahInfo, browser) {
  console.log("2. جاري تصميم الآية...");
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920 });

  const SAFE_TOP = 250;
  const SAFE_BOTTOM = 400;
  const AVAILABLE_HEIGHT = 1920 - SAFE_TOP - SAFE_BOTTOM;
  const MAX_FONT = 110;
  const MIN_FONT = 30;

  const htmlContent = `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Amiri+Quran&family=Amiri:wght@700&display=swap');
                :root { --fs: ${MAX_FONT}px; }
                html, body { width: 1080px; height: 1920px; margin: 0; padding: 0; background: transparent !important; overflow: hidden; }
                body { position: relative; font-family: 'Amiri Quran', 'Amiri', serif; color: #ffffff; text-shadow: 0 8px 30px rgba(0, 0, 0, 1), 0 3px 10px rgba(0, 0, 0, 1); }
                .safe-area { position: absolute; top: ${SAFE_TOP}px; left: 0; right: 0; height: ${AVAILABLE_HEIGHT}px; display: flex; justify-content: center; align-items: center; width: 1080px; }
                .content { width: 960px; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; text-align: center; word-wrap: break-word; overflow-wrap: break-word; }
                .surah-name { font-family: 'Amiri', serif; font-weight: 700; font-size: min(65px, calc(var(--fs) * 0.65)); color: #d4af37; margin-bottom: calc(var(--fs) * 0.3); text-align: center; }
                .ayah-text { font-size: var(--fs); line-height: 1.8; text-align: center; font-weight: normal; max-width: 100%; white-space: normal; }
                .ayah-inline-num { font-family: 'Amiri', serif; font-weight: 700; font-size: min(55px, calc(var(--fs) * 0.55)); color: #d4af37; display: inline-block; margin: 0 8px; vertical-align: middle; }
                .ayah-number { font-family: 'Amiri', serif; font-weight: 700; font-size: min(55px, calc(var(--fs) * 0.55)); color: #d4af37; margin-top: calc(var(--fs) * 0.3); text-align: center; }
            </style>
        </head>
        <body>
            <div class="safe-area">
                <div class="content">
                    <div class="surah-name">﴿ ${ayahInfo.surahName} ﴾</div>
                    <div class="ayah-text">${ayahInfo.text}</div>
                    <div class="ayah-number">﴿ ${ayahInfo.numberInSurah} ﴾</div>
                </div>
            </div>
        </body>
        </html>
    `;
  await page.setContent(htmlContent, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  const fit = await page.evaluate(
    async (availH, maxFs, minFs) => {
      await document.fonts.ready;
      const content = document.querySelector(".content");
      const root = document.documentElement;
      const setFs = (fs) => root.style.setProperty("--fs", fs + "px");
      const fits = () => content.getBoundingClientRect().height <= availH;

      setFs(maxFs);
      if (fits()) return { fs: maxFs, fits: true };

      let lo = minFs;
      let hi = maxFs;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        setFs(mid);
        if (fits()) lo = mid;
        else hi = mid;
      }
      setFs(lo);
      return { fs: lo, fits: fits() };
    },
    AVAILABLE_HEIGHT,
    MAX_FONT,
    MIN_FONT,
  );
  console.log(`   🔠 حجم خط الآية: ${fit.fs}px`);

  const imagePath = path.join(__dirname, "ayah_overlay.png");
  await page.screenshot({ path: imagePath, type: "png", omitBackground: true });
  await page.close();
  return imagePath;
}

// ==========================================
// 3. (ب) تصميم الخاتمة (الـ Outro)
// ==========================================
async function generateOutroImage(browser) {
  console.log("3. جاري تصميم شاشة النهاية (Call to Action)...");
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920 });

  const htmlContent = `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Amiri:wght@700&display=swap');
                html, body { width: 1080px; height: 1920px; margin: 0; background: transparent !important; }
                body { display: flex; flex-direction: column; justify-content: center; align-items: center; font-family: 'Amiri', serif; color: #ffffff; text-shadow: 0 8px 30px rgba(0, 0, 0, 1); }
                .app-name { font-size: 150px; font-weight: bold; margin-bottom: 20px; }
                .slogan { font-size: 70px; color: #d4af37; margin-bottom: 100px; }
                .cta { background-color: #134e34; color: #fff; font-size: 65px; padding: 40px 70px; border-radius: 40px; border: 4px solid #d4af37; box-shadow: 0 15px 40px rgba(0,0,0,0.8); text-shadow: none; }
            </style>
        </head>
        <body>
            <div class="app-name">تطبيق اقرأ</div>
            <div class="slogan">رفيقك لختم القرآن</div>
            <div class="cta">✨ حمل التطبيق الآن من البايو ✨</div>
        </body>
        </html>
    `;
  await page.setContent(htmlContent, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });
  const imagePath = path.join(__dirname, "outro_overlay.png");
  await page.screenshot({ path: imagePath, type: "png", omitBackground: true });
  await page.close();
  return imagePath;
}

// ==========================================
// 4. تحميل الصوت ودمجه إذا كان أكثر من آية
// ==========================================
async function downloadAndMergeAudio(audioUrls, outputPath) {
  console.log(`4. جاري تحميل التلاوة (${audioUrls.length} مقطع)...`);

  if (audioUrls.length === 1) {
    const response = await axios({
      method: "GET",
      url: audioUrls[0],
      responseType: "arraybuffer",
    });
    fs.writeFileSync(outputPath, response.data);
    return;
  }

  // في حالة وجود آيتين أو أكثر: نحمل كل جزء ثم ندمجهم بـ FFmpeg
  const partFiles = [];
  for (let i = 0; i < audioUrls.length; i++) {
    const partPath = path.join(__dirname, `audio_part_${i}.mp3`);
    const response = await axios({
      method: "GET",
      url: audioUrls[i],
      responseType: "arraybuffer",
    });
    fs.writeFileSync(partPath, response.data);
    partFiles.push(partPath);
  }

  const audioListPath = path.join(__dirname, "audio_concat_list.txt");
  const listContent = partFiles
    .map((f) => `file '${f.replace(/'/g, "'\\''")}'`)
    .join("\n");
  fs.writeFileSync(audioListPath, listContent);

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(audioListPath)
      .inputOptions(["-f", "concat", "-safe", "0"])
      .outputOptions(["-c:a", "libmp3lame", "-b:a", "192k", "-y"])
      .save(outputPath)
      .on("end", resolve)
      .on("error", reject);
  });

  // تنظيف ملفات الصوت الجزئية
  [...partFiles, audioListPath].forEach((f) => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
}

function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration);
    });
  });
}

function getVideoSize(videoPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return resolve(null);
      const v = (metadata.streams || []).find(
        (st) => st.codec_type === "video",
      );
      resolve(v ? { width: v.width, height: v.height } : null);
    });
  });
}

// ==========================================
// 5. المونتاج الذكي والمزامنة
// ==========================================
async function createFinalMedia(
  videoInput,
  ayahImage,
  outroImage,
  audioInput,
  audioDuration,
  videoOutput,
) {
  const safeDuration = parseFloat(audioDuration).toFixed(2);
  const totalDuration = (parseFloat(audioDuration) + 2).toFixed(2);

  console.log(
    `5. جاري المونتاج.. (مدة الآية: ${safeDuration} ثانية | مدة النهاية: 2 ثانية)`,
  );

  const videoDuration = await getAudioDuration(videoInput);
  const bgSize = await getVideoSize(videoInput);
  if (bgSize) {
    const same = bgSize.width === 1080 && bgSize.height === 1920;
    console.log(
      `📐 مقاس الفيديو الخلفي: ${bgSize.width}x${bgSize.height}${same ? " (مظبوط)" : " → هيتحول تلقائياً لـ 1080x1920"}`,
    );
  }
  const loops = Math.max(
    1,
    Math.ceil(parseFloat(totalDuration) / videoDuration),
  );
  console.log(
    `🔁 مدة الفيديو الخلفي: ${videoDuration.toFixed(2)} ثانية | هيتكرر ${loops} مرة`,
  );

  const listPath = path.join(__dirname, "loop_list.txt");
  const escapedPath = videoInput.replace(/'/g, "'\\''");
  fs.writeFileSync(listPath, `file '${escapedPath}'\n`.repeat(loops));

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(["-f", "concat", "-safe", "0"])
      .input(ayahImage)
      .input(outroImage)
      .input(audioInput)
      .complexFilter([
        "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,eq=brightness=-0.3:contrast=1.1[bg]",
        `[bg][1:v]overlay=0:0:enable='between(t,0,${safeDuration})'[v1]`,
        `[v1][2:v]overlay=0:0:enable='between(t,${safeDuration},${totalDuration})'[outv]`,
      ])
      .outputOptions([
        "-map [outv]",
        "-map 3:a",
        `-t ${totalDuration}`,
        "-c:v libx264",
        "-preset veryfast",
        "-crf 26",
        "-maxrate 6M",
        "-bufsize 12M",
        "-r 30",
        "-c:a aac",
        "-b:a 192k",
        "-pix_fmt yuv420p",
        "-movflags +faststart",
        "-y",
      ])
      .save(videoOutput)
      .on("end", () => {
        if (fs.existsSync(listPath)) fs.unlinkSync(listPath);
        resolve();
      })
      .on("error", async (err, stdout, stderr) => {
        if (fs.existsSync(listPath)) fs.unlinkSync(listPath);
        try {
          if (fs.existsSync(videoOutput) && fs.statSync(videoOutput).size > 0) {
            const outDuration = await getAudioDuration(videoOutput);
            if (outDuration >= parseFloat(totalDuration) - 0.5) {
              console.warn(
                `⚠️ FFmpeg رجّع خطأ (${err.message}) لكن الفيديو الناتج سليم (${outDuration.toFixed(2)} ثانية). هنكمل.`,
              );
              return resolve();
            }
          }
        } catch (probeErr) {}
        console.error("\n❌ تفاصيل خطأ FFmpeg الداخلي:\n", stderr);
        reject(err);
      });
  });
}

// ==========================================
// 5.5 رفع الفيديو
// ==========================================
const UPLOAD_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function buildUploadProviders() {
  const providers = [];
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const preset = process.env.CLOUDINARY_UPLOAD_PRESET;
  if (cloudName && preset) {
    providers.push({
      name: "cloudinary",
      url: `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`,
      fields: { upload_preset: preset },
      fileField: "file",
      parse: (data) => data.secure_url,
    });
  } else {
    console.log(
      "   ℹ️ Cloudinary مش مفعّل (المتغيرات غير موجودة)، هنستخدم الخدمات المجانية.",
    );
  }

  providers.push(
    {
      name: "litterbox (72h)",
      url: "https://litterbox.catbox.moe/resources/internals/api.php",
      fields: { reqtype: "fileupload", time: "72h" },
      fileField: "fileToUpload",
      parse: (data) => String(data).trim(),
    },
    {
      name: "tmpfiles.org",
      url: "https://tmpfiles.org/api/v1/upload",
      fields: {},
      fileField: "file",
      parse: (data) =>
        String(data && data.data && data.data.url).replace(
          "tmpfiles.org/",
          "tmpfiles.org/dl/",
        ),
    },
    {
      name: "uguu.se",
      url: "https://uguu.se/upload",
      fields: {},
      fileField: "files[]",
      parse: (data) => data && data.files && data.files[0] && data.files[0].url,
    },
    {
      name: "catbox.moe",
      url: "https://catbox.moe/user/api.php",
      fields: { reqtype: "fileupload" },
      fileField: "fileToUpload",
      parse: (data) => String(data).trim(),
    },
  );
  return providers;
}

async function tryUpload(provider, filePath) {
  const form = new FormData();
  for (const [key, value] of Object.entries(provider.fields)) {
    form.append(key, value);
  }
  form.append(provider.fileField, fs.createReadStream(filePath));

  const res = await axios.post(provider.url, form, {
    headers: { ...form.getHeaders(), "User-Agent": UPLOAD_USER_AGENT },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 180000,
  });

  const url = provider.parse(res.data);
  if (!/^https?:\/\//i.test(String(url))) {
    throw new Error(
      `رد غير متوقع من ${provider.name}: ${String(url).slice(0, 200)}`,
    );
  }
  return url;
}

async function uploadVideo(filePath) {
  const errors = [];
  for (const provider of buildUploadProviders()) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`   ↗️ محاولة الرفع على: ${provider.name} (${attempt}/2)`);
        return await tryUpload(provider, filePath);
      } catch (err) {
        const status = err.response ? err.response.status : "no-response";
        const body = err.response
          ? String(
              typeof err.response.data === "string"
                ? err.response.data
                : JSON.stringify(err.response.data),
            ).slice(0, 200)
          : err.message;
        console.error(
          `   ⚠️ فشل ${provider.name} | status: ${status} | رد السيرفر: ${body}`,
        );
        const retryable = typeof status === "number" ? status >= 500 : true;
        if (attempt === 2 || !retryable) {
          errors.push(`${provider.name}: ${status}`);
          break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  throw new Error(`فشل الرفع على كل الخدمات (${errors.join(" | ")})`);
}

// ==========================================
// 6. تشغيل الدورة بالكامل
// ==========================================
async function runAutomation(
  currentAyahItem,
  videoIndex = 0,
  reciterIndex = 0,
) {
  const tempVideo = path.join(__dirname, "temp_nature.mp4");
  const ayahImage = path.join(__dirname, "ayah_overlay.png");
  const outroImage = path.join(__dirname, "outro_overlay.png");
  const audioPath = path.join(__dirname, "audio.mp3");
  const finalVideo = path.join(__dirname, "final_video.mp4");

  try {
    const ayahInfo = await getAyahData(currentAyahItem, reciterIndex);
    if (!ayahInfo) return false;

    await getRandomNatureVideo(tempVideo, videoIndex);

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    await generateAyahImage(ayahInfo, browser);
    await generateOutroImage(browser);
    await browser.close();

    await downloadAndMergeAudio(ayahInfo.audioUrls, audioPath);
    const duration = await getAudioDuration(audioPath);

    await createFinalMedia(
      tempVideo,
      ayahImage,
      outroImage,
      audioPath,
      duration,
      finalVideo,
    );

    const outSize = await getVideoSize(finalVideo);
    console.log(
      `📐 مقاس الفيديو النهائي: ${outSize ? `${outSize.width}x${outSize.height}` : "غير معروف"}`,
    );
    if (!outSize || outSize.width !== 1080 || outSize.height !== 1920) {
      throw new Error(
        `مقاس الفيديو النهائي غير صحيح (${outSize ? `${outSize.width}x${outSize.height}` : "؟"}). المفروض 1080x1920.`,
      );
    }

    console.log("6. جاري رفع الفيديو للحصول على رابط مباشر...");
    const directUrl = await uploadVideo(finalVideo);
    console.log("✅ تم الرفع، الرابط:", directUrl);

    console.log("7. جاري إرسال البيانات إلى Make.com...");
    const rangeStr = ayahInfo.captionRange || ayahInfo.numberInSurah;
    const ayahLabel = String(rangeStr).includes("-") ? "الآيات" : "آية";
    const captionText = `﴿ ${ayahInfo.surahName} - ${ayahLabel} ${rangeStr} ﴾\n\nتطبيق اقرأ - رفيقك لختم القرآن 📖\n✨ حمل التطبيق الآن مجاناً من الرابط في البايو ✨\n\n#قرآن #تطبيق_اقرأ #تلاوة #قرآن_كريم`;

    const webhookUrl = (process.env.MAKE_WEBHOOK_URL || "").trim();
    if (!webhookUrl) {
      throw new Error(
        "المتغير MAKE_WEBHOOK_URL مش موجود. ضيفه في GitHub Secrets.",
      );
    }

    const payload = { videoUrl: directUrl, caption: captionText };
    if (process.env.MAKE_WEBHOOK_SECRET) {
      payload.secret = process.env.MAKE_WEBHOOK_SECRET.trim();
    }

    const webhookRes = await axios.post(webhookUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 60000,
    });
    console.log(
      `   📨 رد Make: ${webhookRes.status} ${String(webhookRes.data).slice(0, 100)}`,
    );
    console.log("✅ تم إرسال الرابط إلى Make بنجاح!");

    [tempVideo, ayahImage, outroImage, audioPath, finalVideo].forEach(
      (file) => {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      },
    );

    return true;
  } catch (error) {
    console.error("❌ حدث خطأ:", error.message);
    return false;
  }
}

// ==========================================
// 7. مصفوفة الآيات اليومية ومتابعة النشر
// ==========================================
const dailyAyahs = [
  // 🌸 آيات الطمأنينة والتفاؤل (تريند السوشيال ميديا)
  {
    text: "فَإِنَّ مَعَ الْعُسْرِ يُسْرًا * إِنَّ مَعَ الْعُسْرِ يُسْرًا",
    surah: "الشرح",
    number: "5-6",
  },
  {
    text: "وَلَسَوْفَ يُعْطِيكَ رَبُّكَ فَتَرْضَىٰ",
    surah: "الضحى",
    number: "5",
  },
  {
    text: "وَاصْبِرْ لِحُكْمِ رَبِّكَ فَإِنَّكَ بِأَعْيُنِنَا",
    surah: "الطور",
    number: "48",
  },
  { text: "لَا تَحْزَنْ إِنَّ اللَّهَ مَعَنَا", surah: "التوبة", number: "40" },
  {
    text: "فَاسْتَجَبْنَا لَهُ وَنَجَّيْنَاهُ مِنَ الْغَمِّ ۚ وَكَذَٰلِكَ نُنجِي الْمُؤْمِنِينَ",
    surah: "الأنبياء",
    number: "88",
  },
  {
    text: "سَيَجْعَلُ اللَّهُ بَعْدَ عُسْرٍ يُسْرًا",
    surah: "الطلاق",
    number: "7",
  },
  {
    text: "قَالَ لَا تَخَافَا ۖ إِنَّنِي مَعَكُمَا أَسْمَعُ وَأَرَىٰ",
    surah: "طه",
    number: "46",
  },
  { text: "وَلَا تَيْأَسُوا مِن رَّوْحِ اللَّهِ", surah: "يوسف", number: "87" },
  {
    text: "إِنَّمَا أَشْكُو بَثِّي وَحُزْنِي إِلَى اللَّهِ",
    surah: "يوسف",
    number: "86",
  },
  {
    text: "فَصَبْرٌ جَمِيلٌ ۖ وَاللَّهُ الْمُسْتَعَانُ",
    surah: "يوسف",
    number: "18",
  },
  {
    text: "وَهُوَ الَّذِي يُنَزِّلُ الْغَيْثَ مِن بَعْدِ مَا قَنَطُوا وَيَنشُرُ رَحْمَتَهُ",
    surah: "الشورى",
    number: "28",
  },

  // 🕊️ آيات السكينة والجبر (إضافات جديدة)
  {
    text: "قُل لَّن يُصِيبَنَا إِلَّا مَا كَتَبَ اللَّهُ لَنَا هُوَ مَوْلَانَا ۚ وَعَلَى اللَّهِ فَلْيَتَوَكَّلِ الْمُؤْمِنُونَ",
    surah: "التوبة",
    number: "51",
  },
  { text: "وَمَا كَانَ رَبُّكَ نَسِيًّا", surah: "مريم", number: "64" },
  { text: "إِنَّ مَعِيَ رَبِّي سَيَهْدِينِ", surah: "الشعراء", number: "62" },
  {
    text: "وَاللَّهُ يَعْلَمُ وَأَنتُمْ لَا تَعْلَمُونَ",
    surah: "البقرة",
    number: "216",
  },
  {
    text: "وَاصْبِرْ فَإِنَّ اللَّهَ لَا يُضِيعُ أَجْرَ الْمُحْسِنِينَ",
    surah: "هود",
    number: "115",
  },
  {
    text: "وَلَا تَخَافِي وَلَا تَحْزَنِي ۖ إِنَّا رَادُّوهُ إِلَيْكِ",
    surah: "القصص",
    number: "7",
  },
  {
    text: "وَنَحْنُ أَقْرَبُ إِلَيْهِ مِنْ حَبْلِ الْوَرِيدِ",
    surah: "ق",
    number: "16",
  },

  // 🤲 آيات الدعاء والاستجابة
  {
    text: "وَقَالَ رَبُّكُمُ ادْعُونِي أَسْتَجِبْ لَكُمْ",
    surah: "غافر",
    number: "60",
  },
  {
    text: "وَإِذَا سَأَلَكَ عِبَادِي عَنِّي فَإِنِّي قَرِيبٌ ۖ أُجِيبُ دَعْوَةَ الدَّاعِ إِذَا دَعَانِ",
    surah: "البقرة",
    number: "186",
  },
  {
    text: "أَمَّن يُجِيبُ الْمُضْطَرَّ إِذَا دَعَاهُ وَيَكْشِفُ السُّوءَ",
    surah: "النمل",
    number: "62",
  },
  {
    text: "رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ",
    surah: "البقرة",
    number: "201",
  },
  { text: "إِنَّ رَبِّي قَرِيبٌ مُّجِيبٌ", surah: "هود", number: "61" },

  // 🛡️ آيات التوكل واليقين
  {
    text: "وَمَن يَتَّقِ اللَّهَ يَجْعَل لَّهُ مَخْرَجًا * وَيَرْزُقْهُ مِنْ حَيْثُ لَا يَحْتَسِبُ",
    surah: "الطلاق",
    number: "2-3",
  },
  {
    text: "وَمَن يَتَوَكَّلْ عَلَى اللَّهِ فَهُوَ حَسْبُهُ",
    surah: "الطلاق",
    number: "3",
  },
  {
    text: "وَأُفَوِّضُ أَمْرِي إِلَى اللَّهِ ۚ إِنَّ اللَّهَ بَصِيرٌ بِالْعِبَادِ",
    surah: "غافر",
    number: "44",
  },
  {
    text: "حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ",
    surah: "آل عمران",
    number: "173",
  },
  {
    text: "وَتَوَكَّلْ عَلَى الْحَيِّ الَّذِي لَا يَمُوتُ",
    surah: "الفرقان",
    number: "58",
  },
  {
    text: "لَا يُكَلِّفُ اللَّهُ نَفْسًا إِلَّا وُسْعَهَا",
    surah: "البقرة",
    number: "286",
  },
  {
    text: "إِنَّ اللَّهَ يُحِبُّ الْمُتَوَكِّلِينَ",
    surah: "آل عمران",
    number: "159",
  },

  // 💡 آيات الإرشادات والأخلاق (التعامل مع الناس)
  { text: "وَقُولُوا لِلنَّاسِ حُسْنًا", surah: "البقرة", number: "83" },
  {
    text: "خُذِ الْعَفْوَ وَأْمُرْ بِالْعُرْفِ وَأَعْرِضْ عَنِ الْجَاهِلِينَ",
    surah: "الأعراف",
    number: "199",
  },
  {
    text: "ادْفَعْ بِالَّتِي هِيَ أَحْسَنُ فَإِذَا الَّذِي بَيْنَكَ وَبَيْنَهُ عَدَاوَةٌ كَأَنَّهُ وَلِيٌّ حَمِيمٌ",
    surah: "فصلت",
    number: "34",
  },
  {
    text: "وَعِبَادُ الرَّحْمَٰنِ الَّذِينَ يَمْشُونَ عَلَى الْأَرْضِ هَوْنًا وَإِذَا خَاطَبَهُمُ الْجَاهِلُونَ قَالُوا سَلَامًا",
    surah: "الفرقان",
    number: "63",
  },
  {
    text: "يَا أَيُّهَا الَّذِينَ آمَنُوا اجْتَنِبُوا كَثِيرًا مِّنَ الظَّنِّ إِنَّ بَعْضَ الظَّنِّ إِثْمٌ",
    surah: "الحجرات",
    number: "12",
  },
  {
    text: "وَلَا تُصَعِّرْ خَدَّكَ لِلنَّاسِ وَلَا تَمْشِ فِي الْأَرْضِ مَرَحًا",
    surah: "لقمان",
    number: "18",
  },

  // 💖 آيات الرحمة والمغفرة والذكر
  {
    text: "قُلْ يَا عِبَادِيَ الَّذِينَ أَسْرَفُوا عَلَىٰ أَنفُسِهِمْ لَا تَقْنَطُوا مِن رَّحْمَةِ اللَّهِ",
    surah: "الزمر",
    number: "53",
  },
  {
    text: "وَمَا كَانَ اللَّهُ مُعَذِّبَهُمْ وَهُمْ يَسْتَغْفِرُونَ",
    surah: "الأنفال",
    number: "33",
  },
  {
    text: "وَرَحْمَتِي وَسِعَتْ كُلَّ شَيْءٍ",
    surah: "الأعراف",
    number: "156",
  },
  {
    text: "أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ",
    surah: "الرعد",
    number: "28",
  },
  {
    text: "فَاذْكُرُونِي أَذْكُرْكُمْ وَاشْكُرُوا لِي وَلَا تَكْفُرُونِ",
    surah: "البقرة",
    number: "152",
  },
  {
    text: "إِنَّ اللَّهَ وَمَلَائِكَتَهُ يُصَلُّونَ عَلَى النَّبِيِّ ۚ يَا أَيُّهَا الَّذِينَ آمَنُوا صَلُّوا عَلَيْهِ وَسَلِّمُوا تَسْلِيمًا",
    surah: "الأحزاب",
    number: "56",
  },
];

const ayahTrackerFile = path.join(__dirname, "current_ayah_index.txt");

function getDayCounter() {
  if (fs.existsSync(ayahTrackerFile)) {
    const counter = parseInt(fs.readFileSync(ayahTrackerFile, "utf-8"));
    if (!isNaN(counter) && counter >= 0) return counter;
  }
  return 0;
}

function saveDayCounter(counter) {
  fs.writeFileSync(ayahTrackerFile, (counter + 1).toString());
}

async function runDailyTask() {
  const dayCounter = getDayCounter();
  const ayahIndex = dayCounter % dailyAyahs.length;
  const cycle = Math.floor(dayCounter / dailyAyahs.length);
  const currentAyahItem = dailyAyahs[ayahIndex];

  //const rotationIndex = dayCounter + cycle;

  console.log(
    `\n🚀 بدء دورة النشر: اليوم ${ayahIndex + 1} من ${dailyAyahs.length} | الدورة رقم ${cycle + 1} | العداد الكلي: ${dayCounter}`,
  );
  console.log(
    `📖 الآية المختارة: سورة ${currentAyahItem.surah} (${currentAyahItem.number})`,
  );

  const videoIndex = dayCounter + cycle;

  // مؤشر القارئ بيزيد 1 إضافي كل 4 أيام وكل 20 يوم عشان يكسر التكرار مع الفيديوهات
  const reciterIndex = dayCounter + Math.floor(dayCounter / 4) + cycle;

  const success = await runAutomation(
    currentAyahItem,
    videoIndex,
    reciterIndex,
  );
  if (success) {
    saveDayCounter(dayCounter);
    console.log(`✅ تم إنجاز النشر، وحفظ المؤشر لليوم التالي بنجاح تام.`);
  } else {
    process.exitCode = 1;
  }
}

runDailyTask();
