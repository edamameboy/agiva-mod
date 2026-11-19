# 🌐 Panduan Install Agiva Multi-Creator Relay Hub di ZimaOS (`widget.cornermoji.site`)

Dengan **Agiva Multi-Creator Relay Hub** di ZimaOS, **semua creator** yang menjalankan aplikasi `Agiva-Mod-portable.exe` di PC mereka masing-masing akan **otomatis tersambung** ke `https://widget.cornermoji.site` tanpa perlu install Cloudflare Tunnel atau Ngrok di PC creator.

---

## 1. Cara Install Custom App di ZimaOS (1-Klik via Web UI)

1. Buka Dashboard **ZimaOS** di browser Anda.
2. Klik menu **App Store** ➔ klik tombol **Custom Install** (atau **Install a customized app**) di pojok kanan atas.
3. Klik tombol **Import** di pojok kanan atas modal, lalu pilih file:
   **[`relay-hub/docker-compose.yml`](./docker-compose.yml)**
4. Klik **Submit / Install**.
   - Container `agiva-relay-hub` akan otomatis mengunduh `node:20-alpine`, menyiapkan `ws` dan `server.js` di `/DATA/AppData/agiva-relay-hub`, lalu berjalan di port **`7030`**.
5. Setelah aktif, klik ikon **Agiva Relay Hub** di dashboard ZimaOS (`http://<IP-ZIMAOS>:7030`) untuk melihat daftar creator yang sedang online.

---

## 2. Hubungkan Cloudflare Tunnel di ZimaOS ke Port `7030`

Di dashboard **Cloudflare Zero Trust** (menu **Networks ➔ Tunnels ➔ Public Hostname**):
- **Subdomain:** `widget`
- **Domain:** `cornermoji.site`
- **Service Type:** `HTTP`
- **URL:** `<IP-LOKAL-ZIMAOS>:7030` (atau `localhost:7030` jika `cloudflared` berjalan di ZimaOS dengan network host)

---

## 3. Format Link Otomatis untuk Setiap Creator

Begitu creator membuka aplikasi `Agiva Mod` dan mengisi username TikTok mereka (misal `@budi_gaming`), aplikasi di PC creator otomatis terkoneksi ke `wss://widget.cornermoji.site/relay-agent`.

Semua tombol **📋 Copy URL Overlay** dan **📋 Copy Webhook** di dashboard PC creator tersebut akan otomatis menghasilkan link milik mereka sendiri:

- **Overlay Utama Creator:**
  `https://widget.cornermoji.site/c/budi_gaming/overlay`
- **Widget Timer / Wheel / Goal Creator:**
  `https://widget.cornermoji.site/c/budi_gaming/overlay?widget=timer`
- **Webhook Saweria Creator:**
  `https://widget.cornermoji.site/c/budi_gaming/api/webhook/donation/saweria`
  *(atau alias pendek: `https://widget.cornermoji.site/c/budi_gaming/webhook/saweria`)*
- **Webhook SociaBuzz / Trakteer / BagiBagi Creator:**
  - `https://widget.cornermoji.site/c/budi_gaming/api/webhook/donation/sociabuzz`
  - `https://widget.cornermoji.site/c/budi_gaming/api/webhook/donation/trakteer`
  - `https://widget.cornermoji.site/c/budi_gaming/api/webhook/donation/bagibagi`
- **Mobile Touch Stream Deck Creator (Dilindungi PIN):**
  `https://widget.cornermoji.site/c/budi_gaming/remote`

> 🔒 **Keamanan Terjamin:** Akses ke `/dashboard` dan seluruh endpoint Admin/Config dari internet publik (`widget.cornermoji.site`) **diblokir 100% (`403 Forbidden`)** baik di level ZimaOS Relay Hub maupun di PC creator.
