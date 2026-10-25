# Ball Studio

Công cụ tự làm video "bóng nảy" kiểu satisfying/ASMR cho TikTok, Shorts và Reels. Chạy hoàn toàn trên trình duyệt, không cần server, không mất phí và không có watermark bắt buộc.

## Tính năng

**11 kiểu video**, mỗi kiểu có thêm các biến thể bấm là dùng:

| Kiểu | Mô tả |
|---|---|
| ⭕ Classic | Bóng thoát qua khe thì sinh thêm bóng. Biến thể: "Bóng có thoát được không?", vòng kính, dây va chạm, vật phẩm |
| ♾️ Infinite Loop | 1 bóng nhân bản thành hàng nghìn bóng |
| 🎈 Lớn dần | Mỗi lần nảy bóng to thêm. Biến thể: kèm gai, kèm dây |
| 💥 Destruction | Phá từng vòng đồng tâm. Biến thể: vòng kính, tăng tốc |
| 📌 Accumulation | Chạm gai thì bóng dính lại; vòng kính vỡ thì tất cả thoát |
| ☄️ Collision | 2 bóng chạm nhau thì nổ ra hàng trăm hoặc hàng nghìn bóng |
| 🌀 Spiral | Vòng xoắn ốc xoay đẩy bóng ra ngoài; phá kim cương để nhân điểm |
| 🖌️ Trail | Vệt màu loang kín vòng |
| 🫧 Merge | Bóng cùng cỡ gộp lại thành bóng lớn hơn |
| 👑 King of the Hill | Các đội bị loại dần khi rơi khỏi vòng; đội còn lại cuối cùng thắng |
| 🦋 Symmetric Drop | Các bóng lệch nhau 0.01px dẫn tới hỗn loạn |

**Tùy chọn có thể bật ở mọi kiểu:**
- **Hình dạng đấu trường:** tròn hoặc đa giác đều 3–12 cạnh (ví dụ thất giác 7 cạnh); vẫn có khe hở, xoay, gai, kính.
- **Gai mọc dài dần** theo tốc độ tự chọn (px/giây); gai dài thì bóng chạm vào đầu gai sớm hơn.
- **Bóng đặc biệt:** một bóng có cỡ và màu riêng (ví dụ bóng trắng to) giữa đám bóng nhỏ nhiều màu; bóng này miễn nhiễm với gai.
- **Dòng chữ phụ phía dưới** (ví dụ "Did you recognize the music?"), có thể chọn thời điểm bắt đầu hiện.
- **Gai:** chạm vào thì bóng vỡ tan hoặc dính lại.
- **Vòng kính:** vỡ sau N lần va, có vết nứt lan dần.
- **Vật phẩm:** nhân đôi, tăng tốc, to ra, nhỏ lại.
- **Dây va chạm:** mỗi lần chạm vòng để lại một sợi dây, tạo hình kiểu string art.
- **Hình ảnh:** vệt đuôi, tô màu vĩnh viễn, phát sáng, mảnh vỡ.

**Âm thanh:**
- **11 nhạc cụ tổng hợp sẵn:** marimba, piano, chuông, hộp nhạc, đàn hạc, guitar, gảy dây, organ, synth, pop, 8-bit.
- **Nhạc cụ từ file của bạn:** nạp wav/mp3/ogg, công cụ tự đổi cao độ theo từng nốt.
- **Trình soạn giai điệu (piano-roll):** vẽ nốt trên lưới, có hợp âm, nạp file MIDI, nghe thử. Mỗi cú nảy phát nốt kế tiếp.
- **6 bài public domain có sẵn**, hoặc phát theo thang âm.
- **Hiệu ứng âm thanh:** vỡ kính, nổ, vật phẩm, kết thúc.

