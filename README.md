# Vintage Booth

Fotoğrafları vintage photobooth şeridine çeviren site.

- **Kabin** (`/booth`): Canlı kamera, her kare öncesi 3-2-1 geri sayım, flaş ve deklanşör sesi. Çekim boyunca sahne (geri sayım ve flaş dahil) video olarak kaydedilir.
- **QR:** Çekim bitince şerit ve video Supabase'e yüklenir, her çekime özel `/s/<id>` linki ve QR kod çıkar. Okutan kişi şeridi ve videoyu kendi telefonuna indirir.
- **Düzenleyici** (`/`): Galeriden fotoğraf ekleme; 2/3/4 kare, dikey/yatay, siyah-beyaz/sepya/soluk renk, beyaz/siyah kağıt, eskitme, fontlu yazı.
- **Yapay zeka perde:** Kişiyi arka plandan ayırıp arkasına beyaz, krem ya da siyah kabin perdesi koyar. Hem kabinin canlı önizlemesinde (dolayısıyla videoda) hem de şeritte çalışır. Tamamen cihazda çalışır (MediaPipe selfie segmenter), fotoğraf hiçbir sunucuya gitmez.
- Linkler `VITE_KEEP_DAYS` gün sonra (varsayılan 30, en fazla 90) otomatik silinir.

## 1. Supabase

1. [supabase.com](https://supabase.com) üzerinde yeni proje aç.
2. **SQL Editor → New query**, `supabase/schema.sql` dosyasının tamamını yapıştır ve **Run**'a bas. Bu adım `booth` depolama alanını, `sessions` tablosunu ve erişim kurallarını kurar.
3. **Project Settings → API** sayfasından `Project URL` ve `anon public` anahtarını al.

## 2. Yerelde çalıştır

```bash
cp .env.example .env      # URL ve anon key'i doldur
npm install
npm run dev
```

Kamera sadece `https` adreslerinde ya da `localhost`'ta açılır. Bilgisayarda `localhost` ile test edebilirsin. Telefonda test için Vercel'e yükle (3. adım).

## 3. Yayınla (Vercel)

1. Projeyi GitHub'a gönder.
2. Vercel → **Add New Project** → repoyu seç. Framework olarak Vite otomatik algılanır.
3. **Environment Variables** kısmına `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` ve istersen `VITE_KEEP_DAYS` ekle → **Deploy**.

`vercel.json`, `/s/<id>` gibi linklerin doğrudan açılmasını sağlar.

## 4. Otomatik silme (önerilir)

```bash
npm i -g supabase
supabase login
supabase link --project-ref PROJECT_REF
supabase functions deploy cleanup
```

Ardından `supabase/cron.sql` içindeki `PROJECT_REF` ve `ANON_KEY` alanlarını doldurup SQL Editor'da bir kez çalıştır. Süresi dolan şerit ve videolar her gece silinir.

## Notlar

- **Video formatı:** iPhone (Safari) MP4, Chrome sürüme göre MP4 ya da WebM kaydeder. 4 karelik bir çekim yaklaşık 20 saniye, 3-6 MB tutar. Supabase ücretsiz katmanı 1 GB depolama veriyor; 30 günlük silmeyle yüzlerce çekime yeter.
- **Yapay zeka perde:** `npm install` sırasında MediaPipe dosyaları otomatik olarak `public/mediapipe` klasörüne kopyalanır. Model (~250 KB) ilk kullanımda Google'ın sunucusundan iner. Kendin barındırmak istersen dosyayı `public/models/` altına koyup `.env` içine `VITE_SEGMENTER_MODEL=/models/selfie_segmenter.tflite` yaz. Varsayılan ayar "Orijinal"; perdeyi varsayılan yapmak istersen `src/lib/strip.js` içinde `backdrop: "white"` yap. Şeritteki kareler MODNet portre modeliyle (saç teline kadar) kesilir; bu model ilk kullanımda ~25 MB iner ve tarayıcıda saklanır. Model yüklenemezse hızlı modele ve kenar düzeltmeye geçer. Canlı önizlemede hızlı model + kenar düzeltme + titreme azaltma kullanılır.
- **Galeriye kaydetme:** iPhone'da "kaydet" butonları paylaşım menüsünü açar; "Görüntüyü Kaydet"/"Videoyu Kaydet" ile Fotoğraflar'a gider. Android'de normal indirme yapılır, galeri İndirilenler klasörünü zaten gösterir.
- **Ses:** Varsayılan olarak kapalı. Kabinde "Videoya sesi de kaydet" açılırsa mikrofon izni istenir.
- **Gizlilik / KVKK:** Kabinde, yükleme yapılacağı ve linkin kaç gün sonra silineceği yazıyor. "QR ile paylaş" kapatılırsa hiçbir şey yüklenmez. Etkinlikte kullanacaksan girişe kısa bir aydınlatma metni koymak iyi olur.
- **Kötüye kullanım:** Yükleme herkese açık (sadece yeni dosya eklenebilir; listeleme, silme ve üzerine yazma kapalı). Herkese açık bir etkinlikte spam olursa Cloudflare Turnstile gibi bir doğrulama eklenebilir.

## Dosyalar

```
src/
  lib/strip.js          şerit motoru (ton, gren, eskitme, düzen, yazı)
  lib/supabase.js       yükleme ve paylaşım linki
  lib/backdrop.js       yapay zeka ile arka plan ayırma + perde
  lib/settings.jsx      ayarlar (tarayıcıda hatırlanır)
  pages/Home.jsx        düzenleyici
  pages/Booth.jsx       canlı kabin: geri sayım, çekim, video, QR
  pages/Share.jsx       QR'dan açılan sayfa
  components/           ayar paneli, QR kartı, ikonlar
supabase/
  schema.sql            depolama + tablo + kurallar
  functions/cleanup     süresi dolanları silen fonksiyon
  cron.sql              silmeyi her gece çalıştırır
```
