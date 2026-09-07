# MongoG Release Guide

Bu dosya Windows, macOS ve Linux paketlerini GitHub Actions üzerinden derleyip
taslak GitHub Release'a göndermek için kullanılacak kısa kontrol listesidir.

> **İmzalama durumu:** macOS paketleri Apple Developer ID ile imzalanır, Apple
> tarafından notarize edilir ve biletleri pakete zımbalanır. Windows uygulaması
> ve x64 NSIS kurucusu maliyet nedeniyle açıkça `UNSIGNED` olarak yayımlanır;
> SmartScreen/Unknown Publisher uyarısı beklenir. Windows güncellemeleri HTTPS
> ve SHA-512 ile doğrulanır ancak Authenticode yayıncı doğrulaması yapılmaz.
> Linux resmî yayını yalnız x64 RPM'dir.

## GitHub `release` environment

Environment'ı yalnız MongoG projesi ve yayın ekibiyle sınırla. Aşağıdaki
secret'lar gereklidir; değerleri loglara veya repoya yazma:

- `MACOS_CERTIFICATE_P12_BASE64`: Developer ID Application `.p12` dosyasının
  Base64 içeriği.
- `MACOS_CERTIFICATE_PASSWORD`: `.p12` dışa aktarma parolası.
- `MACOS_SIGN_IDENTITY`: Tam Developer ID Application kimliği.
- `APPLE_API_KEY_P8_BASE64`: App Store Connect API `.p8` dosyasının Base64
  içeriği.
- `APPLE_API_KEY_ID`: App Store Connect API anahtar kimliği.
- `APPLE_API_ISSUER_ID`: App Store Connect issuer kimliği.
Workflow bu materyali geçici keychain/dizinlere açar, ham Base64 değişkenlerini
yalnız hazırlık adımlarına verir ve iş bitince geçici dosyaları siler. macOS imzalama
materyali yoksa production yayımı güvenli biçimde reddedilir. Windows release
job'u Apple secret'larına erişmez ve olası CSC değişkenlerini NSIS üretiminden
önce temizler. Son draft job'u otomatik `GITHUB_TOKEN` ile yalnız
`contents: write` izni alır.

## Yeni sürüm yayınlama

Branch, `main` ve pull request push'larında workflow çalışmaz. Yalnız semantik
sürüm tag'i veya manuel `release_tag` girişi release'i başlatır. Typecheck, lint
ve unit testleri dört production build ile paralel çalışır. Integration,
Playwright E2E ve packaged smoke release süresini uzatmamak için çalıştırılmaz.

macOS ARM64/x64, Windows x64 ve Linux x64 paketleri ayrı GitHub-hosted
runner'larda paralel üretilir. Her production paketi yalnız bir kez oluşturulur;
ZIP, DMG, NSIS ve RPM adımları mevcut paketi tekrar kullanır. npm, Electron ve
electron-builder download cache'leri platform ve mimariye göre ayrılır.

Aşağıdaki örnekteki `1.0.0` değerini yayınlanacak sürümle değiştir:

```bash
npm version 1.0.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: v1.0.0"
git tag v1.0.0
git push origin main v1.0.0
```

Önemli: `package.json` sürümü ile tag birebir aynı olmalıdır. Örneğin
`package.json` sürümü `1.0.0` ise tag `v1.0.0` olmalıdır. Aksi durumda release
workflow güvenli biçimde durur.

macOS, Windows ve Linux paketleri `build/app-update.yml` dosyasını paketleme
sırasında `Resources` dizinine alır. Bu dosya generic feed adresini ve
`mongog-updater` önbellek dizinini tanımlar; `setFeedURL()` kullanılması dosya
gereksinimini ortadan kaldırmaz. `verify:package` eksik veya bozuk
yapılandırmayı her üç platformda da reddeder.

