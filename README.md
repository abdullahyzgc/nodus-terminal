# Nodus

Nodus'u sunuculara bağlanmak, dosyaları düzenlemek ve sık kullandığım komutları tek yerde tutmak için geliştiriyorum. Türkçe arayüzlü bir SSH/SFTP masaüstü uygulaması. Terminalin yanında dosya yöneticisi, Docker ve servis paneli, canlı günlükler bulunuyor.

Hesap veya abonelik gerekmiyor. Bağlantı bilgileri cihazda şifreli bir kasada tutuluyor. İstersen Google Drive veya kendi WebDAV sunucun üzerinden kasanı diğer cihazlarla eşleyebilirsin.

## Özellikler

- Sekmeli SSH bağlantıları, sunucu grupları, favoriler ve hızlı bağlantı.
- Parola veya SSH anahtarıyla giriş.
- SFTP ile dosya yükleme, indirme, düzenleme ve izin değiştirme.
- Kayıt öncesi dosya karşılaştırma ve şifreli yerel yedekten geri alma.
- Sunucuda arşiv oluşturma ve açma.
- tmux ile kalıcı oturum ve bağlantı kopunca yeniden bağlanma.
- Docker konteynerlerini ve systemd servislerini yönetme.
- Canlı günlüklerde arama ve filtreleme.
- Komut kestirmeleri ve parametreli komut akışları.
- CPU, RAM, disk ve ağ kullanımını izleme.
- Üretim sunucularında uyarı ve ek işlem onayı.
- Tema, renk paleti ve yazı tipi ayarları.

## Kullandığım teknolojiler

Uygulamanın ana dili TypeScript. Arayüzü React ile, masaüstü tarafını Electron ile hazırladım. Görünüm için HTML ve CSS, geliştirme betiklerinde JavaScript kullanıyorum.

| Araç | Kullanım |
| --- | --- |
| React, TypeScript | Arayüz ve uygulama mantığı |
| HTML, CSS | Yerleşim ve temalar |
| Electron, Node.js | Masaüstü penceresi ve dosya işlemleri |
| xterm.js, ssh2 | Terminal, SSH ve SFTP |
| Vite, esbuild | Geliştirme ve derleme |
| electron-builder, electron-updater | Kurulum ve güncellemeler |
| Node.js test runner, Playwright | Birim ve arayüz testleri |

## Kurulum