**🎲 Tạo video ngẫu nhiên** (phím `G`):
- Một lần bấm sẽ tự chọn kiểu video, biến thể, thông số, bảng màu, nhạc cụ, bài nhạc và câu hook (tiếng Việt hoặc tiếng Anh).
- Với kiểu video tự kết thúc, công cụ **tìm luôn seed để video kết thúc trong khoảng độ dài bạn đặt** (ví dụ 15–40 giây) và cắt video ngay sau đoạn kết.
- Có thể khóa giữ nguyên từng nhóm: kiểu và vật lý, màu sắc, âm thanh, chữ. Thiết lập xuất video (độ phân giải, fps, bitrate, watermark, vùng an toàn, GPU/CPU) luôn được giữ nguyên.
- **🎬 Tạo & xuất N video:** mỗi video một cấu hình ngẫu nhiên khác nhau, xuất lần lượt thành `…-random1.mp4`, `…-random2.mp4`, …
- Bấm hoàn tác (↶) để quay lại video trước.

**🚀 Công cụ viral:**
- **🏆 Video kịch tính nhất:** chấm điểm hàng trăm seed theo độ hồi hộp và đưa ra top 5. Tiêu chí gồm số lần *suýt thoát* (nhất là ở cuối video), thoát ngay sau một lần suýt, nhịp nhanh dần, chung kết King of the Hill kéo dài và các biến cố.
- **🎶 Khớp nhịp nhạc (beat-sync):** nạp MP3/WAV, công cụ tự dò BPM và vị trí từng nhịp, rồi co giãn thời gian chuyển động để mỗi cú nảy rơi đúng nhịp. Nhạc nền được trộn vào video.
- **♾️ Video lặp liền mạch:** tìm đoạn mà khung cuối giống khung đầu nhất (so vị trí, vận tốc bóng, góc vòng, pha màu), xuất kèm 0,3 giây chuyển cảnh để video quay vòng không thấy chỗ nối.
- **✂️ Phần 1 / Phần 2:** phần 1 dừng ngay trước khoảnh khắc quyết định kèm chữ "Xem phần 2 👀", phần 2 bắt đầu bằng 2 giây tua lại rồi đến đoạn kết.
- **⚔️ Đấu đôi chia màn hình:** 2 hoặc 4 đấu trường cùng luật nhưng khác seed; đấu trường kết thúc trước thắng.
- **⚡ Biến cố theo thời gian:** đảo trọng lực, nhân trọng lực, lỗ đen, gió, tăng tốc, thêm bóng, đảo chiều xoay, mở rộng khe. Có banner thông báo trên video.
- **Cơ chế mới:** cổng dịch chuyển, nam châm ở tâm, gió.
- **🅰🅱 Xuất A/B:** cùng một video, khác câu hook hoặc khác bảng màu, để đăng thử xem bản nào ăn khách hơn.
- **📋 Caption + hashtag** (tiếng Việt hoặc tiếng Anh) và **🖼 ảnh bìa** được tự tải kèm mỗi video; cũng có thể sao chép caption hoặc tải ảnh bìa của khung hiện tại.
- **✨ Tạo từ mô tả:** gõ ví dụ "bóng lớn dần có gai, màu neon, piano, 30 giây" hoặc "4 teams, sunset, black hole, english, 20-40s".
- **🎧 ASMR:** âm thanh stereo theo vị trí bóng, thêm nhạc cụ thủy tinh, bi ve, gỗ, giọt nước.

**Tìm seed tự động:** thử hàng trăm đến hàng nghìn seed trong nền để tìm video **kết thúc đúng số giây** bạn cần, hoặc **kết thúc đúng lúc bài nhạc chơi hết**. Bấm vào kết quả để xem ngay.

**Xuất video:**
- MP4 H.264 kèm AAC hoặc Opus; 720p đến 4K; 30 hoặc 60 fps.
- **Xuất 2 bản TikTok + Shorts** chỉ với một lần bấm, mỗi bản tự né vùng bị nút bấm và caption của app che.
- **Xuất hàng loạt** nhiều seed liên tiếp.
- **Watermark** tùy chỉnh.

**Giao diện:**
- Thẻ chọn kiểu video kèm các biến thể.
- **Thanh tua thời gian** (tua tới và lui).
- **Hoàn tác / làm lại**, **ô tìm thiết lập**.
- **Phím tắt** (bấm ⌨ để xem).
- Khung vùng an toàn khi xem trước.
- Tự lưu cấu hình; lưu và mở preset JSON.