1.2.8 öncesi kurulumda `app-update.yml` eksikse uygulama içinden indirme
başlatılamaz. Kullanıcı imzalı 1.2.8 DMG'sini indirip uygulamayı bir kez manuel
değiştirmelidir; kullanıcı veri dizini silinmez. Kurulu `.app` içine dosya
ekleme: bu işlem imzayı geçersiz kılar. Mevcut `v1.2.7` etiketi korunur.

Windows'ta updater yapılandırması içermeyen eski sürümler yeni sürüm kontrolüne
kendiliğinden geçemez. İlk uyumlu sürüm bir kez manuel kurulmalıdır. Sonraki
sürümlerde uygulama `latest.yml` dosyasını yalnız sürüm tespiti için okur;
kurucuyu indirmez veya çalıştırmaz. Kullanıcı `https://mongog.com/releases`
sayfasından güncel NSIS kurucusunu indirip kendisi çalıştırır.

## GitHub Actions'ta kontrol ve indirme

1. GitHub **Actions → Release** workflow'unun tamamlanmasını bekle.
2. `release` environment erişiminin yalnız yetkili proje ve ekiplerle sınırlı
   olduğunu doğrula.
3. Unit/typecheck/lint ile macOS arm64/x64, Windows x64 ve Linux x64 job'larının
   geçtiğini doğrula.
4. Workflow özetindeki `release-bundle-vX.Y.Z` artifact'ini veya draft release'i aç.
5. macOS için `release-macos-arm64` ve `release-macos-x64` altındaki imzalı
   `.dmg` ve `.zip` dosyalarını indir.
6. Windows x64 NSIS dosyasının adında `UNSIGNED` bulunduğunu, Authenticode
   durumunun `NotSigned` olduğunu ve pakette geçerli `resources/app-update.yml`
   bulunduğunu doğrula.
7. Linux job'unda yalnız `.rpm` bulunduğunu ve paketteki
   `resources/package-type` değerinin `rpm` olduğunu doğrula.
8. `Assemble draft release` job'unun altı paketi bir araya getirdiğini,
   `SHA256SUMS.txt` ile `latest-mac.yml`, `latest.yml` ve `latest-linux.yml`
   dosyalarını ürettiğini doğrula.
9. Draft GitHub Release notlarını gözden geçirip yayına aç. Altı paketi ve üç
   updater manifestini web admin paneline birlikte yükle.
   `/update` yayını atomik değiştirilmeden sürümü aktif etme; istemci eksik veya
   eski bir manifest ile yeni paketi eşleştirmemelidir.

İlk kurulumda repository **Settings → Environments** altında `release`
environment'ını oluşturup yukarıdaki Apple imzalama secret'larını ekle. Actions
için workflow yazma iznini etkinleştir. Eski CircleCI proje/webhook tetikleyicisini
ve branch protection içindeki CircleCI required-check kayıtlarını kapat.

Mevcut bir draft tag'i yeniden derlemek için **Actions → Release → Run workflow**
ekranında `release_tag=vX.Y.Z` ver. Workflow mevcut draft asset'lerini güvenli
biçimde yeniler; yayımlanmış bir release'i değiştirmeyi reddeder. Ayrıntılar için
ana [README](../README.md#github-actions-releases) belgesine bak.

## Başarısız release job'larını inceleme

Başarısız platform job'unda ilgili Forge, signing, notarization veya maker
adımını aç. Cache anahtarını, runner mimarisini ve tag/package sürüm eşleşmesini
kontrol et. Platform artifact'i yüklenmediyse `Assemble draft release` job'u
çalışmaz ve eksik bir draft release yayımlanmaz.

Bir kod düzeltmesini yalnız `main` dalına göndermek mevcut tag'in checkout edilen
kodunu değiştirmez. Yeni bir düzeltme yayını için yeni sürüm/tag kullan. Mevcut
bir draft tag yeniden derlenirse dört platform job'unun tamamını aynı workflow
run'ında üret; farklı commit'lerden gelen paketleri karıştırma.
