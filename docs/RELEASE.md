# MongoG Release Guide

Bu dosya Windows, macOS ve Linux paketlerini CircleCI üzerinden derleyip GitHub
Releases'a göndermek için kullanılacak kısa kontrol listesidir.

> **İmzalama durumu:** macOS paketleri Apple Developer ID ile imzalanır, Apple
> tarafından notarize edilir ve biletleri pakete zımbalanır. Windows uygulaması
> ve x64 NSIS kurucusu maliyet nedeniyle açıkça `UNSIGNED` olarak yayımlanır;
> SmartScreen/Unknown Publisher uyarısı beklenir. Windows güncellemeleri HTTPS
> ve SHA-512 ile doğrulanır ancak Authenticode yayıncı doğrulaması yapılmaz.
> Linux resmî yayını yalnız x64 RPM'dir.

## CircleCI `release` context

Context'i yalnız MongoG projesi ve yayın ekibiyle sınırla. Aşağıdaki değişkenler
gereklidir; değerleri loglara veya repoya yazma:

- `MACOS_CERTIFICATE_P12_BASE64`: Developer ID Application `.p12` dosyasının
  Base64 içeriği.
- `MACOS_CERTIFICATE_PASSWORD`: `.p12` dışa aktarma parolası.
- `MACOS_SIGN_IDENTITY`: Tam Developer ID Application kimliği.
- `APPLE_API_KEY_P8_BASE64`: App Store Connect API `.p8` dosyasının Base64
  içeriği.
- `APPLE_API_KEY_ID`: App Store Connect API anahtar kimliği.
- `APPLE_API_ISSUER_ID`: App Store Connect issuer kimliği.
CI bu materyali geçici keychain/dizinlere açar, ham Base64 değişkenlerini alt
süreçlerden kaldırır ve iş bitince geçici dosyaları siler. macOS imzalama
materyali yoksa production yayımı güvenli biçimde reddedilir. Windows release
job'u signing context'ine erişmez ve olası CSC değişkenlerini NSIS üretiminden
önce temizler.

## Yeni sürüm yayınlama

Branch ve `main` push'larında yalnız `quality` job'u çalışır; ayrı
`package-smoke-*` paketleme job'ları kapalıdır. Tag ile çalışan release
job'larının E2E, paket doğrulama ve production smoke kontrolleri korunur.

Windows toolchain Python'u Chocolatey yerine doğrudan Python.org'un sabit
3.12.10 x64 offline kurucusundan yükler. Node ve Python indirmeleri sınırlı
sayıda yeniden denenir, SHA-256 ile doğrulanır ve kurulum hatalarında job durur.
Python'un sürümü ve 64-bit mimarisi npm bağımlılıkları kurulmadan önce kontrol edilir.

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

Windows'ta updater yapılandırması içermeyen eski sürümler yeni akışa kendiliğinden
geçemez. Windows güncellemesini etkinleştiren ilk sürüm bir kez manuel kurulmalı;
sonraki sürümler `latest.yml` üzerinden arka planda indirilir ve yalnız kullanıcı
**Restart & Install** seçtiğinde uygulanır.

## CircleCI'de kontrol ve indirme

1. CircleCI içindeki `release` workflow'unun tamamlanmasını bekle.
2. `release` context erişiminin yalnız yetkili proje ve ekiplerle sınırlı
   olduğunu doğrula.
3. macOS arm64/x64, Windows x64 ve Linux x64 job'larının geçtiğini doğrula.
4. İstediğin job'u açıp **Artifacts** sekmesine gir.
5. macOS için `release-macos-arm64` veya `release-macos-x64` altındaki imzalı
   `.dmg` ve `.zip` dosyalarını indir.
6. Windows x64 NSIS dosyasının adında `UNSIGNED` bulunduğunu, Authenticode
   durumunun `NotSigned` olduğunu ve pakette geçerli `resources/app-update.yml`
   bulunduğunu doğrula.
7. Linux job'unda yalnız `.rpm` bulunduğunu ve paketteki
   `resources/package-type` değerinin `rpm` olduğunu doğrula.
8. `release-metadata` job'unun altı paketi bir araya getirdiğini,
   `SHA256SUMS.txt` ile `latest-mac.yml`, `latest.yml` ve `latest-linux.yml`
   dosyalarını ürettiğini doğrula.
9. Altı paketi ve üç updater manifestini web admin paneline birlikte yükle.
   `/update` yayını atomik değiştirilmeden sürümü aktif etme; istemci eksik veya
   eski bir manifest ile yeni paketi eşleştirmemelidir.

İlk kurulumda GitHub bağlantısında tag-push tetiklemesini etkinleştir. CircleCI'de
`release` adında restricted context oluşturup yukarıdaki Apple imzalama
değişkenlerini ekle. GitHub token'ı gerekmez.

Mevcut bir tag'i yeniden derlemek için CircleCI'de **Trigger Pipeline** açıp
`run_release=true` ve `release_tag=vX.Y.Z` parametrelerini ver. Ayrıntılar için
ana [README](../README.md#circleci-and-github-releases) belgesine bak.

## Başarısız E2E job'larını inceleme

Release job'ları başarısız olsa da **Artifacts → test-results** altında
Playwright `trace.zip`, hata bağlamı ve her uygulama açılışına ait
`electron-N.log` dosyaları saklanır. Kapanış hatalarında bu logdaki
`before-quit`, `will-quit`, `quit` olaylarını ve ana süreç hatasını kontrol et.
E2E kapanışı süre sınırına tabidir; süreç ağacı zorla temizlenirse test başarılı
sayılmaz. Windows geçici dizin temizliği, süreç çıktıktan sonra dosya kilitleri
için sınırlı sayıda yeniden denenir.

Bir kod düzeltmesini yalnız `main` dalına göndermek, mevcut tag'in yeniden
çalıştırılmasında kullanılan kodu değiştirmez: release job'ları tag'in commit'ini
checkout eder. Yeni bir düzeltme yayını için yeni sürüm/tag kullan. Mevcut bir
tag değiştirilirse eski/yeni commit'lerden üretilen platform paketlerini
karıştırmadan tüm release workflow'unu yeniden çalıştır.