## Bi rơi 3D (tab "🎵 Bi rơi 3D")

Trang riêng `marble.html`, chuyển qua lại với Ball Studio 2D bằng tab trên đầu trang. Kiểu video: một viên bi thép rơi xuống, gõ vào các phím gỗ và phím trắng để chơi một bài nhạc.

- **Thiết kế ngược từ bài nhạc:** mỗi nốt là một lần bi chạm phím đúng thời điểm, nên video luôn khớp nhạc và không cần tìm seed. Giữa hai lần chạm, bi bay theo parabol tính sẵn. Phím được nghiêng sao cho bi bật đúng tới phím kế tiếp.
- Nốt nhanh hơn mức đặt (mặc định 0,14 giây, từ 3 nốt trở lên) → **dãy phím lăn trên ray**. Các dãy nối nhau thành cầu thang xoắn vuông quanh trục rơi.
- Khoảng nghỉ dài → **máng cong**, bi lăn qua máng rồi bay tiếp.
- Nốt trầm dùng **phím gỗ**, nốt cao dùng **phím trắng**. Ngưỡng cao độ chỉnh được. Phím trầm dài hơn phím cao, giống đàn xylophone thật.
- Phím rung và lóe sáng khi bị gõ. Có bóng đổ, đèn rọi theo bi, sương mờ ở đáy, camera nhìn từ trên xuống bám theo bi.
- Âm thanh: phím gỗ và phím trắng dùng 2 nhạc cụ riêng (mặc định marimba và hộp nhạc), âm stereo theo vị trí phím, có tiếng bi lăn trên ray/máng.
- Nguồn nhạc: 6 bài có sẵn (chỉnh BPM, số lần lặp, dịch giọng) hoặc **file MIDI** (giữ nguyên nhịp gốc, hợp âm gõ cùng lúc).
- Chữ: tiêu đề ở trên, chữ phụ ở dưới.
- Tua tức thì đến bất kỳ thời điểm nào, vì vị trí bi tính trực tiếp từ thời gian.
- Có seed bố cục (cùng bài nhạc, khác đường chạy), lưu và mở preset.
- **Xuất MP4:** cả bài hoặc một đoạn (từ … đến … giây). Three.js vẽ trên OffscreenCanvas trong worker, mã hóa bằng WebCodecs, ưu tiên GPU.

## GPU hay CPU?

Công cụ tách riêng 3 phần việc, mỗi phần chọn cách chạy hợp nhất:

| Phần việc | Chạy bằng | Lý do |
|---|---|---|
| Vật lý | **CPU (Rust → WASM)**, luôn luôn | Chỉ tốn khoảng 0,3 giây cho 2.000 bóng × 30 giây. Đưa lên GPU không nhanh hơn mà lại mất tính tất định (cùng seed thì ra cùng video). |
| Vẽ hình | **Tự động**: GPU (WebGL2), lỗi thì chuyển CPU (Canvas 2D). Chọn tay được | GPU vẽ hàng nghìn bóng mỗi khung hình mà không chậm. CPU dùng cho máy không có WebGL2, máy remote desktop hoặc driver lỗi. |
| Mã hóa video | **Tự động**: GPU (NVENC/QuickSync/AMF), không có thì dùng phần mềm. Chọn tay được | GPU nhanh hơn nhiều lần. CPU chậm hơn nhưng chất lượng ổn định ở bitrate thấp và tránh lỗi driver. |

Khung xem trước có badge "Vẽ: GPU/CPU". Dòng trạng thái khi xuất cho biết bộ mã hóa thực sự đang được dùng.

## Chạy trên Windows

