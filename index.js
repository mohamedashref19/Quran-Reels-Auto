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

// ==========================================
// 0. تنظيف نص الآية من علامات الوقف
// ==========================================
// علامات الوقف القرآنية (ۖ ۗ ۘ ۙ ۚ ۛ) = U+06D6 إلى U+06DB، وعلامة الحزب ۞ = U+06DE.
// دي بتظهر مربعات (▯) في الصورة، فبنشيلها ونوحّد المسافات اللي بتتبقى مكانها.
// بنسيب باقي التشكيل والعلامات الأساسية زي ما هي.
function cleanAyahText(text) {
  return String(text)
    .replace(/[\u06D6-\u06DB\u06DE]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ==========================================
// 1. جلب بيانات الآية
// ==========================================
async function getAyahData(globalAyahNumber, reciterIndex = 0, retries = 3) {
  try {
    const reciters = [
      "ar.alafasy",
      "ar.mahermuaiqly",
      "ar.abdulbasitmurattal",
      "ar.husary",
      "ar.minshawi",
    ];
    // التعديل: القارئ بيتحدد بالترتيب حسب رقم اليوم بدل Math.random، فكل يوم شيخ مختلف
    // عن اللي قبله ومفيش تكرار ورا بعض، ولما الشيوخ يخلصوا بنبدأ من الأول.
    const reciter = reciters[reciterIndex % reciters.length];
    console.log(`   🎙️ القارئ: ${reciter}`);
    const response = await axios.get(
      `http://api.alquran.cloud/v1/ayah/${globalAyahNumber}/${reciter}`,
    );
    const data = response.data.data;
    return {
      text: cleanAyahText(data.text),
      surahName: data.surah.name,
      numberInSurah: data.numberInSurah,
      audioUrl: data.audio,
    };
  } catch (error) {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return await getAyahData(globalAyahNumber, reciterIndex, retries - 1);
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

  // sort() عشان الترتيب يبقى ثابت (readdirSync مش مضمون الترتيب)، والفلتر مش حساس لحالة الحروف
  const files = fs
    .readdirSync(videosDir)
    .filter((file) => file.toLowerCase().endsWith(".mp4"))
    .sort();
  if (files.length === 0)
    throw new Error('⚠️ مجلد "videos" فارغ! أرجو وضع فيديوهات بداخله.');

  // التعديل: بدل Math.random (اللي ممكن يختار نفس الفيديو كذا يوم ورا بعض، خصوصاً
  // لو عدد الفيديوهات قليل)، بنلف على الفيديوهات بالترتيب حسب رقم اليوم.
  // كده كل يوم فيديو مختلف عن اللي قبله، ولما نخلص كلهم بنبدأ من الأول.
  const chosen = files[rotationIndex % files.length];
  console.log(
    `   🎞️ الفيديو المختار: ${chosen} (من ${files.length} فيديو متاح)`,
  );
  fs.copyFileSync(path.join(videosDir, chosen), outputPath);
  return outputPath;
}

// ==========================================
// 3. (أ) تصميم صورة الآية (ضخمة وواضحة)
// ==========================================
async function generateAyahImage(ayahInfo, browser) {
  console.log("2. جاري تصميم الآية...");
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920 });

  // المنطقة الآمنة للنص: بنسيب مساحة فوق وتحت لأن واجهة انستجرام (اسم الحساب،
  // الكابشن، الأزرار) بتغطي حوالي أول 250 بكسل وآخر 400 بكسل من الريل.
  const SAFE_TOP = 250;
  const SAFE_BOTTOM = 400;
  const AVAILABLE_HEIGHT = 1920 - SAFE_TOP - SAFE_BOTTOM;
  const MAX_FONT = 110; // حجم الخط للآيات القصيرة (نفس القديم)
  const MIN_FONT = 30; // أقل حجم مسموح للآيات الطويلة جداً

  // التعديل 1: خط "Amiri Quran" بدل "Amiri" العادي، لأنه الخط اللي فيه رموز
  // الوقف والعلامات القرآنية (ۖ ۗ ۚ ۛ ...). الخط العادي مكانش فيها فكانت بتظهر مربعات.
  // التعديل 2: كل الأحجام (اسم السورة، رقم الآية، الهوامش) مربوطة بمتغير --fs
  // فبتصغر مع النص بنفس النسبة.
  const htmlContent = `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Amiri+Quran&family=Amiri:wght@700&display=swap');
                :root { --fs: ${MAX_FONT}px; }
                html, body { width: 1080px; height: 1920px; margin: 0; background: transparent !important; }
                body { position: relative; font-family: 'Amiri Quran', 'Amiri', serif; color: #ffffff; text-shadow: 0 8px 30px rgba(0, 0, 0, 1), 0 3px 10px rgba(0, 0, 0, 1); }
                .safe-area { position: absolute; top: ${SAFE_TOP}px; left: 0; right: 0; height: ${AVAILABLE_HEIGHT}px; display: flex; justify-content: center; align-items: center; }
                .content { width: 100%; box-sizing: border-box; padding: 0 60px; display: flex; flex-direction: column; align-items: center; }
                .surah-name { font-family: 'Amiri', serif; font-weight: 700; font-size: min(65px, calc(var(--fs) * 0.65)); color: #d4af37; margin-bottom: calc(var(--fs) * 0.3); }
                .ayah-text { font-size: var(--fs); line-height: 1.8; text-align: center; font-weight: normal; }
                .ayah-number { font-family: 'Amiri', serif; font-weight: 700; font-size: min(55px, calc(var(--fs) * 0.55)); color: #d4af37; margin-top: calc(var(--fs) * 0.3); }
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
  await page.setContent(htmlContent, { waitUntil: "networkidle0" });

  // التعديل 3: ضبط حجم الخط تلقائياً. بنجرب أكبر حجم، ولو الكتلة كلها (اسم السورة +
  // الآية + الرقم) أطول من المساحة الآمنة بنعمل بحث ثنائي عن أكبر حجم يناسب.
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
  if (!fit.fits) {
    console.warn(
      "   ⚠️ الآية طويلة جداً حتى على أصغر حجم خط، ممكن يتقص جزء منها.",
    );
  }

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
  await page.setContent(htmlContent, { waitUntil: "networkidle0" });
  const imagePath = path.join(__dirname, "outro_overlay.png");
  await page.screenshot({ path: imagePath, type: "png", omitBackground: true });
  return imagePath;
}

// ==========================================
// 4. تحميل الصوت ومعرفة مدته الزمنية
// ==========================================
async function downloadAudio(audioUrl, outputPath) {
  console.log("4. جاري تحميل التلاوة...");
  const response = await axios({
    method: "GET",
    url: audioUrl,
    responseType: "arraybuffer",
  });
  fs.writeFileSync(outputPath, response.data);
}

function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration);
    });
  });
}

// ==========================================
// 5. المونتاج الذكي والمزامنة (النسخة المستقرة على السيرفرات)
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

  // التعديل 1: بدل -stream_loop (اللي بيفشل في الرجوع لأول الفيديو في FFmpeg 7.x
  // وبيقطع الفيديو عند نهاية أول لفة)، بنكرر الفيديو بقائمة concat.
  // كده مفيش seek خالص والفيديو بيكمل لحد ما الصوت يخلص.
  const videoDuration = await getAudioDuration(videoInput);
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
        "[0:v]eq=brightness=-0.3:contrast=1.1[bg]",
        `[bg][1:v]overlay=0:0:enable='between(t,0,${safeDuration})'[v1]`,
        `[v1][2:v]overlay=0:0:enable='between(t,${safeDuration},${totalDuration})'[outv]`,
      ])
      .outputOptions([
        "-map [outv]",
        "-map 3:a",
        `-t ${totalDuration}`,
        "-c:v libx264",
        // التعديل 2: preset أبطأ شوية + سقف للـ bitrate عشان حجم الملف.
        // قبل كده كان 20+ ميجابت/ثانية (38MB لـ 15 ثانية) ومع آية الكرسي كان هيعدي 100MB.
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
        // شبكة أمان: لو FFmpeg رجّع كود خطأ لكن الملف كامل بالمدة المطلوبة نكمل.
        try {
          if (fs.existsSync(videoOutput) && fs.statSync(videoOutput).size > 0) {
            const outDuration = await getAudioDuration(videoOutput);
            if (outDuration >= parseFloat(totalDuration) - 0.5) {
              console.warn(
                `⚠️ FFmpeg رجّع خطأ (${err.message}) لكن الفيديو الناتج سليم (${outDuration.toFixed(2)} ثانية). هنكمل.`,
              );
              return resolve();
            }
            console.error(
              `❌ الفيديو الناتج ناقص: ${outDuration.toFixed(2)} ثانية بدل ${totalDuration}`,
            );
          }
        } catch (probeErr) {
          // لو فشل فحص الملف نكمل للرفض الطبيعي
        }
        console.error("\n❌ تفاصيل خطأ FFmpeg الداخلي:\n", stderr);
        reject(err);
      });
  });
}

// ==========================================
// 5.5 رفع الفيديو (مع بدائل تلقائية لو خدمة رفضت الطلب)
// ==========================================
const UPLOAD_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// الخدمات المجانية المجهولة (catbox / litterbox / 0x0.st) بتحظر أو بتوقف الرفع من
// سيرفرات GitHub Actions كتير. الخيار الموثوق هو Cloudinary (حساب مجاني): لو ضفت
// المتغيرين CLOUDINARY_CLOUD_NAME و CLOUDINARY_UPLOAD_PRESET هو اللي بيتجرب الأول.
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
      // الرابط اللي بيرجع صفحة عرض، ولازم نحوله لرابط تحميل مباشر (/dl/)
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
  // لازم FormData جديد (وstream جديد) لكل محاولة
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
    // محاولتين لكل خدمة (أخطاء 5xx غالباً مؤقتة)
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
async function runAutomation(currentAyahNumber, rotationIndex = 0) {
  const tempVideo = path.join(__dirname, "temp_nature.mp4");
  const ayahImage = path.join(__dirname, "ayah_overlay.png");
  const outroImage = path.join(__dirname, "outro_overlay.png");
  const audioPath = path.join(__dirname, "audio.mp3");
  const finalVideo = path.join(__dirname, "final_video.mp4");

  try {
    const ayahInfo = await getAyahData(currentAyahNumber, rotationIndex);
    if (!ayahInfo) return false;

    await getRandomNatureVideo(tempVideo, rotationIndex);

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    await generateAyahImage(ayahInfo, browser);
    await generateOutroImage(browser);
    await browser.close();

    await downloadAudio(ayahInfo.audioUrl, audioPath);
    const duration = await getAudioDuration(audioPath);

    await createFinalMedia(
      tempVideo,
      ayahImage,
      outroImage,
      audioPath,
      duration,
      finalVideo,
    );

    console.log("6. جاري رفع الفيديو للحصول على رابط مباشر...");
    const directUrl = await uploadVideo(finalVideo);
    console.log("✅ تم الرفع، الرابط:", directUrl);

    console.log("7. جاري إرسال البيانات إلى Make.com...");
    const captionText = `﴿ ${ayahInfo.surahName} - آية ${ayahInfo.numberInSurah} ﴾\n\nتطبيق اقرأ - رفيقك لختم القرآن 📖\n✨ حمل التطبيق الآن مجاناً من الرابط في البايو ✨\n\n#قرآن #تطبيق_اقرأ #تلاوة #قرآن_كريم`;

    // رابط منصة Make بيتقرأ من GitHub Secret (MAKE_WEBHOOK_URL) مش مكتوب في الكود،
    // لأن الريبو Public وأي حد كان هيقدر يشوف الرابط ويبعتله.
    const webhookUrl = (process.env.MAKE_WEBHOOK_URL || "").trim();
    if (!webhookUrl) {
      throw new Error(
        "المتغير MAKE_WEBHOOK_URL مش موجود. ضيفه في GitHub Secrets.",
      );
    }

    // التعديل: بنبعت JSON بدل multipart/form-data. وصل لـ Make طلب حجمه 789 بايت لكن Make
    // طلّع Bundle فاضي (مفيش حقول)، يعني الـ parsing للـ multipart فشل عنده. الـ JSON
    // هو الشكل القياسي للـ Custom webhook وبيتبعت بـ Content-Length واضح.
    const payload = { videoUrl: directUrl, caption: captionText };
    // توكن سري: Make بيفلتر على أساسه، فلو حد عرف رابط الـ webhook لوحده ما يقدرش
    // يستخدمه من غير التوكن ده. التوكن بيتقرأ من GitHub Secret مش من الكود.
    if (process.env.MAKE_WEBHOOK_SECRET) {
      payload.secret = process.env.MAKE_WEBHOOK_SECRET.trim();
    } else {
      console.warn(
        "   ⚠️ MAKE_WEBHOOK_SECRET مش موجود، الـ webhook مش محمي بتوكن.",
      );
    }

    const webhookRes = await axios.post(webhookUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 60000,
    });
    console.log(
      `   📨 رد Make: ${webhookRes.status} ${String(webhookRes.data).slice(0, 100)}`,
    );
    console.log("✅ تم إرسال الرابط إلى Make بنجاح!");

    // تنظيف الملفات المؤقتة
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
// 7. مصفوفة أفضل 30 آية ومتابعة النشر
// ==========================================

// أفضل 30 آية مختارة بعناية (آيات الطمأنينة، الصبر، والجبر)
const curatedAyahs = [
  262, // آية الكرسي
  293, // لا يكلف الله نفسا إلا وسعها
  432, // ولا تهنوا ولا تحزنوا
  521, // ويريد الله أن يخفف عنكم
  1588, // واصبر فإن الله لا يضيع أجر المحسنين (التي كنت تستخدمها)
  1682, // إنما أشكو بثي وحزني إلى الله
  1735, // ألا بذكر الله تطمئن القلوب
  1887, // فاصفح الصفح الجميل
  2052, // وقضى ربك ألا تعبدوا إلا إياه وبالوالدين إحسانا
  2247, // إن الذين آمنوا وعملوا الصالحات كانت لهم جنات الفردوس نزلا
  2346, // إن الذين آمنوا وعملوا الصالحات سيجعل لهم الرحمن ودا
  2394, // قال لا تخافا إنني معكما أسمع وأرى
  2572, // رب لا تذرني فردا وأنت خير الوارثين
  2791, // وقل رب اغفر وارحم وأنت خير الراحمين
  2826, // الله نور السماوات والأرض
  2933, // والذين يقولون ربنا هب لنا من أزواجنا وذرياتنا قرة أعين
  3015, // رب هب لي حكما وألحقني بالصالحين
  3221, // أمن يجيب المضطر إذا دعاه ويكشف السوء
  3530, // ومن يتق الله يجعل له مخرجا
  3634, // قل يا عبادي الذين أسرفوا على أنفسهم لا تقنطوا من رحمة الله
  4082, // فصبر جميل والله المستعان
  4210, // وقال ربكم ادعوني أستجب لكم
  4303, // واصبر لحكم ربك فإنك بأعيننا
  478, // كل نفس ذائقة الموت
  848, // وعنده مفاتح الغيب لا يعلمها إلا هو
  1008, // إن ربكم الله الذي خلق السماوات والأرض
  1162, // إنما المؤمنون الذين إذا ذكر الله وجلت قلوبهم
  1275, // لا تحزن إن الله معنا
  1757, // ولئن شكرتم لأزيدنكم
  2672, // يا أيها الذين آمنوا اركعوا واسجدوا واعبدوا ربكم
];

// قمنا بتغيير اسم الملف ليتناسب مع الاستراتيجية الجديدة (يحفظ الترتيب من 0 إلى 29)
const ayahTrackerFile = path.join(__dirname, "current_ayah_index.txt");

// التعديل: الملف بقى بيخزن "عداد أيام" بيزيد على طول ومش بيرجع للصفر (نفس اسم الملف
// عشان الـ workflow). منه بنحسب:
//   - ترتيب الآية في الدورة = العداد % 30
//   - رقم الدورة            = العداد / 30 (بدون كسور)
// الأرقام القديمة (0 لـ 29) شغالة زي ما هي، لأنها بتتفسر كأول دورة.
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
  const ayahIndex = dayCounter % curatedAyahs.length;
  const cycle = Math.floor(dayCounter / curatedAyahs.length);
  const globalAyahNumber = curatedAyahs[ayahIndex];

  // رقم التدوير للفيديو والقارئ: بنضيف رقم الدورة على العداد، فكل دورة جديدة بتزيح
  // التوزيع، والآية اللي أخدت فيديو وشيخ معينين في دورة بتاخد غيرهم في الدورة اللي بعدها.
  // والأيام المتتالية بتفضل مختلفة لأن الفرق بينهم دايماً 1 (أو 2 عند بداية دورة جديدة).
  const rotationIndex = dayCounter + cycle;

  console.log(
    `\n🚀 بدء دورة النشر: اليوم ${ayahIndex + 1} من ${curatedAyahs.length} | الدورة رقم ${cycle + 1} | العداد الكلي: ${dayCounter}`,
  );
  console.log(`📖 الآية المختارة ترتيبها في المصحف: ${globalAyahNumber}`);

  const success = await runAutomation(globalAyahNumber, rotationIndex);
  if (success) {
    saveDayCounter(dayCounter);
    console.log(`✅ تم إنجاز النشر، وحفظ المؤشر لليوم التالي بنجاح تام.`);
  } else {
    // خلي الـ workflow يبان أحمر لما السكربت يفشل
    process.exitCode = 1;
  }
}

// التشغيل المباشر
runDailyTask();

// ==========================================
// 8. تحويل السكربت إلى سيرفر ويب (لاستقبال أمر التشغيل بدقة)
// ==========================================
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Quran Automation Server is Running!");
});

// هذا هو الرابط السري الذي سيشغل الأتمتة (لتجنب تشغيله من أشخاص غُرباء)
app.get("/trigger-publish-secret-123", async (req, res) => {
  res.send("تم استلام الطلب.. جاري بدء دورة النشر في الخلفية!");
  // تشغيل الدورة في الخلفية دون جعل المنبه ينتظر
  await runDailyTask();
});

app.listen(PORT, () => {
  console.log(`🚀 السيرفر يعمل ومستعد لتلقي الأوامر على البورت ${PORT}`);
});