Windows x64 kurulum dosyasını [Releases](https://github.com/abdullahyzgc/nodus-terminal/releases) sayfasından indirebilirsin. Kurulu Windows sürümü güncellemeleri indirir; **Yeniden başlat ve güncelle** ile kurulum başlar.

macOS için DMG derleme hedefi de var, ancak gerçek cihaz testini henüz tamamlamadım.

### İlk bağlantı

1. Uygulamayı açıp en az 12 karakterlik bir kasa parolası belirle.
2. **Yeni sunucu** bölümüne adres, port ve kullanıcı bilgilerini gir.
3. Parola veya SSH anahtarıyla giriş yöntemini seç.
4. İlk bağlantıdaki SSH parmak izini sunucu sağlayıcısının konsolu gibi bağımsız bir kaynaktan doğrula.
5. **Kaydet ve bağlan** ile terminali aç. Dosyalara sağdaki SFTP panelinden ulaşabilirsin.

Kasa parolasını güvenli bir yerde sakla; unutulursa kurtarılamaz. Sunucunun SSH anahtarı değişirse bağlantı engellenir. Değişikliği doğrulamadan yeni anahtara güvenme.

## Kullanım

**Terminalde kopyalama:** Metni seçip **Ctrl+C** ile kopyalayabilir, **Ctrl+V** ile yapıştırabilirsin. Seçim yokken **Ctrl+C** çalışan komutu keser. **Ctrl+Shift+C/V** ve **Shift+Insert** de kullanılabilir; macOS'ta **Cmd+C/V** desteklenir. Birden fazla satır yapıştırmadan önce içeriği kontrol et; bazı kabuklar satırları hemen çalıştırabilir.

**Dosyalar:** SFTP panelinde dosyaya sağ tıklayıp düzenleyebilirsin. **Ctrl/Cmd+S** kayıt öncesi karşılaştırmayı açar. **Fark / Geçmiş** ile eski sürüme dönebilirsin. Editör 512 KB UTF-8 metin destekler. Son 20 dosyanın beşer sürümü cihazda saklanır; geçmiş kasa eşlemesine dahil değildir. Dosya silme işlemi geri alınamaz.

**Kalıcı oturum:** Sunucu formunda **Kesintiye dayanıklı oturum (tmux)** seçeneğini aç. Sunucuda tmux kurulu olmalı. Bağlantı koparsa en fazla üç otomatik deneme yapılır. Uygulama kapansa veya kasa kilitlense de tmux içindeki işler sunucuda devam edebilir.

**Sunucu yönetimi:** Terminalin üstündeki **Sunucu yönetimi** düğmesinden Docker, servisler ve canlı günlüklere ulaşabilirsin. Araçların sunucuda kurulu olması ve SSH kullanıcısının erişim yetkisi bulunması gerekir. Otomatik sudo çalıştırılmaz.

**Komut akışları:** Kestirme oluştururken **Parametreli komut akışı** seçeneğini işaretle. Her satıra bir komut yaz; değişkenleri ayrı, tırnaksız {{parametre}} alanlarıyla belirt. Çalıştırmadan önce değerler sorulur ve komutlar gösterilir. Akış ayrı kabukta çalışır; terminalin bulunduğu dizini devralmaz. En fazla 30 adım ve üç dakika desteklenir. Borular ve komut zincirleri desteklenmez. Hata durumunda durur; önceki adımları geri almaz. Bağlantı kesilirse tekrar çalıştırmadan önce uzaktaki işlemi kontrol et.

**Üretim sunucuları:** Sunucu formunda üretim seçeneğini işaretleyebilirsin. Terminal girdisi ve dosya değişiklikleri için ek onay istenir. Terminal açıldıktan sonra yazılan komutlar tek tek denetlenmez.

**Kasa eşleme:** Ayarlardan Google Drive veya HTTPS WebDAV bağlantısı ekleyebilirsin. Drive için kendi masaüstü OAuth JSON dosyan gerekir. Drive eşlemesi otomatik, WebDAV aktarımı manueldir. Bulut kullanmak istemiyorsan şifreli kasa yedeğini dışa aktarabilirsin.

## Kaynak koddan çalıştırma

Node.js 22, npm ve Git gerekiyor. Depoyu bilgisayarına aldıktan sonra proje klasöründe:

```sh
npm ci
npm run dev
```

Geliştirme komutu Electron penceresini açar. CSS ve React değişiklikleri kaydedildiğinde pencereye yansır. Electron tarafındaki değişikliklerde geliştirme sürecini yeniden başlatmak gerekir.

**F12** veya **Ctrl+Shift+I** ile geliştirici araçlarını açabilirsin. macOS'ta **Cmd+Shift+I** kullanılır. Sağ tık menüsünde **İncele** de var. Buradaki CSS/HTML düzenlemeleri geçicidir; kalıcı değişiklikleri kaynak dosyaya aktarman gerekir.

Tarayıcı geliştirme komutu yalnızca masaüstü uyarısını gösterir. SSH ve kasa Electron gerektirdiği için tasarımı düzenlerken de masaüstü geliştirme modunu kullan.

Windows PowerShell yürütme ilkesi hatası verirse npm yerine npm.cmd yazabilirsin.

## Derleme ve test

```sh
npm run check
npm test
npm run build
npm start
```

Windows kurulum paketi için:

```sh
npm run dist:win
```

macOS üzerinde DMG oluşturmak için:

```sh
npm run dist:mac
```

Kurulum dosyaları release/ klasörüne çıkar.
