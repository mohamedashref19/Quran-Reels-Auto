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
// 1. جلب بيانات الآية
// ==========================================
async function getAyahData(globalAyahNumber, retries = 3) {
  try {
    const reciters = [
      "ar.alafasy",
      "ar.mahermuaiqly",
      "ar.abdulbasitmurattal",
      "ar.husary",
      "ar.minshawi",
    ];
    const randomReciter = reciters[Math.floor(Math.random() * reciters.length)];
    const response = await axios.get(
      `http://api.alquran.cloud/v1/ayah/${globalAyahNumber}/${randomReciter}`,
    );
    const data = response.data.data;
    return {
      text: data.text,
      surahName: data.surah.name,
      numberInSurah: data.numberInSurah,
      audioUrl: data.audio,
    };
  } catch (error) {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return await getAyahData(globalAyahNumber, retries - 1);
    }
    throw error;
  }
}

// ==========================================
// 2. اختيار فيديو طبيعي من مجلد videos
// ==========================================
async function getRandomNatureVideo(outputPath) {
  console.log("1. جاري اختيار فيديو طبيعي...");
  const videosDir = path.join(__dirname, "videos");
  if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir);

  const files = fs
    .readdirSync(videosDir)
    .filter((file) => file.endsWith(".mp4"));
  if (files.length === 0)
    throw new Error('⚠️ مجلد "videos" فارغ! أرجو وضع فيديوهات بداخله.');

  const randomVideo = files[Math.floor(Math.random() * files.length)];
  fs.copyFileSync(path.join(videosDir, randomVideo), outputPath);
  return outputPath;
}

// ==========================================
// 3. (أ) تصميم صورة الآية (ضخمة وواضحة)
// ==========================================
async function generateAyahImage(ayahInfo, browser) {
  console.log("2. جاري تصميم الآية...");
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
                body { display: flex; flex-direction: column; justify-content: center; align-items: center; font-family: 'Amiri', serif; color: #ffffff; text-shadow: 0 8px 30px rgba(0, 0, 0, 1), 0 3px 10px rgba(0, 0, 0, 1); }
                .surah-name { font-size: 65px; color: #d4af37; margin-bottom: 40px; }
                .ayah-text { font-size: 110px; line-height: 1.8; text-align: center; padding: 0 60px; font-weight: bold; }
                .ayah-number { font-size: 55px; color: #d4af37; margin-top: 40px; }
            </style>
        </head>
        <body>
            <div class="surah-name">﴿ ${ayahInfo.surahName} ﴾</div>
            <div class="ayah-text">${ayahInfo.text}</div>
            <div class="ayah-number">﴿ ${ayahInfo.numberInSurah} ﴾</div>
        </body>
        </html>
    `;
  await page.setContent(htmlContent, { waitUntil: "networkidle0" });
  const imagePath = path.join(__dirname, "ayah_overlay.png");
  await page.screenshot({ path: imagePath, type: "png", omitBackground: true });
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
  console.log(
    `5. جاري المونتاج.. (مدة الآية: ${audioDuration} ثانية | مدة النهاية: 2 ثانية)`,
  );
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoInput)
      .inputOptions(["-stream_loop -1"])
      .input(ayahImage)
      .input(outroImage)
      .input(audioInput)
      .complexFilter([
        "[0:v]eq=brightness=-0.3:contrast=1.1[bg]",
        `[bg][1:v]overlay=0:0:enable='between(t,0,${audioDuration})'[v1]`,
        `[v1][2:v]overlay=0:0:enable='between(t,${audioDuration},${audioDuration + 2})'[outv]`,
      ])
      .outputOptions([
        "-map [outv]",
        "-map 3:a",
        `-t ${audioDuration + 2}`,
        "-c:v libx264",
        "-preset fast",
        "-crf 28",
        "-c:a aac",
        "-b:a 192k",
        "-pix_fmt yuv420p",
      ])
      .save(videoOutput)
      .on("end", () => resolve())
      .on("error", (err) => reject(err));
  });
}

// ==========================================
// 6. تشغيل الدورة بالكامل
// ==========================================
async function runAutomation(currentAyahNumber) {
  const tempVideo = path.join(__dirname, "temp_nature.mp4");
  const ayahImage = path.join(__dirname, "ayah_overlay.png");
  const outroImage = path.join(__dirname, "outro_overlay.png");
  const audioPath = path.join(__dirname, "audio.mp3");
  const finalVideo = path.join(__dirname, "final_video.mp4");

  try {
    const ayahInfo = await getAyahData(currentAyahNumber);
    if (!ayahInfo) return false;

    await getRandomNatureVideo(tempVideo);

    const browser = await puppeteer.launch();
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
    const uploadForm = new FormData();
    uploadForm.append("reqtype", "fileupload");
    uploadForm.append("fileToUpload", fs.createReadStream(finalVideo));

    const uploadRes = await axios.post(
      "https://catbox.moe/user/api.php",
      uploadForm,
      {
        headers: uploadForm.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      },
    );

    const directUrl = uploadRes.data.trim();
    console.log("✅ تم الرفع، الرابط:", directUrl);

    console.log("7. جاري إرسال البيانات إلى Make.com...");
    const webhookForm = new FormData();
    webhookForm.append("videoUrl", directUrl);
    const captionText = `﴿ ${ayahInfo.surahName} - آية ${ayahInfo.numberInSurah} ﴾\n\nتطبيق اقرأ - رفيقك لختم القرآن 📖\n✨ حمل التطبيق الآن مجاناً من الرابط في البايو ✨\n\n#قرآن #تطبيق_اقرأ #تلاوة #قرآن_كريم`;
    webhookForm.append("caption", captionText);

    // رابط منصة Make الخاص بك
    const webhookUrl =
      "https://hook.eu1.make.com/yharpxmxn0efm9q1ae3chclhzddncqbb";
    await axios.post(webhookUrl, webhookForm, {
      headers: webhookForm.getHeaders(),
    });
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

function getNextAyahIndex() {
  if (fs.existsSync(ayahTrackerFile)) {
    let currentIndex = parseInt(fs.readFileSync(ayahTrackerFile, "utf-8"));
    // إذا وصل الكود لآخر آية في المصفوفة، يعيد نفسه لليوم الأول (رقم 0)
    if (currentIndex >= curatedAyahs.length || isNaN(currentIndex)) {
      return 0;
    }
    return currentIndex;
  }
  return 0;
}

function updateAyahIndex(currentIndex) {
  let nextIndex = currentIndex + 1;
  // إعادة ضبط العداد إذا انتهينا من الـ 30 آية
  if (nextIndex >= curatedAyahs.length) {
    nextIndex = 0;
  }
  fs.writeFileSync(ayahTrackerFile, nextIndex.toString());
}

async function runDailyTask() {
  const currentIndex = getNextAyahIndex();
  const globalAyahNumber = curatedAyahs[currentIndex];

  console.log(
    `\n🚀 بدء دورة النشر لليوم رقم: ${currentIndex + 1} من أصل 30 يوم.`,
  );
  console.log(`📖 الآية المختارة ترتيبها في المصحف: ${globalAyahNumber}`);

  const success = await runAutomation(globalAyahNumber);
  if (success) {
    updateAyahIndex(currentIndex);
    console.log(`✅ تم إنجاز النشر، وحفظ المؤشر لليوم التالي بنجاح تام.`);
  }
}

// التشغيل المباشر
runDailyTask();