1. Cài [Node.js LTS](https://nodejs.org).
2. Mở PowerShell trong thư mục dự án và chạy:
   ```
   npm install
   npm run dev
   ```
3. Mở http://localhost:5173 bằng **Chrome hoặc Edge**.

Để có bản tĩnh dùng lâu dài: chạy `npm run build`, sau đó đưa thư mục `dist/` lên bất kỳ web host tĩnh nào hoặc chạy `npm run preview`.

## Kiểm thử

```
npm run typecheck   # TypeScript (app + test)
npm test            # Unit test lõi mô phỏng (WASM thật, chạy trong Node)
npm run test:e2e    # E2E test bằng Playwright (tự build và chạy server)
```

- **Unit test:** kiểm tra mọi chế độ và biến thể chạy ổn định (không ra NaN), điều kiện kết thúc của từng chế độ, gai, kính, vật phẩm, dây, tính tất định (cùng seed thì cùng sự kiện) và hiệu năng.
- **E2E test:**
  - Tải trang không có lỗi; cả 11 chế độ đều vẽ được; biến thể; trường hiển thị theo chế độ.
  - Thiết lập và tìm thiết lập; seed, phím tắt, phát/dừng, tua, hoàn tác.
  - Vùng an toàn; lưu, mở và tự lưu preset.
  - Trình soạn giai điệu, nạp MIDI, nạp âm thanh riêng.
  - Xuất MP4 (kiểm tra cấu trúc file, track hình và track tiếng); xuất bằng CPU; xuất 2 bản; hủy khi đang xuất.
  - Tìm seed; renderer CPU.
  - Bi rơi 3D: chuyển tab, vẽ cảnh 3D, tua, phát, đổi bài/BPM/seed, nạp MIDI (sinh dãy phím lăn và máng cong), xuất MP4 có tiếng.
- **Unit test bi rơi 3D:** mỗi nốt có đúng một phím, bi chạm phím đúng thời điểm, quỹ đạo liền mạch, bi bật ra đúng phía mặt phím, cùng seed thì cùng đường chạy.

CI (`.github/workflows/ci.yml`) hiện chỉ chạy khi bấm tay ở tab Actions ("Run workflow"). Muốn chạy ở mỗi lần push, thêm lại `push:` và `pull_request:` vào mục `on:`.

## Kiến trúc

```
sim/          Rust → WebAssembly: vật lý tất định 240 Hz, lưới không gian cho va chạm bóng–bóng
src/sim.ts    Lớp bọc WASM; đọc thẳng bộ đệm trong bộ nhớ WASM (không sao chép)
src/render/   GPU: WebGL2 instanced + SDF · CPU: Canvas 2D · lớp chữ (HUD) dùng chung
src/audio/    Tổng hợp âm WebAudio, chọn nốt, nạp MIDI, dựng nhạc offline khi xuất
src/export/   Web Worker: mô phỏng → vẽ → VideoEncoder → mp4-muxer
src/scene.ts  Ghép 1–4 đấu trường, chữ phủ, crossfade — dùng chung cho xem trước và xuất video
src/sync.ts   Co giãn thời gian (time-warp) để cú nảy khớp nhịp nhạc
src/search/   Web Worker tìm seed, chấm điểm kịch tính, tìm đoạn lặp (chạy mô phỏng không vẽ hình)
src/viral/    Chấm điểm kịch tính, tìm đoạn lặp, chia Phần 1/2, A/B, caption, phân tích mô tả, beat-sync
src/ui/       Bảng thiết lập sinh từ schema, xem trước + tua, trình soạn giai điệu
src/marble/   Bi rơi 3D: choreo.ts (dựng đường chạy từ nốt), scene3d.ts (Three.js), audio.ts, worker xuất MP4
marble.html   Trang/tab Bi rơi 3D
tests/        unit/ (Vitest) · e2e/ (Playwright)
```

## Sửa lõi vật lý (Rust)

File `src/wasm/ball_sim.wasm` đã được build sẵn và commit kèm, nên nếu không sửa Rust thì không cần cài Rust. Nếu sửa `sim/src/lib.rs`:

```
rustup target add wasm32-unknown-unknown
npm run build:wasm
```

Bảng tham số `P` trong `src/sim.ts` phải khớp với các hằng `P_*` trong `lib.rs`.
