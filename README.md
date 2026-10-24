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

CI chạy tất cả các bước trên ở mỗi lần push (`.github/workflows/ci.yml`).

## Kiến trúc

```
sim/          Rust → WebAssembly: vật lý tất định 240 Hz, lưới không gian cho va chạm bóng–bóng
src/sim.ts    Lớp bọc WASM; đọc thẳng bộ đệm trong bộ nhớ WASM (không sao chép)
src/render/   GPU: WebGL2 instanced + SDF · CPU: Canvas 2D · lớp chữ (HUD) dùng chung
src/audio/    Tổng hợp âm WebAudio, chọn nốt, nạp MIDI, dựng nhạc offline khi xuất
src/export/   Web Worker: mô phỏng → vẽ → VideoEncoder → mp4-muxer
src/search/   Web Worker tìm seed (chạy mô phỏng không vẽ hình)
src/ui/       Bảng thiết lập sinh từ schema, xem trước + tua, trình soạn giai điệu
tests/        unit/ (Vitest) · e2e/ (Playwright)
```

## Sửa lõi vật lý (Rust)

File `src/wasm/ball_sim.wasm` đã được build sẵn và commit kèm, nên nếu không sửa Rust thì không cần cài Rust. Nếu sửa `sim/src/lib.rs`:

```
rustup target add wasm32-unknown-unknown
npm run build:wasm
```

Bảng tham số `P` trong `src/sim.ts` phải khớp với các hằng `P_*` trong `lib.rs`.
