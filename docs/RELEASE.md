# MongoG Release Guide

Bu dosya Windows, macOS ve Linux paketlerini CircleCI üzerinden derleyip GitHub
Releases'a göndermek için kullanılacak kısa kontrol listesidir.

> **İmzalama durumu:** macOS paketleri Apple Developer ID ile imzalanır, Apple
> tarafından notarize edilir ve biletleri pakete zımbalanır. Windows uygulaması
> ve x64 NSIS kurucusu maliyet nedeniyle açıkça `UNSIGNED` olarak yayımlanır;
> SmartScreen uyarısı beklenir ve otomatik güncelleme kapalıdır. Linux resmî
> yayını yalnız x64 RPM'dir.

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

## CircleCI'de kontrol ve indirme

1. CircleCI içindeki `release` workflow'unun tamamlanmasını bekle.
2. `release` context erişiminin yalnız yetkili proje ve ekiplerle sınırlı
   olduğunu doğrula.
3. macOS arm64/x64, Windows x64 ve Linux x64 job'larının geçtiğini doğrula.
4. İstediğin job'u açıp **Artifacts** sekmesine gir.
5. macOS için `release-macos-arm64` veya `release-macos-x64` altındaki imzalı
   `.dmg` ve `.zip` dosyalarını indir.
6. Windows x64 NSIS dosyasının adında `UNSIGNED` bulunduğunu, Authenticode
   durumunun `NotSigned` olduğunu ve pakette `resources/app-update.yml`
   bulunmadığını doğrula.
7. Linux job'unda yalnız `.rpm` bulunduğunu ve paketteki
   `resources/package-type` değerinin `rpm` olduğunu doğrula.
8. `release-metadata` job'unun altı paketi bir araya getirdiğini,
   `SHA256SUMS.txt` ile `latest-mac.yml` ve `latest-linux.yml` dosyalarını
   ürettiğini doğrula; `latest.yml` yayımlanmamalıdır.
9. Altı paketi ve iki updater manifestini web admin paneline birlikte yükle.
   `/update` yayını atomik değiştirilmeden sürümü aktif etme; istemci eksik veya
   eski bir manifest ile yeni paketi eşleştirmemelidir.

İlk kurulumda GitHub bağlantısında tag-push tetiklemesini etkinleştir. CircleCI'de
`release` adında restricted context oluşturup yukarıdaki Apple imzalama
değişkenlerini ekle. GitHub token'ı gerekmez.

Mevcut bir tag'i yeniden derlemek için CircleCI'de **Trigger Pipeline** açıp
`run_release=true` ve `release_tag=vX.Y.Z` parametrelerini ver. Ayrıntılar için
ana [README](../README.md#circleci-and-github-releases) belgesine bak.
