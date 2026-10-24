const sharp = require('sharp');

const inputPath = 'C:/Users/user/.gemini/antigravity/brain/53257e6c-2cf6-4b26-9696-2ba7f24ae947/.user_uploaded/media_1792817768016_500a6b7c.jpg';
const outDir = 'D:/Nasir/Andurma/fhoto';

// Şəkili rəngləndirən + yan rakurs verən funksiya
async function processImage(inputBuffer, outputPath, label) {
  const meta = await sharp(inputBuffer).metadata();
  const w = meta.width;
  const h = meta.height;

  // 1. Rəngləndirmə: daha canlı, dəri tonu + istilik
  // Grayscale əsasında üç ayrı kanal yaradırıq:
  //   R = parlaq (dəri, üz)
  //   G = orta
  //   B = kölgə tonu
  const grayBuf = await sharp(inputBuffer)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = grayBuf.data;
  const rgbPixels = Buffer.alloc(pixels.length * 3);

  for (let i = 0; i < pixels.length; i++) {
    const g = pixels[i];
    // Dəri tonu rəngləndirməsi (warm tone mapping)
    // Açıq sahələr → dəri rəngi (narıncı-çəhrayı)
    // Tünd sahələr → tünd-qəhvəyi/yaşıl
    let r, gb, b;
    if (g > 180) {
      // Çox açıq (üz, alnı) → açıq dəri tonu
      r = Math.min(255, g + 30);
      gb = Math.min(255, g - 10);
      b = Math.min(255, g - 40);
    } else if (g > 100) {
      // Orta ton → istilik
      r = Math.min(255, g + 50);
      gb = Math.min(255, g + 10);
      b = Math.min(255, g - 30);
    } else if (g > 50) {
      // Tünd orta → zeytin/qəhvəyi
      r = Math.min(255, g + 20);
      gb = Math.min(255, g + 5);
      b = Math.max(0, g - 20);
    } else {
      // Çox tünd (saç, geyim) → tünd saxla
      r = g;
      gb = g;
      b = g;
    }
    rgbPixels[i * 3]     = r;
    rgbPixels[i * 3 + 1] = gb;
    rgbPixels[i * 3 + 2] = b;
  }

  // 2. Yan rakurs (affine shear + slight rotation)
  // Soldan-sağa yüngül perspektiv əyimi
  const colored = await sharp(rgbPixels, {
    raw: { width: w, height: h, channels: 3 }
  })
    .affine(
      [[1, -0.05], [0.02, 1]],   // yüngül sola yatım (rakurs)
      { background: { r: 200, g: 170, b: 130 } }
    )
    .modulate({ brightness: 1.05, saturation: 1.3 })
    .sharpen({ sigma: 0.8 })
    .jpeg({ quality: 95 })
    .toBuffer();

  await sharp(colored).toFile(outputPath);
  console.log(`✅ ${label} saxlandı: ${outputPath}`);
}

async function run() {
  const meta = await sharp(inputPath).metadata();
  const w = meta.width;
  const h = meta.height;
  console.log(`Orijinal ölçü: ${w}x${h}`);

  // Orijinal faylı buffer-ə yüklə
  const origBuf = await sharp(inputPath).toBuffer();

  // 1. Hər ikisi birlikdə
  await processImage(origBuf, `${outDir}/rengli_ikisi_v2.jpg`, 'İkisi birlikdə');

  // 2. Yalnız kişi (sol 52%)
  const manWidth = Math.floor(w * 0.52);
  const manBuf = await sharp(origBuf)
    .extract({ left: 0, top: 0, width: manWidth, height: h })
    .toBuffer();
  await processImage(manBuf, `${outDir}/rengli_kisi_v2.jpg`, 'Kişi portreti');

  // 3. Yalnız qadın (sağ 52%)
  const womanLeft = Math.floor(w * 0.48);
  const womanWidth = w - womanLeft;
  const womanBuf = await sharp(origBuf)
    .extract({ left: womanLeft, top: 0, width: womanWidth, height: h })
    .toBuffer();
  await processImage(womanBuf, `${outDir}/rengli_qadin_v2.jpg`, 'Qadın portreti');

  console.log('\n🎉 Hamısı tamamlandı!');
}

run().catch(console.error);
