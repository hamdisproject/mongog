# MongoG Release Guide

Bu dosya Windows, macOS ve Linux paketlerini GitHub üzerinden yayınlamak için
kullanılacak kısa kontrol listesidir.

> **Geçici durum:** Bu yayınlar imzasız pre-release olarak oluşturulur. macOS
> paketleri notarize edilmez ve Windows paketleri Authenticode ile imzalanmaz.
> Kullanıcılarda işletim sistemi güvenlik uyarıları görülebilir.

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

## GitHub'da kontrol

1. GitHub Actions içindeki `Release` workflow'unun tamamlanmasını bekle.
2. Gerekirse korumalı `release` environment onayını ver.
3. macOS arm64/x64, Windows x64 ve Linux x64 job'larının geçtiğini doğrula.
4. GitHub Releases bölümünde oluşturulan draft release'i aç.
5. Release'in `Pre-release` ve `[UNSIGNED]` olarak işaretlendiğini doğrula.
6. Adında `UNSIGNED` bulunan dokuz paket ile `SHA256SUMS.txt` dosyasının
   bulunduğunu kontrol et.
7. macOS ve Windows güvenlik uyarısı açıklamasının görünür olduğunu doğrula.
8. Draft release'i manuel olarak yayınla.

İlk GitHub kurulumu için `release` adında bir environment oluşturmak yeterlidir;
şimdilik imzalama secret'ı gerekmez. Ayrıntılar için ana
[README](../README.md#github-releases) belgesine bak.
